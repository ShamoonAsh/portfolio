/* ============================================================
   /api/admin/auth
     GET     session check: { authenticated, user?, configured }
             (configured holds booleans only, never values)
     POST    log in  { username, password }
     DELETE  log out

   Failed logins are counted per IP in Redis: 5 failures lock that
   IP out until 15 minutes after its last failed attempt. IPs are
   stored as salted hashes, not in the clear.
   ============================================================ */

const crypto = require("crypto");
const { redis, multi, redisConfig } = require("../_lib/redis");
const {
  adminConfig,
  safeEqual,
  createSessionToken,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  sameOrigin,
  clientIp,
  readJsonBody,
} = require("../_lib/auth");

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function failKey(req, cfg) {
  const hash = crypto.createHmac("sha256", cfg.secret).update("ip\n" + clientIp(req)).digest("hex").slice(0, 40);
  return "portfolio:login-fail:" + hash;
}

async function recentFailures(key) {
  return Number(await redis("GET", key)) || 0;
}

// the counter expires on its own WINDOW_MINUTES after the latest failure
async function recordFailure(key) {
  await multi([
    ["INCR", key],
    ["EXPIRE", key, WINDOW_MINUTES * 60],
  ]);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const cfg = adminConfig();

  if (req.method === "GET") {
    const session = getSession(req);
    return res.status(200).json({
      authenticated: Boolean(session),
      user: session ? session.user : undefined,
      configured: {
        credentials: Boolean(cfg.username && cfg.password),
        sessionSecret: Boolean(cfg.secret) && !cfg.secretTooShort,
        database: redisConfig().ok,
      },
    });
  }

  if (req.method === "DELETE") {
    if (!sameOrigin(req)) return res.status(403).json({ error: "Bad origin." });
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!sameOrigin(req)) return res.status(403).json({ error: "Bad origin." });

  if (!cfg.ok) {
    console.error(
      "Admin login is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD and ADMIN_SESSION_SECRET " +
        "(32+ characters) in Vercel, then redeploy."
    );
    return res.status(500).json({ error: "Admin login isn't configured on the server yet.", code: "not_configured" });
  }
  if (!redisConfig().ok) {
    return res.status(500).json({ error: "The database isn't connected yet.", code: "redis_not_configured" });
  }

  const body = readJsonBody(req);
  const username = body ? String(body.username || "").slice(0, 200) : "";
  const password = body ? String(body.password || "").slice(0, 500) : "";
  if (!username || !password) {
    return res.status(400).json({ error: "Enter your username and password." });
  }

  const key = failKey(req, cfg);

  try {
    if ((await recentFailures(key)) >= MAX_FAILURES) {
      return res.status(429).json({
        error: "Too many failed attempts. Try again in " + WINDOW_MINUTES + " minutes.",
        code: "rate_limited",
      });
    }
  } catch (err) {
    // fail closed: without the counter there is no brute-force protection
    console.error("Login rate-limit check failed:", err.code || "", err.message);
    return res.status(503).json({ error: "Login is temporarily unavailable. Try again shortly.", code: err.code });
  }

  // evaluate both, always, so timing doesn't reveal which one was wrong
  const userOk = safeEqual(username.trim(), cfg.username);
  const passOk = safeEqual(password, cfg.password);

  if (!(userOk && passOk)) {
    await recordFailure(key).catch((err) => console.error("Could not record failed login:", err.message));
    await sleep(600);
    return res.status(401).json({ error: "Wrong username or password." });
  }

  await redis("DEL", key).catch(() => {});
  setSessionCookie(res, createSessionToken(cfg));
  return res.status(200).json({ ok: true, user: cfg.username });
};

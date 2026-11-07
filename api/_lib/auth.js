/* ============================================================
   Admin authentication.

   The credentials live ONLY in Vercel environment variables, never
   in this repository:
     ADMIN_USERNAME        the login name
     ADMIN_PASSWORD        the password
     ADMIN_SESSION_SECRET  long random string that signs session cookies

   A successful login sets an HttpOnly, Secure, SameSite=Strict cookie
   holding {user, expiry} plus an HMAC signature. The signing key mixes
   in the username and password, so changing either one (or the secret)
   logs every existing session out.
   ============================================================ */

const crypto = require("crypto");

const COOKIE_NAME = "__Host-portfolio_admin";
const SESSION_SECONDS = 8 * 60 * 60;

function adminConfig() {
  const username = (process.env.ADMIN_USERNAME || "").trim();
  const password = (process.env.ADMIN_PASSWORD || "").trim();
  const secret = (process.env.ADMIN_SESSION_SECRET || "").trim();
  return {
    username,
    password,
    secret,
    ok: Boolean(username && password && secret.length >= 32),
    secretTooShort: Boolean(secret) && secret.length < 32,
  };
}

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest();

// Constant-time comparison: hashing first makes the lengths equal, so neither
// the content nor the length of the real value leaks through timing.
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function signingKey(cfg) {
  return crypto
    .createHmac("sha256", cfg.secret)
    .update("admin-session\n" + cfg.username + "\n" + cfg.password)
    .digest();
}

function createSessionToken(cfg) {
  const payload = b64url(JSON.stringify({ u: cfg.username, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }));
  const sig = b64url(crypto.createHmac("sha256", signingKey(cfg)).update(payload).digest());
  return payload + "." + sig;
}

function verifySessionToken(token, cfg) {
  if (!cfg.ok || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = b64url(crypto.createHmac("sha256", signingKey(cfg)).update(parts[0]).digest());
  if (!safeEqual(parts[1], expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (data.u !== cfg.username || typeof data.exp !== "number") return null;
    if (data.exp <= Math.floor(Date.now() / 1000)) return null;
    return { user: data.u, exp: data.exp };
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "")
    .split(";")
    .forEach((pair) => {
      const i = pair.indexOf("=");
      if (i < 0) return;
      const k = pair.slice(0, i).trim();
      if (k) out[k] = decodeURIComponent(pair.slice(i + 1).trim());
    });
  return out;
}

function getSession(req) {
  return verifySessionToken(parseCookies(req)[COOKIE_NAME], adminConfig());
}

// __Host- prefix: Secure, Path=/, no Domain, so the cookie can't be set or
// read by any other subdomain. Browsers treat http://localhost as secure, so
// this also works under `vercel dev`.
function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    COOKIE_NAME + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_SECONDS
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", COOKIE_NAME + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
}

// Extra CSRF guard on top of SameSite=Strict: a state-changing request that
// carries an Origin header must come from this same site.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return String(req.headers["x-real-ip"] || fwd || (req.socket && req.socket.remoteAddress) || "unknown");
}

function readJsonBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  return body && typeof body === "object" ? body : null;
}

module.exports = {
  adminConfig,
  safeEqual,
  createSessionToken,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  sameOrigin,
  clientIp,
  readJsonBody,
};

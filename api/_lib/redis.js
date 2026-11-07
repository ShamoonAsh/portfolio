/* ============================================================
   Minimal Upstash Redis REST client. No SDK, so the site keeps
   needing no package.json and no build step.

   Env (the Vercel <-> Upstash integration sets these for you):
     KV_REST_API_URL    or UPSTASH_REDIS_REST_URL
     KV_REST_API_TOKEN  or UPSTASH_REDIS_REST_TOKEN

   The token has full read/write access. It only ever runs here on
   the server and never reaches the browser.
   ============================================================ */

const TIMEOUT_MS = 8000;

function redisConfig() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return { url, token, ok: Boolean(url && token) };
}

async function request(path, body) {
  const { url, token, ok } = redisConfig();
  if (!ok) {
    const err = new Error("Upstash Redis is not configured (KV_REST_API_URL / KV_REST_API_TOKEN).");
    err.code = "redis_not_configured";
    throw err;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url + path, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const err = new Error("Upstash " + res.status + ": " + ((data && data.error) || text).slice(0, 300));
      err.code = "redis_" + res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error("Upstash did not respond within " + TIMEOUT_MS + "ms.");
      e.code = "redis_timeout";
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// One command: redis("SET", "key", "value") -> result
async function redis(...command) {
  const out = await request("", command.map(String));
  if (out && out.error) {
    const err = new Error("Upstash: " + out.error);
    err.code = "redis_error";
    throw err;
  }
  return out ? out.result : null;
}

// Several commands run atomically (MULTI/EXEC): multi([["SET","a","1"], ["DEL","b"]])
async function multi(commands) {
  const out = await request("/multi-exec", commands.map((c) => c.map(String)));
  if (!Array.isArray(out)) {
    const err = new Error("Upstash: " + ((out && out.error) || "transaction failed"));
    err.code = "redis_error";
    throw err;
  }
  out.forEach((r) => {
    if (r && r.error) {
      const err = new Error("Upstash: " + r.error);
      err.code = "redis_error";
      throw err;
    }
  });
  return out.map((r) => r.result);
}

module.exports = { redis, multi, redisConfig };

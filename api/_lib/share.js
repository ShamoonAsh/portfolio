/* ============================================================
   Link-preview banner (the og:image shown when the portfolio link
   is shared on WhatsApp, Instagram, LinkedIn, X, ...).

   Messaging apps don't run JavaScript and most only accept JPEG/PNG,
   so the banner is drawn in the /admin editor (canvas, with the
   site's real fonts, colours and hero text) and uploaded here on
   every save. Stored in Redis:
     portfolio:og:image  JPEG, base64
     portfolio:og:meta   { size, updatedAt }
   ============================================================ */

const { redis, multi } = require("./redis");

const IMG_KEY = "portfolio:og:image";
const META_KEY = "portfolio:og:meta";
const MAX_BYTES = 1.5 * 1024 * 1024;

async function readShareMeta() {
  const raw = await redis("GET", META_KEY);
  if (!raw) return null;
  try {
    const m = JSON.parse(raw);
    return { size: Number(m.size) || 0, updatedAt: m.updatedAt || null };
  } catch {
    return null;
  }
}

async function readShareImage() {
  const b64 = await redis("GET", IMG_KEY);
  return b64 ? Buffer.from(b64, "base64") : null;
}

async function saveShareImage(buffer) {
  const meta = { size: buffer.length, updatedAt: new Date().toISOString() };
  await multi([
    ["SET", IMG_KEY, buffer.toString("base64")],
    ["SET", META_KEY, JSON.stringify(meta)],
  ]);
  return meta;
}

module.exports = { MAX_BYTES, readShareMeta, readShareImage, saveShareImage };

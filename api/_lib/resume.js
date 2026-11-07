/* ============================================================
   Resume uploaded from /admin, stored in Redis:
     portfolio:resume:file  the PDF, base64
     portfolio:resume:meta  { size, originalName, uploadedAt }
   Both are written in one transaction, so they can't disagree.
   With nothing uploaded, the PDF committed to the repo is used.
   ============================================================ */

const { redis, multi } = require("./redis");

const FILE_KEY = "portfolio:resume:file";
const META_KEY = "portfolio:resume:meta";
const FALLBACK_PATH = "/SYED_SHAMOON_ASHRAF_RESUME.pdf";
const DOWNLOAD_NAME = "Syed-Shamoon-Ashraf-Resume.pdf";
const MAX_BYTES = 3 * 1024 * 1024; // keeps the base64 upload under Vercel's 4.5MB body limit

async function readResumeMeta() {
  const raw = await redis("GET", META_KEY);
  if (!raw) return null;
  try {
    const m = JSON.parse(raw);
    return {
      size: Number(m.size) || 0,
      originalName: typeof m.originalName === "string" ? m.originalName : "",
      uploadedAt: m.uploadedAt || null,
    };
  } catch {
    return null;
  }
}

async function readResumeFile() {
  const b64 = await redis("GET", FILE_KEY);
  return b64 ? Buffer.from(b64, "base64") : null;
}

async function saveResume(buffer, originalName) {
  const meta = {
    size: buffer.length,
    originalName: String(originalName || "resume.pdf").slice(0, 120),
    uploadedAt: new Date().toISOString(),
  };
  await multi([
    ["SET", FILE_KEY, buffer.toString("base64")],
    ["SET", META_KEY, JSON.stringify(meta)],
  ]);
  return meta;
}

async function deleteResume() {
  await redis("DEL", FILE_KEY, META_KEY);
}

module.exports = {
  FALLBACK_PATH,
  DOWNLOAD_NAME,
  MAX_BYTES,
  readResumeMeta,
  readResumeFile,
  saveResume,
  deleteResume,
};

/* ============================================================
   The editable site content: shape, validation and storage.

   Stored as one JSON string in Redis under "portfolio:content":
     { updatedAt: "<iso>", data: {
       version: 1,
       text:   { "<data-k key>": "<html>" },        // only what was changed
       colors: { dark: { "--token": "#rrggbb" },    // only what was changed
                 light: { ... } },
       defaultTheme: "dark" | "light" | "system"
     } }
   ============================================================ */

const { redis } = require("./redis");

const KEY = "portfolio:content";

// The colour tokens /admin may override. Keep in sync with admin/admin.js.
const COLOR_TOKENS = [
  "--bg",
  "--surface",
  "--surface-2",
  "--text",
  "--text-2",
  "--muted",
  "--accent",
  "--accent-soft",
  "--on-accent",
  "--grad-1",
  "--grad-2",
  "--grad-3",
  "--grad-4",
];
const THEMES = ["dark", "light"];
const DEFAULT_THEMES = ["dark", "light", "system"];

const KEY_RE = /^[a-z0-9-]{1,32}\.[0-9]{1,4}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const MAX_KEYS = 600;
const MAX_TEXT = 6000;

const INLINE_TAGS = { br: 1, strong: 1, em: 1, b: 1, i: 1 };

// Plain text plus <br>/<strong>/<em>/<b>/<i>, no attributes. Every other tag is
// dropped (its text kept), and stray angle brackets become entities, so a
// saved value can never inject markup, scripts or event handlers.
function sanitizeHtml(input) {
  const src = String(input == null ? "" : input).slice(0, MAX_TEXT);
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  const escapeText = (t) => t.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let out = "";
  let last = 0;
  let m;
  while ((m = tagRe.exec(src))) {
    out += escapeText(src.slice(last, m.index));
    last = tagRe.lastIndex;
    const name = m[1].toLowerCase();
    if (!INLINE_TAGS[name]) continue;
    const closing = m[0].charAt(1) === "/";
    if (name === "br") out += closing ? "" : "<br>";
    else out += closing ? "</" + name + ">" : "<" + name + ">";
  }
  out += escapeText(src.slice(last));
  return out.trim();
}

function normalizeContent(raw) {
  const src = raw && typeof raw === "object" ? raw : {};

  const text = {};
  if (src.text && typeof src.text === "object") {
    let count = 0;
    for (const key of Object.keys(src.text)) {
      if (count >= MAX_KEYS) break;
      const value = src.text[key];
      if (!KEY_RE.test(key) || typeof value !== "string") continue;
      text[key] = sanitizeHtml(value);
      count++;
    }
  }

  const colors = {};
  for (const theme of THEMES) {
    colors[theme] = {};
    const given = src.colors && typeof src.colors === "object" ? src.colors[theme] : null;
    if (!given || typeof given !== "object") continue;
    for (const token of COLOR_TOKENS) {
      const v = given[token];
      if (typeof v === "string" && HEX_RE.test(v)) colors[theme][token] = v.toLowerCase();
    }
  }

  const defaultTheme = DEFAULT_THEMES.includes(src.defaultTheme) ? src.defaultTheme : "dark";

  return { version: 1, text, colors, defaultTheme };
}

async function readContent() {
  const raw = await redis("GET", KEY);
  let stored = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  return {
    data: normalizeContent(stored ? stored.data : null),
    updatedAt: stored && typeof stored.updatedAt === "string" ? stored.updatedAt : null,
  };
}

async function writeContent(data) {
  const clean = normalizeContent(data);
  const updatedAt = new Date().toISOString();
  await redis("SET", KEY, JSON.stringify({ updatedAt, data: clean }));
  return { data: clean, updatedAt };
}

module.exports = { COLOR_TOKENS, normalizeContent, sanitizeHtml, readContent, writeContent };

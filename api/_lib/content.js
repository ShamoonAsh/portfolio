/* ============================================================
   The editable site content: shape, validation and storage.

   Stored as one JSON string in Redis under "portfolio:content":
     { updatedAt: "<iso>", data: {
       version: 1,
       text:   { "<data-k key>": "<html>" },        // only what was changed
       links:  { "<data-k key>": "<href>" },        // href of the <a> around that text
       layout: { lists: { "<data-list id>": ["<data-item id>", ...] },
                 clones: { "<new item id>": { from: "<original item id>" } } },
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

// Keys/ids inside a duplicated item are prefixed with the duplicate's id:
// "n4k2j9x1~projects.7". Duplicate ids are "n" + 4-12 lowercase letters/digits.
const CLONE_ID_RE = /^n[a-z0-9]{4,12}$/;
const PREFIX = "(?:n[a-z0-9]{4,12}~)?";
const KEY_RE = new RegExp("^" + PREFIX + "[a-z0-9-]{1,32}\\.[0-9]{1,4}$");
const ID_RE = new RegExp("^" + PREFIX + "[a-z0-9-]{1,40}$"); // list and item ids
const BASE_ITEM_RE = /^[a-z0-9-]{1,40}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
// http(s), mailto, tel, #anchor or /path. Never javascript: or data:.
const LINK_RE = /^(https?:\/\/[^\s"'<>]{1,490}|mailto:[^\s"'<>]{1,200}|tel:[0-9+()\- ]{3,30}|#[A-Za-z0-9_-]{1,80}|\/[^\s"'<>]{0,300})$/;
const MAX_KEYS = 1500;
const MAX_TEXT = 6000;
const MAX_LISTS = 400;
const MAX_LIST_ITEMS = 200;
const MAX_CLONES = 400;

const prefixOf = (id) => {
  const i = id.lastIndexOf("~");
  return i < 0 ? "" : id.slice(0, i);
};

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

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

function normalizeLayout(src) {
  const lists = {};
  const clones = {};
  if (!isObj(src)) return { lists, clones };

  if (isObj(src.clones)) {
    for (const id of Object.keys(src.clones).slice(0, MAX_CLONES)) {
      const from = isObj(src.clones[id]) ? src.clones[id].from : null;
      if (CLONE_ID_RE.test(id) && typeof from === "string" && BASE_ITEM_RE.test(from)) clones[id] = { from };
    }
  }

  // a prefix must name a duplicate that exists
  const prefixOk = (id) => {
    const p = prefixOf(id);
    return !p || Object.prototype.hasOwnProperty.call(clones, p);
  };

  if (isObj(src.lists)) {
    for (const listId of Object.keys(src.lists).slice(0, MAX_LISTS)) {
      const order = src.lists[listId];
      if (!ID_RE.test(listId) || !prefixOk(listId) || !Array.isArray(order)) continue;
      const seen = new Set();
      lists[listId] = order
        .filter((id) => typeof id === "string" && (ID_RE.test(id) || CLONE_ID_RE.test(id)) && !seen.has(id) && seen.add(id))
        .filter((id) => (CLONE_ID_RE.test(id) ? Object.prototype.hasOwnProperty.call(clones, id) : prefixOk(id)))
        .slice(0, MAX_LIST_ITEMS);
    }
  }

  // Drop duplicates no list places on the page, and the lists inside them.
  // Repeat: removing a duplicate can orphan one nested inside it.
  for (let changed = true; changed; ) {
    changed = false;
    for (const listId of Object.keys(lists)) {
      const p = prefixOf(listId);
      if (p && !clones[p]) {
        delete lists[listId];
        changed = true;
      }
    }
    const placed = new Set();
    Object.values(lists).forEach((order) => order.forEach((id) => placed.add(id)));
    for (const id of Object.keys(clones)) {
      if (!placed.has(id)) {
        delete clones[id];
        changed = true;
      }
    }
  }
  for (const listId of Object.keys(lists)) {
    lists[listId] = lists[listId].filter((id) => {
      if (CLONE_ID_RE.test(id)) return Boolean(clones[id]);
      const p = prefixOf(id);
      return !p || Boolean(clones[p]);
    });
  }

  return { lists, clones };
}

function normalizeContent(raw) {
  const src = raw && typeof raw === "object" ? raw : {};

  const layout = normalizeLayout(src.layout);
  const keyOk = (key) => {
    if (!KEY_RE.test(key)) return false;
    const p = prefixOf(key);
    return !p || Object.prototype.hasOwnProperty.call(layout.clones, p);
  };

  const text = {};
  if (src.text && typeof src.text === "object") {
    let count = 0;
    for (const key of Object.keys(src.text)) {
      if (count >= MAX_KEYS) break;
      const value = src.text[key];
      if (!keyOk(key) || typeof value !== "string") continue;
      text[key] = sanitizeHtml(value);
      count++;
    }
  }

  const links = {};
  if (isObj(src.links)) {
    let count = 0;
    for (const key of Object.keys(src.links)) {
      if (count >= MAX_KEYS) break;
      const value = typeof src.links[key] === "string" ? src.links[key].trim() : "";
      if (!keyOk(key) || !LINK_RE.test(value)) continue;
      links[key] = value;
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

  return { version: 1, text, links, layout, colors, defaultTheme };
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

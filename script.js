/* ============================================================
   Portfolio interactions: nav state, mobile menu, scroll reveal
   ============================================================ */

// Content is visible by default; this class is what lets CSS hide .reveal
// elements before they animate in. If JS ever fails, nothing disappears.
document.documentElement.classList.add("js");

/* ============================================================
   Theme toggle + content edits saved from /admin
   ============================================================ */

const root = document.documentElement;
const CMS_EDIT_MODE = /[?&]cms=edit\b/.test(location.search);

// --- theme ----------------------------------------------------------------
// The head script already restored a saved choice before first paint. With
// no saved choice, the default set in /admin applies once content loads.
const themeToggle = document.getElementById("themeToggle");

function currentTheme() {
  return root.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function setTheme(theme, opts) {
  const animate = opts && opts.animate;
  if (animate) {
    root.classList.add("theme-anim");
    setTimeout(() => root.classList.remove("theme-anim"), 420);
  }
  root.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  if (themeToggle) {
    const label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
  }
  updateBrandChrome();
}

// --- favicon + browser bar follow the palette -----------------------------
// The tab icon is the logo mark drawn in the current accent colours, and the
// mobile address bar takes the page background, so a re-coloured site (an
// orange theme, say) never shows the default blue icon.
const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;
let cmsPaletteLoaded = false; // only remember the icon once the saved palette is on
let cmsSettled = CMS_EDIT_MODE || !window.__cmsContent; // the content request has finished
function updateBrandChrome() {
  if (!cmsSettled) {
    // The saved palette is still on its way and the page shows the default
    // colours: keep the icon remembered from the last visit instead of
    // flashing the default blue.
    try {
      const mode = currentTheme();
      const ic = localStorage.getItem("cms-favicon-" + mode);
      const bar = localStorage.getItem("cms-bar-" + mode);
      if (ic && ic.indexOf("data:image/svg+xml,") === 0) {
        document.querySelector("link[rel~='icon']").setAttribute("href", ic);
        if (bar && HEX_COLOR_RE.test(bar)) document.querySelector("meta[name='theme-color']").setAttribute("content", bar);
        return;
      }
    } catch (e) {}
  }
  const cs = getComputedStyle(root);
  const pick = (name, fallback) => {
    const v = cs.getPropertyValue(name).trim();
    return HEX_COLOR_RE.test(v) ? v : fallback;
  };
  const bg = pick("--accent", "#5c86c4");
  const fg = pick("--on-accent", "#0a1120");
  const bar = pick("--bg", "#07080b");
  const markEl = document.querySelector(".brand-mark");
  const letter = ((markEl && markEl.textContent.trim()) || "S").slice(0, 2);
  const esc = (s) => s.replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  const size = letter.length > 1 ? 46 : 62;
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
    "<rect width='100' height='100' rx='24' fill='" + bg + "'/>" +
    "<text x='50' y='" + (letter.length > 1 ? 66 : 70) + "' font-family='Arial, sans-serif' font-size='" + size +
    "' font-weight='bold' fill='" + fg + "' text-anchor='middle'>" + esc(letter) + "</text></svg>";
  const href = "data:image/svg+xml," + encodeURIComponent(svg);

  const icon = document.querySelector("link[rel~='icon']");
  if (icon && icon.getAttribute("href") !== href) icon.setAttribute("href", href);
  const meta = document.querySelector("meta[name='theme-color']");
  if (meta) meta.setAttribute("content", bar);

  // remembered per mode so the next visit starts with the right icon (the
  // editor preview must not overwrite what visitors' browsers remember)
  if (cmsPaletteLoaded && !CMS_EDIT_MODE) {
    try {
      const mode = currentTheme();
      localStorage.setItem("cms-favicon-" + mode, href);
      localStorage.setItem("cms-bar-" + mode, bar);
    } catch (e) {}
  }
}
setTheme(currentTheme());

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const next = currentTheme() === "light" ? "dark" : "light";
    setTheme(next, { animate: true });
    root.setAttribute("data-theme-source", "user");
    // the admin preview must never overwrite the visitor's own preference
    if (!CMS_EDIT_MODE) {
      try { localStorage.setItem("theme", next); } catch (e) {}
    }
  });
}

// --- content ----------------------------------------------------------------
// Every editable element carries data-k="<section>.<n>". Saved text is limited
// to plain text plus <br>, <strong>, <em>, <b> and <i>. The API sanitises it
// already, and it is cleaned again here before it touches the page.
const CMS_INLINE = { br: 1, strong: 1, em: 1, b: 1, i: 1 };
const CMS_DROP = { script: 1, style: 1, template: 1, svg: 1, iframe: 1, object: 1 };

function cmsClean(html) {
  const tpl = document.createElement("template"); // inert: nothing in it runs or loads
  tpl.innerHTML = String(html == null ? "" : html);
  const out = document.createElement("div");
  (function walk(src, dst) {
    src.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        dst.appendChild(document.createTextNode(n.nodeValue));
      } else if (n.nodeType === 1) {
        const tag = n.nodeName.toLowerCase();
        if (CMS_DROP[tag]) return;
        if (CMS_INLINE[tag]) {
          const el = document.createElement(tag);
          dst.appendChild(el);
          if (tag !== "br") walk(n, el);
        } else if (tag === "div" || tag === "p") {
          // contenteditable wraps new lines in blocks; keep them as line breaks
          if (dst.childNodes.length) dst.appendChild(document.createElement("br"));
          walk(n, dst);
        } else {
          walk(n, dst); // unknown wrapper: keep its text, drop the element
        }
      }
    });
  })(tpl.content, out);
  return out.innerHTML.replace(/(<br>\s*)+$/, "").replace(/^\s*(<br>\s*)+/, "");
}

// Elements can carry decorations added by this script (tech logos inside
// tags). They are marked data-cms-decor and are never part of the text.
function cmsGet(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll("[data-cms-decor]").forEach((d) => d.remove());
  return cmsClean(copy.innerHTML.trim());
}

function cmsSet(el, html) {
  el.innerHTML = cmsClean(html);
  cmsDecorate(el);
}

function cmsDecorate(el) {
  if (el.matches(".tags span") && typeof decorateTag === "function") decorateTag(el);
}

const COLOR_STYLE_ID = "cms-colors";
function cmsApplyColors(colors) {
  let style = document.getElementById(COLOR_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = COLOR_STYLE_ID;
    document.head.appendChild(style);
  }
  const block = (sel, map) => {
    const rules = Object.keys(map || {})
      .filter((k) => /^--[a-z0-9-]+$/.test(k) && /^#[0-9a-f]{6}$/i.test(map[k]))
      .map((k) => k + ": " + map[k] + ";");
    return rules.length ? sel + " { " + rules.join(" ") + " }\n" : "";
  };
  const c = colors || {};
  // same specificity as the stylesheet's own blocks, and later, so these win
  style.textContent = block(":root", c.dark) + block(':root[data-theme="light"]', c.light);
  updateBrandChrome();
}

function cmsApplyText(text) {
  const map = text || {};
  document.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.getAttribute("data-k");
    if (Object.prototype.hasOwnProperty.call(map, k)) cmsSet(el, map[k]);
  });
}

function cmsApplyDefaultTheme(def) {
  if (root.getAttribute("data-theme-source") === "user") return;
  let theme = def;
  if (def === "system") {
    theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  if (theme === "light" || theme === "dark") setTheme(theme);
}

// --- layout: reorder / remove / duplicate repeatable items ------------------
// Repeatable containers carry data-list="<id>", their children data-item="<id>".
// Saved layout = { lists: { listId: [itemId, ...] }, clones: { newId: { from } } }.
// A duplicated item ("clone") is built from a pristine copy of the original
// it was made from; every key/list/item id inside it is prefixed "<newId>~"
// so its text can be edited independently.
const CMS_LINK_RE = /^(https?:\/\/[^\s"'<>]{1,490}|mailto:[^\s"'<>]{1,200}|tel:[0-9+()\- ]{3,30}|#[A-Za-z0-9_-]{1,80}|\/[^\s"'<>]{0,300})$/;
const cmsBase = (id) => String(id).slice(String(id).lastIndexOf("~") + 1);
const cmsPrefix = (id) => {
  const i = String(id).lastIndexOf("~");
  return i < 0 ? "" : String(id).slice(0, i);
};
const cmsSel = (attr, v) => "[" + attr + '="' + String(v).replace(/["\\]/g, "") + '"]';
const cmsItemsOf = (list) => Array.prototype.filter.call(list.children, (c) => c.hasAttribute("data-item"));

// Pristine copies of every item and the original order of every list, taken
// now, before anything (saved layout, logos, animations) touches the page.
const cmsTemplates = {};
const cmsOriginalOrder = {};
document.querySelectorAll("[data-item]").forEach((el) => {
  cmsTemplates[el.getAttribute("data-item")] = el.cloneNode(true);
});
document.querySelectorAll("[data-list]").forEach((list) => {
  cmsOriginalOrder[list.getAttribute("data-list")] = cmsItemsOf(list).map((el) => el.getAttribute("data-item"));
});

function cmsDefaultOrder(listId) {
  const p = cmsPrefix(listId);
  return (cmsOriginalOrder[cmsBase(listId)] || []).map((id) => (p ? p + "~" + id : id));
}

function cmsBuildItem(id, clones) {
  let tplId = id;
  let prefix = "";
  if (clones && Object.prototype.hasOwnProperty.call(clones, id)) {
    tplId = clones[id] && clones[id].from;
    prefix = id;
  } else if (id.indexOf("~") >= 0) {
    prefix = cmsPrefix(id); // an original that lives inside a duplicated item
    tplId = cmsBase(id);
  }
  const tpl = cmsTemplates[tplId];
  if (!tpl) return null;
  const el = tpl.cloneNode(true);
  if (prefix) {
    const remap = (v) => prefix + "~" + cmsBase(v);
    const all = [el].concat(Array.prototype.slice.call(el.querySelectorAll("*")));
    all.forEach((n) => {
      ["data-k", "data-list", "data-item"].forEach((a) => {
        if (n.hasAttribute(a)) n.setAttribute(a, remap(n.getAttribute(a)));
      });
      if (n.id) n.id = n.id + "-" + prefix; // keep ids unique (a duplicated section's anchor)
      if (n.hasAttribute("for")) n.setAttribute("for", n.getAttribute("for") + "-" + prefix);
    });
  }
  el.setAttribute("data-item", id);
  // new elements missed the load-time passes (scroll reveal, tech logos)
  [el].concat(Array.prototype.slice.call(el.querySelectorAll(".reveal"))).forEach((n) => {
    if (n.classList.contains("reveal")) n.classList.add("in");
  });
  if (typeof decorateTag === "function") {
    if (el.matches(".tags span")) decorateTag(el);
    el.querySelectorAll(".tags span").forEach(decorateTag);
  }
  return el;
}

// full: lists the layout doesn't mention go back to their original order
// (the editor uses this; visitors only need the lists that were changed).
function cmsApplyLayout(layout, opts) {
  const lists = (layout && layout.lists) || {};
  const clones = (layout && layout.clones) || {};
  const full = Boolean(opts && opts.full);
  const done = typeof WeakSet === "function" ? new WeakSet() : null;
  if (!done) return;

  // outer lists first; lists inside newly built items show up on the next pass
  for (let pass = 0; pass < 8; pass++) {
    let processed = 0;
    document.querySelectorAll("[data-list]").forEach((list) => {
      if (done.has(list) || !list.isConnected) return;
      done.add(list);
      processed++;
      const id = list.getAttribute("data-list");
      const want = Object.prototype.hasOwnProperty.call(lists, id) ? lists[id] : full ? cmsDefaultOrder(id) : null;
      if (!Array.isArray(want)) return;

      const have = {};
      cmsItemsOf(list).forEach((el) => (have[el.getAttribute("data-item")] = el));
      const next = [];
      const seen = {};
      want.forEach((itemId) => {
        if (typeof itemId !== "string" || seen[itemId]) return;
        seen[itemId] = 1;
        const el = have[itemId] || cmsBuildItem(itemId, clones);
        if (el) next.push(el);
      });

      const cur = cmsItemsOf(list);
      if (cur.length === next.length && cur.every((el, i) => el === next[i])) return;
      while (list.firstChild) list.removeChild(list.firstChild);
      next.forEach((el) => list.appendChild(el));
    });
    if (!processed) break;
  }
  cmsFixProjectGrid();
}

// Projects sit two-up between full-width featured cards. When a run has an
// odd count (after adding/removing projects), the last one goes full width
// instead of leaving a hole beside it.
function cmsFixProjectGrid() {
  document.querySelectorAll(".projects").forEach((grid) => {
    let run = [];
    const flush = () => {
      if (run.length % 2 === 1) run[run.length - 1].classList.add("project-full");
      run = [];
    };
    Array.prototype.forEach.call(grid.children, (card) => {
      card.classList.remove("project-full");
      if (!card.classList.contains("project")) return;
      if (card.classList.contains("project-featured")) flush();
      else run.push(card);
    });
    flush();
  });
}
cmsFixProjectGrid();

function cmsApplyLinks(links) {
  const map = links || {};
  Object.keys(map).forEach((k) => {
    const v = map[k];
    if (typeof v !== "string" || !CMS_LINK_RE.test(v)) return;
    const el = document.querySelector(cmsSel("data-k", k));
    const a = el && el.closest("a");
    if (a) a.setAttribute("href", v);
  });
}

function cmsApply(data) {
  if (!data || typeof data !== "object") return;
  cmsApplyColors(data.colors);
  cmsApplyLayout(data.layout);
  cmsApplyText(data.text);
  cmsApplyLinks(data.links);
  cmsApplyDefaultTheme(data.defaultTheme);
  cmsPaletteLoaded = true;
  updateBrandChrome(); // after the logo letter and theme are final
}

// the admin preview drives the page through this
window.__cms = {
  editMode: CMS_EDIT_MODE,
  clean: cmsClean,
  get: cmsGet,
  set: cmsSet,
  applyColors: cmsApplyColors,
  applyLayout: cmsApplyLayout,
  buildItem: cmsBuildItem,
  defaultOrder: cmsDefaultOrder,
  itemsOf: cmsItemsOf,
  base: cmsBase,
  prefix: cmsPrefix,
  linkRe: CMS_LINK_RE,
  setTheme: (t) => setTheme(t),
  currentTheme,
};

if (!CMS_EDIT_MODE && window.__cmsContent) {
  window.__cmsContent
    .then((data) => {
      cmsSettled = true;
      try {
        cmsApply(data);
      } catch (e) {
        console.error("Could not apply saved content", e);
      }
      // no palette arrived (API down): match the icon to the colours shown,
      // without overwriting the remembered one
      if (!cmsPaletteLoaded) updateBrandChrome();
    })
    .finally(() => root.classList.remove("cms-pending"));
}

// --- sticky nav background on scroll ---
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// --- mobile menu ---
const toggle = document.getElementById("navToggle");
const links = document.getElementById("navLinks");

toggle.addEventListener("click", () => {
  const open = links.classList.toggle("open");
  toggle.setAttribute("aria-expanded", String(open));
});

links.addEventListener("click", (e) => {
  if (e.target.tagName === "A") {
    links.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }
});

// --- scroll reveal -------------------------------------------------------
// Two independent triggers so a section can never get stuck invisible:
// an IntersectionObserver for smoothness, plus a scroll/resize sweep that
// catches anything the observer misses (fast scrolling, anchor jumps,
// orientation changes, browsers that throttle observers).
const revealables = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

let io = null;
if ("IntersectionObserver" in window) {
  io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      });
    },
    { threshold: 0, rootMargin: "0px 0px -8% 0px" }
  );
  revealables.forEach((el) => io.observe(el));
}

let ticking = false;
function sweep() {
  ticking = false;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  revealables.forEach((el) => {
    if (el.classList.contains("in")) return;
    const r = el.getBoundingClientRect();
    if (r.top < vh * 0.92 && r.bottom > -1) {
      el.classList.add("in");
      if (io) io.unobserve(el);
    }
  });
}
function queueSweep() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(sweep);
}

window.addEventListener("scroll", queueSweep, { passive: true });
window.addEventListener("resize", queueSweep);
window.addEventListener("orientationchange", queueSweep);
window.addEventListener("load", sweep);
sweep();

// --- contact form ------------------------------------------------------
// Posts JSON to /api/contact, which relays it through Resend. The form has
// no action/method, so a JS failure can't fire off a broken page navigation.
const contactForm = document.getElementById("contactForm");

if (contactForm) {
  const statusEl = document.getElementById("cfStatus");
  const submitBtn = document.getElementById("cfSubmit");
  const submitLabel = submitBtn.querySelector(".cf-label");

  const setStatus = (message, kind) => {
    statusEl.textContent = message;
    statusEl.className = kind ? "form-status is-" + kind : "form-status";
  };

  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    // let the browser surface its own required/format messages first
    if (!contactForm.reportValidity()) return;

    const payload = {};
    new FormData(contactForm).forEach((value, key) => {
      payload[key] = typeof value === "string" ? value.trim() : value;
    });

    // read at submit time, not page load: the label may be edited from /admin
    const idleLabel = submitLabel.textContent;
    submitBtn.disabled = true;
    submitLabel.textContent = "Sending…";
    setStatus("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong on the way out.");

      contactForm.reset();
      setStatus("Thanks, your message is on its way. I'll get back to you soon.", "ok");
    } catch (err) {
      const detail = err && err.message ? err.message : "Network error.";
      setStatus(detail + " You can also reach me on LinkedIn or email below.", "err");
    } finally {
      submitBtn.disabled = false;
      submitLabel.textContent = idleLabel;
    }
  });
}

// --- footer year ---
document.getElementById("year").textContent = String(new Date().getFullYear());

/* ============================================================
   Motion layer: stagger, scroll progress, section highlighting,
   pointer-tracked light. Everything degrades to a plain static
   page if any of it is unavailable.
   ============================================================ */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// --- stagger ------------------------------------------------------------
// Cards in a grid each get a little more delay than the one before, so a row
// cascades instead of snapping in all at once. Capped, or the last card in a
// long list would visibly lag behind the scroll.
function stagger(containerSel, itemSel, step, cap) {
  document.querySelectorAll(containerSel).forEach((box) => {
    box.querySelectorAll(itemSel).forEach((el, i) => {
      el.style.setProperty("--d", Math.min(i, cap) * step + "ms");
    });
  });
}
stagger(".projects", ".project", 90, 6);
stagger(".certs", ".cert", 80, 6);
stagger(".timeline", ".tl-item", 70, 6);

// Items that aren't themselves .reveal fade in once their container arrives.
function staggerInside(sel, step, cap, base) {
  document.querySelectorAll(sel).forEach((el, i) => {
    el.classList.add("stagger-item");
    el.style.setProperty("--d", (base || 0) + Math.min(i, cap) * step + "ms");
  });
}
staggerInside(".strip-set .chip", 45, 10, 60);
document.querySelectorAll(".skills-grid .skill-col").forEach((col) => {
  col.querySelectorAll("li").forEach((li, i) => {
    li.classList.add("stagger-item");
    li.style.setProperty("--d", 120 + i * 55 + "ms");
  });
});

// --- scroll progress, section highlight, back-to-top --------------------
const scrollBar = document.getElementById("scrollBar");
const toTop = document.getElementById("toTop");
const navLinkEls = Array.prototype.slice.call(document.querySelectorAll(".nav-links a"));
const navTargets = navLinkEls.map((a) => document.querySelector(a.getAttribute("href")));

function onScrollExtras() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  const progress = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;

  if (scrollBar) scrollBar.style.transform = "scaleX(" + progress + ")";
  if (toTop) toTop.classList.toggle("is-visible", window.scrollY > 620);

  // the current section is the last one whose top has passed under the nav
  let active = 0;
  navTargets.forEach((sec, i) => {
    if (sec && sec.getBoundingClientRect().top <= 140) active = i;
  });
  navLinkEls.forEach((a, i) => a.classList.toggle("active", i === active));
}

let extrasTicking = false;
function queueExtras() {
  if (extrasTicking) return;
  extrasTicking = true;
  requestAnimationFrame(() => {
    extrasTicking = false;
    onScrollExtras();
  });
}
window.addEventListener("scroll", queueExtras, { passive: true });
window.addEventListener("resize", queueExtras);
window.addEventListener("load", onScrollExtras);
onScrollExtras();

if (toTop) {
  toTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
  });
}

// --- pointer-tracked light ----------------------------------------------
// Only on devices with a real pointer: on touch this would fire on every tap
// and leave a highlight stuck wherever the finger last was.
if (!reduceMotion.matches && window.matchMedia("(pointer: fine)").matches) {
  const track = (el, xProp, yProp) => {
    let queued = false;
    let px = 0;
    let py = 0;
    el.addEventListener(
      "pointermove",
      (e) => {
        px = e.clientX;
        py = e.clientY;
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          el.style.setProperty(xProp, ((px - r.left) / r.width) * 100 + "%");
          el.style.setProperty(yProp, ((py - r.top) / r.height) * 100 + "%");
        });
      },
      { passive: true }
    );
    el.addEventListener("pointerleave", () => {
      el.style.removeProperty(xProp);
      el.style.removeProperty(yProp);
    });
  };

  document.querySelectorAll(".project, .cert").forEach((card) => track(card, "--mx", "--my"));
  document.querySelectorAll(".hero-card, .contact-card").forEach((card) => track(card, "--hx", "--hy"));
}

/* ============================================================
   Email link, technology logos, interactive hero field
   ============================================================ */

// --- email link ---------------------------------------------------------
// The markup ships a plain mailto:, which is what a phone wants: it hands off
// to the installed mail app. On a desktop a mailto: only works if a mail
// client is actually configured, and silently does nothing when it isn't, so
// there we point at Gmail's compose window in a new tab instead.
const emailLink = document.getElementById("emailLink");
if (emailLink) {
  const address = emailLink.dataset.email || "";
  const isDesktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (isDesktop && address) {
    emailLink.href =
      "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(address);
    emailLink.target = "_blank";
    emailLink.rel = "noopener noreferrer";
    emailLink.title = "Compose an email to " + address;
  } else {
    emailLink.title = address;
  }
}

// --- technology logos ---------------------------------------------------
// Injected rather than hand-written into every tag. Applies to the per-project
// tags only; the tools strip is deliberately left as plain text. Anything not
// in the map keeps its label with no icon.
const TECH_ICONS = {
  "C#": "csharp",
  ".NET / MVC": "dotnet",
  "SQL Server": "sqlserver",
  "MS SQL Server": "sqlserver",
  "Microsoft SQL Server": "sqlserver",
  "Visual Studio": "visualstudio",
  Python: "python",
  Flutter: "flutter",
  "Firebase Auth": "firebase",
  Firestore: "firebase",
  Stripe: "stripe",
  "Google ML Kit": "google",
  "Next.js": "nextjs",
  TypeScript: "typescript",
  Supabase: "supabase",
  "Tailwind CSS": "tailwind",
  Streamlit: "streamlit",
  "Gmail API": "gmail",
  "Gemini API": "gemini",
  "Google Gemini API": "gemini",
  "WhatsApp Cloud API": "whatsapp",
  "Meta WhatsApp Cloud API": "whatsapp",
  Ngrok: "ngrok",
};
const MONO_ICONS = { stripe: 1, whatsapp: 1, ngrok: 1, gmail: 1, gemini: 1, google: 1 };
const SVG_NS = "http://www.w3.org/2000/svg";

// A function so it can run again after a tag's text is edited from /admin:
// the logo follows the label. Marked data-cms-decor so it's never saved as text.
function decorateTag(el) {
  el.querySelectorAll("[data-cms-decor]").forEach((d) => d.remove());
  const id = TECH_ICONS[el.textContent.trim()];
  if (!id) return;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "tech-ico" + (MONO_ICONS[id] ? " ico-" + id : ""));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("data-cms-decor", "");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#i-" + id);
  svg.appendChild(use);
  el.insertBefore(svg, el.firstChild);
}
document.querySelectorAll(".tags span").forEach(decorateTag);

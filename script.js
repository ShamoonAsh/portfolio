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

function cmsApply(data) {
  if (!data || typeof data !== "object") return;
  cmsApplyColors(data.colors);
  cmsApplyText(data.text);
  cmsApplyDefaultTheme(data.defaultTheme);
}

// the admin preview drives the page through this
window.__cms = {
  editMode: CMS_EDIT_MODE,
  clean: cmsClean,
  get: cmsGet,
  set: cmsSet,
  applyColors: cmsApplyColors,
  setTheme: (t) => setTheme(t),
  currentTheme,
};

if (!CMS_EDIT_MODE && window.__cmsContent) {
  window.__cmsContent
    .then((data) => {
      try {
        cmsApply(data);
      } catch (e) {
        console.error("Could not apply saved content", e);
      }
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

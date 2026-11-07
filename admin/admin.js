/* ============================================================
   Site editor (/admin)

   The live site loads in an iframe at /?cms=edit. In that mode the
   site skips applying saved content, so the page shows exactly what
   index.html says. That's how the editor knows each element's
   original text, link and layout. The editor then layers the draft
   on top, and window.__cms (from script.js) does the DOM work.

   Draft shape (same as the server stores):
     text    { key: html }            edited texts
     links   { key: href }            href of the <a> around that text
     layout  { lists: { listId: [itemIds] }, clones: { newId: { from } } }
     colors  { dark: {token: hex}, light: {...} }
     defaultTheme

   Nothing here is a security boundary: every API call is checked on
   the server against the session cookie.
   ============================================================ */

(() => {
  "use strict";

  // Keep in sync with COLOR_TOKENS in api/_lib/content.js
  const COLOR_GROUPS = [
    {
      title: "Page",
      tokens: [
        { token: "--bg", label: "Page background" },
        { token: "--surface", label: "Cards", hint: "Projects, skills, certificates, tools strip" },
        { token: "--surface-2", label: "Card hover" },
      ],
    },
    {
      title: "Text",
      tokens: [
        { token: "--text", label: "Headings & main text" },
        { token: "--text-2", label: "Body text", hint: "About paragraphs, project descriptions" },
        { token: "--muted", label: "Secondary text", hint: "Dates, notes, bullet points" },
      ],
    },
    {
      title: "Accent",
      tokens: [
        { token: "--accent", label: "Accent", hint: "Buttons, pills, highlights" },
        { token: "--on-accent", label: "Text on accent", hint: "Button and pill labels" },
        { token: "--accent-soft", label: "Accent labels", hint: "Section labels, company names" },
      ],
    },
    {
      title: "Hero & contact cards",
      tokens: [
        { token: "--grad-1", label: "Gradient 1", hint: "Top-left (lightest)" },
        { token: "--grad-2", label: "Gradient 2" },
        { token: "--grad-3", label: "Gradient 3" },
        { token: "--grad-4", label: "Gradient 4", hint: "Bottom-right (darkest)" },
      ],
    },
  ];
  const ALL_TOKENS = COLOR_GROUPS.flatMap((g) => g.tokens.map((t) => t.token));
  const THEMES = ["dark", "light"];

  const PRESETS = [
    { name: "Original blue", hex: "#5c86c4", reset: true },
    { name: "Orange", hex: "#f97316" },
    { name: "Red", hex: "#e5484d" },
    { name: "Pink", hex: "#e93d82" },
    { name: "Purple", hex: "#8e4ec6" },
    { name: "Indigo", hex: "#5b5bd6" },
    { name: "Teal", hex: "#12a594" },
    { name: "Green", hex: "#30a46c" },
    { name: "Gold", hex: "#e2a336" },
    { name: "Slate", hex: "#64748b" },
  ];

  const SECTION_NAMES = {
    nav: "Navigation",
    hero: "Hero",
    about: "About",
    projects: "Projects",
    experience: "Experience",
    skills: "Skills",
    contact: "Contact",
    footer: "Footer",
  };
  const KIND_NAMES = { h1: "Heading", h2: "Heading", h3: "Heading", h4: "Heading", p: "Paragraph", li: "List item", a: "Link", label: "Form label" };

  const ICONS = {
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
    dup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  };

  const $ = (id) => document.getElementById(id);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const has = (o, k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
  const emptyContent = () => ({
    version: 1,
    text: {},
    links: {},
    layout: { lists: {}, clones: {} },
    colors: { dark: {}, light: {} },
    defaultTheme: "dark",
  });
  // older saves may lack newer fields
  const withDefaults = (c) => {
    const base = emptyContent();
    const out = Object.assign(base, clone(c || {}));
    out.text = out.text || {};
    out.links = out.links || {};
    out.layout = out.layout || { lists: {}, clones: {} };
    out.layout.lists = out.layout.lists || {};
    out.layout.clones = out.layout.clones || {};
    out.colors = out.colors || { dark: {}, light: {} };
    THEMES.forEach((t) => (out.colors[t] = out.colors[t] || {}));
    return out;
  };

  const state = {
    saved: emptyContent(),
    draft: emptyContent(),
    updatedAt: null,
    originals: {}, // key -> original html, captured from the untouched page
    origHrefs: {}, // key -> original href of the <a> around it
    meta: {}, // key -> { kind }
    defaults: { dark: {}, light: {} }, // token -> stylesheet value per theme
    previewTheme: "dark",
    editing: null, // element being edited in the preview
    editStart: "",
    sel: { key: null, item: null }, // what the Selected card shows
    saving: false,
    editorOpen: false,
  };

  const frame = $("preview");
  let win = null; // iframe window
  let doc = null; // iframe document
  let cms = null; // iframe window.__cms

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------
  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch(path, {
      method: o.method || "GET",
      headers: o.body ? { "Content-Type": "application/json" } : {},
      body: o.body ? JSON.stringify(o.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      /* empty or non-JSON body */
    }
    if (!res.ok) {
      const err = new Error(data.error || "Request failed (" + res.status + ").");
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  function htmlToText(html) {
    const t = document.createElement("template");
    t.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n");
    return t.content.textContent;
  }

  function normalizeHex(value) {
    let v = String(value || "").trim().toLowerCase();
    if (v && v[0] !== "#") v = "#" + v;
    if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return /^#[0-9a-f]{6}$/.test(v) ? v : null;
  }

  let toastTimer = null;
  function toast(message, kind) {
    const el = $("toast");
    el.textContent = message;
    el.className = "toast" + (kind === "error" ? " is-error" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), kind === "error" ? 7000 : 3800);
  }

  const base = (id) => String(id).slice(String(id).lastIndexOf("~") + 1);
  const prefixOf = (id) => {
    const i = String(id).lastIndexOf("~");
    return i < 0 ? "" : String(id).slice(0, i);
  };
  const sel = (attr, v) => "[" + attr + '="' + String(v).replace(/["\\]/g, "") + '"]';

  function newCloneId() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let id = "n";
    bytes.forEach((b) => (id += chars[b % chars.length]));
    return has(state.draft.layout.clones, id) ? newCloneId() : id;
  }

  // originals for keys inside a duplicate come from the item it was copied from
  const origFor = (key) => (has(state.originals, key) ? state.originals[key] : state.originals[base(key)] || "");
  const origHrefFor = (key) => (has(state.origHrefs, key) ? state.origHrefs[key] : state.origHrefs[base(key)]);
  const currentText = (key) => (has(state.draft.text, key) ? state.draft.text[key] : origFor(key));
  const currentHref = (key) => (has(state.draft.links, key) ? state.draft.links[key] : origHrefFor(key));

  function keyLabel(key) {
    const b = base(key);
    const m = state.meta[b];
    const section = SECTION_NAMES[b.split(".")[0]] || b.split(".")[0];
    return m ? section + " · " + m.kind : section;
  }

  // ------------------------------------------------------------------
  // dirty tracking
  // ------------------------------------------------------------------
  function diffKeys(a, b) {
    let n = 0;
    new Set(Object.keys(a || {}).concat(Object.keys(b || {}))).forEach((k) => {
      if (JSON.stringify((a || {})[k]) !== JSON.stringify((b || {})[k])) n++;
    });
    return n;
  }

  function changeCount() {
    const a = state.draft;
    const b = state.saved;
    let n = diffKeys(a.text, b.text) + diffKeys(a.links, b.links) + diffKeys(a.layout.lists, b.layout.lists);
    if (JSON.stringify(a.layout.clones) !== JSON.stringify(b.layout.clones) && diffKeys(a.layout.lists, b.layout.lists) === 0) n++;
    THEMES.forEach((t) => (n += diffKeys(a.colors[t], b.colors[t])));
    if (a.defaultTheme !== b.defaultTheme) n++;
    return n;
  }

  function setStatus(kind, text) {
    const el = $("status");
    el.dataset.state = kind;
    el.textContent = text;
  }

  function updateDirty() {
    const n = changeCount();
    $("saveBtn").disabled = n === 0 || state.saving;
    $("discardBtn").disabled = n === 0 || state.saving;
    if (state.saving) return;
    if (n === 0) setStatus("saved", "All changes saved");
    else setStatus("dirty", n === 1 ? "1 unsaved change" : n + " unsaved changes");
  }

  window.addEventListener("beforeunload", (e) => {
    if (state.editorOpen && changeCount() > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ------------------------------------------------------------------
  // auth
  // ------------------------------------------------------------------
  function showLogin(opts) {
    const o = opts || {};
    const login = $("login");
    login.hidden = false;
    login.classList.toggle("is-overlay", Boolean(o.overlay));
    $("loginSub").textContent = o.message || "Sign in to edit your portfolio.";
    $("loginError").textContent = "";

    const cfgBox = $("loginConfig");
    const c = o.configured;
    const missing = [];
    if (c) {
      if (!c.credentials) missing.push("<code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code>");
      if (!c.sessionSecret) missing.push("<code>ADMIN_SESSION_SECRET</code> (32+ random characters)");
      if (!c.database) missing.push("Upstash Redis (<code>KV_REST_API_URL</code> + <code>KV_REST_API_TOKEN</code>)");
    }
    cfgBox.hidden = missing.length === 0;
    cfgBox.innerHTML = missing.length
      ? "The server isn't fully set up yet. Missing in Vercel:<ul><li>" + missing.join("</li><li>") +
        "</li></ul>Add them, then redeploy."
      : "";

    setTimeout(() => ($("loginUser").value ? $("loginPass") : $("loginUser")).focus(), 30);
  }

  $("pwToggle").addEventListener("click", () => {
    const input = $("loginPass");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    $("pwToggle").textContent = show ? "Hide" : "Show";
    $("pwToggle").setAttribute("aria-label", show ? "Hide password" : "Show password");
  });

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("loginBtn");
    const err = $("loginError");
    const username = $("loginUser").value.trim();
    const password = $("loginPass").value;
    if (!username || !password) {
      err.textContent = "Enter your username and password.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Signing in…";
    err.textContent = "";
    try {
      await api("/api/admin/auth", { method: "POST", body: { username, password } });
      $("loginPass").value = "";
      $("login").hidden = true;
      if (state.editorOpen) {
        toast("Signed in again. You can save now.");
        updateDirty();
      } else {
        await openEditor();
      }
    } catch (ex) {
      err.textContent = ex.message;
      $("loginPass").select();
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    if (changeCount() > 0 && !confirm("You have unsaved changes. Log out and lose them?")) return;
    try {
      await api("/api/admin/auth", { method: "DELETE" });
    } catch (e) {
      /* the cookie expires on its own anyway */
    }
    state.editorOpen = false;
    location.reload();
  });

  // ------------------------------------------------------------------
  // editor bootstrap
  // ------------------------------------------------------------------
  async function openEditor() {
    let content;
    try {
      content = await api("/api/admin/content");
    } catch (e) {
      if (e.status === 401) return showLogin();
      $("boot").hidden = true;
      $("app").hidden = false;
      setStatus("error", "Couldn't load content");
      toast(e.message, "error");
      return;
    }
    state.saved = withDefaults(content.data);
    state.draft = clone(state.saved);
    state.updatedAt = content.updatedAt || null;
    state.previewTheme = state.draft.defaultTheme === "light" ? "light" : "dark";
    state.editorOpen = true;

    $("boot").hidden = true;
    $("app").hidden = false;
    $("defaultTheme").value = state.draft.defaultTheme;
    syncThemeSeg();
    syncBrandInputs();
    syncFavicon();
    updateDirty();

    frame.addEventListener("load", setupFrame);
    frame.src = "/?cms=edit";
  }

  function setupFrame() {
    try {
      win = frame.contentWindow;
      doc = frame.contentDocument;
      cms = win && win.__cms;
    } catch (e) {
      cms = null;
    }
    if (!cms || !doc || !cms.applyLayout) {
      toast("The preview navigated away from the site. Reloading it.", "error");
      setTimeout(() => (frame.src = "/?cms=edit"), 1200);
      return;
    }

    state.editing = null;
    state.originals = {};
    state.origHrefs = {};
    state.meta = {};
    doc.querySelectorAll("[data-k]").forEach((el) => {
      const key = el.getAttribute("data-k");
      state.originals[key] = cms.get(el);
      state.meta[key] = { kind: KIND_NAMES[el.tagName.toLowerCase()] || "Text" };
      const a = el.closest("a");
      if (a) state.origHrefs[key] = a.getAttribute("href");
    });

    captureDefaults();
    injectEditorStyles();
    // show every section straight away instead of waiting for scroll reveals
    doc.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
    wireFrame();

    renderPreview();
    renderAllPanels();
    renderColorList();
  }

  // the stylesheet's own value of every token, per theme, with no overrides
  function captureDefaults() {
    const rootEl = doc.documentElement;
    const before = cms.currentTheme();
    cms.applyColors({});
    THEMES.forEach((theme) => {
      cms.setTheme(theme);
      const cs = win.getComputedStyle(rootEl);
      state.defaults[theme] = {};
      ALL_TOKENS.forEach((t) => {
        state.defaults[theme][t] = normalizeHex(cs.getPropertyValue(t)) || "#000000";
      });
    });
    cms.setTheme(before);
  }

  function injectEditorStyles() {
    const style = doc.createElement("style");
    style.textContent = [
      "[data-k]{cursor:text;outline:1.5px dashed transparent;outline-offset:3px;border-radius:3px;transition:outline-color .15s}",
      "[data-k]:hover{outline-color:rgba(92,134,196,.9)}",
      "[data-k].cms-changed{outline-color:rgba(245,166,35,.85)}",
      "[data-k].cms-editing{outline:2px solid #5c86c4!important;background:rgba(92,134,196,.14);caret-color:currentColor}",
      "[data-k]:empty::before{content:'(hidden, click to add text)';opacity:.5;font-style:italic;font-weight:400;font-size:12px}",
      "[data-item]{cursor:pointer}",
      "[data-item].cms-sel-item{outline:2px solid rgba(245,166,35,.95)!important;outline-offset:4px}",
      ".cms-flash{animation:cmsFlash 1.4s ease}",
      "@keyframes cmsFlash{0%,100%{box-shadow:0 0 0 0 rgba(245,166,35,0)}25%{box-shadow:0 0 0 6px rgba(245,166,35,.55)}}",
    ].join("\n");
    doc.head.appendChild(style);
  }

  // ------------------------------------------------------------------
  // preview <-> draft
  // ------------------------------------------------------------------
  // The editor takes the site's look: its light/dark mode and accent colours.
  // mode: "dark" | "light" | null (null = follow the device); pick(token) -> hex | null
  function applyAdminChrome(mode, pick) {
    const rootEl = document.documentElement;
    if (mode === "dark" || mode === "light") rootEl.setAttribute("data-theme", mode);
    else rootEl.removeAttribute("data-theme");
    const set = (name, value) => (value ? rootEl.style.setProperty(name, value) : rootEl.style.removeProperty(name));
    const ok = (v) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
    const accent = ok(pick("--accent"));
    set("--accent", accent);
    set("--accent-ink", accent ? ok(pick("--on-accent")) : null);
    set("--accent-soft", accent ? "color-mix(in srgb, " + accent + " 13%, transparent)" : null);
    const g1 = ok(pick("--grad-1"));
    const g3 = ok(pick("--grad-3"));
    const g4 = ok(pick("--grad-4"));
    set("--mark-grad", g1 && g3 && g4 ? "linear-gradient(155deg, " + g1 + ", " + g3 + " 62%, " + g4 + ")" : null);
  }

  // In the editor: follow the preview's mode and the draft palette (each
  // accent is tuned for its own mode's background, so it reads well here too).
  // The tab icon mirrors the preview's palette-coloured favicon.
  function syncFavicon() {
    const mode = state.previewTheme;
    const ready = Object.keys(state.defaults[mode] || {}).length > 0;
    applyAdminChrome(mode, (t) => (ready ? colorValue(mode, t) : (state.draft.colors[mode] || {})[t] || null));
    if (!doc) return;
    const src = doc.querySelector("link[rel~='icon']");
    const mine = document.querySelector("link[rel~='icon']");
    if (src && mine && mine.getAttribute("href") !== src.getAttribute("href")) mine.setAttribute("href", src.getAttribute("href"));
  }

  const elFor = (key) => (doc ? doc.querySelector(sel("data-k", key)) : null);
  const itemEl = (id) => (doc && id ? doc.querySelector(sel("data-item", id)) : null);

  function renderPreview() {
    if (!cms) return;
    cms.applyLayout(state.draft.layout, { full: true });
    doc.querySelectorAll("[data-k]").forEach((el) => {
      const key = el.getAttribute("data-k");
      el.classList.toggle("cms-changed", has(state.draft.text, key) || has(state.draft.links, key));
      if (el !== state.editing) {
        const want = currentText(key);
        if (cms.get(el) !== want) cms.set(el, want);
      }
      const a = el.closest("a");
      const href = currentHref(key);
      if (a && typeof href === "string" && a.getAttribute("href") !== href) a.setAttribute("href", href);
    });
    cms.applyColors(state.draft.colors);
    syncFavicon();
    cms.setTheme(state.previewTheme);
    markSelectedItem();
    syncFavicon();
  }

  function markSelectedItem() {
    if (!doc) return;
    doc.querySelectorAll(".cms-sel-item").forEach((el) => el.classList.remove("cms-sel-item"));
    const el = itemEl(state.sel.item);
    if (el) el.classList.add("cms-sel-item");
  }

  function select(key, itemId) {
    state.sel = { key: key || null, item: itemId || null };
    markSelectedItem();
    renderSelected();
  }

  function wireFrame() {
    doc.addEventListener(
      "click",
      (e) => {
        const target = e.target instanceof win.Element ? e.target : e.target.parentElement;
        if (!target) return;

        const el = target.closest("[data-k]");
        if (el) {
          // never follow a link or press a button while editing its label
          e.preventDefault();
          e.stopPropagation();
          if (state.editing !== el) startEdit(el, e);
          return;
        }

        const link = target.closest("a[href]");
        if (link && !(link.getAttribute("href") || "").startsWith("#")) e.preventDefault();

        // the site's own theme button: keep the Colours tab in step
        if (target.closest("#themeToggle")) {
          setTimeout(() => {
            state.previewTheme = cms.currentTheme();
            syncThemeSeg();
            renderColorList();
            syncFavicon();
          }, 0);
          return;
        }

        // a click on a card/item (not its text) selects the item
        const item = target.closest("[data-item]");
        if (item) {
          e.preventDefault();
          finishEdit();
          select(null, item.getAttribute("data-item"));
          showTab("text");
        }
      },
      true
    );

    // the contact form must not send real mail from the editor
    doc.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        toast("The contact form is disabled in the editor.");
      },
      true
    );

    doc.addEventListener(
      "keydown",
      (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          save();
          return;
        }
        const el = state.editing;
        if (!el) return;
        if (e.key === "Escape") {
          e.preventDefault();
          el.innerHTML = state.editStart;
          onEditInput();
          finishEdit();
        } else if (e.key === "Enter") {
          e.preventDefault();
          doc.execCommand("insertLineBreak");
        }
      },
      true
    );

    // paste and drop as plain text only, never someone else's markup
    doc.addEventListener(
      "paste",
      (e) => {
        if (!state.editing) return;
        e.preventDefault();
        const text = (e.clipboardData || win.clipboardData).getData("text/plain");
        doc.execCommand("insertText", false, text.replace(/\r\n?/g, "\n"));
      },
      true
    );
    doc.addEventListener("drop", (e) => state.editing && e.preventDefault(), true);

    doc.addEventListener(
      "input",
      (e) => {
        if (state.editing && (e.target === state.editing || state.editing.contains(e.target))) onEditInput();
      },
      true
    );

    doc.addEventListener("focusout", (e) => {
      if (state.editing && e.target === state.editing) finishEdit();
    });
  }

  function placeCaret(el, evt) {
    let range = null;
    if (evt && typeof evt.clientX === "number") {
      if (doc.caretRangeFromPoint) {
        range = doc.caretRangeFromPoint(evt.clientX, evt.clientY);
      } else if (doc.caretPositionFromPoint) {
        const pos = doc.caretPositionFromPoint(evt.clientX, evt.clientY);
        if (pos) {
          range = doc.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }
    }
    if (!range || !el.contains(range.startContainer)) {
      range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    const s = win.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }

  function startEdit(el, evt) {
    finishEdit();
    const key = el.getAttribute("data-k");
    const item = el.closest("[data-item]");
    state.editing = el;
    state.editStart = cms.get(el);
    el.innerHTML = state.editStart; // drop decorations (tech logos) while typing
    el.setAttribute("contenteditable", "true");
    el.spellcheck = true;
    el.classList.add("cms-editing");
    el.focus({ preventScroll: true });
    placeCaret(el, evt);
    showTab("text");
    select(key, item ? item.getAttribute("data-item") : null);
  }

  function setText(key, value) {
    if (value === origFor(key)) delete state.draft.text[key];
    else state.draft.text[key] = value;
  }

  function onEditInput() {
    const el = state.editing;
    if (!el) return;
    const key = el.getAttribute("data-k");
    setText(key, cms.clean(el.innerHTML));
    el.classList.toggle("cms-changed", has(state.draft.text, key) || has(state.draft.links, key));
    updateDirty();
    renderChangeList();
    renderSelectedText();
  }

  function finishEdit() {
    const el = state.editing;
    if (!el) return;
    state.editing = null;
    el.removeAttribute("contenteditable");
    el.classList.remove("cms-editing");
    cms.set(el, currentText(el.getAttribute("data-k"))); // normalised + logos back
  }

  function restoreKey(key) {
    if (state.editing && state.editing.getAttribute("data-k") === key) {
      state.editing.innerHTML = origFor(key);
      state.editStart = state.editing.innerHTML;
    }
    delete state.draft.text[key];
    delete state.draft.links[key];
    afterChange();
  }

  function flash(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("cms-flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("cms-flash");
  }

  function afterChange() {
    pruneLayout();
    renderPreview();
    updateDirty();
    renderAllPanels();
  }

  // ------------------------------------------------------------------
  // layout: move / duplicate / remove / restore
  // ------------------------------------------------------------------
  const listIdOf = (list) => list.getAttribute("data-list");
  const orderOf = (list) => cms.itemsOf(list).map((el) => el.getAttribute("data-item"));

  function setOrder(listId, order) {
    const def = cms.defaultOrder(listId);
    const same = order.length === def.length && order.every((v, i) => v === def[i]);
    if (same) delete state.draft.layout.lists[listId];
    else state.draft.layout.lists[listId] = order.slice();
  }

  // Mirrors the server's clean-up: drop duplicates nothing places on the page,
  // and anything (text, links, lists) that belonged to them.
  function pruneLayout() {
    const L = state.draft.layout;
    for (let changed = true; changed; ) {
      changed = false;
      Object.keys(L.lists).forEach((id) => {
        const p = prefixOf(id);
        if (p && !has(L.clones, p)) {
          delete L.lists[id];
          changed = true;
        }
      });
      const placed = new Set();
      Object.keys(L.lists).forEach((id) => L.lists[id].forEach((x) => placed.add(x)));
      Object.keys(L.clones).forEach((id) => {
        if (!placed.has(id)) {
          delete L.clones[id];
          changed = true;
        }
      });
    }
    ["text", "links"].forEach((field) => {
      Object.keys(state.draft[field]).forEach((k) => {
        const p = prefixOf(k);
        if (p && !has(L.clones, p)) delete state.draft[field][k];
      });
    });
  }

  function moveItem(el, dir) {
    finishEdit();
    const list = el.parentElement;
    const order = orderOf(list);
    const id = el.getAttribute("data-item");
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    order.splice(i, 1);
    order.splice(j, 0, id);
    setOrder(listIdOf(list), order);
    afterChange();
    flash(itemEl(id));
  }

  // insideNestedClone: true if node belongs to a duplicate nested within src
  function insideNestedClone(node, src) {
    let it = node.closest("[data-item]");
    while (it && it !== src) {
      if (has(state.draft.layout.clones, it.getAttribute("data-item"))) return true;
      it = it.parentElement ? it.parentElement.closest("[data-item]") : null;
    }
    return false;
  }

  // Record a copy of `src` (as it currently looks) under the new id.
  function copyItemState(src, newId) {
    const L = state.draft.layout;
    const srcId = src.getAttribute("data-item");
    L.clones[newId] = { from: has(L.clones, srcId) ? L.clones[srcId].from : base(srcId) };

    const keyEls = (src.hasAttribute("data-k") ? [src] : []).concat(Array.from(src.querySelectorAll("[data-k]")));
    keyEls.forEach((kel) => {
      if (insideNestedClone(kel, src)) return; // copied by its own recursion
      const k = kel.getAttribute("data-k");
      const nk = newId + "~" + base(k);
      const val = currentText(k);
      if (val !== origFor(nk)) state.draft.text[nk] = val;
      const href = currentHref(k);
      if (typeof href === "string" && href !== origHrefFor(nk)) state.draft.links[nk] = href;
    });

    src.querySelectorAll("[data-list]").forEach((list) => {
      if (insideNestedClone(list, src)) return;
      const order = cms.itemsOf(list).map((child) => {
        const cid = child.getAttribute("data-item");
        if (has(L.clones, cid)) {
          const n2 = newCloneId();
          copyItemState(child, n2);
          return n2;
        }
        return newId + "~" + base(cid);
      });
      setOrder(newId + "~" + base(listIdOf(list)), order);
    });
  }

  function duplicateItem(el) {
    finishEdit();
    const list = el.parentElement;
    const order = orderOf(list);
    const id = el.getAttribute("data-item");
    const newId = newCloneId();
    copyItemState(el, newId);
    order.splice(order.indexOf(id) + 1, 0, newId);
    setOrder(listIdOf(list), order);
    afterChange();
    const fresh = itemEl(newId);
    select(null, newId);
    flash(fresh);
    toast("Copy added below. Click its text to edit it.");
  }

  function removeItem(el) {
    finishEdit();
    const list = el.parentElement;
    const id = el.getAttribute("data-item");
    const isCopy = has(state.draft.layout.clones, id);
    const label = list.getAttribute("data-list-label") || "Item";
    if (isCopy && !confirm("Delete this " + label.toLowerCase() + "? It's a copy you added, so it can't be restored.")) return;
    setOrder(listIdOf(list), orderOf(list).filter((x) => x !== id));
    // select the parent item, if any
    const parent = list.closest("[data-item]");
    select(null, parent ? parent.getAttribute("data-item") : null);
    afterChange();
    toast(isCopy ? label + " deleted." : label + " removed. You can restore it from Removed items.");
  }

  function restoreItem(listId, id) {
    const list = doc.querySelector(sel("data-list", listId));
    if (!list) return;
    const def = cms.defaultOrder(listId);
    const order = orderOf(list);
    const want = def.indexOf(id);
    let at = order.length;
    for (let i = 0; i < order.length; i++) {
      const d = def.indexOf(order[i]);
      if (d > want) {
        at = i;
        break;
      }
    }
    order.splice(at, 0, id);
    setOrder(listId, order);
    afterChange();
    select(null, id);
    flash(itemEl(id));
  }

  // a short name for an item: its own text, else its heading, else its first text
  function itemSnippet(el) {
    const k = el.hasAttribute("data-k")
      ? el
      : el.querySelector(":is(h1, h2, h3, h4)[data-k]:not(:empty)") ||
        el.querySelector("[data-k]:not(:empty)") ||
        el.querySelector("[data-k]");
    if (!k) return "";
    const key = k.getAttribute("data-k");
    return htmlToText(currentText(key)).replace(/\s+/g, " ").trim().slice(0, 60);
  }

  // ------------------------------------------------------------------
  // content panel
  // ------------------------------------------------------------------
  function renderAllPanels() {
    renderSelected();
    renderChangeList();
    renderRemoved();
  }

  function renderSelected() {
    const box = $("selected");
    const keyOk = state.sel.key && elFor(state.sel.key);
    const itemOk = state.sel.item && itemEl(state.sel.item);
    if (!keyOk && !itemOk) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    $("selTextPart").hidden = !keyOk;
    if (keyOk) renderSelectedText();
    renderChain();
  }

  function renderSelectedText() {
    const key = state.sel.key;
    if (!key) return;
    $("selWhere").textContent = keyLabel(key);
    $("selOriginal").textContent = htmlToText(origFor(key)) || "(empty)";
    $("selRestore").disabled = !has(state.draft.text, key) && !has(state.draft.links, key);
    $("selHide").disabled = currentText(key) === "";

    const el = elFor(key);
    const a = el && el.closest("a");
    const field = $("selLinkField");
    field.hidden = !a;
    if (a) {
      const input = $("selLink");
      if (document.activeElement !== input) {
        input.value = currentHref(key) || "";
        input.removeAttribute("aria-invalid");
      }
    }
  }

  $("selRestore").addEventListener("click", () => state.sel.key && restoreKey(state.sel.key));

  $("selHide").addEventListener("click", () => {
    const key = state.sel.key;
    if (!key) return;
    finishEdit();
    setText(key, "");
    afterChange();
    toast("Hidden. On the live site the space closes up. Click the placeholder to add text again.");
  });

  $("selLink").addEventListener("input", () => {
    const key = state.sel.key;
    if (!key) return;
    const input = $("selLink");
    const v = input.value.trim();
    if (!cms.linkRe.test(v)) {
      input.setAttribute("aria-invalid", "true");
      $("selLinkHint").textContent = "Use https://…, mailto:…, tel:…, #section-id or /path.";
      return;
    }
    input.removeAttribute("aria-invalid");
    $("selLinkHint").textContent = "Where this button or link goes.";
    if (v === origHrefFor(key)) delete state.draft.links[key];
    else state.draft.links[key] = v;
    const el = elFor(key);
    const a = el && el.closest("a");
    if (a) a.setAttribute("href", v);
    if (el) el.classList.toggle("cms-changed", has(state.draft.text, key) || has(state.draft.links, key));
    updateDirty();
    renderChangeList();
    $("selRestore").disabled = !has(state.draft.text, key) && !has(state.draft.links, key);
  });

  function iconBtn(icon, label, onClick, opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn" + (opts && opts.danger ? " danger" : "");
    b.innerHTML = ICONS[icon];
    b.title = label;
    b.setAttribute("aria-label", label);
    b.disabled = Boolean(opts && opts.disabled);
    b.addEventListener("click", onClick);
    return b;
  }

  function renderChain() {
    const ul = $("selChain");
    ul.textContent = "";
    let el = itemEl(state.sel.item);
    const rows = [];
    while (el) {
      const list = el.parentElement;
      if (!list || !list.hasAttribute("data-list")) break;
      rows.push({ el, list });
      el = list.parentElement ? list.parentElement.closest("[data-item]") : null;
    }
    $("selStructPart").hidden = rows.length === 0;

    rows.forEach(({ el: item, list }, i) => {
      const order = orderOf(list);
      const id = item.getAttribute("data-item");
      const idx = order.indexOf(id);
      const label = list.getAttribute("data-list-label") || "Item";

      const li = document.createElement("li");
      if (i === 0) li.className = "is-current";

      const name = document.createElement("div");
      name.className = "chain-name";
      name.title = "Show it in the preview";
      const kind = document.createElement("span");
      kind.className = "chain-kind";
      kind.textContent = label + (has(state.draft.layout.clones, id) ? " (copy)" : "") + " · " + (idx + 1) + " of " + order.length;
      const text = document.createElement("span");
      text.className = "chain-text";
      text.textContent = itemSnippet(item) || "(no text)";
      name.append(kind, text);
      if (item.id) {
        const anchor = document.createElement("span");
        anchor.className = "chain-anchor";
        anchor.textContent = "link to it: #" + item.id;
        name.appendChild(anchor);
      }
      name.addEventListener("click", () => {
        select(state.sel.key, id);
        flash(item);
      });

      const btns = document.createElement("div");
      btns.className = "chain-btns";
      btns.append(
        iconBtn("up", "Move " + label.toLowerCase() + " up", () => moveItem(item, -1), { disabled: idx <= 0 }),
        iconBtn("down", "Move " + label.toLowerCase() + " down", () => moveItem(item, 1), { disabled: idx >= order.length - 1 }),
        iconBtn("dup", "Duplicate " + label.toLowerCase(), () => duplicateItem(item), { disabled: item.hasAttribute("data-nodup") }),
        iconBtn("del", "Remove " + label.toLowerCase(), () => removeItem(item), { danger: true })
      );

      li.append(name, btns);
      ul.appendChild(li);
    });
  }

  function renderChangeList() {
    const list = $("changeList");
    const keys = Array.from(new Set(Object.keys(state.draft.text).concat(Object.keys(state.draft.links))));
    const order = Array.from(doc ? doc.querySelectorAll("[data-k]") : []).map((el) => el.getAttribute("data-k"));
    keys.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
    });

    list.textContent = "";
    keys.forEach((key) => {
      const gone = order.length > 0 && order.indexOf(key) < 0;
      const li = document.createElement("li");
      if (gone) li.className = "ch-gone";

      const item = document.createElement("button");
      item.type = "button";
      item.className = "ch-item";
      const where = document.createElement("span");
      where.className = "ch-where";
      where.textContent = keyLabel(key) + (gone ? " (removed from the page)" : "");
      const text = document.createElement("span");
      text.className = "ch-text";
      const t = htmlToText(currentText(key)).replace(/\s+/g, " ");
      text.textContent = (t || "(hidden)") + (has(state.draft.links, key) ? "  →  " + state.draft.links[key] : "");
      item.append(where, text);
      item.addEventListener("click", () => {
        const el = elFor(key);
        if (!el) return;
        const it = el.closest("[data-item]");
        select(key, it ? it.getAttribute("data-item") : null);
        flash(el);
      });

      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "ch-reset";
      reset.title = "Restore original";
      reset.setAttribute("aria-label", "Restore original text");
      reset.textContent = "↺";
      reset.addEventListener("click", () => restoreKey(key));

      li.append(item, reset);
      list.appendChild(li);
    });

    $("changeCount").textContent = String(keys.length);
    $("changeEmpty").hidden = keys.length > 0;
    $("restoreAllText").hidden = keys.length === 0;
  }

  $("restoreAllText").addEventListener("click", () => {
    if (!confirm("Restore every edited text and link to what's in index.html? (Nothing is saved until you press Save.)")) return;
    finishEdit();
    state.draft.text = {};
    state.draft.links = {};
    afterChange();
  });

  function renderRemoved() {
    const ul = $("removedList");
    ul.textContent = "";
    let count = 0;
    if (doc) {
      doc.querySelectorAll("[data-list]").forEach((list) => {
        const listId = listIdOf(list);
        const present = new Set(orderOf(list));
        cms.defaultOrder(listId).forEach((id) => {
          if (present.has(id)) return;
          count++;
          const label = list.getAttribute("data-list-label") || "Item";
          const tmp = cms.buildItem(id, state.draft.layout.clones);
          const snippet = tmp ? itemSnippet(tmp) : id;
          const owner = list.closest("[data-item]");

          const li = document.createElement("li");
          const info = document.createElement("div");
          info.className = "ch-item";
          const where = document.createElement("span");
          where.className = "ch-where";
          where.textContent = label + (owner && owner.closest("[data-list]") !== list ? " in “" + itemSnippet(owner).slice(0, 30) + "”" : "");
          const text = document.createElement("span");
          text.className = "ch-text";
          text.textContent = snippet || "(no text)";
          info.append(where, text);

          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ch-reset";
          btn.title = "Restore";
          btn.setAttribute("aria-label", "Restore " + label.toLowerCase());
          btn.textContent = "↺";
          btn.addEventListener("click", () => restoreItem(listId, id));

          li.append(info, btn);
          ul.appendChild(li);
        });
      });
    }
    $("removedCount").textContent = String(count);
    $("removedEmpty").hidden = count > 0;
    const layoutChanged = Object.keys(state.draft.layout.lists).length > 0;
    $("resetLayout").hidden = !layoutChanged;
  }

  $("resetLayout").addEventListener("click", () => {
    if (!confirm("Put every section and item back in its original place, and delete all copies you added? (Nothing is saved until you press Save.)")) return;
    finishEdit();
    state.draft.layout = { lists: {}, clones: {} };
    select(null, null);
    afterChange();
  });

  // ------------------------------------------------------------------
  // colours panel
  // ------------------------------------------------------------------
  function syncThemeSeg() {
    $("themeSeg")
      .querySelectorAll("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === state.previewTheme)));
  }

  $("themeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-theme]");
    if (!b) return;
    state.previewTheme = b.dataset.theme;
    syncThemeSeg();
    if (cms) cms.setTheme(state.previewTheme);
    syncFavicon();
    renderColorList();
  });

  $("defaultTheme").addEventListener("change", (e) => {
    state.draft.defaultTheme = e.target.value;
    updateDirty();
  });

  function colorValue(theme, token) {
    return (state.draft.colors[theme] || {})[token] || state.defaults[theme][token] || "#000000";
  }

  function setColor(theme, token, hex) {
    const map = (state.draft.colors[theme] = state.draft.colors[theme] || {});
    if (!hex || hex === state.defaults[theme][token]) delete map[token];
    else map[token] = hex;
    if (cms) cms.applyColors(state.draft.colors);
    syncFavicon();
    updateDirty();
  }

  function renderColorList() {
    const theme = state.previewTheme;
    const host = $("colorList");
    host.textContent = "";

    COLOR_GROUPS.forEach((group) => {
      const g = document.createElement("div");
      g.className = "color-group";
      const h = document.createElement("h3");
      h.textContent = group.title;
      g.appendChild(h);

      group.tokens.forEach((t) => {
        const id = "c" + t.token.replace(/[^a-z0-9]/g, "-");
        const row = document.createElement("div");
        row.className = "color-row";

        const picker = document.createElement("input");
        picker.type = "color";
        picker.id = id;

        const name = document.createElement("div");
        name.className = "color-name";
        const label = document.createElement("label");
        label.htmlFor = id;
        label.textContent = t.label;
        name.appendChild(label);
        if (t.hint) {
          const small = document.createElement("small");
          small.textContent = t.hint;
          name.appendChild(small);
        }

        const hex = document.createElement("input");
        hex.type = "text";
        hex.className = "hex";
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.setAttribute("aria-label", t.label + " hex value");

        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "c-reset";
        reset.title = "Restore default";
        reset.setAttribute("aria-label", "Restore default " + t.label);
        reset.textContent = "↺";

        const mark = () => row.classList.toggle("is-changed", Boolean((state.draft.colors[theme] || {})[t.token]));
        const sync = () => {
          const v = colorValue(theme, t.token);
          picker.value = v;
          hex.value = v;
          hex.removeAttribute("aria-invalid");
          mark();
        };

        picker.addEventListener("input", () => {
          setColor(theme, t.token, picker.value.toLowerCase());
          hex.value = picker.value.toLowerCase();
          mark();
        });
        hex.addEventListener("input", () => {
          const v = normalizeHex(hex.value);
          if (!v) {
            hex.setAttribute("aria-invalid", "true");
            return;
          }
          hex.removeAttribute("aria-invalid");
          picker.value = v;
          setColor(theme, t.token, v);
          mark();
        });
        hex.addEventListener("blur", sync);
        reset.addEventListener("click", () => {
          setColor(theme, t.token, null);
          sync();
        });

        row.append(picker, name, hex, reset);
        g.appendChild(row);
        sync();
      });

      host.appendChild(g);
    });
  }

  $("restoreColors").addEventListener("click", () => {
    state.draft.colors[state.previewTheme] = {};
    if (cms) cms.applyColors(state.draft.colors);
    syncFavicon();
    renderColorList();
    renderSwatches();
    updateDirty();
  });

  // ---- theme from one colour ------------------------------------------
  // Builds both palettes around one hue, keeping the proportions of the
  // original blue design (near-black tinted backgrounds, light tinted text,
  // a saturated gradient), and nudging lightness until each pairing meets
  // its contrast target, so any colour gives readable text.
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  function luminance(hex) {
    const c = rgbOf(hex).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function hexToHsl(hex) {
    const [r, g, b] = rgbOf(hex);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hsl(h, s, l) {
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  }
  // move lightness in `dir` until the colour reaches `min` contrast against `bg`
  function fit(h, s, l, bg, min, dir) {
    let hex = hsl(h, s, l);
    for (let i = 0; i < 100 && contrast(hex, bg) < min; i++) {
      l += dir * 0.01;
      hex = hsl(h, s, l);
    }
    return hex;
  }

  function generatePalettes(baseHex) {
    const [H, S, L] = hexToHsl(baseHex);
    const cs = (v) => Math.max(0, Math.min(0.9, v));
    const t = Math.min(S, 0.5) * 0.5; // tint strength for the neutrals
    const grad = {
      "--grad-1": fit(H, cs(S * 0.82), 0.47, "#ffffff", 3, -1),
      "--grad-2": fit(H, cs(S * 0.9), 0.39, "#ffffff", 3.6, -1),
      "--grad-3": fit(H, cs(S * 0.95), 0.33, "#ffffff", 4.5, -1),
      "--grad-4": hsl(H, cs(S), 0.16),
    };

    const dark = {};
    dark["--bg"] = hsl(H, t, 0.035);
    dark["--surface"] = hsl(H, t, 0.07);
    dark["--surface-2"] = hsl(H, cs(t * 1.15), 0.105);
    dark["--text"] = hsl(H, cs(t * 1.1), 0.955);
    dark["--text-2"] = hsl(H, t * 0.25, 0.78);
    dark["--muted"] = hsl(H, t * 0.4, 0.61);
    dark["--accent"] = fit(H, S, L, dark["--bg"], 4.5, 1);
    dark["--accent-soft"] = fit(H, cs(S * 1.25), Math.max(L, 0.6) + 0.08, dark["--bg"], 7, 1);
    const ink = hsl(H, 0.5, 0.08);
    dark["--on-accent"] = contrast(dark["--accent"], ink) >= contrast(dark["--accent"], "#ffffff") ? ink : "#ffffff";
    Object.assign(dark, grad);

    const light = {};
    light["--bg"] = hsl(H, cs(t * 1.4), 0.97);
    light["--surface"] = "#ffffff";
    light["--surface-2"] = hsl(H, cs(t * 2), 0.95);
    light["--text"] = hsl(H, cs(t * 1.8), 0.09);
    light["--text-2"] = hsl(H, t * 0.7, 0.27);
    light["--muted"] = hsl(H, t * 0.5, 0.41);
    light["--accent"] = fit(H, S, Math.min(L, 0.51), "#ffffff", 4.5, -1);
    light["--accent-soft"] = fit(H, cs(S * 1.1), Math.min(L, 0.41), "#ffffff", 6, -1);
    light["--on-accent"] = "#ffffff";
    Object.assign(light, grad);

    return { dark, light };
  }

  let brandHex = null; // the colour last applied from this card, for the swatch highlight

  function applyBrand(hex, opts) {
    const v = normalizeHex(hex);
    if (!v) return;
    brandHex = v;
    const pal = generatePalettes(v);
    THEMES.forEach((theme) => {
      const map = {};
      ALL_TOKENS.forEach((tok) => {
        if (pal[theme][tok] && pal[theme][tok] !== state.defaults[theme][tok]) map[tok] = pal[theme][tok];
      });
      state.draft.colors[theme] = map;
    });
    if (cms) cms.applyColors(state.draft.colors);
    syncFavicon();
    $("brandColor").value = v;
    if (!(opts && opts.fromHex)) $("brandHex").value = v;
    renderColorList();
    renderSwatches();
    updateDirty();
  }

  function resetBrand() {
    brandHex = null;
    state.draft.colors = { dark: {}, light: {} };
    if (cms) cms.applyColors(state.draft.colors);
    syncFavicon();
    $("brandColor").value = "#5c86c4";
    $("brandHex").value = "#5c86c4";
    renderColorList();
    renderSwatches();
    updateDirty();
  }

  // the picker shows the saved theme colour (the dark accent is the colour the
  // palette was built from), not always the original blue
  function syncBrandInputs() {
    const acc = normalizeHex((state.draft.colors.dark || {})["--accent"]);
    brandHex = acc;
    $("brandColor").value = acc || "#5c86c4";
    $("brandHex").value = acc || "#5c86c4";
    $("brandHex").removeAttribute("aria-invalid");
    renderSwatches();
  }

  function renderSwatches() {
    const host = $("swatches");
    host.textContent = "";
    const noColors = THEMES.every((t) => Object.keys(state.draft.colors[t] || {}).length === 0);
    PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.style.background = p.hex;
      b.title = p.name;
      b.setAttribute("aria-label", p.name);
      b.setAttribute("aria-pressed", String(p.reset ? noColors : brandHex === p.hex));
      b.addEventListener("click", () => (p.reset ? resetBrand() : applyBrand(p.hex)));
      host.appendChild(b);
    });
  }

  $("brandColor").addEventListener("input", (e) => applyBrand(e.target.value));
  $("brandHex").addEventListener("input", (e) => {
    const v = normalizeHex(e.target.value);
    e.target.setAttribute("aria-invalid", v ? "false" : "true");
    if (v) applyBrand(v, { fromHex: true });
  });
  $("brandReset").addEventListener("click", resetBrand);

  // ------------------------------------------------------------------
  // tabs, preview width
  // ------------------------------------------------------------------
  function showTab(name) {
    document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    $("tab-text").hidden = name !== "text";
    $("tab-colors").hidden = name !== "colors";
    $("tab-resume").hidden = name !== "resume";
    $("tab-share").hidden = name !== "share";
    if (name === "resume") loadResume();
    if (name === "share") openShareTab();
  }
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) showTab(b.dataset.tab);
  });

  $("widthSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-width]");
    if (!b) return;
    $("widthSeg")
      .querySelectorAll("button")
      .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("frameWrap").classList.toggle("is-mobile", b.dataset.width === "mobile");
  });

  // ------------------------------------------------------------------
  // resume
  // ------------------------------------------------------------------
  const MAX_RESUME_BYTES = 3 * 1024 * 1024;

  function formatBytes(n) {
    return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  }

  function renderResume(uploaded) {
    if (uploaded) {
      $("resumeName").textContent = uploaded.originalName || "Uploaded PDF";
      const when = uploaded.uploadedAt ? new Date(uploaded.uploadedAt).toLocaleString() : "";
      $("resumeMeta").textContent = "Uploaded " + when + " · " + formatBytes(uploaded.size);
      $("resumeRemove").hidden = false;
      $("dzTitle").textContent = "Replace with a new PDF";
    } else {
      $("resumeName").textContent = "SYED_SHAMOON_ASHRAF_RESUME.pdf";
      $("resumeMeta").textContent = "The PDF in the website's code. Upload one to replace it.";
      $("resumeRemove").hidden = true;
      $("dzTitle").textContent = "Upload a new PDF";
    }
    // bust the browser's cache so "Download current" is current
    $("resumeOpen").href = "/api/resume?t=" + Date.now();
  }

  let resumeLoaded = false;
  async function loadResume(force) {
    if (resumeLoaded && !force) return;
    try {
      const res = await api("/api/admin/resume");
      resumeLoaded = true;
      renderResume(res.uploaded);
    } catch (e) {
      if (e.status === 401) return showLogin({ overlay: true, message: "Your session expired. Sign in again." });
      $("resumeName").textContent = "Couldn't check";
      $("resumeMeta").textContent = e.message;
    }
  }

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsDataURL(file);
    });
  }

  async function uploadResumeFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return toast("Please choose a PDF file.", "error");
    if (file.size > MAX_RESUME_BYTES) return toast("That PDF is over 3 MB. Export a smaller one and try again.", "error");

    const zone = $("dropzone");
    zone.classList.add("is-busy");
    $("dzTitle").textContent = "Uploading…";
    try {
      const dataBase64 = await readAsBase64(file);
      const res = await api("/api/admin/resume", { method: "POST", body: { name: file.name, dataBase64 } });
      renderResume(res.uploaded);
      toast("Resume updated. The Download button now gives this file.");
    } catch (e) {
      if (e.status === 401) showLogin({ overlay: true, message: "Your session expired. Sign in again, then re-upload." });
      else toast(e.message, "error");
      loadResume(true);
    } finally {
      zone.classList.remove("is-busy");
      $("resumeFile").value = "";
    }
  }

  $("resumeFile").addEventListener("change", (e) => uploadResumeFile(e.target.files[0]));

  const dropzone = $("dropzone");
  ["dragenter", "dragover"].forEach((t) =>
    dropzone.addEventListener(t, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-over");
    })
  );
  ["dragleave", "drop"].forEach((t) => dropzone.addEventListener(t, () => dropzone.classList.remove("is-over")));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadResumeFile(e.dataTransfer.files[0]);
  });

  $("resumeRemove").addEventListener("click", async () => {
    if (!confirm("Remove the uploaded resume? The button will go back to the PDF in the website's code.")) return;
    try {
      const res = await api("/api/admin/resume", { method: "DELETE" });
      renderResume(res.uploaded);
      toast("Upload removed.");
    } catch (e) {
      toast(e.message, "error");
    }
  });

  // ------------------------------------------------------------------
  // share banner (link preview image)
  // ------------------------------------------------------------------
  // Drawn on a canvas from what the preview currently shows: theme colours,
  // logo letter, hero headline, location and services. Uploaded on every
  // save; /api/og serves it to WhatsApp, LinkedIn & co.
  const OG_W = 1200;
  const OG_H = 630;

  function frameText(selector) {
    if (!doc) return "";
    const el = doc.querySelector(selector);
    return el ? htmlToText(cms.get(el)).replace(/\s+/g, " ").trim() : "";
  }

  // the public address, from the page's canonical link (correct even when
  // the editor runs on a preview or local URL)
  function siteHost() {
    const link = doc && doc.querySelector('link[rel="canonical"]');
    try {
      return new URL(link.getAttribute("href")).host;
    } catch (e) {
      return location.host;
    }
  }

  function shareData() {
    const mode = state.draft.defaultTheme === "light" ? "light" : "dark";
    const c = (t) => colorValue(mode, t);
    const role = Array.from(doc.querySelectorAll(".hero-title [data-k]"))
      .map((el) => htmlToText(cms.get(el)).trim())
      .filter(Boolean)
      .join(" ");
    const services = Array.from(doc.querySelectorAll(".hero-services [data-item] .lbl"))
      .map((el) => htmlToText(cms.get(el)).trim())
      .filter(Boolean);
    return {
      mode,
      bg: c("--bg"),
      accent: c("--accent"),
      onAccent: c("--on-accent"),
      soft: c("--accent-soft"),
      grad: [c("--grad-1"), c("--grad-2"), c("--grad-3"), c("--grad-4")],
      name: (doc.title || "").split(",")[0].trim() || "Portfolio",
      letter: (frameText(".nav .brand-mark") || "S").slice(0, 2),
      eyebrow: frameText(".hero .eyebrow"),
      role: role || frameText(".hero-side-title"),
      location: frameText(".hero-meta [data-k]"),
      services,
      domain: siteHost(),
    };
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function withAlpha(hex, a) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function mixWhite(hex, amount) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const m = (v) => Math.round(v + (255 - v) * amount);
    return "#" + [m(r), m(g), m(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  // greedy word wrap; returns lines, or null if it needs more than maxLines
  function wrap(ctx, text, maxWidth, maxLines) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const w of words) {
      const next = line ? line + " " + w : w;
      if (ctx.measureText(next).width <= maxWidth || !line) line = next;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth) ? lines : null;
  }

  async function drawShareBanner() {
    const d = shareData();
    try {
      await Promise.all([
        document.fonts.load('700 100px "Poppins"'),
        document.fonts.load('600 30px "Poppins"'),
        document.fonts.load('500 24px "Poppins"'),
        document.fonts.load('500 22px "Inter"'),
      ]);
    } catch (e) {
      /* falls back to the system sans-serif */
    }
    const P = '"Poppins", "Segoe UI", sans-serif';
    const I = '"Inter", "Segoe UI", sans-serif';

    const canvas = document.createElement("canvas");
    canvas.width = OG_W;
    canvas.height = OG_H;
    const ctx = canvas.getContext("2d");
    const spacing = (px) => {
      if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px";
    };

    // page background, then the hero card
    ctx.fillStyle = d.bg;
    ctx.fillRect(0, 0, OG_W, OG_H);
    const M = 28;
    const cw = OG_W - M * 2;
    const ch = OG_H - M * 2;
    rrect(ctx, M, M, cw, ch, 36);
    ctx.save();
    ctx.clip();

    // 155deg linear gradient, like the site's --grad
    const a = (155 * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const len = Math.abs(cw * dx) + Math.abs(ch * dy);
    const cx = M + cw / 2;
    const cy = M + ch / 2;
    const g = ctx.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2);
    [0, 0.3, 0.62, 1].forEach((stop, i) => g.addColorStop(stop, d.grad[i]));
    ctx.fillStyle = g;
    ctx.fillRect(M, M, cw, ch);

    // light from the top-left, shadow massing to the bottom-right (hero-tint)
    const glow = (x, y, r, color) => {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, color);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(M, M, cw, ch);
    };
    glow(M + cw * 0.14, M + ch * 0.06, cw * 0.62, withAlpha(mixWhite(d.soft, 0.45), 0.3));
    glow(M + cw * 1.05, M + ch * 1.0, cw * 0.75, "rgba(0,0,0,0.7)");
    glow(M + cw * 0.99, M + ch * 0.04, cw * 0.5, "rgba(0,0,0,0.35)");
    ctx.restore();

    const X = M + 64;
    const RIGHT = M + cw - 64;

    // brand: mark + name
    rrect(ctx, X, M + 56, 64, 64, 18);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
    ctx.fillStyle = d.grad[3];
    ctx.font = "700 " + (d.letter.length > 1 ? 26 : 34) + "px " + P;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    spacing(0);
    ctx.fillText(d.letter, X + 32, M + 56 + 34);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 30px " + P;
    spacing(-0.6);
    ctx.fillText(d.name, X + 84, M + 56 + 33);

    // location pill, top-right
    if (d.location) {
      ctx.font = "500 21px " + I;
      spacing(0);
      const tw = ctx.measureText(d.location).width;
      const pw = tw + 64;
      const px = RIGHT - pw;
      const py = M + 64;
      rrect(ctx, px, py, pw, 48, 24);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px + 26, py + 24, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#7dff9b";
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(d.location, px + 42, py + 25);
    }

    // eyebrow + headline, fitted to at most two lines
    const maxW = cw - 128;
    let size = 112;
    let lines = null;
    for (; size >= 56; size -= 4) {
      ctx.font = "700 " + size + "px " + P;
      spacing(-size * 0.04);
      lines = wrap(ctx, d.role, maxW, 2);
      if (lines) break;
    }
    if (!lines) lines = [d.role];
    const lineH = size * 0.98;
    // (text is drawn with a middle baseline) keep descenders clear of the divider
    const bottomOfHeadline = M + ch - 96 - size * 0.62;
    let y = bottomOfHeadline - lineH * (lines.length - 1);

    if (d.eyebrow) {
      ctx.font = "500 28px " + P;
      spacing(-0.4);
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.fillText(d.eyebrow, X + 4, y - size * 0.86 - 10);
    }
    ctx.font = "700 " + size + "px " + P;
    spacing(-size * 0.04);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 14;
    lines.forEach((l, i) => ctx.fillText(l, X, y + i * lineH));
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // divider + services + domain pill
    const lineY = M + ch - 96;
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(M, lineY, cw, 1.5);

    ctx.font = "600 21px " + I;
    spacing(0);
    const domainText = d.domain + "  ↗";
    const dw = ctx.measureText(domainText).width + 40;
    const dh = 46;
    const dyPos = lineY + (OG_H - M - lineY - dh) / 2;
    rrect(ctx, RIGHT - dw, dyPos, dw, dh, 23);
    ctx.fillStyle = d.accent;
    ctx.fill();
    ctx.fillStyle = d.onAccent;
    ctx.fillText(domainText, RIGHT - dw + 20, dyPos + dh / 2 + 1);

    ctx.font = "500 23px " + P;
    spacing(-0.3);
    ctx.fillStyle = "#ffffff";
    const room = RIGHT - dw - 40 - X;
    let sx = X;
    for (const s of d.services) {
      const w = ctx.measureText(s).width;
      if (sx + w > X + room) break;
      if (sx > X) {
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillText("·", sx - 22, dyPos + dh / 2 + 1);
        ctx.fillStyle = "#ffffff";
      }
      ctx.fillText(s, sx, dyPos + dh / 2 + 1);
      sx += w + 44;
    }

    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9));
  }

  // "Open live banner" always fetches a fresh copy, never a cached older one
  function bustShareLink() {
    $("shareOpen").href = "/api/og?t=" + Date.now();
  }
  $("shareOpen").addEventListener("click", bustShareLink);

  let shareUrl = null;
  async function renderSharePreview() {
    if (!cms) return null;
    const blob = await drawShareBanner();
    if (!blob) return null;
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    shareUrl = URL.createObjectURL(blob);
    $("shareImg").src = shareUrl;
    return blob;
  }

  async function openShareTab() {
    const meta = (n) => {
      const el = doc && doc.querySelector('meta[property="' + n + '"]');
      return el ? el.getAttribute("content") : "";
    };
    $("shareDomain").textContent = siteHost();
    bustShareLink();
    $("shareTitle").textContent = meta("og:title");
    $("shareDesc").textContent = meta("og:description");
    renderSharePreview();
    try {
      const res = await api("/api/admin/share");
      $("shareStatus").textContent = res.banner
        ? "Live banner last updated " + new Date(res.banner.updatedAt).toLocaleString() + ". The preview above shows your unsaved edits too."
        : "No banner published yet; links show the default banner until you save or publish.";
    } catch (e) {
      $("shareStatus").textContent = "";
    }
  }

  const blobToBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
      r.onerror = () => reject(new Error("Couldn't read the banner image."));
      r.readAsDataURL(blob);
    });

  async function publishShareBanner(opts) {
    if (!cms) return;
    const quiet = opts && opts.quiet;
    try {
      const blob = await drawShareBanner();
      if (!blob) throw new Error("Couldn't draw the banner.");
      const res = await api("/api/admin/share", { method: "PUT", body: { dataBase64: await blobToBase64(blob) } });
      bustShareLink();
      if (!$("tab-share").hidden) {
        $("shareStatus").textContent = "Live banner last updated " + new Date(res.banner.updatedAt).toLocaleString() + ".";
        renderSharePreview();
      }
      if (!quiet) toast("Share banner published.");
    } catch (e) {
      if (e.status === 401) showLogin({ overlay: true, message: "Your session expired. Sign in again." });
      else toast((quiet ? "Saved, but the share banner didn't update: " : "") + e.message, "error");
    }
  }

  $("sharePublish").addEventListener("click", () => {
    if (changeCount() > 0 && !confirm("This publishes the banner with your unsaved edits (colours/text) in it, before you've saved them. Continue?")) return;
    publishShareBanner();
  });

  // ------------------------------------------------------------------
  // save / discard
  // ------------------------------------------------------------------
  async function save() {
    if (state.saving || changeCount() === 0) return;
    pruneLayout();
    state.saving = true;
    setStatus("saving", "Saving…");
    updateDirty();
    const sent = JSON.stringify(state.draft);
    try {
      const res = await api("/api/admin/content", {
        method: "PUT",
        body: { data: state.draft, baseUpdatedAt: state.updatedAt },
      });
      state.saved = withDefaults(res.data);
      state.updatedAt = res.updatedAt;
      // adopt the server's cleaned-up copy, unless editing continued meanwhile
      if (JSON.stringify(state.draft) === sent) {
        state.draft = clone(state.saved);
        renderPreview();
        renderAllPanels();
      }
      toast("Saved. Visitors will see it within about a minute.");
      // the link-preview banner follows the saved colours and hero text
      publishShareBanner({ quiet: true });
    } catch (e) {
      if (e.status === 401) {
        showLogin({ overlay: true, message: "Your session expired. Sign in again to save. Your edits are kept." });
      } else {
        setStatus("error", "Save failed");
        toast(e.message, "error");
      }
    } finally {
      state.saving = false;
      if ($("status").dataset.state !== "error") updateDirty();
      else {
        $("saveBtn").disabled = false;
        $("discardBtn").disabled = false;
      }
    }
  }

  $("saveBtn").addEventListener("click", save);

  $("discardBtn").addEventListener("click", () => {
    if (!confirm("Throw away all unsaved changes?")) return;
    finishEdit();
    state.draft = clone(state.saved);
    $("defaultTheme").value = state.draft.defaultTheme;
    renderPreview();
    renderAllPanels();
    renderColorList();
    syncBrandInputs();
    updateDirty();
  });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && state.editorOpen) {
      e.preventDefault();
      save();
    }
  });

  // ------------------------------------------------------------------
  // start
  // ------------------------------------------------------------------
  // Before login: dress the login screen in the site's saved look. Public,
  // edge-cached data; on failure the screen keeps the default blue.
  async function themeLoginScreen() {
    try {
      const res = await fetch("/api/content", { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const data = await res.json();
      if (state.editorOpen || !data || !data.colors) return;
      const mode =
        data.defaultTheme === "light" || data.defaultTheme === "dark"
          ? data.defaultTheme
          : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
      applyAdminChrome(data.defaultTheme === "system" ? null : mode, (t) => (data.colors[mode] || {})[t] || null);
    } catch (e) {
      /* keep the defaults */
    }
  }

  (async function boot() {
    themeLoginScreen();
    try {
      const s = await api("/api/admin/auth");
      if (s.authenticated) {
        await openEditor();
      } else {
        $("boot").hidden = true;
        showLogin({ configured: s.configured });
      }
    } catch (e) {
      $("boot").hidden = true;
      showLogin({ message: "Couldn't reach the server. Check your connection and reload." });
    }
  })();
})();

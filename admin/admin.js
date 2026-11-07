/* ============================================================
   Site editor (/admin)

   The live site loads in an iframe at /?cms=edit. In that mode the
   site skips applying saved content, so the page shows exactly what
   index.html says. That's how the editor knows each element's
   original text. The editor then layers the draft on top, and
   window.__cms (from script.js) does the actual DOM work.

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

  const $ = (id) => document.getElementById(id);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const emptyContent = () => ({ version: 1, text: {}, colors: { dark: {}, light: {} }, defaultTheme: "dark" });

  const state = {
    saved: emptyContent(),
    draft: emptyContent(),
    updatedAt: null,
    originals: {}, // key -> original html, captured from the untouched page
    meta: {}, // key -> { section, kind }
    defaults: { dark: {}, light: {} }, // token -> stylesheet value per theme
    previewTheme: "dark",
    editing: null, // element being edited in the preview
    editStart: "",
    selectedKey: null,
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

  function keyLabel(key) {
    const m = state.meta[key];
    const section = SECTION_NAMES[key.split(".")[0]] || key.split(".")[0];
    return m ? section + " · " + m.kind : section;
  }

  // ------------------------------------------------------------------
  // dirty tracking
  // ------------------------------------------------------------------
  function changeCount() {
    const a = state.draft;
    const b = state.saved;
    let n = 0;
    new Set(Object.keys(a.text).concat(Object.keys(b.text))).forEach((k) => {
      if (a.text[k] !== b.text[k]) n++;
    });
    THEMES.forEach((t) => {
      const ac = a.colors[t] || {};
      const bc = b.colors[t] || {};
      new Set(Object.keys(ac).concat(Object.keys(bc))).forEach((k) => {
        if (ac[k] !== bc[k]) n++;
      });
    });
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
    state.saved = content.data || emptyContent();
    state.draft = clone(state.saved);
    state.updatedAt = content.updatedAt || null;
    state.previewTheme = state.draft.defaultTheme === "light" ? "light" : "dark";
    state.editorOpen = true;

    $("boot").hidden = true;
    $("app").hidden = false;
    $("defaultTheme").value = state.draft.defaultTheme;
    syncThemeSeg();
    updateDirty();
    renderChangeList();

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
    if (!cms || !doc) {
      toast("The preview navigated away from the site. Reloading it.", "error");
      setTimeout(() => (frame.src = "/?cms=edit"), 1200);
      return;
    }

    state.editing = null;
    state.originals = {};
    state.meta = {};
    doc.querySelectorAll("[data-k]").forEach((el) => {
      const key = el.getAttribute("data-k");
      state.originals[key] = cms.get(el);
      state.meta[key] = { kind: KIND_NAMES[el.tagName.toLowerCase()] || "Text" };
    });

    captureDefaults();
    injectEditorStyles();
    // show every section straight away instead of waiting for scroll reveals
    doc.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
    wireFrame();

    renderPreview();
    renderChangeList();
    renderSelected();
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
      "[data-k]:empty::before{content:'(empty)';opacity:.45;font-style:italic}",
      "[data-k].cms-flash{animation:cmsFlash 1.4s ease}",
      "@keyframes cmsFlash{0%,100%{box-shadow:0 0 0 0 rgba(245,166,35,0)}25%{box-shadow:0 0 0 6px rgba(245,166,35,.55)}}",
    ].join("\n");
    doc.head.appendChild(style);
  }

  // ------------------------------------------------------------------
  // preview <-> draft
  // ------------------------------------------------------------------
  function elFor(key) {
    return doc ? doc.querySelector('[data-k="' + key.replace(/"/g, "") + '"]') : null;
  }

  function renderPreview() {
    if (!cms) return;
    Object.keys(state.originals).forEach((key) => {
      const el = elFor(key);
      if (!el) return;
      const changed = Object.prototype.hasOwnProperty.call(state.draft.text, key);
      el.classList.toggle("cms-changed", changed);
      if (el === state.editing) return;
      const want = changed ? state.draft.text[key] : state.originals[key];
      if (cms.get(el) !== want) cms.set(el, want);
    });
    cms.applyColors(state.draft.colors);
    cms.setTheme(state.previewTheme);
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
          }, 0);
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
    const sel = win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function startEdit(el, evt) {
    finishEdit();
    const key = el.getAttribute("data-k");
    state.editing = el;
    state.selectedKey = key;
    state.editStart = cms.get(el);
    el.innerHTML = state.editStart; // drop decorations (tech logos) while typing
    el.setAttribute("contenteditable", "true");
    el.spellcheck = true;
    el.classList.add("cms-editing");
    el.focus({ preventScroll: true });
    placeCaret(el, evt);
    showTab("text");
    renderSelected();
  }

  function onEditInput() {
    const el = state.editing;
    if (!el) return;
    const key = el.getAttribute("data-k");
    const value = cms.clean(el.innerHTML);
    if (value === state.originals[key]) delete state.draft.text[key];
    else state.draft.text[key] = value;
    el.classList.toggle("cms-changed", Object.prototype.hasOwnProperty.call(state.draft.text, key));
    updateDirty();
    renderChangeList();
    renderSelected();
  }

  function finishEdit() {
    const el = state.editing;
    if (!el) return;
    state.editing = null;
    el.removeAttribute("contenteditable");
    el.classList.remove("cms-editing");
    const key = el.getAttribute("data-k");
    const has = Object.prototype.hasOwnProperty.call(state.draft.text, key);
    cms.set(el, has ? state.draft.text[key] : state.originals[key]); // normalised + logos back
  }

  function restoreKey(key) {
    if (state.editing && state.editing.getAttribute("data-k") === key) {
      state.editing.innerHTML = state.originals[key] || "";
      state.editStart = state.editing.innerHTML;
    }
    delete state.draft.text[key];
    renderPreview();
    updateDirty();
    renderChangeList();
    renderSelected();
  }

  function scrollToKey(key) {
    const el = elFor(key);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("cms-flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("cms-flash");
    state.selectedKey = key;
    renderSelected();
  }

  // ------------------------------------------------------------------
  // text panel
  // ------------------------------------------------------------------
  function renderSelected() {
    const key = state.selectedKey;
    const box = $("selected");
    if (!key || !Object.prototype.hasOwnProperty.call(state.originals, key)) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    $("selWhere").textContent = keyLabel(key);
    $("selOriginal").textContent = htmlToText(state.originals[key]) || "(empty)";
    $("selRestore").disabled = !Object.prototype.hasOwnProperty.call(state.draft.text, key);
  }

  $("selRestore").addEventListener("click", () => state.selectedKey && restoreKey(state.selectedKey));

  function renderChangeList() {
    const list = $("changeList");
    const keys = Object.keys(state.draft.text);
    // page order first, then anything no longer on the page
    const order = Object.keys(state.originals);
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
      where.textContent = gone ? key + " (no longer on the page)" : keyLabel(key);
      const text = document.createElement("span");
      text.className = "ch-text";
      text.textContent = htmlToText(state.draft.text[key]).replace(/\s+/g, " ") || "(empty)";
      item.append(where, text);
      item.addEventListener("click", () => scrollToKey(key));

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
    if (!confirm("Restore every edited text to what's in index.html? (Nothing is saved until you press Save.)")) return;
    finishEdit();
    state.draft.text = {};
    renderPreview();
    updateDirty();
    renderChangeList();
    renderSelected();
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

        const sync = () => {
          const v = colorValue(theme, t.token);
          picker.value = v;
          hex.value = v;
          hex.removeAttribute("aria-invalid");
          row.classList.toggle("is-changed", Boolean((state.draft.colors[theme] || {})[t.token]));
        };

        picker.addEventListener("input", () => {
          setColor(theme, t.token, picker.value.toLowerCase());
          hex.value = picker.value.toLowerCase();
          row.classList.toggle("is-changed", Boolean((state.draft.colors[theme] || {})[t.token]));
        });
        hex.addEventListener("input", () => {
          const v = normalizeHex(hex.value.startsWith("#") ? hex.value : "#" + hex.value);
          if (!v) {
            hex.setAttribute("aria-invalid", "true");
            return;
          }
          hex.removeAttribute("aria-invalid");
          picker.value = v;
          setColor(theme, t.token, v);
          row.classList.toggle("is-changed", Boolean((state.draft.colors[theme] || {})[t.token]));
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
    renderColorList();
    updateDirty();
  });

  // ------------------------------------------------------------------
  // tabs, preview width
  // ------------------------------------------------------------------
  function showTab(name) {
    document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    $("tab-text").hidden = name !== "text";
    $("tab-colors").hidden = name !== "colors";
    $("tab-resume").hidden = name !== "resume";
    if (name === "resume") loadResume();
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
    // bust the browser's cache of the redirect so "Download current" is current
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

  const zone = $("dropzone");
  ["dragenter", "dragover"].forEach((t) =>
    zone.addEventListener(t, (e) => {
      e.preventDefault();
      zone.classList.add("is-over");
    })
  );
  ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, () => zone.classList.remove("is-over")));
  zone.addEventListener("drop", (e) => {
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
  // save / discard
  // ------------------------------------------------------------------
  async function save() {
    if (state.saving || changeCount() === 0) return;
    state.saving = true;
    setStatus("saving", "Saving…");
    updateDirty();
    const sent = JSON.stringify(state.draft);
    try {
      const res = await api("/api/admin/content", {
        method: "PUT",
        body: { data: state.draft, baseUpdatedAt: state.updatedAt },
      });
      state.saved = res.data;
      state.updatedAt = res.updatedAt;
      // adopt the server's cleaned-up copy, unless typing continued meanwhile
      if (JSON.stringify(state.draft) === sent) {
        state.draft = clone(res.data);
        renderPreview();
        renderChangeList();
      }
      toast("Saved. Visitors will see it within about a minute.");
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
    renderChangeList();
    renderSelected();
    renderColorList();
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
  (async function boot() {
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

/* ============================================================
   Portfolio interactions: nav state, mobile menu, scroll reveal
   ============================================================ */

// Content is visible by default; this class is what lets CSS hide .reveal
// elements before they animate in. If JS ever fails, nothing disappears.
document.documentElement.classList.add("js");

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
  const idleLabel = submitLabel.textContent;

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
// Injected rather than hand-written into every chip, so one map covers both
// the tools strip and the per-project tags. Anything not in the map keeps its
// plain text label.
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
  "WhatsApp Cloud API": "whatsapp",
  Ngrok: "ngrok",
};
const MONO_ICONS = { stripe: 1, whatsapp: 1, ngrok: 1, gmail: 1, gemini: 1, google: 1 };
const SVG_NS = "http://www.w3.org/2000/svg";

document.querySelectorAll(".strip-set .chip, .tags span").forEach((el) => {
  const id = TECH_ICONS[el.textContent.trim()];
  if (!id) return;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "tech-ico" + (MONO_ICONS[id] ? " ico-" + id : ""));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#i-" + id);
  svg.appendChild(use);
  el.insertBefore(svg, el.firstChild);
});

// --- interactive hero field ---------------------------------------------
// Drifting points that link up to each other and to wherever the pointer or
// finger is; press to push them outwards. Runs on mouse and touch alike, and
// is skipped entirely for reduced motion.
(function heroField() {
  const canvas = document.getElementById("heroFx");
  const card = document.querySelector(".hero-card");
  if (!canvas || !card || reduceMotion.matches) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  let w = 0;
  let h = 0;
  let dots = [];
  let raf = null;
  let visible = true;

  // pointer target, plus a drifting idle target so the field still moves when
  // nobody is touching it (which is most of the time on a phone)
  const focus = { x: 0, y: 0, active: false };
  let idle = 0;

  const LINK = 132; // px between dots before a line is drawn
  const REACH = 170; // px around the pointer that dots react within

  function resize() {
    const r = card.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // density scales with area, capped so a phone does not do desktop work
    const target = Math.min(Math.round((w * h) / 16000), w < 620 ? 34 : 72);
    dots = [];
    for (let i = 0; i < target; i++) {
      dots.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.7 + 1.3,
      });
    }
  }

  function frame() {
    raf = null;
    if (!visible || !w || !h) return;

    idle += 0.0045;
    const fx = focus.active ? focus.x : w * (0.5 + 0.34 * Math.cos(idle));
    const fy = focus.active ? focus.y : h * (0.5 + 0.26 * Math.sin(idle * 1.35));

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      d.x += d.vx;
      d.y += d.vy;

      // wrap rather than bounce, so there is no edge pile-up
      if (d.x < -12) d.x = w + 12;
      else if (d.x > w + 12) d.x = -12;
      if (d.y < -12) d.y = h + 12;
      else if (d.y > h + 12) d.y = -12;

      // gentle pull toward the focus point
      const dx = fx - d.x;
      const dy = fy - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < REACH && dist > 0.5) {
        const pull = (1 - dist / REACH) * 0.045;
        d.vx += (dx / dist) * pull;
        d.vy += (dy / dist) * pull;
      }

      // friction, or the pull would keep accelerating them
      d.vx *= 0.985;
      d.vy *= 0.985;
      const speed = Math.hypot(d.vx, d.vy);
      if (speed > 1.5) {
        d.vx = (d.vx / speed) * 1.5;
        d.vy = (d.vy / speed) * 1.5;
      }

      const near = dist < REACH ? 1 - dist / REACH : 0;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r + near * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(228, 240, 255," + (0.55 + near * 0.42) + ")";
      ctx.fill();

      if (near > 0.05) {
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(fx, fy);
        ctx.strokeStyle = "rgba(206, 228, 255," + near * 0.55 + ")";
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }

      for (let j = i + 1; j < dots.length; j++) {
        const o = dots[j];
        const lx = o.x - d.x;
        const ly = o.y - d.y;
        const ld = Math.hypot(lx, ly);
        if (ld > LINK) continue;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(o.x, o.y);
        ctx.strokeStyle = "rgba(196, 220, 252," + (1 - ld / LINK) * 0.34 + ")";
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }

    schedule();
  }

  function schedule() {
    if (raf == null && visible) raf = requestAnimationFrame(frame);
  }

  function setFocus(clientX, clientY) {
    const r = card.getBoundingClientRect();
    focus.x = clientX - r.left;
    focus.y = clientY - r.top;
    focus.active = focus.x >= 0 && focus.x <= r.width && focus.y >= 0 && focus.y <= r.height;
    schedule();
  }

  // push everything outwards from a press, so a tap does something visible
  function burst(clientX, clientY) {
    const r = card.getBoundingClientRect();
    const bx = clientX - r.left;
    const by = clientY - r.top;
    dots.forEach((d) => {
      const dx = d.x - bx;
      const dy = d.y - by;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > 210) return;
      const push = (1 - dist / 210) * 3.4;
      d.vx += (dx / dist) * push;
      d.vy += (dy / dist) * push;
    });
    schedule();
  }

  card.addEventListener("pointermove", (e) => setFocus(e.clientX, e.clientY), { passive: true });
  card.addEventListener("pointerdown", (e) => burst(e.clientX, e.clientY), { passive: true });
  card.addEventListener("pointerleave", () => {
    focus.active = false;
  });
  // touchmove as well: once a scroll gesture takes over, pointermove stops
  // arriving but touchmove keeps coming, so the field still tracks the finger
  card.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      if (t) setFocus(t.clientX, t.clientY);
    },
    { passive: true }
  );
  card.addEventListener("touchend", () => {
    focus.active = false;
  });

  window.addEventListener("resize", () => {
    resize();
    schedule();
  });
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    if (visible) schedule();
  });

  // stop drawing once the hero is scrolled past
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting && !document.hidden;
        if (visible) schedule();
      },
      { threshold: 0 }
    ).observe(card);
  }

  resize();
  canvas.classList.add("is-on");
  schedule();
})();

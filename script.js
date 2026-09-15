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
      setStatus("Thanks — your message is on its way. I'll get back to you soon.", "ok");
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

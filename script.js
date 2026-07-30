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

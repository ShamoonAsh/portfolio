/* ============================================================
   POST /api/contact — relays the portfolio contact form to my
   inbox through Resend (https://resend.com).

   Vercel → Project → Settings → Environment Variables:
     RESEND_API_KEY  (required)  re_...
     CONTACT_TO      (optional)  inbox that receives the mail
     CONTACT_FROM    (optional)  verified Resend sender, e.g.
                                 "Portfolio <hello@yourdomain.com>"

   CommonJS on purpose: without a package.json declaring
   "type": "module", Vercel treats .js files as CommonJS.
   ============================================================ */

const MAX = { name: 80, email: 120, subject: 120, message: 4000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value, max) => String(value == null ? "" : value).trim().slice(0, max);

const escapeHtml = (value) =>
  value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set");
    return res.status(500).json({ error: "The contact form isn't configured yet." });
  }

  // Vercel parses JSON bodies for us, but be tolerant of a raw string
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Could not read the form data." });
  }

  const name = clean(body.name, MAX.name);
  const email = clean(body.email, MAX.email);
  const subject = clean(body.subject, MAX.subject);
  const message = clean(body.message, MAX.message);

  // honeypot — a filled "company" field means a bot; answer OK and drop it
  if (clean(body.company, 50)) return res.status(200).json({ ok: true });

  if (!name || !email || !message) {
    return res.status(400).json({ error: "Name, email and message are all required." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "That email address doesn't look right." });
  }

  const to = process.env.CONTACT_TO || "syedshamoon82@gmail.com";
  const from = process.env.CONTACT_FROM || "Portfolio <onboarding@resend.dev>";

  const lines = [
    `Name:    ${name}`,
    `Email:   ${email}`,
    subject ? `Subject: ${subject}` : null,
    "",
    message,
  ].filter((line) => line !== null);

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#111">
      <h2 style="margin:0 0 14px;font-size:18px">New portfolio message</h2>
      <p style="margin:0 0 4px"><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p style="margin:0 0 4px"><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
      ${subject ? `<p style="margin:0 0 4px"><strong>Subject:</strong> ${escapeHtml(subject)}</p>` : ""}
      <hr style="margin:16px 0;border:none;border-top:1px solid #e5e5e5" />
      <p style="margin:0;white-space:pre-wrap">${escapeHtml(message)}</p>
    </div>`;

  try {
    const resend = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: subject ? `Portfolio: ${subject}` : `Portfolio message from ${name}`,
        text: lines.join("\n"),
        html,
      }),
    });

    if (!resend.ok) {
      console.error("Resend responded", resend.status, await resend.text());
      return res.status(502).json({ error: "Couldn't send the message right now." });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Contact form failed", err);
    return res.status(502).json({ error: "Couldn't send the message right now." });
  }
};

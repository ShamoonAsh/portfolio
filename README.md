# Syed Shamoon Ashraf — Portfolio

Static site (`index.html` + `styles.css` + `script.js`) with one serverless
function, `api/contact.js`, that relays the contact form through Resend.

## Deploying to Vercel

1. Push this folder to GitHub, then **Add New… → Project** on Vercel and import it.
2. Framework preset: **Other**. No build command, no output directory —
   Vercel serves the root statically and turns `api/contact.js` into a function.
3. Add the environment variables below (Settings → Environment Variables),
   for **Production, Preview and Development**.
4. Redeploy after adding or changing any variable — envs are baked in at deploy time.

### Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | From resend.com → API Keys (`re_…`). Never commit it. |
| `CONTACT_TO` | no | Inbox that receives the mail. Defaults to `syedshamoon82@gmail.com`. |
| `CONTACT_FROM` | no | Verified Resend sender, e.g. `Portfolio <hello@yourdomain.com>`. Defaults to `onboarding@resend.dev`. |

**On `CONTACT_FROM`:** `onboarding@resend.dev` works out of the box but Resend
only lets it deliver to the email address that owns the Resend account. To
receive at any other address, verify a domain in Resend and set `CONTACT_FROM`
to an address on it.

## Local development

`npm i -g vercel` then `vercel dev` in this folder — that serves the static
files *and* `/api/contact`. Opening `index.html` directly works for everything
except the form, which needs the function running.

## The CV download

The **Download CV** button links to `/SyedShamoonAshrafResume.pdf`. Drop that
PDF in the project root (exact filename) before deploying, or the button 404s.

# Syed Shamoon Ashraf — Portfolio

Static site (`index.html` + `styles.css` + `script.js`) with a few serverless
functions in `api/`: the contact form (`contact.js`, via Resend), and the
`/admin` editor's content, login and resume endpoints (backed by Upstash Redis).
Dark and light themes, switchable from the nav.

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

### Checking the config

`GET /api/contact` returns a health check — booleans only, never values:

```json
{ "ok": true, "configured": true,
  "env": { "RESEND_API_KEY": true, "CONTACT_TO": true, "CONTACT_FROM": false },
  "keyLooksValid": true, "vercelEnv": "production" }
```

Open `https://<your-site>/api/contact` in a browser. If `configured` is `false`,
the deployment cannot see `RESEND_API_KEY` — the variable is missing from that
environment, or it was added after the deployment was built. **Adding a variable
does not update existing deployments; you must redeploy.**

## Local development

`npm i -g vercel` then `vercel dev` in this folder — that serves the static
files *and* `/api/contact`. Opening `index.html` directly works for everything
except the form, which needs the function running.

## Admin editor (`/admin`)

`/admin` is a login-protected editor for the live site:

- **Text**: click any text in the preview and type. Every editable element
  has a `data-k="<section>.<n>"` attribute in `index.html`; only edited keys
  are stored. Allowed formatting: line breaks, bold, italic.
- **Colours**: separate Dark and Light palettes (the tokens at the top of
  `styles.css`), plus which theme visitors get by default.
- **Resume**: upload a PDF; the **Download Resume** button (`/api/resume`)
  serves it. With no upload, it serves `SYED_SHAMOON_ASHRAF_RESUME.pdf` from
  the repo.

Edits (and the uploaded resume) are stored in Upstash Redis and applied by
`script.js` on page load. If Redis is unreachable the page shows what
`index.html` says, so nothing breaks. Saved changes reach visitors within
about a minute (edge cache).

**Keys are permanent.** Edits are stored against `data-k` keys. When you add
new text to `index.html`, give it a new unused key (e.g. `projects.80`); don't
renumber existing ones, or saved edits land on the wrong element.

### Setup

1. **Redis**: Vercel → project → **Storage** → **Create Database** →
   **Upstash** → **Redis** (free plan). Connect it to this project for all
   environments. That adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   (`UPSTASH_REDIS_REST_URL` / `_TOKEN` also work). No tables to create.
2. **Login**: add these in Vercel → Settings → Environment Variables:

| Name | Notes |
| --- | --- |
| `ADMIN_USERNAME` | The admin login name. |
| `ADMIN_PASSWORD` | The admin password. Mark it **Sensitive**. |
| `ADMIN_SESSION_SECRET` | 32+ random characters; signs the login cookie. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

3. **Redeploy**, then open `/admin`. If anything is missing, the login screen
   lists it.

### Security notes

- Credentials exist only as Vercel env vars, never in this repo.
- Sessions are HMAC-signed, `HttpOnly; Secure; SameSite=Strict` cookies, 8 hours.
  Changing the password or secret logs every session out.
- 5 failed logins from one IP lock it out for 15 minutes.
- The Redis token is only used server-side, in `api/`. Saved text is sanitised
  on the server and again in the browser (no tags beyond `br/strong/em/b/i`,
  no attributes).

## The CV download

The **Download Resume** button links to `/api/resume`, which sends the PDF
uploaded in `/admin`, or redirects to `/SYED_SHAMOON_ASHRAF_RESUME.pdf` in the
project root when nothing is uploaded. Keep that file name if you replace the repo copy.

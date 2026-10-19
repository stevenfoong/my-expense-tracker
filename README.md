# Expense Tracker

Personal receipt tracker on Cloudflare Pages. Photos and PDFs are read by self-hosted Gemma (Ollama behind a Cloudflare Tunnel) and saved to D1, with the original files in R2.

- **Upload**: take a photo or pick several files. Each one is read by the AI and saved automatically; anything incomplete is flagged "Needs review".
- **Spending**: pick a month and it uses your statement cycle (end day 25 → Sep = 26 Aug – 25 Sep). Shows the total, a category breakdown and the receipt list. Tap a receipt to see the image and edit it.
- **Settings**: statement end day, default currency, AI URL, model and categories.

## Project layout

```
public/            front end (no build step)
  app.js           tab shell: add a tab = one file in tabs/ + one line here
  tabs/            upload.js, spending.js, settings.js
  components/      editor.js (receipt dialog, shared by tabs)
functions/api/     Pages Functions (the API)
  _middleware.js   optional Access JWT check + error handling
  receipts/        list, upload, edit, delete, file, retry
  settings.js      settings, settings/test-ai.js
functions/_lib/    AI call, extraction, helpers
schema.sql         D1 tables + default settings
wrangler.toml      bindings (DB, BUCKET, AI)
```

## First-time setup

Run these from the project folder (needs Node and `npx wrangler login` once).

1. **Create the database and bucket**
   ```bash
   npx wrangler d1 create expense-tracker
   npx wrangler r2 bucket create expense-receipts
   ```
   Copy the `database_id` printed by the first command into `wrangler.toml`.

2. **Create the tables**
   ```bash
   npx wrangler d1 execute expense-tracker --remote --file=schema.sql
   ```

3. **Connect the repo to Pages**
   Dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
   - Framework preset: None
   - Build command: *(leave empty)*
   - Build output directory: `public`

   The D1, R2 and AI bindings are read from `wrangler.toml`. From now on every push to `main` deploys automatically; other branches get a preview URL.

4. **Add the secrets** (Pages project → Settings → Variables and Secrets, type *Secret*, for Production and Preview)
   - `CF_ACCESS_CLIENT_ID`: service token ID for your Gemma hostname (ends in `.access`)
   - `CF_ACCESS_CLIENT_SECRET`: service token secret

   Redeploy after adding secrets.

5. **Lock the app with Cloudflare Access** (Zero Trust → Access → Applications → Add → Self-hosted)
   - Add your custom domain for the app **and** `*.<project>.pages.dev` (so preview URLs are protected too).
   - Policy: Action *Allow*, Include *Emails* = your email.

6. **Optional extra lock**: the API also verifies the Access login itself if you add two more variables:
   - `ACCESS_TEAM_DOMAIN`: e.g. `yourteam.cloudflareaccess.com`
   - `ACCESS_AUD`: the Application Audience (AUD) tag from the Access application in step 5

7. **Open the app → Settings**, set the AI URL (e.g. `https://ai.yourdomain.com`), press *Test connection*, then save.

## Gemma side checklist

- The Access application on your Gemma hostname needs a policy with Action **Service Auth** that includes the service token.
- Keep the model loaded: requests send `keep_alive: 30m`.

## Notes

- **PDFs** go through Workers AI `toMarkdown`, which reads the PDF's text layer. E-receipts and bank-portal PDFs work; scanned PDFs (pictures inside a PDF) are flagged with a clear error. Upload a photo or screenshot of those instead.
- **Photos** are resized to 1600px on the phone before upload, which makes uploads and AI reading faster.
- **Add to home screen** on your phone to use it like an app.

## Local development

```bash
cp .dev.vars.example .dev.vars        # fill in the service token
npx wrangler d1 execute expense-tracker --local --file=schema.sql
npx wrangler pages dev
```
Local runs need `npx wrangler login` for the AI binding (PDF conversion).

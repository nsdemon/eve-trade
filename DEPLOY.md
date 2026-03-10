# Deploy to Vercel (use on your phone)

Deploy the EVE Trade Explorer to [Vercel](https://vercel.com) so you can open it on your phone or any device.

## If you get 404 NOT_FOUND

- **Build:** In the Vercel project, open the latest **Deployment** and check the **Building** log. Ensure `npm run build` succeeds and outputs the `dist` folder.
- **Root:** Open `https://your-project.vercel.app/` (with trailing slash is fine). If that 404s, try `https://your-project.vercel.app/index.html`; if that works, the API/rewrite fix may be needed (see below).
- **Redeploy:** After pulling the latest code (path fix for API), trigger a new deploy (e.g. **Redeploy** from the deployment list).

## 1. Push your code to GitHub

If you haven’t already:

```bash
git init
git add .
git commit -m "EVE Trade Explorer"
# Create a repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/eve-trade.git
git push -u origin main
```

## 2. Import the project on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (e.g. with GitHub).
2. Click **Add New…** → **Project**.
3. Import your **eve-trade** (or **eve trade**) repo.
4. Leave the defaults:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
5. Click **Deploy**.

Vercel will build the app and give you a URL like `https://eve-trade-xxx.vercel.app`. Open it on your phone or desktop.

## 3. (Optional) Alerts on Vercel

To run the **price alerts** (email/SMS when ships are within 10% of last month’s low):

1. In the Vercel project, go to **Settings** → **Environment Variables**.
2. Add the same variables as in `.env` (see [ALERTS.md](./ALERTS.md)):
   - `ALERT_EMAIL`, `ALERT_PHONE`
   - `SMTP_*` and/or `TWILIO_*`
   - **`CRON_SECRET`** – create a random string (e.g. `openssl rand -hex 32`) and add it. Vercel will send this when triggering the cron so only the cron can call the alert endpoint.
3. Redeploy the project (e.g. **Deployments** → **…** → **Redeploy**).

The cron runs every 5 minutes on production and uses the same logic as local alerts.

## 4. Custom domain (optional)

In the Vercel project: **Settings** → **Domains** → add your domain and follow the DNS steps.

---

**Summary:** After deploying, use the Vercel URL on your phone; the app and API work the same as when run locally.

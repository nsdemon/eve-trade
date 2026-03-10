# Real-time price alerts (SMS + email)

When a monitored ship in **Jita** is within **10% of its lowest price from the last month**, you get an email and/or SMS.

## Monitored ships

- Tristan, Gila (Geligus), Thrasher, Coercer, Drake, Abaddon, Harbinger, Maelstrom

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   copy .env.example .env
   ```

2. **Email**
   - Set `ALERT_EMAIL` to your address.
   - Set `SMTP_*` for your provider. For Gmail: use [App Password](https://support.google.com/accounts/answer/185833), not your normal password.

3. **SMS (optional)**
   - Sign up at [Twilio](https://www.twilio.com), get a number and credentials.
   - Set `ALERT_PHONE` (e.g. `+15551234567`), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.

4. Start the app:
   ```bash
   npm run start
   ```
   If `ALERT_EMAIL` or `ALERT_PHONE` is set, the server logs:  
   `[alerts] Real-time alerts enabled (every 5 min).`

## Behavior

- **Check interval:** every 5 minutes.
- **Rule:** current lowest sell order in Jita ≤ last month’s lowest × 1.10 → alert.
- **Cooldown:** same ship is not re-alerted for 1 hour.
- **Data:** “last month” is the previous calendar month (same as Day trade).

## API

- `GET /api/alerts/config` — returns `{ enabled, ships, thresholdPct, region }` (no secrets).

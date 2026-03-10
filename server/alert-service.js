/**
 * Real-time alert service: notifies by email and SMS when monitored ships
 * in Jita are within 10% of their lowest price from the last month.
 *
 * Configure via env: ALERT_EMAIL, ALERT_PHONE, and SMTP/Twilio vars.
 * See .env.example.
 */

const ESI_BASE = 'https://esi.evetech.net/latest';
const USER_AGENT = 'EVE-Trade-Explorer-Alerts/1.0';
const JITA_REGION_ID = 10000002;
const THRESHOLD_PCT = 10; // alert when current <= lowest_last_month * (1 + 10/100) i.e. within 10% of low

// Ships to monitor: name -> type_id (Tristan, Gila as "Geligus", Thrasher, Coercer, Drake, Abaddon, Harbinger, Maelstrom)
const ALERT_SHIPS = [
  { name: 'Tristan', typeId: 593 },
  { name: 'Gila', typeId: 17715 },   // "Geligus" interpreted as Gila
  { name: 'Thrasher', typeId: 16242 },
  { name: 'Coercer', typeId: 16228 },
  { name: 'Drake', typeId: 24694 },
  { name: 'Abaddon', typeId: 24622 },
  { name: 'Harbinger', typeId: 24688 },
  { name: 'Maelstrom', typeId: 24628 },
];

function getLastMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

async function fetchESI(path, noCache = false) {
  const url = `${ESI_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`ESI error: ${res.status} ${path}`);
  return res.json();
}

/** Get lowest price in the given month from market history (Jita). */
async function getLastMonthLowest(typeId, month) {
  const path = `/markets/${JITA_REGION_ID}/history/?type_id=${typeId}&datasource=tranquility`;
  const history = await fetchESI(path);
  let lowest = Infinity;
  for (const day of history) {
    if (!day.date.startsWith(month)) continue;
    if (day.lowest != null && day.lowest < lowest) lowest = day.lowest;
  }
  return lowest === Infinity ? null : lowest;
}

/** Get current lowest sell order price in Jita for a type (no cache for freshness). */
async function getCurrentLowestSell(typeId) {
  const path = `/markets/${JITA_REGION_ID}/orders/?order_type=sell&type_id=${typeId}&datasource=tranquility`;
  const orders = await fetchESI(path, true);
  if (!Array.isArray(orders) || orders.length === 0) return null;
  const sellOrders = orders.filter((o) => o.is_buy_order === false);
  if (sellOrders.length === 0) return null;
  return Math.min(...sellOrders.map((o) => o.price));
}

/** Run one check: compare current sell low to last month low; return list of alerts. */
async function runPriceCheck() {
  const month = getLastMonth();
  const alerts = [];

  for (const ship of ALERT_SHIPS) {
    try {
      const [lastMonthLow, currentLow] = await Promise.all([
        getLastMonthLowest(ship.typeId, month),
        getCurrentLowestSell(ship.typeId),
      ]);
      if (lastMonthLow == null || currentLow == null) continue;
      const threshold = lastMonthLow * (1 + THRESHOLD_PCT / 100);
      if (currentLow <= threshold) {
        const pct = ((currentLow - lastMonthLow) / lastMonthLow * 100).toFixed(1);
        alerts.push({
          name: ship.name,
          typeId: ship.typeId,
          lowestLastMonth: lastMonthLow,
          currentLowest: currentLow,
          withinPct: THRESHOLD_PCT,
          pctAboveLow: pct,
        });
      }
    } catch (e) {
      console.error(`[alert] ${ship.name} (${ship.typeId}):`, e.message);
    }
  }

  return alerts;
}

/** Send alerts via email (if configured). */
async function sendEmail(alerts, env) {
  const to = env.ALERT_EMAIL;
  if (!to) return;

  const nodemailer = await import('nodemailer');
  const transportOpts = {
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(env.SMTP_PORT || '587', 10),
    secure: env.SMTP_SECURE === 'true',
    auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  };
  const transporter = nodemailer.default.createTransport(transportOpts);

  const lines = alerts.map(
    (a) =>
      `${a.name}: current ${a.currentLowest.toLocaleString()} ISK (${a.pctAboveLow}% above last month low ${a.lowestLastMonth.toLocaleString()})`
  );
  const text = `EVE Trade Alert (Jita) — ships within ${THRESHOLD_PCT}% of last month's low:\n\n${lines.join('\n')}\n\nMonth: ${getLastMonth()}`;
  const html = `<p>EVE Trade Alert (Jita) — ships within ${THRESHOLD_PCT}% of last month's low:</p><ul>${alerts.map((a) => `<li><b>${a.name}</b>: ${a.currentLowest.toLocaleString()} ISK (${a.pctAboveLow}% above last month low)</li>`).join('')}</ul><p>Month: ${getLastMonth()}</p>`;

  await transporter.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER || 'alerts@eve-trade.local',
    to,
    subject: `EVE Trade Alert: ${alerts.length} ship(s) within ${THRESHOLD_PCT}% of last month low in Jita`,
    text,
    html,
  });
}

/** Send alerts via SMS (if configured). */
async function sendSms(alerts, env) {
  const to = env.ALERT_PHONE;
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_PHONE_NUMBER;
  if (!to || !accountSid || !authToken || !from) return;

  const twilio = (await import('twilio')).default;
  const client = twilio(accountSid, authToken);

  const msg = alerts.length === 1
    ? `${alerts[0].name} in Jita: ${alerts[0].currentLowest.toLocaleString()} ISK (within ${THRESHOLD_PCT}% of last month low)`
    : `EVE Trade: ${alerts.length} ships in Jita within ${THRESHOLD_PCT}% of last month low: ${alerts.map((a) => a.name).join(', ')}`;

  await client.messages.create({ body: msg, from, to });
}

/** Cooldown: don't re-alert the same ship for this many ms. */
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const lastAlertByShip = new Map();

function shouldNotify(shipName) {
  const last = lastAlertByShip.get(shipName);
  if (!last) return true;
  return Date.now() - last > ALERT_COOLDOWN_MS;
}

function markNotified(shipName) {
  lastAlertByShip.set(shipName, Date.now());
}

/** Run check and send email + SMS for any alerts (with cooldown). */
export async function runAlertCheck(env) {
  const alerts = await runPriceCheck();
  if (alerts.length === 0) return { checked: ALERT_SHIPS.length, alerts: 0 };

  const toNotify = alerts.filter((a) => shouldNotify(a.name));
  if (toNotify.length === 0) return { checked: ALERT_SHIPS.length, alerts: alerts.length, cooldown: true };

  try {
    await Promise.all([sendEmail(toNotify, env), sendSms(toNotify, env)]);
  } catch (e) {
    console.error('[alert] Send failed:', e);
    throw e;
  }
  toNotify.forEach((a) => markNotified(a.name));
  return { checked: ALERT_SHIPS.length, alerts: toNotify.length, notified: toNotify };
}

export { ALERT_SHIPS, getLastMonth, THRESHOLD_PCT };

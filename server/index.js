import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import NodeCache from 'node-cache';
import { runAlertCheck, ALERT_SHIPS, THRESHOLD_PCT } from './alert-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3001;
const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache
const ESI_BASE = 'https://esi.evetech.net/latest';
const USER_AGENT = 'EVE-Trade-Explorer/1.0 (https://github.com/eve-trade)';

// Major trade hub regions (region_id -> name)
const REGIONS = {
  10000002: 'The Forge (Jita)',
  10000043: 'Domain (Amarr)',
  10000032: 'Sinq Laison (Dodixie)',
  10000030: 'Heimatar (Rens)',
  10000042: 'Metropolis (Hek)',
};

// Region -> main system (for EVE Ref industry cost API; uses that system's material prices)
const REGION_TO_SYSTEM = {
  10000002: 30000142, // Jita
  10000043: 30002187, // Amarr
  10000032: 30002652, // Dodixie
  10000030: 30002510, // Rens
  10000042: 30002053, // Hek
};

const EVEREF_COST_BASE = 'https://api.everef.net/v1/industry/cost';
const BROKER_FEE_RATE = 0.03;
const TAX_RATE = 0.02;

// Curated lists of high-volume trade items
// Non-module commodities (minerals, ores, ships, PI, etc.)
const ITEM_TYPE_IDS = [
  34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, // Minerals
  18, 19, 20, 21, 22, 1224, 1225, 1226, 1227, 1228, 1229, 1230, 1231, 1232, // Ores
  587, 586, 590, 597, 605, 609, 603, 598, 606, 602, // Frigates
  11396, // Mercoxit
  16268, 16269, 16270, 16271, 16272, 16273, 16274, 16275, // Ice
  4051, 4052, 4053, 4054, 4055, 4056, 4057, 4058, // Salvage
  16634, 16635, 16636, 16637, 16638, 16639, 16640, 16641, 16642, 16643, 16644, 16646, 16647, 16648, 16649, 16650, 16651, 16652, 16653, // Components
  11567, 11568, 11569, 11570, 11571, 11572, 11573, 11574, 11575, 11576, 11577, 11578, 11579, 11580, 11581, 11582, 11583, 11584, 11585, 11586, 11587, 11588, 11589, 11590, // PI and other trade goods
];

// Ship modules (prop, tank, weapons)
const MODULE_TYPE_IDS = [
  438, 440, 12058, 12066, 12068, // Prop: 1MN AB II, 5MN/10MN/100MN/500MN MWD II
  2281, 3829, 3828, 3827, // Shield: Multispec Hardener II, Small/Med/Large Extender II
  10838, 1183, // Armor: Med Armor Repairer II, Small Armor Repairer II
  2889, 2897, 2913, // Projectile: 200mm/220mm Vulcan/425mm AutoCannon II
  3074, 3082, 12356, 3170, // Hybrid: 150mm/250mm/350mm Railgun II, Light Ion Blaster II
  3041, 3520, 3057, // Laser: Small Focused/Heavy/Mega Pulse Laser II
  25715, 1877, 2410, // Missile: Heavy Assault/Rapid Light/Heavy Missile Launcher II
];

// Ships (frigates, destroyers, cruisers, battlecruisers, battleships)
const SHIP_TYPE_IDS = [
  587, 586, 590, 597, 605, 609, 603, 598, 606, 602, 594, 601, 583, 589, 593, 585, 608, // Frigates
  16238, 16240, 16242, 16244, 16236, 16232, 16234, 16228, 16230, // Destroyers
  24698, 24694, 24688, 24690, 24686, 24702, 24696, 24692, 24700, 24684, // Cruisers
  24674, 24676, 24678, 24672, 24666, 24668, 24670, // Battlecruisers
  24622, 24618, 24620, 24624, 24626, 24628, 24630, // Battleships
];

// Combined list used when no specific category is requested
const TRADE_TYPE_IDS = [...ITEM_TYPE_IDS, ...MODULE_TYPE_IDS];

// All tradeable types for day-trade scan (items + modules + ships)
const DAYTRADE_TYPE_IDS = [...ITEM_TYPE_IDS, ...MODULE_TYPE_IDS, ...SHIP_TYPE_IDS];

const JITA_REGION_ID = 10000002;

async function fetchESI(path) {
  const url = `${ESI_BASE}${path}`;
  const cacheKey = `esi:${path}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`ESI error: ${res.status}`);
  const data = await res.json();
  cache.set(cacheKey, data);
  return data;
}

app.use(cors());
app.use(express.json());

// Get region names
app.get('/api/regions', (req, res) => {
  res.json(REGIONS);
});

// Alert config (no secrets): whether alerts are enabled and which ships are monitored
app.get('/api/alerts/config', (req, res) => {
  const enabled = !!(process.env.ALERT_EMAIL || process.env.ALERT_PHONE);
  res.json({
    enabled,
    ships: ALERT_SHIPS.map((s) => s.name),
    thresholdPct: THRESHOLD_PCT,
    region: 'Jita (The Forge)',
  });
});

// Get type name by ID
app.get('/api/types/:id', async (req, res) => {
  try {
    const data = await fetchESI(`/universe/types/${req.params.id}/?datasource=tranquility&language=en`);
    res.json({ id: parseInt(req.params.id), name: data.name });
  } catch (e) {
    res.status(404).json({ error: 'Type not found' });
  }
});

// Batch get type names (returns { "typeId": "Item Name", ... }; keys are strings for consistent lookup)
app.post('/api/types/batch', async (req, res) => {
  const ids = req.body.ids || [];
  const map = {};
  const uniqueIds = [...new Set(ids)].slice(0, 100).map((id) => Number(id) || id);
  await Promise.all(uniqueIds.map(async (id) => {
    try {
      const data = await fetchESI(`/universe/types/${id}/?datasource=tranquility&language=en`);
      map[String(id)] = data.name || `Type ${id}`;
    } catch {
      map[String(id)] = `Type ${id}`;
    }
  }));
  res.json(map);
});

// Get market history for a type in a region
app.get('/api/markets/:regionId/history/:typeId', async (req, res) => {
  try {
    const { regionId, typeId } = req.params;
    const data = await fetchESI(`/markets/${regionId}/history/?type_id=${typeId}&datasource=tranquility`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper: aggregate top by volume for a region and list of type IDs
async function getTopByVolume(regionId, month, typeIds, limit = 10) {
  const results = [];
  for (const typeId of typeIds) {
    try {
      const history = await fetchESI(`/markets/${regionId}/history/?type_id=${typeId}&datasource=tranquility`);
      let volume = 0;
      let orderCount = 0;
      for (const day of history) {
        if (month && !day.date.startsWith(month)) continue;
        volume += day.volume;
        orderCount += day.order_count;
      }
      if (volume > 0) results.push({ type_id: typeId, volume, order_count: orderCount });
    } catch { /* skip */ }
  }
  results.sort((a, b) => b.volume - a.volume);
  return results.slice(0, parseInt(limit, 10) || 10);
}

// Top by volume with volume-weighted average price (for modules)
async function getTopModulesWithAvgPrice(regionId, month, limit = 25) {
  const results = [];
  for (const typeId of MODULE_TYPE_IDS) {
    try {
      const history = await fetchESI(`/markets/${regionId}/history/?type_id=${typeId}&datasource=tranquility`);
      let volume = 0;
      let orderCount = 0;
      let sumPriceVolume = 0;
      for (const day of history) {
        if (month && !day.date.startsWith(month)) continue;
        volume += day.volume;
        orderCount += day.order_count;
        sumPriceVolume += (day.average || 0) * (day.volume || 0);
      }
      const avg_price = volume > 0 ? sumPriceVolume / volume : 0;
      if (volume > 0) results.push({ type_id: typeId, volume, order_count: orderCount, avg_price });
    } catch { /* skip */ }
  }
  results.sort((a, b) => b.volume - a.volume);
  return results.slice(0, parseInt(limit, 10) || 25);
}

// Fetch industry cost from EVE Ref (product_id = type_id for the module)
async function fetchEverefIndustryCost(productId, systemId) {
  const cacheKey = `everef:cost:${productId}:${systemId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const url = `${EVEREF_COST_BASE}?product_id=${productId}&runs=1&system_id=${systemId}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  const data = await res.json();
  const manufacturing = data?.manufacturing?.[String(productId)];
  const out = manufacturing
    ? {
        total_material_cost: manufacturing.total_material_cost ?? 0,
        total_cost: manufacturing.total_cost ?? manufacturing.total_material_cost ?? 0,
      }
    : null;
  if (out) cache.set(cacheKey, out);
  return out;
}

// Top items only (ores, minerals, ships, PI, etc.)
app.get('/api/markets/:regionId/top/items', async (req, res) => {
  const { regionId } = req.params;
  const { month, limit = 10 } = req.query;
  res.set('Cache-Control', 'no-store');
  const top = await getTopByVolume(regionId, month, ITEM_TYPE_IDS, limit || 10);
  res.json(top);
});

// Top ship modules only (with raw material cost, fees, profit margin %)
app.get('/api/markets/:regionId/top/modules', async (req, res) => {
  const { regionId } = req.params;
  const { month, limit = 25 } = req.query;
  res.set('Cache-Control', 'no-store');
  const rid = parseInt(regionId, 10);
  const systemId = REGION_TO_SYSTEM[rid] ?? 30000142;
  const top = await getTopModulesWithAvgPrice(regionId, month, limit || 25);
  const enriched = [];
  for (const row of top) {
    const costData = await fetchEverefIndustryCost(row.type_id, systemId);
    const avgPrice = row.avg_price ?? 0;
    const buildCost = costData?.total_cost ?? costData?.total_material_cost ?? 0;
    const materialCost = costData?.total_material_cost ?? 0;
    const brokerFee = avgPrice * BROKER_FEE_RATE;
    const tax = avgPrice * TAX_RATE;
    const netRevenue = avgPrice * (1 - TAX_RATE);
    const totalCostWithFees = buildCost + brokerFee;
    const profitMarginPct =
      netRevenue > 0 ? ((netRevenue - totalCostWithFees) / netRevenue) * 100 : null;
    enriched.push({
      ...row,
      material_cost: materialCost,
      total_build_cost: buildCost,
      broker_fee: brokerFee,
      tax,
      profit_margin_pct: profitMarginPct,
    });
  }
  res.json(enriched);
});

// Top ships sold only
app.get('/api/markets/:regionId/top/ships', async (req, res) => {
  const { regionId } = req.params;
  const { month, limit = 25 } = req.query;
  res.set('Cache-Control', 'no-store');
  const top = await getTopByVolume(regionId, month, SHIP_TYPE_IDS, limit || 25);
  res.json(top);
});

// Day trade: Jita only — buy at lowest, sell at highest (over the period). Top N by profit per unit.
async function getDaytradeTop(regionId, month, limit = 20) {
  const results = [];
  for (const typeId of DAYTRADE_TYPE_IDS) {
    try {
      const history = await fetchESI(`/markets/${regionId}/history/?type_id=${typeId}&datasource=tranquility`);
      let lowest = Infinity;
      let highest = -Infinity;
      let volume = 0;
      for (const day of history) {
        if (month && !day.date.startsWith(month)) continue;
        if (day.lowest != null && day.lowest < lowest) lowest = day.lowest;
        if (day.highest != null && day.highest > highest) highest = day.highest;
        volume += day.volume || 0;
      }
      const profitPerUnit = (highest !== -Infinity && lowest !== Infinity) ? highest - lowest : 0;
      const profitPct = (lowest > 0 && lowest !== Infinity) ? ((highest - lowest) / lowest) * 100 : 0;
      if (profitPerUnit > 0 && volume > 0) {
        results.push({ type_id: typeId, lowest, highest, profit_per_unit: profitPerUnit, profit_pct: profitPct, volume });
      }
    } catch { /* skip */ }
  }
  results.sort((a, b) => b.profit_per_unit - a.profit_per_unit);
  return results.slice(0, parseInt(limit, 10) || 20);
}

// Last month YYYY-MM (data only from last complete month). Day trade uses ONLY this.
function getLastMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Day trade: ONLY last month. month query param is ignored — server always uses getLastMonth().
app.get('/api/markets/jita/daytrade', async (req, res) => {
  const { limit = 20 } = req.query;
  res.set('Cache-Control', 'no-store');
  const month = getLastMonth();
  const top = await getDaytradeTop(JITA_REGION_ID, month, limit || 20);
  res.json({ month, items: top });
});

// Legacy: top everything (query param category still supported for backwards compat)
app.get('/api/markets/:regionId/top', async (req, res) => {
  const { regionId } = req.params;
  const { month, limit = 10, category } = req.query;
  const cat = String(category || '').trim().toLowerCase();
  const typeIds = cat === 'modules' ? MODULE_TYPE_IDS : cat === 'ships' ? SHIP_TYPE_IDS : cat === 'items' ? ITEM_TYPE_IDS : TRADE_TYPE_IDS;
  res.set('Cache-Control', 'no-store');
  const top = await getTopByVolume(regionId, month, typeIds, limit || 10);
  res.json(top);
});

// Get full aggregated data for all regions and types (for filters/graphs)
app.get('/api/markets/aggregate', async (req, res) => {
  const { regions, month, limit = 50, category } = req.query;
  const regionIds = regions ? regions.split(',').map(Number) : Object.keys(REGIONS).map(Number);
  const cat = String(category || '').trim().toLowerCase();
  let typeIds;
  if (cat === 'modules') {
    typeIds = MODULE_TYPE_IDS;
  } else if (cat === 'ships') {
    typeIds = SHIP_TYPE_IDS;
  } else if (cat === 'items') {
    typeIds = ITEM_TYPE_IDS;
  } else {
    typeIds = TRADE_TYPE_IDS;
  }

  const byRegion = {};
  for (const regionId of regionIds) {
    byRegion[regionId] = [];
    for (const typeId of typeIds) {
      try {
        const history = await fetchESI(`/markets/${regionId}/history/?type_id=${typeId}&datasource=tranquility`);
        let volume = 0;
        let orderCount = 0;
        let avgPrice = 0;
        let days = 0;
        for (const day of history) {
          if (month && !day.date.startsWith(month)) continue;
          volume += day.volume;
          orderCount += day.order_count;
          avgPrice += day.average;
          days++;
        }
        if (volume > 0) {
          byRegion[regionId].push({
            type_id: typeId,
            volume,
            order_count: orderCount,
            avg_price: days ? avgPrice / days : 0,
          });
        }
      } catch { /* skip */ }
    }
    byRegion[regionId].sort((a, b) => b.volume - a.volume);
  }
  res.json(byRegion);
});

// Vercel Cron: run alert check every 5 min. Protected by CRON_SECRET (set in Vercel env).
app.get('/api/cron-alert', async (req, res) => {
  const secret = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runAlertCheck(process.env);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[cron-alert]', e);
    res.status(500).json({ error: e.message });
  }
});

// Serve built React app only when running locally (on Vercel, static is served by the platform)
if (!process.env.VERCEL) {
  const distPath = path.resolve(__dirname, '..', 'dist');
  const indexHtml = path.join(distPath, 'index.html');

  app.get('/', (req, res) => {
    res.sendFile(indexHtml, (err) => {
      if (err) res.status(500).send('Run: npm run build');
    });
  });

  app.use(express.static(distPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(indexHtml, (err) => {
      if (err) res.status(500).send('Run: npm run build');
    });
  });
}

const ALERT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`EVE Trade Explorer: http://localhost:${PORT}`);
    console.log(`(API at http://localhost:${PORT}/api)`);

    const alertEmail = process.env.ALERT_EMAIL;
    const alertPhone = process.env.ALERT_PHONE;
    if (alertEmail || alertPhone) {
      const env = process.env;
      const run = () => {
        runAlertCheck(env).then((r) => {
          if (r.notified) console.log(`[alerts] Notified: ${r.notified.length} ship(s) within 10% of last month low`);
        }).catch((e) => console.error('[alerts] Check failed:', e.message));
      };
      run();
      setInterval(run, ALERT_INTERVAL_MS);
      console.log('[alerts] Real-time alerts enabled (every 5 min). Email:', !!alertEmail, 'SMS:', !!alertPhone);
    }
  });
}

export default app;

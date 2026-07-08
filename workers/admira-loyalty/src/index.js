// Xtanco Club — loyalty backend for Admira XP
// Endpoints:
//   POST /register           { joinCode, name, avatarEmoji } -> { token, customer }
//   GET  /me?token=...                                       -> { customer, recentVisits }
//   POST /checkin            { token }                       -> { customer }   marks "I'm in the shop now"
//   POST /visit              { token, product, revenue }     -> { customer, free, stamps }
//   GET  /active                                             -> { customers: [...active in window] }
//   GET  /health                                             -> { ok:true }
//
// Gamification × Open Loyalty bridge (PoC, additive — see src/ol-driver.js):
//   POST /events                        normalised ingest -> outbox (idempotent, rate-limited)
//   POST /ol/webhook                    inbound OL webhook receiver (HMAC-SHA256)
//   POST /admin/gamification/drain      force outbox drain (Bearer admin)
//   GET  /gamification/me?subjectId=     mirror read: points, tier, badges, pending
//   GET  /gamification/leaderboard?locationId=  weekly ISO ranking (top 10 + your rank)
//   scheduled() cron */5 * * * *        drains the outbox

import { createDriver, receiveWebhook, EVENT_TYPES, pointsCaseSql, isoWeekBounds } from './ol-driver.js';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://csilvasantin.github.io',
  'https://www.xpaceos.com',
  'https://xpaceos.com',
  'http://localhost:9124',
  'http://127.0.0.1:9124',
  'http://localhost:5173',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
];

function getAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .concat(DEFAULT_ALLOWED_ORIGINS);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = getAllowedOrigins(env);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowOrigin = (allowed.includes(origin) || isLocal) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(request, env, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request, env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function now() { return Math.floor(Date.now() / 1000); }

function newToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

const NAME_RE = /^[\p{L}\p{N}\s.\-_'!?]{1,32}$/u;
const EMOJI_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️]{1,8}$/u;
const BIRTHDAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function sanitizeName(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ').slice(0, 32);
  return NAME_RE.test(t) ? t : null;
}
function sanitizeEmoji(s) {
  const t = String(s || '').trim();
  if (!t) return '🙂';
  return EMOJI_RE.test(t) ? t : '🙂';
}
function sanitizeBirthday(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim();
  return BIRTHDAY_RE.test(t) ? t : null;
}
function todayMMDD() {
  const d = new Date();
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

async function publicCustomer(c) {
  if (!c) return null;
  const birthday = c.birthday || null;
  return {
    id: c.id,
    name: c.name,
    avatarEmoji: c.avatar_emoji,
    stamps: c.stamps,
    totalVisits: c.total_visits,
    totalSpend: c.total_spend,
    freePending: !!c.free_pending,
    createdAt: c.created_at,
    lastSeenAt: c.last_seen_at,
    lastCheckin: c.last_checkin,
    birthday,
    isBirthday: !!(birthday && birthday === todayMMDD()),
  };
}

async function getCustomerByToken(env, token) {
  if (!token || typeof token !== 'string') return null;
  const row = await env.DB.prepare('SELECT * FROM customers WHERE token = ? LIMIT 1').bind(token).first();
  return row || null;
}

async function handleRegister(request, env) {
  const body = await readBody(request);
  const expected = String(env.JOIN_CODE || '').trim();
  const provided = String(body.joinCode || '').trim().toUpperCase();
  if (expected && provided !== expected.toUpperCase()) {
    return json(request, env, 403, { error: 'invalid_join_code' });
  }
  const name = sanitizeName(body.name);
  if (!name) return json(request, env, 400, { error: 'invalid_name' });
  const avatar = sanitizeEmoji(body.avatarEmoji);
  const birthday = sanitizeBirthday(body.birthday);
  const token = newToken();
  const ts = now();
  await env.DB.prepare(`
    INSERT INTO customers (token, name, avatar_emoji, stamps, total_visits, total_spend, free_pending, created_at, last_seen_at, last_checkin, birthday)
    VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, 0, ?)
  `).bind(token, name, avatar, ts, ts, birthday).run();
  const row = await getCustomerByToken(env, token);
  return json(request, env, 200, { token, customer: await publicCustomer(row) });
}

async function handleUpdate(request, env) {
  const body = await readBody(request);
  const c = await getCustomerByToken(env, body.token);
  if (!c) return json(request, env, 404, { error: 'not_found' });
  const sets = []; const vals = [];
  if (body.name !== undefined) {
    const name = sanitizeName(body.name);
    if (!name) return json(request, env, 400, { error: 'invalid_name' });
    sets.push('name = ?'); vals.push(name);
  }
  if (body.avatarEmoji !== undefined) {
    sets.push('avatar_emoji = ?'); vals.push(sanitizeEmoji(body.avatarEmoji));
  }
  if (body.birthday !== undefined) {
    sets.push('birthday = ?'); vals.push(sanitizeBirthday(body.birthday));
  }
  if (!sets.length) return json(request, env, 400, { error: 'nothing_to_update' });
  vals.push(c.id);
  await env.DB.prepare('UPDATE customers SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals).run();
  const fresh = await getCustomerByToken(env, body.token);
  return json(request, env, 200, { customer: await publicCustomer(fresh) });
}

async function handleMe(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const c = await getCustomerByToken(env, token);
  if (!c) return json(request, env, 404, { error: 'not_found' });
  await env.DB.prepare('UPDATE customers SET last_seen_at = ? WHERE id = ?').bind(now(), c.id).run();
  const visits = await env.DB.prepare(
    'SELECT ts, product, revenue, was_free FROM visits WHERE customer_id = ? ORDER BY ts DESC LIMIT 20'
  ).bind(c.id).all();
  const rules = await getRules(env);
  return json(request, env, 200, {
    customer: await publicCustomer({ ...c, last_seen_at: now() }),
    recentVisits: visits.results || [],
    stampsForFree: rules.stampsForFree,
  });
}

async function handleCheckin(request, env) {
  const body = await readBody(request);
  const c = await getCustomerByToken(env, body.token);
  if (!c) return json(request, env, 404, { error: 'not_found' });
  const ts = now();
  await env.DB.prepare('UPDATE customers SET last_checkin = ?, last_seen_at = ? WHERE id = ?').bind(ts, ts, c.id).run();
  const fresh = await getCustomerByToken(env, body.token);
  return json(request, env, 200, { customer: await publicCustomer(fresh) });
}

async function applyVisit(env, customer, product, revenue) {
  const rules = await getRules(env);
  const STAMPS_FOR_FREE = rules.stampsForFree;
  const ts = now();
  let wasFree = 0;
  let newStamps = customer.stamps;
  let newFreePending = customer.free_pending;
  if (customer.free_pending) {
    wasFree = 1;
    newFreePending = 0;
    newStamps = 0;
  } else {
    newStamps = customer.stamps + 1;
    if (newStamps >= STAMPS_FOR_FREE) {
      newFreePending = 1;
      newStamps = STAMPS_FOR_FREE;
    }
  }
  const billedRevenue = wasFree ? 0 : Math.max(0, Math.floor(Number(revenue) || 0));
  await env.DB.prepare(`
    UPDATE customers
       SET stamps = ?, total_visits = total_visits + 1, total_spend = total_spend + ?,
           free_pending = ?, last_seen_at = ?
     WHERE id = ?
  `).bind(newStamps, billedRevenue, newFreePending, ts, customer.id).run();
  await env.DB.prepare(`
    INSERT INTO visits (customer_id, ts, product, revenue, was_free)
    VALUES (?, ?, ?, ?, ?)
  `).bind(customer.id, ts, String(product || '').slice(0, 64) || null, billedRevenue, wasFree).run();
  const fresh = await env.DB.prepare('SELECT * FROM customers WHERE id = ? LIMIT 1').bind(customer.id).first();
  return {
    customer: await publicCustomer(fresh),
    free: !!wasFree,
    stamps: newStamps,
    stampsForFree: STAMPS_FOR_FREE,
  };
}

async function handleVisit(request, env) {
  const body = await readBody(request);
  const c = await getCustomerByToken(env, body.token);
  if (!c) return json(request, env, 404, { error: 'not_found' });
  const result = await applyVisit(env, c, body.product, body.revenue);
  return json(request, env, 200, result);
}

// Shop-authenticated visit: the game (csilvasantin.github.io / localhost) marks a
// purchase for a customer that physically "entered" the shop (i.e. has an active
// check-in) and is rate-limited to 1 visit / 20s per customer to discourage abuse.
async function handleShopVisit(request, env) {
  const body = await readBody(request);
  const expected = String(env.JOIN_CODE || '').trim().toUpperCase();
  const provided = String(body.shopJoinCode || '').trim().toUpperCase();
  if (expected && provided !== expected) {
    return json(request, env, 403, { error: 'invalid_shop_code' });
  }
  const id = Number(body.customerId);
  if (!Number.isFinite(id) || id <= 0) return json(request, env, 400, { error: 'invalid_customer_id' });
  const c = await env.DB.prepare('SELECT * FROM customers WHERE id = ? LIMIT 1').bind(id).first();
  if (!c) return json(request, env, 404, { error: 'not_found' });
  const ts = now();
  const windowSec = Math.max(30, Number(env.ACTIVE_WINDOW_SECONDS || 120));
  if (!c.last_checkin || ts - c.last_checkin > windowSec) {
    return json(request, env, 409, { error: 'not_active', message: 'Customer has no recent check-in' });
  }
  const lastVisit = await env.DB.prepare('SELECT ts FROM visits WHERE customer_id = ? ORDER BY ts DESC LIMIT 1').bind(id).first();
  if (lastVisit && ts - lastVisit.ts < 20) {
    return json(request, env, 429, { error: 'rate_limited', retryAfter: 20 - (ts - lastVisit.ts) });
  }
  const result = await applyVisit(env, c, body.product, body.revenue);
  return json(request, env, 200, result);
}

async function handleActive(request, env) {
  const windowSec = Math.max(30, Number(env.ACTIVE_WINDOW_SECONDS || 120));
  const cutoff = now() - windowSec;
  const rows = await env.DB.prepare(`
    SELECT id, token, name, avatar_emoji, stamps, total_visits, total_spend, free_pending,
           created_at, last_seen_at, last_checkin, birthday
      FROM customers
     WHERE last_checkin >= ?
     ORDER BY last_checkin DESC
  `).bind(cutoff).all();
  const customers = await Promise.all((rows.results || []).map(publicCustomer));
  const rules = await getRules(env);
  return json(request, env, 200, {
    customers,
    windowSeconds: windowSec,
    stampsForFree: rules.stampsForFree,
    serverTime: now(),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Backoffice / admin layer — the Club command center at xpaceos.com/backoffice
// All /admin/* routes require Bearer ADMIN_TOKEN. Read endpoints are pure
// aggregation over the same D1; write endpoints are audited in admin_log.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_TIERS = [
  { key: 'bronze',   name: 'Bronce',  emoji: '🥉', color: '#cd7f32', minSpend: 0,   minVisits: 0,  perk: 'Tarjeta de sellos · café gratis cada N' },
  { key: 'silver',   name: 'Plata',   emoji: '🥈', color: '#c0c8d0', minSpend: 50,  minVisits: 5,  perk: 'Sorpresa mensual + cola prioritaria' },
  { key: 'gold',     name: 'Oro',     emoji: '🥇', color: '#ffd866', minSpend: 150, minVisits: 15, perk: '1 sello extra por visita + regalo de cumpleaños' },
  { key: 'platinum', name: 'Platino', emoji: '💎', color: '#78f3ff', minSpend: 400, minVisits: 40, perk: 'Recompensas dobles + acceso a ediciones limitadas' },
];

function safeJsonParse(s, fb) { try { return JSON.parse(s); } catch { return fb; } }

async function getRules(env) {
  let row = null;
  try { row = await env.DB.prepare("SELECT value FROM config WHERE key = 'rules' LIMIT 1").first(); } catch {}
  const cfg = row && row.value ? safeJsonParse(row.value, {}) : {};
  const stampsForFree = Math.max(2, Math.min(50, Number(cfg.stampsForFree || env.STAMPS_FOR_FREE || 5)));
  const tiers = Array.isArray(cfg.tiers) && cfg.tiers.length ? cfg.tiers : DEFAULT_TIERS;
  return {
    stampsForFree,
    tiers,
    clubName: cfg.clubName || 'Xtanco Club',
    currency: cfg.currency || 'EUR',
    rewardLabel: cfg.rewardLabel || 'Café gratis',
    joinCode: String(env.JOIN_CODE || 'XTANCO26'),
  };
}

async function setRules(env, patch) {
  const cur = await getRules(env);
  const next = {
    stampsForFree: patch.stampsForFree != null ? Math.max(2, Math.min(50, Number(patch.stampsForFree) || cur.stampsForFree)) : cur.stampsForFree,
    tiers: Array.isArray(patch.tiers) && patch.tiers.length ? patch.tiers.map(sanitizeTier).filter(Boolean) : cur.tiers,
    clubName: patch.clubName != null ? String(patch.clubName).slice(0, 40) : cur.clubName,
    currency: patch.currency != null ? String(patch.currency).slice(0, 4) : cur.currency,
    rewardLabel: patch.rewardLabel != null ? String(patch.rewardLabel).slice(0, 40) : cur.rewardLabel,
  };
  if (!next.tiers.length) next.tiers = DEFAULT_TIERS;
  await env.DB.prepare("INSERT INTO config (key, value) VALUES ('rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(next)).run();
  return next;
}

function sanitizeTier(t) {
  if (!t || typeof t !== 'object') return null;
  const key = String(t.key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16);
  const name = String(t.name || '').trim().slice(0, 24);
  if (!key || !name) return null;
  return {
    key, name,
    emoji: String(t.emoji || '').trim().slice(0, 4),
    color: /^#[0-9a-fA-F]{3,8}$/.test(String(t.color || '')) ? t.color : '#78f3ff',
    minSpend: Math.max(0, Math.floor(Number(t.minSpend) || 0)),
    minVisits: Math.max(0, Math.floor(Number(t.minVisits) || 0)),
    perk: String(t.perk || '').slice(0, 120),
  };
}

function tierFor(customer, tiers) {
  const spend = Number(customer.total_spend || 0);
  const visits = Number(customer.total_visits || 0);
  let best = tiers[0];
  for (const t of tiers) {
    if (spend >= Number(t.minSpend || 0) && visits >= Number(t.minVisits || 0)) best = t;
  }
  const idx = tiers.indexOf(best);
  const next = idx >= 0 && idx < tiers.length - 1 ? tiers[idx + 1] : null;
  return {
    key: best.key, name: best.name, emoji: best.emoji || '', color: best.color || '#78f3ff', perk: best.perk || '',
    next: next ? { key: next.key, name: next.name, minSpend: next.minSpend, minVisits: next.minVisits } : null,
  };
}

function upcomingMMDD(days) {
  const set = new Set();
  const base = Date.now();
  for (let i = 0; i <= days; i++) {
    const d = new Date(base + i * 86400000);
    set.add(String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'));
  }
  return set;
}

function adminCustomer(c, rules) {
  const t = now();
  const lastSeen = Number(c.last_seen_at || 0);
  return {
    id: c.id,
    name: c.name,
    avatarEmoji: c.avatar_emoji,
    stamps: c.stamps,
    totalVisits: c.total_visits,
    totalSpend: c.total_spend,
    freePending: !!c.free_pending,
    createdAt: c.created_at,
    lastSeenAt: c.last_seen_at,
    lastCheckin: c.last_checkin,
    birthday: c.birthday || null,
    isBirthday: !!(c.birthday && c.birthday === todayMMDD()),
    note: c.note || null,
    archived: !!c.archived,
    tier: tierFor(c, rules.tiers),
    daysSinceVisit: lastSeen ? Math.floor((t - lastSeen) / 86400) : null,
    almostFree: (rules.stampsForFree - Number(c.stamps || 0)) === 1 && !c.free_pending,
  };
}

async function logAdmin(env, action, targetId, detail) {
  try {
    await env.DB.prepare('INSERT INTO admin_log (ts, action, target_id, detail) VALUES (?, ?, ?, ?)')
      .bind(now(), String(action).slice(0, 40), targetId != null ? Number(targetId) : null, detail ? String(detail).slice(0, 400) : null).run();
  } catch {}
}

function adminTokenOf(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  return new URL(request.url).searchParams.get('admin_token') || '';
}
function timingSafeEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function requireAdmin(request, env) {
  const expected = String(env.ADMIN_TOKEN || '').trim();
  if (!expected) return { ok: false, status: 503, error: 'admin_not_configured' };
  const provided = adminTokenOf(request);
  if (!provided || !timingSafeEq(provided, expected)) return { ok: false, status: 401, error: 'unauthorized' };
  return { ok: true };
}

async function handleAdminStats(request, env) {
  const rules = await getRules(env);
  const t = now();
  const d1 = t - 86400, d7 = t - 7 * 86400, d30 = t - 30 * 86400;
  const win = Math.max(30, Number(env.ACTIVE_WINDOW_SECONDS || 120));

  const members = (await env.DB.prepare(
    'SELECT id,name,avatar_emoji,stamps,total_visits,total_spend,free_pending,created_at,last_seen_at,last_checkin,birthday FROM customers WHERE archived = 0'
  ).all()).results || [];

  const v = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS d1,
      SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS d7,
      SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS d30,
      SUM(revenue) AS revTotal,
      SUM(CASE WHEN ts >= ? THEN revenue ELSE 0 END) AS rev7,
      SUM(CASE WHEN ts >= ? THEN revenue ELSE 0 END) AS rev30,
      SUM(was_free) AS freeTotal,
      SUM(CASE WHEN was_free = 1 AND ts >= ? THEN 1 ELSE 0 END) AS free30
    FROM visits
  `).bind(d1, d7, d30, d7, d30, d30).first();

  const today = todayMMDD();
  const weekSet = upcomingMMDD(7);
  let bdToday = 0, bdWeek = 0;
  const upcoming = [];
  const tierDist = {}; rules.tiers.forEach(tt => tierDist[tt.key] = 0);
  let pendingFree = 0, almostFree = 0, lapsed = 0, newMembers7 = 0, newMembers30 = 0, activeNow = 0, spendSum = 0, visitSum = 0;

  for (const m of members) {
    if (m.birthday) {
      if (m.birthday === today) bdToday++;
      if (weekSet.has(m.birthday)) { bdWeek++; upcoming.push({ id: m.id, name: m.name, avatarEmoji: m.avatar_emoji, birthday: m.birthday }); }
    }
    const tk = tierFor(m, rules.tiers).key; tierDist[tk] = (tierDist[tk] || 0) + 1;
    if (m.free_pending) pendingFree++;
    if ((rules.stampsForFree - Number(m.stamps || 0)) === 1 && !m.free_pending) almostFree++;
    if (m.total_visits > 0 && m.last_seen_at && (t - m.last_seen_at) > 30 * 86400) lapsed++;
    if (m.created_at >= d7) newMembers7++;
    if (m.created_at >= d30) newMembers30++;
    if (m.last_checkin && (t - m.last_checkin) <= win) activeNow++;
    spendSum += Number(m.total_spend || 0);
    visitSum += Number(m.total_visits || 0);
  }

  return json(request, env, 200, {
    members: members.length,
    activeNow,
    newMembers7, newMembers30,
    visits: { total: Number(v?.total || 0), d1: Number(v?.d1 || 0), d7: Number(v?.d7 || 0), d30: Number(v?.d30 || 0) },
    revenue: { total: Number(v?.revTotal || 0), d7: Number(v?.rev7 || 0), d30: Number(v?.rev30 || 0) },
    redemptions: { total: Number(v?.freeTotal || 0), d30: Number(v?.free30 || 0) },
    redemptionRate: v && v.total ? Number(v.freeTotal || 0) / Number(v.total) : 0,
    pendingFree, almostFree, lapsed,
    birthdaysToday: bdToday, birthdaysWeek: bdWeek,
    upcomingBirthdays: upcoming.sort((a, b) => a.birthday.localeCompare(b.birthday)).slice(0, 12),
    avgSpend: members.length ? spendSum / members.length : 0,
    avgVisits: members.length ? visitSum / members.length : 0,
    tierDistribution: tierDist,
    rules,
    serverTime: t,
  });
}

async function handleAdminMembers(request, env) {
  const rules = await getRules(env);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const tier = (url.searchParams.get('tier') || '').trim();
  const segment = (url.searchParams.get('segment') || '').trim();
  const sort = (url.searchParams.get('sort') || 'last_seen_at').trim();
  const dir = (url.searchParams.get('dir') || 'desc').trim() === 'asc' ? 1 : -1;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  const includeArchived = url.searchParams.get('archived') === '1';

  const rows = (await env.DB.prepare(
    `SELECT * FROM customers ${includeArchived ? '' : 'WHERE archived = 0'} LIMIT 5000`
  ).all()).results || [];

  const t = now();
  const win = Math.max(30, Number(env.ACTIVE_WINDOW_SECONDS || 120));
  let list = rows.map(c => adminCustomer(c, rules));

  if (q) list = list.filter(m => (m.name || '').toLowerCase().includes(q) || String(m.id) === q);
  if (tier) list = list.filter(m => m.tier.key === tier);
  if (segment === 'birthday') list = list.filter(m => m.isBirthday);
  else if (segment === 'birthday_week') { const wk = upcomingMMDD(7); list = list.filter(m => m.birthday && wk.has(m.birthday)); }
  else if (segment === 'lapsed') list = list.filter(m => m.totalVisits > 0 && m.daysSinceVisit != null && m.daysSinceVisit > 30);
  else if (segment === 'champions') list = list.filter(m => m.totalSpend > 0).sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 50);
  else if (segment === 'almost_free') list = list.filter(m => m.almostFree);
  else if (segment === 'pending_free') list = list.filter(m => m.freePending);
  else if (segment === 'new') list = list.filter(m => m.createdAt >= t - 7 * 86400);
  else if (segment === 'active') list = list.filter(m => m.lastCheckin && (t - m.lastCheckin) <= win);

  const total = list.length;
  if (segment !== 'champions') {
    const key = ({ last_seen_at: 'lastSeenAt', created_at: 'createdAt', total_spend: 'totalSpend', total_visits: 'totalVisits', stamps: 'stamps', name: 'name' })[sort] || 'lastSeenAt';
    list.sort((a, b) => {
      if (key === 'name') return dir * String(a.name || '').localeCompare(String(b.name || ''));
      return dir * (Number(a[key] || 0) - Number(b[key] || 0));
    });
  }
  return json(request, env, 200, { members: list.slice(offset, offset + limit), total, limit, offset, rules });
}

async function handleAdminMember(request, env) {
  const rules = await getRules(env);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) return json(request, env, 400, { error: 'invalid_id' });
  const c = await env.DB.prepare('SELECT * FROM customers WHERE id = ? LIMIT 1').bind(id).first();
  if (!c) return json(request, env, 404, { error: 'not_found' });
  const visits = (await env.DB.prepare('SELECT ts, product, revenue, was_free FROM visits WHERE customer_id = ? ORDER BY ts DESC LIMIT 200').bind(id).all()).results || [];
  return json(request, env, 200, { member: adminCustomer(c, rules), visits, rules });
}

async function handleAdminSeries(request, env) {
  const days = Math.min(120, Math.max(7, Number(new URL(request.url).searchParams.get('days') || 30)));
  const t = now();
  const from = t - days * 86400;
  const visits = (await env.DB.prepare('SELECT ts, revenue, was_free FROM visits WHERE ts >= ?').bind(from).all()).results || [];
  const signups = (await env.DB.prepare('SELECT created_at FROM customers WHERE created_at >= ?').bind(from).all()).results || [];
  const buckets = {}; const labels = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date((t - i * 86400) * 1000).toISOString().slice(0, 10);
    labels.push(key); buckets[key] = { date: key, visits: 0, revenue: 0, redemptions: 0, signups: 0 };
  }
  const dk = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
  for (const x of visits) { const k = dk(x.ts); if (buckets[k]) { buckets[k].visits++; buckets[k].revenue += Number(x.revenue || 0); if (x.was_free) buckets[k].redemptions++; } }
  for (const s of signups) { const k = dk(s.created_at); if (buckets[k]) buckets[k].signups++; }
  return json(request, env, 200, { days, series: labels.map(k => buckets[k]) });
}

async function handleAdminLog(request, env) {
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get('limit') || 50)));
  const rows = (await env.DB.prepare('SELECT ts, action, target_id, detail FROM admin_log ORDER BY ts DESC LIMIT ?').bind(limit).all()).results || [];
  return json(request, env, 200, { log: rows });
}

async function handleAdminExport(request, env) {
  const rules = await getRules(env);
  const rows = (await env.DB.prepare('SELECT * FROM customers ORDER BY id ASC LIMIT 10000').all()).results || [];
  const head = ['id', 'name', 'tier', 'stamps', 'total_visits', 'total_spend', 'free_pending', 'birthday', 'created_at', 'last_seen_at', 'archived', 'note'];
  const esc = (val) => { const s = String(val == null ? '' : val); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [head.join(',')];
  for (const c of rows) {
    lines.push([c.id, c.name, tierFor(c, rules.tiers).key, c.stamps, c.total_visits, c.total_spend, c.free_pending, c.birthday || '', c.created_at, c.last_seen_at, c.archived || 0, c.note || ''].map(esc).join(','));
  }
  return new Response(lines.join('\n'), {
    status: 200,
    headers: { ...corsHeaders(request, env), 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="club-members.csv"', 'Cache-Control': 'no-store' },
  });
}

async function handleAdminAdjust(request, env) {
  const rules = await getRules(env);
  const body = await readBody(request);
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) return json(request, env, 400, { error: 'invalid_id' });
  const c = await env.DB.prepare('SELECT * FROM customers WHERE id = ? LIMIT 1').bind(id).first();
  if (!c) return json(request, env, 404, { error: 'not_found' });
  const sets = []; const vals = []; const changes = [];
  if (body.name !== undefined) { const n = sanitizeName(body.name); if (!n) return json(request, env, 400, { error: 'invalid_name' }); sets.push('name = ?'); vals.push(n); changes.push('name'); }
  if (body.avatarEmoji !== undefined) { sets.push('avatar_emoji = ?'); vals.push(sanitizeEmoji(body.avatarEmoji)); changes.push('emoji'); }
  if (body.birthday !== undefined) { sets.push('birthday = ?'); vals.push(sanitizeBirthday(body.birthday)); changes.push('birthday'); }
  if (body.note !== undefined) { sets.push('note = ?'); vals.push(body.note == null ? null : String(body.note).slice(0, 400)); changes.push('note'); }
  if (body.archived !== undefined) { sets.push('archived = ?'); vals.push(body.archived ? 1 : 0); changes.push(body.archived ? 'archive' : 'unarchive'); }
  let stamps = Number(c.stamps || 0); let stampTouched = false;
  if (body.setStamps !== undefined) { stamps = Math.max(0, Math.min(rules.stampsForFree, Number(body.setStamps) || 0)); stampTouched = true; changes.push('setStamps=' + stamps); }
  if (body.addStamps !== undefined) { stamps = Math.max(0, Math.min(rules.stampsForFree, stamps + (Number(body.addStamps) || 0))); stampTouched = true; changes.push('addStamps=' + body.addStamps); }
  if (stampTouched) { sets.push('stamps = ?'); vals.push(stamps); }
  if (body.grantFree) { sets.push('free_pending = ?'); vals.push(1); changes.push('grantFree'); }
  if (!sets.length) return json(request, env, 400, { error: 'nothing_to_update' });
  vals.push(id);
  await env.DB.prepare('UPDATE customers SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals).run();
  await logAdmin(env, 'adjust', id, changes.join(', '));
  const fresh = await env.DB.prepare('SELECT * FROM customers WHERE id = ? LIMIT 1').bind(id).first();
  return json(request, env, 200, { member: adminCustomer(fresh, rules) });
}

async function handleAdminRedeem(request, env) {
  const rules = await getRules(env);
  const body = await readBody(request);
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) return json(request, env, 400, { error: 'invalid_id' });
  const c = await env.DB.prepare('SELECT * FROM customers WHERE id = ? LIMIT 1').bind(id).first();
  if (!c) return json(request, env, 404, { error: 'not_found' });
  if (!c.free_pending) return json(request, env, 409, { error: 'no_free_pending' });
  const ts = now();
  await env.DB.prepare('UPDATE customers SET free_pending = 0, stamps = 0, total_visits = total_visits + 1, last_seen_at = ? WHERE id = ?').bind(ts, id).run();
  await env.DB.prepare('INSERT INTO visits (customer_id, ts, product, revenue, was_free) VALUES (?, ?, ?, 0, 1)').bind(id, ts, String(body.product || rules.rewardLabel || 'Recompensa').slice(0, 64)).run();
  await logAdmin(env, 'redeem', id, body.product || rules.rewardLabel);
  const fresh = await env.DB.prepare('SELECT * FROM customers WHERE id = ? LIMIT 1').bind(id).first();
  return json(request, env, 200, { member: adminCustomer(fresh, rules), redeemed: true });
}

async function handleAdminConfigGet(request, env) {
  return json(request, env, 200, { rules: await getRules(env) });
}
async function handleAdminConfigSet(request, env) {
  const body = await readBody(request);
  const next = await setRules(env, body);
  await logAdmin(env, 'config', null, JSON.stringify({ stampsForFree: next.stampsForFree, tiers: next.tiers.length, clubName: next.clubName }));
  return json(request, env, 200, { rules: next });
}

async function routeAdmin(request, env, path) {
  const gate = requireAdmin(request, env);
  if (!gate.ok) return json(request, env, gate.status, { error: gate.error });
  if (request.method === 'GET'  && path === '/admin/ping')          return json(request, env, 200, { ok: true, ts: now() });
  if (request.method === 'GET'  && path === '/admin/stats')         return await handleAdminStats(request, env);
  if (request.method === 'GET'  && path === '/admin/members')       return await handleAdminMembers(request, env);
  if (request.method === 'GET'  && path === '/admin/member')        return await handleAdminMember(request, env);
  if (request.method === 'GET'  && path === '/admin/series')        return await handleAdminSeries(request, env);
  if (request.method === 'GET'  && path === '/admin/log')           return await handleAdminLog(request, env);
  if (request.method === 'GET'  && path === '/admin/export')        return await handleAdminExport(request, env);
  if (request.method === 'GET'  && path === '/admin/config')        return await handleAdminConfigGet(request, env);
  if (request.method === 'POST' && path === '/admin/config')        return await handleAdminConfigSet(request, env);
  if (request.method === 'POST' && path === '/admin/member/adjust') return await handleAdminAdjust(request, env);
  if (request.method === 'POST' && path === '/admin/member/redeem') return await handleAdminRedeem(request, env);
  if (request.method === 'POST' && path === '/admin/gamification/drain') return await handleAdminDrain(request, env);
  return json(request, env, 404, { error: 'not_found', path });
}

// ─────────────────────────────────────────────────────────────────────
// Gamification × Open Loyalty bridge (PoC). All additive; see ol-driver.js.
// ─────────────────────────────────────────────────────────────────────

// Strip PII we never want to forward to OL. If any is present it is dropped and
// a flag is recorded, so the ingest stays privacy-minimal by construction.
const PII_KEYS = ['email', 'phone', 'name', 'firstName', 'lastName', 'tel', 'mobile'];
function sanitizeMetadata(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { meta: {}, pii: false };
  const out = {}; let pii = false;
  for (const [k, v] of Object.entries(meta)) {
    if (PII_KEYS.includes(k)) { pii = true; continue; }
    out[k] = v;
  }
  return { meta: out, pii };
}

function parseTs(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  const p = Date.parse(String(v));
  return Number.isFinite(p) ? Math.floor(p / 1000) : null;
}

async function handleEvents(request, env) {
  const body = await readBody(request);
  const eventId = String(body.eventId || '').trim();
  const type = String(body.type || '').trim();
  const subjectId = String(body.subjectId || '').trim();

  if (!eventId) return json(request, env, 400, { error: 'missing_event_id' });
  if (!EVENT_TYPES.has(type)) return json(request, env, 400, { error: 'invalid_type', type });
  if (!subjectId) return json(request, env, 400, { error: 'missing_subject_id' });

  // IDEMPOTENCY: event_id is PK. Check first so retries don't count against the
  // rate limit and always return duplicate:true.
  const existing = await env.DB.prepare('SELECT event_id FROM loyalty_events WHERE event_id = ?').bind(eventId).first();
  if (existing) return json(request, env, 200, { ok: true, duplicate: true, eventId });

  // RATE LIMIT over a rolling 60s window on received_at.
  const t = now();
  const windowStart = t - 60;
  const subjCount = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM loyalty_events WHERE subject_id = ? AND received_at >= ?'
  ).bind(subjectId, windowStart).first();
  if (Number(subjCount?.c || 0) >= 30) {
    return json(request, env, 429, { error: 'rate_limited', scope: 'subject', limit: 30 });
  }
  const screenId = body.metadata && typeof body.metadata === 'object' ? body.metadata.screenId : null;
  if (screenId != null) {
    const scr = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM loyalty_events WHERE json_extract(metadata, '$.screenId') = ? AND received_at >= ?"
    ).bind(String(screenId), windowStart).first();
    if (Number(scr?.c || 0) >= 120) {
      return json(request, env, 429, { error: 'rate_limited', scope: 'screen', limit: 120 });
    }
  }

  const { meta, pii } = sanitizeMetadata(body.metadata);
  if (pii) meta._piiStripped = true;
  const occurredAt = parseTs(body.occurredAt) || t;
  const subjectKind = String(body.subjectKind || 'visitor').slice(0, 24);
  const sourceApp = body.sourceApp != null ? String(body.sourceApp).slice(0, 64) : null;

  // INSERT OR IGNORE closes the check-then-insert race: a concurrent duplicate
  // with the same event_id is silently skipped rather than erroring.
  await env.DB.prepare(`
    INSERT OR IGNORE INTO loyalty_events
      (event_id, type, subject_id, subject_kind, source_app, metadata, occurred_at, received_at, ol_status, attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)
  `).bind(eventId, type, subjectId, subjectKind, sourceApp, JSON.stringify(meta), occurredAt, t).run();

  return json(request, env, 200, { ok: true, duplicate: false, eventId, status: 'pending', piiStripped: pii });
}

async function handleOlWebhook(request, env) {
  const r = await receiveWebhook(request, env);
  return json(request, env, r.status, r.body);
}

// Drain the outbox: send pending events to OL (mock or live). attempts++ each
// try; after 5 attempts a stuck event is parked as 'failed' (simple backoff).
async function drainOutbox(env, limit = 25) {
  const driver = createDriver(env);
  const rows = (await env.DB.prepare(
    "SELECT * FROM loyalty_events WHERE ol_status = 'pending' ORDER BY received_at ASC LIMIT ?"
  ).bind(limit).all()).results || [];

  let sent = 0, failed = 0;
  for (const row of rows) {
    const attempts = Number(row.attempts || 0) + 1;
    try {
      const res = await driver.sendEvent(row);
      await env.DB.prepare(
        "UPDATE loyalty_events SET ol_status = 'sent', sent_at = ?, attempts = ?, ol_response = ? WHERE event_id = ?"
      ).bind(now(), attempts, JSON.stringify(res).slice(0, 4000), row.event_id).run();
      sent++;
    } catch (err) {
      const status = attempts >= 5 ? 'failed' : 'pending';
      if (status === 'failed') failed++;
      await env.DB.prepare(
        'UPDATE loyalty_events SET ol_status = ?, attempts = ?, ol_response = ? WHERE event_id = ?'
      ).bind(status, attempts, JSON.stringify({ error: String(err && err.message || err) }).slice(0, 4000), row.event_id).run();
    }
  }
  return { processed: rows.length, sent, failed };
}

async function handleAdminDrain(request, env) {
  const result = await drainOutbox(env, 25);
  await logAdmin(env, 'gam_drain', null, JSON.stringify(result));
  return json(request, env, 200, { ok: true, ...result });
}

async function handleGamMe(request, env) {
  const subjectId = String(new URL(request.url).searchParams.get('subjectId') || '').trim();
  if (!subjectId) return json(request, env, 400, { error: 'missing_subject_id' });
  const wallet = await env.DB.prepare('SELECT points, tier, updated_at FROM gam_wallets WHERE subject_id = ?').bind(subjectId).first();
  const badges = (await env.DB.prepare('SELECT badge, earned_at FROM gam_badges WHERE subject_id = ? ORDER BY earned_at ASC').bind(subjectId).all()).results || [];
  const pending = await env.DB.prepare("SELECT COUNT(*) AS c FROM loyalty_events WHERE subject_id = ? AND ol_status = 'pending'").bind(subjectId).first();
  const lastSent = await env.DB.prepare("SELECT MAX(sent_at) AS s FROM loyalty_events WHERE subject_id = ? AND ol_status = 'sent'").bind(subjectId).first();
  return json(request, env, 200, {
    subjectId,
    points: Number(wallet?.points || 0),
    tier: wallet?.tier || 'bronze',
    badges: badges.map(b => ({ badge: b.badge, earnedAt: b.earned_at })),
    pendingEvents: Number(pending?.c || 0),
    lastSync: Number(lastSent?.s || wallet?.updated_at || 0) || null,
  });
}

async function handleGamLeaderboard(request, env) {
  const url = new URL(request.url);
  const locationId = String(url.searchParams.get('locationId') || '').trim();
  const subjectId = String(url.searchParams.get('subjectId') || '').trim();
  if (!locationId) return json(request, env, 400, { error: 'missing_location_id' });

  const { start, end } = isoWeekBounds();
  // Weekly ranking = points summed from sent events in the current ISO week for
  // this location. Point values come from the driver's single-source CASE.
  const rows = (await env.DB.prepare(`
    SELECT subject_id, SUM(${pointsCaseSql()}) AS pts
      FROM loyalty_events
     WHERE ol_status = 'sent' AND received_at >= ? AND received_at < ?
       AND json_extract(metadata, '$.locationId') = ?
     GROUP BY subject_id
     HAVING pts > 0
     ORDER BY pts DESC
     LIMIT 200
  `).bind(start, end, locationId).all()).results || [];

  const ranked = rows.map((r, i) => ({ rank: i + 1, subjectId: r.subject_id, points: Number(r.pts || 0) }));
  const top = ranked.slice(0, 10);
  let me = null;
  if (subjectId) me = ranked.find(r => r.subjectId === subjectId) || { rank: null, subjectId, points: 0 };
  return json(request, env, 200, {
    locationId,
    week: { start, end },
    top,
    me,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path.startsWith('/admin/')) return await routeAdmin(request, env, path);
      if (request.method === 'GET'  && path === '/health')   return json(request, env, 200, { ok: true, ts: now() });
      if (request.method === 'POST' && path === '/register') return await handleRegister(request, env);
      if (request.method === 'POST' && path === '/update')   return await handleUpdate(request, env);
      if (request.method === 'GET'  && path === '/me')       return await handleMe(request, env);
      if (request.method === 'POST' && path === '/checkin')  return await handleCheckin(request, env);
      if (request.method === 'POST' && path === '/visit')    return await handleVisit(request, env);
      if (request.method === 'POST' && path === '/shop/visit') return await handleShopVisit(request, env);
      if (request.method === 'GET'  && path === '/active')   return await handleActive(request, env);
      // Gamification bridge (additive)
      if (request.method === 'POST' && path === '/events')                  return await handleEvents(request, env);
      if (request.method === 'POST' && path === '/ol/webhook')              return await handleOlWebhook(request, env);
      if (request.method === 'GET'  && path === '/gamification/me')         return await handleGamMe(request, env);
      if (request.method === 'GET'  && path === '/gamification/leaderboard') return await handleGamLeaderboard(request, env);
      return json(request, env, 404, { error: 'not_found', path });
    } catch (err) {
      return json(request, env, 500, { error: 'server_error', message: String(err && err.message || err) });
    }
  },

  // Cron drain of the OL outbox (wrangler.toml [triggers] crons = ["*/5 * * * *"]).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(drainOutbox(env, 25));
  },
};

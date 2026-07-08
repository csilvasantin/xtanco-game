// Open Loyalty driver — single interface, two modes (env.OL_MODE).
//
//   'mock' (default): simulates OL *inside* the worker. It applies the 3 pilot
//     mechanics and then AUTO-SENDS the signed webhook to the same /ol/webhook
//     pipeline OL would hit, using the identical HMAC format. So the end-to-end
//     circuit is byte-for-byte the same as production; switching to 'live' is
//     only a matter of setting secrets.
//
//   'live': talks to Open Loyalty CLOUD over HTTP (member by loyaltyCardNumber,
//     POST /customEvent). Real OL then calls our /ol/webhook independently.
//
// No new dependencies: WebCrypto (crypto.subtle) only. JS puro, ESM.

// ── Pilot config (single source of truth) ────────────────────────────────
// Whitelisted event types accepted by POST /events.
export const EVENT_TYPES = new Set([
  'screen.view', 'qr.scan', 'wifi.checkin', 'queue.join', 'queue.complete',
  'room.booking', 'signage.proof', 'campaign.interaction',
  'ar.experience.start', 'ar.experience.complete', 'assistant.action',
]);

// MVP mechanics: points awarded per event type (mock mode).
const POINTS = { 'wifi.checkin': 10, 'qr.scan': 5, 'queue.complete': 0 };

// Badge 'primera-mision' unlocks once the subject has fired all 3 pilot types.
const PILOT_TYPES = ['wifi.checkin', 'qr.scan', 'queue.complete'];
const PILOT_BADGE = 'primera-mision';

// Webhook secrets carry a whsec_ prefix that must be stripped before use as the
// HMAC key (per OL docs). In mock mode a dev fallback keeps signer==verifier.
const DEFAULT_MOCK_SECRET = 'whsec_mock_poc_dev';
const REPLAY_WINDOW_SEC = 300; // reject webhooks older than 5 min (anti-replay)

function nowSec() { return Math.floor(Date.now() / 1000); }

function mockTier(points) {
  if (points >= 150) return 'gold';
  if (points >= 50) return 'silver';
  return 'bronze';
}

// ── Crypto helpers (WebCrypto) ────────────────────────────────────────────
const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(str) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(str)));
}

async function hmacSha256Hex(keyStr, msgStr) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(msgStr)));
}

// Constant-time compare of two hex strings of equal length.
function timingSafeEqHex(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function webhookKey(env) {
  const raw = String(env.OL_WEBHOOK_SECRET || DEFAULT_MOCK_SECRET);
  return raw.startsWith('whsec_') ? raw.slice(6) : raw; // strip whsec_ prefix
}

// Canonical string that gets HMAC'd, per OL hmac/verifying-the-signature docs:
//   METHOD\n{len}:{host}\n{len}:{path}\n{sha256(rawBody)}\n{timestamp}\n{requestId}
// The raw body is used verbatim on both sides (never re-serialised).
async function canonicalString(method, url, rawBody, timestamp, requestId) {
  const u = new URL(url);
  const host = u.host;
  const path = u.pathname;
  const bodyHash = await sha256Hex(rawBody);
  return `${method}\n${host.length}:${host}\n${path.length}:${path}\n${bodyHash}\n${timestamp}\n${requestId}`;
}

function randomId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return toHex(a);
}

// ── Webhook signing (mock producer side) ──────────────────────────────────
// Builds a fully signed Request to POST at /ol/webhook, identical in shape to
// what OL sends. Returns the Request so it can be fed to receiveWebhook().
async function signedWebhookRequest(env, baseOrigin, eventName, data) {
  const url = `${baseOrigin}/ol/webhook`;
  const rawBody = JSON.stringify({ eventName, data });
  const timestamp = nowSec();
  const requestId = randomId();
  const canonical = await canonicalString('POST', url, rawBody, timestamp, requestId);
  const signature = await hmacSha256Hex(webhookKey(env), canonical);
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Signature-Algorithm': 'sha256',
      'X-Webhook-Timestamp': String(timestamp),
      'X-Webhook-Request-Id': requestId,
    },
    body: rawBody,
  });
}

// ── Webhook receiving (shared by /ol/webhook route AND the mock self-send) ──
// Verifies HMAC + replay window, then applies the payload to the mirror tables.
// Returns { status, body } (index wraps it into a JSON Response).
export async function receiveWebhook(request, env) {
  const rawBody = await request.text();
  const signature = request.headers.get('X-Webhook-Signature') || '';
  const timestampHdr = request.headers.get('X-Webhook-Timestamp') || '';
  const requestId = request.headers.get('X-Webhook-Request-Id') || '';
  const timestamp = Number(timestampHdr);

  if (!signature || !Number.isFinite(timestamp)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }
  // Anti-replay: reject timestamps outside the 5-min window.
  if (Math.abs(nowSec() - timestamp) > REPLAY_WINDOW_SEC) {
    return { status: 401, body: { error: 'stale_timestamp' } };
  }
  const canonical = await canonicalString('POST', request.url, rawBody, timestamp, requestId);
  const expected = await hmacSha256Hex(webhookKey(env), canonical);
  if (!timingSafeEqHex(signature, expected)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }

  let parsed = {};
  try { parsed = JSON.parse(rawBody); } catch { parsed = {}; }
  const eventName = parsed.eventName || 'Unknown';
  const data = parsed.data || {};

  // Idempotent apply: dedup_key is UNIQUE, so re-delivery is a no-op.
  const dedupKey = await sha256Hex(rawBody + '|' + timestamp);
  const t = nowSec();
  const ins = await env.DB.prepare(
    'INSERT OR IGNORE INTO gam_webhook_log (event_name, payload, received_at, dedup_key) VALUES (?, ?, ?, ?)'
  ).bind(eventName, rawBody.slice(0, 4000), t, dedupKey).run();
  const isNew = ins.meta && ins.meta.changes ? ins.meta.changes > 0 : true;
  if (!isNew) {
    return { status: 200, body: { ok: true, duplicate: true, eventName } };
  }

  await applyWebhook(env, eventName, data, t);
  return { status: 200, body: { ok: true, eventName } };
}

async function applyWebhook(env, eventName, data, t) {
  const subjectId = data.loyaltyCardNumber || data.subjectId;
  if (!subjectId) return;
  switch (eventName) {
    case 'AvailablePointsAmountChanged':
    case 'WalletBalanceUpdated':
    case 'CampaignEffectWasApplied': {
      const points = Math.max(0, Math.floor(Number(data.availablePoints) || 0));
      const tier = data.tier || mockTier(points);
      await env.DB.prepare(`
        INSERT INTO gam_wallets (subject_id, points, tier, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(subject_id) DO UPDATE SET points = excluded.points, tier = excluded.tier, updated_at = excluded.updated_at
      `).bind(subjectId, points, tier, t).run();
      break;
    }
    case 'CustomerLevelChanged': {
      await env.DB.prepare(`
        INSERT INTO gam_wallets (subject_id, points, tier, updated_at) VALUES (?, 0, ?, ?)
        ON CONFLICT(subject_id) DO UPDATE SET tier = excluded.tier, updated_at = excluded.updated_at
      `).bind(subjectId, data.tier || null, t).run();
      break;
    }
    case 'MemberAchievementProgressWasChanged': {
      // Only concede the badge when the achievement is completed.
      if (data.completed && (data.badge || data.achievement)) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO gam_badges (subject_id, badge, earned_at) VALUES (?, ?, ?)'
        ).bind(subjectId, String(data.badge || data.achievement), t).run();
      }
      break;
    }
    case 'CustomerBoughtReward':
    case 'RewardRedemptionStatusChanged':
      // Logged in gam_webhook_log; reward mirror is out of PoC scope.
      break;
    default:
      break;
  }
}

// ── Driver factory ────────────────────────────────────────────────────────
export function createDriver(env) {
  const mode = String(env.OL_MODE || 'mock').toLowerCase();
  return mode === 'live' ? liveDriver(env) : mockDriver(env);
}

// ── MOCK driver ────────────────────────────────────────────────────────────
function mockDriver(env) {
  // Self-origin for the signed webhook. Value is irrelevant as long as signer
  // and verifier agree (they both parse the same Request URL).
  const ORIGIN = String(env.OL_MOCK_ORIGIN || 'https://loyalty.local');

  async function ensureMember(subjectId) {
    // Mirror of OL "member exists": create a zeroed wallet row if absent.
    await env.DB.prepare(
      "INSERT OR IGNORE INTO gam_wallets (subject_id, points, tier, updated_at) VALUES (?, 0, 'bronze', ?)"
    ).bind(subjectId, nowSec()).run();
    return { subjectId, mode: 'mock' };
  }

  async function sendEvent(row) {
    const subjectId = row.subject_id;
    await ensureMember(subjectId);

    const pts = POINTS[row.type] || 0;
    const deliveries = [];

    // 1) Points mechanic -> AvailablePointsAmountChanged webhook.
    if (pts > 0) {
      const cur = await env.DB.prepare('SELECT points FROM gam_wallets WHERE subject_id = ?').bind(subjectId).first();
      const balance = (cur ? Number(cur.points) : 0) + pts;
      const req = await signedWebhookRequest(env, ORIGIN, 'AvailablePointsAmountChanged', {
        loyaltyCardNumber: subjectId, availablePoints: balance, change: pts, tier: mockTier(balance),
      });
      const res = await receiveWebhook(req, env);
      deliveries.push({ eventName: 'AvailablePointsAmountChanged', balance, status: res.status });
    }

    // 2) Badge mechanic: all 3 pilot types seen -> achievement completed.
    const seen = (await env.DB.prepare(
      `SELECT DISTINCT type FROM loyalty_events WHERE subject_id = ? AND type IN (${PILOT_TYPES.map(() => '?').join(',')})`
    ).bind(subjectId, ...PILOT_TYPES).all()).results || [];
    const already = await env.DB.prepare('SELECT 1 FROM gam_badges WHERE subject_id = ? AND badge = ?')
      .bind(subjectId, PILOT_BADGE).first();
    if (seen.length >= PILOT_TYPES.length && !already) {
      const req = await signedWebhookRequest(env, ORIGIN, 'MemberAchievementProgressWasChanged', {
        loyaltyCardNumber: subjectId, achievement: PILOT_BADGE, badge: PILOT_BADGE, completed: true,
      });
      const res = await receiveWebhook(req, env);
      deliveries.push({ eventName: 'MemberAchievementProgressWasChanged', badge: PILOT_BADGE, status: res.status });
    }

    return { ok: true, mode: 'mock', pointsAwarded: pts, deliveries };
  }

  return { ensureMember, sendEvent, mode: 'mock' };
}

// ── LIVE driver (Open Loyalty CLOUD) ────────────────────────────────────────
// Uses X-AUTH-TOKEN permanent admin key. member is keyed by loyaltyCardNumber =
// our subjectId. customEvent shapes are taken verbatim from RESEARCH §2/§3.
function liveDriver(env) {
  const base = String(env.OL_BASE_URL || '').replace(/\/+$/, '');
  const store = String(env.OL_STORE || '');
  const token = String(env.OL_TOKEN || '');
  const api = (p) => `${base}/api/${store}${p}`;
  const authHeaders = () => ({ 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-AUTH-TOKEN': token });

  async function ensureMember(subjectId) {
    // Resolve by loyaltyCardNumber; create if missing (identificationMethod=loyaltyCardNumber).
    const getRes = await fetch(api(`/member/loyaltyCardNumber=${encodeURIComponent(subjectId)}`), {
      method: 'GET', headers: authHeaders(),
    });
    if (getRes.ok) return { subjectId, existed: true };
    const createRes = await fetch(api('/member'), {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ customer: { loyaltyCardNumber: subjectId } }),
    });
    if (!createRes.ok && createRes.status !== 409) {
      throw new Error(`ensureMember failed: ${createRes.status} ${await createRes.text()}`);
    }
    return { subjectId, existed: false };
  }

  async function sendEvent(row) {
    await ensureMember(row.subject_id);
    // eventDate as OL expects ('YYYY-MM-DDTHH:MM:SS', no zone) from occurred_at.
    const d = new Date((Number(row.occurred_at) || nowSec()) * 1000);
    const eventDate = d.toISOString().slice(0, 19);
    const meta = row.metadata ? safeParse(row.metadata) : {};
    const res = await fetch(api('/customEvent'), {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({
        event: {
          type: row.type.replace(/\./g, '_'), // schema type ids can't hold dots
          eventDate,
          customerData: { loyaltyCardNumber: row.subject_id },
          ...(meta && Object.keys(meta).length ? { body: meta } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`customEvent failed: ${res.status} ${await res.text()}`);
    let body = null; try { body = await res.json(); } catch {}
    return { ok: true, mode: 'live', olResponse: body };
  }

  return { ensureMember, sendEvent, mode: 'live' };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// ── Weekly leaderboard SQL fragment (single source of truth for points) ─────
// Builds a CASE expression from POINTS so the leaderboard sum matches the mock
// mechanic exactly. Keys are code constants -> no SQL-injection surface.
export function pointsCaseSql() {
  const cases = Object.entries(POINTS).map(([t, p]) => `WHEN '${t}' THEN ${p}`).join(' ');
  return `CASE type ${cases} ELSE 0 END`;
}

// Monday 00:00 UTC .. +7d for the ISO week containing nowSec.
export function isoWeekBounds(t = nowSec()) {
  const d = new Date(t * 1000);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow, 0, 0, 0) / 1000;
  return { start, end: start + 7 * 86400 };
}

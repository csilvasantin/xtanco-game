-- Gamification × Open Loyalty bridge (PoC). ADDITIVE ONLY: no existing table or
-- column is touched; the member-facing API and the backoffice keep working.
-- Named 0004 because 0003 is already taken by the backoffice migration.

-- Normalised ingestion outbox. One row per event received on POST /events.
-- event_id is the caller-supplied idempotency key (PRIMARY KEY => INSERT OR
-- IGNORE de-dupes retries without a race). ol_status drives the outbox drain:
-- pending -> sent (delivered to OL) | failed (>=5 attempts).
CREATE TABLE IF NOT EXISTS loyalty_events (
  event_id     TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  subject_kind TEXT DEFAULT 'visitor',
  source_app   TEXT,
  metadata     TEXT,
  occurred_at  INTEGER,
  received_at  INTEGER,
  sent_at      INTEGER,
  ol_status    TEXT DEFAULT 'pending',
  ol_response  TEXT,
  attempts     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_loyalty_events_status   ON loyalty_events(ol_status);
CREATE INDEX IF NOT EXISTS idx_loyalty_events_subject  ON loyalty_events(subject_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_events_type     ON loyalty_events(type);
-- Rate-limit counters scan a recent received_at window; index keeps them cheap.
CREATE INDEX IF NOT EXISTS idx_loyalty_events_received ON loyalty_events(received_at);

-- Local mirror of the state Open Loyalty owns. NEVER read live from OL for the
-- panel; these tables are kept in sync exclusively by the inbound webhooks.
CREATE TABLE IF NOT EXISTS gam_wallets (
  subject_id TEXT PRIMARY KEY,
  points     INTEGER NOT NULL DEFAULT 0,
  tier       TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS gam_badges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  badge      TEXT NOT NULL,
  earned_at  INTEGER,
  UNIQUE(subject_id, badge)
);
CREATE INDEX IF NOT EXISTS idx_gam_badges_subject ON gam_badges(subject_id);

-- Every accepted webhook is logged once. dedup_key (hash of raw body+timestamp)
-- is UNIQUE so at-least-once re-delivery is applied at-most-once.
CREATE TABLE IF NOT EXISTS gam_webhook_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name  TEXT,
  payload     TEXT,
  received_at INTEGER,
  dedup_key   TEXT UNIQUE
);

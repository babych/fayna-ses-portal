-- ==============================================================================
-- Fayna SES - High Performance D1 Database Schema
-- Designed for zero full-table scans, sub-millisecond point lookups & index coverage
-- ==============================================================================

-- 1. Push Subscriptions Table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,                   -- SHA-256 hash of endpoint
  endpoint TEXT NOT NULL UNIQUE,         -- Web Push Gateway URL (Google/Apple)
  p256dh TEXT NOT NULL,                  -- Client Public Key
  auth TEXT NOT NULL,                    -- Client Auth Secret
  scope TEXT NOT NULL DEFAULT 'all',     -- 'all' (whole complex) or station/building id
  is_active INTEGER NOT NULL DEFAULT 1,  -- 1 = active, 0 = inactive / 410 Gone
  created_at INTEGER NOT NULL,           -- Unix timestamp (seconds)
  updated_at INTEGER NOT NULL            -- Unix timestamp (seconds)
);

-- Covering Index for dispatching notifications by scope
-- Eliminates table scans during cron triggers
CREATE INDEX IF NOT EXISTS idx_subs_active_scope 
ON push_subscriptions (is_active, scope);

-- Covering Index for stats queries
CREATE INDEX IF NOT EXISTS idx_subs_stats 
ON push_subscriptions (is_active, created_at);


-- 2. Grid State Machine Table (Edge Detection & Debounce)
-- Holds only ~5-6 rows across the entire complex
CREATE TABLE IF NOT EXISTS grid_states (
  target_id TEXT PRIMARY KEY,            -- 'complex' or stationId ('cc5a...')
  is_blackout INTEGER NOT NULL,          -- 1 = blackout active, 0 = grid present
  last_changed_at INTEGER NOT NULL,      -- Unix timestamp of state transition
  last_notified_at INTEGER NOT NULL      -- Unix timestamp of last dispatched notification
);


-- 3. Push Audit & Telemetry Log (Trimmed rolling window)
CREATE TABLE IF NOT EXISTS push_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id TEXT NOT NULL,
  event_type TEXT NOT NULL,              -- 'blackout_started', 'grid_restored', 'test'
  total_recipients INTEGER NOT NULL,
  success_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_created_at 
ON push_logs (created_at DESC);


-- 4. Historical Station Telemetry Storage
-- High-density time-series table; compound primary key guarantees idempotent deduplication.
-- WITHOUT ROWID reduces storage overhead and eliminates secondary rowid index lookup.
CREATE TABLE IF NOT EXISTS station_telemetry (
  station_id TEXT NOT NULL,              -- Hex station ID ('cc5a340c80f5ce04158291f4aac365a6', etc.)
  timestamp INTEGER NOT NULL,             -- Unix timestamp (seconds)
  soc REAL,                               -- State of charge (%)
  batt_w INTEGER,                         -- Battery power (W, positive=discharge, negative=charge)
  grid_w INTEGER,                         -- Grid power (W)
  load_w INTEGER,                         -- Building power consumption (W)
  pv_w INTEGER,                           -- Solar generation (W)
  PRIMARY KEY (station_id, timestamp)
) WITHOUT ROWID;

-- Covering Index for range queries (Station History / Day / Month modals)
CREATE INDEX IF NOT EXISTS idx_telemetry_station_time
ON station_telemetry (station_id, timestamp DESC);

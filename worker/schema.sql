CREATE TABLE IF NOT EXISTS settlements (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  region        TEXT DEFAULT '',
  plan          TEXT DEFAULT 'basic',
  status        TEXT DEFAULT 'active',
  contact       TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  features_json     TEXT DEFAULT '{}',
  msg_settings_json TEXT DEFAULT '{}',
  created_at        INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  first_name          TEXT NOT NULL DEFAULT '',
  last_name           TEXT NOT NULL DEFAULT '',
  role                TEXT NOT NULL DEFAULT 'community_manager',
  community_id        TEXT,
  username            TEXT UNIQUE NOT NULL,
  phone               TEXT,
  password_hash       TEXT,
  password_changed_at INTEGER,
  active              INTEGER DEFAULT 1,
  created_at          INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS residents (
  id             TEXT PRIMARY KEY,
  first_name     TEXT NOT NULL DEFAULT '',
  last_name      TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  community_id   TEXT NOT NULL,
  notify_method  TEXT DEFAULT 'sms',
  active         INTEGER DEFAULT 1,
  created_at     INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS locker_configs (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  max_width    INTEGER DEFAULT 120,
  max_height   INTEGER DEFAULT 200,
  leg_height   INTEGER DEFAULT 20,
  tier         TEXT DEFAULT 'basic',
  esp_id       TEXT,
  columns_json TEXT DEFAULT '[]',
  created_at   INTEGER DEFAULT (unixepoch()),
  updated_at   INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS packages (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  resident_id  TEXT,
  cell_id      TEXT NOT NULL,
  barcode      TEXT,
  courier      TEXT DEFAULT '',
  status       TEXT DEFAULT 'waiting',
  lock_code    TEXT,
  notes        TEXT,
  assigned_at  INTEGER DEFAULT (unixepoch()),
  confirmed_at INTEGER,
  collected_at INTEGER
);

CREATE TABLE IF NOT EXISTS cells (
  id             TEXT PRIMARY KEY,
  community_id   TEXT NOT NULL,
  cell_number    INTEGER NOT NULL,
  status         TEXT DEFAULT 'empty',
  fault_note     TEXT,
  is_shared_room INTEGER DEFAULT 0,
  created_at     INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS shared_room_residents (
  cell_id     TEXT NOT NULL,
  resident_id TEXT NOT NULL,
  PRIMARY KEY (cell_id, resident_id)
);

CREATE TABLE IF NOT EXISTS couriers (
  id           TEXT PRIMARY KEY,
  first_name   TEXT NOT NULL DEFAULT '',
  last_name    TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL UNIQUE DEFAULT '',
  employee_id      TEXT NOT NULL DEFAULT '',
  delivery_zones   TEXT DEFAULT '',
  company_id       TEXT NOT NULL,
  active       INTEGER DEFAULT 1,
  created_at   INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS esp_commands (
  id           TEXT PRIMARY KEY,
  esp_id       TEXT NOT NULL,
  community_id TEXT NOT NULL,
  cell_number  INTEGER NOT NULL,
  created_at   INTEGER DEFAULT (unixepoch())
);

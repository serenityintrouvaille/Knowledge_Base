-- The Daily Archive — Phase 1 schema. Timestamps are Unix epoch milliseconds.

CREATE TABLE sources (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  url              TEXT NOT NULL,             -- human-facing site URL
  feed_url         TEXT UNIQUE,               -- NULL for the manual "Saved links" source
  type             TEXT NOT NULL,             -- naver | substack | feed | manual
  icon_url         TEXT,
  category         TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1,
  check_frequency  INTEGER NOT NULL DEFAULT 6, -- hours between feed checks
  last_checked_at  INTEGER,
  last_success_at  INTEGER,
  last_error       TEXT,
  created_at       INTEGER NOT NULL
);

CREATE TABLE items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  canonical_url   TEXT NOT NULL UNIQUE,
  external_id     TEXT,
  title           TEXT NOT NULL,
  author          TEXT,
  published_at    INTEGER,                   -- NULL when the source gives no date
  discovered_at   INTEGER NOT NULL,
  sort_time       INTEGER NOT NULL,          -- published_at, else discovered_at
  content_type    TEXT NOT NULL DEFAULT 'article',
  image_url       TEXT,
  excerpt         TEXT,
  preview         TEXT,                      -- one sentence for inbox cards
  raw_html        TEXT,                      -- feed-supplied HTML awaiting extraction; cleared after
  blocks          TEXT,                      -- JSON array of plain-text blocks; never raw HTML
  permitted_text  TEXT,                      -- flattened text used for briefs and search
  access_level    TEXT NOT NULL DEFAULT 'metadata', -- full | excerpt | metadata
  content_hash    TEXT,
  text_status     TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed | skipped
  fetch_attempts  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX items_sort ON items(sort_time DESC);
CREATE INDEX items_source ON items(source_id, sort_time DESC);
CREATE INDEX items_pending ON items(text_status, sort_time DESC);

CREATE TABLE summaries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  body          TEXT,                         -- JSON array of paragraphs
  method        TEXT NOT NULL,                -- extractive-basic
  source_scope  TEXT NOT NULL,                -- full | excerpt
  generated_at  INTEGER NOT NULL,
  status        TEXT NOT NULL,                -- ready | unavailable | reported
  report_note   TEXT
);

CREATE TABLE reading_state (
  item_id           INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  is_read           INTEGER NOT NULL DEFAULT 0,
  is_saved          INTEGER NOT NULL DEFAULT 0,
  is_hidden         INTEGER NOT NULL DEFAULT 0,
  last_opened_at    INTEGER,
  reading_position  REAL
);
CREATE INDEX reading_state_saved ON reading_state(is_saved);

CREATE TABLE meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE login_attempts (
  at  INTEGER NOT NULL
);

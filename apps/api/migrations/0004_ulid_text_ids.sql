-- Rebuild PKs as TEXT ULID. Destructive for existing integer rows.
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS item_dependencies;
DROP TABLE IF EXISTS checklist_items;
PRAGMA foreign_keys = ON;

CREATE TABLE checklist_items (
  id              TEXT    PRIMARY KEY,
  label           TEXT    NOT NULL,
  formula         TEXT    NOT NULL,
  completion_mode TEXT    NOT NULL DEFAULT 'while_valid'
                          CHECK (completion_mode IN ('once','while_valid')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  checked_at      TEXT,
  window_start_at TEXT,
  allow_remind    INTEGER NOT NULL DEFAULT 0,
  remind_at       TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE item_dependencies (
  item_id    TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE RESTRICT,
  PRIMARY KEY (item_id, depends_on)
);

CREATE INDEX idx_checklist_items_active_order
  ON checklist_items (is_active, sort_order);

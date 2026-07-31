-- Initial schema for conditional checklist
CREATE TABLE checklist_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  label           TEXT    NOT NULL,
  formula         TEXT    NOT NULL,
  completion_mode TEXT    NOT NULL DEFAULT 'while_valid'
                          CHECK (completion_mode IN ('once','while_valid')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  checked_at      TEXT,
  window_start_at TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE item_dependencies (
  item_id    INTEGER NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  depends_on INTEGER NOT NULL REFERENCES checklist_items(id) ON DELETE RESTRICT,
  PRIMARY KEY (item_id, depends_on)
);

CREATE INDEX idx_checklist_items_active_order
  ON checklist_items (is_active, sort_order);

-- Soft-delete: archive instead of permanent remove.
ALTER TABLE checklist_items ADD COLUMN deleted_at TEXT;

CREATE INDEX idx_checklist_items_deleted
  ON checklist_items (deleted_at);

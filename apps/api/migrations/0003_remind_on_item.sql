-- Move remind onto checklist_items (drop legacy reminders table if present)
DROP INDEX IF EXISTS idx_reminders_due;
DROP TABLE IF EXISTS reminders;

ALTER TABLE checklist_items ADD COLUMN remind_at TEXT;

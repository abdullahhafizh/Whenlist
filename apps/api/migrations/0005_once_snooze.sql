-- Once-forever snooze: hide until a new validity window (or next day if always-true)
ALTER TABLE checklist_items ADD COLUMN snoozed_window_at TEXT;

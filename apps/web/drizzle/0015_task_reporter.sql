ALTER TABLE `task` ADD `reporter_user_id` text REFERENCES user(id);
--> statement-breakpoint
UPDATE task SET reporter_user_id = created_by_user_id;
--> statement-breakpoint
-- Older Workers omit reporter_user_id. Keep those writes compatible during rollout.
CREATE TRIGGER task_fill_default_reporter
AFTER INSERT ON task
WHEN NEW.reporter_user_id IS NULL
BEGIN
  UPDATE task SET reporter_user_id = NEW.created_by_user_id WHERE id = NEW.id;
END;

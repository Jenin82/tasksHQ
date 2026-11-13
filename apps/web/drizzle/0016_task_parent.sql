ALTER TABLE `task` ADD `parent_task_id` text REFERENCES task(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `task_parent_task_id_idx` ON `task` (`parent_task_id`);
--> statement-breakpoint
-- Sub-tasks are one level deep and stay in their parent's project. The domain
-- checks this first; these triggers catch races and older Workers.
CREATE TRIGGER task_parent_check_insert
BEFORE INSERT ON task
WHEN NEW.parent_task_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'task_parent_invalid')
  WHERE NEW.parent_task_id = NEW.id
    OR NOT EXISTS (
      SELECT 1 FROM task
      WHERE id = NEW.parent_task_id AND project_id = NEW.project_id AND parent_task_id IS NULL
    );
END;
--> statement-breakpoint
-- The WHEN skips the foreign key's own SET NULL, which leaves project_id alone.
CREATE TRIGGER task_parent_check_update
BEFORE UPDATE OF parent_task_id, project_id ON task
WHEN NEW.parent_task_id IS NOT NULL OR NEW.project_id IS NOT OLD.project_id
BEGIN
  SELECT RAISE(ABORT, 'task_parent_invalid')
  WHERE (
      NEW.parent_task_id IS NOT NULL AND (
        NEW.parent_task_id = NEW.id
        OR NOT EXISTS (
          SELECT 1 FROM task
          WHERE id = NEW.parent_task_id AND project_id = NEW.project_id AND parent_task_id IS NULL
        )
        OR EXISTS (SELECT 1 FROM task WHERE parent_task_id = NEW.id)
      )
    )
    OR (
      NEW.project_id IS NOT OLD.project_id AND (
        NEW.parent_task_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM task WHERE parent_task_id = NEW.id)
      )
    );
END;

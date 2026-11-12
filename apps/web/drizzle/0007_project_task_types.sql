CREATE TABLE `project_task_type` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'gray' NOT NULL,
	`icon` text DEFAULT 'task' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_task_type_project_name_unique` ON `project_task_type` (`project_id`,lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `project_task_type_default_unique` ON `project_task_type` (`project_id`) WHERE "project_task_type"."is_default" = 1;--> statement-breakpoint
ALTER TABLE `task` ADD `type_id` text REFERENCES project_task_type(id);--> statement-breakpoint
CREATE INDEX `task_type_id_idx` ON `task` (`type_id`);
--> statement-breakpoint
-- Seed both existing projects and projects created during a rolling deployment.
WITH starter_types(suffix, name, color, icon, is_default) AS (
  VALUES
    ('task', 'Task', 'gray', 'task', 1),
    ('bug', 'Bug', 'red', 'bug', 0),
    ('feature', 'Feature', 'blue', 'feature', 0),
    ('kt', 'Knowledge Transfer (KT)', 'purple', 'book', 0)
)
INSERT INTO project_task_type (id, project_id, name, color, icon, is_default)
SELECT project.id || ':type:' || starter_types.suffix, project.id, starter_types.name, starter_types.color, starter_types.icon, starter_types.is_default
FROM project CROSS JOIN starter_types;
--> statement-breakpoint
UPDATE task SET type_id = project_id || ':type:task';
--> statement-breakpoint
CREATE TRIGGER project_seed_task_types
AFTER INSERT ON project
BEGIN
  INSERT INTO project_task_type (id, project_id, name, color, icon, is_default)
  VALUES
    (NEW.id || ':type:task', NEW.id, 'Task', 'gray', 'task', 1),
    (NEW.id || ':type:bug', NEW.id, 'Bug', 'red', 'bug', 0),
    (NEW.id || ':type:feature', NEW.id, 'Feature', 'blue', 'feature', 0),
    (NEW.id || ':type:kt', NEW.id, 'Knowledge Transfer (KT)', 'purple', 'book', 0);
END;
--> statement-breakpoint
-- Older Workers omit type_id. Keep those writes compatible during rollout.
CREATE TRIGGER task_fill_default_type
AFTER INSERT ON task
WHEN NEW.type_id IS NULL
BEGIN
  UPDATE task
  SET type_id = (
    SELECT id FROM project_task_type
    WHERE project_id = NEW.project_id AND is_default = 1
  )
  WHERE id = NEW.id;
END;

ALTER TABLE `project` ADD `auto_archive_status_id` text REFERENCES status(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `project` ADD `auto_archive_days` integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `status_changed_at` integer;--> statement-breakpoint
-- Existing tasks start a fresh clock at rollout, so none is archived on deploy day.
UPDATE `task` SET `status_changed_at` = cast(unixepoch('subsecond') * 1000 as integer) WHERE `status_changed_at` IS NULL;--> statement-breakpoint
-- Default each existing project to auto-archive from its own "Done" status, if it has one.
-- Projects without a status named "Done" stay off until an admin picks a column.
UPDATE `project` SET `auto_archive_status_id` = (
  SELECT `s`.`id` FROM `status` `s`
  WHERE `s`.`project_id` = `project`.`id` AND lower(`s`.`name`) = 'done'
  LIMIT 1
);--> statement-breakpoint
-- The actor automatic archives are attributed to, so the activity log reads honestly.
-- Not an org member, so it is never assignable and never appears in member lists.
INSERT INTO `user` (`id`, `name`, `email`, `email_verified`, `created_at`, `updated_at`)
VALUES (
  'system-automation',
  'Automation',
  'automation@taskshq.invalid',
  1,
  cast(unixepoch('subsecond') * 1000 as integer),
  cast(unixepoch('subsecond') * 1000 as integer)
);

-- Hand-written: renames the org concept to team in place. Never replace this
-- with drizzle-kit's output: a table rebuild on D1 drops the 0007/0015/0016
-- triggers and, since D1 ignores PRAGMA foreign_keys=OFF, cascades deletes.
-- RENAME rewrites FKs, triggers and index columns, but keeps index names, so
-- every org-named index is recreated under its team name before the old one
-- is dropped (team_member_team_id_user_id_unique is the parent key of the
-- project_member and team_reporting_line composite FKs).
ALTER TABLE `org` RENAME TO `team`;--> statement-breakpoint
ALTER TABLE `org_member` RENAME TO `team_member`;--> statement-breakpoint
ALTER TABLE `org_invite` RENAME TO `team_invite`;--> statement-breakpoint
ALTER TABLE `org_reporting_line` RENAME TO `team_reporting_line`;--> statement-breakpoint
ALTER TABLE `team_member` RENAME COLUMN `org_id` TO `team_id`;--> statement-breakpoint
ALTER TABLE `team_invite` RENAME COLUMN `org_id` TO `team_id`;--> statement-breakpoint
ALTER TABLE `team_reporting_line` RENAME COLUMN `org_id` TO `team_id`;--> statement-breakpoint
ALTER TABLE `project` RENAME COLUMN `org_id` TO `team_id`;--> statement-breakpoint
ALTER TABLE `project_member` RENAME COLUMN `org_id` TO `team_id`;--> statement-breakpoint
ALTER TABLE `project_slug_alias` RENAME COLUMN `org_id` TO `team_id`;--> statement-breakpoint
ALTER TABLE `time_entry` RENAME COLUMN `org_id` TO `team_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `team_slug_unique` ON `team` (`slug`);--> statement-breakpoint
DROP INDEX `org_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `team_member_team_id_user_id_unique` ON `team_member` (`team_id`,`user_id`);--> statement-breakpoint
DROP INDEX `org_member_org_id_user_id_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `team_invite_team_id_email_unique` ON `team_invite` (`team_id`,`email`);--> statement-breakpoint
DROP INDEX `org_invite_org_id_email_unique`;--> statement-breakpoint
CREATE INDEX `team_invite_email_idx` ON `team_invite` (`email`);--> statement-breakpoint
DROP INDEX `org_invite_email_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `team_reporting_line_team_user_unique` ON `team_reporting_line` (`team_id`,`user_id`);--> statement-breakpoint
DROP INDEX `org_reporting_line_org_user_unique`;--> statement-breakpoint
CREATE INDEX `team_reporting_line_team_lead_idx` ON `team_reporting_line` (`team_id`,`lead_user_id`);--> statement-breakpoint
DROP INDEX `org_reporting_line_org_lead_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `project_team_id_slug_unique` ON `project` (`team_id`,`slug`);--> statement-breakpoint
DROP INDEX `project_org_id_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `project_team_id_key_unique` ON `project` (`team_id`,`key`);--> statement-breakpoint
DROP INDEX `project_org_id_key_unique`;--> statement-breakpoint
CREATE INDEX `time_entry_team_id_started_at_idx` ON `time_entry` (`team_id`,`started_at`);--> statement-breakpoint
DROP INDEX `time_entry_org_id_started_at_idx`;--> statement-breakpoint
UPDATE `mail_outbox` SET `kind` = 'team_invite' WHERE `kind` = 'org_invite';

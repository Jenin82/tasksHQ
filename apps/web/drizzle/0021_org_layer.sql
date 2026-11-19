CREATE TABLE `org` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `org_invite` (
	`email` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `org_member` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Team membership implies org membership. OR IGNORE keeps an existing org role.
CREATE TRIGGER team_member_join_org
AFTER INSERT ON team_member
BEGIN
  INSERT OR IGNORE INTO org_member (user_id, role, created_at) VALUES (NEW.user_id, 'member', NEW.created_at);
END;
--> statement-breakpoint
-- Leaving the org leaves every team. project_member and team_reporting_line
-- rows cascade from team_member through their ON DELETE CASCADE foreign keys.
CREATE TRIGGER org_member_leave_teams
AFTER DELETE ON org_member
BEGIN
  DELETE FROM team_member WHERE user_id = OLD.user_id;
END;
--> statement-breakpoint
-- The single org takes the oldest team's name; fresh installs get a default.
INSERT INTO `org` (`id`, `name`, `created_at`)
SELECT 'org',
  COALESCE((SELECT `name` FROM `team` ORDER BY `created_at`, `id` LIMIT 1), 'TasksHQ'),
  COALESCE(
    (SELECT `created_at` FROM `team` ORDER BY `created_at`, `id` LIMIT 1),
    CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  );
--> statement-breakpoint
INSERT OR IGNORE INTO `org_member` (`user_id`, `role`, `created_at`)
SELECT `user_id`, 'member', MIN(`created_at`) FROM `team_member`
WHERE `user_id` <> 'system-automation'
GROUP BY `user_id`;
--> statement-breakpoint
UPDATE `org_member` SET `role` = 'owner'
WHERE `user_id` IN (SELECT `user_id` FROM `team_member` WHERE `role` = 'owner');

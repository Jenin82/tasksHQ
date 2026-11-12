CREATE TABLE `org_reporting_line` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`lead_user_id` text NOT NULL,
	FOREIGN KEY (`org_id`,`user_id`) REFERENCES `org_member`(`org_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`,`lead_user_id`) REFERENCES `org_member`(`org_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_reporting_line_org_user_unique` ON `org_reporting_line` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `org_reporting_line_org_lead_idx` ON `org_reporting_line` (`org_id`,`lead_user_id`);--> statement-breakpoint
CREATE TABLE `project_invite` (
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_invite_project_email_unique` ON `project_invite` (`project_id`,`email`);--> statement-breakpoint
CREATE INDEX `project_invite_email_idx` ON `project_invite` (`email`);--> statement-breakpoint
ALTER TABLE `project_member` ADD `role` text DEFAULT 'member' NOT NULL;
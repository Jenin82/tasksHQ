CREATE TABLE `project_slack` (
	`project_id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`encrypted_webhook` text NOT NULL,
	`last_error` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `slack_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`revision` text NOT NULL,
	`payload` text NOT NULL,
	`ready_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `project_slack`(`project_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `slack_outbox_project_order_idx` ON `slack_outbox` (`project_id`,`revision`,`id`);--> statement-breakpoint
CREATE INDEX `slack_outbox_ready_idx` ON `slack_outbox` (`ready_at`);
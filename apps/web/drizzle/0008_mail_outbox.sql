CREATE TABLE `mail_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`recipient` text NOT NULL,
	`invite_version` integer,
	`ready_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_id` text
);
--> statement-breakpoint
CREATE INDEX `mail_outbox_ready_idx` ON `mail_outbox` (`ready_at`);
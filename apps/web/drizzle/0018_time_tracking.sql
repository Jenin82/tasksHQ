CREATE TABLE `time_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`note` text,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`auto_stopped` integer DEFAULT false NOT NULL,
	`edited_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "time_entry_ended_after_started" CHECK("time_entry"."ended_at" is null or "time_entry"."ended_at" >= "time_entry"."started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_entry_running_user_unique` ON `time_entry` (`user_id`) WHERE "time_entry"."ended_at" is null;--> statement-breakpoint
CREATE INDEX `time_entry_org_id_started_at_idx` ON `time_entry` (`org_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `time_entry_user_id_started_at_idx` ON `time_entry` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `time_entry_task_id_idx` ON `time_entry` (`task_id`);--> statement-breakpoint
ALTER TABLE `user` ADD `timezone` text;
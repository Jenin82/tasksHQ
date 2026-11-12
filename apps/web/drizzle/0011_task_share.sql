CREATE TABLE `task_share` (
	`code` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_share_location_idx` ON `task_share` (`task_id`,`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `task_share_project_id_idx` ON `task_share` (`project_id`);
CREATE TABLE `task_project_alias` (
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`task_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `number`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_project_alias_task_id_idx` ON `task_project_alias` (`task_id`);
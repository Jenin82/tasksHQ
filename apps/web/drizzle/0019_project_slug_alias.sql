CREATE TABLE `project_slug_alias` (
	`org_id` text NOT NULL,
	`slug` text NOT NULL,
	`project_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`org_id`, `slug`),
	FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_slug_alias_project_id_idx` ON `project_slug_alias` (`project_id`);
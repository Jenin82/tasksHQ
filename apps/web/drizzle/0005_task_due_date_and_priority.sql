ALTER TABLE `task` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `task` ADD `priority` text DEFAULT 'medium' NOT NULL;
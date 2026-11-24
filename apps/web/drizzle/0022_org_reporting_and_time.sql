CREATE TABLE `reporting_line` (
	`user_id` text PRIMARY KEY NOT NULL,
	`lead_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `org_member`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_user_id`) REFERENCES `org_member`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reporting_line_not_self" CHECK("reporting_line"."user_id" <> "reporting_line"."lead_user_id")
);
--> statement-breakpoint
CREATE INDEX `reporting_line_lead_user_id_idx` ON `reporting_line` (`lead_user_id`);--> statement-breakpoint
CREATE INDEX `time_entry_started_at_idx` ON `time_entry` (`started_at`);--> statement-breakpoint
-- Reporting lines move from per team to org wide. Each person keeps the line
-- from their oldest team; lines naming someone outside the org, or themselves,
-- are dropped. team_reporting_line stays for the old Worker until 0024.
INSERT INTO `reporting_line` (`user_id`, `lead_user_id`, `created_at`)
SELECT `user_id`, `lead_user_id`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
FROM (
  SELECT `line`.`user_id`, `line`.`lead_user_id`,
    row_number() OVER (PARTITION BY `line`.`user_id` ORDER BY `team`.`created_at`, `team`.`id`) AS `rn`
  FROM `team_reporting_line` AS `line`
  JOIN `team` ON `team`.`id` = `line`.`team_id`
  WHERE `line`.`user_id` <> `line`.`lead_user_id`
    AND `line`.`user_id` IN (SELECT `user_id` FROM `org_member`)
    AND `line`.`lead_user_id` IN (SELECT `user_id` FROM `org_member`)
)
WHERE `rn` = 1;
--> statement-breakpoint
-- Lines merged from different teams can form cycles. Drop every line whose
-- person reaches themselves through their leads; people who only feed into a
-- cycle keep theirs. UNION over (start, cur) pairs terminates.
WITH RECURSIVE `chain`(`start`, `cur`) AS (
  SELECT `user_id`, `lead_user_id` FROM `reporting_line`
  UNION
  SELECT `chain`.`start`, `line`.`lead_user_id`
  FROM `chain` JOIN `reporting_line` AS `line` ON `line`.`user_id` = `chain`.`cur`
)
DELETE FROM `reporting_line` WHERE `user_id` IN (SELECT `start` FROM `chain` WHERE `cur` = `start`);

UPDATE `status`
SET `color` = CASE `category`
  WHEN 'in_progress' THEN 'blue'
  WHEN 'done' THEN 'green'
  ELSE 'gray'
END
WHERE `color` IS NULL;
--> statement-breakpoint
ALTER TABLE `status` DROP COLUMN `category`;

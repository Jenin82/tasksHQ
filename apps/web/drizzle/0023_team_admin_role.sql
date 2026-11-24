-- Teams have only Admin and Member roles now; every team owner becomes a team admin.
-- Data only: no table is rebuilt, so the hand-made triggers stand.
UPDATE `team_member` SET `role` = 'admin' WHERE `role` = 'owner';--> statement-breakpoint
UPDATE `team_invite` SET `role` = 'admin' WHERE `role` = 'owner';

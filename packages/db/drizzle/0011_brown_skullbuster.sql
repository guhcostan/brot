CREATE TABLE `browser_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `bots` ADD `browser_profile_id` text;--> statement-breakpoint
CREATE INDEX `runs_started_idx` ON `runs` (`started_at`);
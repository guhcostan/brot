CREATE TABLE `routine_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`run_id` text,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `routine_runs_routine_idx` ON `routine_runs` (`routine_id`);--> statement-breakpoint
CREATE INDEX `routine_runs_started_idx` ON `routine_runs` (`started_at`);--> statement-breakpoint
ALTER TABLE `routines` ADD `catch_up` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `routines` ADD `remember_last_run` integer DEFAULT false NOT NULL;
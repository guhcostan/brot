CREATE TABLE `memory_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text,
	`bot_id` text,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`action` text NOT NULL,
	`content_before` text,
	`content_after` text,
	`source_run_id` text,
	`at` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memory_journal_bot_idx` ON `memory_journal` (`bot_id`);--> statement-breakpoint
CREATE INDEX `memory_journal_at_idx` ON `memory_journal` (`at`);
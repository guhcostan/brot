PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text,
	`scope` text DEFAULT 'bot' NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`source_run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_memories`("id", "bot_id", "scope", "kind", "content", "source_run_id", "created_at", "updated_at") SELECT "id", "bot_id", 'bot', "kind", "content", "source_run_id", "created_at", "updated_at" FROM `memories`;--> statement-breakpoint
DROP TABLE `memories`;--> statement-breakpoint
ALTER TABLE `__new_memories` RENAME TO `memories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `memories_bot_idx` ON `memories` (`bot_id`);
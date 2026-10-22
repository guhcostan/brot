CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_read_idx` ON `notifications` (`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_bot_idx` ON `notifications` (`bot_id`);--> statement-breakpoint
ALTER TABLE `bots` ADD `notifications` integer DEFAULT true NOT NULL;
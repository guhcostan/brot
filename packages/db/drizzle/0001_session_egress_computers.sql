CREATE TABLE `computers` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`state` text NOT NULL,
	`image` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `computers_bot_uq` ON `computers` (`bot_id`);--> statement-breakpoint
ALTER TABLE `bots` ADD `egress` text DEFAULT '{"mode":"deny","allow":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `engine_session_id` text;
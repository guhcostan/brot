CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `attachments_thread_idx` ON `attachments` (`thread_id`);--> statement-breakpoint
CREATE INDEX `attachments_message_idx` ON `attachments` (`message_id`);
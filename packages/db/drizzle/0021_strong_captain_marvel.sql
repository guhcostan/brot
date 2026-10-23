CREATE TABLE `room_batons` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);

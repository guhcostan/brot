CREATE TABLE `bot_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`job` text NOT NULL,
	`instructions` text NOT NULL,
	`avatar` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

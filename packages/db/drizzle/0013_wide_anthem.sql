CREATE TABLE `saved_logins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`label` text,
	`username_secret` text NOT NULL,
	`password_secret` text NOT NULL,
	`totp_secret` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_logins_name_unique` ON `saved_logins` (`name`);
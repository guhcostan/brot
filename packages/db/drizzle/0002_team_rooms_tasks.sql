CREATE TABLE `room_members` (
	`thread_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`thread_id`, `bot_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`assignee_bot_id` text NOT NULL,
	`created_by_bot_id` text,
	`created_by_user` integer NOT NULL,
	`parent_task_id` text,
	`thread_id` text NOT NULL,
	`work_thread_id` text,
	`result` text,
	`chain_id` text NOT NULL,
	`depth` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assignee_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_assignee_idx` ON `tasks` (`assignee_bot_id`);--> statement-breakpoint
CREATE INDEX `tasks_chain_idx` ON `tasks` (`chain_id`);--> statement-breakpoint
CREATE INDEX `tasks_thread_idx` ON `tasks` (`thread_id`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_task_id`);--> statement-breakpoint
CREATE TABLE `thread_sessions` (
	`thread_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`engine_session_id` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`thread_id`, `bot_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `bots` ADD `team_budget_usd` real;--> statement-breakpoint
ALTER TABLE `messages` ADD `author_bot_id` text REFERENCES bots(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `messages` ADD `mentions` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `via_bot_id` text REFERENCES bots(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `threads` ADD `kind` text DEFAULT 'dm' NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `lead_bot_id` text REFERENCES bots(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `threads` ADD `responder` text;
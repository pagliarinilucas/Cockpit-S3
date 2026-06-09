CREATE TABLE `activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`bucket` text DEFAULT '—' NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`endpoint` text NOT NULL,
	`region` text DEFAULT 'garage' NOT NULL,
	`access_key` text NOT NULL,
	`secret_key` text NOT NULL,
	`buckets` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `grants` (
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`bucket_id` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`perm` text NOT NULL,
	PRIMARY KEY(`subject_type`, `subject_id`, `bucket_id`, `prefix`)
);
--> statement-breakpoint
CREATE INDEX `idx_grants_subject` ON `grants` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `idx_grants_bucket` ON `grants` (`bucket_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_unique` ON `groups` (`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`username` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`rotated_to` text,
	`revoked` integer DEFAULT 0 NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`username`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_sessions_family` ON `sessions` (`family_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`username`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_blocks` (
	`username` text NOT NULL,
	`bucket_id` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`username`, `bucket_id`, `prefix`),
	FOREIGN KEY (`username`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_groups` (
	`username` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`username`, `group_id`),
	FOREIGN KEY (`username`) REFERENCES `users`(`username`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`username` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`token_version` integer DEFAULT 1 NOT NULL,
	`grants` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`last_login` text
);

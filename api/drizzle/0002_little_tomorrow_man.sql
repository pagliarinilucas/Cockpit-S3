CREATE TABLE `clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`admin_endpoint` text NOT NULL,
	`admin_token` text NOT NULL,
	`s3_endpoint` text NOT NULL,
	`region` text DEFAULT 'garage' NOT NULL,
	`internal_key_id` text,
	`internal_secret` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `connections` DROP COLUMN `admin_endpoint`;--> statement-breakpoint
ALTER TABLE `connections` DROP COLUMN `admin_token`;
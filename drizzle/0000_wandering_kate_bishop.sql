CREATE TABLE `private_spc` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_uid` text NOT NULL,
	`chart_id` text,
	`payload_hash` text NOT NULL,
	`total_bytes` integer NOT NULL,
	`note_count` integer NOT NULL,
	`aggregate_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `private_spc_owner_hash` ON `private_spc` (`owner_uid`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `private_spc_owner_created` ON `private_spc` (`owner_uid`,`created_at`);--> statement-breakpoint
CREATE TABLE `private_spc_chunk` (
	`chart_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`payload` blob NOT NULL,
	PRIMARY KEY(`chart_id`, `chunk_index`),
	FOREIGN KEY (`chart_id`) REFERENCES `private_spc`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `private_spc_rate` (
	`owner_uid` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`writes` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `private_spc_rate_updated` ON `private_spc_rate` (`updated_at`);
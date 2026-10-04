CREATE TABLE `builtin_chart` (
	`chart_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`plain_sha256` text NOT NULL,
	`plain_bytes` integer NOT NULL,
	`iv` blob NOT NULL,
	`cipher_bytes` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`cipher_sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "builtin_version" CHECK("builtin_chart"."version"=1),
	CONSTRAINT "builtin_iv" CHECK(length("builtin_chart"."iv")=12),
	CONSTRAINT "builtin_size" CHECK("builtin_chart"."plain_bytes">0 AND "builtin_chart"."plain_bytes"<=141703 AND "builtin_chart"."cipher_bytes"="builtin_chart"."plain_bytes"+16 AND "builtin_chart"."chunk_count" BETWEEN 1 AND 3),
	CONSTRAINT "builtin_hashes" CHECK(length("builtin_chart"."plain_sha256")=64 AND length("builtin_chart"."cipher_sha256")=64)
);
--> statement-breakpoint
CREATE TABLE `builtin_chart_chunk` (
	`chart_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`payload` blob NOT NULL,
	PRIMARY KEY(`chart_id`, `chunk_index`),
	FOREIGN KEY (`chart_id`) REFERENCES `builtin_chart`(`chart_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "builtin_chunk_index" CHECK("builtin_chart_chunk"."chunk_index" BETWEEN 0 AND 2),
	CONSTRAINT "builtin_chunk_size" CHECK(length("builtin_chart_chunk"."payload") BETWEEN 1 AND 65536)
);

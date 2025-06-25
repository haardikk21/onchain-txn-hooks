CREATE TABLE `contracts` (
	`address` text PRIMARY KEY NOT NULL,
	`abi` text NOT NULL,
	`is_verified` integer DEFAULT true NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	`last_fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contracts_last_fetched_idx` ON `contracts` (`last_fetched_at`);
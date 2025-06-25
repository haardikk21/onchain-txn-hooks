CREATE TABLE `auction_bids` (
	`id` text PRIMARY KEY NOT NULL,
	`event_signature` text NOT NULL,
	`bidder` text NOT NULL,
	`amount` text NOT NULL,
	`timestamp` integer NOT NULL,
	`transaction_hash` text NOT NULL,
	`is_winning` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auction_bids_event_signature_idx` ON `auction_bids` (`event_signature`);--> statement-breakpoint
CREATE INDEX `auction_bids_bidder_idx` ON `auction_bids` (`bidder`);--> statement-breakpoint
CREATE INDEX `auction_bids_timestamp_idx` ON `auction_bids` (`timestamp`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_address` text NOT NULL,
	`issued_at` text NOT NULL,
	`expiration_time` text NOT NULL,
	`nonce` text NOT NULL,
	`is_valid` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_address`) REFERENCES `users`(`address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_address_idx` ON `auth_sessions` (`user_address`);--> statement-breakpoint
CREATE INDEX `auth_sessions_nonce_idx` ON `auth_sessions` (`nonce`);--> statement-breakpoint
CREATE TABLE `detected_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_signature_id` text NOT NULL,
	`transaction_hash` text NOT NULL,
	`block_number` text NOT NULL,
	`log_index` integer NOT NULL,
	`args` text NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`event_signature_id`) REFERENCES `event_signatures`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `detected_events_event_signature_id_idx` ON `detected_events` (`event_signature_id`);--> statement-breakpoint
CREATE INDEX `detected_events_transaction_hash_idx` ON `detected_events` (`transaction_hash`);--> statement-breakpoint
CREATE INDEX `detected_events_block_number_idx` ON `detected_events` (`block_number`);--> statement-breakpoint
CREATE INDEX `detected_events_timestamp_idx` ON `detected_events` (`timestamp`);--> statement-breakpoint
CREATE TABLE `event_auctions` (
	`event_signature` text PRIMARY KEY NOT NULL,
	`current_bidder` text,
	`current_bid` text DEFAULT '0' NOT NULL,
	`minimum_bid` text DEFAULT '0' NOT NULL,
	`last_bid_time` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_auctions_current_bidder_idx` ON `event_auctions` (`current_bidder`);--> statement-breakpoint
CREATE INDEX `event_auctions_is_active_idx` ON `event_auctions` (`is_active`);--> statement-breakpoint
CREATE TABLE `event_hooks` (
	`id` text PRIMARY KEY NOT NULL,
	`event_signature` text NOT NULL,
	`automation_wallet` text NOT NULL,
	`transaction_template_id` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`execution_count` integer DEFAULT 0 NOT NULL,
	`last_executed` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`automation_wallet`) REFERENCES `user_wallets`(`automation_address`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_template_id`) REFERENCES `transaction_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_hooks_event_signature_idx` ON `event_hooks` (`event_signature`);--> statement-breakpoint
CREATE INDEX `event_hooks_automation_wallet_idx` ON `event_hooks` (`automation_wallet`);--> statement-breakpoint
CREATE INDEX `event_hooks_is_active_idx` ON `event_hooks` (`is_active`);--> statement-breakpoint
CREATE TABLE `event_signatures` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_address` text NOT NULL,
	`event_name` text NOT NULL,
	`signature` text NOT NULL,
	`abi` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_signatures_contract_address_idx` ON `event_signatures` (`contract_address`);--> statement-breakpoint
CREATE INDEX `event_signatures_signature_idx` ON `event_signatures` (`signature`);--> statement-breakpoint
CREATE TABLE `hook_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`hook_id` text NOT NULL,
	`trigger_event_id` text NOT NULL,
	`execution_tx_hash` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`gas_used` text,
	`fee_charged` text NOT NULL,
	`error_message` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`hook_id`) REFERENCES `event_hooks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trigger_event_id`) REFERENCES `detected_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hook_executions_hook_id_idx` ON `hook_executions` (`hook_id`);--> statement-breakpoint
CREATE INDEX `hook_executions_trigger_event_id_idx` ON `hook_executions` (`trigger_event_id`);--> statement-breakpoint
CREATE INDEX `hook_executions_status_idx` ON `hook_executions` (`status`);--> statement-breakpoint
CREATE INDEX `hook_executions_timestamp_idx` ON `hook_executions` (`timestamp`);--> statement-breakpoint
CREATE TABLE `transaction_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`calls` text NOT NULL,
	`required_variables` text NOT NULL,
	`estimated_gas` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transaction_templates_name_idx` ON `transaction_templates` (`name`);--> statement-breakpoint
CREATE INDEX `transaction_templates_created_at_idx` ON `transaction_templates` (`created_at`);--> statement-breakpoint
CREATE TABLE `user_wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`automation_address` text NOT NULL,
	`private_key_encrypted` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `users`(`address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_wallets_automation_address_unique` ON `user_wallets` (`automation_address`);--> statement-breakpoint
CREATE INDEX `user_wallets_owner_idx` ON `user_wallets` (`owner`);--> statement-breakpoint
CREATE INDEX `user_wallets_automation_address_idx` ON `user_wallets` (`automation_address`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_address_unique` ON `users` (`address`);--> statement-breakpoint
CREATE INDEX `users_address_idx` ON `users` (`address`);
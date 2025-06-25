import { sqliteTable, text, integer, blob, index } from 'drizzle-orm/sqlite-core';

// Users table - main wallet addresses authenticated via SIWE
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  address: text('address').notNull().unique(), // Main wallet address from RainbowKit
  createdAt: integer('created_at').notNull(),
  lastLoginAt: integer('last_login_at').notNull(),
}, (table) => ({
  addressIdx: index('users_address_idx').on(table.address),
}));

// User HookConsumer contracts - user-deployed contracts implementing trigger interface
export const hookConsumers = sqliteTable('hook_consumers', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull().references(() => users.address), // Links to users.address
  contractAddress: text('contract_address').notNull().unique(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  ownerIdx: index('hook_consumers_owner_idx').on(table.owner),
  contractAddressIdx: index('hook_consumers_contract_address_idx').on(table.contractAddress),
}));

// Authentication sessions for SIWE
export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey(),
  userAddress: text('user_address').notNull().references(() => users.address),
  issuedAt: text('issued_at').notNull(), // ISO string
  expirationTime: text('expiration_time').notNull(), // ISO string
  nonce: text('nonce').notNull(),
  isValid: integer('is_valid', { mode: 'boolean' }).notNull().default(true),
}, (table) => ({
  userAddressIdx: index('auth_sessions_user_address_idx').on(table.userAddress),
  nonceIdx: index('auth_sessions_nonce_idx').on(table.nonce),
}));

// Cached contract ABIs from Etherscan
export const contracts = sqliteTable('contracts', {
  address: text('address').primaryKey(), // Contract address
  abi: text('abi', { mode: 'json' }).notNull(), // JSON serialized ABI
  isVerified: integer('is_verified', { mode: 'boolean' }).notNull().default(true),
  name: text('name'), // Contract name if available
  createdAt: integer('created_at').notNull(),
  lastFetchedAt: integer('last_fetched_at').notNull(),
}, (table) => ({
  lastFetchedIdx: index('contracts_last_fetched_idx').on(table.lastFetchedAt),
}));

// Event signatures that users can bid on
export const eventSignatures = sqliteTable('event_signatures', {
  id: text('id').primaryKey(),
  contractAddress: text('contract_address').notNull(),
  eventName: text('event_name').notNull(),
  signature: text('signature').notNull(), // e.g., "PoolCreated(address,address,uint24,int24,address)"
  abi: text('abi', { mode: 'json' }).notNull(), // JSON serialized ABI
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  contractAddressIdx: index('event_signatures_contract_address_idx').on(table.contractAddress),
  signatureIdx: index('event_signatures_signature_idx').on(table.signature),
}));

// Auction bids for event signatures
export const auctionBids = sqliteTable('auction_bids', {
  id: text('id').primaryKey(),
  eventSignature: text('event_signature').notNull(),
  bidder: text('bidder').notNull(),
  amount: text('amount').notNull(), // BigInt as string
  timestamp: integer('timestamp').notNull(),
  transactionHash: text('transaction_hash').notNull(),
  isWinning: integer('is_winning', { mode: 'boolean' }).notNull().default(false),
}, (table) => ({
  eventSignatureIdx: index('auction_bids_event_signature_idx').on(table.eventSignature),
  bidderIdx: index('auction_bids_bidder_idx').on(table.bidder),
  timestampIdx: index('auction_bids_timestamp_idx').on(table.timestamp),
}));

// Current auction state for event signatures
export const eventAuctions = sqliteTable('event_auctions', {
  eventSignature: text('event_signature').primaryKey(),
  currentBidder: text('current_bidder'),
  currentBid: text('current_bid').notNull().default('0'), // BigInt as string
  minimumBid: text('minimum_bid').notNull().default('0'), // BigInt as string
  lastBidTime: integer('last_bid_time').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
}, (table) => ({
  currentBidderIdx: index('event_auctions_current_bidder_idx').on(table.currentBidder),
  isActiveIdx: index('event_auctions_is_active_idx').on(table.isActive),
}));

// Transaction templates for automation
export const transactionTemplates = sqliteTable('transaction_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  calls: text('calls', { mode: 'json' }).notNull(), // JSON array of TransactionCall
  requiredVariables: text('required_variables', { mode: 'json' }).notNull(), // JSON array of VariableReference
  estimatedGas: integer('estimated_gas').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  nameIdx: index('transaction_templates_name_idx').on(table.name),
  createdAtIdx: index('transaction_templates_created_at_idx').on(table.createdAt),
}));

// Event hooks - user configurations for automation (updated for HookConsumer pattern)
export const eventHooks = sqliteTable('event_hooks', {
  id: text('id').primaryKey(),
  eventSignature: text('event_signature').notNull(),
  hookConsumer: text('hook_consumer').notNull().references(() => hookConsumers.contractAddress),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  executionCount: integer('execution_count').notNull().default(0),
  lastExecuted: integer('last_executed'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  eventSignatureIdx: index('event_hooks_event_signature_idx').on(table.eventSignature),
  hookConsumerIdx: index('event_hooks_hook_consumer_idx').on(table.hookConsumer),
  isActiveIdx: index('event_hooks_is_active_idx').on(table.isActive),
}));

// Detected events from blockchain monitoring
export const detectedEvents = sqliteTable('detected_events', {
  id: text('id').primaryKey(),
  eventSignatureId: text('event_signature_id').notNull().references(() => eventSignatures.id),
  transactionHash: text('transaction_hash').notNull(),
  blockNumber: text('block_number').notNull(), // BigInt as string
  logIndex: integer('log_index').notNull(),
  args: text('args', { mode: 'json' }).notNull(), // JSON object of parsed event arguments
  timestamp: integer('timestamp').notNull(),
}, (table) => ({
  eventSignatureIdIdx: index('detected_events_event_signature_id_idx').on(table.eventSignatureId),
  transactionHashIdx: index('detected_events_transaction_hash_idx').on(table.transactionHash),
  blockNumberIdx: index('detected_events_block_number_idx').on(table.blockNumber),
  timestampIdx: index('detected_events_timestamp_idx').on(table.timestamp),
}));

// Hook executions - logs of automated transactions
export const hookExecutions = sqliteTable('hook_executions', {
  id: text('id').primaryKey(),
  hookId: text('hook_id').notNull().references(() => eventHooks.id),
  triggerEventId: text('trigger_event_id').notNull().references(() => detectedEvents.id),
  executionTxHash: text('execution_tx_hash'),
  status: text('status').notNull().default('pending'), // 'pending' | 'success' | 'failed'
  gasUsed: text('gas_used'), // BigInt as string
  feeCharged: text('fee_charged').notNull(), // BigInt as string
  errorMessage: text('error_message'),
  timestamp: integer('timestamp').notNull(),
}, (table) => ({
  hookIdIdx: index('hook_executions_hook_id_idx').on(table.hookId),
  triggerEventIdIdx: index('hook_executions_trigger_event_id_idx').on(table.triggerEventId),
  statusIdx: index('hook_executions_status_idx').on(table.status),
  timestampIdx: index('hook_executions_timestamp_idx').on(table.timestamp),
}));
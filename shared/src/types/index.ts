import type { AbiEvent, Address, Hash, Log } from 'viem';

// Core Event Types
export type EventSignature = {
  contractAddress: Address;
  eventName: string;
  signature: string; // e.g., "PoolCreated(address,address,uint24,int24,address)"
  abi: AbiEvent;
};

export type DetectedEvent = {
  signature: EventSignature;
  transactionHash: Hash;
  blockNumber: bigint;
  logIndex: number;
  args: Record<string, any>; // Parsed event arguments
  timestamp: number;
};

// Variable and Template Types
export type VariableReference = {
  name: string; // e.g., "$token0", "$pool"
  path: string; // e.g., "event.args.token0"
  type: "event" | "system" | "user";
};

export type SystemVariable = {
  name: string; // e.g., "{{userWallet}}", "{{block.timestamp}}"
  resolver: string; // How to resolve this variable
};

export type TransactionCall = {
  target: Address; // Contract address
  value: bigint; // ETH value (in wei)
  calldata: `0x${string}`; // Function signature + encoded params
  variables: VariableReference[]; // Variables used in this call
};

export type TransactionTemplate = {
  id: string;
  name: string;
  description: string;
  calls: TransactionCall[]; // Multicall sequence
  requiredVariables: VariableReference[];
  estimatedGas: number;
  createdAt: number;
  updatedAt: number;
};

// Auction Types
export type EventAuction = {
  eventSignature: string;
  currentBidder: Address | null;
  currentBid: bigint; // Wei amount
  minimumBid: bigint; // Wei amount
  lastBidTime: number;
  isActive: boolean;
};

export type AuctionBid = {
  id: string;
  eventSignature: string;
  bidder: Address;
  amount: bigint; // Wei amount
  timestamp: number;
  transactionHash: Hash;
  isWinning: boolean;
};

// HookConsumer Types (replaces UserWallet system)
export type HookConsumer = {
  id: string;
  owner: Address; // User's main wallet address (connected via RainbowKit)
  contractAddress: Address; // Deployed HookConsumer contract address
  isActive: boolean;
  createdAt: number;
};

// Hook Configuration Types (updated for HookConsumer pattern)
export type EventHook = {
  id: string;
  eventSignature: string;
  hookConsumer: Address; // Points to user's deployed HookConsumer contract
  isActive: boolean;
  executionCount: number;
  lastExecuted: number | null;
  createdAt: number;
};

export type HookExecution = {
  id: string;
  hookId: string;
  triggerEvent: DetectedEvent;
  executionTxHash: Hash | null;
  status: "pending" | "success" | "failed";
  gasUsed: bigint | null;
  feeCharged: bigint; // Wei amount
  errorMessage: string | null;
  timestamp: number;
};

// API Response Types
export type ApiResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};

// Authentication Types
export type SiweMessage = {
  message: string;
  signature: `0x${string}`;
};

export type AuthSession = {
  id: string;
  userAddress: Address;
  issuedAt: string;
  expirationTime: string;
  nonce: string;
  isValid: boolean;
};

export type User = {
  id: string;
  address: Address; // Main wallet address from RainbowKit
  hookConsumers: HookConsumer[]; // User's deployed HookConsumer contracts
  createdAt: number;
  lastLoginAt: number;
};

// WebSocket Message Types
export type WSMessage = {
  type: "event_detected" | "hook_executed" | "auction_update" | "hook_consumer_update";
  data: DetectedEvent | HookExecution | EventAuction | HookConsumer;
  timestamp: number;
};

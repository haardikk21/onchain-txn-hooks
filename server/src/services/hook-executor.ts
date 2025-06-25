import { 
  createWalletClient, 
  createPublicClient,
  http, 
  type Address, 
  type Hash, 
  encodeFunctionData,
  keccak256,
  toHex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { EventHookAuctionABI } from 'shared/src/abis/EventHookAuction.js';
import { IHookConsumerABI } from 'shared/src/abis/IHookConsumer.js';
import { db, hookExecutions, eventAuctions } from '../db/index.js';
import { eq } from 'drizzle-orm';

import type { DetectedEvent as SharedDetectedEvent } from 'shared/dist';

interface DetectedEvent {
  contractAddress: Address;
  topics: `0x${string}`[];
  data: `0x${string}`;
  blockNumber: bigint;
  blockTimestamp: bigint;
  transactionHash: Hash;
  logIndex: number;
}

interface EventFilter {
  contractAddress: Address;
  topic0: `0x${string}`;
  topic1: `0x${string}`;
  topic2: `0x${string}`;
  topic3: `0x${string}`;
  useTopic1: boolean;
  useTopic2: boolean;
  useTopic3: boolean;
}

interface ExecutionResult {
  success: boolean;
  transactionHash?: Hash;
  error?: string;
}

export class HookExecutor {
  private rpcUrl: string;
  private sendRawTxSyncUrl: string;
  private multicallAddress: Address;
  private auctionContractAddress: Address;
  private executorPrivateKey: `0x${string}`;
  private vaultAddress: Address;

  constructor(
    rpcUrl: string, 
    sendRawTxSyncUrl: string, 
    multicallAddress: Address,
    auctionContractAddress: Address,
    executorPrivateKey: `0x${string}`,
    vaultAddress: Address
  ) {
    this.rpcUrl = rpcUrl;
    this.sendRawTxSyncUrl = sendRawTxSyncUrl;
    this.multicallAddress = multicallAddress;
    this.auctionContractAddress = auctionContractAddress;
    this.executorPrivateKey = executorPrivateKey;
    this.vaultAddress = vaultAddress;
  }

  /**
   * Process a detected event and execute any matching hook (from shared types)
   */
  async processEvent(sharedEvent: SharedDetectedEvent): Promise<void> {
    // Convert shared event to internal format
    const event: DetectedEvent = this.convertSharedEvent(sharedEvent);
    return this.processInternalEvent(event);
  }

  /**
   * Convert shared DetectedEvent to internal format
   */
  private convertSharedEvent(sharedEvent: SharedDetectedEvent): DetectedEvent {
    // For now, create a basic conversion - in a real implementation,
    // we'd need to properly extract topics and data from the log
    return {
      contractAddress: sharedEvent.signature.contractAddress,
      topics: ['0x0000000000000000000000000000000000000000000000000000000000000000'], // Placeholder
      data: '0x',
      blockNumber: sharedEvent.blockNumber,
      blockTimestamp: BigInt(sharedEvent.timestamp),
      transactionHash: sharedEvent.transactionHash,
      logIndex: sharedEvent.logIndex
    };
  }

  /**
   * Process a detected event and execute any matching hook (internal format)
   */
  private async processInternalEvent(event: DetectedEvent): Promise<void> {
    try {
      console.log(`Processing event from ${event.contractAddress} with topic0: ${event.topics[0]}`);

      // Create event filter from the detected event
      const eventFilter = this.createEventFilter(event);
      
      // Get filter hash to find auction winner
      const filterHash = await this.getFilterHash(eventFilter);
      
      // Find auction winner for this filter
      const winner = await this.getAuctionWinner(filterHash);
      if (!winner) {
        console.log('No auction winner found for this event filter');
        return;
      }

      console.log(`Found auction winner: ${winner.bidder}, executing hook...`);

      // Execute the hook
      const result = await this.executeHook(eventFilter, event, winner);
      
      if (result.success) {
        console.log(`Hook executed successfully: ${result.transactionHash}`);
      } else {
        console.error(`Hook execution failed: ${result.error}`);
      }

    } catch (error) {
      console.error('Error processing event:', error);
    }
  }

  /**
   * Execute hook by calling user's HookConsumer contract and withdrawing fees
   */
  private async executeHook(
    eventFilter: EventFilter, 
    event: DetectedEvent,
    winner: { bidder: Address; hookConsumerAddress: Address }
  ): Promise<ExecutionResult> {
    try {
      // Create executor account
      const executorAccount = privateKeyToAccount(this.executorPrivateKey);
      
      // Create clients
      const walletClient = createWalletClient({
        account: executorAccount,
        chain: baseSepolia,
        transport: http(this.rpcUrl),
      });

      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(this.rpcUrl),
      });

      // Get current nonce for executor
      const nonce = await publicClient.getTransactionCount({
        address: executorAccount.address,
        blockTag: 'pending',
      });

      // Create EventLog struct for HookConsumer
      const eventLog = {
        contractAddress: event.contractAddress,
        topics: event.topics,
        data: event.data,
        blockNumber: event.blockNumber,
        blockTimestamp: event.blockTimestamp,
        transactionHash: event.transactionHash,
        logIndex: BigInt(event.logIndex)
      };

      // Encode HookConsumer trigger call
      const triggerCalldata = encodeFunctionData({
        abi: IHookConsumerABI,
        functionName: 'trigger',
        args: [eventFilter, eventLog, event.blockNumber, event.blockTimestamp]
      });

      // Create signature for withdrawal
      const filterHash = await this.getFilterHash(eventFilter);
      const executorNonce = await this.getExecutorNonce();
      const signature = await this.createWithdrawalSignature(
        filterHash, 
        this.vaultAddress, 
        executorNonce, 
        winner.bidder
      );

      // Encode withdrawal call
      const withdrawalCalldata = encodeFunctionData({
        abi: EventHookAuctionABI,
        functionName: 'withdrawWinnings',
        args: [filterHash, this.vaultAddress, executorNonce, signature]
      });

      // Create multicall data
      const multicallData = this.encodeMulticallData([
        {
          target: winner.hookConsumerAddress,
          allowFailure: true, // Allow user contract to fail, but still collect fee
          callData: triggerCalldata
        },
        {
          target: this.auctionContractAddress,
          allowFailure: false, // Fee collection must succeed
          callData: withdrawalCalldata
        }
      ]);

      // Estimate gas
      const gasEstimate = await publicClient.estimateGas({
        to: this.multicallAddress,
        data: multicallData,
        account: executorAccount.address,
      });

      // Get gas price
      const gasPrice = await publicClient.getGasPrice();

      // Prepare transaction
      const txRequest = {
        to: this.multicallAddress,
        data: multicallData,
        gas: gasEstimate + BigInt(50000), // Add buffer
        gasPrice,
        nonce,
      };

      // Sign and send transaction
      const signedTx = await walletClient.signTransaction({
        ...txRequest,
        account: executorAccount,
      });

      const txHash = await this.sendRawTransactionSync(signedTx);

      // Record execution
      await this.recordExecution(filterHash, winner.bidder, txHash, 'pending');

      return { success: true, transactionHash: txHash };

    } catch (error) {
      console.error('Error executing hook:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Create event filter from detected event
   */
  private createEventFilter(event: DetectedEvent): EventFilter {
    return {
      contractAddress: event.contractAddress,
      topic0: event.topics[0] || '0x0000000000000000000000000000000000000000000000000000000000000000',
      topic1: event.topics[1] || '0x0000000000000000000000000000000000000000000000000000000000000000',
      topic2: event.topics[2] || '0x0000000000000000000000000000000000000000000000000000000000000000',
      topic3: event.topics[3] || '0x0000000000000000000000000000000000000000000000000000000000000000',
      useTopic1: false, // For exact matching, we'd need auction data to determine this
      useTopic2: false,
      useTopic3: false
    };
  }

  /**
   * Get filter hash using same algorithm as contract
   */
  private async getFilterHash(filter: EventFilter): Promise<`0x${string}`> {
    // Use same encoding as contract's getFilterHash function
    const encoded = encodeFunctionData({
      abi: EventHookAuctionABI,
      functionName: 'getFilterHash',
      args: [filter]
    });

    // Call the contract to get the hash
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.rpcUrl),
    });

    const result = await publicClient.call({
      to: this.auctionContractAddress,
      data: encoded
    });

    return result.data as `0x${string}`;
  }

  /**
   * Get auction winner for a filter hash
   */
  private async getAuctionWinner(filterHash: `0x${string}`): Promise<{
    bidder: Address;
    hookConsumerAddress: Address;
  } | null> {
    try {
      // Check database for auction state
      const auctions = await db.select()
        .from(eventAuctions)
        .where(eq(eventAuctions.eventSignature, filterHash))
        .limit(1);

      if (auctions.length === 0 || !auctions[0]?.currentBidder) {
        return null;
      }

      const auction = auctions[0];
      
      // For now, assume hookConsumerAddress is the same as bidder
      // In real implementation, this would be stored separately or queried from user profiles
      return {
        bidder: auction.currentBidder as Address,
        hookConsumerAddress: auction.currentBidder as Address, // TODO: Get from user profile
      };
    } catch (error) {
      console.error('Error getting auction winner:', error);
      return null;
    }
  }

  /**
   * Get executor's current nonce for signature
   */
  private async getExecutorNonce(): Promise<bigint> {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.rpcUrl),
    });

    const executorAccount = privateKeyToAccount(this.executorPrivateKey);
    const encoded = encodeFunctionData({
      abi: EventHookAuctionABI,
      functionName: 'nonces',
      args: [executorAccount.address]
    });

    const result = await publicClient.call({
      to: this.auctionContractAddress,
      data: encoded
    });

    return BigInt(result.data || '0');
  }

  /**
   * Create withdrawal signature for the winner
   */
  private async createWithdrawalSignature(
    filterHash: `0x${string}`,
    vault: Address,
    nonce: bigint,
    winner: Address
  ): Promise<`0x${string}`> {
    // Create executor account for signing
    const executorAccount = privateKeyToAccount(this.executorPrivateKey);
    
    // Create message hash exactly as per contract's withdrawWinnings function
    const messageHashData = keccak256(
      encodeFunctionData({
        abi: [{ type: 'function', name: 'encode', inputs: [
          { name: 'filterHash', type: 'bytes32' },
          { name: 'vault', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'contractAddress', type: 'address' }
        ]}],
        functionName: 'encode',
        args: [filterHash, vault, nonce, this.auctionContractAddress]
      })
    );

    // Add Ethereum signed message prefix (matches contract's "\x19Ethereum Signed Message:\n32")
    const prefixedHash = keccak256(
      `0x19457468657265756d205369676e6564204d6573736167653a0a3332${messageHashData.slice(2)}`
    );

    // Sign the prefixed hash with executor's private key
    const signature = await executorAccount.signMessage({
      message: { raw: prefixedHash }
    });

    return signature;
  }

  /**
   * Encode multicall data
   */
  private encodeMulticallData(calls: Array<{
    target: Address;
    allowFailure: boolean;
    callData: `0x${string}`;
  }>): `0x${string}` {
    const multicall3Abi = [{
      name: 'aggregate3',
      type: 'function',
      inputs: [{
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' }
        ]
      }],
      outputs: [{
        name: 'returnData',
        type: 'tuple[]',
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' }
        ]
      }]
    }];

    return encodeFunctionData({
      abi: multicall3Abi,
      functionName: 'aggregate3',
      args: [calls],
    });
  }

  /**
   * Send raw transaction for fastest execution
   */
  private async sendRawTransactionSync(signedTx: Hash): Promise<Hash> {
    const response = await fetch(this.sendRawTxSyncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_sendRawTransactionSync',
        params: [signedTx],
        id: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json() as any;
    
    if (result.error) {
      throw new Error(`RPC error: ${result.error.message}`);
    }

    return result.result as Hash;
  }

  /**
   * Record execution in database
   */
  private async recordExecution(
    filterHash: `0x${string}`,
    winner: Address,
    txHash: Hash,
    status: 'pending' | 'confirmed' | 'failed'
  ): Promise<void> {
    try {
      await db.insert(hookExecutions).values({
        id: `exec_${filterHash}_${Date.now()}`,
        hookId: filterHash, // Using filter hash as hook ID for now
        triggerEventId: txHash,
        executionTxHash: txHash,
        status,
        gasUsed: '0', // Will be updated later
        feeCharged: '0', // Will be calculated later
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error recording execution:', error);
    }
  }

  /**
   * Update execution status when receipt is available
   */
  async updateExecutionStatus(
    txHash: Hash,
    status: 'confirmed' | 'failed',
    gasUsed?: string
  ): Promise<void> {
    try {
      const updateData: any = { status };
      if (gasUsed) updateData.gasUsed = gasUsed;

      await db.update(hookExecutions)
        .set(updateData)
        .where(eq(hookExecutions.executionTxHash, txHash));

      console.log(`Updated execution ${txHash} status to ${status}`);
    } catch (error) {
      console.error('Error updating execution status:', error);
    }
  }
}
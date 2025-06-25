import { 
  createWalletClient, 
  createPublicClient,
  http, 
  type Address, 
  type Hash, 
  encodeFunctionData
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import type { UserWallet } from 'shared/dist';
import { db, hookExecutions } from '../db/index';
import { eq } from 'drizzle-orm';
import type { ProcessedMulticall, ProcessedCall } from './multicall-processor';

export interface MulticallExecution {
  id: string;
  hookId: string;
  multicallId: string;
  transactionHash: Hash;
  status: 'pending' | 'confirmed' | 'failed';
  gasUsed: string;
  gasPrice: string;
  feeCharged: string;
  errorMessage?: string;
  executedAt: number;
  confirmedAt?: number;
}

export class MulticallExecutor {
  private rpcUrl: string;
  private sendRawTxSyncUrl: string;
  private multicallAddress: Address;

  constructor(rpcUrl: string, sendRawTxSyncUrl: string, multicallAddress: Address) {
    this.rpcUrl = rpcUrl;
    this.sendRawTxSyncUrl = sendRawTxSyncUrl;
    this.multicallAddress = multicallAddress;
  }

  /**
   * Execute a processed multicall using user's automation wallet
   */
  async executeMulticall(
    processedMulticall: ProcessedMulticall,
    automationWallet: UserWallet,
    hookId: string
  ): Promise<MulticallExecution | null> {
    try {
      console.log(`Executing multicall ${processedMulticall.id} for wallet ${automationWallet.automationAddress}`);

      // Decrypt the private key (in production, use proper encryption)
      const privateKey = this.decryptPrivateKey(automationWallet.privateKeyEncrypted);
      
      // Create account from private key
      const account = privateKeyToAccount(privateKey);
      
      // Create wallet and public clients
      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(this.rpcUrl),
      });

      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(this.rpcUrl),
      });

      // Get current nonce and gas price
      const [nonce, gasPrice] = await Promise.all([
        publicClient.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        }),
        publicClient.getGasPrice(),
      ]);

      // Check wallet balance
      const balance = await publicClient.getBalance({
        address: account.address,
      });

      const totalValue = BigInt(processedMulticall.totalValue);
      const estimatedGasLimit = BigInt(processedMulticall.estimatedGas);
      const requiredBalance = totalValue + (estimatedGasLimit * gasPrice);

      if (balance < requiredBalance) {
        throw new Error(`Insufficient balance. Required: ${requiredBalance.toString()}, Available: ${balance.toString()}`);
      }

      // Encode multicall data
      const multicallData = this.encodeMulticallData(processedMulticall.calls);

      // Prepare transaction
      const txRequest = {
        to: this.multicallAddress,
        value: totalValue,
        data: multicallData,
        gas: estimatedGasLimit,
        gasPrice,
        nonce,
      };

      // Sign the transaction
      const signedTx = await walletClient.signTransaction({
        ...txRequest,
        account,
      });

      // Send using sendRawTransactionSync for fastest execution
      const txHash = await this.sendRawTransactionSync(signedTx);

      // Calculate fee (simplified - in production, use actual gas used)
      const feeCharged = estimatedGasLimit * gasPrice;

      // Create execution record
      const execution: MulticallExecution = {
        id: `exec_${processedMulticall.id}`,
        hookId,
        multicallId: processedMulticall.id,
        transactionHash: txHash,
        status: 'pending',
        gasUsed: '0', // Will be updated when receipt is available
        gasPrice: gasPrice.toString(),
        feeCharged: feeCharged.toString(),
        executedAt: Date.now(),
      };

      // Store in database
      await db.insert(hookExecutions).values({
        id: execution.id,
        hookId: execution.hookId,
        triggerEventId: processedMulticall.eventId,
        executionTxHash: execution.transactionHash,
        status: execution.status,
        gasUsed: execution.gasUsed,
        feeCharged: execution.feeCharged,
        timestamp: execution.executedAt,
      });

      console.log(`Multicall executed successfully: ${txHash}`);
      return execution;

    } catch (error) {
      console.error('Error executing multicall:', error);
      
      // Create failed execution record
      const failedExecution: MulticallExecution = {
        id: `exec_${processedMulticall.id}`,
        hookId,
        multicallId: processedMulticall.id,
        transactionHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hash,
        status: 'failed',
        gasUsed: '0',
        gasPrice: '0',
        feeCharged: '0',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        executedAt: Date.now(),
      };

      await db.insert(hookExecutions).values({
        id: failedExecution.id,
        hookId: failedExecution.hookId,
        triggerEventId: processedMulticall.eventId,
        executionTxHash: failedExecution.transactionHash,
        status: failedExecution.status,
        gasUsed: failedExecution.gasUsed,
        feeCharged: failedExecution.feeCharged,
        errorMessage: failedExecution.errorMessage,
        timestamp: failedExecution.executedAt,
      });

      return failedExecution;
    }
  }

  /**
   * Encode multicall data for the multicall contract
   */
  private encodeMulticallData(calls: ProcessedCall[]): Hash {
    // Standard multicall3 interface: aggregate3((address target, bool allowFailure, bytes callData)[])
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

    // Convert calls to multicall format
    const multicallCalls = calls.map(call => ({
      target: call.target,
      allowFailure: false, // Fail the entire transaction if any call fails
      callData: call.calldata,
    }));

    return encodeFunctionData({
      abi: multicall3Abi,
      functionName: 'aggregate3',
      args: [multicallCalls],
    });
  }

  /**
   * Send raw transaction using sendRawTransactionSync API for fastest execution
   */
  private async sendRawTransactionSync(signedTx: Hash): Promise<Hash> {
    try {
      const response = await fetch(this.sendRawTxSyncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
    } catch (error) {
      console.error('Error sending raw transaction sync:', error);
      throw error;
    }
  }

  /**
   * Decrypt private key (placeholder - implement proper encryption in production)
   */
  private decryptPrivateKey(encryptedKey: string): `0x${string}` {
    // In production, use proper encryption/decryption
    // For now, assume the "encrypted" key is just base64 encoded
    try {
      const decoded = Buffer.from(encryptedKey, 'base64').toString('utf-8');
      return decoded as `0x${string}`;
    } catch (error) {
      throw new Error('Failed to decrypt private key');
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
      const updateData: any = {
        status,
      };

      if (gasUsed) {
        updateData.gasUsed = gasUsed;
      }

      await db.update(hookExecutions)
        .set(updateData)
        .where(eq(hookExecutions.executionTxHash, txHash));

      console.log(`Updated execution ${txHash} status to ${status}`);
    } catch (error) {
      console.error('Error updating execution status:', error);
    }
  }

  /**
   * Get execution statistics
   */
  async getExecutionStats(): Promise<{
    total: number;
    successful: number;
    failed: number;
    pending: number;
    totalFees: string;
  }> {
    try {
      const executions = await db.select().from(hookExecutions);
      
      const totalFees = executions.reduce((sum, exec) => {
        return sum + BigInt(exec.feeCharged || '0');
      }, BigInt(0));

      return {
        total: executions.length,
        successful: executions.filter(exec => exec.status === 'success').length,
        failed: executions.filter(exec => exec.status === 'failed').length,
        pending: executions.filter(exec => exec.status === 'pending').length,
        totalFees: totalFees.toString(),
      };
    } catch (error) {
      console.error('Error getting execution stats:', error);
      return { total: 0, successful: 0, failed: 0, pending: 0, totalFees: '0' };
    }
  }

  /**
   * Simulate multicall execution without sending transaction
   */
  async simulateMulticall(
    processedMulticall: ProcessedMulticall,
    automationWallet: UserWallet
  ): Promise<{ success: boolean; gasEstimate: string; error?: string }> {
    try {
      // Decrypt the private key
      const privateKey = this.decryptPrivateKey(automationWallet.privateKeyEncrypted);
      
      // Create account from private key
      const account = privateKeyToAccount(privateKey);
      
      // Create public client for estimation
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(this.rpcUrl),
      });

      // Encode multicall data
      const multicallData = this.encodeMulticallData(processedMulticall.calls);

      // Estimate gas
      const gasEstimate = await publicClient.estimateGas({
        to: this.multicallAddress,
        value: BigInt(processedMulticall.totalValue),
        data: multicallData,
        account: account.address,
      });

      return {
        success: true,
        gasEstimate: gasEstimate.toString(),
      };
    } catch (error) {
      return {
        success: false,
        gasEstimate: '0',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
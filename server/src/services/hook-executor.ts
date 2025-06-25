import type { DetectedEvent, TransactionTemplate, UserWallet } from 'shared/dist';
import { db, eventHooks, transactionTemplates, userWallets } from '../db/index';
import { eq, and } from 'drizzle-orm';
import { MulticallProcessor } from './multicall-processor';
import { MulticallExecutor } from './multicall-executor';

export class HookExecutor {
  private multicallExecutor: MulticallExecutor;

  constructor(rpcUrl: string, sendRawTxSyncUrl: string, multicallAddress: `0x${string}`) {
    this.multicallExecutor = new MulticallExecutor(rpcUrl, sendRawTxSyncUrl, multicallAddress);
  }

  /**
   * Process a detected event and execute any matching hooks
   */
  async processEvent(event: DetectedEvent): Promise<void> {
    try {
      console.log(`Processing event: ${event.signature.eventName} from ${event.signature.contractAddress}`);

      // Find all active hooks that match this event signature
      const matchingHooks = await this.findMatchingHooks(event);

      if (matchingHooks.length === 0) {
        console.log('No matching hooks found for event');
        return;
      }

      console.log(`Found ${matchingHooks.length} matching hooks`);

      // Process each hook
      for (const hook of matchingHooks) {
        await this.executeHook(hook, event);
      }

    } catch (error) {
      console.error('Error processing event:', error);
    }
  }

  /**
   * Find hooks that match the detected event
   */
  private async findMatchingHooks(event: DetectedEvent): Promise<any[]> {
    try {
      // Get the event signature for matching
      const eventSignatureKey = event.signature.eventName + '_' + event.signature.contractAddress;

      // Find all active hooks for this event signature
      const hooks = await db.select()
        .from(eventHooks)
        .where(
          and(
            eq(eventHooks.eventSignature, eventSignatureKey),
            eq(eventHooks.isActive, true)
          )
        );

      return hooks;
    } catch (error) {
      console.error('Error finding matching hooks:', error);
      return [];
    }
  }

  /**
   * Execute a single hook for the detected event
   */
  private async executeHook(hook: any, event: DetectedEvent): Promise<void> {
    try {
      console.log(`Executing hook ${hook.id}`);

      // Get the transaction template
      const template = await this.getTransactionTemplate(hook.transactionTemplateId);
      if (!template) {
        console.error(`Template ${hook.transactionTemplateId} not found`);
        return;
      }

      // Get the user's automation wallet by automation wallet address
      const automationWallet = await this.getAutomationWalletByAddress(hook.automationWallet);
      if (!automationWallet) {
        console.error(`No automation wallet found with address ${hook.automationWallet}`);
        return;
      }

      // Check if wallet is active
      if (!automationWallet.isActive) {
        console.log(`Automation wallet ${hook.automationWallet} is inactive`);
        return;
      }

      // Process the template with event data to create multicall
      const processedMulticall = MulticallProcessor.processTemplate(
        template, 
        event, 
        automationWallet.automationAddress
      );
      
      if (!processedMulticall) {
        console.error('Failed to process transaction template');
        return;
      }

      // Simulate the multicall first
      const simulation = await this.multicallExecutor.simulateMulticall(processedMulticall, automationWallet);
      if (!simulation.success) {
        console.error(`Multicall simulation failed: ${simulation.error}`);
        return;
      }

      // Execute the multicall
      const execution = await this.multicallExecutor.executeMulticall(
        processedMulticall, 
        automationWallet, 
        hook.id
      );
      
      if (execution && execution.status !== 'failed') {
        console.log(`Successfully executed multicall: ${execution.transactionHash}`);
      } else {
        console.error('Multicall execution failed');
      }

    } catch (error) {
      console.error(`Error executing hook ${hook.id}:`, error);
    }
  }

  /**
   * Get transaction template by ID
   */
  private async getTransactionTemplate(templateId: string): Promise<TransactionTemplate | null> {
    try {
      const templates = await db.select()
        .from(transactionTemplates)
        .where(eq(transactionTemplates.id, templateId))
        .limit(1);

      if (templates.length === 0) return null;

      const template = templates[0];
      if (!template) return null;
      
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        calls: template.calls as any,
        requiredVariables: template.requiredVariables as any,
        estimatedGas: template.estimatedGas,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      } as TransactionTemplate;
    } catch (error) {
      console.error('Error getting transaction template:', error);
      return null;
    }
  }

  /**
   * Get automation wallet by address
   */
  private async getAutomationWalletByAddress(automationAddress: string): Promise<UserWallet | null> {
    try {
      const wallets = await db.select()
        .from(userWallets)
        .where(eq(userWallets.automationAddress, automationAddress))
        .limit(1);

      return wallets.length > 0 ? (wallets[0] as UserWallet) : null;
    } catch (error) {
      console.error('Error getting automation wallet by address:', error);
      return null;
    }
  }


  /**
   * Get hook execution statistics
   */
  async getExecutionStats(): Promise<{
    totalHooks: number;
    activeHooks: number;
    totalExecutions: number;
    successfulExecutions: number;
    totalFees: string;
  }> {
    try {
      const [hookStats, executionStats] = await Promise.all([
        db.select().from(eventHooks),
        this.multicallExecutor.getExecutionStats(),
      ]);

      return {
        totalHooks: hookStats.length,
        activeHooks: hookStats.filter(hook => hook.isActive).length,
        totalExecutions: executionStats.total,
        successfulExecutions: executionStats.successful,
        totalFees: executionStats.totalFees,
      };
    } catch (error) {
      console.error('Error getting execution stats:', error);
      return {
        totalHooks: 0,
        activeHooks: 0,
        totalExecutions: 0,
        successfulExecutions: 0,
        totalFees: '0',
      };
    }
  }

  /**
   * Disable hook (emergency stop)
   */
  async disableHook(hookId: string): Promise<void> {
    try {
      await db.update(eventHooks)
        .set({ isActive: false })
        .where(eq(eventHooks.id, hookId));
      
      console.log(`Disabled hook ${hookId}`);
    } catch (error) {
      console.error('Error disabling hook:', error);
    }
  }

  /**
   * Enable hook
   */
  async enableHook(hookId: string): Promise<void> {
    try {
      await db.update(eventHooks)
        .set({ isActive: true })
        .where(eq(eventHooks.id, hookId));
      
      console.log(`Enabled hook ${hookId}`);
    } catch (error) {
      console.error('Error enabling hook:', error);
    }
  }
}
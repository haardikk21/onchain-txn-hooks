import { FlashblocksListener } from './flashblocks-listener';
import { db, detectedEvents, eventSignatures } from '../db/index';
import { HookExecutor } from './hook-executor';
import type { DetectedEvent, EventSignature } from 'shared/dist';

export class EventMonitor {
  private flashblocksListener: FlashblocksListener;
  private hookExecutor: HookExecutor;
  private monitoredSignatures = new Map<string, EventSignature>();

  constructor(flashblocksWsUrl: string, rpcUrl: string, sendRawTxSyncUrl: string, multicallAddress: `0x${string}`) {
    this.hookExecutor = new HookExecutor(rpcUrl, sendRawTxSyncUrl, multicallAddress);
    this.flashblocksListener = new FlashblocksListener(
      flashblocksWsUrl,
      this.handleEventDetected.bind(this),
      this.handleError.bind(this)
    );
  }

  /**
   * Start monitoring events
   */
  async start(): Promise<void> {
    console.log('Starting event monitoring...');
    
    // Load existing event signatures from database
    await this.loadEventSignatures();
    
    // Connect to Flashblocks
    await this.flashblocksListener.connect();
    
    console.log(`Event monitor started. Monitoring ${this.monitoredSignatures.size} event signatures.`);
  }

  /**
   * Stop monitoring events
   */
  stop(): void {
    console.log('Stopping event monitoring...');
    this.flashblocksListener.disconnect();
  }

  /**
   * Add event signature to monitor
   */
  async addEventSignature(signature: EventSignature): Promise<void> {
    // Store in database
    await db.insert(eventSignatures).values({
      id: signature.eventName + '_' + signature.contractAddress,
      contractAddress: signature.contractAddress,
      eventName: signature.eventName,
      signature: signature.signature,
      abi: signature.abi,
      createdAt: Date.now(),
    }).onConflictDoNothing(); // Don't duplicate

    // Add to memory and Flashblocks listener
    const key = this.getSignatureKey(signature);
    this.monitoredSignatures.set(key, signature);
    this.flashblocksListener.addEventSignature(signature);

    console.log(`Added event signature: ${signature.eventName} on ${signature.contractAddress}`);
  }

  /**
   * Remove event signature from monitoring
   */
  async removeEventSignature(signature: EventSignature): Promise<void> {
    const key = this.getSignatureKey(signature);
    
    // Remove from memory and Flashblocks listener
    this.monitoredSignatures.delete(key);
    this.flashblocksListener.removeEventSignature(signature);

    console.log(`Removed event signature: ${signature.eventName} on ${signature.contractAddress}`);
  }

  /**
   * Get monitored signatures
   */
  getMonitoredSignatures(): EventSignature[] {
    return Array.from(this.monitoredSignatures.values());
  }

  /**
   * Get connection status
   */
  get isConnected(): boolean {
    return this.flashblocksListener.isConnected;
  }

  /**
   * Handle detected event from Flashblocks
   */
  private async handleEventDetected(event: DetectedEvent): Promise<void> {
    try {
      console.log(`Event detected: ${event.signature.eventName} in tx ${event.transactionHash}`);

      // Store in database
      await db.insert(detectedEvents).values({
        id: `${event.transactionHash}_${event.logIndex}`,
        eventSignatureId: event.signature.eventName + '_' + event.signature.contractAddress,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber.toString(),
        logIndex: event.logIndex,
        args: event.args,
        timestamp: event.timestamp,
      });

      // Trigger hook execution
      await this.hookExecutor.processEvent(event);

    } catch (error) {
      console.error('Error handling detected event:', error);
    }
  }

  /**
   * Handle errors from Flashblocks listener
   */
  private handleError(error: Error): void {
    console.error('Flashblocks listener error:', error);
    // TODO: Implement error handling (notifications, retries, etc.)
  }

  /**
   * Load event signatures from database
   */
  private async loadEventSignatures(): Promise<void> {
    try {
      const signatures = await db.select().from(eventSignatures);
      
      for (const sig of signatures) {
        const eventSignature: EventSignature = {
          contractAddress: sig.contractAddress as `0x${string}`,
          eventName: sig.eventName,
          signature: sig.signature,
          abi: sig.abi as any, // JSON parsed ABI
        };

        const key = this.getSignatureKey(eventSignature);
        this.monitoredSignatures.set(key, eventSignature);
        this.flashblocksListener.addEventSignature(eventSignature);
      }

      console.log(`Loaded ${signatures.length} event signatures from database`);
    } catch (error) {
      console.error('Error loading event signatures:', error);
    }
  }

  /**
   * Generate unique key for event signature
   */
  private getSignatureKey(signature: EventSignature): string {
    return `${signature.contractAddress}_${signature.eventName}`;
  }
}
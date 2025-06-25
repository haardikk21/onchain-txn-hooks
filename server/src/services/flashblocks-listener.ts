import { decodeEventLog, keccak256, toHex, type Address, type Hash, type AbiEvent, type TransactionReceipt, type Log } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { DetectedEvent, EventSignature } from 'shared/dist';
import init from 'brotli-dec-wasm';

export interface Flashblock {
  payload_id: string;
  index: number;
  base: {
    parent_beacon_block_root: string;
    parent_hash: string;
    fee_recipient: string;
    prev_randao: string;
    block_number: string;
    gas_limit: string;
    timestamp: string;
    extra_data: string;
    base_fee_per_gas: string;
  };
  diff: {
    state_root: string;
    receipts_root: string;
    logs_bloom: string;
    gas_used: string;
    block_hash: string;
    transactions: string[];
  };
  metadata: {
    receipts: Record<string, FlashblockReceipt>;
  };
}

export interface FlashblockReceipt {
  Eip1559?: {
    cumulativeGasUsed: string;
    logs: FlashblockLog[];
    status: string;
  };
  Legacy?: {
    cumulativeGasUsed: string;
    logs: FlashblockLog[];
    status: string;
  };
}

export interface FlashblockLog {
  address: string;
  topics: string[];
  data: string;
}

export class FlashblocksListener {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private isConnecting = false;
  private eventSignatures = new Map<string, EventSignature>(); // topic0 -> signature
  
  constructor(
    private wsUrl: string,
    private onEventDetected: (event: DetectedEvent) => void,
    private onError: (error: Error) => void = console.error
  ) {}

  /**
   * Connect to Flashblocks WebSocket
   */
  async connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    
    try {
      console.log('Connecting to Flashblocks WebSocket...');
      this.ws = new WebSocket(this.wsUrl);
      
      this.ws.addEventListener('open', this.handleOpen.bind(this));
      this.ws.addEventListener('message', this.handleMessage.bind(this));
      this.ws.addEventListener('close', this.handleClose.bind(this));
      this.ws.addEventListener('error', this.handleError.bind(this));
      
    } catch (error) {
      this.isConnecting = false;
      this.onError(new Error(`Failed to connect to Flashblocks: ${error}`));
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = 0;
  }

  /**
   * Add event signature to monitor
   */
  addEventSignature(signature: EventSignature): void {
    // Store by topic0 hash for quick lookup
    const topic0 = signature.abi.anonymous 
      ? '0x' + signature.signature // For anonymous events
      : this.getEventTopic0(signature.abi.name, [...signature.abi.inputs]);
    
    this.eventSignatures.set(topic0, signature);
    
    console.log(`Monitoring event: ${signature.eventName} (${topic0})`);
  }

  /**
   * Remove event signature monitoring
   */
  removeEventSignature(signature: EventSignature): void {
    const topic0 = signature.abi.anonymous 
      ? '0x' + signature.signature
      : this.getEventTopic0(signature.abi.name, [...signature.abi.inputs]);
    
    this.eventSignatures.delete(topic0);
    // Note: We don't unsubscribe from logs as other signatures might use the same topic0
  }

  /**
   * Handle WebSocket open
   */
  private handleOpen(): void {
    console.log('Connected to Flashblocks WebSocket');
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    
    console.log(`Monitoring ${this.eventSignatures.size} event signatures`);
  }

  /**
   * Handle WebSocket message
   */
  private async handleMessage(event: MessageEvent): Promise<void> {
    try {
      const brotli = await init;
      const textData = await event.data.text();
      let flashblock: Flashblock | undefined;
      
      if (textData.trim().startsWith("{")) {
        // Plain JSON data
        flashblock = JSON.parse(textData) as Flashblock;
      } else {
        // Brotli-compressed data
        try {
          const u8Data = await event.data.bytes();
          const decompressedData = Buffer.from(brotli.decompress(u8Data)).toString("utf-8");
          flashblock = JSON.parse(decompressedData) as Flashblock;
        } catch (decompressError) {
          console.error("Error decompressing data", decompressError);
          return;
        }
      }
      
      if (flashblock) {
        this.processFlashblock(flashblock);
      }
    } catch (error) {
      this.onError(new Error(`Failed to parse message: ${error}`));
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(event: CloseEvent): void {
    console.log('Flashblocks WebSocket closed:', event.code, event.reason);
    this.isConnecting = false;
    this.ws = null;
    
    if (event.code !== 1000) { // Not a normal closure
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleError(event: Event): void {
    console.error('Flashblocks WebSocket error:', event);
    this.onError(new Error('WebSocket connection error'));
  }

  /**
   * Process incoming Flashblock data
   */
  private processFlashblock(flashblock: Flashblock): void {
    try {
      // Process all transaction receipts in the flashblock
      for (const [txHash, receipt] of Object.entries(flashblock.metadata.receipts)) {
        this.processTransactionReceipt(receipt, flashblock, txHash);
      }
    } catch (error) {
      this.onError(new Error(`Failed to process flashblock: ${error}`));
    }
  }

  /**
   * Process transaction receipt and extract matching logs
   */
  private processTransactionReceipt(receipt: FlashblockReceipt, flashblock: Flashblock, txHash: string): void {
    try {
      // Handle both Eip1559 and Legacy transaction types
      const receiptData = receipt.Eip1559 || receipt.Legacy;
      if (!receiptData) {
        console.warn('No valid receipt data found');
        return;
      }

      // Process all logs in the receipt
      for (let i = 0; i < receiptData.logs.length; i++) {
        const log = receiptData.logs[i];
        if (log) {
          this.processLog(log, flashblock, txHash, i);
        }
      }
    } catch (error) {
      this.onError(new Error(`Failed to process transaction receipt: ${error}`));
    }
  }

  /**
   * Process individual log and check for matches
   */
  private processLog(log: FlashblockLog, flashblock: Flashblock, txHash: string, logIndex: number): void {
    try {
      if (!log.topics || log.topics.length === 0) return;
      
      const topic0 = log.topics[0];
      if (!topic0) return;
      
      const signature = this.eventSignatures.get(topic0);
      
      if (!signature) return; // Not monitoring this event
      
      // Decode the event log
      const decodedLog = decodeEventLog({
        abi: [signature.abi],
        data: log.data as `0x${string}`,
        topics: log.topics as [] | [`0x${string}`, ...`0x${string}`[]],
      });

      if (!decodedLog) {
        console.warn('Failed to decode event log');
        return;
      }

      // Create detected event with metadata from flashblock
      const detectedEvent: DetectedEvent = {
        signature,
        transactionHash: txHash as `0x${string}`,
        blockNumber: BigInt(flashblock.base.block_number),
        logIndex,
        args: decodedLog.args as Record<string, any>,
        timestamp: parseInt(flashblock.base.timestamp) * 1000, // Convert to milliseconds
      };

      // Emit the event
      this.onEventDetected(detectedEvent);
      
    } catch (error) {
      this.onError(new Error(`Failed to process log: ${error}`));
    }
  }


  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onError(new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Generate event topic0 hash
   */
  private getEventTopic0(eventName: string, inputs: any[]): string {
    // Create the event signature string
    const inputTypes = inputs.map(input => input.type).join(',');
    const eventSignature = `${eventName}(${inputTypes})`;
    
    // Generate keccak256 hash of the signature string
    const encoder = new TextEncoder();
    const data = encoder.encode(eventSignature);
    return keccak256(data);
  }

  /**
   * Get connection status
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get monitored event count
   */
  get monitoredEventCount(): number {
    return this.eventSignatures.size;
  }
}
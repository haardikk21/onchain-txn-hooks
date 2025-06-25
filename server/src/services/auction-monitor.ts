import { createPublicClient, http, getContract, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';
import { EventHookAuctionABI } from 'shared/src/abis/EventHookAuction.js';
import { db } from '../db/index.js';
import { eventAuctions, auctionBids } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

interface EventFilter {
  contractAddress: Address;
  topic0: string;
  topic1: string;
  topic2: string;
  topic3: string;
  useTopic1: boolean;
  useTopic2: boolean;
  useTopic3: boolean;
}

interface AuctionCreatedEvent {
  filterHash: string;
  filter: EventFilter;
  minimumBid: bigint;
}

interface BidPlacedEvent {
  filterHash: string;
  bidder: Address;
  amount: bigint;
}

interface WinningsWithdrawnEvent {
  filterHash: string;
  winner: Address;
  vault: Address;
  amount: bigint;
}

export class AuctionMonitor {
  private client;
  private contract;
  private isRunning = false;
  private auctionCreatedUnwatch?: () => void;
  private bidPlacedUnwatch?: () => void;
  private winningsWithdrawnUnwatch?: () => void;

  constructor(rpcUrl: string, auctionContractAddress: Address) {
    this.client = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl)
    });
    
    this.contract = getContract({
      address: auctionContractAddress,
      abi: EventHookAuctionABI,
      client: this.client
    });
  }

  async start() {
    if (this.isRunning) {
      console.log('Auction monitor already running');
      return;
    }

    this.isRunning = true;
    console.log(`Starting auction monitor for contract: ${this.contract.address}`);

    // Watch for AuctionCreated events
    this.auctionCreatedUnwatch = this.client.watchEvent({
      address: this.contract.address,
      event: this.contract.abi.find(item => item.type === 'event' && item.name === 'AuctionCreated')!,
      onLogs: (logs) => {
        for (const log of logs) {
          this.handleAuctionCreated(log.args as AuctionCreatedEvent);
        }
      }
    });

    // Watch for BidPlaced events
    this.bidPlacedUnwatch = this.client.watchEvent({
      address: this.contract.address,
      event: this.contract.abi.find(item => item.type === 'event' && item.name === 'BidPlaced')!,
      onLogs: (logs) => {
        for (const log of logs) {
          this.handleBidPlaced(log.args as BidPlacedEvent);
        }
      }
    });

    // Watch for WinningsWithdrawn events
    this.winningsWithdrawnUnwatch = this.client.watchEvent({
      address: this.contract.address,
      event: this.contract.abi.find(item => item.type === 'event' && item.name === 'WinningsWithdrawn')!,
      onLogs: (logs) => {
        for (const log of logs) {
          this.handleWinningsWithdrawn(log.args as WinningsWithdrawnEvent);
        }
      }
    });

    console.log('Auction monitor started successfully');
  }

  async stop() {
    this.isRunning = false;
    
    // Unwatch events
    if (this.auctionCreatedUnwatch) {
      this.auctionCreatedUnwatch();
      this.auctionCreatedUnwatch = undefined;
    }
    
    if (this.bidPlacedUnwatch) {
      this.bidPlacedUnwatch();
      this.bidPlacedUnwatch = undefined;
    }
    
    if (this.winningsWithdrawnUnwatch) {
      this.winningsWithdrawnUnwatch();
      this.winningsWithdrawnUnwatch = undefined;
    }
    
    console.log('Auction monitor stopped');
  }

  private async handleAuctionCreated(event: AuctionCreatedEvent) {
    console.log('Auction created:', event);

    try {
      // Create or update auction in database
      await db.insert(eventAuctions).values({
        eventSignature: event.filterHash,
        currentBidder: null,
        currentBid: '0',
        minimumBid: event.minimumBid.toString(),
        lastBidTime: Math.floor(Date.now() / 1000),
        isActive: true
      }).onConflictDoUpdate({
        target: eventAuctions.eventSignature,
        set: {
          minimumBid: event.minimumBid.toString(),
          isActive: true,
          lastBidTime: Math.floor(Date.now() / 1000)
        }
      });

      console.log(`Auction created in database for filter: ${event.filterHash}`);
    } catch (error) {
      console.error('Error handling auction created event:', error);
    }
  }

  private async handleBidPlaced(event: BidPlacedEvent) {
    console.log('Bid placed:', event);

    try {
      // Record bid in database
      await db.insert(auctionBids).values({
        id: `${event.filterHash}-${event.bidder}-${Date.now()}`,
        eventSignature: event.filterHash,
        bidder: event.bidder,
        amount: event.amount.toString(),
        timestamp: Math.floor(Date.now() / 1000),
        transactionHash: '0x', // Will be updated with actual tx hash
        isWinning: true // Will be updated below
      });

      // Update auction with new winner
      await db.update(eventAuctions)
        .set({
          currentBidder: event.bidder,
          currentBid: event.amount.toString(),
          lastBidTime: Math.floor(Date.now() / 1000)
        })
        .where(eq(eventAuctions.eventSignature, event.filterHash));

      // Mark all previous bids for this auction as not winning
      await db.update(auctionBids)
        .set({ isWinning: false })
        .where(eq(auctionBids.eventSignature, event.filterHash));

      // Set the latest bid as winning
      await db.update(auctionBids)
        .set({ isWinning: true })
        .where(
          and(
            eq(auctionBids.eventSignature, event.filterHash),
            eq(auctionBids.bidder, event.bidder),
            eq(auctionBids.amount, event.amount.toString())
          )
        );

      console.log(`Bid recorded for filter: ${event.filterHash}, bidder: ${event.bidder}, amount: ${event.amount}`);
    } catch (error) {
      console.error('Error handling bid placed event:', error);
    }
  }

  private async handleWinningsWithdrawn(event: WinningsWithdrawnEvent) {
    console.log('Winnings withdrawn:', event);

    try {
      // Mark auction as executed/completed
      await db.update(eventAuctions)
        .set({
          isActive: false, // Auction is now complete
          lastBidTime: Math.floor(Date.now() / 1000)
        })
        .where(eq(eventAuctions.eventSignature, event.filterHash));

      console.log(`Auction ${event.filterHash} marked as completed. Winnings withdrawn to ${event.vault}`);
    } catch (error) {
      console.error('Error handling winnings withdrawn event:', error);
    }
  }

  async syncHistoricalEvents(fromBlock?: bigint) {
    console.log('Syncing historical auction events...');

    try {
      const currentBlock = await this.client.getBlockNumber();
      const startBlock = fromBlock || currentBlock - 10000n; // Default to last ~10k blocks

      // Fetch AuctionCreated events
      const auctionCreatedLogs = await this.client.getLogs({
        address: this.contract.address,
        event: this.contract.abi.find(item => item.type === 'event' && item.name === 'AuctionCreated')!,
        fromBlock: startBlock,
        toBlock: currentBlock
      });

      // Fetch BidPlaced events
      const bidPlacedLogs = await this.client.getLogs({
        address: this.contract.address,
        event: this.contract.abi.find(item => item.type === 'event' && item.name === 'BidPlaced')!,
        fromBlock: startBlock,
        toBlock: currentBlock
      });

      // Fetch WinningsWithdrawn events
      const winningsWithdrawnLogs = await this.client.getLogs({
        address: this.contract.address,
        event: this.contract.abi.find(item => item.type === 'event' && item.name === 'WinningsWithdrawn')!,
        fromBlock: startBlock,
        toBlock: currentBlock
      });

      // Process auction created events
      for (const log of auctionCreatedLogs) {
        await this.handleAuctionCreated(log.args as AuctionCreatedEvent);
      }

      // Process bid placed events (in order)
      const sortedBids = bidPlacedLogs.sort((a, b) => 
        Number(a.blockNumber) - Number(b.blockNumber) || 
        Number(a.transactionIndex) - Number(b.transactionIndex)
      );

      for (const log of sortedBids) {
        await this.handleBidPlaced(log.args as BidPlacedEvent);
      }

      // Process winnings withdrawn events (in order)
      const sortedWithdrawals = winningsWithdrawnLogs.sort((a, b) => 
        Number(a.blockNumber) - Number(b.blockNumber) || 
        Number(a.transactionIndex) - Number(b.transactionIndex)
      );

      for (const log of sortedWithdrawals) {
        await this.handleWinningsWithdrawn(log.args as WinningsWithdrawnEvent);
      }

      console.log(`Synced ${auctionCreatedLogs.length} auction created, ${bidPlacedLogs.length} bid placed, and ${winningsWithdrawnLogs.length} winnings withdrawn events`);
    } catch (error) {
      console.error('Error syncing historical events:', error);
      throw error;
    }
  }

  async getAuctionState(filterHash: string) {
    try {
      const auction = await this.contract.read.getAuction([filterHash as `0x${string}`]);
      return auction;
    } catch (error) {
      console.error('Error getting auction state:', error);
      throw error;
    }
  }

  async getWinner(filterHash: string) {
    try {
      const winner = await this.contract.read.getWinner([filterHash as `0x${string}`]);
      return winner;
    } catch (error) {
      console.error('Error getting auction winner:', error);
      throw error;
    }
  }
}
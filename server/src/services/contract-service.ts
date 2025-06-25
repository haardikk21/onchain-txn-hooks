import type { AbiEvent, AbiItem, Address } from 'viem';
import { keccak256, toHex } from 'viem';
import { db } from '../db/index.js';
import { contracts } from '../db/schema.js';
import { eq } from 'drizzle-orm';

interface EtherscanResponse {
  status: string;
  message: string;
  result: string | AbiItem[];
}

export class ContractService {
  private baseUrl = 'https://api-sepolia.basescan.org/api';
  private apiKey: string;
  private cacheMaxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  constructor(apiKey?: string) {
    // Use environment variable or fallback to provided key
    this.apiKey = process.env.BASESCAN_API_KEY || apiKey || '';
  }

  async getContractABI(contractAddress: Address): Promise<AbiItem[]> {
    const normalizedAddress = contractAddress.toLowerCase() as Address;

    // Check cache first
    const cached = await this.getCachedContract(normalizedAddress);
    if (cached && this.isCacheValid(cached.lastFetchedAt)) {
      console.log(`Using cached ABI for contract: ${contractAddress}`);
      return cached.abi as AbiItem[];
    }

    // Fetch from Etherscan
    console.log(`Fetching ABI from Etherscan for contract: ${contractAddress}`);
    try {
      const abi = await this.fetchFromEtherscan(normalizedAddress);

      // Cache the result
      await this.cacheContract(normalizedAddress, abi);

      return abi;
    } catch (error) {
      console.error('Error fetching contract ABI:', error);

      // If we have a cached version (even if expired), return it as fallback
      if (cached) {
        console.log('Returning expired cached ABI as fallback');
        return cached.abi as AbiItem[];
      }

      throw error;
    }
  }

  private async getCachedContract(contractAddress: Address) {
    try {
      const result = await db
        .select()
        .from(contracts)
        .where(eq(contracts.address, contractAddress))
        .limit(1);

      return result[0] || null;
    } catch (error) {
      console.error('Error fetching cached contract:', error);
      return null;
    }
  }

  private isCacheValid(lastFetchedAt: number): boolean {
    const now = Date.now();
    return (now - lastFetchedAt) < this.cacheMaxAge;
  }

  private async fetchFromEtherscan(contractAddress: Address): Promise<AbiItem[]> {
    const response = await fetch(
      `${this.baseUrl}?module=contract&action=getabi&address=${contractAddress}&apikey=${this.apiKey}`
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as EtherscanResponse;

    if (data.status !== '1') {
      if (data.message === 'NOTOK' && typeof data.result === 'string') {
        if (data.result.includes('Contract source code not verified')) {
          throw new Error('Contract is not verified on BaseScan. Please verify your contract first.');
        }
      }
      throw new Error(`BaseScan API error: ${data.message} - ${data.result}`);
    }

    if (typeof data.result === 'string') {
      return JSON.parse(data.result) as AbiItem[];
    }

    return data.result;
  }

  private async cacheContract(contractAddress: Address, abi: AbiItem[]) {
    const now = Date.now();

    try {
      await db.insert(contracts).values({
        address: contractAddress,
        abi: abi as any, // Drizzle will serialize this as JSON
        isVerified: true,
        createdAt: now,
        lastFetchedAt: now
      }).onConflictDoUpdate({
        target: contracts.address,
        set: {
          abi: abi as any,
          lastFetchedAt: now
        }
      });

      console.log(`Cached ABI for contract: ${contractAddress}`);
    } catch (error) {
      console.error('Error caching contract ABI:', error);
      // Don't throw - caching failure shouldn't break the main flow
    }
  }

  extractEvents(abi: AbiItem[]): AbiEvent[] {
    return abi.filter((item): item is AbiEvent => item.type === 'event');
  }

  getEventSignature(event: AbiEvent): string {
    const inputs = event.inputs?.map(input => input.type).join(',') || '';
    return `${event.name}(${inputs})`;
  }

  getEventHash(event: AbiEvent): string {
    const signature = this.getEventSignature(event);
    return keccak256(toHex(signature));
  }

  getIndexedParameters(event: AbiEvent) {
    return event.inputs?.filter(input => input.indexed) || [];
  }

  getNonIndexedParameters(event: AbiEvent) {
    return event.inputs?.filter(input => !input.indexed) || [];
  }

  async isContractVerified(contractAddress: Address): Promise<boolean> {
    try {
      await this.getContractABI(contractAddress);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('not verified')) {
        return false;
      }
      throw error;
    }
  }
}

export const contractService = new ContractService("BTGK7WRSVX8QU9D5ZDG5A7IH2R6J8I2ME5");
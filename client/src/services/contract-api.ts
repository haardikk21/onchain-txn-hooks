import type { AbiEvent, AbiItem, Address } from 'viem';
import type { ApiResponse } from 'shared';

interface ContractEventsResponse {
  events: (AbiEvent & {
    signature: string;
    hash: string;
    indexedParams: Array<{ name: string; type: string; indexed: boolean }>;
    nonIndexedParams: Array<{ name: string; type: string; indexed: boolean }>;
  })[];
  address: string;
}

interface ContractABIResponse {
  abi: AbiItem[];
  address: string;
}

export class ContractApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
  }

  async getContractABI(contractAddress: Address): Promise<AbiItem[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/contracts/${contractAddress}/abi`
      );

      const data: ApiResponse<ContractABIResponse> = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch contract ABI');
      }

      return data.data!.abi;
    } catch (error) {
      console.error('Error fetching contract ABI:', error);
      throw error;
    }
  }

  async getContractEvents(contractAddress: Address): Promise<ContractEventsResponse['events']> {
    try {
      const response = await fetch(
        `${this.baseUrl}/contracts/${contractAddress}/events`
      );

      const data: ApiResponse<ContractEventsResponse> = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch contract events');
      }

      return data.data!.events;
    } catch (error) {
      console.error('Error fetching contract events:', error);
      throw error;
    }
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

  // Helper methods for backwards compatibility
  extractEvents(abi: AbiItem[]): AbiEvent[] {
    return abi.filter((item): item is AbiEvent => item.type === 'event');
  }

  getEventSignature(event: AbiEvent): string {
    const inputs = event.inputs?.map(input => input.type).join(',') || '';
    return `${event.name}(${inputs})`;
  }

  getIndexedParameters(event: AbiEvent) {
    return event.inputs?.filter(input => input.indexed) || [];
  }

  getNonIndexedParameters(event: AbiEvent) {
    return event.inputs?.filter(input => !input.indexed) || [];
  }
}

export const contractApiService = new ContractApiService();
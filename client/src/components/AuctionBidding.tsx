import { useState } from 'react';
import { type AbiEvent, type Address, parseEther, isAddress, keccak256, toHex, pad } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { contractApiService } from '@/services/contract-api';
import { EventHookAuctionABI } from 'shared/src/abis/EventHookAuction';

// Exact structure that viem/wagmi expects for the contract
type ContractEventFilter = {
  contractAddress: Address;
  topic0: `0x${string}`;
  topic1: `0x${string}`;
  topic2: `0x${string}`;
  topic3: `0x${string}`;
  useTopic1: boolean;
  useTopic2: boolean;
  useTopic3: boolean;
};

interface EventFilterConfig {
  contractAddress: `0x${string}`;
  topic0: `0x${string}`;
  topic1: `0x${string}`;
  topic2: `0x${string}`;
  topic3: `0x${string}`;
  useTopic1: boolean;
  useTopic2: boolean;
  useTopic3: boolean;
}

// Helper function to convert user input to bytes32 topic format
const convertToBytes32Topic = (value: string, paramType: string): `0x${string}` => {
  if (!value.trim()) {
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  try {
    switch (paramType) {
      case 'address':
        if (!isAddress(value)) {
          throw new Error('Invalid address format');
        }
        // Address is left-padded to 32 bytes
        return pad(value as `0x${string}`, { size: 32 });

      case 'uint256':
      case 'uint': {
        // Convert number to hex and pad to 32 bytes
        const bigIntValue = BigInt(value);
        return pad(toHex(bigIntValue), { size: 32 });
      }

      case 'int256':
      case 'int': {
        // Convert signed number to hex and pad to 32 bytes
        const signedValue = BigInt(value);
        return pad(toHex(signedValue), { size: 32 });
      }

      case 'bool': {
        // Boolean: false = 0x000...000, true = 0x000...001
        const boolValue = value.toLowerCase() === 'true' || value === '1';
        return pad(boolValue ? '0x01' : '0x00', { size: 32 });
      }

      case 'bytes32':
        // Already bytes32 format, validate and return
        if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
          throw new Error('Invalid bytes32 format (must be 0x followed by 64 hex characters)');
        }
        return value as `0x${string}`;

      case 'string':
        // String is hashed with keccak256
        return keccak256(toHex(value));

      default:
        // For other types, try to parse as hex or convert to bytes32
        if (value.startsWith('0x')) {
          return pad(value as `0x${string}`, { size: 32 });
        } else {
          // Assume it's a number for other uint/int types
          const numValue = BigInt(value);
          return pad(toHex(numValue), { size: 32 });
        }
    }
  } catch (error) {
    console.error(`Error converting ${value} to bytes32 for type ${paramType}:`, error);
    // Return zero bytes32 on error
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }
};

export default function AuctionBidding() {
  const { isConnected } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const [contractAddress, setContractAddress] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [events, setEvents] = useState<AbiEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<AbiEvent | null>(null);
  const [bidAmount, setBidAmount] = useState<string>('');
  const [eventFilter, setEventFilter] = useState<EventFilterConfig | null>(null);

  const handleContractSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contractAddress || !isAddress(contractAddress)) {
      setError('Please enter a valid contract address');
      return;
    }

    setIsLoading(true);
    setError('');
    
    try {
      const contractEvents = await contractApiService.getContractEvents(contractAddress as Address);
      
      if (contractEvents.length === 0) {
        setError('No events found in this contract');
        return;
      }
      
      setEvents(contractEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch contract events');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEventSelect = (event: AbiEvent) => {
    setSelectedEvent(event);
    
    // Create event filter configuration
    // The event already has the hash computed by the backend
    const eventHash = (event as AbiEvent & { hash?: string }).hash || contractApiService.getEventSignature(event);
    const filter: EventFilterConfig = {
      contractAddress: contractAddress as `0x${string}`,
      topic0: eventHash as `0x${string}`,
      topic1: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
      topic2: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
      topic3: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
      useTopic1: false,
      useTopic2: false,
      useTopic3: false
    };
    
    setEventFilter(filter);
  };

  const updateTopicFilter = (topicIndex: 1 | 2 | 3, value: string, enabled: boolean) => {
    if (!eventFilter || !selectedEvent) return;
    
    const topicKey = `topic${topicIndex}` as keyof EventFilterConfig;
    const useTopicKey = `useTopic${topicIndex}` as keyof EventFilterConfig;
    
    // Get the parameter type for this topic index
    const paramIndex = topicIndex - 1;
    const paramType = indexedParams[paramIndex]?.type || 'bytes32';
    
    // Convert the value to bytes32 format if enabled and has value
    const topicValue = enabled && value 
      ? convertToBytes32Topic(value, paramType)
      : '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
    
    setEventFilter({
      ...eventFilter,
      [topicKey]: topicValue,
      [useTopicKey]: enabled
    });
  };

  const handlePlaceBid = async () => {
    if (!eventFilter || !bidAmount || !isConnected) {
      setError('Please fill all required fields and connect your wallet');
      return;
    }

    try {
      const bidAmountWei = parseEther(bidAmount);
      
      // Convert to the exact object structure expected by the contract
      const contractFilter: ContractEventFilter = {
        contractAddress: eventFilter.contractAddress as Address,
        topic0: eventFilter.topic0,
        topic1: eventFilter.topic1,
        topic2: eventFilter.topic2,
        topic3: eventFilter.topic3,
        useTopic1: eventFilter.useTopic1,
        useTopic2: eventFilter.useTopic2,
        useTopic3: eventFilter.useTopic3
      };
      
      await writeContract({
        address: '0x' as Address, // Replace with actual auction contract address
        abi: EventHookAuctionABI,
        functionName: 'placeBid',
        args: [contractFilter],
        value: bidAmountWei
      });
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place bid');
    }
  };

  const indexedParams = selectedEvent ? (selectedEvent as AbiEvent & { indexedParams?: Array<{ name: string; type: string }> }).indexedParams || contractApiService.getIndexedParameters(selectedEvent) : [];

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Event Auction Bidding</h1>
          <p className="text-muted-foreground mt-2">
            Bid on blockchain events to automate transactions when they occur
          </p>
        </div>

        {/* Contract Address Input */}
        <Card>
          <CardHeader>
            <CardTitle>1. Enter Contract Address</CardTitle>
            <CardDescription>
              Enter a verified contract address on Base Sepolia to view its events
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleContractSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="contract">Contract Address</Label>
                <Input
                  id="contract"
                  placeholder="0x..."
                  value={contractAddress}
                  onChange={(e) => setContractAddress(e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Fetch Events'}
              </Button>
            </form>
            {error && <p className="text-destructive text-sm mt-2">{error}</p>}
          </CardContent>
        </Card>

        {/* Event Selection */}
        {events.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>2. Select Event</CardTitle>
              <CardDescription>
                Choose which event you want to bid on for automation rights
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {events.map((event, index) => (
                  <div
                    key={index}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedEvent === event
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => handleEventSelect(event)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium">{event.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {(event as AbiEvent & { signature?: string }).signature || contractApiService.getEventSignature(event)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {((event as AbiEvent & { indexedParams?: Array<{ name: string; type: string }> }).indexedParams || contractApiService.getIndexedParameters(event)).map((param: { name: string; type: string }, i: number) => (
                          <Badge key={i} variant="secondary">
                            {param.name}: {param.type}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Topic Filtering */}
        {selectedEvent && (
          <Card>
            <CardHeader>
              <CardTitle>3. Configure Topic Filters (Optional)</CardTitle>
              <CardDescription>
                Specify indexed parameter values to filter events. Leave empty to match all events.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {indexedParams.slice(0, 3).map((param, index) => {
                  const topicIndex = (index + 1) as 1 | 2 | 3;
                  const isEnabled = eventFilter?.[`useTopic${topicIndex}` as keyof EventFilterConfig] as boolean;
                  
                  return (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`topic${topicIndex}`}
                          checked={isEnabled}
                          onChange={(e) => updateTopicFilter(topicIndex, '', e.target.checked)}
                        />
                        <Label htmlFor={`topic${topicIndex}`}>
                          Filter by {param.name} ({param.type})
                        </Label>
                      </div>
                      {isEnabled && (
                        <Input
                          placeholder={`Enter ${param.type} value`}
                          onChange={(e) => updateTopicFilter(topicIndex, e.target.value, true)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bid Amount */}
        {selectedEvent && (
          <Card>
            <CardHeader>
              <CardTitle>4. Place Your Bid</CardTitle>
              <CardDescription>
                Enter the amount you want to bid in ETH to win automation rights for this event
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bid">Bid Amount (ETH)</Label>
                  <Input
                    id="bid"
                    type="number"
                    step="0.001"
                    placeholder="0.1"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                  />
                </div>
                
                {eventFilter && (
                  <div className="space-y-2">
                    <Label>Event Filter Summary</Label>
                    <Textarea
                      readOnly
                      value={`Contract: ${eventFilter.contractAddress}
Event: ${selectedEvent.name}
Signature: ${(selectedEvent as AbiEvent & { signature?: string }).signature || contractApiService.getEventSignature(selectedEvent)}
Topic0: ${eventFilter.topic0}
${eventFilter.useTopic1 ? `Topic1: ${eventFilter.topic1}` : ''}
${eventFilter.useTopic2 ? `Topic2: ${eventFilter.topic2}` : ''}
${eventFilter.useTopic3 ? `Topic3: ${eventFilter.topic3}` : ''}`}
                      className="font-mono text-sm"
                      rows={6}
                    />
                  </div>
                )}

                <Button
                  onClick={handlePlaceBid}
                  disabled={!isConnected || isPending || isConfirming || !bidAmount}
                  className="w-full"
                >
                  {!isConnected
                    ? 'Connect Wallet'
                    : isPending
                    ? 'Confirming...'
                    : isConfirming
                    ? 'Processing...'
                    : 'Place Bid'}
                </Button>

                {isSuccess && (
                  <p className="text-green-600 text-sm">
                    ✅ Bid placed successfully! Transaction hash: {hash}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
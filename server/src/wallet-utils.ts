import { createPublicClient, http, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';

// Create public client for balance queries
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(), // You might want to add your RPC URL here
});

/**
 * Get ETH balance for an address
 */
export async function getEthBalance(address: Address): Promise<bigint> {
  try {
    return await publicClient.getBalance({ address });
  } catch (error) {
    console.error('Error fetching ETH balance:', error);
    return 0n;
  }
}

/**
 * Get ERC20 token balance for an address
 */
export async function getTokenBalance(
  walletAddress: Address,
  tokenAddress: Address
): Promise<bigint> {
  try {
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: [
        {
          name: 'balanceOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'account', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
        },
      ],
      functionName: 'balanceOf',
      args: [walletAddress],
    });
    
    return balance as bigint;
  } catch (error) {
    console.error('Error fetching token balance:', error);
    return 0n;
  }
}

/**
 * Get multiple token balances at once
 */
export async function getMultipleTokenBalances(
  walletAddress: Address,
  tokenAddresses: Address[]
): Promise<Record<Address, bigint>> {
  const balances: Record<Address, bigint> = {};
  
  // Fetch all balances in parallel
  const balancePromises = tokenAddresses.map(async (tokenAddress) => {
    const balance = await getTokenBalance(walletAddress, tokenAddress);
    return { tokenAddress, balance };
  });
  
  const results = await Promise.all(balancePromises);
  
  for (const { tokenAddress, balance } of results) {
    balances[tokenAddress] = balance;
  }
  
  return balances;
}

/**
 * Get wallet info with current balances
 */
export async function getWalletWithBalances(
  address: Address,
  tokenAddresses: Address[] = []
) {
  const [ethBalance, tokenBalances] = await Promise.all([
    getEthBalance(address),
    getMultipleTokenBalances(address, tokenAddresses),
  ]);
  
  return {
    address,
    ethBalance: ethBalance.toString(), // Convert to string for JSON
    tokenBalances: Object.fromEntries(
      Object.entries(tokenBalances).map(([addr, balance]) => [addr, balance.toString()])
    ),
  };
}
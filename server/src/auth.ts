import { Hono } from 'hono';
import { SiweMessage } from 'siwe';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getWalletWithBalances } from './wallet-utils';
import { UserService } from './db/services/user-service';
import { AuthService } from './db/services/auth-service';
import type { ApiResponse, AuthSession, User, UserWallet } from 'shared/dist';

// Simple nonce store (replace with Redis in production)
const nonces = new Set<string>();

const auth = new Hono();

/**
 * Generate a random nonce for SIWE
 */
auth.get('/nonce', (c) => {
  const nonce = Math.random().toString(36).substring(2, 15);
  nonces.add(nonce);
  
  // Clean up old nonces after 10 minutes
  setTimeout(() => nonces.delete(nonce), 10 * 60 * 1000);
  
  return c.json({ nonce });
});

/**
 * Verify SIWE message and create session
 */
auth.post('/verify', async (c) => {
  try {
    const { message, signature } = await c.req.json();
    
    const siweMessage = new SiweMessage(message);
    const fields = await siweMessage.verify({ signature });
    
    // Verify nonce was issued by us
    if (!nonces.has(siweMessage.nonce)) {
      return c.json({ error: 'Invalid nonce' }, 400);
    }
    
    // Remove used nonce
    nonces.delete(siweMessage.nonce);
    
    const userAddress = fields.data.address.toLowerCase();
    
    // Create or get existing user
    let user = await UserService.getUserByAddress(userAddress);
    if (!user) {
      // First time user - create user and automation wallet
      const newUser = {
        id: crypto.randomUUID(),
        address: userAddress as `0x${string}`,
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      };
      
      user = await UserService.createUser(newUser);
      
      // Create automation wallet
      const automationWallet = await createAutomationWallet(userAddress);
      const createdWallet = await UserService.createAutomationWallet(automationWallet);
      
      user.automationWallet = createdWallet;
    } else {
      await UserService.updateLastLogin(userAddress);
      user.lastLoginAt = Date.now(); // Update local object too
    }
    
    // Create session
    const sessionId = crypto.randomUUID();
    const session: AuthSession = {
      id: sessionId,
      userAddress: userAddress as `0x${string}`,
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      nonce: siweMessage.nonce,
      isValid: true,
    };
    
    await AuthService.createSession(session);
    
    // Set session cookie (remove Secure for localhost development)
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = `sessionId=${sessionId}; HttpOnly; ${isProduction ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=86400`;
    c.header('Set-Cookie', cookieOptions);
    
    const response: ApiResponse<{ user: any }> = {
      success: true,
      data: { user: serializeUser(user) },
    };
    
    return c.json(response);
  } catch (error) {
    console.error('SIWE verification error:', error);
    return c.json({ error: 'Verification failed' }, 400);
  }
});

/**
 * Get current user info
 */
auth.get('/me', async (c) => {
  const sessionId = getCookieValue(c.req.header('Cookie'), 'sessionId');
  
  if (!sessionId) {
    return c.json({ error: 'No session' }, 401);
  }
  
  const isValid = await AuthService.isSessionValid(sessionId);
  if (!isValid) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }
  
  const session = await AuthService.getSession(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 401);
  }
  
  const user = await UserService.getUserByAddress(session.userAddress);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  const response: ApiResponse<{ user: any }> = {
    success: true,
    data: { user: serializeUser(user) },
  };
  
  return c.json(response);
});

/**
 * Logout user
 */
auth.post('/logout', async (c) => {
  const sessionId = getCookieValue(c.req.header('Cookie'), 'sessionId');
  
  if (sessionId) {
    await AuthService.invalidateSession(sessionId);
  }
  
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = `sessionId=; HttpOnly; ${isProduction ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=0`;
  c.header('Set-Cookie', cookieOptions);
  
  return c.json({ success: true });
});

/**
 * Get automation wallet balance
 */
auth.get('/wallet/balance', async (c) => {
  const sessionId = getCookieValue(c.req.header('Cookie'), 'sessionId');
  
  if (!sessionId) {
    return c.json({ error: 'No session' }, 401);
  }
  
  const isValid = await AuthService.isSessionValid(sessionId);
  if (!isValid) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }
  
  const session = await AuthService.getSession(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 401);
  }
  
  const user = await UserService.getUserByAddress(session.userAddress);
  if (!user || !user.automationWallet) {
    return c.json({ error: 'User or wallet not found' }, 404);
  }
  
  try {
    // Get token addresses from query params (comma-separated)
    const tokensParam = c.req.query('tokens');
    const tokenAddresses = tokensParam ? tokensParam.split(',') : [];
    
    const walletInfo = await getWalletWithBalances(
      user.automationWallet.automationAddress,
      tokenAddresses as `0x${string}`[]
    );
    
    const response: ApiResponse<typeof walletInfo> = {
      success: true,
      data: walletInfo,
    };
    
    return c.json(response);
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    return c.json({ error: 'Failed to fetch balance' }, 500);
  }
});

/**
 * Create automation wallet for user
 */
async function createAutomationWallet(userAddress: string): Promise<UserWallet> {
  // Generate new private key for automation
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  
  // In production, encrypt the private key before storing
  const encryptedPrivateKey = await encryptPrivateKey(privateKey);
  
  const wallet: UserWallet = {
    id: crypto.randomUUID(),
    owner: userAddress as `0x${string}`,
    automationAddress: account.address,
    privateKeyEncrypted: encryptedPrivateKey,
    isActive: true,
    createdAt: Date.now(),
  };
  
  return wallet;
}

/**
 * Convert User to serializable format (no BigInt conversion needed anymore)
 */
function serializeUser(user: User): any {
  return user;
}

/**
 * Simple encryption for private key (use proper encryption in production)
 */
async function encryptPrivateKey(privateKey: string): Promise<string> {
  // This is a placeholder - use proper encryption like AES with environment variables
  return Buffer.from(privateKey).toString('base64');
}

/**
 * Helper to parse cookie value
 */
function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  
  const match = cookieHeader.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : undefined;
}

export { auth };
import { SiweMessage } from 'siwe';
import type { SiweMessage as SiweMessageType } from 'shared';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

export class AuthService {
  /**
   * Get nonce from server for SIWE authentication
   */
  static async getNonce(): Promise<string> {
    const response = await fetch(`${SERVER_URL}/auth/nonce`);
    const data = await response.json();
    return data.nonce;
  }

  /**
   * Sign in with Ethereum using SIWE
   */
  static async signIn(message: string, signature: `0x${string}`): Promise<boolean> {
    const siweMessage: SiweMessageType = { message, signature };
    
    const response = await fetch(`${SERVER_URL}/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Include cookies for session
      body: JSON.stringify(siweMessage),
    });

    return response.ok;
  }

  /**
   * Sign out user
   */
  static async signOut(): Promise<void> {
    await fetch(`${SERVER_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  }

  /**
   * Check if user is authenticated
   */
  static async isAuthenticated(): Promise<boolean> {
    try {
      const response = await fetch(`${SERVER_URL}/auth/me`, {
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Create SIWE message
   */
  static createSiweMessage(address: string, nonce: string): string {
    const domain = window.location.host;
    const origin = window.location.origin;
    
    const message = new SiweMessage({
      domain,
      address,
      statement: 'Sign in to Onchain Transaction Hooks',
      uri: origin,
      version: '1',
      chainId: 84532, // Base Sepolia
      nonce,
    });

    return message.prepareMessage();
  }
}
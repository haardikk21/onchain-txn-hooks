import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from './ui/button';
import { useState, useEffect } from 'react';
import { AuthService } from '../lib/auth';

export function AuthButton() {
  const { address, isConnected } = useAccount();
  const { signMessage } = useSignMessage();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check authentication status on mount and when address changes
  useEffect(() => {
    if (isConnected && address) {
      AuthService.isAuthenticated().then(setIsAuthenticated);
    } else {
      setIsAuthenticated(false);
    }
  }, [isConnected, address]);

  const handleSignIn = async () => {
    if (!address) return;

    setIsLoading(true);
    try {
      // Get nonce from server
      const nonce = await AuthService.getNonce();
      
      // Create SIWE message
      const message = AuthService.createSiweMessage(address, nonce);
      
      // Sign message
      signMessage(
        { message },
        {
          onSuccess: async (signature) => {
            // Verify signature with server
            const success = await AuthService.signIn(message, signature);
            if (success) {
              setIsAuthenticated(true);
            } else {
              console.error('Authentication failed');
            }
          },
          onError: (error) => {
            console.error('Signing failed:', error);
          },
        }
      );
    } catch (error) {
      console.error('Sign in error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      await AuthService.signOut();
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isConnected) {
    return <ConnectButton />;
  }

  if (isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">
          Authenticated as {address?.slice(0, 6)}...{address?.slice(-4)}
        </span>
        <Button 
          onClick={handleSignOut} 
          variant="outline" 
          size="sm"
          disabled={isLoading}
        >
          Sign Out
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <ConnectButton />
      <Button 
        onClick={handleSignIn} 
        disabled={isLoading}
        className="ml-2"
      >
        {isLoading ? 'Signing...' : 'Sign In'}
      </Button>
    </div>
  );
}
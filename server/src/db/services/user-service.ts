import { eq, and } from 'drizzle-orm';
import { db, users, userWallets, authSessions } from '../index';
import type { User, UserWallet, AuthSession } from 'shared/dist';

export class UserService {
  /**
   * Create a new user
   */
  static async createUser(userData: Omit<User, 'automationWallet'>): Promise<User> {
    const insertedUsers = await db.insert(users).values({
      id: userData.id,
      address: userData.address,
      createdAt: userData.createdAt,
      lastLoginAt: userData.lastLoginAt,
    }).returning();

    return {
      ...insertedUsers[0],
      automationWallet: null,
    } as User;
  }

  /**
   * Get user by address
   */
  static async getUserByAddress(address: string): Promise<User | null> {
    const userResults = await db.select().from(users).where(eq(users.address, address)).limit(1);
    
    if (userResults.length === 0) return null;

    // Get automation wallet
    const walletResults = await db.select().from(userWallets).where(eq(userWallets.owner, address)).limit(1);

    return {
      ...userResults[0],
      automationWallet: walletResults.length > 0 ? (walletResults[0] as UserWallet) : null,
    } as User;
  }

  /**
   * Update user's last login time
   */
  static async updateLastLogin(address: string): Promise<void> {
    await db.update(users)
      .set({ lastLoginAt: Date.now() })
      .where(eq(users.address, address));
  }

  /**
   * Create automation wallet for user
   */
  static async createAutomationWallet(walletData: UserWallet): Promise<UserWallet> {
    const insertedWallets = await db.insert(userWallets).values({
      id: walletData.id,
      owner: walletData.owner,
      automationAddress: walletData.automationAddress,
      privateKeyEncrypted: walletData.privateKeyEncrypted,
      isActive: walletData.isActive,
      createdAt: walletData.createdAt,
    }).returning();

    return insertedWallets[0] as UserWallet;
  }

  /**
   * Get automation wallet by owner address
   */
  static async getAutomationWallet(ownerAddress: string): Promise<UserWallet | null> {
    const wallets = await db.select().from(userWallets)
      .where(eq(userWallets.owner, ownerAddress))
      .limit(1);

    return wallets.length > 0 ? (wallets[0] as UserWallet) : null;
  }

  /**
   * Get automation wallet by automation address
   */
  static async getAutomationWalletByAddress(automationAddress: string): Promise<UserWallet | null> {
    const wallets = await db.select().from(userWallets)
      .where(eq(userWallets.automationAddress, automationAddress))
      .limit(1);

    return wallets.length > 0 ? (wallets[0] as UserWallet) : null;
  }
}
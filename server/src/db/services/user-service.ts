import { eq, and } from 'drizzle-orm';
import { db, users, hookConsumers, authSessions } from '../index';
import type { User, HookConsumer, AuthSession } from 'shared/dist';

export class UserService {
  /**
   * Create a new user
   */
  static async createUser(userData: Omit<User, 'hookConsumers'>): Promise<User> {
    const insertedUsers = await db.insert(users).values({
      id: userData.id,
      address: userData.address,
      createdAt: userData.createdAt,
      lastLoginAt: userData.lastLoginAt,
    }).returning();

    return {
      ...insertedUsers[0],
      hookConsumers: [],
    } as User;
  }

  /**
   * Get user by address
   */
  static async getUserByAddress(address: string): Promise<User | null> {
    const userResults = await db.select().from(users).where(eq(users.address, address)).limit(1);
    
    if (userResults.length === 0) return null;

    // Get hook consumers
    const consumerResults = await db.select().from(hookConsumers).where(eq(hookConsumers.owner, address));

    return {
      ...userResults[0],
      hookConsumers: consumerResults as HookConsumer[],
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
   * Register hook consumer contract for user
   */
  static async createHookConsumer(consumerData: HookConsumer): Promise<HookConsumer> {
    const insertedConsumers = await db.insert(hookConsumers).values({
      id: consumerData.id,
      owner: consumerData.owner,
      contractAddress: consumerData.contractAddress,
      isActive: consumerData.isActive,
      createdAt: consumerData.createdAt,
    }).returning();

    return insertedConsumers[0] as HookConsumer;
  }

  /**
   * Get hook consumers by owner address
   */
  static async getHookConsumers(ownerAddress: string): Promise<HookConsumer[]> {
    const consumers = await db.select().from(hookConsumers)
      .where(eq(hookConsumers.owner, ownerAddress));

    return consumers as HookConsumer[];
  }

  /**
   * Get hook consumer by contract address
   */
  static async getHookConsumerByAddress(contractAddress: string): Promise<HookConsumer | null> {
    const consumers = await db.select().from(hookConsumers)
      .where(eq(hookConsumers.contractAddress, contractAddress))
      .limit(1);

    return consumers.length > 0 ? (consumers[0] as HookConsumer) : null;
  }
}
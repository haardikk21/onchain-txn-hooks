import { eq, and } from 'drizzle-orm';
import { db, authSessions } from '../index';
import type { AuthSession } from 'shared/dist';

export class AuthService {
  /**
   * Create a new auth session
   */
  static async createSession(sessionData: AuthSession): Promise<AuthSession> {
    const insertedSessions = await db.insert(authSessions).values({
      id: sessionData.id,
      userAddress: sessionData.userAddress,
      issuedAt: sessionData.issuedAt,
      expirationTime: sessionData.expirationTime,
      nonce: sessionData.nonce,
      isValid: sessionData.isValid,
    }).returning();

    return insertedSessions[0] as AuthSession;
  }

  /**
   * Get session by ID
   */
  static async getSession(sessionId: string): Promise<AuthSession | null> {
    const sessions = await db.select().from(authSessions)
      .where(eq(authSessions.id, sessionId))
      .limit(1);

    return sessions.length > 0 ? (sessions[0] as AuthSession) : null;
  }

  /**
   * Invalidate session
   */
  static async invalidateSession(sessionId: string): Promise<void> {
    await db.update(authSessions)
      .set({ isValid: false })
      .where(eq(authSessions.id, sessionId));
  }

  /**
   * Check if session is valid and not expired
   */
  static async isSessionValid(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    
    if (!session || !session.isValid) return false;
    
    const now = new Date();
    const expiration = new Date(session.expirationTime);
    
    return now < expiration;
  }

  /**
   * Clean up expired sessions
   */
  static async cleanupExpiredSessions(): Promise<void> {
    const now = new Date().toISOString();
    
    // For now, we'll do this manually. In production, set up a periodic cleanup job
    const expiredSessions = await db.select().from(authSessions);
    
    for (const session of expiredSessions) {
      if (new Date(session.expirationTime) < new Date()) {
        await this.invalidateSession(session.id);
      }
    }
  }
}
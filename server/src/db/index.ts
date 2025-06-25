import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import * as schema from './schema';

// Create SQLite database file using Bun's native SQLite
const sqlite = new Database('database.sqlite');

// Enable WAL mode for better concurrent performance
sqlite.exec('PRAGMA journal_mode = WAL');

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Export schema for use in other files
export * from './schema';
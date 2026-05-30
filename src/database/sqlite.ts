/**
 * sqlite.ts — RDD SQLite Database Initialization
 *
 * Provides:
 *   - initializeDatabase(dbPath): opens/creates the SQLite file,
 *     enables foreign keys, and executes FULL_SCHEMA (idempotent).
 *   - getDatabase(): singleton accessor — returns the same instance
 *     on every call, initializing lazily on first access.
 *
 * Error handling:
 *   - ENOENT  → creates ./data directory automatically
 *   - EACCES  → logs a detailed permission error and re-throws
 *   - Other   → re-throws to caller
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';
import { FULL_SCHEMA } from './schema';

export type DbInstance = Database.Database;

let dbInstance: Database.Database | null = null;

/**
 * Opens or creates the SQLite database file at `dbPath`,
 * enables foreign-key enforcement, and runs FULL_SCHEMA so all
 * tables and indexes exist. Safe to call on every startup
 * (all DDL uses IF NOT EXISTS).
 *
 * @param dbPath - Absolute or relative path to the .db file.
 *                 Typically sourced from env.DATABASE_PATH.
 * @returns Initialized Database instance (synchronous, better-sqlite3).
 */
export function initializeDatabase(dbPath: string): Database.Database {
  const resolvedPath = path.resolve(dbPath);
  const dataDir = path.dirname(resolvedPath);

  // 1. Ensure the containing directory exists.
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info({ dataDir }, 'Database directory created');
    } catch (mkdirError) {
      logger.error(
        { error: mkdirError instanceof Error ? mkdirError.message : String(mkdirError), dataDir },
        'Failed to create database directory'
      );
      throw mkdirError;
    }
  }

  let db: Database.Database;

  try {
    // 2. Open or create the SQLite file.
    db = new Database(resolvedPath);
    logger.info({ dbPath: resolvedPath }, 'Database file opened/created');
  } catch (openError) {
    const err = openError as NodeJS.ErrnoException;

    if (err.code === 'EACCES') {
      logger.error(
        {
          error: err.message,
          dbPath: resolvedPath,
          code: err.code,
          hint: `Ensure the process has read/write access to: ${dataDir}`,
        },
        'Database open failed — permission denied (EACCES)'
      );
    } else {
      logger.error(
        { error: err.message, dbPath: resolvedPath, code: err.code },
        'Database open failed'
      );
    }

    throw openError;
  }

  try {
    // 3. Enable foreign-key constraints (required for CASCADE deletes).
    db.pragma('foreign_keys = ON');

    // 4. Execute full schema — tables + indexes (all IF NOT EXISTS).
    db.exec(FULL_SCHEMA);

    logger.info({ dbPath: resolvedPath }, 'Database schema initialized (tables + indexes ready)');
  } catch (schemaError) {
    logger.error(
      {
        error: schemaError instanceof Error ? schemaError.message : String(schemaError),
        dbPath: resolvedPath,
      },
      'Database schema execution failed'
    );
    throw schemaError;
  }

  return db;
}

/**
 * Returns the singleton Database instance, creating it on first call.
 * DATABASE_PATH is read from environment variables via getEnv().
 *
 * Use this in application code to avoid opening multiple connections.
 */
export function getDatabase(): Database.Database {
  if (!dbInstance) {
    const env = getEnv();
    dbInstance = initializeDatabase(env.DATABASE_PATH);
  }
  return dbInstance;
}

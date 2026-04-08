/**
 * Database domain models for Netcatty.
 * Contains types for database connections, queries, and schema information.
 */

// Supported database drivers
export type DatabaseDriver = 'mysql' | 'postgresql' | 'sqlite' | 'redis' | 'memcached' | 'mongodb';

/**
 * Configuration for a database connection.
 */
export interface DatabaseConfig {
  id: string;
  label: string;
  driver: DatabaseDriver;
  host: string;
  port: number;
  database?: string;
  username?: string;
  // TLS settings
  tls?: boolean;
  tlsCa?: string;
  tlsCert?: string;
  tlsKey?: string;
  tlsRejectUnauthorized?: boolean;
  // SQLite specific
  filePath?: string;
  // Redis specific
  databaseIndex?: number;
  // MongoDB specific
  replicaSet?: string;
  authSource?: string;
  authPassword?: string; // encrypted via safeStorage
  // Connection pool
  poolMin?: number;
  poolMax?: number;
  poolIdleTimeoutMs?: number;
  // Proxy/tunnel
  sshTunnelHostId?: string;
  sshTunnelLocalPort?: number;
  // SSH host (for tunnel passthrough)
  hostId?: string;
  createdAt?: number;
  lastConnectedAt?: number;
}

/**
 * Current status of a database connection.
 */
export interface ConnectionStatus {
  connected: boolean;
  sessionId: string;
  driver: DatabaseDriver;
  serverVersion?: string;
  uptimeMs?: number;
  activeQueries?: number;
  lastActivity?: number;
  error?: string;
}

/**
 * Result of a database query execution.
 */
export interface QueryResult {
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  insertId?: number | bigint;
  command: string;
  durationMs: number;
  truncated?: boolean;
  error?: string;
  // Redis specific
  result?: unknown;
}

/**
 * Schema information for a connected database.
 */
export interface DatabaseSchema {
  driver: DatabaseDriver;
  serverVersion: string;
  databases?: string[];
  tables: TableInfo[];
  views: TableInfo[];
  indexes: IndexInfo[];
  collections?: string[];
  extensions?: string[];
}

/**
 * Information about a database table or view.
 */
export interface TableInfo {
  name: string;
  schema?: string;
  columns: ColumnInfo[];
  rowCountEstimate?: number;
}

/**
 * Information about a column in a table.
 */
export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string;
  characterMaximumLength?: number;
  numericPrecision?: number;
  numericScale?: number;
}

/**
 * Information about an index on a table.
 */
export interface IndexInfo {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  type: string;
}

/**
 * Runtime session state for an active database connection.
 */
export interface DatabaseSession {
  id: string;
  configId: string;
  driver: DatabaseDriver;
  label: string;
  status: ConnectionStatus;
  createdAt: number;
  lastActivity: number;
}

/**
 * A query tab with its query text and results.
 */
export interface QueryTab {
  id: string;
  name: string;
  query: string;
  results?: QueryResult;
  isExecuting: boolean;
  error?: string;
}

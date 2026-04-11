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
  group?: string;
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
  fields?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  insertId?: number | bigint;
  command: string;
  durationMs: number;
  truncated?: boolean;
  error?: string;
  type?: string;
  message?: string;
  affectedRows?: number;
  warningCount?: number;
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
  loadedDatabases?: string[];
  keyspaces?: Array<{
    name: string;
    keys?: number;
  }>;
  sampledKeyTypes?: Record<string, number>;
  sampledKeyCount?: number;
  totalKeyCount?: number;
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
  columnsLoaded?: boolean;
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

// Filter types
export type FilterOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL' | 'BETWEEN';

export interface FilterCondition {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string | string[] | null;
  enabled: boolean;
  /** Logic operator between this and the previous sibling (first child has no predecessor, so this is unused) */
  logicOperator?: 'AND' | 'OR';
}

export interface FilterGroup {
  id: string;
  logicOperator: 'AND' | 'OR';
  children: (FilterCondition | FilterGroup)[];
}

export interface FilterState {
  rootGroup: FilterGroup;
}

// Cell editing
export type ColumnInputType = 'text' | 'longtext' | 'number' | 'decimal' | 'date' | 'datetime' | 'boolean' | 'enum';

export interface EditCellRequest {
  rowIndex: number;
  column: string;
  oldValue: unknown;
  newValue: unknown;
  primaryKeyColumn: string;
  primaryKeyValue: unknown;
}

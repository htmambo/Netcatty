/**
 * MySQL / MariaDB Bridge - Handles MySQL/MariaDB connections and queries
 * Uses mysql2 with promise support for async/await API
 */

const mysql = require("mysql2/promise");
const {
  MAX_ROWS,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_QUERY_TIMEOUT,
  detectCommand,
  formatQueryResult,
  buildErrorResult,
  validateConfig,
  maskSensitiveConfig,
} = require("./base.cjs");

/**
 * Test a MySQL connection without creating a persistent pool.
 * Used for validating credentials and checking server availability.
 *
 * @param {object} config - Connection configuration
 * @param {string} config.host - Hostname
 * @param {number} [config.port=3306] - Port number
 * @param {string} config.user - Username
 * @param {string} [config.password] - Password
 * @param {string} [config.database] - Default database
 * @param {boolean} [config.ssl=false] - Enable TLS/SSL
 * @param {string} [config.sslCa] - CA certificate
 * @param {string} [config.sslCert] - Client certificate
 * @param {string} [config.sslKey] - Client key
 * @param {boolean} [config.allowPublicKeyRetrieval=false] - Allow public key retrieval
 * @param {boolean} [config.compress=false] - Use compression
 * @param {number} [config.connectionTimeout=10000] - Connection timeout in ms
 * @returns {Promise<{ok: boolean, version?: string, latencyMs?: number, error?: string}>}
 */
async function testConnection(config) {
  const validation = validateConfig(config, ["host", "user"]);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const connectionTimeout = config.connectionTimeout || DEFAULT_CONNECTION_TIMEOUT;

  try {
    const startTime = Date.now();

    const connectionConfig = {
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password || "",
      database: config.database || undefined,
      connectTimeout: connectionTimeout,
      // Security options
      allowPublicKeyRetrieval: config.allowPublicKeyRetrieval !== false,
      // TLS/SSL configuration
      ssl: buildSslConfig(config),
      // Performance
      compress: config.compress || false,
      // Timezone handling
      timezone: "local",
    };

    const connection = await mysql.createConnection(connectionConfig);

    try {
      const [versionRows] = await connection.execute("SELECT VERSION() AS version");
      const version = versionRows?.[0]?.version || "unknown";
      const latencyMs = Date.now() - startTime;

      return { ok: true, version, latencyMs };
    } finally {
      await connection.end();
    }
  } catch (err) {
    return buildErrorResult(err, "Failed to connect to MySQL server");
  }
}

/**
 * Build the SSL/TLS configuration object for mysql2.
 * @param {object} config - User config
 * @returns {object|false} - SSL config or false to disable
 */
function buildSslConfig(config) {
  if (!config.ssl) return false;

  const sslConfig = {};

  if (config.sslCa) sslConfig.ca = config.sslCa;
  if (config.sslCert) sslConfig.cert = config.sslCert;
  if (config.sslKey) sslConfig.key = config.sslKey;
  if (config.sslRejectUnauthorized === false) sslConfig.rejectUnauthorized = false;

  return Object.keys(sslConfig).length > 0 ? sslConfig : false;
}

/**
 * Create a MySQL connection pool.
 * Pools are managed externally by the coordinator bridge (databaseBridge.cjs).
 *
 * @param {object} config - Connection configuration (same as testConnection)
 * @returns {Promise<{ok: boolean, pool?: object, error?: string}>}
 */
async function createPool(config) {
  const validation = validateConfig(config, ["host", "user"]);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const connectionTimeout = config.connectionTimeout || DEFAULT_CONNECTION_TIMEOUT;

  try {
    const poolConfig = {
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password || "",
      database: config.database || undefined,
      waitForConnections: true,
      connectionLimit: config.connectionLimit || 10,
      queueLimit: config.queueLimit || 0,
      connectTimeout: connectionTimeout,
      // Security options
      allowPublicKeyRetrieval: config.allowPublicKeyRetrieval !== false,
      // TLS/SSL
      ssl: buildSslConfig(config),
      // Performance
      compress: config.compress || false,
      // Timezone
      timezone: "local",
      // Idle timeout (close idle connections after this many ms)
      idleTimeout: config.idleTimeout || 60000,
    };

    const pool = mysql.createPool(poolConfig);

    // Verify the pool is functional with a quick ping
    try {
      const conn = await pool.getConnection();
      conn.release();
    } catch (pingErr) {
      await pool.end();
      return buildErrorResult(pingErr, "Pool created but failed to connect");
    }

    return { ok: true, pool };
  } catch (err) {
    return buildErrorResult(err, "Failed to create MySQL pool");
  }
}

/**
 * Execute a query against a MySQL pool.
 *
 * @param {object} pool - The mysql2 pool
 * @param {string} query - SQL query string
 * @param {Array<any>} [params] - Query parameters for prepared statements
 * @param {object} [options] - Query options
 * @param {number} [options.queryTimeout] - Query timeout in ms
 * @returns {Promise<object>} - Formatted query result
 */
async function executeQuery(pool, query, params = [], options = {}) {
  if (!pool) {
    return buildErrorResult("No pool available");
  }

  if (!query || typeof query !== "string") {
    return buildErrorResult("Invalid query string");
  }

  const queryTimeout = options.queryTimeout || DEFAULT_QUERY_TIMEOUT;
  const commandType = detectCommand(query);

  try {
    const [rows, fields] = await Promise.race([
      pool.execute(query, params),
      timeout(queryTimeout, "Query timed out"),
    ]);

    const result = { rows, fields };
    return formatQueryResult(result, commandType);
  } catch (err) {
    if (err.message === "Query timed out") {
      return buildErrorResult(`Query exceeded timeout of ${queryTimeout}ms`, "Query timeout");
    }
    return buildErrorResult(err, "Query execution failed");
  }
}

/**
 * Create a promise that rejects after a timeout.
 * @param {number} ms - Timeout in milliseconds
 * @param {string} message - Error message
 * @returns {Promise<never>}
 */
function timeout(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

/**
 * Get the database schema (databases, tables, columns, indexes).
 *
 * @param {object} pool - The mysql2 pool
 * @param {string} [database] - Specific database to query (optional, defaults to connected DB)
 * @returns {Promise<{ok: boolean, schema?: object, error?: string}>}
 */
async function getSchema(pool, database = null) {
  if (!pool) {
    return buildErrorResult("No pool available");
  }

  try {
    const schema = {
      databases: [],
      tables: [],
      views: [],
      routines: [],
    };

    // Get databases
    try {
      const [dbRows] = await pool.execute("SHOW DATABASES");
      schema.databases = dbRows.map((r) => r.Database || r.Database_name).filter(Boolean);
    } catch {
      // SHOW DATABASES may require privileges; continue with empty
    }

    // Get tables in the current/specified database
    const tableQuery = database
      ? `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`
      : "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME";

    const queryParams = database ? [database] : [];

    try {
      const [tableRows] = await pool.execute(tableQuery, queryParams);
      schema.tables = tableRows.map((r) => ({
        database: r.TABLE_SCHEMA,
        name: r.TABLE_NAME,
        type: r.TABLE_TYPE, // BASE TABLE, VIEW, SYSTEM VIEW
        rowCount: r.TABLE_ROWS || 0,
        dataLength: r.DATA_LENGTH || 0,
        indexLength: r.INDEX_LENGTH || 0,
      }));
    } catch {
      // Fallback to SHOW TABLES
      try {
        const [fallbackRows] = await pool.execute("SHOW TABLES");
        schema.tables = fallbackRows.map((r) => ({
          database: database || "",
          name: Object.values(r)[0],
          type: "BASE TABLE",
          rowCount: 0,
          dataLength: 0,
          indexLength: 0,
        }));
      } catch {
        // Skip tables
      }
    }

    // Get columns for each table (limited to first 20 tables to avoid performance issues)
    const tablesToInspect = schema.tables.slice(0, 20);
    const columnPromises = tablesToInspect.map(async (table) => {
      try {
        const colQuery = database
          ? `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`
          : "SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION";
        const colParams = database ? [database, table.name] : [table.name];
        const [colRows] = await pool.execute(colQuery, colParams);
        return {
          table: table.name,
          columns: colRows.map((c) => ({
            name: c.COLUMN_NAME,
            dataType: c.DATA_TYPE,
            fullType: c.COLUMN_TYPE,
            nullable: c.IS_NULLABLE === "YES",
            key: c.COLUMN_KEY,
            defaultValue: c.COLUMN_DEFAULT,
            extra: c.EXTRA,
            comment: c.COLUMN_COMMENT || "",
          })),
        };
      } catch {
        return { table: table.name, columns: [] };
      }
    });

    const columnResults = await Promise.all(columnPromises);
    for (const colResult of columnResults) {
      const tableEntry = schema.tables.find((t) => t.name === colResult.table);
      if (tableEntry) {
        tableEntry.columns = colResult.columns;
      }
    }

    // Get indexes for each table (limited to first 10)
    const indexedTables = schema.tables.slice(0, 10);
    const indexPromises = indexedTables.map(async (table) => {
      try {
        const idxQuery = database
          ? `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE, SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`
          : "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE, SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX";
        const idxParams = database ? [database, table.name] : [table.name];
        const [idxRows] = await pool.execute(idxQuery, idxParams);

        // Group by index name
        const indexMap = new Map();
        for (const idx of idxRows) {
          if (!indexMap.has(idx.INDEX_NAME)) {
            indexMap.set(idx.INDEX_NAME, {
              name: idx.INDEX_NAME,
              type: idx.INDEX_TYPE === "FULLTEXT" ? "FULLTEXT" : idx.NON_UNIQUE === 0 ? "UNIQUE" : "INDEX",
              columns: [],
            });
          }
          indexMap.get(idx.INDEX_NAME).columns.push(idx.COLUMN_NAME);
        }

        return { table: table.name, indexes: Array.from(indexMap.values()) };
      } catch {
        return { table: table.name, indexes: [] };
      }
    });

    const indexResults = await Promise.all(indexPromises);
    for (const idxResult of indexResults) {
      const tableEntry = schema.tables.find((t) => t.name === idxResult.table);
      if (tableEntry) {
        tableEntry.indexes = idxResult.indexes;
      }
    }

    return { ok: true, schema };
  } catch (err) {
    return buildErrorResult(err, "Failed to retrieve schema");
  }
}

/**
 * List objects in the database (tables, views, procedures, functions).
 *
 * @param {object} pool - The mysql2 pool
 * @param {string} [type] - Filter by type: 'tables' | 'views' | 'procedures' | 'functions' | 'all'
 * @param {string} [database] - Database name
 * @returns {Promise<{ok: boolean, objects?: Array, error?: string}>}
 */
async function listObjects(pool, type = "all", database = null) {
  if (!pool) {
    return buildErrorResult("No pool available");
  }

  const objects = [];

  try {
    // Tables and views
    if (type === "all" || type === "tables" || type === "views") {
      try {
        const tableQuery = database
          ? `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`
          : `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`;
        const queryParams = database ? [database] : [];
        const [rows] = await pool.execute(tableQuery, queryParams);
        for (const row of rows) {
          const objType = row.TABLE_TYPE === "VIEW" ? "view" : "table";
          if (type === "all" || type === "tables" || (type === "views" && objType === "view")) {
            objects.push({
              name: row.TABLE_NAME,
              type: objType,
              database: row.TABLE_SCHEMA,
            });
          }
        }
      } catch {
        // Fallback
        try {
          const [rows] = await pool.execute("SHOW FULL TABLES");
          for (const row of rows) {
            const name = row[Object.keys(row)[0]];
            const tableType = row[Object.keys(row)[1]];
            const objType = tableType === "VIEW" ? "view" : "table";
            if (type === "all" || type === "tables" || (type === "views" && objType === "view")) {
              objects.push({ name, type: objType, database: database || "" });
            }
          }
        } catch {
          // Skip
        }
      }
    }

    // Stored procedures
    if (type === "all" || type === "procedures") {
      try {
        const procQuery = database
          ? `SELECT ROUTINE_NAME, ROUTINE_SCHEMA FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME`
          : `SELECT ROUTINE_NAME, ROUTINE_SCHEMA FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME`;
        const procParams = database ? [database] : [];
        const [rows] = await pool.execute(procQuery, procParams);
        for (const row of rows) {
          objects.push({
            name: row.ROUTINE_NAME,
            type: "procedure",
            database: row.ROUTINE_SCHEMA,
          });
        }
      } catch {
        // Skip
      }
    }

    // Stored functions
    if (type === "all" || type === "functions") {
      try {
        const funcQuery = database
          ? `SELECT ROUTINE_NAME, ROUTINE_SCHEMA FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION' ORDER BY ROUTINE_NAME`
          : `SELECT ROUTINE_NAME, ROUTINE_SCHEMA FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'FUNCTION' ORDER BY ROUTINE_NAME`;
        const funcParams = database ? [database] : [];
        const [rows] = await pool.execute(funcQuery, funcParams);
        for (const row of rows) {
          objects.push({
            name: row.ROUTINE_NAME,
            type: "function",
            database: row.ROUTINE_SCHEMA,
          });
        }
      } catch {
        // Skip
      }
    }

    return { ok: true, objects };
  } catch (err) {
    return buildErrorResult(err, "Failed to list objects");
  }
}

/**
 * Destroy a connection pool.
 *
 * @param {object} pool - The mysql2 pool to destroy
 * @returns {Promise<void>}
 */
async function destroyPool(pool) {
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Get server status information.
 *
 * @param {object} pool - The mysql2 pool
 * @returns {Promise<object>}
 */
async function getServerStatus(pool) {
  if (!pool) {
    return buildErrorResult("No pool available");
  }

  try {
    const [statusRows] = await pool.execute("SHOW STATUS");
    const [variablesRows] = await pool.execute("SHOW VARIABLES");

    const status = {};
    for (const row of statusRows) {
      status[row.Variable_name] = row.Value;
    }

    const variables = {};
    for (const row of variablesRows) {
      variables[row.Variable_name] = row.Value;
    }

    return {
      ok: true,
      status: {
        version: variables.version || "unknown",
        versionComment: variables.version_comment || "",
        maxConnections: parseInt(variables.max_connections, 10) || 0,
        threadConnections: parseInt(status.threads_connected, 10) || 0,
        threadCached: parseInt(status.threads_cached, 10) || 0,
        uptime: parseInt(status.uptime, 10) || 0,
        queries: parseInt(status.questions, 10) || 0,
        bytesReceived: parseInt(status.bytes_received, 10) || 0,
        bytesSent: parseInt(status.bytes_sent, 10) || 0,
      },
    };
  } catch (err) {
    return buildErrorResult(err, "Failed to get server status");
  }
}

module.exports = {
  testConnection,
  createPool,
  executeQuery,
  getSchema,
  listObjects,
  destroyPool,
  getServerStatus,
};

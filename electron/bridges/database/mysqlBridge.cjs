/**
 * MySQL / MariaDB Bridge - Handles MySQL/MariaDB connections and queries
 * Uses mysql2 with promise support for async/await API
 */

const mysql = require("mysql2/promise");
const {
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_QUERY_TIMEOUT,
  detectCommand,
  formatQueryResult,
  buildErrorResult,
  validateConfig,
} = require("./base.cjs");

const SYSTEM_DATABASES = ["information_schema", "performance_schema", "mysql", "sys"];
const TABLE_DETAILS_CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_TABLE_DATA_PAGE_SIZE = 100;
const MAX_TABLE_DATA_PAGE_SIZE = 500;
const GEOMETRY_TYPES = [
  "geometry",
  "point",
  "linestring",
  "polygon",
  "multipoint",
  "multilinestring",
  "multipolygon",
  "geometrycollection",
];
const tableDetailsCacheByPool = new WeakMap();

function buildExcludedSchemasClause(columnName) {
  const placeholders = SYSTEM_DATABASES.map(() => "?").join(", ");
  return {
    clause: `${columnName} NOT IN (${placeholders})`,
    params: [...SYSTEM_DATABASES],
  };
}

function quoteIdentifier(identifier) {
  return `\`${String(identifier || "").replace(/`/g, "``")}\``;
}

function normalizePositiveInteger(value, fallback, max = Number.POSITIVE_INFINITY) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(numeric, max);
}

function buildQualifiedTableName(schemaName, objectName) {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(objectName)}`;
}

function buildPreviewColumnExpression(column) {
  const columnRef = quoteIdentifier(column?.name || "");
  const alias = quoteIdentifier(column?.name || "");
  const type = String(column?.dataType || "").trim().toLowerCase();

  if (
    type.includes("blob") ||
    type.includes("binary") ||
    type.startsWith("bit")
  ) {
    return `CASE WHEN ${columnRef} IS NULL THEN NULL ELSE CONCAT('<binary ', OCTET_LENGTH(${columnRef}), ' bytes>') END AS ${alias}`;
  }

  if (GEOMETRY_TYPES.some((entry) => type.startsWith(entry))) {
    return `CASE WHEN ${columnRef} IS NULL THEN NULL ELSE ST_AsText(${columnRef}) END AS ${alias}`;
  }

  if (type.includes("text") || type.startsWith("json")) {
    return columnRef;
  }

  return columnRef;
}

async function getApproximateRowCount(pool, schemaName, objectName) {
  try {
    const [rows] = await pool.execute(
      `SELECT TABLE_ROWS, TABLE_TYPE
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       LIMIT 1`,
      [schemaName, objectName],
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { totalRows: undefined, estimated: false };

    const rawCount = row.TABLE_ROWS;
    const totalRows =
      typeof rawCount === "number"
        ? rawCount
        : Number.parseInt(String(rawCount || ""), 10);

    if (!Number.isFinite(totalRows) || totalRows < 0) {
      return { totalRows: undefined, estimated: false };
    }

    return {
      totalRows,
      estimated: String(row.TABLE_TYPE || "").toUpperCase() !== "VIEW",
    };
  } catch {
    return { totalRows: undefined, estimated: false };
  }
}

function getPoolDetailsCache(pool) {
  let cache = tableDetailsCacheByPool.get(pool);
  if (!cache) {
    cache = new Map();
    tableDetailsCacheByPool.set(pool, cache);
  }
  return cache;
}

function clearPoolDetailsCache(pool) {
  if (pool) {
    tableDetailsCacheByPool.delete(pool);
  }
}

function getCachedTableDetails(pool, cacheKey) {
  const cache = tableDetailsCacheByPool.get(pool);
  if (!cache) return null;

  const cached = cache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt > TABLE_DETAILS_CACHE_TTL_MS) {
    cache.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function setCachedTableDetails(pool, cacheKey, value) {
  const cache = getPoolDetailsCache(pool);
  cache.set(cacheKey, {
    cachedAt: Date.now(),
    value,
  });
}

async function getCurrentDatabase(pool) {
  try {
    const [rows] = await pool.query("SELECT DATABASE() AS currentDatabase");
    if (Array.isArray(rows) && rows[0]) {
      return rows[0].currentDatabase || null;
    }
  } catch {
    // ignore
  }

  return null;
}

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
  const hasParams = Array.isArray(params) && params.length > 0;

  try {
    const [rows, fields] = await Promise.race([
      hasParams ? pool.execute(query, params) : pool.query(query),
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
 * @param {string} [database] - Specific database to query (optional)
 * @returns {Promise<{ok: boolean, schema?: object, error?: string}>}
 */
async function getSchema(pool, database = null) {
  if (!pool) {
    return buildErrorResult("No pool available");
  }

  try {
    clearPoolDetailsCache(pool);

    const schema = {
      serverVersion: "unknown",
      databases: [],
      tables: [],
      views: [],
      routines: [],
    };

    let currentDatabase = null;
    try {
      const [versionRows] = await pool.query("SELECT VERSION() AS version, DATABASE() AS currentDatabase");
      if (Array.isArray(versionRows) && versionRows[0]) {
        schema.serverVersion = versionRows[0].version || "unknown";
        currentDatabase = versionRows[0].currentDatabase || null;
      }
    } catch {
      // Version and current database are best-effort only
    }

    // Get databases
    try {
      const [dbRows] = await pool.query("SHOW DATABASES");
      schema.databases = dbRows
        .map((r) => r.Database || r.Database_name)
        .filter((name) => Boolean(name) && !SYSTEM_DATABASES.includes(name));
    } catch {
      // SHOW DATABASES may require privileges; continue with empty
    }

    if (
      schema.databases.length === 0 &&
      currentDatabase &&
      !SYSTEM_DATABASES.includes(currentDatabase)
    ) {
      schema.databases = [currentDatabase];
    }

    schema.loadedDatabases = [];

    if (!database) {
      return { ok: true, schema };
    }

    const targetDatabase = database;
    if (!schema.databases.includes(targetDatabase)) {
      schema.databases = [...schema.databases, targetDatabase].sort();
    }

    // Get tables in the current/specified database
    try {
      const [tableRows] = await pool.query(
        `SHOW FULL TABLES FROM ${quoteIdentifier(targetDatabase)}`,
      );
      schema.tables = tableRows.map((r) => ({
        database: targetDatabase,
        name: Object.values(r)[0],
        type: Object.values(r)[1],
        rowCount: 0,
        dataLength: 0,
        indexLength: 0,
      }));
    } catch {
      // Fallback to INFORMATION_SCHEMA for permissions/compatibility issues
      const [tableRows] = await pool.execute(
        `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [targetDatabase],
      );
      schema.tables = tableRows.map((r) => ({
        database: r.TABLE_SCHEMA,
        name: r.TABLE_NAME,
        type: r.TABLE_TYPE,
        rowCount: r.TABLE_ROWS || 0,
        dataLength: r.DATA_LENGTH || 0,
        indexLength: r.INDEX_LENGTH || 0,
      }));
    }

    schema.loadedDatabases = [targetDatabase];

    return { ok: true, schema };
  } catch (err) {
    return buildErrorResult(err, "Failed to retrieve schema");
  }
}

/**
 * Get column details for a specific table or view.
 *
 * @param {object} pool - The mysql2 pool
 * @param {object} selection - Object selection payload
 * @param {string} [database] - Default database name
 * @returns {Promise<object>}
 */
async function getObjectDetails(pool, selection, database = null) {
  if (!pool) {
    return buildErrorResult("No pool available");
  }

  const objectName = typeof selection?.name === "string" ? selection.name : "";
  const objectKind = typeof selection?.kind === "string" ? selection.kind : "";
  const schemaName =
    typeof selection?.schemaName === "string" && selection.schemaName
      ? selection.schemaName
      : database || (await getCurrentDatabase(pool));

  if (!objectName || (objectKind !== "table" && objectKind !== "view")) {
    return buildErrorResult("Unsupported database object");
  }

  if (!schemaName) {
    return buildErrorResult("Database name is required for table details");
  }

  const cacheKey = `${schemaName}:${objectKind}:${objectName}`;
  const cached = getCachedTableDetails(pool, cacheKey);
  if (cached) {
    return {
      ok: true,
      object: cached,
    };
  }

  try {
    const sql = `SHOW FULL COLUMNS FROM ${quoteIdentifier(objectName)} FROM ${quoteIdentifier(schemaName)}`;
    const [rows] = await pool.query(sql);
    const columns = Array.isArray(rows)
      ? rows.map((row) => ({
          name: row.Field,
          dataType: row.Type,
          fullType: row.Type,
          nullable: row.Null === "YES",
          key: row.Key,
          primaryKey: row.Key === "PRI",
          defaultValue: row.Default,
          extra: row.Extra,
          comment: row.Comment || "",
        }))
      : [];

    const object = {
      database: schemaName,
      schemaName,
      name: objectName,
      kind: objectKind,
      columns,
    };

    setCachedTableDetails(pool, cacheKey, object);

    return {
      ok: true,
      object,
    };
  } catch (err) {
    return buildErrorResult(err, "Failed to retrieve object details");
  }
}

/**
 * Query paginated table/view data optimized for preview.
 *
 * @param {object} pool - The mysql2 pool
 * @param {object} selection - Object selection payload
 * @param {object} [options] - Pagination options
 * @param {number} [options.page=1] - 1-based page number
 * @param {number} [options.pageSize=100] - Page size
 * @param {string} [options.sortColumn] - Column name to sort by
 * @param {'asc'|'desc'} [options.sortDirection] - Sort direction
 * @param {number} [options.queryTimeout] - Query timeout in ms
 * @param {string} [database] - Default database name
 * @returns {Promise<object>}
 */
async function queryTableData(pool, selection, options = {}, database = null) {
  if (!pool) {
    return buildErrorResult("No pool available");
  }

  const startTime = Date.now();
  const page = normalizePositiveInteger(options.page, 1);
  const pageSize = normalizePositiveInteger(
    options.pageSize,
    DEFAULT_TABLE_DATA_PAGE_SIZE,
    MAX_TABLE_DATA_PAGE_SIZE,
  );
  const queryTimeout = options.queryTimeout || DEFAULT_QUERY_TIMEOUT;
  const details = await getObjectDetails(pool, selection, database);
  if (!details?.ok) {
    return details;
  }

  const object = details.object || {};
  const objectName = typeof object.name === "string" ? object.name : "";
  const schemaName =
    typeof object.schemaName === "string" && object.schemaName
      ? object.schemaName
      : typeof object.database === "string" && object.database
        ? object.database
        : database || (await getCurrentDatabase(pool));

  if (!objectName || !schemaName) {
    return buildErrorResult("Database object is incomplete");
  }

  const sortColumn = typeof options.sortColumn === "string" ? options.sortColumn : null;
  const sortDirection = options.sortDirection === "desc" ? "DESC" : "ASC";

  const columns = Array.isArray(object.columns) ? object.columns : [];
  const qualifiedName = buildQualifiedTableName(schemaName, objectName);
  const offset = (page - 1) * pageSize;
  const fetchLimit = pageSize + 1;

  const orderByClause = sortColumn
    ? (() => {
        const matched = columns.find(
          (col) => col.name === sortColumn,
        );
        if (!matched) return "";
        return ` ORDER BY ${quoteIdentifier(matched.name)} ${sortDirection}`;
      })()
    : "";

  const selectList =
    columns.length > 0
      ? columns.map((column) => buildPreviewColumnExpression(column)).join(",\n")
      : "*";
  const query = `SELECT\n${selectList}\nFROM ${qualifiedName}${orderByClause}\nLIMIT ${pageSize}${offset > 0 ? ` OFFSET ${offset}` : ""};`;
  const dataQuery = `SELECT\n${selectList}\nFROM ${qualifiedName}${orderByClause}\nLIMIT ? OFFSET ?`;

  const totalCountMeta = await getApproximateRowCount(pool, schemaName, objectName);

  try {
    const [rows, fields] = await Promise.race([
      pool.execute(dataQuery, [fetchLimit, offset]),
      timeout(queryTimeout, "Query timed out"),
    ]);

    const rawRows = Array.isArray(rows) ? rows : [];
    const hasMore = rawRows.length > pageSize;
    const pageRows = hasMore ? rawRows.slice(0, pageSize) : rawRows;
    const knownMinimumTotal = offset + pageRows.length + (hasMore ? 1 : 0);
    const resolvedTotalRows =
      typeof totalCountMeta.totalRows === "number"
        ? Math.max(totalCountMeta.totalRows, knownMinimumTotal)
        : knownMinimumTotal > 0 || !hasMore
          ? knownMinimumTotal
          : undefined;

    return {
      ok: true,
      type: "SELECT",
      query,
      rows: pageRows,
      fields:
        Array.isArray(fields) && fields.length > 0
          ? fields.map((field) => field.name)
          : pageRows.length > 0
            ? Object.keys(pageRows[0])
            : columns.map((column) => column.name),
      rowCount: pageRows.length,
      totalRows: resolvedTotalRows,
      totalRowsEstimated:
        totalCountMeta.estimated ||
        (typeof totalCountMeta.totalRows !== "number" && hasMore),
      page,
      pageSize,
      offset,
      hasMore,
      durationMs: Date.now() - startTime,
      message: `${pageRows.length} row(s) returned`,
    };
  } catch (err) {
    if (err.message === "Query timed out") {
      return buildErrorResult(`Query exceeded timeout of ${queryTimeout}ms`, "Query timeout");
    }
    return buildErrorResult(err, "Failed to query table data");
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
    let currentDatabase = null;
    try {
      const [rows] = await pool.query("SELECT DATABASE() AS currentDatabase");
      if (Array.isArray(rows) && rows[0]) {
        currentDatabase = rows[0].currentDatabase || null;
      }
    } catch {
      // ignore
    }
    const targetDatabase = database || currentDatabase || null;
    const excludedSchemas = buildExcludedSchemasClause("TABLE_SCHEMA");
    const excludedRoutineSchemas = buildExcludedSchemasClause("ROUTINE_SCHEMA");

    // Tables and views
    if (type === "all" || type === "tables" || type === "views") {
      try {
        const tableQuery = targetDatabase
          ? `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = ?
             ORDER BY TABLE_NAME`
          : `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
             FROM INFORMATION_SCHEMA.TABLES
             WHERE ${excludedSchemas.clause}
             ORDER BY TABLE_SCHEMA, TABLE_NAME`;
        const queryParams = targetDatabase ? [targetDatabase] : excludedSchemas.params;
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
        if (targetDatabase) {
          const [rows] = await pool.execute("SHOW FULL TABLES");
          for (const row of rows) {
            const name = row[Object.keys(row)[0]];
            const tableType = row[Object.keys(row)[1]];
            const objType = tableType === "VIEW" ? "view" : "table";
            if (type === "all" || type === "tables" || (type === "views" && objType === "view")) {
              objects.push({ name, type: objType, database: targetDatabase });
            }
          }
        }
      }
    }

    // Stored procedures
    if (type === "all" || type === "procedures") {
      try {
        const procQuery = targetDatabase
          ? `SELECT ROUTINE_NAME, ROUTINE_SCHEMA
             FROM INFORMATION_SCHEMA.ROUTINES
             WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'
             ORDER BY ROUTINE_NAME`
          : `SELECT ROUTINE_NAME, ROUTINE_SCHEMA
             FROM INFORMATION_SCHEMA.ROUTINES
             WHERE ${excludedRoutineSchemas.clause} AND ROUTINE_TYPE = 'PROCEDURE'
             ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME`;
        const procParams = targetDatabase ? [targetDatabase] : excludedRoutineSchemas.params;
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
        const funcQuery = targetDatabase
          ? `SELECT ROUTINE_NAME, ROUTINE_SCHEMA
             FROM INFORMATION_SCHEMA.ROUTINES
             WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION'
             ORDER BY ROUTINE_NAME`
          : `SELECT ROUTINE_NAME, ROUTINE_SCHEMA
             FROM INFORMATION_SCHEMA.ROUTINES
             WHERE ${excludedRoutineSchemas.clause} AND ROUTINE_TYPE = 'FUNCTION'
             ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME`;
        const funcParams = targetDatabase ? [targetDatabase] : excludedRoutineSchemas.params;
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
  getObjectDetails,
  queryTableData,
  listObjects,
  destroyPool,
  getServerStatus,
};

/**
 * Database Bridge Base - Shared utilities for all database bridges
 * Provides common helpers, constants, and type definitions used across MySQL, Redis, etc.
 */

// Maximum rows to return from a query (safety limit)
const MAX_ROWS = 10000;

// Default connection timeout in milliseconds
const DEFAULT_CONNECTION_TIMEOUT = 10000;

// Default query timeout in milliseconds
const DEFAULT_QUERY_TIMEOUT = 30000;

/**
 * Detect the type of SQL command from a query string.
 * Returns the command type (SELECT, INSERT, UPDATE, DELETE, etc.) or null if unrecognized.
 * @param {string} query - The SQL query string
 * @returns {string|null} - Command type or null
 */
function detectCommand(query) {
  if (typeof query !== "string") return null;
  const trimmed = query.trim().toUpperCase();

  // Handle multi-word commands that start with known keywords
  const multiWordPatterns = [
    { prefix: "SELECT ", type: "SELECT" },
    { prefix: "INSERT ", type: "INSERT" },
    { prefix: "INSERT INTO ", type: "INSERT" },
    { prefix: "UPDATE ", type: "UPDATE" },
    { prefix: "DELETE ", type: "DELETE" },
    { prefix: "DELETE FROM ", type: "DELETE" },
    { prefix: "CREATE ", type: "CREATE" },
    { prefix: "ALTER ", type: "ALTER" },
    { prefix: "DROP ", type: "DROP" },
    { prefix: "TRUNCATE ", type: "TRUNCATE" },
    { prefix: "SHOW ", type: "SHOW" },
    { prefix: "DESCRIBE ", type: "DESCRIBE" },
    { prefix: "DESC ", type: "DESC" },
    { prefix: "EXPLAIN ", type: "EXPLAIN" },
    { prefix: "USE ", type: "USE" },
    { prefix: "SET ", type: "SET" },
    { prefix: "BEGIN", type: "BEGIN" },
    { prefix: "COMMIT", type: "COMMIT" },
    { prefix: "ROLLBACK", type: "ROLLBACK" },
    { prefix: "START TRANSACTION", type: "BEGIN" },
    { prefix: "CALL ", type: "CALL" },
    { prefix: "GRANT ", type: "GRANT" },
    { prefix: "REVOKE ", type: "REVOKE" },
  ];

  for (const { prefix, type } of multiWordPatterns) {
    if (trimmed.startsWith(prefix)) {
      return type;
    }
  }

  return null;
}

/**
 * Format a query result into a consistent structure.
 * Handles both array results (SELECT) and affected-row results (INSERT/UPDATE/DELETE).
 * @param {object} result - Raw database result
 * @param {Array<any>} [result.rows] - Row data (SELECT results)
 * @param {number} [result.affectedRows] - Affected rows (INSERT/UPDATE/DELETE)
 * @param {number} [result.insertId] - Insert ID for newly inserted rows
 * @param {Array<string>} [result.fields] - Column names (optional, auto-detected from rows)
 * @param {string} [commandType] - Detected command type
 * @returns {object} - Formatted result
 */
function formatQueryResult(result, commandType) {
  if (!result || typeof result !== "object") {
    return buildErrorResult("Invalid result from database");
  }

  const isSelect =
    Array.isArray(result.rows) ||
    Array.isArray(result) ||
    (commandType === "SELECT" || commandType === "SHOW" || commandType === "DESCRIBE" || commandType === "DESC" || commandType === "EXPLAIN");

  if (isSelect) {
    const rows = Array.isArray(result.rows) ? result.rows : Array.isArray(result) ? result : [];
    const limited = rows.length > MAX_ROWS;
    return {
      ok: true,
      type: commandType || "SELECT",
      rows: limited ? rows.slice(0, MAX_ROWS) : rows,
      fields: result.fields || (rows.length > 0 ? Object.keys(rows[0]) : []),
      rowCount: limited ? rows.length : (limited ? MAX_ROWS : rows.length),
      truncated: limited,
      message: limited ? `Result truncated to ${MAX_ROWS} rows` : `${rows.length} row(s) returned`,
    };
  }

  // DML operations: INSERT, UPDATE, DELETE
  return {
    ok: true,
    type: commandType || "UNKNOWN",
    affectedRows: typeof result.affectedRows === "number" ? result.affectedRows : 0,
    insertId: result.insertId || null,
    warningCount: result.warningCount || 0,
    message: buildDmlMessage(result, commandType),
  };
}

/**
 * Build a human-readable message for DML results.
 * @param {object} result - Raw result
 * @param {string} commandType - Command type
 * @returns {string}
 */
function buildDmlMessage(result, commandType) {
  const affected = typeof result.affectedRows === "number" ? result.affectedRows : 0;
  switch (commandType) {
    case "INSERT":
      return result.insertId
        ? `${affected} row(s) inserted, last insert ID: ${result.insertId}`
        : `${affected} row(s) inserted`;
    case "UPDATE":
      return `${affected} row(s) updated`;
    case "DELETE":
      return `${affected} row(s) deleted`;
    case "CREATE":
    case "ALTER":
    case "DROP":
    case "TRUNCATE":
      return `${affected} row(s) affected`;
    default:
      return `${affected} row(s) affected`;
  }
}

/**
 * Build a consistent error result object.
 * @param {string|Error|object} error - The error
 * @param {string} [fallbackMessage] - Fallback message if error has no message
 * @returns {object} - Error result
 */
function buildErrorResult(error, fallbackMessage = "Database operation failed") {
  if (!error) {
    return { ok: false, error: fallbackMessage };
  }

  if (typeof error === "string") {
    return { ok: false, error };
  }

  if (error instanceof Error) {
    return { ok: false, error: error.message, code: error.code || null };
  }

  if (typeof error === "object") {
    return {
      ok: false,
      error: error.message || error.msg || fallbackMessage,
      code: error.code || null,
      errno: error.errno || null,
    };
  }

  return { ok: false, error: fallbackMessage };
}

/**
 * Validate a database configuration object.
 * @param {object} config - The config to validate
 * @param {string[]} requiredFields - Required field names
 * @returns {{ok: boolean, error?: string}}
 */
function validateConfig(config, requiredFields) {
  if (!config || typeof config !== "object") {
    return { ok: false, error: "Invalid configuration object" };
  }

  for (const field of requiredFields) {
    if (config[field] === undefined || config[field] === null || config[field] === "") {
      return { ok: false, error: `Missing required field: ${field}` };
    }
  }

  return { ok: true };
}

/**
 * Mask sensitive fields in a config object for safe logging.
 * @param {object} config - The config object
 * @param {string[]} sensitiveFields - Field names to mask
 * @returns {object} - Copy with sensitive fields masked
 */
function maskSensitiveConfig(config, sensitiveFields = ["password", "privateKey", "certificate", "passphrase"]) {
  if (!config || typeof config !== "object") return config;
  const masked = { ...config };
  for (const field of sensitiveFields) {
    if (field in masked && typeof masked[field] === "string" && masked[field].length > 0) {
      masked[field] = "********";
    }
  }
  return masked;
}

module.exports = {
  MAX_ROWS,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_QUERY_TIMEOUT,
  detectCommand,
  formatQueryResult,
  buildErrorResult,
  validateConfig,
  maskSensitiveConfig,
};

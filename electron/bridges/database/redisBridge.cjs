/**
 * Redis Bridge - Handles Redis connections and commands
 * Uses ioredis for full Redis command support with TLS and connection management
 */

let Redis;
try {
  Redis = require("ioredis");
} catch {
  Redis = null;
}

const {
  DEFAULT_CONNECTION_TIMEOUT,
  buildErrorResult,
  validateConfig,
} = require("./base.cjs");

/**
 * Test a Redis connection by connecting and pinging.
 *
 * @param {object} config - Connection configuration
 * @param {string} config.host - Hostname
 * @param {number} [config.port=6379] - Port number
 * @param {string} [config.password] - Password (if AUTH required)
 * @param {number} [config.db=0] - Database number
 * @param {boolean} [config.tls=false] - Enable TLS
 * @param {string} [config.tlsCa] - CA certificate
 * @param {string} [config.tlsCert] - Client certificate
 * @param {string} [config.tlsKey] - Client key
 * @param {number} [config.connectionTimeout=10000] - Connection timeout in ms
 * @returns {Promise<{ok: boolean, version?: string, latencyMs?: number, error?: string}>}
 */
async function testConnection(config) {
  if (!Redis) {
    return buildErrorResult("ioredis module not available", "Redis driver not installed");
  }

  const validation = validateConfig(config, ["host"]);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const connectionTimeout = config.connectionTimeout || DEFAULT_CONNECTION_TIMEOUT;

  try {
    const startTime = Date.now();

    const client = new Redis({
      host: config.host,
      port: config.port || 6379,
      password: config.password || undefined,
      db: config.db || 0,
      tls: buildTlsConfig(config),
      connectTimeout: connectionTimeout,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null, // Disable retries for test
    });

    // Set up error handler
    const errorPromise = new Promise((_, reject) => {
      client.on("error", (err) => reject(err));
    });

    try {
      await Promise.race([
        client.connect(),
        errorPromise,
      ]);
    } catch (connectErr) {
      client.disconnect();
      return buildErrorResult(connectErr, "Failed to connect to Redis server");
    }

    try {
      const latencyMs = Date.now() - startTime;

      // Get Redis version
      const info = await client.info("server");
      const versionMatch = info.match(/redis_version:([^\r\n]+)/);
      const version = versionMatch ? versionMatch[1].trim() : "unknown";

      await client.quit();
      return { ok: true, version, latencyMs };
    } catch (execErr) {
      client.disconnect();
      return buildErrorResult(execErr, "Failed to execute test command");
    }
  } catch (err) {
    return buildErrorResult(err, "Failed to connect to Redis server");
  }
}

/**
 * Build the TLS configuration object for ioredis.
 * @param {object} config - User config
 * @returns {object|undefined} - TLS config or undefined
 */
function buildTlsConfig(config) {
  if (!config.tls) return undefined;

  const tlsConfig = {};

  if (config.tlsCa) tlsConfig.ca = config.tlsCa;
  if (config.tlsCert) tlsConfig.cert = config.tlsCert;
  if (config.tlsKey) tlsConfig.key = config.tlsKey;
  if (config.tlsRejectUnauthorized === false) tlsConfig.rejectUnauthorized = false;

  return tlsConfig;
}

/**
 * Create a Redis client instance.
 * Clients are managed externally by the coordinator bridge (databaseBridge.cjs).
 *
 * @param {object} config - Connection configuration (same as testConnection)
 * @returns {{ok: boolean, client?: object, error?: string}}
 */
function createClient(config) {
  if (!Redis) {
    return buildErrorResult("ioredis module not available", "Redis driver not installed");
  }

  const validation = validateConfig(config, ["host"]);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const connectionTimeout = config.connectionTimeout || DEFAULT_CONNECTION_TIMEOUT;

  try {
    const client = new Redis({
      host: config.host,
      port: config.port || 6379,
      password: config.password || undefined,
      db: config.db || 0,
      tls: buildTlsConfig(config),
      connectTimeout: connectionTimeout,
      lazyConnect: false,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (retries) => {
        if (retries > 3) return null;
        return Math.min(retries * 200, 2000);
      },
      reconnectOnError: (err) => {
        const targetError = ["READONLY", "ECONNRESET", "ETIMEDOUT", "PROTOCOL_ERROR"];
        return targetError.some((e) => err.message.includes(e));
      },
    });

    return { ok: true, client };
  } catch (err) {
    return buildErrorResult(err, "Failed to create Redis client");
  }
}

/**
 * Execute a Redis command.
 * Commands are passed as an array of arguments, e.g., ["GET", "mykey"] or ["HGETALL", "myhash"].
 *
 * @param {object} client - The ioredis client
 * @param {string[]} args - Command and arguments, e.g., ["HGETALL", "user:123"]
 * @returns {Promise<object>} - Formatted result
 */
async function executeCommand(client, args) {
  if (!client) {
    return buildErrorResult("No Redis client available");
  }

  if (!Array.isArray(args) || args.length === 0) {
    return buildErrorResult("Invalid command arguments");
  }

  const command = args[0].toUpperCase();
  const commandArgs = args.slice(1);

  try {
    // Execute the command
    const result = await client.call(...args);

    // Format result based on command type
    return formatRedisResult(command, result);
  } catch (err) {
    return buildErrorResult(err, `Redis command '${command}' failed`);
  }
}

/**
 * Format a Redis result into a consistent structure.
 * @param {string} command - The Redis command
 * @param {any} result - The raw result from ioredis
 * @returns {object} - Formatted result
 */
function formatRedisResult(command, result) {
  // null responses (e.g., key not found)
  if (result === null) {
    return {
      ok: true,
      command,
      result: null,
      type: "null",
      message: "nil",
    };
  }

  // String responses (GET, HGET, LINDEX, etc.)
  if (typeof result === "string") {
    return {
      ok: true,
      command,
      result,
      type: "string",
      message: `${result.length} bytes`,
    };
  }

  // Integer responses (DBSIZE, LLEN, SCARD, etc.)
  if (typeof result === "number") {
    return {
      ok: true,
      command,
      result,
      type: "integer",
      message: `${result}`,
    };
  }

  // Array responses (KEYS, SMEMBERS, HGETALL, LRANGE, etc.)
  if (Array.isArray(result)) {
    return {
      ok: true,
      command,
      result,
      type: "array",
      length: result.length,
      message: `${result.length} item(s)`,
    };
  }

  // Bulk string (Buffer) responses
  if (Buffer.isBuffer(result)) {
    return {
      ok: true,
      command,
      result: result.toString("utf-8"),
      type: "buffer",
      message: `${result.length} bytes`,
    };
  }

  // Status responses (PONG, OK, etc.)
  if (result && typeof result === "object" && result.status === "OK") {
    return {
      ok: true,
      command,
      result: result,
      type: "status",
      message: "OK",
    };
  }

  return {
    ok: true,
    command,
    result,
    type: "unknown",
    message: String(result),
  };
}

/**
 * Get the Redis schema / keyspace overview.
 * Uses INFO and KEYS/SCAN to provide an overview of the database.
 *
 * @param {object} client - The ioredis client
 * @returns {Promise<{ok: boolean, schema?: object, error?: string}>}
 */
async function getSchema(client) {
  if (!client) {
    return buildErrorResult("No Redis client available");
  }

  try {
    // Get INFO sections
    const info = await client.info("all");
    const infoObj = parseInfoResponse(info);

    // Get key count by type using TYPE and SCAN
    const keyTypes = {};
    let cursor = "0";
    let totalKeys = 0;
    const MAX_KEYS_SAMPLE = 10000; // Limit key scanning for large databases

    do {
      const [newCursor, keys] = await client.scan(cursor, "COUNT", 100);
      cursor = newCursor;

      for (const key of keys) {
        if (totalKeys >= MAX_KEYS_SAMPLE) break;
        try {
          const type = await client.type(key);
          keyTypes[type] = (keyTypes[type] || 0) + 1;
          totalKeys++;
        } catch {
          // Key may have been deleted; skip
        }
      }
    } while (cursor !== "0" && totalKeys < MAX_KEYS_SAMPLE);

    // Get database size
    const dbSize = await client.dbsize();

    return {
      ok: true,
      schema: {
        version: infoObj.redis_version || "unknown",
        os: infoObj.os || "",
        uptime: parseInt(infoObj.uptime_in_seconds, 10) || 0,
        role: infoObj.role || "unknown",
        databases: {
          db0: {
            keys: dbSize,
            keyTypes,
          },
        },
        memory: {
          used: parseInt(infoObj.used_memory, 10) || 0,
          peak: parseInt(infoObj.used_memory_peak, 10) || 0,
          rss: parseInt(infoObj.used_memory_rss, 10) || 0,
        },
        stats: {
          totalConnections: parseInt(infoObj.total_connections_received, 10) || 0,
          totalCommands: parseInt(infoObj.total_commands_processed, 10) || 0,
          keyspaceHits: parseInt(infoObj.keyspace_hits, 10) || 0,
          keyspaceMisses: parseInt(infoObj.keyspace_misses, 10) || 0,
        },
        // Sampled keys for quick overview (limited)
        sampledKeyTypes: keyTypes,
        sampledKeyCount: totalKeys,
        totalKeyCount: dbSize,
      },
    };
  } catch (err) {
    return buildErrorResult(err, "Failed to retrieve Redis schema");
  }
}

/**
 * Parse Redis INFO output into a key-value object.
 * @param {string} info - Raw INFO output
 * @returns {object} - Parsed key-value pairs
 */
function parseInfoResponse(info) {
  const result = {};
  const lines = info.split("\r\n");
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    result[key] = value;
  }
  return result;
}

/**
 * List Redis keys matching a pattern using SCAN (production-safe).
 *
 * @param {object} client - The ioredis client
 * @param {string} [pattern="*"] - Key pattern (supports * and ? wildcards)
 * @param {number} [limit=1000] - Maximum keys to return
 * @returns {Promise<{ok: boolean, keys?: string[], error?: string}>}
 */
async function listKeys(client, pattern = "*", limit = 1000) {
  if (!client) {
    return buildErrorResult("No Redis client available");
  }

  const keys = [];
  let cursor = "0";

  try {
    do {
      const [newCursor, batch] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = newCursor;
      for (const key of batch) {
        keys.push(key);
        if (keys.length >= limit) break;
      }
    } while (cursor !== "0" && keys.length < limit);

    return {
      ok: true,
      keys,
      truncated: keys.length >= limit,
      totalScanned: keys.length,
      pattern,
    };
  } catch (err) {
    return buildErrorResult(err, "Failed to list keys");
  }
}

/**
 * Get server status information from Redis.
 *
 * @param {object} client - The ioredis client
 * @returns {Promise<object>}
 */
async function getServerStatus(client) {
  if (!client) {
    return buildErrorResult("No Redis client available");
  }

  try {
    const info = await client.info("all");
    const infoObj = parseInfoResponse(info);

    const latency = await client.ping();

    return {
      ok: true,
      status: {
        version: infoObj.redis_version || "unknown",
        mode: infoObj.redis_mode || "unknown",
        role: infoObj.role || "unknown",
        uptime: parseInt(infoObj.uptime_in_seconds, 10) || 0,
        dbSize: parseInt(infoObj.db0, 10) || 0,
        memoryUsed: parseInt(infoObj.used_memory, 10) || 0,
        memoryPeak: parseInt(infoObj.used_memory_peak, 10) || 0,
        connectedClients: parseInt(infoObj.connected_clients, 10) || 0,
        totalConnections: parseInt(infoObj.total_connections_received, 10) || 0,
        totalCommands: parseInt(infoObj.total_commands_processed, 10) || 0,
        keyspaceHits: parseInt(infoObj.keyspace_hits, 10) || 0,
        keyspaceMisses: parseInt(infoObj.keyspace_misses, 10) || 0,
        lastPing: latency,
      },
    };
  } catch (err) {
    return buildErrorResult(err, "Failed to get Redis server status");
  }
}

/**
 * Destroy a Redis client connection.
 *
 * @param {object} client - The ioredis client to disconnect
 * @returns {Promise<void>}
 */
async function destroyClient(client) {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    try {
      client.disconnect();
    } catch {
      // Ignore cleanup errors
    }
  }
}

module.exports = {
  testConnection,
  createClient,
  executeCommand,
  getSchema,
  listKeys,
  getServerStatus,
  destroyClient,
};

/**
 * Database Bridge - Coordinates all database connections and operations
 * Routes to MySQL and Redis sub-bridges, manages sessions, and handles config persistence.
 * Extracted from main.cjs for single responsibility.
 */

const fs = require("node:fs");
const path = require("node:path");

// Lazy-load sub-bridges to avoid initialization errors when drivers aren't installed
let mysqlBridge = null;
let redisBridge = null;
let electronModule = null;

const STORAGE_FILENAME = "database-configs.json";

/**
 * Lazy-load a sub-bridge module.
 * @param {string} name - Module name ('mysql' | 'redis')
 * @returns {object|null}
 */
function getSubBridge(name) {
  if (name === "mysql") {
    if (!mysqlBridge) {
      try {
        mysqlBridge = require("./database/mysqlBridge.cjs");
      } catch (err) {
        console.warn("[DatabaseBridge] mysql2 not available:", err.message);
        return null;
      }
    }
    return mysqlBridge;
  }
  if (name === "redis") {
    if (!redisBridge) {
      try {
        redisBridge = require("./database/redisBridge.cjs");
      } catch (err) {
        console.warn("[DatabaseBridge] ioredis not available:", err.message);
        return null;
      }
    }
    return redisBridge;
  }
  return null;
}

// In-memory sessions: Map<sessionId, {config, clientOrPool, driver, status}>
let dbSessions = null;

/**
 * Initialize the database bridge with dependencies.
 * @param {object} deps - Dependency injection
 * @param {Map} deps.sessions - Sessions map from main.cjs
 * @param {object} deps.electronModule - Electron module (for app.getPath)
 */
function init(deps) {
  dbSessions = deps.dbSessions || new Map();
  electronModule = deps.electronModule;
}

/**
 * Get the path to the persistent config file.
 * @returns {string} - Absolute path to database-configs.json
 */
function getConfigPath() {
  if (!electronModule?.app) {
    // Fallback for testing or environments without Electron
    return path.join(process.cwd(), STORAGE_FILENAME);
  }
  return path.join(electronModule.app.getPath("userData"), STORAGE_FILENAME);
}

/**
 * Load saved database configurations from disk.
 * @returns {Promise<object[]>} - Array of saved configs
 */
async function loadConfigs() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = await fs.promises.readFile(configPath, "utf-8");
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeDatabaseConfig).filter(Boolean);
    }
  } catch (err) {
    console.warn("[DatabaseBridge] Failed to load configs:", err.message);
  }
  return [];
}

/**
 * Save database configurations to disk.
 * @param {object[]} configs - Array of configs to save
 * @returns {Promise<void>}
 */
async function saveConfigs(configs) {
  const configPath = getConfigPath();
  try {
    const normalizedConfigs = Array.isArray(configs)
      ? configs.map(normalizeDatabaseConfig).filter(Boolean)
      : [];
    await fs.promises.writeFile(configPath, JSON.stringify(normalizedConfigs, null, 2), "utf-8");
  } catch (err) {
    console.warn("[DatabaseBridge] Failed to save configs:", err.message);
    throw err;
  }
}

function normalizeDatabaseConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }

  const normalized = { ...config };

  if (normalized.label === undefined && typeof normalized.name === "string") {
    normalized.label = normalized.name;
  }
  if (normalized.username === undefined && typeof normalized.user === "string") {
    normalized.username = normalized.user;
  }
  if (normalized.authPassword === undefined && typeof normalized.password === "string") {
    normalized.authPassword = normalized.password;
  }
  if (normalized.tls === undefined && normalized.ssl !== undefined) {
    normalized.tls = normalized.ssl;
  }
  if (normalized.tlsCa === undefined && normalized.sslCa !== undefined) {
    normalized.tlsCa = normalized.sslCa;
  }
  if (normalized.tlsCert === undefined && normalized.sslCert !== undefined) {
    normalized.tlsCert = normalized.sslCert;
  }
  if (normalized.tlsKey === undefined && normalized.sslKey !== undefined) {
    normalized.tlsKey = normalized.sslKey;
  }
  if (
    normalized.tlsRejectUnauthorized === undefined &&
    normalized.sslRejectUnauthorized !== undefined
  ) {
    normalized.tlsRejectUnauthorized = normalized.sslRejectUnauthorized;
  }
  if (normalized.databaseIndex === undefined && normalized.db !== undefined) {
    normalized.databaseIndex = normalized.db;
  }
  if (normalized.poolMax === undefined && normalized.connectionLimit !== undefined) {
    normalized.poolMax = normalized.connectionLimit;
  }
  if (normalized.poolIdleTimeoutMs === undefined && normalized.idleTimeout !== undefined) {
    normalized.poolIdleTimeoutMs = normalized.idleTimeout;
  }

  delete normalized.name;
  delete normalized.user;
  delete normalized.password;
  delete normalized.ssl;
  delete normalized.sslCa;
  delete normalized.sslCert;
  delete normalized.sslKey;
  delete normalized.sslRejectUnauthorized;
  delete normalized.db;
  delete normalized.connectionLimit;
  delete normalized.idleTimeout;
  delete normalized.hasPassword;

  return normalized;
}

function toDriverConfig(config) {
  const driverConfig = { ...config };

  if (driverConfig.username !== undefined && driverConfig.user === undefined) {
    driverConfig.user = driverConfig.username;
  }
  if (driverConfig.authPassword !== undefined && driverConfig.password === undefined) {
    driverConfig.password = driverConfig.authPassword;
  }

  if (driverConfig.driver === "mysql") {
    if (driverConfig.tls !== undefined && driverConfig.ssl === undefined) {
      driverConfig.ssl = driverConfig.tls;
    }
    if (driverConfig.tlsCa !== undefined && driverConfig.sslCa === undefined) {
      driverConfig.sslCa = driverConfig.tlsCa;
    }
    if (driverConfig.tlsCert !== undefined && driverConfig.sslCert === undefined) {
      driverConfig.sslCert = driverConfig.tlsCert;
    }
    if (driverConfig.tlsKey !== undefined && driverConfig.sslKey === undefined) {
      driverConfig.sslKey = driverConfig.tlsKey;
    }
    if (
      driverConfig.tlsRejectUnauthorized !== undefined &&
      driverConfig.sslRejectUnauthorized === undefined
    ) {
      driverConfig.sslRejectUnauthorized = driverConfig.tlsRejectUnauthorized;
    }
    if (driverConfig.poolMax !== undefined && driverConfig.connectionLimit === undefined) {
      driverConfig.connectionLimit = driverConfig.poolMax;
    }
    if (
      driverConfig.poolIdleTimeoutMs !== undefined &&
      driverConfig.idleTimeout === undefined
    ) {
      driverConfig.idleTimeout = driverConfig.poolIdleTimeoutMs;
    }
  }

  if (driverConfig.driver === "redis") {
    if (driverConfig.databaseIndex !== undefined && driverConfig.db === undefined) {
      driverConfig.db = driverConfig.databaseIndex;
    }
  }

  return driverConfig;
}

// ─────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────

/**
 * Test a database connection without saving it.
 * POST body: { driver: 'mysql'|'redis', config: {...} }
 */
async function handleTestConnection(event, payload) {
  const config = normalizeDatabaseConfig(payload?.config);
  const driver = payload?.driver || config?.driver;

  if (driver === "mysql") {
    const bridge = getSubBridge("mysql");
    if (!bridge) return { ok: false, error: "MySQL driver not available (mysql2 not installed)" };
    return bridge.testConnection(toDriverConfig(config));
  }

  if (driver === "redis") {
    const bridge = getSubBridge("redis");
    if (!bridge) return { ok: false, error: "Redis driver not available (ioredis not installed)" };
    return bridge.testConnection(toDriverConfig(config));
  }

  return { ok: false, error: `Unknown driver: ${driver}` };
}

/**
 * Save (create or update) a database configuration.
 * POST body: { config: {...} } - config must include an 'id' field
 */
async function handleSaveConfig(event, payload) {
  const config = normalizeDatabaseConfig(payload?.config);

  if (!config || !config.id) {
    return { ok: false, error: "Config must include an 'id' field" };
  }

  try {
    const configs = await loadConfigs();
    const existingIdx = configs.findIndex((c) => c.id === config.id);

    if (existingIdx >= 0) {
      configs[existingIdx] = config;
    } else {
      configs.push(config);
    }

    await saveConfigs(configs);
    return { ok: true, saved: config };
  } catch (err) {
    return { ok: false, error: `Failed to save config: ${err.message}` };
  }
}

/**
 * Delete a database configuration by ID.
 * POST body: { id: string }
 */
async function handleDeleteConfig(event, payload) {
  const { id } = payload;

  if (!id) {
    return { ok: false, error: "Config ID is required" };
  }

  try {
    // Disconnect if connected
    const session = dbSessions?.get(id);
    if (session?.clientOrPool) {
      await disconnectClient(id, session.driver, session.clientOrPool);
    }
    dbSessions?.delete(id);

    const configs = await loadConfigs();
    const filtered = configs.filter((c) => c.id !== id);
    await saveConfigs(filtered);
    return { ok: true, deleted: id };
  } catch (err) {
    return { ok: false, error: `Failed to delete config: ${err.message}` };
  }
}

/**
 * List all saved database configurations.
 */
async function handleListConfigs(event) {
  try {
    const configs = await loadConfigs();
    return {
      ok: true,
      configs: configs.map((c) => ({
        ...c,
        hasPassword: Boolean(c.authPassword),
      })),
    };
  } catch (err) {
    return { ok: false, error: `Failed to list configs: ${err.message}` };
  }
}

/**
 * Connect to a database using a saved config (by config ID).
 * POST body: { id: string }
 */
async function handleConnect(event, payload) {
  const { id } = payload;

  if (!id) {
    return { ok: false, error: "Config ID is required" };
  }

  try {
    const configs = await loadConfigs();
    const config = configs.find((c) => c.id === id);

    if (!config) {
      return { ok: false, error: `Configuration not found: ${id}` };
    }

    const sessionId = id;

    // If already connected, return success
    if (dbSessions?.has(sessionId)) {
      event?.sender?.send?.("netcatty:db:statusChange", {
        sessionId,
        connected: true,
      });
      return { ok: true, sessionId, status: dbSessions.get(sessionId).status };
    }

    const driver = config.driver;
    const driverConfig = toDriverConfig(config);

    if (driver === "mysql") {
      const bridge = getSubBridge("mysql");
      if (!bridge) return { ok: false, error: "MySQL driver not available" };

      const poolResult = await bridge.createPool(driverConfig);
      if (!poolResult.ok) {
        return poolResult;
      }

      dbSessions.set(sessionId, {
        config,
        clientOrPool: poolResult.pool,
        driver,
        status: "connected",
        connectedAt: Date.now(),
      });
      event?.sender?.send?.("netcatty:db:statusChange", {
        sessionId,
        connected: true,
      });

      return { ok: true, sessionId, driver, status: "connected" };
    }

    if (driver === "redis") {
      const bridge = getSubBridge("redis");
      if (!bridge) return { ok: false, error: "Redis driver not available" };

      const clientResult = bridge.createClient(driverConfig);
      if (!clientResult.ok) {
        return clientResult;
      }

      // Wait for the client to be ready
      await new Promise((resolve, reject) => {
        const { client } = clientResult;
        if (client.status === "ready") {
          resolve();
        } else if (client.status === "connect") {
          client.once("ready", resolve);
          client.once("error", reject);
        } else {
          client.once("ready", resolve);
          client.once("error", reject);
          setTimeout(() => reject(new Error("Connection timeout")), (config.connectionTimeout || 10000));
        }
      });

      dbSessions.set(sessionId, {
        config,
        clientOrPool: clientResult.client,
        driver,
        status: "connected",
        connectedAt: Date.now(),
      });
      event?.sender?.send?.("netcatty:db:statusChange", {
        sessionId,
        connected: true,
      });

      return { ok: true, sessionId, driver, status: "connected" };
    }

    return { ok: false, error: `Unknown driver: ${driver}` };
  } catch (err) {
    return { ok: false, error: `Failed to connect: ${err.message}` };
  }
}

async function handleConnectWithConfig(event, payload) {
  const config = normalizeDatabaseConfig(payload?.config);

  if (!config || !config.id) {
    return { ok: false, error: "Config with ID is required" };
  }

  try {
    const configs = await loadConfigs();
    const existingIdx = configs.findIndex((item) => item.id === config.id);
    if (existingIdx >= 0) {
      configs[existingIdx] = {
        ...configs[existingIdx],
        ...config,
      };
    } else {
      configs.push(config);
    }
    await saveConfigs(configs);
    return handleConnect(event, { id: config.id });
  } catch (err) {
    return { ok: false, error: `Failed to connect with config: ${err.message}` };
  }
}

/**
 * Disconnect from a database session.
 * POST body: { sessionId: string }
 */
async function handleDisconnect(event, payload) {
  const { sessionId } = payload;

  if (!sessionId) {
    return { ok: false, error: "Session ID is required" };
  }

  const session = dbSessions?.get(sessionId);
  if (!session) {
    return { ok: false, error: "Session not found" };
  }

  try {
    await disconnectClient(sessionId, session.driver, session.clientOrPool);
    dbSessions.delete(sessionId);
    event?.sender?.send?.("netcatty:db:statusChange", {
      sessionId,
      connected: false,
    });
    return { ok: true, disconnected: sessionId };
  } catch (err) {
    return { ok: false, error: `Failed to disconnect: ${err.message}` };
  }
}

/**
 * Disconnect and destroy a client or pool.
 * @param {string} sessionId
 * @param {string} driver
 * @param {object} clientOrPool
 */
async function disconnectClient(sessionId, driver, clientOrPool) {
  if (driver === "mysql") {
    const bridge = getSubBridge("mysql");
    if (bridge) await bridge.destroyPool(clientOrPool);
  } else if (driver === "redis") {
    const bridge = getSubBridge("redis");
    if (bridge) await bridge.destroyClient(clientOrPool);
  }
}

/**
 * Get connection status for a session or all sessions.
 * POST body: { sessionId?: string }
 */
async function handleGetStatus(event, payload) {
  const { sessionId } = payload;

  if (sessionId) {
    const session = dbSessions?.get(sessionId);
    if (!session) {
      return { ok: false, error: "Session not found" };
    }
    return {
      ok: true,
      sessionId,
      driver: session.driver,
      status: session.status,
      connectedAt: session.connectedAt,
    };
  }

  // Return status of all sessions
  const sessions = [];
  for (const [id, session] of (dbSessions || new Map())) {
    sessions.push({
      sessionId: id,
      driver: session.driver,
      status: session.status,
      connectedAt: session.connectedAt,
    });
  }
  return { ok: true, sessions };
}

/**
 * Execute a query or command on a connected database session.
 * POST body: { sessionId: string, query?: string, command?: string[], params?: any[] }
 */
async function handleExecute(event, payload) {
  const { sessionId, query, command, params } = payload;

  if (!sessionId) {
    return { ok: false, error: "Session ID is required" };
  }

  const session = dbSessions?.get(sessionId);
  if (!session) {
    return { ok: false, error: "Session not found or not connected" };
  }

  if (session.driver === "mysql") {
    const bridge = getSubBridge("mysql");
    if (!bridge) return { ok: false, error: "MySQL driver not available" };
    return bridge.executeQuery(session.clientOrPool, query, params);
  }

  if (session.driver === "redis") {
    const bridge = getSubBridge("redis");
    if (!bridge) return { ok: false, error: "Redis driver not available" };
    return bridge.executeCommand(session.clientOrPool, command || []);
  }

  return { ok: false, error: `Unknown driver: ${session.driver}` };
}

/**
 * Get the schema of a connected database.
 * POST body: { sessionId: string }
 */
async function handleGetSchema(event, payload) {
  const { sessionId, database } = payload;

  if (!sessionId) {
    return { ok: false, error: "Session ID is required" };
  }

  const session = dbSessions?.get(sessionId);
  if (!session) {
    return { ok: false, error: "Session not found or not connected" };
  }

  if (session.driver === "mysql") {
    const bridge = getSubBridge("mysql");
    if (!bridge) return { ok: false, error: "MySQL driver not available" };
    return bridge.getSchema(session.clientOrPool, database || null);
  }

  if (session.driver === "redis") {
    const bridge = getSubBridge("redis");
    if (!bridge) return { ok: false, error: "Redis driver not available" };
    return bridge.getSchema(session.clientOrPool);
  }

  return { ok: false, error: `Unknown driver: ${session.driver}` };
}

/**
 * Get details for a specific database object.
 * POST body: { sessionId: string, selection: { kind: string, name?: string, schemaName?: string } }
 */
async function handleGetObjectDetails(event, payload) {
  const { sessionId, selection } = payload || {};

  if (!sessionId) {
    return { ok: false, error: "Session ID is required" };
  }

  if (!selection || typeof selection !== "object") {
    return { ok: false, error: "Object selection is required" };
  }

  const session = dbSessions?.get(sessionId);
  if (!session) {
    return { ok: false, error: "Session not found or not connected" };
  }

  if (session.driver === "mysql") {
    const bridge = getSubBridge("mysql");
    if (!bridge) return { ok: false, error: "MySQL driver not available" };
    return bridge.getObjectDetails(session.clientOrPool, selection, session.config.database);
  }

  return { ok: false, error: `Object details are not supported for ${session.driver}` };
}

/**
 * Query paginated data for a specific table or view.
 * POST body: { sessionId: string, selection: object, page?: number, pageSize?: number }
 */
async function handleQueryTableData(event, payload) {
  const { sessionId, selection, page, pageSize } = payload || {};

  if (!sessionId) {
    return { ok: false, error: "Session ID is required" };
  }

  if (!selection || typeof selection !== "object") {
    return { ok: false, error: "Object selection is required" };
  }

  const session = dbSessions?.get(sessionId);
  if (!session) {
    return { ok: false, error: "Session not found or not connected" };
  }

  if (session.driver === "mysql") {
    const bridge = getSubBridge("mysql");
    if (!bridge) return { ok: false, error: "MySQL driver not available" };
    return bridge.queryTableData(
      session.clientOrPool,
      selection,
      { page, pageSize },
      session.config.database,
    );
  }

  return { ok: false, error: `Paginated table data is not supported for ${session.driver}` };
}

/**
 * List objects (tables, keys, etc.) in a connected database.
 * POST body: { sessionId: string, type?: string }
 */
async function handleListObjects(event, payload) {
  const { sessionId, type } = payload;

  if (!sessionId) {
    return { ok: false, error: "Session ID is required" };
  }

  const session = dbSessions?.get(sessionId);
  if (!session) {
    return { ok: false, error: "Session not found or not connected" };
  }

  if (session.driver === "mysql") {
    const bridge = getSubBridge("mysql");
    if (!bridge) return { ok: false, error: "MySQL driver not available" };
    return bridge.listObjects(session.clientOrPool, type, session.config.database);
  }

  if (session.driver === "redis") {
    const bridge = getSubBridge("redis");
    if (!bridge) return { ok: false, error: "Redis driver not available" };
    const pattern = type && type !== "all" ? type : "*";
    return bridge.listKeys(session.clientOrPool, pattern);
  }

  return { ok: false, error: `Unknown driver: ${session.driver}` };
}

// ─────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────

/**
 * Register all IPC handlers for database operations.
 * @param {Electron.IpcMain} ipcMain
 */
function registerHandlers(ipcMain) {
  ipcMain.handle("netcatty:db:testConnection", handleTestConnection);
  ipcMain.handle("netcatty:db:saveConfig", handleSaveConfig);
  ipcMain.handle("netcatty:db:deleteConfig", handleDeleteConfig);
  ipcMain.handle("netcatty:db:listConfigs", handleListConfigs);
  ipcMain.handle("netcatty:db:connect", handleConnect);
  ipcMain.handle("netcatty:db:connectWithConfig", handleConnectWithConfig);
  ipcMain.handle("netcatty:db:disconnect", handleDisconnect);
  ipcMain.handle("netcatty:db:getStatus", handleGetStatus);
  ipcMain.handle("netcatty:db:execute", handleExecute);
  ipcMain.handle("netcatty:db:getSchema", handleGetSchema);
  ipcMain.handle("netcatty:db:getObjectDetails", handleGetObjectDetails);
  ipcMain.handle("netcatty:db:queryTableData", handleQueryTableData);
  ipcMain.handle("netcatty:db:listObjects", handleListObjects);
}

/**
 * Get the active database sessions map.
 * Exposed for use by other bridges or main.cjs cleanup.
 * @returns {Map}
 */
function getDbSessions() {
  return dbSessions;
}

/**
 * Gracefully close all active database connections.
 * Called during app shutdown.
 */
async function closeAllConnections() {
  if (!dbSessions) return;

  const closePromises = [];
  for (const [sessionId, session] of dbSessions) {
    closePromises.push(
      disconnectClient(sessionId, session.driver, session.clientOrPool).catch((err) => {
        console.warn(`[DatabaseBridge] Error closing session ${sessionId}:`, err.message);
      })
    );
  }
  await Promise.all(closePromises);
  dbSessions.clear();
}

module.exports = {
  init,
  registerHandlers,
  getDbSessions,
  closeAllConnections,
};

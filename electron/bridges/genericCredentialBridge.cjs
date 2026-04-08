/**
 * Generic Credential Bridge - Stores simple label + username + password credentials
 *
 * Uses Electron's safeStorage API to encrypt passwords before persisting to disk.
 * The bridge manages a JSON file in userData containing all generic credentials.
 */

const fs = require("node:fs");
const path = require("node:path");

const STORAGE_FILENAME = "generic-credentials.json";

let electronModule = null;
let safeStorage = null;

/**
 * Initialize the bridge with dependencies.
 * @param {object} deps
 */
function init(deps) {
  electronModule = deps.electronModule;
  safeStorage = electronModule?.safeStorage ?? null;
}

/**
 * Get the path to the persistent credentials file.
 * @returns {string}
 */
function getConfigPath() {
  if (!electronModule?.app) {
    return path.join(process.cwd(), STORAGE_FILENAME);
  }
  return path.join(electronModule.app.getPath("userData"), STORAGE_FILENAME);
}

/**
 * Encrypt a password using safeStorage.
 * @param {string} password
 * @returns {string}
 */
function encryptPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    return password ?? "";
  }
  if (!safeStorage?.isEncryptionAvailable?.()) {
    return password;
  }
  try {
    const encrypted = safeStorage.encryptString(password);
    return "enc:v1:" + encrypted.toString("base64");
  } catch (err) {
    console.warn("[GenericCredentialBridge] Failed to encrypt password:", err?.message || err);
    return password;
  }
}

/**
 * Decrypt a password using safeStorage.
 * @param {string} encryptedPassword
 * @returns {string}
 */
function decryptPassword(encryptedPassword) {
  if (typeof encryptedPassword !== "string" || encryptedPassword.length === 0) {
    return encryptedPassword ?? "";
  }
  // Not encrypted - pass through
  if (!encryptedPassword.startsWith("enc:v1:")) {
    return encryptedPassword;
  }
  if (!safeStorage?.isEncryptionAvailable?.()) {
    return encryptedPassword;
  }
  try {
    const base64 = encryptedPassword.slice("enc:v1:".length);
    const buf = Buffer.from(base64, "base64");
    return safeStorage.decryptString(buf);
  } catch (err) {
    console.warn("[GenericCredentialBridge] Failed to decrypt password:", err?.message || err);
    return encryptedPassword;
  }
}

/**
 * Load all credentials from disk.
 * @returns {Promise<object[]>}
 */
async function loadCredentials() {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = await fs.promises.readFile(configPath, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn("[GenericCredentialBridge] Failed to load credentials:", err.message);
  }
  return [];
}

/**
 * Save all credentials to disk.
 * @param {object[]} credentials
 */
async function saveCredentials(credentials) {
  const configPath = getConfigPath();
  try {
    await fs.promises.writeFile(configPath, JSON.stringify(credentials, null, 2), "utf-8");
  } catch (err) {
    console.warn("[GenericCredentialBridge] Failed to save credentials:", err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────

/**
 * List all generic credentials.
 * Returns credentials with decrypted passwords for display.
 */
async function handleList(event) {
  try {
    const credentials = await loadCredentials();
    // Decrypt passwords for renderer
    const decrypted = credentials.map((cred) => ({
      ...cred,
      password: decryptPassword(cred.password),
    }));
    return { ok: true, credentials: decrypted };
  } catch (err) {
    return { ok: false, error: `Failed to list credentials: ${err.message}` };
  }
}

/**
 * Save (create or update) a generic credential.
 * Password is encrypted before storage.
 */
async function handleSave(event, payload) {
  const { credential } = payload;

  if (!credential || !credential.id) {
    return { ok: false, error: "Credential must include an 'id' field" };
  }

  if (!credential.label || typeof credential.label !== "string") {
    return { ok: false, error: "Credential must include a 'label' field" };
  }

  try {
    const credentials = await loadCredentials();
    const existingIdx = credentials.findIndex((c) => c.id === credential.id);

    const now = Date.now();
    const credToSave = {
      ...credential,
      password: encryptPassword(credential.password),
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      credentials[existingIdx] = credToSave;
    } else {
      credToSave.createdAt = now;
      credentials.push(credToSave);
    }

    await saveCredentials(credentials);

    // Return the saved credential with decrypted password
    return {
      ok: true,
      credential: {
        ...credToSave,
        password: credential.password, // Return plain password
      },
    };
  } catch (err) {
    return { ok: false, error: `Failed to save credential: ${err.message}` };
  }
}

/**
 * Delete a generic credential by ID.
 */
async function handleDelete(event, payload) {
  const { id } = payload;

  if (!id) {
    return { ok: false, error: "Credential ID is required" };
  }

  try {
    const credentials = await loadCredentials();
    const filtered = credentials.filter((c) => c.id !== id);

    if (filtered.length === credentials.length) {
      return { ok: false, error: "Credential not found" };
    }

    await saveCredentials(filtered);
    return { ok: true, deleted: id };
  } catch (err) {
    return { ok: false, error: `Failed to delete credential: ${err.message}` };
  }
}

// ─────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────

/**
 * Register all IPC handlers for generic credentials.
 * @param {Electron.IpcMain} ipcMain
 */
function registerHandlers(ipcMain) {
  ipcMain.handle("netcatty:genericCredentials:list", handleList);
  ipcMain.handle("netcatty:genericCredentials:save", handleSave);
  ipcMain.handle("netcatty:genericCredentials:delete", handleDelete);
}

/**
 * Get the safeStorage instance.
 * @returns {object|null}
 */
function getSafeStorage() {
  return safeStorage;
}

module.exports = {
  init,
  registerHandlers,
  getSafeStorage,
};

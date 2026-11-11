import { existsSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

export const BRIDGE_DIR_NAME = ".hindsight"
export const BRIDGE_FILE_NAME = ".magpie-agent.json"
export const STATE_FILE_NAME = ".magpie-agent.state.json"

export class PathResolutionError extends Error {
  constructor(message, code) {
    super(message)
    this.name = "PathResolutionError"
    this.code = code
  }
}

function nonEmptyAbsolute(value) {
  return typeof value === "string" && value.trim() !== "" && isAbsolute(value)
}

export function platformConfigDir(platform, env, home) {
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"))
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support")
  }
  return nonEmptyAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME
    : join(home, ".config")
}

export function platformDataDir(platform, env, home) {
  if (platform === "win32") {
    return join(env.APPDATA || join(home, "AppData", "Roaming"))
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support")
  }
  return nonEmptyAbsolute(env.XDG_DATA_HOME)
    ? env.XDG_DATA_HOME
    : join(home, ".local", "share")
}

export function bridgePaths(home = homedir()) {
  const dir = join(home, BRIDGE_DIR_NAME)
  return {
    bridgeDir: dir,
    bridgePath: join(dir, BRIDGE_FILE_NAME),
    statePath: join(dir, STATE_FILE_NAME),
  }
}

/**
 * Reproduce Hindsight bootstrap.rs path resolution without reading the real
 * filesystem. `readBootstrap` is injectable for tests.
 */
export function resolveHindsightPaths({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  readBootstrap = true,
} = {}) {
  const configRoot = join(platformConfigDir(platform, env, home), "Hindsight")
  const defaultDataRoot = join(platformDataDir(platform, env, home), "Hindsight")
  const bootstrapPath = join(configRoot, "bootstrap.json")
  const activeUserPath = join(configRoot, "active_user.json")
  const links = bridgePaths(home)

  let dataRoot = defaultDataRoot
  const envDataRoot =
    typeof env.HINDSIGHT_DATA_DIR === "string" ? env.HINDSIGHT_DATA_DIR.trim() : ""
  if (envDataRoot !== "") {
    dataRoot = envDataRoot
  } else if (readBootstrap && existsSync(bootstrapPath)) {
    try {
      const parsed = JSON.parse(readFileSync(bootstrapPath, "utf8"))
      if (typeof parsed?.data_path === "string" && parsed.data_path.trim() !== "") {
        dataRoot = parsed.data_path.trim()
      }
    } catch {
      // Hindsight itself falls back to the default data root when
      // bootstrap.json cannot be read or parsed.
    }
  }

  return {
    configRoot,
    dataRoot,
    bootstrapPath,
    activeUserPath,
    ...links,
  }
}

export function readActiveUser(activeUserPath) {
  if (!existsSync(activeUserPath)) return { uid: null, legacyOwner: null }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(activeUserPath, "utf8"))
  } catch (error) {
    throw new PathResolutionError(
      `Cannot parse ${activeUserPath}: ${error.message}`,
      "ACTIVE_USER_INVALID"
    )
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PathResolutionError(
      `Unexpected active user file: ${activeUserPath}`,
      "ACTIVE_USER_INVALID"
    )
  }
  const uid = typeof parsed.uid === "string" ? parsed.uid.trim() : ""
  const legacyOwner =
    typeof parsed.legacyOwner === "string" ? parsed.legacyOwner.trim() : ""
  return {
    uid: uid || null,
    legacyOwner: legacyOwner || null,
  }
}

function settingsDatabaseNames(dataRoot) {
  if (!existsSync(dataRoot)) return []
  return readdirSync(dataRoot).filter(
    (name) => /^hindsight\.sqlite$/.test(name) || /^hindsight\..+\.sqlite$/.test(name)
  )
}

export function findSettingsDatabase({ dataRoot, activeUser }) {
  const uid = activeUser?.uid ?? null
  const legacyOwner = activeUser?.legacyOwner ?? null
  const expectedName = uid ? `hindsight.${uid}.sqlite` : "hindsight.sqlite"
  const expectedPath = join(dataRoot, expectedName)
  if (existsSync(expectedPath)) {
    return { dbPath: expectedPath, uid, fallback: false }
  }

  const legacyPath = join(dataRoot, "hindsight.sqlite")
  if ((!uid || legacyOwner === uid) && existsSync(legacyPath)) {
    return { dbPath: legacyPath, uid, fallback: true }
  }

  const candidates = settingsDatabaseNames(dataRoot)
    .filter((name) => name !== expectedName)
    .map((name) => join(dataRoot, name))

  if (candidates.length > 1) {
    throw new PathResolutionError(
      `Cannot choose a Hindsight settings database in ${dataRoot}; candidates: ${candidates.join(", ")}`,
      "DATABASE_AMBIGUOUS"
    )
  }
  throw new PathResolutionError(
    `Hindsight settings database not found for uid ${uid}: ${expectedPath}`,
    "DATABASE_NOT_FOUND"
  )
}

export function accountKeyFor(uid) {
  return uid && uid.trim() !== "" ? uid.trim() : "anonymous"
}

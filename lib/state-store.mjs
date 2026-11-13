import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { emptyState, parseState } from "./state.mjs"

export function stateBackupPath(statePath) {
  return `${statePath}.bak`
}

function serializeState(state) {
  return `${JSON.stringify(state, null, 2)}\n`
}

function writeFileAtomic(path, text) {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tempPath, text, {
      encoding: "utf8",
      mode: 0o600,
    })
    try {
      renameSync(tempPath, path)
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error
      rmSync(path, { force: true })
      renameSync(tempPath, path)
    }
    try {
      chmodSync(path, 0o600)
    } catch {
      // Windows does not implement POSIX modes; the file stays user-scoped.
    }
  } finally {
    rmSync(tempPath, { force: true })
  }
}

function readStateAt(path) {
  return parseState(readFileSync(path, "utf8"))
}

export function readStateFile(statePath) {
  const backupPath = stateBackupPath(statePath)
  let mainError = null

  if (existsSync(statePath)) {
    try {
      return readStateAt(statePath)
    } catch (error) {
      mainError = error
    }
  }

  if (existsSync(backupPath)) {
    let backup
    try {
      backup = readStateAt(backupPath)
    } catch (error) {
      throw mainError ?? error
    }
    try {
      writeFileAtomic(statePath, serializeState(backup))
    } catch {
      // The backup remains usable even if the primary file cannot be repaired.
    }
    return backup
  }

  if (mainError) throw mainError
  return emptyState()
}

export function writeStateFile(statePath, state) {
  const text = serializeState(state)
  writeFileAtomic(statePath, text)
  try {
    writeFileAtomic(stateBackupPath(statePath), text)
  } catch {
    // The primary state is written; a backup failure must not block syncing.
  }
}

export function readBridgeFile(bridgePath) {
  if (!existsSync(bridgePath)) {
    return { file: null, error: null, missing: true }
  }
  try {
    return {
      file: JSON.parse(readFileSync(bridgePath, "utf8")),
      error: null,
      missing: false,
    }
  } catch (error) {
    return {
      file: null,
      error: `Cannot parse bridge file ${bridgePath}: ${error.message}`,
      missing: false,
    }
  }
}

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { emptyState, parseState } from "./state.mjs"

export function readStateFile(statePath) {
  if (!existsSync(statePath)) return emptyState()
  return parseState(readFileSync(statePath, "utf8"))
}

export function writeStateFile(statePath, state) {
  const dir = dirname(statePath)
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    try {
      renameSync(tempPath, statePath)
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error
      rmSync(statePath, { force: true })
      renameSync(tempPath, statePath)
    }
    try {
      chmodSync(statePath, 0o600)
    } catch {
      // Windows does not implement POSIX modes; the file stays user-scoped.
    }
  } finally {
    rmSync(tempPath, { force: true })
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

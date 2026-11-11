import { Database } from "bun:sqlite"

const BUSY_PATTERN = /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isBusy(error) {
  return BUSY_PATTERN.test(String(error?.message ?? error))
}

async function retryBusy(operation, attempts = 6) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isBusy(error) || attempt === attempts - 1) throw error
      await delay(100 * 2 ** attempt)
    }
  }
  throw lastError
}

function loadSettingsFromDb(db, dbPath) {
  const row = db.prepare("SELECT data FROM settings_store WHERE id = 1").get()
  if (!row || typeof row.data !== "string") {
    throw new Error(`Hindsight settings row id=1 is missing in ${dbPath}`)
  }
  let settings
  try {
    settings = JSON.parse(row.data)
  } catch (error) {
    throw new Error(`Hindsight settings JSON is invalid in ${dbPath}: ${error.message}`)
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`Hindsight settings JSON is not an object in ${dbPath}`)
  }
  return settings
}

export async function readSettings(dbPath) {
  return retryBusy(() => {
    const db = new Database(dbPath, { readonly: true })
    try {
      db.exec("PRAGMA busy_timeout = 3000")
      return loadSettingsFromDb(db, dbPath)
    } finally {
      db.close()
    }
  })
}

/**
 * Run a read-modify-write cycle in a short IMMEDIATE transaction.
 *
 * The callback may write the backup state file before returning settings. If
 * the database commit then fails, the next tick can safely recompute.
 */
export async function withSettingsTransaction(dbPath, mutate) {
  return retryBusy(async () => {
    const db = new Database(dbPath, { readwrite: true, create: false })
    try {
      db.exec("PRAGMA busy_timeout = 3000")
      db.exec("BEGIN IMMEDIATE")
      try {
        const settings = loadSettingsFromDb(db, dbPath)
        const result = await mutate(settings)
        if (result?.settings) {
          const run = db
            .prepare("UPDATE settings_store SET data = ? WHERE id = 1")
            .run(JSON.stringify(result.settings))
          if (run.changes !== 1) {
            throw new Error(`Expected to update one settings row in ${dbPath}`)
          }
        }
        db.exec("COMMIT")
        return result
      } catch (error) {
        try {
          db.exec("ROLLBACK")
        } catch {
          // The transaction may already be gone.
        }
        throw error
      }
    } finally {
      db.close()
    }
  })
}

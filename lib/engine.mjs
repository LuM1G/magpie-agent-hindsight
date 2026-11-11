import { readStateFile, readBridgeFile, writeStateFile } from "./state-store.mjs"
import {
  accountKeyFor,
  findSettingsDatabase,
  readActiveUser,
  resolveHindsightPaths,
} from "./paths.mjs"
import { selectionFrom, validateSelection } from "./bridge.mjs"
import { accountFromState, connectedAccounts, withAccount } from "./state.mjs"
import { applySelection, restoreSelection } from "./settings.mjs"
import { readSettings, withSettingsTransaction } from "./sqlite.mjs"

const DEFAULT_POLL_MS = 2000
const DEFAULT_DISCONNECT_GRACE = 2

function errorMessage(error) {
  return String(error?.message ?? error)
}

export class HindsightEngine {
  constructor({ pollMs = DEFAULT_POLL_MS, disconnectGrace = DEFAULT_DISCONNECT_GRACE, logger = console } = {}) {
    this.pollMs = pollMs
    this.disconnectGrace = Math.max(1, disconnectGrace)
    this.logger = logger
    this.active = null
    this.invalidPolls = 0
    this.lastStatus = ""
    this.lastError = ""
    this.stopped = false
  }

  status(message) {
    if (message === this.lastStatus) return
    this.lastStatus = message
    this.lastError = ""
    this.logger.log?.(`[hindsight] ${message}`)
  }

  fail(error) {
    const message = errorMessage(error)
    if (message === this.lastError) return
    this.lastError = message
    this.lastStatus = ""
    this.logger.error?.(`[hindsight] ${message}`)
  }

  async start({ signal } = {}) {
    while (!(signal?.aborted || this.stopped)) {
      await this.tick()
      if (signal?.aborted || this.stopped) break
      await new Promise((resolve) => setTimeout(resolve, this.pollMs))
    }
  }

  stop() {
    this.stopped = true
  }

  async tick() {
    try {
      const paths = resolveHindsightPaths()
      const bridge = readBridgeFile(paths.bridgePath)
      if (bridge.error) {
        this.fail(new Error(bridge.error))
        return
      }
      const selection = selectionFrom(bridge.file)
      const problem = validateSelection(selection)

      if (problem) {
        this.invalidPolls += 1
        await this.handleDisconnected(paths, problem)
        return
      }

      this.invalidPolls = 0
      const activeUser = readActiveUser(paths.activeUserPath)
      const accountKey = accountKeyFor(activeUser.uid)

      if (this.active && this.active.accountKey !== accountKey) {
        const restored = await this.restoreAccount(
          this.active.accountKey,
          this.active.dbPath
        )
        if (!restored) return
        this.active = null
      }

      const pending = await this.restoreOtherConnected(accountKey)
      if (pending.failed > 0) {
        this.fail(
          new Error(
            `Could not restore ${pending.failed} previously connected Hindsight account(s); refusing to write another account.`
          )
        )
        return
      }

      const { dbPath } = findSettingsDatabase({
        dataRoot: paths.dataRoot,
        activeUser,
      })
      const applied = await this.applyCurrent(
        paths,
        accountKey,
        activeUser.uid,
        dbPath,
        selection
      )
      if (!applied) return
      this.active = { accountKey, dbPath }
    } catch (error) {
      this.fail(error)
    }
  }

  async handleDisconnected(paths, problem) {
    if (this.active) {
      if (this.invalidPolls < this.disconnectGrace) return
      const previousKey = this.active.accountKey
      const restored = await this.restoreAccount(previousKey, this.active.dbPath)
      if (restored) {
        this.active = null
        this.status(`disconnected; restored ${previousKey}`)
      }
      return
    }

    if (this.invalidPolls % this.disconnectGrace !== 0) return
    const restored = await this.restoreOtherConnected(null)
    if (restored.failed > 0) {
      this.fail(
        new Error(
          `Could not restore ${restored.failed} previously connected Hindsight account(s); will retry.`
        )
      )
    } else if (restored.restored > 0) {
      this.status(
        `bridge inactive (${problem}); restored ${restored.restored} account(s) and stopped database monitoring`
      )
    } else if (this.invalidPolls === this.disconnectGrace) {
      this.status(`waiting for Magpie connection: ${problem}`)
    }
  }

  async applyCurrent(paths, accountKey, uid, dbPath, selection) {
    const stateBefore = readStateFile(paths.statePath)
    let account = accountFromState(stateBefore, accountKey)

    if (account?.connected && account.dbPath && account.dbPath !== dbPath) {
      const restored = await this.restoreAccount(accountKey, account.dbPath)
      if (!restored) return false
      account = null
    }

    const settingsBefore = await readSettings(dbPath)
    const preview = applySelection(settingsBefore.ai, selection, account)
    const nextAccount = {
      ...preview.account,
      accountKey,
      uid,
      dbPath,
    }
    const stateChanged =
      JSON.stringify(nextAccount) !== JSON.stringify(accountFromState(stateBefore, accountKey))

    if (!preview.changed) {
      if (stateChanged) {
        writeStateFile(paths.statePath, withAccount(stateBefore, accountKey, nextAccount))
      }
      this.status(
        `connected to ${uid ?? "anonymous"} (${dbPath}); active=${preview.activeModel}; profiles=${preview.savedProfiles.length}` +
          (preview.skippedModels.length > 0
            ? `; skipped ${preview.skippedModels.length} model(s) beyond Hindsight's 10-profile limit`
            : "")
      )
      return true
    }

    await withSettingsTransaction(dbPath, (settings) => {
      const latestState = readStateFile(paths.statePath)
      const latestAccount = accountFromState(latestState, accountKey)
      const latest = applySelection(settings.ai, selection, latestAccount)
      const persistedAccount = {
        ...latest.account,
        accountKey,
        uid,
        dbPath,
      }
      writeStateFile(paths.statePath, withAccount(latestState, accountKey, persistedAccount))
      return {
        settings: { ...settings, ai: latest.ai },
        result: latest,
      }
    })

    this.status(
      `connected to ${uid ?? "anonymous"} (${dbPath}); active=${preview.activeModel}; profiles=${preview.savedProfiles.length}` +
        (preview.skippedModels.length > 0
          ? `; skipped ${preview.skippedModels.length} model(s) beyond Hindsight's 10-profile limit`
          : "")
    )
    return true
  }

  async restoreAccount(accountKey, dbPath) {
    try {
      const paths = resolveHindsightPaths()
      const stateBefore = readStateFile(paths.statePath)
      const account = accountFromState(stateBefore, accountKey)
      if (!account?.connected) return true
      const settingsBefore = await readSettings(dbPath)
      const preview = restoreSelection(settingsBefore.ai, account)

      if (preview.changed) {
        const committed = await withSettingsTransaction(dbPath, (settings) => {
          const latestState = readStateFile(paths.statePath)
          const latestAccount = accountFromState(latestState, accountKey)
          const latest = restoreSelection(settings.ai, latestAccount)
          return {
            settings: { ...settings, ai: latest.ai },
            result: { state: latestState, account: latest.account },
          }
        })
        writeStateFile(
          paths.statePath,
          withAccount(committed.result.state, accountKey, committed.result.account)
        )
      } else {
        writeStateFile(paths.statePath, withAccount(stateBefore, accountKey, preview.account))
      }
      this.status(`restored Hindsight settings for ${accountKey}`)
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  async restoreOtherConnected(excludeAccountKey) {
    const paths = resolveHindsightPaths()
    const state = readStateFile(paths.statePath)
    let restored = 0
    let failed = 0
    for (const { accountKey, account } of connectedAccounts(state)) {
      if (excludeAccountKey && accountKey === excludeAccountKey) continue
      if (!account.dbPath) continue
      if (await this.restoreAccount(accountKey, account.dbPath)) {
        restored += 1
      } else {
        failed += 1
      }
    }
    return { restored, failed }
  }
}

export async function runEngine(options) {
  const engine = new HindsightEngine(options)
  await engine.start(options)
  return engine
}

import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  PathResolutionError,
  accountKeyFor,
  findSettingsDatabase,
  readActiveUser,
  resolveHindsightPaths,
} from "../lib/paths.mjs"
import {
  StateError,
  accountFromState,
  connectedAccounts,
  emptyState,
  parseState,
  withAccount,
} from "../lib/state.mjs"

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), "magpie-hindsight-test-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function touch(path, body = "") {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, body)
}

test("Windows paths use bootstrap data_path and ignore camelCase dataPath", (t) => {
  const home = temporary(t)
  const appData = join(home, "AppData", "Roaming")
  const bootstrap = join(appData, "Hindsight", "bootstrap.json")
  touch(bootstrap, JSON.stringify({ data_path: join(home, "custom-data") }))
  const paths = resolveHindsightPaths({
    platform: "win32",
    env: { APPDATA: appData },
    home,
  })
  assert.equal(paths.configRoot, join(appData, "Hindsight"))
  assert.equal(paths.dataRoot, join(home, "custom-data"))
  assert.equal(paths.activeUserPath, join(appData, "Hindsight", "active_user.json"))

  writeFileSync(bootstrap, JSON.stringify({ dataPath: join(home, "wrong") }))
  const fallback = resolveHindsightPaths({
    platform: "win32",
    env: { APPDATA: appData },
    home,
  })
  assert.equal(fallback.dataRoot, join(appData, "Hindsight"))
})

test("HINDSIGHT_DATA_DIR wins over bootstrap", (t) => {
  const home = temporary(t)
  const appData = join(home, "AppData", "Roaming")
  touch(
    join(appData, "Hindsight", "bootstrap.json"),
    JSON.stringify({ data_path: join(home, "bootstrap-data") })
  )
  const paths = resolveHindsightPaths({
    platform: "win32",
    env: {
      APPDATA: appData,
      HINDSIGHT_DATA_DIR: join(home, "env-data"),
    },
    home,
  })
  assert.equal(paths.dataRoot, join(home, "env-data"))
})

test("macOS and Linux config/data directories follow dirs crate conventions", (t) => {
  const mac = resolveHindsightPaths({
    platform: "darwin",
    env: {},
    home: join("Users", "test"),
    readBootstrap: false,
  })
  assert.equal(
    mac.configRoot,
    join("Users", "test", "Library", "Application Support", "Hindsight")
  )
  assert.equal(
    mac.dataRoot,
    join("Users", "test", "Library", "Application Support", "Hindsight")
  )

  const base = temporary(t)
  const xdgConfig = join(base, "cfg")
  const xdgData = join(base, "data")
  const linux = resolveHindsightPaths({
    platform: "linux",
    env: { XDG_CONFIG_HOME: xdgConfig, XDG_DATA_HOME: xdgData },
    home: join("home", "test"),
    readBootstrap: false,
  })
  assert.equal(linux.configRoot, join(xdgConfig, "Hindsight"))
  assert.equal(linux.dataRoot, join(xdgData, "Hindsight"))
})

test("readActiveUser validates the account marker", (t) => {
  const dir = temporary(t)
  const path = join(dir, "active_user.json")
  assert.deepEqual(readActiveUser(path), { uid: null, legacyOwner: null })
  writeFileSync(path, JSON.stringify({ uid: "webdav-abc", legacyOwner: null }))
  assert.deepEqual(readActiveUser(path), { uid: "webdav-abc", legacyOwner: null })
  writeFileSync(path, "{")
  assert.throws(() => readActiveUser(path), PathResolutionError)
})

test("findSettingsDatabase selects the active uid database without glob guessing", (t) => {
  const root = temporary(t)
  touch(join(root, "hindsight.webdav-a.sqlite"))
  touch(join(root, "hindsight.webdav-b.sqlite"))
  const selected = findSettingsDatabase({
    dataRoot: root,
    activeUser: { uid: "webdav-a", legacyOwner: null },
  })
  assert.equal(selected.dbPath, join(root, "hindsight.webdav-a.sqlite"))
  assert.equal(selected.fallback, false)

  assert.throws(
    () =>
      findSettingsDatabase({
        dataRoot: root,
        activeUser: { uid: "webdav-missing", legacyOwner: null },
      }),
    (error) => error.code === "DATABASE_AMBIGUOUS"
  )

  const oneOther = temporary(t)
  touch(join(oneOther, "hindsight.webdav-b.sqlite"))
  assert.throws(
    () =>
      findSettingsDatabase({
        dataRoot: oneOther,
        activeUser: { uid: "webdav-missing", legacyOwner: null },
      }),
    (error) => error.code === "DATABASE_NOT_FOUND"
  )
})

test("anonymous and legacy database names are supported", (t) => {
  const a = temporary(t)
  touch(join(a, "hindsight.sqlite"))
  assert.equal(
    findSettingsDatabase({
      dataRoot: a,
      activeUser: { uid: null, legacyOwner: null },
    }).dbPath,
    join(a, "hindsight.sqlite")
  )

  const b = temporary(t)
  touch(join(b, "hindsight.sqlite"))
  assert.equal(
    findSettingsDatabase({
      dataRoot: b,
      activeUser: { uid: "webdav-a", legacyOwner: "webdav-a" },
    }).fallback,
    true
  )
})

test("state helpers keep accounts isolated", () => {
  const state = withAccount(emptyState(), "webdav-a", {
    connected: true,
    dbPath: "/a",
  })
  const next = withAccount(state, "webdav-b", {
    connected: false,
    dbPath: "/b",
  })
  assert.equal(accountFromState(next, "webdav-a").dbPath, "/a")
  assert.deepEqual(connectedAccounts(next).map((entry) => entry.accountKey), ["webdav-a"])
  assert.equal(accountKeyFor("webdav-a"), "webdav-a")
  assert.equal(accountKeyFor(null), "anonymous")
})

test("state parser rejects wrong versions and malformed accounts", () => {
  assert.throws(() => parseState("{"), StateError)
  assert.throws(() => parseState(JSON.stringify({ version: 2, accounts: {} })), StateError)
  assert.throws(() => parseState(JSON.stringify({ version: 1 })), StateError)
})

test("state parser rejects connected accounts with incomplete restore data", () => {
  const validAccount = {
    accountKey: "webdav-a",
    uid: "webdav-a",
    dbPath: "/data/hindsight.webdav-a.sqlite",
    connected: true,
    prev: {
      externalEnabled: true,
      externalProvider: "custom",
      endpoint: "https://user.example/v1",
      model: "user-model",
      apiKey: "user-key",
      summaryMain: "summary.gguf",
      chatMain: "chat.gguf",
    },
    lastApplied: {
      endpoint: "http://127.0.0.1:3425/v1",
      apiKey: "gateway-key",
      profiles: [
        {
          name: "Magpie · model/one",
          provider: "custom",
          endpoint: "http://127.0.0.1:3425/v1",
          apiKey: "gateway-key",
          model: "model/one",
        },
      ],
      summaryMain: "__cloud__",
      chatMain: "__cloud__",
    },
  }
  const state = { version: 1, accounts: { "webdav-a": validAccount } }
  assert.deepEqual(parseState(JSON.stringify(state)), state)

  assert.throws(
    () =>
      parseState(
        JSON.stringify({
          version: 1,
          accounts: {
            "webdav-a": { ...validAccount, lastApplied: null },
          },
        })
      ),
    /lastApplied/
  )
  assert.throws(
    () =>
      parseState(
        JSON.stringify({
          version: 1,
          accounts: {
            "webdav-a": {
              ...validAccount,
              lastApplied: {
                ...validAccount.lastApplied,
                profiles: [{ name: "incomplete" }],
              },
            },
          },
        })
      ),
    /profiles\[0\]/
  )
  assert.throws(
    () =>
      parseState(
        JSON.stringify({
          version: 1,
          accounts: {
            "webdav-a": { ...validAccount, prev: null },
          },
        })
      ),
    /prev/
  )
})

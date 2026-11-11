import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { spawn, spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url))
const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url))
const RUN_TICKS = join(TEST_DIR, "fixtures", "run-ticks.mjs")
const LOAD_HOST = join(TEST_DIR, "fixtures", "load-host.mjs")

function isRunnable(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  })
  return result.status === 0
}

function magpieBunCandidates() {
  const cacheRoot = join(homedir(), ".cache", "magpie", "bun")
  if (!existsSync(cacheRoot)) return []
  let versions
  try {
    versions = readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+)*$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) =>
        right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" })
      )
  } catch {
    return []
  }
  const binaryName = process.platform === "win32" ? "magpie-bun.exe" : "magpie-bun"
  return versions
    .map((version) => join(cacheRoot, version, binaryName))
    .filter((candidate) => existsSync(candidate))
}

function resolveBun() {
  const explicit = String(process.env.MAGPIE_BUN ?? "").trim()
  if (explicit) {
    if (!isRunnable(explicit)) {
      throw new Error(`MAGPIE_BUN is not runnable: ${explicit}`)
    }
    return explicit
  }

  for (const candidate of ["bun", ...magpieBunCandidates()]) {
    if (isRunnable(candidate)) return candidate
  }
  return null
}

const BUN = resolveBun()
const BUN_SKIP_REASON =
  "Bun runtime not found; set MAGPIE_BUN or install Bun to run the integration tests."
const bunTest = BUN
  ? test
  : (name, fn) => test(name, { skip: BUN_SKIP_REASON }, fn)

function baseAi(label = "user") {
  return {
    endpoint: `https://${label}.example/v1`,
    model: `${label}-model`,
    apiKey: `${label}-key`,
    externalEnabled: true,
    externalProvider: "custom",
    externalProfiles: [
      {
        name: `${label} profile`,
        provider: "custom",
        endpoint: `https://${label}.example/v1`,
        apiKey: `${label}-key`,
        model: `${label}-model`,
      },
    ],
    summaryMain: `${label}-summary.gguf`,
    chatMain: `${label}-chat.gguf`,
    chatThinking: "auto",
    marker: label,
  }
}

function selection(key = "magpie-key") {
  return {
    schema: 1,
    models: [
      { id: "vendor/model-one", name: "Model One" },
      { id: "vendor/model-two", name: "Model Two" },
    ],
    gateway: { url: "http://127.0.0.1:3425/v1", key },
  }
}

function makeFixture(
  t,
  {
    uid = "webdav-test",
    ai = baseAi(),
    bridge = selection(),
    useBootstrap = false,
    createBridgeDir = true,
  } = {}
) {
  const root = mkdtempSync(join(tmpdir(), "magpie-hindsight-integration-"))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

  const home = join(root, "home")
  const appData = join(home, "AppData", "Roaming")
  const configRoot = join(appData, "Hindsight")
  const dataRoot = join(root, "data")
  const bridgeDir = join(home, ".magpie-agent", "hindsight")
  mkdirSync(configRoot, { recursive: true })
  mkdirSync(dataRoot, { recursive: true })
  if (bridge !== null || createBridgeDir) {
    mkdirSync(bridgeDir, { recursive: true })
  }

  writeFileSync(
    join(configRoot, "active_user.json"),
    JSON.stringify({ uid, legacyOwner: null })
  )
  const dbPath = join(dataRoot, `hindsight.${uid}.sqlite`)
  createDatabase(dbPath, ai)
  if (bridge !== null) {
    writeFileSync(join(bridgeDir, "bridge.json"), JSON.stringify(bridge))
  }
  if (useBootstrap) {
    writeFileSync(
      join(configRoot, "bootstrap.json"),
      JSON.stringify({ data_path: dataRoot })
    )
  }

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: appData,
  }
  if (useBootstrap) {
    delete env.HINDSIGHT_DATA_DIR
  } else {
    env.HINDSIGHT_DATA_DIR = dataRoot
  }

  return {
    root,
    home,
    appData,
    configRoot,
    dataRoot,
    bridgeDir,
    bridgePath: join(bridgeDir, "bridge.json"),
    statePath: join(bridgeDir, "state.json"),
    activeUserPath: join(configRoot, "active_user.json"),
    bootstrapPath: join(configRoot, "bootstrap.json"),
    dbPath,
    env,
  }
}

function createDatabase(path, ai) {
  const db = new DatabaseSync(path)
  try {
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("CREATE TABLE settings_store (id INTEGER PRIMARY KEY, data TEXT NOT NULL)")
    db.prepare("INSERT INTO settings_store (id, data) VALUES (1, ?)").run(
      JSON.stringify({ ai, other: { keep: true } })
    )
  } finally {
    db.close()
  }
}

function readDatabase(path) {
  const db = new DatabaseSync(path)
  try {
    return JSON.parse(db.prepare("SELECT data FROM settings_store WHERE id = 1").get().data)
  } finally {
    db.close()
  }
}

function writeAi(path, ai) {
  const db = new DatabaseSync(path)
  try {
    const settings = JSON.parse(db.prepare("SELECT data FROM settings_store WHERE id = 1").get().data)
    settings.ai = ai
    db.prepare("UPDATE settings_store SET data = ? WHERE id = 1").run(JSON.stringify(settings))
  } finally {
    db.close()
  }
}

function runTicks(fixture, count = 1) {
  assert.ok(BUN, BUN_SKIP_REASON)
  const result = spawnSync(BUN, [RUN_TICKS], {
    cwd: PACKAGE_DIR,
    env: { ...fixture.env, MAGPIE_TEST_TICKS: String(count) },
    encoding: "utf8",
    timeout: 20000,
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1))
}

bunTest("Bun runtime applies profiles and writes state in a temporary database", (t) => {
  const fixture = makeFixture(t)
  const logs = runTicks(fixture)
  const settings = readDatabase(fixture.dbPath)
  assert.deepEqual(settings.other, { keep: true })
  assert.equal(settings.ai.externalEnabled, true)
  assert.equal(settings.ai.externalProvider, "custom")
  assert.equal(settings.ai.endpoint, "http://127.0.0.1:3425/v1")
  assert.equal(settings.ai.apiKey, "magpie-key")
  assert.equal(settings.ai.summaryMain, "__cloud__")
  assert.equal(settings.ai.chatMain, "__cloud__")
  assert.equal(settings.ai.model, "vendor/model-one")
  assert.equal(
    settings.ai.externalProfiles.filter((profile) => profile.name.startsWith("Magpie · ")).length,
    2
  )

  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"))
  assert.equal(state.version, 1)
  assert.equal(state.accounts["webdav-test"].connected, true)
  assert.equal(state.accounts["webdav-test"].prev.marker, undefined)
  const logText = logs.logs.map((entry) => entry.message).join("\n")
  assert.match(logText, /connected to webdav-test/)
  assert.doesNotMatch(logText, /magpie-key|user-key/)
})

bunTest("Bun locates the temporary database through bootstrap data_path", (t) => {
  const fixture = makeFixture(t, { useBootstrap: true })
  assert.equal(fixture.env.HINDSIGHT_DATA_DIR, undefined)

  runTicks(fixture)
  const settings = readDatabase(fixture.dbPath)
  assert.equal(settings.ai.endpoint, "http://127.0.0.1:3425/v1")
  assert.equal(settings.ai.model, "vendor/model-one")
  assert.equal(
    JSON.parse(readFileSync(fixture.statePath, "utf8")).accounts["webdav-test"].connected,
    true
  )
})

bunTest("starting without a bridge leaves the database and state untouched", (t) => {
  const fixture = makeFixture(t, { bridge: null })
  const before = readDatabase(fixture.dbPath)

  runTicks(fixture, 3)

  assert.deepEqual(readDatabase(fixture.dbPath), before)
  assert.equal(existsSync(fixture.statePath), false)
})

bunTest("Magpie host entry starts in the background and returns immediately", (t) => {
  const fixture = makeFixture(t, { bridge: null, createBridgeDir: false })
  assert.equal(existsSync(fixture.bridgeDir), false)
  const result = spawnSync(BUN, [LOAD_HOST], {
    cwd: PACKAGE_DIR,
    env: fixture.env,
    encoding: "utf8",
    timeout: 5000,
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const line = result.stdout
    .trim()
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("HOST_RESULT="))
  assert.ok(line, `Missing HOST_RESULT in: ${result.stdout}`)
  const loaded = JSON.parse(line.slice("HOST_RESULT=".length))
  assert.ok(loaded.elapsedMs < 1000, `Host load took ${loaded.elapsedMs}ms`)
  assert.deepEqual(loaded.result, {})
  assert.equal(existsSync(fixture.bridgeDir), true)
  assert.equal(existsSync(fixture.statePath), false)
})

bunTest("a model switch made in Hindsight is preserved on the next tick", (t) => {
  const fixture = makeFixture(t)
  runTicks(fixture)
  const settings = readDatabase(fixture.dbPath)
  settings.ai.model = "vendor/model-two"
  writeAi(fixture.dbPath, settings.ai)
  runTicks(fixture)
  assert.equal(readDatabase(fixture.dbPath).ai.model, "vendor/model-two")
})

bunTest("state survives Bun restarts and a new selection before disconnect", (t) => {
  const fixture = makeFixture(t)
  runTicks(fixture)
  const originalState = JSON.parse(readFileSync(fixture.statePath, "utf8"))

  writeFileSync(
    fixture.bridgePath,
    JSON.stringify({
      ...selection(),
      models: [{ id: "vendor/model-two", name: "Model Two" }],
    })
  )
  runTicks(fixture)

  const synchronized = readDatabase(fixture.dbPath).ai
  assert.equal(synchronized.model, "vendor/model-two")
  assert.deepEqual(
    synchronized.externalProfiles.map((profile) => profile.name),
    ["user profile", "Magpie · vendor/model-two"]
  )
  assert.deepEqual(
    JSON.parse(readFileSync(fixture.statePath, "utf8")).accounts["webdav-test"].prev,
    originalState.accounts["webdav-test"].prev
  )

  rmSync(fixture.bridgePath, { force: true })
  runTicks(fixture, 2)
  const restored = readDatabase(fixture.dbPath).ai
  assert.equal(restored.endpoint, "https://user.example/v1")
  assert.equal(restored.model, "user-model")
  assert.equal(restored.summaryMain, "user-summary.gguf")
  assert.equal(restored.chatMain, "user-chat.gguf")
})

bunTest("disconnect restores the database and marks the account disconnected", (t) => {
  const fixture = makeFixture(t)
  runTicks(fixture)
  rmSync(fixture.bridgePath, { force: true })
  runTicks(fixture, 2)

  const settings = readDatabase(fixture.dbPath)
  assert.equal(settings.ai.endpoint, "https://user.example/v1")
  assert.equal(settings.ai.model, "user-model")
  assert.equal(settings.ai.summaryMain, "user-summary.gguf")
  assert.equal(settings.ai.chatMain, "user-chat.gguf")
  assert.deepEqual(
    settings.ai.externalProfiles.map((profile) => profile.name),
    ["user profile"]
  )
  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"))
  assert.equal(state.accounts["webdav-test"].connected, false)
})

bunTest("gateway key rotation updates profiles without losing the selected model", (t) => {
  const fixture = makeFixture(t)
  runTicks(fixture)
  const settings = readDatabase(fixture.dbPath)
  settings.ai.model = "vendor/model-two"
  writeAi(fixture.dbPath, settings.ai)
  writeFileSync(fixture.bridgePath, JSON.stringify(selection("rotated-key")))
  runTicks(fixture)

  const after = readDatabase(fixture.dbPath).ai
  assert.equal(after.model, "vendor/model-two")
  assert.equal(after.apiKey, "rotated-key")
  assert.ok(
    after.externalProfiles
      .filter((profile) => profile.name.startsWith("Magpie · "))
      .every((profile) => profile.apiKey === "rotated-key")
  )
})

bunTest("account switch restores the old database before applying the new one", (t) => {
  const fixture = makeFixture(t)
  runTicks(fixture)

  const secondUid = "webdav-second"
  const secondDb = join(fixture.dataRoot, `hindsight.${secondUid}.sqlite`)
  createDatabase(secondDb, baseAi("second"))
  writeFileSync(
    fixture.activeUserPath,
    JSON.stringify({ uid: secondUid, legacyOwner: null })
  )
  runTicks(fixture)

  const first = readDatabase(fixture.dbPath).ai
  const second = readDatabase(secondDb).ai
  assert.equal(first.endpoint, "https://user.example/v1")
  assert.equal(first.model, "user-model")
  assert.equal(second.endpoint, "http://127.0.0.1:3425/v1")
  assert.equal(second.model, "vendor/model-one")

  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"))
  assert.equal(state.accounts["webdav-test"].connected, false)
  assert.equal(state.accounts["webdav-second"].connected, true)
})

bunTest("a new account marker restores the old database before the new one exists", (t) => {
  const fixture = makeFixture(t)
  runTicks(fixture)

  writeFileSync(
    fixture.activeUserPath,
    JSON.stringify({ uid: "webdav-not-created-yet", legacyOwner: null })
  )
  runTicks(fixture)

  const restored = readDatabase(fixture.dbPath).ai
  assert.equal(restored.endpoint, "https://user.example/v1")
  assert.equal(restored.model, "user-model")
  assert.equal(restored.summaryMain, "user-summary.gguf")
  assert.equal(restored.chatMain, "user-chat.gguf")

  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"))
  assert.equal(state.accounts["webdav-test"].connected, false)
  assert.equal(state.accounts["webdav-not-created-yet"], undefined)
})

bunTest("unversioned bridge files are ignored until Magpie reconnects", (t) => {
  const fixture = makeFixture(t, {
    bridge: {
      models: [{ id: "old/model", name: "Old" }],
      gateway: { url: "http://127.0.0.1:3425/v1", key: "old-key" },
    },
  })
  runTicks(fixture, 2)
  const settings = readDatabase(fixture.dbPath)
  assert.equal(settings.ai.endpoint, "https://user.example/v1")
  assert.equal(settings.ai.model, "user-model")
  assert.equal(existsSync(fixture.statePath), false)
})

bunTest("a corrupt bridge stops writes instead of guessing a disconnect", (t) => {
  const fixture = makeFixture(t)
  runTicks(fixture)
  const before = readDatabase(fixture.dbPath)
  writeFileSync(fixture.bridgePath, "{")
  runTicks(fixture, 3)
  assert.deepEqual(readDatabase(fixture.dbPath), before)
  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"))
  assert.equal(state.accounts["webdav-test"].connected, true)
})

bunTest("a corrupt state file blocks database writes", (t) => {
  const fixture = makeFixture(t)
  runTicks(fixture)
  const before = readDatabase(fixture.dbPath)
  writeFileSync(fixture.statePath, "{")
  writeFileSync(fixture.bridgePath, JSON.stringify(selection("new-key")))
  runTicks(fixture, 2)
  assert.deepEqual(readDatabase(fixture.dbPath), before)
})

bunTest("an unversioned bridge restores an existing connected account", (t) => {
  const fixture = makeFixture(t)
  runTicks(fixture)
  writeFileSync(
    fixture.bridgePath,
    JSON.stringify({
      models: [{ id: "old/model", name: "Old" }],
      gateway: { url: "http://127.0.0.1:3425/v1", key: "old-key" },
    })
  )
  runTicks(fixture, 2)
  const settings = readDatabase(fixture.dbPath)
  assert.equal(settings.ai.endpoint, "https://user.example/v1")
  assert.equal(settings.ai.model, "user-model")
  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"))
  assert.equal(state.accounts["webdav-test"].connected, false)
})

bunTest("a held write lock is retried instead of corrupting the settings row", async (t) => {
  const fixture = makeFixture(t)
  assert.ok(BUN, BUN_SKIP_REASON)

  const db = new DatabaseSync(fixture.dbPath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("BEGIN IMMEDIATE")

  const child = spawn(BUN, [RUN_TICKS], {
    cwd: PACKAGE_DIR,
    env: { ...fixture.env, MAGPIE_TEST_TICKS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  await new Promise((resolve) => setTimeout(resolve, 400))
  db.exec("COMMIT")
  db.close()

  const code = await new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("exit", resolve)
  })
  assert.equal(code, 0, `${stdout}\n${stderr}`)
  const settings = readDatabase(fixture.dbPath)
  assert.equal(settings.ai.endpoint, "http://127.0.0.1:3425/v1")
  assert.equal(settings.ai.model, "vendor/model-one")
})

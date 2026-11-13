import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StateError, emptyState, withAccount } from "../lib/state.mjs"
import { readStateFile, stateBackupPath, writeStateFile } from "../lib/state-store.mjs"

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), "magpie-hindsight-state-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function fixtureState() {
  return withAccount(emptyState(), "webdav-test", {
    accountKey: "webdav-test",
    uid: "webdav-test",
    dbPath: "/data/hindsight.webdav-test.sqlite",
    connected: false,
    prev: {},
    lastApplied: null,
  })
}

test("writeStateFile keeps a readable backup copy", (t) => {
  const statePath = join(temporary(t), "state.json")
  const state = fixtureState()

  writeStateFile(statePath, state)

  assert.equal(stateBackupPath(statePath), `${statePath}.bak`)
  assert.deepEqual(readStateFile(statePath), state)
  assert.deepEqual(JSON.parse(readFileSync(stateBackupPath(statePath), "utf8")), state)
})

test("readStateFile repairs a corrupt primary from the backup", (t) => {
  const statePath = join(temporary(t), "state.json")
  const state = fixtureState()
  writeStateFile(statePath, state)
  writeFileSync(statePath, "{")

  assert.deepEqual(readStateFile(statePath), state)
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), state)
})

test("readStateFile restores a missing primary from the backup", (t) => {
  const statePath = join(temporary(t), "state.json")
  const state = fixtureState()
  writeStateFile(statePath, state)
  rmSync(statePath)

  assert.deepEqual(readStateFile(statePath), state)
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), state)
})

test("readStateFile rejects a corrupt primary when the backup is corrupt too", (t) => {
  const statePath = join(temporary(t), "state.json")
  writeStateFile(statePath, fixtureState())
  writeFileSync(statePath, "{")
  writeFileSync(stateBackupPath(statePath), "{")

  assert.throws(() => readStateFile(statePath), StateError)
})

import test from "node:test"
import assert from "node:assert/strict"
import {
  CLOUD_SENTINEL,
  PROFILE_LIMIT,
  PROFILE_PREFIX,
  applySelection,
  restoreSelection,
} from "../lib/settings.mjs"

function baseAi() {
  return {
    endpoint: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "user-key",
    externalEnabled: true,
    externalProvider: "deepseek",
    externalProfiles: [
      {
        name: "My own profile",
        provider: "deepseek",
        endpoint: "https://api.deepseek.com/v1",
        apiKey: "user-key",
        model: "deepseek-chat",
      },
    ],
    summaryMain: "local-summary.gguf",
    chatMain: "local-chat.gguf",
    chatThinking: "auto",
    unrelated: { keep: true },
  }
}

function selection(ids = ["vendor/model-one", "vendor/model-two"], key = "magpie-key") {
  return {
    schema: 1,
    models: ids.map((id) => ({ id, name: id })),
    gatewayUrl: "http://127.0.0.1:3425/v1",
    gatewayKey: key,
  }
}

function managedProfiles(ai) {
  return ai.externalProfiles.filter((profile) => profile.name.startsWith(PROFILE_PREFIX))
}

test("first apply creates profiles, activates the first model and snapshots original AI", () => {
  const original = baseAi()
  const result = applySelection(original, selection())

  assert.equal(result.changed, true)
  assert.equal(result.activeModel, "vendor/model-one")
  assert.equal(result.ai.externalEnabled, true)
  assert.equal(result.ai.externalProvider, "custom")
  assert.equal(result.ai.endpoint, "http://127.0.0.1:3425/v1")
  assert.equal(result.ai.apiKey, "magpie-key")
  assert.equal(result.ai.summaryMain, CLOUD_SENTINEL)
  assert.equal(result.ai.chatMain, CLOUD_SENTINEL)
  assert.equal(result.ai.chatThinking, "auto")
  assert.deepEqual(result.ai.unrelated, { keep: true })
  assert.equal(result.ai.externalProfiles[0].name, "My own profile")
  assert.equal(managedProfiles(result.ai).length, 2)
  assert.equal(result.account.prev.endpoint, original.endpoint)
  assert.equal(result.account.prev.summaryMain, original.summaryMain)
  assert.equal(result.account.connected, true)
})

test("second apply is idempotent", () => {
  const first = applySelection(baseAi(), selection())
  const second = applySelection(first.ai, selection(), first.account)
  assert.equal(second.changed, false)
  assert.equal(second.stateChanged, false)
  assert.deepEqual(second.ai, first.ai)
})

test("a user's active model switch between Magpie profiles is preserved", () => {
  const first = applySelection(baseAi(), selection())
  first.ai.model = "vendor/model-two"
  const second = applySelection(first.ai, selection(), first.account)
  assert.equal(second.activeModel, "vendor/model-two")
  assert.equal(second.ai.model, "vendor/model-two")
  assert.equal(second.changed, false)
})

test("gateway key rotation preserves the selected model and updates profiles", () => {
  const first = applySelection(baseAi(), selection())
  first.ai.model = "vendor/model-two"
  const second = applySelection(first.ai, selection(undefined, "new-key"), first.account)
  assert.equal(second.ai.model, "vendor/model-two")
  assert.equal(second.ai.apiKey, "new-key")
  assert.ok(managedProfiles(second.ai).every((profile) => profile.apiKey === "new-key"))
})

test("unticked plugin profiles are removed while user profiles stay", () => {
  const first = applySelection(baseAi(), selection())
  const second = applySelection(first.ai, selection(["vendor/model-one"]), first.account)
  assert.deepEqual(
    second.ai.externalProfiles.map((profile) => profile.name),
    ["My own profile", "Magpie · vendor/model-one"]
  )
})

test("profile limit degrades by filling slots and still activating the first model", () => {
  const ids = Array.from({ length: 12 }, (_, index) => `vendor/model-${index}`)
  const result = applySelection(baseAi(), selection(ids))
  assert.equal(result.ai.externalProfiles.length, PROFILE_LIMIT)
  assert.equal(managedProfiles(result.ai).length, 9)
  assert.equal(result.savedProfiles.length, 9)
  assert.deepEqual(result.skippedModels, ids.slice(9))
  assert.equal(result.ai.model, ids[0])
})

test("ten user profiles are never evicted; activation still works", () => {
  const ai = baseAi()
  ai.externalProfiles = Array.from({ length: PROFILE_LIMIT }, (_, index) => ({
    name: `User ${index}`,
    provider: "custom",
    endpoint: `https://user.example/${index}`,
    apiKey: `user-${index}`,
    model: `model-${index}`,
  }))
  const result = applySelection(ai, selection())
  assert.deepEqual(result.ai.externalProfiles, ai.externalProfiles)
  assert.equal(result.savedProfiles.length, 0)
  assert.equal(result.skippedModels.length, 2)
  assert.equal(result.ai.model, "vendor/model-one")
})

test("a reserved-name collision uses a numbered profile instead of overwriting", () => {
  const ai = baseAi()
  ai.externalProfiles.push({
    name: "Magpie · vendor/model-one",
    provider: "custom",
    endpoint: "https://user.example",
    apiKey: "user",
    model: "other",
  })
  const result = applySelection(ai, selection(["vendor/model-one"]))
  assert.ok(result.ai.externalProfiles.some((profile) => profile.name === "Magpie · vendor/model-one"))
  assert.ok(
    result.ai.externalProfiles.some((profile) => profile.name === "Magpie · vendor/model-one (2)")
  )
})

test("disconnect restores previous active fields and removes untouched plugin profiles", () => {
  const original = baseAi()
  const first = applySelection(original, selection())
  first.ai.model = "vendor/model-two"
  const restored = restoreSelection(first.ai, first.account)

  assert.equal(restored.ai.endpoint, original.endpoint)
  assert.equal(restored.ai.model, original.model)
  assert.equal(restored.ai.apiKey, original.apiKey)
  assert.equal(restored.ai.externalProvider, original.externalProvider)
  assert.equal(restored.ai.summaryMain, original.summaryMain)
  assert.equal(restored.ai.chatMain, original.chatMain)
  assert.deepEqual(restored.ai.externalProfiles, original.externalProfiles)
  assert.equal(restored.account.connected, false)
})

test("disconnect preserves a user's later non-Magpie active endpoint", () => {
  const first = applySelection(baseAi(), selection())
  first.ai.endpoint = "https://other.example/v1"
  first.ai.apiKey = "other-key"
  first.ai.externalProvider = "openai"
  first.ai.model = "other-model"
  const restored = restoreSelection(first.ai, first.account)
  assert.equal(restored.ai.endpoint, "https://other.example/v1")
  assert.equal(restored.ai.apiKey, "other-key")
  assert.equal(restored.ai.externalProvider, "openai")
  assert.equal(restored.ai.model, "other-model")
  assert.equal(restored.ai.summaryMain, "local-summary.gguf")
  assert.equal(restored.ai.chatMain, "local-chat.gguf")
})

test("disconnect preserves a user's deliberate local summary/chat choice", () => {
  const first = applySelection(baseAi(), selection())
  first.ai.summaryMain = "my-local-summary.gguf"
  const restored = restoreSelection(first.ai, first.account)
  assert.equal(restored.ai.summaryMain, "my-local-summary.gguf")
  assert.equal(restored.ai.chatMain, "local-chat.gguf")
})

test("renamed or edited Magpie profiles are treated as user-owned", () => {
  const first = applySelection(baseAi(), selection())
  const edited = first.ai.externalProfiles.find(
    (profile) => profile.name === "Magpie · vendor/model-one"
  )
  edited.name = "My renamed profile"
  edited.endpoint = "https://user-edited.example/v1"

  const second = applySelection(first.ai, selection(), first.account)
  assert.ok(second.ai.externalProfiles.some((profile) => profile.name === "My renamed profile"))

  const restored = restoreSelection(second.ai, second.account)
  assert.ok(restored.ai.externalProfiles.some((profile) => profile.name === "My renamed profile"))
})

test("the first snapshot is not replaced by later tick selections", () => {
  const original = baseAi()
  const first = applySelection(original, selection())
  const second = applySelection(first.ai, selection(["vendor/model-one"]), first.account)
  assert.deepEqual(second.account.prev, first.account.prev)
})

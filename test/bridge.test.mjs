import test from "node:test"
import assert from "node:assert/strict"
import {
  isSelectionReady,
  normalizeGatewayUrl,
  selectionFrom,
  validateSelection,
} from "../lib/bridge.mjs"

const BASE = {
  schema: 1,
  models: [
    { id: "workbuddy/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "qoder/qfmodel", name: "Qwen3.8 Flash" },
  ],
  gateway: { url: "http://127.0.0.1:3425/v1/", key: "magpie-key" },
}

test("selectionFrom reads nested gateway and model ids containing slash", () => {
  const selection = selectionFrom(BASE)
  assert.equal(selection.schema, 1)
  assert.equal(selection.gatewayUrl, "http://127.0.0.1:3425/v1")
  assert.equal(selection.gatewayKey, "magpie-key")
  assert.deepEqual(selection.models.map((model) => model.id), [
    "workbuddy/deepseek-v4.1-flash",
    "qoder/qfmodel",
  ])
  assert.equal(isSelectionReady(selection), true)
})

test("selectionFrom accepts dotted gateway keys and string models", () => {
  const selection = selectionFrom({
    schema: 1,
    "gateway.url": "https://gateway.example/v1",
    "gateway.key": "k",
    models: ["model/one", { id: "model/two", name: "Two" }],
  })
  assert.equal(selection.gatewayUrl, "https://gateway.example/v1")
  assert.equal(selection.gatewayKey, "k")
  assert.deepEqual(selection.models, [
    { id: "model/one", name: "model/one" },
    { id: "model/two", name: "Two" },
  ])
})

test("selectionFrom de-duplicates model ids and preserves order", () => {
  const selection = selectionFrom({
    ...BASE,
    models: [{ id: "a" }, { id: "b" }, { id: "a" }],
  })
  assert.deepEqual(selection.models.map((model) => model.id), ["a", "b"])
})

test("old unversioned bridge is rejected", () => {
  const selection = selectionFrom({ ...BASE, schema: undefined })
  assert.equal(selection.schema, null)
  assert.match(validateSelection(selection), /schema/i)
})

test("validateSelection rejects empty or unsafe input", () => {
  assert.match(validateSelection(null), /no Magpie selection/i)
  assert.match(validateSelection({ ...selectionFrom(BASE), models: [] }), /No models/i)
  assert.match(validateSelection({ ...selectionFrom(BASE), gatewayUrl: "" }), /URL is missing/i)
  assert.match(
    validateSelection({ ...selectionFrom(BASE), gatewayUrl: "file:///tmp/x" }),
    /http or https/i
  )
  assert.match(validateSelection({ ...selectionFrom(BASE), gatewayKey: "" }), /key is missing/i)
})

test("normalizeGatewayUrl only strips trailing slashes", () => {
  assert.equal(normalizeGatewayUrl("  http://127.0.0.1:3425/v1///  "), "http://127.0.0.1:3425/v1")
  assert.equal(normalizeGatewayUrl(""), "")
})

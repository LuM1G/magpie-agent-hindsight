import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { agent, connect } from "../hindsight.agent.js"

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url))

test("agent declaration exposes the expected bridge and icon", () => {
  assert.equal(agent.id, "hindsight")
  assert.equal(agent.name, "Hindsight")
  assert.equal(agent.dir, "~/.magpie-agent/hindsight")
  assert.equal(agent.config, "~/.magpie-agent/hindsight/bridge.json")
  assert.equal(agent.icon, "./icon.png")
  assert.equal(agent.format, "json")
  assert.match(agent.notice, /^非官方社区插件/)
  assert.match(agent.notice, /cloud tokens|消耗 token/i)
  assert.doesNotMatch(agent.config, /AppData/)
})

test("connect writes schema 1, dotted gateway fields and de-duplicated models", () => {
  const result = connect({
    gateway: {
      v1: "http://127.0.0.1:3425/v1",
      key: "magpie-key",
    },
    models: [
      { id: "vendor/one", name: "One" },
      { id: "vendor/one", name: "Duplicate" },
      { id: "vendor/two" },
    ],
  })
  assert.equal(result.schema, 1)
  assert.equal(result["gateway.url"], "http://127.0.0.1:3425/v1")
  assert.equal(result["gateway.key"], "magpie-key")
  assert.deepEqual(result.models, [
    { id: "vendor/one", name: "One" },
    { id: "vendor/two", name: "vendor/two" },
  ])
})

test("package metadata points Magpie and Bun at the right entry points", () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"))
  assert.equal(pkg.version, "0.1.3")
  assert.match(pkg.description, /^非官方社区插件/)
  assert.deepEqual(Object.keys(pkg.magpie.summary), ["zh", "en"])
  assert.ok(pkg.magpie.summary.zh.length > 0)
  assert.ok(pkg.magpie.summary.en.length > 0)
  assert.equal(pkg.main, "./index.mjs")
  assert.equal(pkg.magpie.agent, "./hindsight.agent.js")
  assert.ok(pkg.files.includes("icon.png"))
  assert.ok(pkg.files.includes("README.en.md"))
  assert.ok(pkg.files.includes("LICENSE-GPL-3.0.txt"))
})

test("README language files are split and cross-linked", () => {
  const readme = readFileSync(join(PACKAGE_DIR, "README.md"), "utf8")
  const english = readFileSync(join(PACKAGE_DIR, "README.en.md"), "utf8")
  assert.match(readme, /\*\*简体中文\*\*\s*\|\s*\[English\]\(README\.en\.md\)/)
  assert.match(english, /\[简体中文\]\(README\.md\)\s*\|\s*\*\*English\*\*/)
  assert.match(readme, /非官方社区插件/)
  assert.match(readme, /magpie plugin add github:/)
  assert.match(english, /Unofficial community plugin/)
  assert.match(english, /magpie plugin add github:/)
})

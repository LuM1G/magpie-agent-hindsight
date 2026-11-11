import { performance } from "node:perf_hooks"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

const startedAt = performance.now()
const { stopHindsightHost } = await import("../../index.mjs")
const elapsedMs = performance.now() - startedAt
await delay(0)

const home = process.env.HOME || process.env.USERPROFILE
const statePath = join(home, ".magpie-agent", "hindsight", "state.json")
const waitMs = Number(process.env.MAGPIE_TEST_STATE_WAIT_MS || 0)
const deadline = Date.now() + Math.max(0, waitMs)
while (!existsSync(statePath) && Date.now() < deadline) {
  await delay(50)
}
if (existsSync(statePath)) await delay(200)

console.log(
  `HOST_RESULT=${JSON.stringify({
    elapsedMs,
    stateReady: existsSync(statePath),
  })}`
)
stopHindsightHost()

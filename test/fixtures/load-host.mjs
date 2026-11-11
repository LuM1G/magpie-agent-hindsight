import { performance } from "node:perf_hooks"
import startHindsightHost, { stopHindsightHost } from "../../index.mjs"

const startedAt = performance.now()
const result = await startHindsightHost()
const elapsedMs = performance.now() - startedAt

console.log(`HOST_RESULT=${JSON.stringify({ elapsedMs, result })}`)
stopHindsightHost()

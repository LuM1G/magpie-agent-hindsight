import { HindsightEngine } from "./lib/engine.mjs"

const HOST_KEY = Symbol.for("magpie.hindsight.host.v1")
const EXIT_HOOK_KEY = Symbol.for("magpie.hindsight.exit.v1")

export function stopHindsightHost() {
  const current = globalThis[HOST_KEY]
  if (!current) return
  current.controller.abort()
  current.engine.stop()
  delete globalThis[HOST_KEY]
}

export default async function startHindsightHost() {
  stopHindsightHost()

  const controller = new AbortController()
  const engine = new HindsightEngine()
  globalThis[HOST_KEY] = { controller, engine }

  engine.start({ signal: controller.signal }).catch((error) => {
    console.error(`[hindsight] host error: ${String(error?.message ?? error)}`)
  })

  if (!globalThis[EXIT_HOOK_KEY]) {
    globalThis[EXIT_HOOK_KEY] = true
    process.once("exit", stopHindsightHost)
  }

  return {}
}

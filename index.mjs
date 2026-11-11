#!/usr/bin/env bun
import { HindsightEngine } from "./lib/engine.mjs"

const controller = new AbortController()
const engine = new HindsightEngine()

function stop() {
  controller.abort()
  engine.stop()
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)

await engine.start({ signal: controller.signal })

import { HindsightEngine } from "../../lib/engine.mjs"

const logs = []
const ticks = Number(process.env.MAGPIE_TEST_TICKS || "1")
const engine = new HindsightEngine({
  logger: {
    log(message) {
      logs.push({ level: "log", message })
    },
    error(message) {
      logs.push({ level: "error", message })
    },
  },
})

for (let index = 0; index < ticks; index += 1) {
  await engine.tick()
}

console.log(JSON.stringify({ logs }))

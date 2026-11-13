// Magpie's agent module runs in the sandboxed moejs host. It cannot read or
// write files, so this module only declares Hindsight and records the user's
// Agents-page selection. The Bun main process (index.mjs) watches the bridge
// file and writes Hindsight's SQLite settings.

export const agent = {
  id: "hindsight",
  name: "Hindsight",
  // This plugin creates the bridge directory when its host starts. Magpie
  // uses a non-empty, existing dir to detect connect-only agents whose config
  // does not exist until the user connects.
  dir: "~/.magpie-agent/hindsight",
  // Magpie writes the selected models and gateway credentials here. This path
  // belongs only to this plugin, so Hindsight's own files and other community
  // plugins cannot collide with it.
  config: "~/.magpie-agent/hindsight/bridge.json",
  format: "json",
  notice:
    "非官方社区插件：连接后会让 Hindsight 的 AI 对话、日报和周报走 Magpie 云端并消耗 token；断开时恢复原设置。Unofficial community plugin. Connect routes Hindsight AI chat and daily/weekly summaries through Magpie and consumes cloud tokens; disconnect restores the previous AI settings.",
}

export function connect({ gateway, models }) {
  const seen = new Set()
  const normalized = []
  for (const item of models ?? []) {
    const id = String(item?.id ?? item ?? "").trim()
    if (id === "" || seen.has(id)) continue
    seen.add(id)
    normalized.push({
      id,
      name: String(item?.name ?? id).trim() || id,
    })
  }

  return {
    schema: 1,
    "gateway.url": gateway.v1,
    "gateway.key": gateway.key,
    models: normalized,
  }
}

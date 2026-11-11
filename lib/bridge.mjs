export const BRIDGE_SCHEMA = 1

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : ""
}

export function normalizeGatewayUrl(value) {
  const url = asTrimmedString(value)
  if (url === "") return ""
  return url.replace(/\/+$/, "")
}

/**
 * Parse the bridge file Magpie writes.
 *
 * The current Magpie shape is nested:
 *   { schema, gateway: { url, key }, models: [...] }
 * Older agent examples used dotted keys, so both shapes are accepted.
 */
export function selectionFrom(file) {
  if (!file || typeof file !== "object" || Array.isArray(file)) return null

  const list = file.models
  if (!Array.isArray(list)) return null

  const seen = new Set()
  const models = []
  for (const item of list) {
    const rawId =
      typeof item === "string" ? item : item && typeof item === "object" ? item.id : ""
    const id = asTrimmedString(rawId)
    if (id === "" || seen.has(id)) continue
    seen.add(id)
    const rawName =
      typeof item === "object" && item !== null && item.name != null ? item.name : id
    models.push({ id, name: asTrimmedString(rawName) || id })
  }

  const gateway =
    file.gateway && typeof file.gateway === "object" && !Array.isArray(file.gateway)
      ? file.gateway
      : null
  const gatewayUrl = normalizeGatewayUrl(gateway?.url ?? file["gateway.url"])
  const gatewayKey = asTrimmedString(gateway?.key ?? file["gateway.key"])

  return {
    schema: Number.isInteger(file.schema) ? file.schema : null,
    models,
    gatewayUrl,
    gatewayKey,
  }
}

/** Return a user-facing reason why this selection cannot be applied. */
export function validateSelection(selection) {
  if (!selection) return "Bridge file has no Magpie selection."
  if (selection.schema !== BRIDGE_SCHEMA) {
    return `Unsupported bridge schema: ${String(selection.schema)}. Reconnect Hindsight in Magpie.`
  }
  if (selection.models.length === 0) return "No models are selected."
  if (selection.gatewayUrl === "") return "Gateway URL is missing."

  let parsed
  try {
    parsed = new URL(selection.gatewayUrl)
  } catch {
    return `Gateway URL is not a valid URL: ${selection.gatewayUrl}`
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Gateway URL must use http or https: ${selection.gatewayUrl}`
  }
  if (selection.gatewayKey === "") return "Gateway key is missing."
  return null
}

export function isSelectionReady(selection) {
  return validateSelection(selection) === null
}

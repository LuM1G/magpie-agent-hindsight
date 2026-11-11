import { normalizeGatewayUrl } from "./bridge.mjs"

export const PROFILE_LIMIT = 10
export const PROFILE_PREFIX = "Magpie · "
export const CLOUD_SENTINEL = "__cloud__"

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : ""
}

function cloneProfile(profile) {
  return {
    name: profile.name,
    provider: profile.provider,
    endpoint: profile.endpoint,
    apiKey: profile.apiKey,
    model: profile.model,
  }
}

function profilesEqual(left, right) {
  return (
    isObject(left) &&
    isObject(right) &&
    left.name === right.name &&
    left.provider === right.provider &&
    left.endpoint === right.endpoint &&
    left.apiKey === right.apiKey &&
    left.model === right.model
  )
}

function removeManagedProfiles(profiles, managedProfiles) {
  if (!Array.isArray(profiles)) return []
  if (!Array.isArray(managedProfiles) || managedProfiles.length === 0) {
    return profiles.map((profile) => structuredClone(profile))
  }

  const used = new Set()
  return profiles
    .filter((profile) => {
      const index = managedProfiles.findIndex(
        (managed, managedIndex) =>
          !used.has(managedIndex) && profilesEqual(profile, managed)
      )
      if (index === -1) return true
      used.add(index)
      return false
    })
    .map((profile) => structuredClone(profile))
}

function uniqueProfileName(modelId, occupied) {
  const base = `${PROFILE_PREFIX}${modelId}`
  if (!occupied.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base} (${suffix})`
    if (!occupied.has(candidate)) return candidate
  }
  throw new Error(`Cannot allocate a profile name for ${modelId}`)
}

function snapshotPrev(ai) {
  return {
    externalEnabled: ai.externalEnabled,
    externalProvider: ai.externalProvider,
    endpoint: ai.endpoint,
    model: ai.model,
    apiKey: ai.apiKey,
    summaryMain: ai.summaryMain,
    chatMain: ai.chatMain,
  }
}

function restoreValue(target, key, value) {
  if (value === undefined) {
    delete target[key]
  } else {
    target[key] = value
  }
}

function isManagedActive(ai, lastApplied) {
  if (!isObject(lastApplied)) return false
  return (
    ai.externalProvider === "custom" &&
    normalizeGatewayUrl(ai.endpoint) === normalizeGatewayUrl(lastApplied.endpoint) &&
    ai.apiKey === lastApplied.apiKey
  )
}

function normalizeWantedModels(selection) {
  const seen = new Set()
  const wanted = []
  for (const item of selection?.models ?? []) {
    const id = trimString(item?.id ?? item)
    if (id === "" || seen.has(id)) continue
    seen.add(id)
    const name = trimString(item?.name) || id
    wanted.push({ id, name })
  }
  return wanted
}

function validateApplyInput(ai, selection) {
  if (!isObject(ai)) throw new Error("Hindsight ai settings are not an object.")
  if (!isObject(selection)) throw new Error("No Magpie selection to apply.")
  if (trimString(selection.gatewayUrl) === "") throw new Error("Gateway URL is empty.")
  if (trimString(selection.gatewayKey) === "") throw new Error("Gateway key is empty.")
}

/**
 * Apply one Magpie selection to Hindsight's `ai` settings object.
 *
 * The first connection snapshots the user's active fields. Later calls keep
 * that snapshot so disconnect restores the state from before Magpie, not the
 * previous tick's selection.
 */
export function applySelection(aiIn, selection, existingAccount = null) {
  validateApplyInput(aiIn, selection)
  const wanted = normalizeWantedModels(selection)
  if (wanted.length === 0) throw new Error("No Magpie models are selected.")

  const gatewayUrl = normalizeGatewayUrl(selection.gatewayUrl)
  const gatewayKey = trimString(selection.gatewayKey)
  const connectedBefore = existingAccount?.connected === true
  const prev = connectedBefore && isObject(existingAccount.prev)
    ? structuredClone(existingAccount.prev)
    : snapshotPrev(aiIn)
  const previousApplied = connectedBefore ? existingAccount.lastApplied : null

  const ai = structuredClone(aiIn)
  const originalProfiles = Array.isArray(ai.externalProfiles) ? ai.externalProfiles : []
  const managedBefore = Array.isArray(previousApplied?.profiles)
    ? previousApplied.profiles
    : []
  const remainingProfiles = removeManagedProfiles(originalProfiles, managedBefore)
  if (remainingProfiles.length > PROFILE_LIMIT) {
    throw new Error(
      `Hindsight already has ${remainingProfiles.length} profiles; refusing to exceed ${PROFILE_LIMIT}.`
    )
  }

  const occupied = new Set(remainingProfiles.map((profile) => trimString(profile?.name)))
  const savedProfiles = []
  const skippedModels = []
  for (const model of wanted) {
    if (remainingProfiles.length + savedProfiles.length >= PROFILE_LIMIT) {
      skippedModels.push(model.id)
      continue
    }
    const name = uniqueProfileName(model.id, occupied)
    occupied.add(name)
    savedProfiles.push({
      name,
      provider: "custom",
      endpoint: gatewayUrl,
      apiKey: gatewayKey,
      model: model.id,
    })
  }
  ai.externalProfiles = [...remainingProfiles, ...savedProfiles.map(cloneProfile)]

  const wantedIds = new Set(wanted.map((model) => model.id))
  const keepCurrentModel =
    isManagedActive(aiIn, previousApplied) && wantedIds.has(trimString(aiIn.model))
  const activeModel = keepCurrentModel ? trimString(aiIn.model) : wanted[0].id

  ai.externalEnabled = true
  ai.externalProvider = "custom"
  ai.endpoint = gatewayUrl
  ai.apiKey = gatewayKey
  ai.model = activeModel
  ai.summaryMain = CLOUD_SENTINEL
  ai.chatMain = CLOUD_SENTINEL

  const account = {
    ...(existingAccount ?? {}),
    connected: true,
    prev,
    lastApplied: {
      endpoint: gatewayUrl,
      apiKey: gatewayKey,
      profiles: savedProfiles.map(cloneProfile),
      summaryMain: CLOUD_SENTINEL,
      chatMain: CLOUD_SENTINEL,
    },
  }

  return {
    ai,
    account,
    activeModel,
    savedProfiles: savedProfiles.map((profile) => profile.name),
    skippedModels,
    changed: JSON.stringify(ai) !== JSON.stringify(aiIn),
    stateChanged: JSON.stringify(account) !== JSON.stringify(existingAccount),
  }
}

/** Revert only the values that are still under this plugin's control. */
export function restoreSelection(aiIn, account) {
  if (!isObject(aiIn)) throw new Error("Hindsight ai settings are not an object.")
  if (!account || account.connected !== true) {
    return {
      ai: structuredClone(aiIn),
      account,
      changed: false,
      stateChanged: false,
    }
  }
  const lastApplied = account.lastApplied
  if (!isObject(lastApplied)) {
    throw new Error("Connected account has no lastApplied fingerprint.")
  }

  const ai = structuredClone(aiIn)
  const managedProfiles = Array.isArray(lastApplied.profiles) ? lastApplied.profiles : []
  ai.externalProfiles = removeManagedProfiles(ai.externalProfiles, managedProfiles)

  if (isManagedActive(aiIn, lastApplied)) {
    const prev = isObject(account.prev) ? account.prev : {}
    restoreValue(ai, "externalEnabled", prev.externalEnabled)
    restoreValue(ai, "externalProvider", prev.externalProvider)
    restoreValue(ai, "endpoint", prev.endpoint)
    restoreValue(ai, "model", prev.model)
    restoreValue(ai, "apiKey", prev.apiKey)
  }

  const prev = isObject(account.prev) ? account.prev : {}
  if (trimString(ai.summaryMain) === CLOUD_SENTINEL) {
    restoreValue(ai, "summaryMain", prev.summaryMain)
  }
  if (trimString(ai.chatMain) === CLOUD_SENTINEL) {
    restoreValue(ai, "chatMain", prev.chatMain)
  }

  const restoredAccount = {
    ...account,
    connected: false,
    lastApplied: null,
  }

  return {
    ai,
    account: restoredAccount,
    changed: JSON.stringify(ai) !== JSON.stringify(aiIn),
    stateChanged: JSON.stringify(restoredAccount) !== JSON.stringify(account),
  }
}

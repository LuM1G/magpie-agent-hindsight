export const STATE_VERSION = 1

export class StateError extends Error {
  constructor(message) {
    super(message)
    this.name = "StateError"
  }
}

export function emptyState() {
  return { version: STATE_VERSION, accounts: {} }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function invalidAccount(accountKey, reason) {
  throw new StateError(`State account "${accountKey}" is invalid: ${reason}`)
}

function validatePrev(accountKey, prev) {
  if (!isObject(prev)) invalidAccount(accountKey, "prev must be an object")
  if (
    prev.externalEnabled !== undefined &&
    typeof prev.externalEnabled !== "boolean"
  ) {
    invalidAccount(accountKey, "prev.externalEnabled must be a boolean")
  }
  for (const field of [
    "externalProvider",
    "endpoint",
    "model",
    "apiKey",
    "summaryMain",
    "chatMain",
  ]) {
    if (prev[field] !== undefined && typeof prev[field] !== "string") {
      invalidAccount(accountKey, `prev.${field} must be a string`)
    }
  }
}

function validateProfile(accountKey, profile, index) {
  if (!isObject(profile)) {
    invalidAccount(accountKey, `lastApplied.profiles[${index}] must be an object`)
  }
  for (const field of ["name", "provider", "endpoint", "apiKey", "model"]) {
    if (typeof profile[field] !== "string") {
      invalidAccount(
        accountKey,
        `lastApplied.profiles[${index}].${field} must be a string`
      )
    }
  }
}

function validateLastApplied(accountKey, lastApplied) {
  if (!isObject(lastApplied)) {
    invalidAccount(accountKey, "lastApplied must be an object while connected")
  }
  for (const field of ["endpoint", "apiKey"]) {
    if (typeof lastApplied[field] !== "string" || lastApplied[field] === "") {
      invalidAccount(accountKey, `lastApplied.${field} must be a non-empty string`)
    }
  }
  if (!Array.isArray(lastApplied.profiles)) {
    invalidAccount(accountKey, "lastApplied.profiles must be an array")
  }
  if (lastApplied.profiles.length > 10) {
    invalidAccount(accountKey, "lastApplied.profiles exceeds Hindsight's limit")
  }
  lastApplied.profiles.forEach((profile, index) =>
    validateProfile(accountKey, profile, index)
  )
}

function validateStoredAccount(accountKey, account) {
  if (!isObject(account)) invalidAccount(accountKey, "account must be an object")
  if (account.accountKey !== accountKey) {
    invalidAccount(accountKey, "accountKey does not match its state key")
  }
  if (typeof account.connected !== "boolean") {
    invalidAccount(accountKey, "connected must be a boolean")
  }
  if (
    account.uid !== null &&
    account.uid !== undefined &&
    typeof account.uid !== "string"
  ) {
    invalidAccount(accountKey, "uid must be a string or null")
  }
  if (
    account.dbPath !== undefined &&
    (typeof account.dbPath !== "string" || account.dbPath === "")
  ) {
    invalidAccount(accountKey, "dbPath must be a non-empty string")
  }
  if (account.connected && typeof account.dbPath !== "string") {
    invalidAccount(accountKey, "dbPath is required while connected")
  }
  validatePrev(accountKey, account.prev)

  if (account.connected) {
    validateLastApplied(accountKey, account.lastApplied)
  } else if (account.lastApplied !== null && account.lastApplied !== undefined) {
    invalidAccount(accountKey, "lastApplied must be null or absent while disconnected")
  }
}

export function parseState(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new StateError(`State file is not valid JSON: ${error.message}`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StateError("State file must contain an object.")
  }
  if (parsed.version !== STATE_VERSION) {
    throw new StateError(`Unsupported state version: ${String(parsed.version)}`)
  }
  if (!parsed.accounts || typeof parsed.accounts !== "object" || Array.isArray(parsed.accounts)) {
    throw new StateError("State file has no accounts object.")
  }
  for (const [accountKey, account] of Object.entries(parsed.accounts)) {
    if (accountKey.trim() === "") {
      throw new StateError("State file contains an empty account key.")
    }
    validateStoredAccount(accountKey, account)
  }
  return parsed
}

export function accountFromState(state, accountKey) {
  if (!state?.accounts || !Object.hasOwn(state.accounts, accountKey)) return null
  const account = state.accounts[accountKey]
  if (!account || typeof account !== "object" || Array.isArray(account)) return null
  return account
}

export function withAccount(state, accountKey, account) {
  return {
    version: STATE_VERSION,
    accounts: {
      ...state.accounts,
      [accountKey]: account,
    },
  }
}

export function connectedAccounts(state) {
  return Object.entries(state.accounts ?? {})
    .filter(([, account]) => account?.connected === true)
    .map(([accountKey, account]) => ({ accountKey, account }))
}

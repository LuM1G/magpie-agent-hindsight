# magpie-agent-hindsight

[简体中文](README.md) | **English**

Unofficial community plugin that connects **Hindsight** to Magpie's Agents page. Choose Magpie models once; the plugin writes them into Hindsight's current-account SQLite settings, keeps the configuration in sync, and restores the previous AI settings when disconnected.

> This is not an official Hindsight or Magpie plugin. Hindsight's name is used only to identify compatibility; the plugin icon is an original design.

## What it manages

| Path | Managed | Value |
| --- | --- | --- |
| AI chat | Yes | `chatMain = "__cloud__"` |
| Daily/weekly summaries | Yes | `summaryMain = "__cloud__"` |
| OCR, embeddings, local vision | No | Existing local configuration is preserved |

Connecting has no partial mode: it takes over both AI chat and summaries. `__cloud__` routes both through the configured OpenAI-compatible endpoint, which is Magpie while connected, and therefore consumes Magpie or upstream tokens.

## Requirements

- Magpie `0.1.3697`
- Hindsight `0.11.4`
- Windows, macOS, or Linux
- An OpenAI-compatible chat model supported by Hindsight
- A model with OpenAI `tools` / function-calling support for Hindsight chat

The plugin uses Magpie's bundled Bun runtime and has no npm runtime dependencies.

## Install

```text
magpie plugin add github:LuM1G/magpie-agent-hindsight
```

After installing, open **Agents → Hindsight**, tick the models, and connect. Since `0.1.3`, the plugin starts syncing as soon as the plugin host loads; restart Magpie once after updating so the host is recreated. The bridge path is unchanged from `0.1.2`, so an existing connection does not need to be selected again.

## Files

Magpie writes the bridge file here:

```text
~/.magpie-agent/hindsight/bridge.json
```

The plugin stores its recovery state here:

```text
~/.magpie-agent/hindsight/state.json
```

The state file contains the original API key and gateway key needed for restoration. Do not share it. Logs never contain either key. Invalid or damaged bridge files never trigger database writes.

## Hindsight writes

Hindsight stores all settings as JSON in the `settings_store` row with `id = 1`. The plugin:

- Resolves the data root from `HINDSIGHT_DATA_DIR`, then `bootstrap.json.data_path`, then the platform default.
- Reads `active_user.json` and only targets the current account's `hindsight.<uid>.sqlite`, or `hindsight.sqlite` when there is no UID.
- Uses `BEGIN IMMEDIATE`, `busy_timeout`, and bounded retries so writes are safe while Hindsight is running.
- Preserves every Settings field outside the fields it manages.
- Never reads or writes `hindsight-memory.*.sqlite`.

On Windows, the bootstrap file is `%APPDATA%\Hindsight\bootstrap.json` and the key is `data_path`.

## Profiles

Up to 10 Hindsight external profiles are written as:

```text
Magpie · <model-id>
```

Hindsight's limit includes user-created profiles. The plugin never evicts a user profile. If there are not enough free slots, it fills the available slots, activates the first selected model, and logs the models it could not save.

While connected, switching to another `Magpie · ...` profile in Hindsight is preserved. Switching to a non-Magpie endpoint or model is treated as drift and corrected by the plugin.

Renamed or edited plugin profiles become user-owned and are not deleted on disconnect.

## Disconnect and restore

The first connection snapshots `externalEnabled`, `externalProvider`, `endpoint`, `model`, `apiKey`, `summaryMain`, and `chatMain`.

On disconnect:

- Active endpoint/key fields are restored only if they still point at the plugin gateway.
- `summaryMain` and `chatMain` are restored only if they are still `__cloud__`.
- Plugin-created profiles are removed only if every field still matches the plugin's last write.

After restoring, the background process stops reading the Hindsight database and account marker. It keeps only the bridge watcher for a later connection.

## Accounts

Only the account named by `active_user.json` is written. On an account switch, the plugin restores the previous account database before applying the current selection to the new account. State is stored per UID.

## Troubleshooting

- **Stale Hindsight settings page:** refresh or restart Hindsight to redraw the UI; the next AI request normally reads the new database values already.
- **Connected, but Hindsight still has no cloud-API screen:** fully quit Hindsight, including its tray process, and reopen it. Hindsight reads SQLite at startup, so an already-running window can keep the pre-connection screen. Verify that `~/.magpie-agent/hindsight/bridge.json` has `schema: 1`, `~/.magpie-agent/hindsight/state.json` marks the current account as connected, and the Hindsight `endpoint` is non-empty with `Magpie · ...` profiles. If the bridge exists but state does not, restart Magpie so the plugin host reloads, then reconnect from the Agents page if needed. The first sync normally completes within 2 seconds.
- **HTTP 400 with summaries working:** set Hindsight `chatThinking` to `auto` or `off`, or use an upstream that accepts `chat_template_kwargs`.
- **Chat fails while summaries work:** choose a model with OpenAI tools/function-calling support.
- **Waiting for connection:** verify `~/.magpie-agent/hindsight/bridge.json` exists and contains `schema: 1`.
- **Custom data directory:** set `HINDSIGHT_DATA_DIR` or `bootstrap.json.data_path`; bridge and state files remain under `~/.magpie-agent/hindsight`.
- **Multiple account databases:** the plugin waits unless `active_user.json` identifies exactly one current account.

## Limitations

- Only Hindsight AI chat and daily/weekly summaries are managed.
- Only the current account is active at one time.
- v1 has no per-agent scope switch; connecting manages everything listed above.
- Hindsight settings are an application implementation detail; this release targets `0.11.4`.
- The plugin cannot add tools support to an upstream or make it accept `chat_template_kwargs`.
- Hindsight's UI may cache stale settings until refreshed or restarted.

## Development

```text
npm test
npm pack --dry-run
```

Development tests require Node.js 22.5+ and Bun. They use temporary HOME/APPDATA trees and temporary SQLite databases, and never read or write the real `%APPDATA%\Hindsight` database. Integration tests auto-detect Bun on `PATH` or in Magpie's cache; set `MAGPIE_BUN` to override. When Bun is unavailable, those tests are reported as skipped.

## License

Plugin source code and icon are MIT (`LICENSE`). This is an unofficial community project.

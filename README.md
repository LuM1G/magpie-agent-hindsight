# magpie-agent-hindsight

Unofficial community plugin that connects **Hindsight** to Magpie's Agents
page. Choose Magpie models once; the plugin writes them into Hindsight's
current-account SQLite settings, keeps the configuration in sync, and restores
the previous AI settings when disconnected.

**This is not an official Hindsight or Magpie plugin.** Hindsight's name and
icon are used only to identify compatibility. See
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## What it connects

Hindsight has three separate AI paths:

| Path | Managed by this plugin? | How |
| --- | --- | --- |
| AI chat | Yes | `chatMain = "__cloud__"` |
| Daily/weekly summaries | Yes | `summaryMain = "__cloud__"` |
| OCR, embeddings, local vision | No | Uses local models/services |

Connecting **does not add a partial mode**. It deliberately takes over both AI
chat and summaries. `__cloud__` makes Hindsight use its configured external
OpenAI-compatible endpoint, which in connected mode is Magpie. This consumes
Magpie/upstream tokens whenever Hindsight chats or generates summaries.

Magpie's Agent API does not currently expose a per-agent boolean option, so
this plugin has no in-Agents-page scope switch. The complete takeover is
intentional and is shown in the Agent notice.

## Requirements

- Magpie `0.1.3487` (the version used for the bridge-format tests)
- Hindsight `0.11.4` (the schema used for this release)
- macOS, Windows, or Linux
- The selected Magpie model must support the OpenAI-compatible chat API used
  by Hindsight. Hindsight's chat agent also needs a model that accepts OpenAI
  `tools` / function calling.

The plugin uses the Bun runtime bundled with Magpie. It has no npm runtime
dependencies.

## Install

Push this package to a public GitHub repository, add the `magpie-plugin` topic
so it can appear under Discover → Unofficial, and install it with:

```text
magpie plugin add github:<owner>/<repo>
```

You can also add a local checkout:

```text
magpie plugin add <path-to-checkout>
```

After installing, open **Agents → Hindsight**, tick the models you want
Hindsight to expose, and connect. Reconnect once after replacing an older
`agent-hindsight` installation: bridge files without `schema: 1` are ignored.

## How it writes Hindsight

Hindsight stores all settings as one JSON object in the
`settings_store` table (`id = 1`). The plugin:

- Locates Hindsight's config root and data root using the same precedence as
  Hindsight: `HINDSIGHT_DATA_DIR`, then `bootstrap.json.data_path`, then the
  platform default.
- Reads `active_user.json`, then targets only the current account's
  `hindsight.<uid>.sqlite` (or `hindsight.sqlite` for anonymous use).
- Uses `BEGIN IMMEDIATE`, `busy_timeout`, and bounded retries so writing while
  Hindsight is running does not corrupt the settings row.
- Preserves the entire Settings object and every AI field outside the ones it
  manages.

On Windows, the bootstrap file is:

```text
%APPDATA%\Hindsight\bootstrap.json
```

The key is `data_path` (snake_case). `dataPath` is ignored.

## Models and profiles

The first selected model is activated on connect. Up to 10 saved profiles are
written as:

```text
Magpie · <model-id>
```

Hindsight's 10-profile limit includes profiles you created yourself. The
plugin never evicts a user profile. If there are not enough free slots, it
fills the available slots, still activates the first selected model, and logs
the models it could not save.

After connecting, switching to any other `Magpie · ...` profile in Hindsight
is preserved by the 2-second drift check. Switching to a non-Magpie endpoint
or model is treated as drift: while connected, the plugin reasserts its
managed gateway and the first selected model. Disconnect first if you want to
take full control of those fields.

If you rename or edit a Magpie profile, it becomes yours. The plugin will not
delete that profile on disconnect. Untouched plugin profiles are removed on
disconnect.

## Disconnect and restore

The plugin snapshots the original active fields before its first write:

- `externalEnabled`
- `externalProvider`
- `endpoint`
- `model`
- `apiKey`
- `summaryMain`
- `chatMain`

On disconnect it restores only values that still look plugin-managed:

- Active endpoint/key fields are restored only if they still point at the
  plugin's gateway.
- `summaryMain` and `chatMain` are restored only if they are still
  `__cloud__`.
- Plugin-created profiles are removed only if their fields exactly match the
  plugin's last write. Renamed or edited profiles stay.

After restoring, the Bun process stops reading the Hindsight database and
account marker. It keeps only the bridge file watcher so a later Magpie
connection can start a new session.

The state file is:

```text
~/.hindsight/.magpie-agent.state.json
```

It contains the original API key and gateway key needed for restoration. It is
created with user-only permissions where the platform supports POSIX modes.
Do not share it. Logs never print either key.

## Bridge file

Magpie writes:

```json
{
  "schema": 1,
  "models": [
    {
      "id": "workbuddy/deepseek-v4.1-flash",
      "name": "DeepSeek-V4.1-Flash · WorkBuddy"
    }
  ],
  "gateway": {
    "url": "http://127.0.0.1:3425/v1",
    "key": "<gateway key>"
  }
}
```

at:

```text
~/.hindsight/.magpie-agent.json
```

Older agent examples used dotted keys; the parser accepts both `gateway.url`
and a nested `gateway.url`. The model id may contain `/`; it is a display
value, not a filename.

## Account switching

Only the account named by `active_user.json` is written at any one time. When
Hindsight switches accounts, the plugin first restores the previous account's
database, then applies the current Magpie selection to the new account. State
is stored per UID.

The memory database (`hindsight-memory.*.sqlite`) is never touched.

## Troubleshooting

### Hindsight's settings page still shows old values

Hindsight's frontend caches settings. The next chat or summary request reads
the database, but the settings page may need a refresh or a Hindsight restart
to redraw. The next AI request usually does not require a restart.

### Chat returns 400 when thinking is enabled

With a custom provider, Hindsight may inject `chat_template_kwargs`. Some
upstreams reject that field. Set Hindsight's `chatThinking` to `auto` or
`off`, or choose an upstream that accepts it.

### Chat fails but summaries work

The selected model may not support OpenAI tool/function calling. Pick a model
with tool-call support in Magpie.

### The plugin says it is waiting for a connection

Check that Magpie actually connected Hindsight and that the bridge file exists
at `~/.hindsight/.magpie-agent.json`. A bridge without `schema: 1` is an old
lightweight-plugin file and is intentionally ignored; reconnect once.

### Custom data directory is not found

Set `HINDSIGHT_DATA_DIR` or put the custom path in
`%APPDATA%\Hindsight\bootstrap.json` as `data_path`. The bridge remains in
`~/.hindsight`; it is not inside the custom data directory.

### More than one account database exists

The plugin uses `active_user.json` rather than globbing all databases. If that
file is missing or does not name the current account, it waits instead of
guessing and risking a write to another account.

## Limitations

- Only Hindsight AI chat and daily/weekly summaries are managed.
- Only the current account is active at one time.
- No per-agent scope switch in v1.
- Hindsight's settings schema is an application implementation detail. This
  release targets `0.11.4`; a future Hindsight schema change may require a
  plugin update.
- The plugin cannot make an upstream model support tools or accept
  `chat_template_kwargs`.
- Hindsight's UI may show stale settings until refreshed or restarted.

## Development

```text
npm test
npm pack --dry-run
```

Development tests require Node.js 22.5+ and a Bun runtime. They use temporary
databases and a temporary HOME/APPDATA tree, and never read or write the real
`%APPDATA%\Hindsight` database. The integration tests auto-detect Bun on
`PATH` or in Magpie's cache; set `MAGPIE_BUN` to override the path. If Bun is
not available, those tests are reported as skipped.

## License

Plugin source code: MIT (`LICENSE`).

The Hindsight icon is a separate GPL-3.0 asset (`LICENSE-GPL-3.0.txt` and
`THIRD_PARTY_NOTICES.md`). The plugin is unofficial and is not endorsed by
Hindsight or Magpie.

---

# 中文说明

这是一个**非官方社区插件**，把 Hindsight 接入 Magpie 的 Agents 页。只需在
Magpie 里勾选模型，插件就会把配置写入 Hindsight 当前账号的 SQLite 设置，
并在连接期间保持同步；断开时恢复原来的 AI 设置。

## 接管范围

插件会接管：

- AI 对话：`chatMain = "__cloud__"`
- 日报/周报：`summaryMain = "__cloud__"`

不会接管 OCR、embedding、画面理解等本地能力。

Magpie 当前的 Agent 插件 API 没有 Agent 行内自定义开关，所以 v1 **没有只接管
对话或只接管总结的开关**。连接即全部接管。`__cloud__` 会让 Hindsight 使用外部
OpenAI 兼容端点，也就是 Magpie；对话和日报/周报都会消耗 Magpie 或上游的 token。
Agent 的 `notice` 和本文都会明确提示这一点。

## 安装

推送到公开 GitHub 仓库、添加 `magpie-plugin` topic 后：

```text
magpie plugin add github:<owner>/<repo>
```

或安装本地目录：

```text
magpie plugin add <path-to-checkout>
```

安装后打开 **Agents → Hindsight**，勾选模型并连接。替换旧轻量版插件后需要
重新连接一次：没有 `schema: 1` 的旧桥接文件会被视为未连接，不会自动写库。

## 模型档案

首次连接会激活第一个勾选模型。插件最多写入 10 份档案，命名为：

```text
Magpie · <model-id>
```

Hindsight 的 10 份上限包含用户自己的档案。插件不会删除用户档案；槽位不足时
会填满可用槽位、仍激活第一个模型，并记录没能保存的模型。

连接后，在 Hindsight 内切换到其他 `Magpie · ...` 档案会被保留。切换到非
Magpie 端点或模型会被视为漂移，插件会在 2 秒内重新写回受管配置。若要完全
自己管理这些字段，请先断开。

用户改名或编辑过的 Magpie 档案归用户所有，断开时不会删除。

## 写入与恢复

插件遵循 Hindsight 自己的数据目录优先级：

1. `HINDSIGHT_DATA_DIR`
2. `%APPDATA%\Hindsight\bootstrap.json` 的 `data_path`
3. 平台默认目录

它只操作当前账号的 `hindsight.<uid>.sqlite`，使用 `BEGIN IMMEDIATE`、
`busy_timeout` 和有限重试，不修改 `settings_store` 之外的数据，也不碰
`hindsight-memory.*`。

首次写入前会保存原来的：

- `externalEnabled`
- `externalProvider`
- `endpoint`
- `model`
- `apiKey`
- `summaryMain`
- `chatMain`

断开时只恢复仍归插件控制的字段；用户后来改过 endpoint/key，或把
`summaryMain`/`chatMain` 改成别的值，会保留用户的选择。插件创建的档案只有在
字段与最后写入指纹完全一致时才会删除。

状态文件：

```text
~/.hindsight/.magpie-agent.state.json
```

其中包含恢复所需的原始 API key 和 gateway key，按当前用户限定权限保存；
日志不会输出密钥。请不要分享该文件。

## 常见问题

**设置页没有立刻更新**：Hindsight 前端有设置缓存。下一次对话/总结会从 SQLite
读取新值，但设置页可能需要刷新或重启 Hindsight 才显示。

**对话 400，总结正常**：custom provider 可能注入 `chat_template_kwargs`，部分
上游不接受。把 `chatThinking` 设为 `auto` 或 `off`。

**总结正常，对话失败**：模型可能不支持 OpenAI tools/function calling，请在
Magpie 里选择支持工具调用的模型。

**找不到自定义数据目录**：设置 `HINDSIGHT_DATA_DIR`，或在
`%APPDATA%\Hindsight\bootstrap.json` 写入 `data_path`。桥接文件仍在
`~/.hindsight`，不随数据目录变化。

## 开发与许可

```text
npm test
npm pack --dry-run
```

开发测试需要 Node.js 22.5+ 和 Bun。测试只使用临时 HOME/APPDATA 和临时 SQLite
数据库，不读写真实 Hindsight 库。集成测试会自动查找 PATH 或 Magpie 缓存中的
Bun，也可用 `MAGPIE_BUN` 指定；找不到 Bun 时集成测试会明确跳过。

插件代码使用 MIT；Hindsight 官方图标是单独的 GPL-3.0 第三方资产，详见
`LICENSE-GPL-3.0.txt` 和 `THIRD_PARTY_NOTICES.md`。本插件不是 Hindsight 或
Magpie 官方作品。

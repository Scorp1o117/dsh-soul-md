# DSH Soul / Persona

[简体中文](README.md) | English

Add switchable persona cards and file-based long-term memory to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Choose personas per workspace or session, and let the Agent read and write memory or update a persona through its tools.

## Features

- **Persona cards:** create, edit and set a default card in the plugin page; use the chat persona switcher for an individual session, or hide it in plugin settings.
- **Workspace personas:** assign a default card to a workspace. Resolution order is session selection → workspace persona → default card → disabled.
- **File memory:** the Agent can use `memory_read`, `memory_append` and `memory_rewrite`; `soul_read` and `soul_update` read and update persona cards.
- **Optional layered memory:** separate a resident `core.md` from on-demand `topics/*.md`, with `memory_search`, optional keyword recall and post-compaction recall.
- **Subagent control:** optionally skip persona and memory prompt injection for subagents without changing the memory tools' read/write scope.

Soul centers memory on files and personas. For conversation capture, model-based extraction and vector recall, see [DSH TDAI Memory](https://github.com/Scorp1o117/dsh-tdai-memory). The plugins can be used independently.

## Compatibility and installation

Supports DSH Web / Desktop. The repository declares compatibility with `0.2.0-rc.2`, `0.2.1-rc.1` / `rc.2` / `rc.3` / `rc.4` / `rc.5` and versions matching `>=0.2.0-rc.2 <0.3.0`; see [package.json](package.json) for the complete prerelease range. Node.js `>=20.18` is required.

For Desktop, install its `dsh` command through **Application → Manage dsh Command** first:

```sh
dsh plugin --profile desktop add dsh-soul-md
```

Replace `desktop` with `web` for Web. Restart DSH and open **Plugins → Installed → dsh-soul-md**. You can also install it through the [Enhancement Suite](https://github.com/Scorp1o117/dsh-enhancement-suite).

## Quick start

1. Create a persona card in the plugin page, enter a name and Markdown content, and save it.
2. Set it as the default or assign it to a workspace; the chat header can override the persona for one session.
3. Talk to the Agent and let it use memory or persona tools as needed. Persona updates and memory writes depend on actual model tool calls and are not guaranteed to happen automatically.
4. Enable layered memory for topic-based organization. Keyword recall and post-compaction recall are separate opt-in settings.

## Memory and settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `showPersonaSwitcher` | `true` | Show the conversation header selector; hiding it preserves existing session choices |
| `memory.inject` | `true` | Inject the memory section into the prompt |
| `memory.layered` | `false` | Enable core + topics |
| `memory.recall` | `off` | Set to `keyword` to suggest related topics starting with the second user message processed during this plugin run |
| `memory.indexMode` | `all` | With keyword recall enabled, `recall` avoids injecting the full topic index every turn |
| `memory.compactionRecall` | `false` | After successful compaction or trimming, suggest recently used topic summaries on the next user turn |
| `memory.injectMaxChars` | `8000` | Character budget for memory injection |
| `allowTemplates` | `false` | Resolve prompt variables in personas and memories; by default braces are preserved literally |
| `skipSubagents` | `false` | Skip persona and memory prompt injection for subagents |

Keyword search is lexical, not semantic vector search. Recall supplies topic keys and summaries only; full text requires a tool read, and the injection budget still applies. `topic: "core"` or `"core.md"` targets resident core; existing `topics/core.md` is not moved automatically. Back it up and inspect it before manually reorganizing.

Persona settings live in the current profile; memory defaults to `$DSH_HOME/soul-md/memory/`. Back up and manage those files as needed. The interface follows the DSH language setting.

## Development and feedback

- `npm test` runs the project tests. The [historical detailed documentation](https://github.com/Scorp1o117/dsh-soul-md/blob/c248af33a8b3215b771ed52c1e2395a56a717908/README.md) preserves older configuration and migration details; install commands and compatibility information may be outdated.
- [npm](https://www.npmjs.com/package/dsh-soul-md) · [Issues](https://github.com/Scorp1o117/dsh-soul-md/issues) · [MIT License](LICENSE)

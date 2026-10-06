# dsh-soul-md

The plugin follows the DSH language setting (Chinese and English in DSH 0.2.0-rc.2), including configuration, status messages and plugin-list metadata. Language-pack locales use the host fallback chain. Switching languages preserves unsaved settings; there is no separate plugin language selector.

## v0.9.1: resident memory aliases and bounded index titles

- All three `memory_*` tools treat `topic: "core"` / `"core.md"` (case-insensitive, surrounding whitespace ignored) as an omitted topic, reading/writing resident core memory. Other topics keep their existing behavior.
- Index titles are capped at 80 characters and summaries at 240; topic keys remain distinct and full files are unchanged.
- Existing `topics/core.md` files are preserved without automatic merging. Back them up, inspect them with a file reader, merge resident entries into `core.md`, and rename remaining topic content to another key. New `memory_read({ topic: "core" })` calls read resident core.

## Keyword search and optional recall

With layered memory enabled, `memory_search({ query: "Electron packaging", limit: 5 })`
searches topic keys, titles, summaries and full bodies, returning keys and summaries
only. Persona topics override global topics with the same key; missing keys fall
back to global topics, just like `memory_read(topic)`. English matching is case
insensitive; Chinese phrases also use overlapping two-character terms. This is
lexical search, so synonyms without shared text require another query. Search does
not require automatic recall to be enabled.

The configuration page offers these independent, default-off options:

- `memory.recall: "keyword"`: from the second human message handled by the live
  plugin, add a `soul:recall` section with possibly relevant keys and summaries.
  The first message and internal context/compaction summaries do not trigger it.
- `memory.indexMode: "recall"`: while keyword recall is enabled, replace the full
  injected topic index with a short search hint. The existing index generation,
  title/summary bounds, truncation rules and `memory_read()` index stay unchanged.
- `memory.compactionRecall: true`: after successful compaction or pruning, the
  next human message restores descriptors for topics read/appended/rewritten in
  this session. They remain stable for that turn, and clear on the next human
  turn. Failed compaction does not trigger recovery. Recovery tracks at most the
  latest 128 topic keys in memory; unloading/restarting the plugin resets state.

Recall and recovery never inject topic bodies. They share `recallMaxChars`
(default 1600, maximum 8000) and the remaining `injectMaxChars` budget after the
existing memory section; if core/index uses the budget, no extra rows are added.
Each group includes at most `recallMaxTopics` (default 5, maximum 20).
Dynamic descriptors always preserve literal braces, even with `allowTemplates`.
`memory.inject: false` and `skipSubagents` also suppress `soul:recall`.

Suggested opt-in configuration in the `soul-md` row:

```yaml
memory:
  layered: true
  recall: keyword
  indexMode: recall
  compactionRecall: true
  recallMaxTopics: 5
  recallMaxChars: 1600
  injectMaxChars: 24000
```

## Configuration page (DSH 0.2.0-rc.2 and later)

Open **Plugins → Installed → dsh-soul-md** from the homepage sidebar to configure and save this plugin. The page uses the official `plugins.bundle.config` interface, without a duplicate entry in global Settings. Web and Desktop share the page. This version requires DSH 0.2.0-rc.2 or a later 0.2.x host; existing configuration is retained.

[![中文文档](https://img.shields.io/badge/%E4%B8%AD%E6%96%87%E6%96%87%E6%A1%A3-blue)](README.zh.md)

**GitHub**: [Scorp1o117/dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) · **npm**: [dsh-soul-md](https://www.npmjs.com/package/dsh-soul-md)

[![Enhancement Suite](https://img.shields.io/badge/part%20of-Enhancement%20Suite-3964fe)](https://github.com/Scorp1o117/dsh-enhancement-suite) [![npm](https://img.shields.io/npm/v/dsh-enhancement-suite)](https://www.npmjs.com/package/dsh-enhancement-suite)

Part of the [DeepSeek Harness Enhancement Suite](https://github.com/Scorp1o117/dsh-enhancement-suite) — Vision · Soul/Persona · Long-term Memory · Plugin Marketplace.

Persona + long-term memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — **zero file management**:

> In Settings → 人设卡, type a card **name** and its **content**, hit save. The plugin manages everything else.

## What you get

- **Persona cards** — the card content is rendered into the system prompt as
  the `soul:persona` section. Multiple cards are supported; pick a default,
  and switch per chat from the **conversation header** (a "人设" select).
- **Long-term memory** — the agent gets six tools:
  - `memory_append` / `memory_read` / `memory_rewrite` — a persistent memory
    file (Agent.md / memory.md style). The active persona card has its own
    memory; otherwise the global memory is used. In layered mode, their optional
    `topic` argument reads or writes one on-demand topic.
  - `memory_search` — search layered topic content and return keys and summaries.
  - `soul_read` / `soul_update` — the AI reads and **evolves its own persona
    card**: when it notices a stable trait, preference, or value of its own,
    it folds it into the card. It "grows" across sessions instead of
    resetting every time.
  - The memory is also injected as a `soul:memory` prompt section (capped)
    so the agent always sees its memories.
- **Resolution** per prompt assembly: `session choice (chat switcher) > workspace mapping > default card > none`. Switching applies from the next turn — no restart.
- **Workspace personas (v0.5.2)**: Settings → 人设卡 lists every workspace with a card dropdown — sessions of that workspace use the assigned card by default (session-level switching still wins). Workspaces come from dsh's durable workspace registry, so no paths to type.

## Desktop install

Use the Desktop-installed `dsh` command (Application → Manage dsh Command), or the app’s Plugins page. Then install into the Desktop profile:

```powershell
dsh plugin --profile desktop add dsh-soul-md
```

Restart the Desktop app to load the client bundle. Desktop keeps its profile under `$DSH_HOME/profiles/desktop`.

If Hub reports `Cannot find module '...app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'`,
the Desktop CLI bootstrap failed before loading this plugin. Reinstall a complete
official Desktop distribution, or try the official Plugins page (outside Hub).
Switching this command to the Web profile does not repair the Desktop package.
See [issue #14](https://github.com/Scorp1o117/dsh-soul-md/issues/14).


## Install

The plugin is a plain Cordis row. Mount it in a profile patch
(`$DSH_HOME/profiles/<name>/cordis.patch.yml`):

```yaml
- insert:
    - id: soul-md
      name: 'dsh-soul-md'          # after: pnpm add dsh-soul-md in the profile
```

Then restart `dsh web` and open **Settings → 人设卡**: type a name + content, save.

## Where things live (you don't need to care, but for reference)

- Persona cards: stored in the `soul-md` entry of the active Profile patch,
  as `cards: { name -> markdown }` + `active` + per-session `sessions`.
- Memory files: plugin-managed under `$DSH_HOME/soul-md/memory/`
  (`global.md` + one file per card), created on demand.
- Optional layered memory (off by default): `memory/<card>/core.md` is injected
  within the configured cap, while `memory/<card>/topics/*.md` contributes its title and first
  body line to an index. `memory_read({ topic: "..." })` retrieves a topic's full
  text. Existing `<card>.md` files remain readable and seed `core.md` on the first
  layered append, so enabling the option does not hide old memory.
- Upgrading from ≤ v0.4 (file-based)? The plugin **auto-imports** the old
  `path` card (as "默认") and the old memory file on first run.

## Config

| Field | Default | Meaning |
|---|---|---|
| `cards` | `{}` | Persona cards: name → markdown content (managed from the UI). |
| `active` | `''` | Default card name; empty disables the persona by default. |
| `sessions` | `{}` | Per-session choice (sessionId → card name / `none` / `''`); written by the chat switcher. |
| `workspaces` | `{}` | Per-workspace choice (workspace path → card name / `none` / `''`); written from the settings page. |
| `workspaceList` | `[]` | Read-only workspace list (path + title), maintained by the host from dsh's workspace registry. |
| `memory.maxBytes` | `1048576` | `memory_append` / `memory_rewrite` refuse to exceed this size. |
| `memory.inject` | `true` | Render the memory as the `soul:memory` prompt section. |
| `memory.layered` | `false` | Enable progressive disclosure: core plus a topics index. |
| `memory.recall` | `off` | `off` or `keyword`; automatic topic discovery from the second human message. |
| `memory.indexMode` | `all` | `all` or `recall`; the latter omits the full injected index only when keyword recall is enabled. |
| `memory.compactionRecall` | `false` | Restore consulted topic descriptors for the next human turn after successful compaction/pruning. |
| `memory.recallMaxTopics` | `5` | Results per recall/recovery group, maximum 20. |
| `memory.recallMaxChars` | `1600` | Combined recall/recovery cap, maximum 8000; also limited by the remaining memory injection budget. |
| `memory.injectMaxChars` | `8000` | Cap for injected memory content. Single-file mode retains the beginning and recent tail. Layered mode reserves the topic index first, then retains both ends of core. `memory_read` also retains both ends when its response exceeds 20,000 characters. |
| `memory.order` | `0.5` | Prompt section order for the injected memory section. |
| `allowTemplates` | `false` | Keep `{{…}}` literal in persona cards and memory by default; when enabled, the host interpolates prompt variables and unknown variables fail rendering. |
| `skipSubagents` | `false` | Delegated child sessions (DSH marks them `origin: "subagent"`) skip the `soul:persona` / `soul:memory` sections; tool scopes are unchanged. |
| legacy fields | — | `path`, `fallback`, `order`, `complete`, `watch`, `debounceMs`, `soulMaxBytes`, `personas`, `roster`, `memory.path`… kept so old composition entries and settings still validate; only used for the one-time import. |

`skipSubagents` is off by default and keeps the v0.7.0 behavior. When enabled,
sessions that DSH created as delegated children (`origin: "subagent"`) no longer receive the `soul:persona` / `soul:memory` sections —
a child usually does one small job and does not need to carry the parent's full persona and long-term memory every turn.

It only affects prompt injection: `cardNameOf`, `memoryTarget`, and the scope of the three `memory_*` tools are unchanged,
so a child reads and writes exactly the same card and memory files it would otherwise (nothing silently falls back to `global.md`).

Compatibility: tested with `@deepseek-ai/dsh@0.1.7-rc.1` and `0.1.7-rc.2` (npm `next`); npm `latest` is
`0.1.5-rc.3`. This version uses Profile patch settings and browser `configForms`.
Older hosts require an older plugin release. Alpha builds remain `unknown`.

## v0.8.1: reliable persona switching and layered memory truncation

- Reports refused session persona writes, rolls the selector back to the Host snapshot, and blocks overlapping selector changes while a write is pending.
- Keeps the topic index when layered memory exceeds its injection cap, retains both ends of core, and names omitted content in the prompt.
- Passed install, Web boot, homepage and client-bundle HTTP checks, and uninstall in a disposable DSH `0.1.5-rc.3` Profile.

## v0.8.0: subagent prompt control and DSH next compatibility

- Adds opt-in `skipSubagents`: delegated child sessions (`origin: "subagent"`) no longer receive the `soul:persona` / `soul:memory` sections.
- Render path only; `cardNameOf`, `memoryTarget`, and the `memory_*` tool scopes are unchanged.
- The settings page exposes the switch in the long-term memory group, saved together with `memory.inject` / `memory.layered`.
- Records DSH `0.1.5-rc.3` (`next`) compatibility; unverified alpha releases remain `unknown`.

## v0.7.0: Layered memory

- Adds opt-in `memory.layered`; existing users keep the single-file behavior.
- Injects `core.md` as resident memory and only a title/summary index for
  `topics/*.md`.
- Adds an optional `topic` argument to all three `memory_*` tools for on-demand
  topic reads and writes.
- Keeps legacy `<card>.md` visible as the core fallback and carries it into the
  first layered append.
- Passes disposable-profile install, Web boot, client-bundle, and uninstall
  smoke checks on DSH `0.1.5-rc.2`.

## Notes

- **Since v0.8.5, braces stay literal by default** in persona cards and memory.
  If an existing card relies on host variables such as `{{cwd}}`, enable
  **Allow prompt variables in persona and memory** (`allowTemplates: true`) in
  settings. Unknown variables still fail rendering in that mode.
- Persona/memory sections resolve per assembly, so steady cards stay
  byte-identical (KV-cache friendly) and edits hot-apply.
- DSH exposes the registered `soul-md` settings namespace directly; the plugin
  does not modify files in the host installation.
- Suggest putting work-quality rules in the card (e.g. "task quality first")
  so roleplay never degrades real work.
- Version 0.5.8 and newer require DSH `0.1.0-rc.7` or newer and are tested
  against `0.1.0-rc.7`, `0.1.0-rc.8`, and `0.1.1-rc.1`.
- DSH `0.1.0-rc.6` users must pin `dsh-soul-md@0.5.6`, the last release
  carrying the legacy settings-allowlist compatibility patch.

## License

MIT


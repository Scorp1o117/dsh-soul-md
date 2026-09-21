# dsh-soul-md

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
- **Long-term memory** — the agent gets five tools:
  - `memory_append` / `memory_read` / `memory_rewrite` — a persistent memory
    file (Agent.md / memory.md style). The active persona card has its own
    memory; otherwise the global memory is used. In layered mode, their optional
    `topic` argument reads or writes one on-demand topic.
  - `soul_read` / `soul_update` — the AI reads and **evolves its own persona
    card**: when it notices a stable trait, preference, or value of its own,
    it folds it into the card. It "grows" across sessions instead of
    resetting every time.
  - The memory is also injected as a `soul:memory` prompt section (capped)
    so the agent always sees its memories.
- **Resolution** per prompt assembly: `session choice (chat switcher) > workspace mapping > default card > none`. Switching applies from the next turn — no restart.
- **Workspace personas (v0.5.2)**: Settings → 人设卡 lists every workspace with a card dropdown — sessions of that workspace use the assigned card by default (session-level switching still wins). Workspaces come from dsh's durable workspace registry, so no paths to type.

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

- Persona cards: stored in the `soul-md` settings namespace (`settings.yaml`),
  as `cards: { name -> markdown }` + `active` + per-session `sessions`.
- Memory files: plugin-managed under `$DSH_HOME/soul-md/memory/`
  (`global.md` + one file per card), created on demand.
- Optional layered memory (off by default): `memory/<card>/core.md` is injected
  in full, while `memory/<card>/topics/*.md` contributes only its title and first
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
| `memory.layered` | `false` | Enable progressive disclosure: full core plus a topics index. |
| `memory.injectMaxChars` | `8000` | Cap for the injected section (from the file head). |
| `memory.order` | `0.5` | Prompt section order for the injected memory section. |
| `skipSubagents` | `false` | Delegated child sessions (DSH marks them `origin: "subagent"`) skip the `soul:persona` / `soul:memory` sections; tool scopes are unchanged. |
| legacy fields | — | `path`, `fallback`, `order`, `complete`, `watch`, `debounceMs`, `soulMaxBytes`, `personas`, `roster`, `memory.path`… kept so old composition entries and settings still validate; only used for the one-time import. |

`skipSubagents` is off by default and keeps the v0.7.0 behavior. When enabled,
sessions that DSH created as delegated children (`origin: "subagent"`) no longer receive the `soul:persona` / `soul:memory` sections —
a child usually does one small job and does not need to carry the parent's full persona and long-term memory every turn.

It only affects prompt injection: `cardNameOf`, `memoryTarget`, and the scope of the three `memory_*` tools are unchanged,
so a child reads and writes exactly the same card and memory files it would otherwise (nothing silently falls back to `global.md`).

Compatibility: automated tests run against the host packages shipped with
`@deepseek-ai/dsh@0.1.5-rc.2` (the current npm `latest`). `0.1.6-alpha.1` and
`.2` are explicitly recorded as `unknown`, not claimed as supported.

## Unreleased: skip persona/memory in subagent sessions

- Adds opt-in `skipSubagents`: delegated child sessions (`origin: "subagent"`) no longer receive the `soul:persona` / `soul:memory` sections.
- Render path only; `cardNameOf`, `memoryTarget`, and the `memory_*` tool scopes are unchanged.
- The settings page exposes the switch in the long-term memory group, saved together with `memory.inject` / `memory.layered`.

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

- **Never write `{{` / `}}` in a card body** — they are prompt-variable
  syntax; unknown variables fail rendering (no escape syntax yet).
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


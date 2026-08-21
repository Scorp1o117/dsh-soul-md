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
    memory; otherwise the global memory is used.
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
| `memory.injectMaxChars` | `8000` | Cap for the injected section (from the file head). |
| `memory.order` | `0.5` | Prompt section order for the injected memory section. |
| legacy fields | — | `path`, `fallback`, `order`, `complete`, `watch`, `debounceMs`, `soulMaxBytes`, `personas`, `roster`, `memory.path`… kept so old composition entries and settings still validate; only used for the one-time import. |

## Notes

- **Never write `{{` / `}}` in a card body** — they are prompt-variable
  syntax; unknown variables fail rendering (no escape syntax yet).
- Persona/memory sections resolve per assembly, so steady cards stay
  byte-identical (KV-cache friendly) and edits hot-apply.
- The settings section needs the `dsh-host-apiproxy` namespace allowlist;
  the plugin patches it automatically on first start — **restart `dsh web`
  once more** and the section appears.
- Suggest putting work-quality rules in the card (e.g. "task quality first")
  so roleplay never degrades real work.
- Tested against DSH `0.1.0-rc.6`, `0.1.0-rc.7`, and `0.1.0-rc.8`.

## License

MIT


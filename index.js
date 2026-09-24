/**
 * dsh-soul-md — soul.md-style persona + long-term memory for DeepSeek Harness.
 *
 * PLUGIN-MANAGED (v0.5.0): the user never touches file paths. Persona cards
 * live in the `soul-md` settings namespace as `cards: { name -> markdown }`
 * plus an `active` default and a per-session `sessions` map; the settings
 * page offers a simple name + content form. Memory files are managed by the
 * plugin under `$DSH_HOME/soul-md/memory/` (`global.md` plus one file per
 * card) and are created on demand.
 *
 * Resolution per prompt assembly:
 *   persona: session choice (chat switcher) > workspace mapping > active default card > none
 *   memory:  card memory (<card>.md) > global memory (global.md)
 *
 * Workspace personas: the settings page assigns a card per workspace
 * (host-published `workspaceList` from the durable workspace registry); the
 * mapping is keyed by workspace path and resolved from the session's cwd.
 *
 * The `soul:persona` / `soul:memory` sections use FUNCTION text, which
 * dsh-system-prompt evaluates on every assembly with the agent context —
 * switching applies from the next turn, no restart, no watchers.
 *
 * GROWTH TOOLS: `soul_read` / `soul_update` read/rewrite the card ACTIVE for
 * the calling agent; `memory_append` / `memory_read` / `memory_rewrite`
 * operate on the agent's memory scope. The descriptions encourage the agent
 * to record what it learns and to fold stable traits into its persona.
 *
 * Legacy fields (`path`, `personas`, `roster`, `memory.path`, …) are kept in
 * the schema as no-ops so old composition entries and settings keep
 * validating; on first run the plugin imports the old `path` card and the
 * old memory file into the managed store.
 */
import { readFileSync, statSync, watch } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, dirname } from "node:path";
import z from "@deepseek-ai/schemastery";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createMemoryLayout } from "./memory-layout.js";
import { skipsSubagentSections } from "./subagents.js";

/** Cordis plugin name. */
const name = "soul-md";
/** Services this plugin needs injected from the host tree. */
const inject = ["systemPrompt", "tools"];
/** Settings namespace owned by this plugin (Web UI settings section). */
const NS = "soul-md";

/** Section names; deliberately distinct from the registry-owned `deployment:persona`. */
const SECTION_PERSONA = "soul:persona";
const SECTION_MEMORY = "soul:memory";
/** Back-compat export name for the persona section. */
const SECTION_NAME = SECTION_PERSONA;

/** Session-choice value that disables the persona for that session. */
const CHOICE_NONE = "none";
/** Managed memory directory under the dsh home. */
const MEMORY_DIR = join("soul-md", "memory");

/** Runtime schema for the soul-md row. */
const Config = z.object({
  // ── v0.5: plugin-managed persona cards ───────────────────────────────────
  /** Persona cards: card name -> markdown content. */
  cards: z.dict(z.string(), z.string()).default({}),
  /** Default card name (used when the session has no explicit choice). */
  active: z.string().default(""),
  /** Per-session choice: sessionId -> card name, "none", or "" (follow default). */
  sessions: z.dict(z.string(), z.string()).default({}),
  /** Per-workspace choice: workspace path -> card name, "none", or "" (follow default). */
  workspaces: z.dict(z.string(), z.string()).default({}),
  /** Read-only workspace list (path + title), maintained by the host for the UI. */
  workspaceList: z.array(z.object({
    path: z.string(),
    title: z.string(),
  })).default([]),
  // ── long-term memory (plugin-managed files, no user-visible paths) ───────
  memory: z.object({
    /** `memory_append` / `memory_rewrite` refuse to grow a file beyond this size (bytes). */
    maxBytes: z.number().default(1024 * 1024),
    /** Also render the memory file as a `soul:memory` system-prompt section. */
    inject: z.boolean().default(true),
    /** Opt-in progressive disclosure: core.md is injected; topics/*.md become an index. */
    layered: z.boolean().default(false),
    /** Cap for the injected memory section (chars, from the file head). */
    injectMaxChars: z.number().default(8000),
    /** Prompt section order for the injected memory section. */
    order: z.number().default(0.5),
    // ── legacy (kept for schema compatibility; ignored) ──────────────────
    path: z.string().default(""),
    workspaceFile: z.string().default(""),
  }),
  // ── legacy fields (kept so old composition entries/settings validate) ────
  /** Legacy global card file (v0.2–v0.4); imported into `cards` once on first run. */
  path: z.string().default(""),
  fallback: z.string().default(""),
  order: z.number().default(0),
  complete: z.boolean().default(false),
  watch: z.boolean().default(true),
  debounceMs: z.number().default(300),
  /** Skip persona + memory injection in delegated child sessions (opt-in; default keeps v0.7 behavior). */
  skipSubagents: z.boolean().default(false),
  soulMaxBytes: z.number().default(64 * 1024),
  personas: z.object({
    dir: z.string().default(""),
    workspaceFile: z.string().default(".dsh-persona.md"),
  }),
  roster: z.array(z.object({
    key: z.string(),
    label: z.string(),
    kind: z.string(),
  })).default([]),
}).volatile();

function apply(ctx, config) {
  let sourceGetter = null;
  /** mtime-keyed text cache for memory files; steady sections stay byte-identical. */
  const fileCache = new Map();
  /** Workspace canonical-path index (lowercased cwd -> canonical path from the registry). */
  let wsPathIndex = new Map();
  /** Workspace-list publish state (declared early: onChange below references it). */
  let lastWsJson = "";
  let wsTimer = undefined;
  let wsWatcher = undefined;

  const cfg = () => (sourceGetter ? sourceGetter() : typeof config.get === "function" ? config.get() : config);

  /** Synchronous mtime-cached read; null when missing/unreadable. */
  const readCached = (file) => {
    try {
      const st = statSync(file);
      const hit = fileCache.get(file);
      if (hit && hit.mtimeMs === st.mtimeMs) return hit.text;
      const text = readFileSync(file, "utf8");
      fileCache.set(file, { mtimeMs: st.mtimeMs, text });
      return text;
    } catch {
      return null;
    }
  };

  const sessionIdOf = (agent) => {
    try {
      const id = agent?.session?.id;
      return typeof id === "string" && id.length > 0 ? id : null;
    } catch {
      return null;
    }
  };

  const workspaceDirOf = (agent) => {
    try {
      const cwd = agent?.session?.header?.cwd;
      return typeof cwd === "string" && cwd.length > 0 ? cwd : null;
    } catch {
      return null;
    }
  };

  /** The persona card ACTIVE for one agent: session choice > workspace mapping > default card > none. */
  const cardNameOf = (agent) => {
    const c = cfg();
    const sid = sessionIdOf(agent);
    if (sid) {
      const choice = c.sessions?.[sid];
      if (choice === CHOICE_NONE) return null;
      if (typeof choice === "string" && choice && c.cards?.[choice] !== void 0) return choice;
    }
    const cwd = workspaceDirOf(agent);
    if (cwd) {
      const key = wsPathIndex.get(String(cwd).toLowerCase()) ?? cwd;
      const choice = c.workspaces?.[key];
      if (choice === CHOICE_NONE) return null;
      if (typeof choice === "string" && choice && c.cards?.[choice] !== void 0) return choice;
    }
    return c.active && c.cards?.[c.active] !== void 0 ? c.active : null;
  };

  const resolveCard = (agent) => {
    const cardName = cardNameOf(agent);
    if (!cardName) return { name: null, text: null };
    return { name: cardName, text: cfg().cards[cardName] ?? null };
  };

  /** Managed memory directory (created on demand). */
  const memoryDir = () => join(resolveDshHome(), MEMORY_DIR);

  const memoryLayout = createMemoryLayout(memoryDir, readCached);

  const memoryScopes = (agent) => {
    const cardName = cardNameOf(agent);
    return cardName ? [cardName, "global"] : ["global"];
  };

  /** The memory scope ACTIVE for one agent (write target): card memory > global. */
  const memoryTarget = (agent, topic = "") => {
    const cardName = cardNameOf(agent);
    const scope = cardName ?? "global";
    return {
      ...memoryLayout.writeTarget(scope, { layered: Boolean(cfg().memory?.layered), topic }),
      scope,
    };
  };

  /** First EXISTING memory along the chain (read/inject path). */
  const memoryReadChain = (agent, topic = "") => memoryLayout.readChain(memoryScopes(agent), {
    layered: Boolean(cfg().memory?.layered),
    topic,
  });

  /** Render the persona section for one assembly. */
  const renderPersona = (assembly) => {
    const c = cfg();
    if (skipsSubagentSections(c, assembly?.agent)) return "";
    return resolveCard(assembly?.agent).text ?? "";
  };

  /** Render the memory section for one assembly. */
  const renderMemory = (assembly) => {
    const c = cfg();
    if (!c.memory?.inject) return "";
    if (skipsSubagentSections(c, assembly?.agent)) return "";
    const { text, index } = memoryReadChain(assembly?.agent);
    const rendered = [text, index].filter(Boolean).join("\n\n");
    if (!rendered) return "";
    const cap = Math.max(0, Math.floor(c.memory.injectMaxChars ?? 8000));
    if (rendered.length <= cap) return rendered;
    if (!index) {
      return rendered.slice(0, cap) + "\n\n> 记忆尾部未注入，请用 memory_read 读取全文 / memory tail omitted; use memory_read for the full text.";
    }
    if (index.length > cap) {
      return index.slice(0, cap) + "\n\n> 主题索引未完整注入，core 未注入；请用 memory_read 读取全文 / topic index incomplete; core omitted; use memory_read.";
    }
    // Reserve the complete topic index before allocating the remaining space
    // to core. Keep both ends of core so recent appends remain visible.
    const coreCap = Math.max(0, cap - index.length - (text ? 2 : 0));
    const separator = "\n…\n";
    const contentCap = Math.max(0, coreCap - separator.length);
    const headLength = Math.ceil(contentCap / 2);
    const tailLength = contentCap - headLength;
    const core = text.length <= coreCap
      ? text
      : coreCap < separator.length
        ? (coreCap ? text.slice(-coreCap) : "")
        : text.slice(0, headLength) + separator + (tailLength ? text.slice(-tailLength) : "");
    return [core, index].filter(Boolean).join("\n\n")
      + "\n\n> core 部分内容未注入，请用 memory_read 读取全文 / part of core omitted; use memory_read for the full text.";
  };

  // ── prompt sections (function text: resolved per assembly, hot by nature) ──
  const sectionDisposers = { persona: null, memory: null };
  function registerSections() {
    if (sectionDisposers.persona) {
      sectionDisposers.persona();
      sectionDisposers.persona = null;
    }
    if (sectionDisposers.memory) {
      sectionDisposers.memory();
      sectionDisposers.memory = null;
    }
    sectionDisposers.persona = ctx.systemPrompt.section({
      name: SECTION_PERSONA,
      order: cfg().order ?? 0,
      text: renderPersona,
      ...(cfg().complete ? { complete: true } : {}),
    });
    sectionDisposers.memory = ctx.systemPrompt.section({
      name: SECTION_MEMORY,
      order: cfg().memory?.order ?? 0.5,
      text: renderMemory,
    });
  }

  ctx.effect(() => {
    registerSections();
    return () => {
      if (sectionDisposers.persona) {
        sectionDisposers.persona();
        sectionDisposers.persona = null;
      }
      if (sectionDisposers.memory) {
        sectionDisposers.memory();
        sectionDisposers.memory = null;
      }
    };
  }, "soul-md.sections()");

  // ── settings-backed configuration ─────────────────────────────────────────
  // DSH 0.1.7 exposes Config directly as live profile fields.
  const onSettingsChange = () => {
    registerSections();
    void maybeMigrate();
    void publishWorkspaces();
    startWorkspaceWatch();
  };
  ctx.on("settings/document-updated", (id) => {
    if (id === NS) onSettingsChange();
  });
  queueMicrotask(onSettingsChange);

  // ── one-time migration from the legacy file-based layout ──────────────────
  // When no cards exist yet and the legacy `path` card file is readable,
  // import it as the "默认" card (and set it active); migrate the legacy
  // memory file into the managed store as well. Runs from onChange: the
  // settings inject callback fires it once the settings service is live (a
  // boot-time ctx.effect can run before that and silently see no settings).
  let migrated = false;
  const legacyFileOf = () => {
    // The legacy path may live in the settings layer or in the composition
    // entry config (`config.path`); the settings layer is authoritative.
    const p = cfg().path || config.path;
    if (!p) return null;
    return isAbsolute(p) ? p : join(resolveDshHome(), p);
  };
  const legacyMemoryFileOf = () => {
    const legacy = legacyFileOf();
    if (!legacy) return null;
    // Legacy default: memory.md next to the soul card (v0.2–v0.4 behavior).
    const p = cfg().memory?.path || config.memory?.path || "memory.md";
    if (!p) return null;
    return isAbsolute(p) ? p : join(dirname(legacy), p);
  };
  const maybeMigrate = async () => {
    try {
      if (migrated) return;
      const settings = ctx.get("settings");
      if (!settings) return; // not ready yet — retried on the next onChange
      migrated = true;
      const c = cfg();
      // The new host imports settings.yaml after plugins mount. If that file
      // already owns cards, let its one-time import win over the older soul.md
      // fallback; otherwise the fallback creates an unwanted second card.
      const oldSettings = readCached(join(resolveDshHome(), "settings.yaml"))
        ?? readCached(join(resolveDshHome(), "settings.yaml.imported"));
      const settingsOwnCards = oldSettings != null
        && /^soul-md:\s*$/m.test(oldSettings)
        && /^\s+cards:\s*$/m.test(oldSettings);
      if ((!c.cards || Object.keys(c.cards).length === 0) && !settingsOwnCards) {
        const legacy = legacyFileOf();
        if (legacy) {
          const text = await readFile(legacy, "utf8");
          const next = { ...c, cards: { 默认: text }, active: "默认" };
          await settings.update(NS, next);
          ctx.logger.info("[soul-md] imported legacy persona card as 默认");
        }
      }
      const managedGlobal = memoryLayout.legacyFile("global");
      if (readCached(managedGlobal) === null) {
        const legacyMem = legacyMemoryFileOf();
        if (legacyMem) {
          try {
            const text = await readFile(legacyMem, "utf8");
            if (text.length > 0) {
              await mkdir(memoryDir(), { recursive: true });
              await writeFile(managedGlobal, text, "utf8");
              ctx.logger.info("[soul-md] imported legacy memory file into the managed store");
            }
          } catch {
            /* legacy memory missing — nothing to import */
          }
        }
      }
    } catch (error) {
      ctx.logger.warn(`[soul-md] legacy migration skipped: ${String(error)}`);
    }
  };

  // ── workspace list (host-maintained, for the per-workspace persona UI) ─────
  // Read from the durable workspace registry; refreshed on settings changes
  // and when the sessions directory gains a workspace. The registry's async
  // init (history bootstrap) may not be done when this plugin applies, so a
  // not-ready registry yields null and publishWorkspaces retries until it is.
  const computeWorkspaceList = () => {
    try {
      const registry = ctx.get("workspaceRegistry");
      if (!registry || typeof registry.list !== "function") return null;
      const entities = registry.list();
      if (!Array.isArray(entities)) return null;
      return entities
        .map((entry) => ({
          path: String(entry.path ?? ""),
          title: String(entry.title ?? ""),
        }))
        .filter((entry) => entry.path.length > 0);
    } catch {
      // Registry exists but its async init has not completed yet — retry.
      return null;
    }
  };
  const rebuildWsIndex = (list) => {
    const next = new Map();
    for (const entry of list) next.set(String(entry.path).toLowerCase(), entry.path);
    wsPathIndex = next;
  };
  let wsRetryTimer = undefined;
  let wsRetryCount = 0;
  function scheduleWsRetry() {
    if (wsRetryTimer) return;
    if (wsRetryCount > 300) return; // give up after ~5 minutes of unavailability
    wsRetryTimer = setTimeout(() => {
      wsRetryTimer = undefined;
      wsRetryCount += 1;
      void publishWorkspaces();
    }, 1000);
  }
  async function publishWorkspaces() {
    try {
      const computed = computeWorkspaceList();
      if (computed === null) {
        scheduleWsRetry(); // registry not ready yet
        return;
      }
      const list = computed;
      rebuildWsIndex(list);
      const json = JSON.stringify(list);
      if (json === lastWsJson) return;
      lastWsJson = json;
      const settings = ctx.get("settings");
      if (!settings) {
        scheduleWsRetry();
        return;
      }
      const base = cfg();
      await settings.update(NS, { ...base, workspaceList: list }).catch((error) => {
        ctx.logger.warn(`[soul-md] workspace list write failed: ${String(error)}`);
      });
      wsRetryCount = 0;
    } catch (error) {
      ctx.logger.warn(`[soul-md] workspace list refresh failed: ${String(error)}`);
    }
  }
  function startWorkspaceWatch() {
    if (wsWatcher) {
      try {
        wsWatcher.close();
      } catch {
        /* already closed */
      }
      wsWatcher = undefined;
    }
    try {
      wsWatcher = watch(join(resolveDshHome(), "sessions"), { persistent: false }, () => {
        clearTimeout(wsTimer);
        wsTimer = setTimeout(() => void publishWorkspaces(), 300);
      });
    } catch {
      /* sessions dir missing — the onChange publish covers the initial state */
    }
  }

  ctx.effect(() => {
    void publishWorkspaces();
    startWorkspaceWatch();
    return () => {
      clearTimeout(wsTimer);
      clearTimeout(wsRetryTimer);
      if (wsWatcher) {
        try {
          wsWatcher.close();
        } catch {
          /* already closed */
        }
        wsWatcher = undefined;
      }
    };
  }, "soul-md.workspaces()");

  // ── persona + memory tools (the "growth" loop) ────────────────────────────
  const ensureParent = async (file) => {
    await mkdir(dirname(file), { recursive: true });
  };
  const byteLen = (text) => Buffer.byteLength(text, "utf8");
  const agentOf = (exec) => exec?.agent ?? null;

  ctx.tools.register(defineTool({
    name: "memory_append",
    description:
      "Append a dated Markdown block to your long-term memory. The target follows your CURRENT scope: the memory of the persona card active for this session, else the global memory. In layered mode, omit topic for always-visible core memory or pass a stable topic key for an on-demand topic file. Use it PROACTIVELY whenever you learn something worth keeping across sessions. Prefer small, self-contained entries over one giant dump.",
    parameters: {
      section: { type: "string", required: true, description: "Short heading for the entry, e.g. 用户偏好 / project decision. Use a stable name so related entries group together." },
      content: { type: "string", required: true, description: "The markdown text to remember. Keep it concise and self-contained." },
      topic: { type: "string", description: "Optional topic key in layered mode. Omit for core.md; e.g. project-foo writes topics/project-foo.md." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
          totalBytes: { type: "integer" },
          scope: { type: "string" },
          topic: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Appended to memory (${value.bytes} bytes, ${value.totalBytes} total) in scope "${value.scope}"${value.topic ? ` topic "${value.topic}"` : ""}.` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("memory_append: `content` must be non-empty");
      const section = String(args.section ?? "").trim();
      const topic = String(args.topic ?? "").trim();
      if (topic && !cfg().memory?.layered) {
        throw new Error("memory_append: `topic` requires memory.layered to be enabled");
      }
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const heading = `## ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}${section ? ` — ${section}` : ""}`;
      const block = `\n${heading}\n\n${content}\n`;
      const target = memoryTarget(agentOf(exec), topic);
      const current = readCached(target.file);
      const inherited = current === null && target.legacySeed ? readCached(target.legacySeed) : null;
      const existing = current ?? inherited ?? "";
      const totalBytes = byteLen(existing + block);
      if (totalBytes > (cfg().memory?.maxBytes ?? 1024 * 1024)) {
        throw new Error(`memory_append: memory file would exceed maxBytes (${cfg().memory.maxBytes}); consolidate with memory_rewrite first`);
      }
      await ensureParent(target.file);
      if (current === null && inherited !== null) await writeFile(target.file, existing + block, "utf8");
      else await appendFile(target.file, block, "utf8");
      fileCache.delete(target.file);
      return { bytes: byteLen(block), totalBytes, scope: target.scope, topic: target.topic };
    },
    presentCall: (args) => ({ card: "generic", title: "Append to memory", kind: "other", rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: "memory_read",
    description:
      "Read your long-term memory back. The reader walks your CURRENT scope chain: the active persona card's memory, else global memory. In layered mode, omit topic to read core memory plus the topic index, then pass a topic key to retrieve that topic's full text on demand.",
    parameters: {
      topic: { type: "string", description: "Optional topic key to read in layered mode. Omit to read core memory plus the topic index." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          exists: { type: "boolean" },
          bytes: { type: "integer" },
          truncated: { type: "boolean" },
          source: { type: "string" },
          topic: { type: "string" },
          content: { type: "string" },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.exists
          ? `Memory from "${value.source}"${value.topic ? ` topic "${value.topic}"` : ""} (${value.bytes} bytes${value.truncated ? ", truncated" : ""}):\n${value.content}`
          : `Memory is empty or missing (scope: "${value.source}").`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const topic = String(args.topic ?? "").trim();
      if (topic && !cfg().memory?.layered) {
        throw new Error("memory_read: `topic` requires memory.layered to be enabled");
      }
      const { exists, text, index, source, topic: resolvedTopic = "" } = memoryReadChain(agentOf(exec), topic);
      const full = [text, index].filter(Boolean).join("\n\n");
      if (!exists || !full) return { exists: false, bytes: 0, truncated: false, source, topic: resolvedTopic, content: "" };
      const MAX = 20000;
      const truncated = full.length > MAX;
      return {
        exists: true,
        bytes: byteLen(full),
        truncated,
        source,
        topic: resolvedTopic,
        content: truncated ? `${full.slice(0, MAX)}\n…(truncated; the memory is larger)…` : full,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "memory_rewrite",
    description:
      "REPLACE one memory file in your CURRENT scope. In layered mode, omit topic for always-visible core.md or pass a topic key for topics/<topic>.md. Use for consolidation: merge, deduplicate and reorganize entries. Build the new content from memory_read output unless you deliberately drop entries. Pass an empty string to clear the selected file.",
    parameters: {
      content: { type: "string", required: true, description: "The new full content of the memory file (markdown)." },
      topic: { type: "string", description: "Optional topic key in layered mode. Omit to replace core.md." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
          scope: { type: "string" },
          topic: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Memory rewritten (${value.bytes} bytes) in scope "${value.scope}"${value.topic ? ` topic "${value.topic}"` : ""}.` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const content = String(args.content ?? "");
      const topic = String(args.topic ?? "").trim();
      if (topic && !cfg().memory?.layered) {
        throw new Error("memory_rewrite: `topic` requires memory.layered to be enabled");
      }
      const bytes = byteLen(content);
      if (bytes > (cfg().memory?.maxBytes ?? 1024 * 1024)) {
        throw new Error(`memory_rewrite: content exceeds maxBytes (${cfg().memory.maxBytes})`);
      }
      const target = memoryTarget(agentOf(exec), topic);
      await ensureParent(target.file);
      await writeFile(target.file, content, "utf8");
      fileCache.delete(target.file);
      return { bytes, scope: target.scope, topic: target.topic };
    },
  }));

  ctx.tools.register(defineTool({
    name: "soul_read",
    description:
      "Read the persona card ACTIVE for your current session (session choice, else the default card), exactly as stored. Use it before soul_update so you know the full current text.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          exists: { type: "boolean" },
          persona: { type: "string" },
          content: { type: "string" },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.exists ? `Persona card "${value.persona}":\n${value.content}` : "No persona card is active for this session.",
      }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const card = resolveCard(agentOf(exec));
      return {
        exists: card.name !== null && card.text !== null,
        persona: card.name ?? "none",
        content: card.text ?? "",
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "soul_update",
    description:
      "Replace the persona card ACTIVE for your current session (session choice, else the default card) with new content. THIS IS HOW YOU GROW: when you notice a stable trait, preference, value, or mannerism of yours that the card does not yet express — or when experience contradicts the card — fold it in deliberately. Keep the card coherent, concise, and in its existing style; preserve everything still true; do not bloat it. This card is your identity across sessions, so update it only when the change is real and stable.",
    parameters: {
      content: { type: "string", required: true, description: "The complete new persona card (markdown). Non-empty, capped at soulMaxBytes." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          bytes: { type: "integer" },
          persona: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Persona card "${value.persona}" updated (${value.bytes} bytes).` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("soul_update: `content` must be non-empty");
      const bytes = byteLen(content);
      if (bytes > (cfg().soulMaxBytes ?? 64 * 1024)) {
        throw new Error(`soul_update: content exceeds soulMaxBytes (${cfg().soulMaxBytes})`);
      }
      const card = resolveCard(agentOf(exec));
      if (!card.name) throw new Error("soul_update: no persona card is active for this session");
      const c = cfg();
      const settings = ctx.get("settings");
      if (!settings) throw new Error("soul_update: settings service unavailable");
      const nextCards = { ...(c.cards ?? {}), [card.name]: content };
      await settings.update(NS, { ...c, cards: nextCards });
      return { bytes, persona: card.name };
    },
  }));
}

export { Config, NS, SECTION_MEMORY, SECTION_NAME, apply, inject, name };

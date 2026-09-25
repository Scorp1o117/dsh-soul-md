import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const CARD_BODY = "persona card body";
const CORE_BODY = "# core\n\nresident memory body.";

/**
 * Minimal host stand-in. Captures the prompt sections and agent tools the plugin
 * registers, and keeps every effect disposer so the test can tear the plugin
 * down without leaving a watcher or retry timer behind.
 */
function makeHost(config) {
  const sections = new Map();
  const tools = new Map();
  const disposers = [];
  const track = (result) => {
    if (typeof result === "function") disposers.push(result);
    return () => {};
  };
  const scope = {
    get: () => config,
    watch: () => {},
  };
  const settings = {
    register: () => scope,
    update: async () => {},
  };
  const sctx = { settings, effect: (fn) => track(fn()) };
  const ctx = {
    systemPrompt: {
      section(spec) {
        sections.set(spec.name, spec);
        return () => sections.delete(spec.name);
      },
    },
    effect: (fn) => track(fn()),
    on: () => () => {},
    inject: (_deps, cb) => {
      // A real host hands the settings scope over asynchronously; keeping that
      // timing also lets apply finish defining its closures before onChange runs.
      Promise.resolve().then(() => cb(sctx));
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get(name) {
      if (name === "settings") return settings;
      // A ready registry keeps publishWorkspaces from arming its retry timer.
      if (name === "workspaceRegistry") return { list: () => [] };
      return undefined;
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
      },
    },
  };
  return {
    ctx,
    sections,
    tools,
    dispose() {
      for (const disposer of disposers.splice(0)) {
        try {
          disposer();
        } catch {
          /* already torn down */
        }
      }
    },
  };
}

function baseConfig(overrides = {}) {
  return {
    cards: { D: CARD_BODY },
    active: "D",
    sessions: {},
    workspaces: {},
    workspaceList: [],
    skipSubagents: false,
    memory: { inject: true, layered: false, injectMaxChars: 8000, maxBytes: 1048576, order: 0.5 },
    ...overrides,
  };
}

/**
 * A parent session's header has no `origin` key at all on a real host, so the
 * field is only written when a test explicitly passes one.
 */
const agent = (origin) => {
  const header = { cwd: "C:\\work" };
  if (origin !== undefined) header.origin = origin;
  return { session: { id: "session-1", header } };
};
const assembly = (origin) => ({ agent: agent(origin) });
/** The parent-session shape a real host writes: no `origin` key whatsoever. */
const parentAssembly = () => assembly(undefined);

/** Boot the plugin against a throwaway DSH home. */
async function boot(t, overrides) {
  const home = await mkdtemp(join(tmpdir(), "dsh-soul-md-render-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    return rm(home, { recursive: true, force: true }).catch(() => {});
  });

  await mkdir(join(home, "soul-md", "memory"), { recursive: true });
  await writeFile(join(home, "soul-md", "memory", "D.md"), CORE_BODY, "utf8");

  const config = baseConfig(overrides);
  const { apply } = await import("../index.js");
  const host = makeHost(config);
  apply(host.ctx, config);
  // Let the injected settings scope arrive before touching the registered parts.
  await new Promise((resolve) => setImmediate(resolve));
  t.after(() => host.dispose());

  return { host, home };
}

test("default: a delegated child still receives persona and memory", async (t) => {
  const { host } = await boot(t, {});

  assert.equal(host.sections.get("soul:persona").text(assembly("subagent")), CARD_BODY);
  assert.match(host.sections.get("soul:memory").text(assembly("subagent")), /resident memory body/);
});

test("skipSubagents: the child gets neither section, the parent keeps both", async (t) => {
  const { host } = await boot(t, { skipSubagents: true });

  assert.equal(host.sections.get("soul:persona").text(assembly("subagent")), "");
  assert.equal(host.sections.get("soul:memory").text(assembly("subagent")), "");

  assert.equal(host.sections.get("soul:persona").text(parentAssembly()), CARD_BODY);
  assert.match(host.sections.get("soul:memory").text(parentAssembly()), /resident memory body/);
});

test("skipSubagents does not redirect a child's write to the global memory", async (t) => {
  const { host, home } = await boot(t, { skipSubagents: true });
  const child = { agent: agent("subagent") };

  const appended = await host.tools
    .get("memory_append")
    .execute({ section: "child note", content: "note from a child" }, child);
  assert.equal(appended.scope, "D");

  const read = await host.tools.get("memory_read").execute({}, child);
  assert.equal(read.source, "D");
  assert.match(read.content, /note from a child/);

  assert.equal(existsSync(join(home, "soul-md", "memory", "global.md")), false);
  assert.equal(existsSync(join(home, "soul-md", "memory", "D.md")), true);
});

test("skipSubagents keeps a child's persona tools aimed at its own card", async (t) => {
  const { host } = await boot(t, { skipSubagents: true });

  const soul = await host.tools.get("soul_read").execute({}, { agent: agent("subagent") });
  assert.equal(soul.exists, true);
  assert.equal(soul.persona, "D");
  assert.equal(soul.content, CARD_BODY);
});

test("layered injection keeps the topic index and both ends of a long core", async (t) => {
  const { host, home } = await boot(t, {
    memory: { inject: true, layered: true, injectMaxChars: 350, maxBytes: 1048576, order: 0.5 },
  });
  const root = join(home, "soul-md", "memory", "D");
  await mkdir(join(root, "topics"), { recursive: true });
  await writeFile(join(root, "core.md"), "START " + "x".repeat(500) + " RECENT", "utf8");
  await writeFile(join(root, "topics", "project.md"), "# Project\n\nA useful summary.", "utf8");

  const injected = host.sections.get("soul:memory").text(parentAssembly());
  assert.match(injected, /^START /);
  assert.match(injected, / RECENT\n\n## 主题记忆索引/);
  assert.match(injected, /`project` — Project：A useful summary\./);
  assert.match(injected, /core 部分内容未注入/);
  assert.ok(injected.indexOf(" RECENT") < injected.indexOf("`project`"));
});

test("a topic index larger than the cap is reported as incomplete", async (t) => {
  const { host, home } = await boot(t, {
    memory: { inject: true, layered: true, injectMaxChars: 60, maxBytes: 1048576, order: 0.5 },
  });
  const root = join(home, "soul-md", "memory", "D");
  await mkdir(join(root, "topics"), { recursive: true });
  await writeFile(join(root, "core.md"), "Core text", "utf8");
  await writeFile(join(root, "topics", "project.md"), "# Project\n\nA useful summary.", "utf8");

  const injected = host.sections.get("soul:memory").text(parentAssembly());
  assert.doesNotMatch(injected, /Core text/);
  assert.match(injected, /主题索引未完整注入/);
});

test("single-file injection and memory_read retain recent appends", async (t) => {
  const { host, home } = await boot(t, {
    memory: { inject: true, layered: false, injectMaxChars: 120, maxBytes: 1048576, order: 0.5 },
  });
  await writeFile(join(home, "soul-md", "memory", "D.md"),
    "EARLY " + "x".repeat(21000) + " RECENT APPEND", "utf8");

  const injected = host.sections.get("soul:memory").text(parentAssembly());
  assert.match(injected, /^EARLY /);
  assert.match(injected, / RECENT APPEND/);
  assert.match(injected, /已保留首尾/);

  const read = await host.tools.get("memory_read").execute({}, { agent: agent() });
  assert.equal(read.truncated, true);
  assert.match(read.content, /^EARLY /);
  assert.match(read.content, / RECENT APPEND/);
  assert.match(read.content, /beginning and end of core retained/);
});

test("layered memory_read keeps a long core's recent tail before the topic index", async (t) => {
  const { host, home } = await boot(t, {
    memory: { inject: true, layered: true, injectMaxChars: 350, maxBytes: 1048576, order: 0.5 },
  });
  const root = join(home, "soul-md", "memory", "D");
  await mkdir(join(root, "topics"), { recursive: true });
  await writeFile(join(root, "core.md"), "EARLY " + "x".repeat(21000) + " RECENT APPEND", "utf8");
  await writeFile(join(root, "topics", "project.md"), "# Project\n\nA useful summary.", "utf8");

  const read = await host.tools.get("memory_read").execute({}, { agent: agent() });
  assert.equal(read.truncated, true);
  assert.match(read.content, /^EARLY /);
  assert.match(read.content, / RECENT APPEND\n\n## 主题记忆索引/);
  assert.match(read.content, /`project` — Project/);
});

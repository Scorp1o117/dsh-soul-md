import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";

const promptModule = await import(process.env.DSH_PROMPT_TEST_MODULE || "@deepseek-ai/dsh-system-prompt");
const { SystemPrompt, renderContextSections, renderContextSnapshot, renderPrompt } = promptModule;

const CARD_BODY = "persona card body";
const CORE_BODY = "# core\n\nresident memory body.";

/**
 * Minimal host stand-in. Captures the prompt sections and agent tools the plugin
 * registers, and keeps every effect disposer so the test can tear the plugin
 * down without leaving a watcher or retry timer behind.
 */
function makeHost(config, { noRuntimeContext = false, realPrompt, realCtx } = {}) {
  const sections = new Map();
  const contexts = new Map();
  const variables = new Map();
  const tools = new Map();
  const disposers = [];
  const listeners = new Map();
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
    systemPrompt: realPrompt ?? {
      section(spec) {
        sections.set(spec.name, spec);
        return () => sections.delete(spec.name);
      },
      ...(!noRuntimeContext ? {
        context(spec) {
          contexts.set(spec.name, spec);
          return () => contexts.delete(spec.name);
        },
        variable(name, provider) {
          variables.set(name, provider);
          return () => variables.delete(name);
        },
      } : {}),
    },
    effect: (fn) => track(fn()),
    on: (name, listener) => {
      listeners.set(name, listener);
      const dispose = name === "system-prompt/assemble" && realCtx ? realCtx.on(name, listener) : () => {};
      if (realCtx && name === "system-prompt/assemble") disposers.push(dispose);
      return () => { listeners.delete(name); dispose(); };
    },
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
    contexts,
    variables,
    tools,
    listeners,
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
async function boot(t, overrides, hostOptions) {
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
  const host = makeHost(config, hostOptions);
  apply(host.ctx, config);
  // Let the injected settings scope arrive before touching the registered parts.
  await new Promise((resolve) => setImmediate(resolve));
  t.after(() => host.dispose());

  return { host, home };
}

test("explicitly allowing subagents retains persona and memory", async (t) => {
  const { host } = await boot(t, {});

  assert.equal(host.sections.get("soul:persona").text(assembly("subagent")), CARD_BODY);
  assert.match(host.sections.get("soul:memory").text(assembly("subagent")), /resident memory body/);
});

test("a new session's saved choice is used in its first prompt before workspace and default cards", async (t) => {
  const { host } = await boot(t, {
    cards: { D: "default persona", W: "workspace persona", S: "session persona" },
    active: "D",
    workspaces: { "C:\\work": "W" },
    sessions: { "session-1": "S", "session-2": "none" },
  });
  const persona = host.sections.get("soul:persona");
  const forSession = (id, cwd = "C:\\work") => ({ agent: { session: { id, header: { cwd } } } });
  assert.equal(persona.text(forSession("session-1")), "session persona");
  assert.equal(persona.text(forSession("session-2")), "");
  assert.equal(persona.text(forSession("session-3")), "workspace persona");
  assert.equal(persona.text(forSession("session-4", "C:\\elsewhere")), "default persona");
});

test("memory tools append/read/rewrite core aliases and inject the resulting core", async (t) => {
  const { host, home } = await boot(t, {
    memory: { inject: true, layered: true, injectMaxChars: 8000, maxBytes: 1048576 },
  });
  const exec = { agent: agent() };
  const appended = await host.tools.get("memory_append").execute({ topic: " CORE.md ", section: "identity", content: "old identity retired" }, exec);
  assert.equal(appended.topic, "");
  assert.equal(existsSync(join(home, "soul-md", "memory", "D", "topics", "core.md")), false);
  assert.match((await host.tools.get("memory_read").execute({ topic: "core" }, exec)).content, /old identity retired/);
  assert.match(host.sections.get("soul:memory").text(parentAssembly()), /old identity retired/);
  const rewritten = await host.tools.get("memory_rewrite").execute({ topic: "core.md", content: "replacement identity" }, exec);
  assert.equal(rewritten.topic, "");
  assert.equal((await host.tools.get("memory_read").execute({}, exec)).content, "replacement identity");
});

test("persona and memory preserve literal prompt references by default", async (t) => {
  const { host, home } = await boot(t, { cards: { D: "card {{demo}}" } });
  await writeFile(join(home, "soul-md", "memory", "D.md"), "memory {{demo}}", "utf8");

  const persona = host.sections.get("soul:persona");
  const memory = host.sections.get("soul:memory");
  assert.equal(persona.interpolate, false);
  assert.equal(memory.interpolate, false);
  const prompt = renderPrompt({
    sections: [persona, memory].map(({ name, text, interpolate }) => ({
      name, text: text(parentAssembly()), interpolate,
    })),
    variables: {},
  });
  assert.equal(prompt, "card {{demo}}\n\nmemory {{demo}}");
});

test("allowTemplates explicitly restores host variable interpolation", async (t) => {
  const { host, home } = await boot(t, {
    allowTemplates: true,
    cards: { D: "card {{cwd}}" },
  });
  await writeFile(join(home, "soul-md", "memory", "D.md"), "memory {{cwd}}", "utf8");

  const sections = ["soul:persona", "soul:memory"].map((name) => {
    const spec = host.sections.get(name);
    assert.equal(spec.interpolate, true);
    return { name, text: spec.text(parentAssembly()), interpolate: spec.interpolate };
  });
  assert.equal(renderPrompt({ sections, variables: { cwd: "C:\\work" } }),
    "card C:\\work\n\nmemory C:\\work");
  assert.throws(() => renderPrompt({ sections, variables: {} }), /unknown prompt variable/);
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

async function topicFixture(home, scope, key, content) {
  const dir = join(home, "soul-md", "memory", scope, "topics");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${key}.md`), content, "utf8");
}
const humanMessage = (id, text) => ({ id, role: "user", source: { kind: "user" }, content: [{ type: "text", text }] });
const admit = async (host, actor, messages) => {
  if (messages.length) actor.testTurn = (actor.testTurn ?? 0) + 1;
  for (const message of messages) host.listeners.get("agent/inbox/claimed")({ agent: actor, message, turn: actor.testTurn });
};
const recallText = (host, actor) => {
  const section = host.sections.get("soul:recall");
  if (section) return section.text({ agent: actor });
  const context = host.contexts.get("soul:recall");
  if (!context) return "";
  const assembled = host.listeners.get("system-prompt/assemble")({ sections: [],
    contexts: [{ name: context.name, text: context.text({ agent: actor }) }], variables: {} }, { agent: actor });
  return renderContextSections(assembled)[0]?.text ?? "";
};

test("memory_search finds body-only English and Chinese terms without exposing full bodies", async (t) => {
  const { host, home } = await boot(t, { memory: { layered: true, inject: true, injectMaxChars: 8000 } });
  await topicFixture(home, "D", "build", "# Build\n\nSummary only.\n\nSECRET_BODY: Electron 打包后的安装路径。");
  await topicFixture(home, "global", "fallback", "# Fallback\n\nPublic summary.\n\nnative binding");
  await topicFixture(home, "global", "build", "# Hidden\n\nShould never win.\n\nquasarword");
  const search = (query, limit) => host.tools.get("memory_search").execute({ query, ...(limit === undefined ? {} : { limit }) }, { agent: agent() });
  for (const query of ["electron", "如何处理打包后的路径"]) {
    const found = await search(query);
    assert.equal(found.matches[0].key, "build");
    assert.equal(found.matches[0].source, "D");
    assert.doesNotMatch(JSON.stringify(found), /SECRET_BODY/);
    assert.equal(found.matches[0].summary, "Summary only.");
  }
  assert.equal((await search("native")).matches[0].source, "global");
  assert.deepEqual((await search("quasarword")).matches, []);
  assert.deepEqual((await search("no-match")).matches, []);
  assert.deepEqual((await search("electron", 0)).matches, []);
  await assert.rejects(search("  "), /non-empty/);
  assert.equal(host.sections.has("soul:recall"), false, "default recall must not alter the system prompt");
  assert.equal(host.contexts.has("soul:recall"), true);
});

test("keyword recall starts on the second human message, is stable per step and bounded", async (t) => {
  const { host, home } = await boot(t, { memory: {
    layered: true, inject: true, recall: "keyword", indexMode: "recall",
    injectMaxChars: 700, recallMaxChars: 230, recallMaxTopics: 1,
  } });
  await topicFixture(home, "D", "build", "# Build {{literal}}\n\nBrief.\n\nSECRET_BODY Electron");
  await topicFixture(home, "D", "other", "# Other\n\nDifferent subject.");
  const actor = agent();
  const baseline = host.sections.get("soul:memory").text({ agent: actor });
  assert.doesNotMatch(baseline, /Different subject/);
  assert.match(baseline, /memory_search/);
  await admit(host, actor, [humanMessage("1", "Electron")]);
  assert.equal(recallText(host, actor), "");
  await admit(host, actor, [humanMessage("2", "ELECTRON")]);
  const recalled = recallText(host, actor);
  assert.match(recalled, /"build"/);
  assert.match(recalled, /可能相关/);
  assert.doesNotMatch(recalled, /SECRET_BODY|Different subject/);
  assert.ok(recalled.length <= 230);
  assert.ok(baseline.length + recalled.length + 2 <= 700);
  await admit(host, actor, []);
  assert.equal(recallText(host, actor), recalled);
  assert.equal(host.sections.get("soul:memory").text({ agent: actor }), baseline);
  assert.equal(host.contexts.get("soul:recall").order, 300);
  assert.equal(host.contexts.get("soul:recall").interpolate, false);
  assert.match(recalled, /\{\{literal\}\}/, "memory braces must stay literal");
  const read = await host.tools.get("memory_read").execute({}, { agent: actor });
  assert.match(read.content, /Different subject/);
  await admit(host, actor, [humanMessage("3", "unmatched")]);
  assert.equal(recallText(host, actor), "");
  assert.equal(recallText(host, agent()), "", "other session objects must not share recall state");
});

test("a long core reserves stable budget for default keyword recall", async (t) => {
  const { host, home } = await boot(t, { memory: { inject: true } });
  const root = join(home, "soul-md", "memory", "D");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "core.md"), "EARLY " + "x".repeat(12000) + " RECENT", "utf8");
  await topicFixture(home, "D", "build", "# Build\n\nElectron project summary.\n\nElectron");
  const actor = agent();
  const systemBefore = host.sections.get("soul:memory").text({ agent: actor });
  assert.match(systemBefore, /^EARLY /);
  assert.match(systemBefore, / RECENT/);
  await admit(host, actor, [humanMessage("1", "Electron"), humanMessage("2", "Electron")]);
  const recalled = recallText(host, actor);
  assert.match(recalled, /Electron project summary/);
  assert.ok(systemBefore.length + recalled.length + 2 <= 8000);
  assert.equal(host.sections.get("soul:memory").text({ agent: actor }), systemBefore);
  await admit(host, actor, [humanMessage("3", "unmatched")]);
  assert.equal(recallText(host, actor), "");
  assert.equal(host.sections.get("soul:memory").text({ agent: actor }), systemBefore);
});

test("compaction recovery waits for a new human message and lasts exactly that turn", async (t) => {
  const { host, home } = await boot(t, { memory: {
    layered: true, inject: true, compactionRecall: true, injectMaxChars: 8000, recallMaxTopics: 5,
  } });
  await topicFixture(home, "D", "build", "# Build\n\nBrief.\n\nSECRET_BODY");
  const actor = agent();
  const exec = { agent: actor };
  await host.tools.get("memory_read").execute({ topic: "build" }, exec);
  await host.tools.get("memory_append").execute({ topic: "written", section: "test", content: "New note" }, exec);
  await host.tools.get("memory_rewrite").execute({ topic: "rewritten", content: "# Rewritten\n\nSaved note" }, exec);
  await host.tools.get("memory_read").execute({ topic: "missing" }, exec);
  const emit = (type, data = {}) => host.listeners.get("session/event")(actor.session, { type, data });
  emit("compaction/end", { error: "failed" });
  await admit(host, actor, [humanMessage("1", "hi")]);
  assert.equal(recallText(host, actor), "");
  emit("compaction/end");
  await admit(host, actor, []);
  assert.equal(recallText(host, actor), "");
  await admit(host, actor, [{ ...humanMessage("summary", "compressed text"), source: { kind: "compaction" } }]);
  assert.equal(recallText(host, actor), "");
  await admit(host, actor, [humanMessage("2", "continue")]);
  const recovered = recallText(host, actor);
  assert.match(recovered, /Topics consulted before compaction/);
  assert.match(recovered, /"build"/);
  assert.match(recovered, /"written"/);
  assert.match(recovered, /"rewritten"/);
  assert.doesNotMatch(recovered, /missing|SECRET_BODY/);
  await admit(host, actor, []);
  assert.equal(recallText(host, actor), recovered);
  await admit(host, actor, [humanMessage("3", "continue again")]);
  assert.equal(recallText(host, actor), "");
  emit("compaction/prune");
  await admit(host, actor, [humanMessage("4", "after prune")]);
  assert.equal(recallText(host, actor), recovered);
  host.listeners.get("session/disposed")(actor.session);
  assert.equal(recallText(host, actor), "");
});

test("recall respects injection budget, subagent policy and changed persona scope", async (t) => {
  const { host, home } = await boot(t, { skipSubagents: true, memory: {
    layered: true, inject: true, recall: "keyword", compactionRecall: true,
    injectMaxChars: 180, recallMaxChars: 1600,
  } });
  await topicFixture(home, "D", "build", "# Build\n\nBrief.\n\nElectron");
  const actor = agent();
  await admit(host, actor, [humanMessage("1", "Electron"), humanMessage("2", "Electron")]);
  assert.equal(recallText(host, actor), "", "full index uses all available budget");
  const child = agent("subagent");
  await admit(host, child, [humanMessage("1", "Electron"), humanMessage("2", "Electron")]);
  assert.equal(recallText(host, child), "");
  await host.tools.get("memory_read").execute({ topic: "build" }, { agent: actor });
  host.listeners.get("session/event")(actor.session, { type: "compaction/end", data: {} });
  await admit(host, actor, [humanMessage("3", "continue")]);
  // Settings getter remains live: switch to a new persona without restarting.
  const config = host.ctx.get("settings").register().get();
  config.cards.E = "Other persona";
  config.active = "E";
  config.memory.injectMaxChars = 8000;
  assert.equal(recallText(host, actor), "");
  config.memory.layered = false;
  await assert.rejects(host.tools.get("memory_search").execute({ query: "Electron" }, { agent: actor }), /layered/);
});

test("new defaults enable useful memory features and retain explicit old choices", async () => {
  const { Config } = await import("../index.js");
  const defaults = Config({}).get();
  assert.equal(defaults.memory.layered, true);
  assert.equal(defaults.memory.recall, "keyword");
  assert.equal(defaults.memory.recallPlacement, "context");
  assert.equal(defaults.memory.compactionRecall, true);
  assert.equal(defaults.memory.indexMode, "all");
  assert.equal(defaults.skipSubagents, true);
  const explicit = Config({ skipSubagents: false, memory: {
    layered: false, recall: "off", recallPlacement: "system", compactionRecall: false,
  } }).get();
  assert.equal(explicit.skipSubagents, false);
  assert.equal(explicit.memory.layered, false);
  assert.equal(explicit.memory.recall, "off");
  assert.equal(explicit.memory.recallPlacement, "system");
  assert.equal(explicit.memory.compactionRecall, false);
});

test("default layered mode reads existing flat memory and preserves it when appending", async (t) => {
  const { host, home } = await boot(t, { memory: { inject: true } });
  const actor = agent();
  assert.match((await host.tools.get("memory_read").execute({}, { agent: actor })).content, /resident memory body/);
  await host.tools.get("memory_append").execute({ section: "New", content: "new entry" }, { agent: actor });
  const { readFile } = await import("node:fs/promises");
  const core = await readFile(join(home, "soul-md", "memory", "D", "core.md"), "utf8");
  assert.match(core, /resident memory body/);
  assert.match(core, /new entry/);
  assert.equal(await readFile(join(home, "soul-md", "memory", "D.md"), "utf8"), CORE_BODY);
});

test("placement can be switched live and older hosts fall back to the system section", async (t) => {
  const { host } = await boot(t, { memory: { inject: true, layered: true, recall: "keyword" } });
  assert.equal(host.contexts.has("soul:recall"), true);
  assert.equal(host.sections.has("soul:recall"), false);
  const config = host.ctx.get("settings").register().get();
  config.memory.recallPlacement = "system";
  host.listeners.get("settings/document-updated")("soul-md");
  assert.equal(host.contexts.has("soul:recall"), false);
  assert.equal(host.sections.get("soul:recall").interpolate, false);
  config.memory.recallPlacement = "context";
  host.listeners.get("settings/document-updated")("soul-md");
  assert.equal(host.sections.has("soul:recall"), false);
  assert.equal(host.contexts.has("soul:recall"), true);

  const adapt = host.listeners.get("system-prompt/assemble");
  const adapted = adapt({ sections: [], contexts: [{ name: "soul:recall", text: "literal {{unknown}}" }],
    variables: { soul_md_recall: "occupied" } }, {});
  assert.equal(adapted.variables.soul_md_recall, "occupied");
  assert.equal(renderContextSections(adapted)[0].text, "literal {{unknown}}");

  const legacy = await boot(t, { memory: { inject: true, layered: true, recall: "keyword" } }, { noRuntimeContext: true });
  assert.equal(legacy.host.sections.get("soul:recall").interpolate, false);
  assert.equal(legacy.host.contexts.has("soul:recall"), false);
});

for (const suppressed of [false, true]) {
  test(`real DSH prompt assembly preserves recall when runtime context is ${suppressed ? "suppressed" : "enabled"}`, async (t) => {
    const realCtx = new Context();
    const promptFork = realCtx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: !suppressed });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(realCtx.systemPrompt);
    const { host, home } = await boot(t, { memory: {
      inject: true, layered: true, recall: "keyword", indexMode: "all", injectMaxChars: 8000,
    } }, { realPrompt: realCtx.systemPrompt, realCtx });
    t.after(() => promptFork.dispose());
    await topicFixture(home, "D", "build", "# Build {{literal}}\n\nSummary {{unknown}}.\n\nElectron");
    const actor = agent();
    await admit(host, actor, [humanMessage("1", "Electron")]);
    const before = await realCtx.systemPrompt.assemble({ agent: actor });
    const beforeSystem = renderPrompt(before);
    await admit(host, actor, [humanMessage("2", "Electron")]);
    const after = await realCtx.systemPrompt.assemble({ agent: actor });
    const afterSystem = renderPrompt(after);
    const runtime = renderContextSnapshot(after);
    if (suppressed) {
      assert.match(afterSystem, /Build \{\{literal\}\}/);
      assert.match(afterSystem, /Summary \{\{unknown\}\}/);
      assert.equal(runtime, "");
    } else {
      assert.equal(afterSystem, beforeSystem, "recall must not change the system prefix");
      assert.match(runtime, /Build \{\{literal\}\}/);
      assert.match(runtime, /Summary \{\{unknown\}\}/);
      await admit(host, actor, [humanMessage("3", "unrelated")]);
      const cleared = await realCtx.systemPrompt.assemble({ agent: actor });
      assert.equal(renderPrompt(cleared), beforeSystem);
      assert.equal(renderContextSnapshot(cleared), "");
      if (typeof realCtx.systemPrompt.refreshContext === "function") {
        await topicFixture(home, "D", "music", "# Music\n\nPiano notes.\n\nPiano");
        await admit(host, actor, [humanMessage("refresh", "Piano")]);
        const refreshed = realCtx.systemPrompt.refreshContext(after, { agent: actor });
        assert.match(renderContextSnapshot(refreshed), /Piano notes/);
        assert.doesNotMatch(renderContextSnapshot(refreshed), /Build \{\{literal\}\}/);
        assert.equal(renderPrompt(refreshed), beforeSystem);
      }
    }
  });
}

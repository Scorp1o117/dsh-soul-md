import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * Host stand-in that enforces the Cordis lifecycle contract this test is about:
 * a fiber clears its `uid` before disposing its own disposables, and a prompt
 * section registered afterwards creates an effect on a dead context:
 *
 *   CordisError: cannot create effect on inactive context
 *
 * On the Desktop profile that error escaped the settings-change callback and
 * took the whole app down.
 */
function makeHost(config) {
  const fiber = { uid: 1 };
  const sections = [];
  const warnings = [];
  const listeners = new Map();
  const disposers = [];
  const active = () => fiber.uid !== null;
  const assertActive = () => {
    if (!active()) throw new Error("cannot create effect on inactive context");
  };
  const track = (dispose) => {
    if (typeof dispose === "function") disposers.push(dispose);
    return () => {};
  };
  const section = (spec) => {
    assertActive();
    sections.push(spec.name);
    return () => {};
  };
  const ctx = {
    fiber,
    effect(execute) {
      assertActive();
      return track(execute());
    },
    on(name, listener) {
      assertActive();
      listeners.set(name, listener);
      const dispose = () => listeners.delete(name);
      disposers.push(dispose);
      return dispose;
    },
    systemPrompt: { section, context: section },
    tools: { register() {} },
    logger: { info() {}, warn(message) { warnings.push(String(message)); }, error() {} },
    get(name) {
      if (name === "settings") return { update: async () => {}, register: () => ({ get: () => config }) };
      if (name === "workspaceRegistry") return { list: () => [] };
      return undefined;
    },
  };
  return {
    ctx,
    config,
    fiber,
    sections,
    warnings,
    listeners,
    /** Dispose the way Cordis does: clear the uid first, then run the effects. */
    dispose() {
      fiber.uid = null;
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          dispose();
        } catch {
          /* already torn down */
        }
      }
    },
  };
}

const config = {
  cards: { D: "persona" },
  active: "D",
  sessions: {},
  workspaces: {},
  workspaceList: [],
  memory: { inject: true, layered: true, injectMaxChars: 8000, maxBytes: 1048576, order: 0.5 },
};

// Imported once at module level: the window this file guards is synchronous, so
// an `await import()` between apply() and dispose() would close it early.
const { apply } = await import("../index.js");

async function home(t) {
  const dir = await mkdtemp(join(tmpdir(), "dsh-soul-md-inactive-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    return rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  return dir;
}

function boot(configOverride = config) {
  const host = makeHost(configOverride);
  apply(host.ctx, configOverride);
  return host;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a settings refresh queued during apply does not register effects on a disposed context", async (t) => {
  await home(t);
  const host = boot();
  const booted = host.sections.length;
  assert.ok(booted > 0, "apply must register its prompt sections while active");

  // The host applies the plugin and disposes it in the same tick — the shape of
  // a hot install or a re-enable — before the queued microtask runs.
  host.dispose();
  await tick();
  assert.equal(host.sections.length, booted, "a dead context must not register more sections");
  // The guard has to stop the attempt, not silence a failure: a caught
  // INACTIVE_EFFECT is still a lifecycle bug we want visible.
  assert.deepEqual(host.warnings, []);
});

test("a settings event delivered during teardown is ignored instead of creating an effect", async (t) => {
  await home(t);
  const host = boot();
  const booted = host.sections.length;
  const onSettings = host.listeners.get("settings/document-updated");
  host.dispose();

  // Cordis removes the listener with the fiber, but a dispatch already taken
  // from the registry still calls it.
  assert.doesNotThrow(() => onSettings("soul-md"));
  assert.doesNotThrow(() => onSettings("other-namespace"));
  assert.equal(host.sections.length, booted);
  assert.equal(host.listeners.has("settings/document-updated"), false);
  await tick();
  assert.equal(host.sections.length, booted);
  assert.deepEqual(host.warnings, []);
});

test("a live settings change still re-registers the prompt sections", async (t) => {
  await home(t);
  const host = boot();
  await tick();
  const before = host.sections.length;
  assert.ok(before > 0);
  host.listeners.get("settings/document-updated")("soul-md");
  assert.ok(host.sections.length > before, "the hot path must still refresh sections");
  host.dispose();
});

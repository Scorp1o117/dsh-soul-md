import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import TestRenderer from "react-test-renderer";

const source = await readFile(new URL("../client.js", import.meta.url), "utf8");
const { act } = TestRenderer;

function makeScope(value, { refuse = false, reject = false, waitFor } = {}) {
  let snapshot = { status: "ready", writable: true, revision: 1, value };
  const listeners = new Set();
  const writes = [];
  return {
    writes,
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async mutate(ops, revision) {
      assert.equal(revision, snapshot.revision);
      writes.push(JSON.parse(JSON.stringify(ops)));
      if (waitFor) await waitFor;
      if (reject) throw new Error("settings transport unavailable");
      if (!refuse) {
        const next = { ...snapshot.value };
        for (const op of ops) {
          if (op.op === "unset") delete next[op.path[0]];
          else next[op.path[0]] = op.value;
        }
        snapshot = { ...snapshot, revision: revision + 1, value: next };
        for (const listener of listeners) listener();
      }
      return true;
    },
  };
}

function createSurfaces(scope, { blocks, slots } = {}) {
  let bundle;
  const callbacks = new Map();
  const effects = [];
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { bundle = value; } } } });
  bundle.factory(name => { assert.equal(name, "react"); return React; }).apply({
    locale: { bind: () => key => key, register: () => () => {} },
    effect: fn => { const dispose = fn(); effects.push(dispose); return dispose; },
    get: name => name === "conversation" && blocks ? { blocks } : undefined,
    configForms: { get: () => scope },
    slots: {
      inject: (name, fn) => { if (!slots || slots.includes(name)) fn(); },
      register: (meta, render) => callbacks.set(meta.id ?? meta.name, render),
    },
  });
  return {
    callbacks,
    render({ header = "s1", hero = null, settings = true } = {}) {
      return React.createElement(React.Fragment, null,
        settings ? React.createElement("section", { key: "settings", id: "settings" }, callbacks.get("plugins.bundle.config")({})) : null,
        header && callbacks.has("soul-md-persona") ? React.createElement("section", { key: "header", id: "header" }, callbacks.get("soul-md-persona")({ sessionId: header })) : null,
        hero && callbacks.has("soul-md-persona-hero") ? React.createElement("section", { key: "hero", id: "hero" }, callbacks.get("soul-md-persona-hero")({ sessionId: hero })) : null,
      );
    },
    dispose() { for (const effect of effects.reverse()) if (typeof effect === "function") effect(); },
  };
}

function surfaces(scope) { return createSurfaces(scope).render(); }

function makeBlocks() {
  const stores = new Map();
  function storeFor(id) {
    if (!stores.has(id)) {
      let value;
      const listeners = new Set();
      stores.set(id, {
        getSnapshot: () => value,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        update(next) { value = next; for (const listener of [...listeners]) listener(); },
      });
    }
    return stores.get(id);
  }
  return {
    storeFor,
    set(id, value) {
      const store = storeFor(id);
      if (store.getSnapshot()?.reason !== value?.reason) store.update(value);
    },
  };
}

function selector(root, surface) {
  return root.root.findByProps({ id: surface }).findByProps({ className: "__sm_switchSelect" });
}

function visibilityToggle(root) {
  const label = root.root.findAllByType("label").find(node =>
    node.findAllByType("span").some(span => span.children.includes("showPersonaSwitcher")));
  return label.findByType("input");
}

function headerSelectors(root) {
  return root.root.findAllByProps({ className: "__sm_switchSelect" });
}

test("visibility is saved, follows live changes, survives remount, and preserves session choices", async () => {
  const value = { cards: { A: "persona" }, active: "A", workspaces: { work: "A" }, sessions: { s1: "none", s2: "A" } };
  const scope = makeScope(value);
  let root;
  await act(async () => { root = TestRenderer.create(surfaces(scope)); });
  assert.equal(visibilityToggle(root).props.checked, true, "old configurations remain visible");
  assert.equal(headerSelectors(root)[0].props.value, "none");

  await act(async () => { visibilityToggle(root).props.onChange({ target: { checked: false } }); });
  assert.deepEqual(scope.writes[0], [{ op: "set", path: ["showPersonaSwitcher"], value: false }]);
  assert.equal(headerSelectors(root).length, 0);
  assert.deepEqual(scope.getSnapshot().value.sessions, { s1: "none", s2: "A" });
  assert.deepEqual(scope.getSnapshot().value.workspaces, { work: "A" });
  assert.equal(scope.getSnapshot().value.active, "A");

  await act(async () => { root.unmount(); root = TestRenderer.create(surfaces(scope)); });
  assert.equal(visibilityToggle(root).props.checked, false);
  assert.equal(headerSelectors(root).length, 0);
  await act(async () => { visibilityToggle(root).props.onChange({ target: { checked: true } }); });
  assert.equal(headerSelectors(root)[0].props.value, "none");
  assert.deepEqual(scope.getSnapshot().value.sessions, { s1: "none", s2: "A" });
  await act(async () => root.unmount());
});

test("a refused visibility change reports an error and leaves the selector visible", async () => {
  const scope = makeScope({ cards: { A: "persona" }, sessions: { s1: "A" } }, { refuse: true });
  let root;
  await act(async () => { root = TestRenderer.create(surfaces(scope)); });
  await act(async () => { visibilityToggle(root).props.onChange({ target: { checked: false } }); });
  assert.equal(visibilityToggle(root).props.checked, true);
  assert.equal(headerSelectors(root)[0].props.value, "A");
  assert.ok(root.root.findAllByProps({ role: "alert" }).some(node => node.children.join("").includes("notApplied")));
  await act(async () => root.unmount());
});

test("the switch responds while saving and the header waits for the confirmed setting", async () => {
  let finish;
  const waitFor = new Promise(resolve => { finish = resolve; });
  const scope = makeScope({ cards: { A: "persona" }, sessions: { s1: "A" } }, { waitFor });
  let root;
  await act(async () => { root = TestRenderer.create(surfaces(scope)); });
  act(() => { visibilityToggle(root).props.onChange({ target: { checked: false } }); });
  assert.equal(visibilityToggle(root).props.checked, false);
  assert.equal(visibilityToggle(root).props.disabled, true);
  assert.equal(headerSelectors(root).length, 1);
  await act(async () => finish());
  assert.equal(visibilityToggle(root).props.disabled, false);
  assert.equal(headerSelectors(root).length, 0);
  await act(async () => root.unmount());
});

test("a failed transport restores the previous visibility and allows retry", async () => {
  const scope = makeScope({ cards: {}, sessions: {} }, { reject: true });
  let root;
  await act(async () => { root = TestRenderer.create(surfaces(scope)); });
  await act(async () => { visibilityToggle(root).props.onChange({ target: { checked: false } }); });
  assert.equal(visibilityToggle(root).props.checked, true);
  assert.equal(visibilityToggle(root).props.disabled, false);
  assert.equal(headerSelectors(root).length, 1);
  assert.ok(root.root.findAllByProps({ role: "alert" }).some(node => node.children.join("").includes("settings transport unavailable")));
  await act(async () => root.unmount());
});

test("the new-session selector shares visibility and changes only the current session", async () => {
  const scope = makeScope({ cards: { A: "persona A", B: "persona B" }, active: "A", workspaces: { work: "A" }, sessions: { s2: "A" } });
  const ui = createSurfaces(scope);
  let root;
  await act(async () => { root = TestRenderer.create(ui.render({ hero: "s1" })); });
  assert.equal(selector(root, "hero").props.value, "");
  assert.equal(selector(root, "header").props.value, "");

  await act(async () => { selector(root, "hero").props.onChange({ target: { value: "B" } }); });
  assert.equal(selector(root, "hero").props.value, "B");
  assert.equal(selector(root, "header").props.value, "B");
  assert.deepEqual(JSON.parse(JSON.stringify(scope.getSnapshot().value.sessions)), { s1: "B", s2: "A" });
  assert.equal(scope.getSnapshot().value.active, "A");
  assert.equal(scope.getSnapshot().value.workspaces.work, "A");

  await act(async () => { visibilityToggle(root).props.onChange({ target: { checked: false } }); });
  assert.equal(headerSelectors(root).length, 0);
  await act(async () => { visibilityToggle(root).props.onChange({ target: { checked: true } }); });
  assert.equal(selector(root, "hero").props.value, "B");
  assert.equal(selector(root, "header").props.value, "B");
  await act(async () => root.unmount());
});

test("switching workspace displays the destination session choice without copying or overwriting it", async () => {
  const scope = makeScope({ cards: { A: "a", B: "b" }, sessions: { s1: "A", s2: "B" } });
  const ui = createSurfaces(scope);
  let root;
  await act(async () => { root = TestRenderer.create(ui.render({ header: null, hero: "s1" })); });
  assert.equal(selector(root, "hero").props.value, "A");
  await act(async () => root.update(ui.render({ header: null, hero: "s2" })));
  assert.equal(selector(root, "hero").props.value, "B");
  await act(async () => root.update(ui.render({ header: null, hero: "s1" })));
  assert.equal(selector(root, "hero").props.value, "A");
  assert.equal(scope.writes.length, 0);
  await act(async () => root.unmount());
});

test("concurrent selectors serialize session changes against the latest settings", async () => {
  let finish;
  const waitFor = new Promise(resolve => { finish = resolve; });
  const scope = makeScope({ cards: { A: "a", B: "b" }, sessions: { older: "A" } }, { waitFor });
  const ui = createSurfaces(scope);
  let root;
  await act(async () => { root = TestRenderer.create(ui.render({ header: "s2", hero: "s1", settings: false })); });
  act(() => {
    selector(root, "hero").props.onChange({ target: { value: "A" } });
    selector(root, "header").props.onChange({ target: { value: "B" } });
  });
  assert.equal(scope.writes.length, 1);
  assert.equal(selector(root, "hero").props.disabled, true);
  assert.equal(selector(root, "header").props.disabled, true);
  await act(async () => finish());
  assert.equal(scope.writes.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(scope.getSnapshot().value.sessions)), { older: "A", s1: "A", s2: "B" });
  assert.equal(selector(root, "hero").props.value, "A");
  assert.equal(selector(root, "header").props.value, "B");
  await act(async () => root.unmount());
});

test("saving a new-session choice blocks the composer until the write is confirmed", async () => {
  let finish;
  const waitFor = new Promise(resolve => { finish = resolve; });
  const scope = makeScope({ cards: { A: "a" }, sessions: {} }, { waitFor });
  const blocks = makeBlocks();
  const ui = createSurfaces(scope, { blocks });
  let root;
  await act(async () => { root = TestRenderer.create(ui.render({ header: null, hero: "s1", settings: false })); });
  act(() => { selector(root, "hero").props.onChange({ target: { value: "A" } }); });
  assert.equal(blocks.storeFor("s1").getSnapshot().reason, "savingPersona");
  assert.equal(selector(root, "hero").props.value, "A");
  assert.equal(selector(root, "hero").props.disabled, true);
  await act(async () => finish());
  assert.equal(blocks.storeFor("s1").getSnapshot(), undefined);
  assert.equal(scope.getSnapshot().value.sessions.s1, "A");
  assert.equal(selector(root, "hero").props.disabled, false);
  await act(async () => root.unmount());
});

test("saving respects a competing composer block and releases only its own block", async () => {
  let finish;
  const waitFor = new Promise(resolve => { finish = resolve; });
  const scope = makeScope({ cards: { A: "a" }, sessions: {} }, { waitFor });
  const blocks = makeBlocks();
  const existing = { reason: "other plugin" };
  const replacement = { reason: "other plugin again" };
  blocks.set("s1", existing);
  const ui = createSurfaces(scope, { blocks });
  let root;
  await act(async () => { root = TestRenderer.create(ui.render({ header: null, hero: "s1", settings: false })); });
  act(() => { selector(root, "hero").props.onChange({ target: { value: "A" } }); });
  assert.equal(blocks.storeFor("s1").getSnapshot(), existing);
  act(() => blocks.set("s1", undefined));
  assert.equal(blocks.storeFor("s1").getSnapshot().reason, "savingPersona");
  act(() => blocks.set("s1", replacement));
  await act(async () => finish());
  assert.equal(blocks.storeFor("s1").getSnapshot(), replacement);
  await act(async () => root.unmount());
});

test("a failed persona save unblocks the composer and restores the real selection", async () => {
  const scope = makeScope({ cards: { A: "a" }, sessions: {} }, { reject: true });
  const blocks = makeBlocks();
  const ui = createSurfaces(scope, { blocks });
  let root;
  await act(async () => { root = TestRenderer.create(ui.render({ header: null, hero: "s1", settings: false })); });
  await act(async () => { selector(root, "hero").props.onChange({ target: { value: "A" } }); });
  assert.equal(blocks.storeFor("s1").getSnapshot(), undefined);
  assert.equal(selector(root, "hero").props.value, "");
  assert.ok(root.root.findAllByProps({ role: "alert" }).some(node => node.children.join("").includes("settings transport unavailable")));
  await act(async () => root.unmount());
});

test("a host without the new-session slot retains the header selector", async () => {
  const scope = makeScope({ cards: { A: "a" }, sessions: { s1: "A" } });
  const ui = createSurfaces(scope, { slots: ["plugins.bundle.config", "conversation.session.header.actions"] });
  assert.equal(ui.callbacks.has("soul-md-persona-hero"), false);
  let root;
  await act(async () => { root = TestRenderer.create(ui.render({ hero: "s1" })); });
  assert.equal(selector(root, "header").props.value, "A");
  await act(async () => root.unmount());
});

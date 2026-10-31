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

function surfaces(scope) {
  let bundle;
  const callbacks = new Map();
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { bundle = value; } } } });
  bundle.factory(name => { assert.equal(name, "react"); return React; }).apply({
    locale: { bind: () => key => key, register: () => () => {} },
    effect: fn => fn(),
    configForms: { get: () => scope },
    slots: {
      inject: (_name, fn) => fn(),
      register: (meta, render) => callbacks.set(meta.id ?? meta.name, render),
    },
  });
  return React.createElement(React.Fragment, null,
    callbacks.get("plugins.bundle.config")({}),
    callbacks.get("soul-md-persona")({ sessionId: "s1" }),
  );
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

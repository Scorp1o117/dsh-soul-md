import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../client.js", import.meta.url), "utf8");

function mountSwitcher(scope, surface = "soul-md-persona") {
  let bundle;
  const window = { __ModuleLoader__: { load(value) { bundle = value; } } };
  vm.runInNewContext(source, { window });

  const state = [];
  let cursor = 0;
  const react = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat() }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useEffect() {},
  };
  const callbacks = new Map();
  const plugin = bundle.factory((name) => {
    assert.equal(name, "react");
    return react;
  });
  plugin.apply({
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (fn) => fn(),
    configForms: { get: () => scope },
    slots: {
      inject: (_name, fn) => fn(),
      register: (meta, fn) => callbacks.set(meta.id ?? meta.name, fn),
    },
  });
  const element = callbacks.get(surface)({ sessionId: "s1" });
  return () => {
    cursor = 0;
    return element.type(element.props);
  };
}

function find(tree, type) {
  if (tree?.type === type) return tree;
  for (const child of tree?.children ?? []) {
    const match = find(child, type);
    if (match) return match;
  }
  return null;
}

test("session switcher reports a refused write, rolls back, and blocks another choice while pending", async () => {
  const snapshot = {
    status: "ready", revision: 1,
    value: { cards: { A: "one", B: "two" }, sessions: { s1: "A" } },
  };
  let settle;
  let writes = 0;
  const scope = {
    getSnapshot: () => snapshot,
    mutate() { writes++; return new Promise((resolve) => { settle = resolve; }); },
  };
  const render = mountSwitcher(scope);
  find(render(), "select").props.onChange({ target: { value: "B" } });
  const pending = render();
  assert.equal(find(pending, "select").props.disabled, true);
  find(pending, "select").props.onChange({ target: { value: "A" } });
  assert.equal(writes, 1);

  settle();
  await new Promise((resolve) => setImmediate(resolve));
  const settled = render();
  assert.equal(find(settled, "select").props.value, "A");
  assert.equal(find(settled, "select").props.disabled, false);
  assert.match(settled.children.at(-1).children.join(" "), /notApplied/);
});

function allNodes(tree) {
  return [tree, ...(tree?.children ?? []).flatMap(allNodes)].filter((node) => node && typeof node === "object");
}

test("recall selectors and recovery toggle save through one revision fence and survive remount", async () => {
  const snapshot = { status: "ready", writable: true, revision: 1, value: {
    cards: {}, memory: { inject: true, layered: true, recall: "off", indexMode: "all", compactionRecall: false, hiddenSetting: "preserve" },
  } };
  let calls = 0;
  const scope = {
    getSnapshot: () => snapshot,
    async mutate(ops, revision) {
      assert.equal(revision, snapshot.revision);
      calls++;
      for (const op of ops) snapshot.value[op.path[0]] = op.value;
      snapshot.revision++;
      return true;
    },
  };
  const render = mountSwitcher(scope, "plugins.bundle.config");
  const field = (key) => allNodes(render()).find((node) => node.props?.key === key);
  const control = (key) => allNodes(field(key)).find((node) => node.type === "select" || node.type === "input");
  control("recall").props.onChange({ target: { value: "keyword" } });
  control("indexMode").props.onChange({ target: { value: "recall" } });
  control("compactionRecall").props.onChange({ target: { checked: true } });
  control("recallMaxTopics").props.onChange({ target: { value: "3" } });
  const save = () => allNodes(render()).filter((node) => node.type === "button" && node.children.includes("save")).at(-1);
  save().props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(snapshot.value.memory.recall, "keyword");
  assert.equal(snapshot.value.memory.indexMode, "recall");
  assert.equal(snapshot.value.memory.compactionRecall, true);
  assert.equal(snapshot.value.memory.recallMaxTopics, 3);
  assert.equal(snapshot.value.memory.hiddenSetting, "preserve");
  const remounted = mountSwitcher(scope, "plugins.bundle.config");
  const nodes = allNodes(remounted());
  assert.ok(nodes.some((node) => node.type === "select" && node.props.value === "keyword"));
  assert.ok(nodes.some((node) => node.type === "select" && node.props.value === "recall"));
  control("compactionRecall").props.onChange({ target: { checked: false } });
  save().props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshot.value.memory.compactionRecall, false);
  control("recallMaxTopics").props.onChange({ target: { value: "21" } });
  save().props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2, "invalid result limit must not be sent to the host");
});

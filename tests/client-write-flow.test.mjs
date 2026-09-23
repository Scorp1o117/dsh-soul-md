import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../client.js", import.meta.url), "utf8");

function mountSwitcher(scope) {
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
    settingsScope: { bind: () => scope },
    slots: {
      inject: (_name, fn) => fn(),
      register: (meta, fn) => callbacks.set(meta.id, fn),
    },
  });
  const element = callbacks.get("soul-md-persona")({ sessionId: "s1" });
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

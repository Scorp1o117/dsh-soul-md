import assert from "node:assert/strict";
import test from "node:test";
import { isDelegatedChild, skipsSubagentSections } from "../subagents.js";

test("only headers stamped origin:subagent count as delegated children", () => {
  assert.equal(isDelegatedChild({ session: { header: { origin: "subagent" } } }), true);
  assert.equal(isDelegatedChild({ session: { header: { origin: "user" } } }), false);
  assert.equal(isDelegatedChild({ session: { header: {} } }), false);
  assert.equal(isDelegatedChild({ session: {} }), false);
  assert.equal(isDelegatedChild({}), false);
  assert.equal(isDelegatedChild(undefined), false);
  assert.equal(
    isDelegatedChild({
      get session() {
        throw new Error("header not readable");
      },
    }),
    false,
  );
});

test("skipping subagent sections requires the opt-in switch", () => {
  const child = { session: { header: { origin: "subagent" } } };
  const parent = { session: { header: { origin: "user" } } };

  assert.equal(skipsSubagentSections({}, child), false);
  assert.equal(skipsSubagentSections({ skipSubagents: false }, child), false);
  assert.equal(skipsSubagentSections({ skipSubagents: true }, child), true);
  assert.equal(skipsSubagentSections({ skipSubagents: true }, parent), false);
  assert.equal(skipsSubagentSections({ skipSubagents: true }, undefined), false);
  assert.equal(skipsSubagentSections(undefined, child), false);
});

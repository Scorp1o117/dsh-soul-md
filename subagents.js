/**
 * Delegated-child helpers for the persona/memory sections.
 *
 * DSH stamps a delegated child session with `origin: "subagent"` on its session
 * header at creation. That is all this module needs: when the user opts in
 * (`skipSubagents`), the persona and memory sections render empty for children,
 * so a child that only does one small job does not carry the parent's card and
 * long-term memory every turn.
 *
 * Only the RENDER path is gated. Card resolution and the memory read/write
 * targets are untouched, so a child's `soul_*` / `memory_*` tools keep hitting
 * the same card and scope they would otherwise.
 */

/** True when this agent belongs to a delegated child session. */
function isDelegatedChild(agent) {
  try {
    return agent?.session?.header?.origin === "subagent";
  } catch {
    return false;
  }
}

/** Opt-in gate: should the persona/memory sections be skipped for this agent? */
function skipsSubagentSections(config, agent) {
  return Boolean(config?.skipSubagents) && isDelegatedChild(agent);
}

export { isDelegatedChild, skipsSubagentSections };

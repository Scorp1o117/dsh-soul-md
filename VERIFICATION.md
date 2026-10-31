
## 2026-10-17: 0.10.1, DSH 0.2.1-rc.1

- Full npm test command passed in a fresh npm dependency tree using the published DSH 0.2.1-rc.1 packages (42 Node test-runner cases, plus any script assertions). No skipped test-runner cases.
- Packed package installed with the official DSH CLI into an isolated Web profile. Configuration composition succeeded; the Web service started and authenticated HTTP returned 200. All six plugin bundles appeared enabled in the running UI.
- engines.dsh and every DSH peer range accept 0.2.0-rc.2 and 0.2.1-rc.1; unverified 0.2.1 alpha releases remain excluded.
- Reasoning page was opened, left, reopened, edited, saved, and refreshed. The saved value persisted and automatic reasoning augmentation remained off. Backend regressions cover repeated reconciliation after native removal, explicit opt-in, preserved custom declarations, and gateway-only writes.
- New packaged Desktop 0.2.1 was not exercised; these results verify Web. Motion UI was excluded from the adaptation.

## 2026-10-17: 0.10.2, DSH 0.2.1-rc.2

- Full npm test passed in fresh dependencies using published DSH 0.2.1-rc.2 packages: 42 Node test-runner cases plus script assertions, with no failed or skipped cases.
- Official CLI installed the packed plugins in an isolated Web profile. Configuration composition, service startup and authenticated HTTP 200 passed.
- engines.dsh and DSH peer ranges accept 0.2.0-rc.2, 0.2.1-rc.1 and 0.2.1-rc.2, while unverified alpha releases remain excluded.
- Source comparison found no change to the tool, system-prompt, settings or pi-ai interfaces used by these plugins. Native reasoning settings retain the opt-in augmentation policy.
- This verification covers Web. Motion UI and the Desktop application are handled separately. No real-model generation was requested.

## 2026-10-24: 0.10.3, DSH 0.2.1-rc.3

- Full npm test passed in fresh dependencies using published DSH 0.2.1-rc.3 packages: 42 Node test-runner cases plus script assertions, with no failed or skipped cases.
- Official CLI installed the packed plugin in an isolated Web profile built from the shipped web template. Configuration composition, service startup and authenticated HTTP 200 passed.
- engines.dsh and DSH peer ranges accept 0.2.0-rc.2, 0.2.1-rc.1, 0.2.1-rc.2 and 0.2.1-rc.3, while unverified alpha releases remain excluded.
- Source comparison of dsh-v0.2.1-rc.2...dsh-v0.2.1-rc.3 found no change to the tool, system-prompt, settings or pi-ai interfaces used by this plugin; the removed ctx.layout.entryVisibility and agentPresetNavigation APIs were not in use.
- This verification covers Web. The Desktop application was not exercised. No real-model generation was requested.

## 2026-10-31: DSH 0.2.1-rc.4 / rc.5 (local, unreleased)

- `npm test` passed. The directly declared DSH development SDKs resolve to 0.2.1-rc.5.
- Local package tarballs for all seven plugins installed into separate isolated Web profiles built from the official rc.4 and rc.5 templates. Each host started, served the authenticated Web UI, and showed all seven plugin pages as running without browser page exceptions.
- DSH rc.3→rc.5 source comparison found a changed reasoning Body slot, which these plugins do not use. DSH compatibility and SDK peer ranges accept rc.4 and rc.5 while retaining prior declared versions; 0.2.2-alpha.2 is not claimed.
- Issue #15: the header selector defaults to visible and can be hidden or restored in settings. React tests cover live updates, persistence across remounts, existing session choices, pending writes, and rejected writes; the settings switch was also hidden, reloaded, and restored in both rc.4 and rc.5 Web hosts.
- Native Desktop, external model calls, publication, and deployment were not exercised.

## 2026-10-31: 0.10.5, new-session persona selection

- The full `npm test` suite passed: 54 cases across the three Node test-runner invocations. Coverage includes both selectors, shared visibility, concurrent writes, failed saves, composer-block ownership, workspace/session changes, and first-prompt persona priority.
- The packed plugin was installed with the official CLI into isolated Web profiles using DSH 0.2.1-rc.4 and 0.2.1-rc.5. In both hosts, browser checks created a persona, selected it on the new-session page, switched between two workspaces with independent session selections, changed the Agent preset, and hid and restored the selectors. A delayed settings request kept the composer disabled until the save completed; the layout was also checked at a 640 px viewport.
- The 0.2.0-rc.2 Web host loaded the packed plugin, saved a card, and switched the visibility setting off and on without browser exceptions. That host does not declare the new-session slot; the existing header registration remains in place.
- These checks did not exercise native Desktop or send a real model request.

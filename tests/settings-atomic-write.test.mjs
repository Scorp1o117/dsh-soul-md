import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('one scope serves the namespace, not one per surface', () => {
  // The settings section and the conversation-header persona switcher both write
  // `soul-md`. Two binds meant two controllers over one Host document, each with
  // its own `pendingRevision` and write queue, so a write from one surface could
  // fence against a revision the other had already superseded — the Host refuses
  // the stale write and the scope still settles it as success.
  const binds = clientSource.match(/ctx\.settingsScope\.bind\(/g) ?? [];
  assert.equal(binds.length, 1, `expected a single bind, found ${binds.length}`);
  assert.match(clientSource, /var scope = ctx\.settingsScope\.bind\(\{ namespace: "soul-md" \}\)/);
  assert.match(clientSource, /\{ scope: scope \}/);
  assert.match(clientSource, /\{ scope: scope, t: t \}/);
});

test('no component writes through an unverified path', () => {
  // Parallel set()/unset() calls each carry their own revision fence, and a
  // refused write still resolves — so the UI could report success while the edit
  // reverted. The only place set()/unset() may appear is the sequential fallback
  // inside commitSettingsOps, for hosts whose scope has no mutate().
  const helper = /function commitSettingsOps\(scope, ops\) \{[\s\S]*?\n    \}/.exec(clientSource);
  assert.ok(helper, 'commitSettingsOps not found');
  const outsideHelper = clientSource.replace(helper[0], '');

  for (const [label, pattern] of [['Promise.all', /Promise\.all/g], ['scope.set(', /scope\.set\(/g], ['scope.unset(', /scope\.unset\(/g]]) {
    const hits = outsideHelper.match(pattern) ?? [];
    assert.equal(hits.length, 0, `${label} outside the fallback: ${hits.length}`);
  }
});

test('every mutation is verified against the namespace section', () => {
  assert.match(clientSource, /function settingsOpsApplied\(snapshot, ops\)/);
  assert.match(clientSource, /return settingsOpsApplied\(scope\.getSnapshot\(\), ops\)/);
  assert.match(clientSource, /t\("notApplied"\)/);
  // the guarded refresh was dead code: the scope's public seam has no load()
  const guards = clientSource.match(/typeof scope\.load === "function"/g) ?? [];
  assert.equal(guards.length, 0, `dead load() guards remain: ${guards.length}`);
});

test('deleting the active card batches both edits into one fence', () => {
  // `cards` and `active` must move together: as two independent writes the second
  // could be refused for a revision the first had just superseded.
  assert.match(clientSource, /if \(name === active\) ops\.push\(\{ op: "unset", path: \["active"\] \}\)/);
  assert.match(clientSource, /op: "unset", path: \["active"\] \}\]\)/);
});

test('hosts without mutate() fall back to sequential writes', () => {
  assert.match(clientSource, /typeof scope\.mutate === "function"/);
  assert.match(clientSource, /ops\.reduce\(function \(chain, op\)/);
});

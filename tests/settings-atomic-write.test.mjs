import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8');

test('one scope serves the namespace, not one per surface', () => {
  // The settings section and the conversation-header persona switcher both write
  // `soul-md`. Two binds meant two controllers over one Host document, each with
  // its own `pendingRevision` and write queue, so a write from one surface could
  // fence against a revision the other had already superseded — the Host refuses
  // the stale write and the scope still settles it as success.
  const binds = clientSource.match(/ctx\.configForms\.get\(/g) ?? [];
  assert.equal(binds.length, 1, `expected a single bind, found ${binds.length}`);
  assert.match(clientSource, /var scope = ctx\.configForms\.get\("soul-md"\)/);
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

test('drafts follow the settings snapshot again after a save or a refused write', () => {
  // A draft wins over the snapshot while it holds a value, so a draft that
  // outlives its own save shadows the live settings for the rest of the page's
  // life: save `true` here, another tab saves `false`, and this page still shows
  // `true` -- and writes that stale `true` back on the next save, whatever else
  // that save was for. The same held for every memory field. A write the Host
  // refused reloaded the form and said so, yet both drafts survived all the
  // same. Success and refusal now hand the fields back to the snapshot, and the
  // snapshot itself is read back before that split: the component's copy only
  // catches up when the Host pushes `settings/document-updated`, which can land
  // after this frame, so the form would have shown pre-write values under a
  // "saved" notice.
  //
  // This is a regression guard over source text, the way every client test here
  // works -- it keeps the hand-back points from being deleted, it does not run a
  // React render. Asserting the transitions themselves would mean lifting "a
  // write settled, what do the drafts become?" out of the component into a pure
  // function, a larger change than the fix asked for.
  const refused = /if \(!ok\) \{[\s\S]*?\n          \}/.exec(clientSource);
  assert.ok(refused, 'the refused-write branch was not found');
  assert.match(refused[0], /setMemDraft\(function \(\) \{ return \{\}; \}\);/);
  assert.match(refused[0], /setSkipDraft\(null\);/);
  const saved = /runWrite\(ops, function \(\) \{ (.*) \}\);/.exec(clientSource);
  assert.ok(saved, 'the save-success callback was not found');
  assert.match(saved[1], /setMemDraft\(function \(\) \{ return \{\}; \}\);/);
  assert.match(saved[1], /setSkipDraft\(null\);/);
  const settled = /\.then\(function \(ok\) \{([\s\S]*?)\n        \}\)/.exec(clientSource);
  assert.ok(settled, 'the settled-write handler was not found');
  const readBack = settled[1].indexOf('setSnapshot(scope.getSnapshot());');
  assert.ok(readBack >= 0, 'the handler never reads the snapshot back');
  assert.ok(readBack < settled[1].indexOf('if (!ok)'),
    'the snapshot has to come back before the split, so both outcomes get it');
});

test('projected memory defaults do not cause a false write rejection', () => {
  const helper = /function settingsOpsApplied\(snapshot, ops\) \{[\s\S]*?\n    \}/.exec(clientSource);
  assert.ok(helper);
  const applied = vm.runInNewContext(`(${helper[0]})`);
  const snapshot = { status: 'ready', value: { memory: {
    maxBytes: 1048576, inject: true, layered: true, injectMaxChars: 15999,
    order: 0.5, path: 'legacy.md', workspaceFile: 'workspace.md',
  } } };
  const ops = [{ op: 'set', path: ['memory'], value: {
    inject: true, layered: true, injectMaxChars: 15999, maxBytes: 1048576,
  } }];
  assert.equal(applied(snapshot, ops), true);
  snapshot.value.memory.injectMaxChars = 16000;
  assert.equal(applied(snapshot, ops), false);
});

test('memory saves preserve hidden fields and a refused write preserves the card draft', () => {
  assert.match(clientSource, /Object\.assign\(\{\}, value\.memory \|\| \{\}, next\)/);
  const refused = /if \(!ok\) \{[\s\S]*?\n          \}/.exec(clientSource);
  assert.ok(refused);
  assert.doesNotMatch(refused[0], /setCardDraft/);
  assert.match(clientSource, /String\(cur\)\.trim\(\) === ""/);
  assert.match(clientSource, /number < 1/);
});

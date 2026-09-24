import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("manifest records the verified latest and next hosts and keeps alpha unclaimed", () => {
  assert.equal(manifest.dsh.compatibility.dshReleases["0.1.5-rc.2"], "incompatible");
  assert.equal(manifest.dsh.compatibility.dshReleases["0.1.5-rc.3"], "incompatible");
  assert.equal(manifest.dsh.compatibility.dshReleases["0.1.7-rc.1"], "compatible");
  assert.equal(manifest.dsh.compatibility.dshReleases["0.1.6-alpha.1"], "unknown");
  assert.equal(manifest.dsh.compatibility.dshReleases["0.1.6-alpha.2"], "unknown");
  assert.equal(manifest.dsh.compatibility.dshReleases["0.1.7-alpha.1"], "unknown");
  assert.equal(manifest.dsh.compatibility.dshReleases["0.1.7-alpha.2"], "unknown");
  assert.equal(manifest.dsh.compatibility.node, manifest.engines.node);
  assert.deepEqual(manifest.dsh.compatibility.profiles, ["web"]);
});

test("next host seams are pinned for repeatable development tests", () => {
  for (const name of [
    "@deepseek-ai/dsh-home-paths",
    "@deepseek-ai/dsh-settings",
    "@deepseek-ai/dsh-tools",
  ]) {
    assert.equal(manifest.devDependencies[name], "0.1.7-rc.1");
    assert.equal(manifest.peerDependencies[name], "^0.1.7-rc.1");
  }
});

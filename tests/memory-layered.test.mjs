import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMemoryLayout, renderTopicIndex, safeMemoryName, topicDescriptor } from "../memory-layout.js";

const readText = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

test("topic metadata uses the first heading and first body line", () => {
  assert.deepEqual(topicDescriptor("fallback", "# Project A\n\nKeeps the launch checklist.\nMore."), {
    key: "fallback",
    title: "Project A",
    summary: "Keeps the launch checklist.",
  });
  assert.equal(safeMemoryName("a/b:*?"), "a_b___");
  assert.match(renderTopicIndex([{ key: "project-a", title: "Project A", summary: "Launch notes" }]), /memory_read\(topic\)/);
});

test("topic titles and summaries stay bounded without collapsing shared prefixes", () => {
  const prefix = "长".repeat(80);
  const a = topicDescriptor("a", `# ${prefix}A\n${prefix}B${"s".repeat(300)}`);
  const b = topicDescriptor("b", `# ${prefix}B\n${prefix}A`);
  assert.equal(a.title.length, 80);
  assert.equal(a.summary.length, 240);
  const index = renderTopicIndex([a, b]);
  assert.ok(index.includes(`- \`a\` — ${prefix}：${a.summary}`));
  assert.ok(index.includes(`- \`b\` — ${prefix}：${b.summary}`));
  assert.equal(renderTopicIndex([topicDescriptor("same", "# Short\nShort")]).split("\n").at(-1), "- `same` — Short");
});

test("core aliases route both reads and writes to resident memory, preserving old topic files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dsh-soul-md-core-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = createMemoryLayout(root, readText);
  await mkdir(join(root, "D", "topics"), { recursive: true });
  await writeFile(layout.coreFile("D"), "resident", "utf8");
  await writeFile(layout.topicFile("D", "core"), "old accidental topic", "utf8");
  for (const topic of ["core", "core.md", " CORE.MD ", "core."]) {
    const target = layout.writeTarget("D", { layered: true, topic });
    assert.equal(target.file, layout.coreFile("D"));
    assert.equal(target.topic, "");
    assert.equal(target.legacySeed, layout.legacyFile("D"));
    const read = layout.readChain(["D", "global"], { layered: true, topic });
    assert.equal(read.text, "resident");
    assert.equal(read.file, target.file);
    assert.match(read.index, /`core`/);
  }
  assert.equal(readText(layout.topicFile("D", "core")), "old accidental topic");
  assert.equal(layout.writeTarget("D", { layered: true, topic: "core-notes" }).topic, "core-notes");
});

test("layered memory injects core plus topic index and reads topics on demand", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dsh-soul-md-layered-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = createMemoryLayout(root, readText);

  await mkdir(join(root, "Ada", "topics"), { recursive: true });
  await writeFile(join(root, "Ada", "core.md"), "# Core\n\nAlways visible.", "utf8");
  await writeFile(join(root, "Ada", "topics", "project-z.md"), "# Project Z\n\nRelease checklist and decisions.", "utf8");
  await writeFile(join(root, "Ada", "topics", "people.md"), "# People\n\nNames and working preferences.", "utf8");

  const overview = layout.readChain(["Ada", "global"], { layered: true });
  assert.equal(overview.text, "# Core\n\nAlways visible.");
  assert.deepEqual(overview.topics.map((entry) => entry.key), ["people", "project-z"]);
  assert.match(overview.index, /`project-z` — Project Z：Release checklist and decisions\./);

  const topic = layout.readChain(["Ada", "global"], { layered: true, topic: "project-z" });
  assert.equal(topic.exists, true);
  assert.equal(topic.source, "Ada");
  assert.equal(topic.text, "# Project Z\n\nRelease checklist and decisions.");
});

test("enabling layered mode can read and seed the legacy single file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dsh-soul-md-legacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = createMemoryLayout(root, readText);
  await writeFile(join(root, "Ada.md"), "legacy memory", "utf8");

  const overview = layout.readChain(["Ada", "global"], { layered: true });
  assert.equal(overview.exists, true);
  assert.equal(overview.text, "legacy memory");
  assert.equal(overview.inheritedLegacy, true);

  const target = layout.writeTarget("Ada", { layered: true });
  assert.equal(target.file, join(root, "Ada", "core.md"));
  assert.equal(target.legacySeed, join(root, "Ada.md"));

  const legacyMode = layout.readChain(["Ada", "global"], { layered: false });
  assert.equal(legacyMode.text, "legacy memory");
  assert.deepEqual(legacyMode.topics, []);
});

test("a missing card topic falls back to the global topic", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dsh-soul-md-fallback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = createMemoryLayout(root, readText);
  await mkdir(join(root, "global", "topics"), { recursive: true });
  await writeFile(join(root, "global", "topics", "shared.md"), "global topic", "utf8");

  const value = layout.readChain(["Ada", "global"], { layered: true, topic: "shared" });
  assert.equal(value.exists, true);
  assert.equal(value.source, "global");
  assert.equal(value.text, "global topic");
});

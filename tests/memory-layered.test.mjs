import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMemoryLayout, renderTopicIndex, safeMemoryName, stripTopicIndex, topicDescriptor } from "../memory-layout.js";

const readText = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

test("an injected topic index is stripped from stored text, never from a fenced example", () => {
  const index = renderTopicIndex([{ key: "project-z", title: "Project Z", summary: "Release notes" }]);
  const body = "# Core\n\nresident memory";

  assert.deepEqual(stripTopicIndex(body), { text: body, stripped: "" });
  const snapshot = stripTopicIndex(`${body}\n\n${index}`);
  assert.equal(snapshot.text, body);
  assert.equal(snapshot.stripped, index);
  // Writing the already-stripped body back is idempotent: no index, no growth.
  assert.deepEqual(stripTopicIndex(snapshot.text), { text: body, stripped: "" });

  // A heading inside a code fence is documentation, not a rendered index.
  const fenced = `${body}\n\n\`\`\`md\n${index}\n\`\`\`\n\nTrailing note.`;
  assert.deepEqual(stripTopicIndex(fenced), { text: fenced, stripped: "" });
  // A later real index after that fenced example is still removed.
  assert.equal(stripTopicIndex(`${fenced}\n\n${index}`).text, fenced);

  // Windows line endings and a trailing space on the heading keep working.
  const crlf = `${body}\r\n\r\n## 主题记忆索引 / Topic memory index \r\n- \`a\` — A`;
  assert.equal(stripTopicIndex(crlf).text, body);
});

test("a layered read reports the topic index apart from the core body", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dsh-soul-md-split-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = createMemoryLayout(root, readText);
  await mkdir(join(root, "Ada", "topics"), { recursive: true });
  await writeFile(layout.coreFile("Ada"), "# Core\n\nAlways visible.", "utf8");
  await writeFile(join(root, "Ada", "topics", "people.md"), "# People\n\nNames.", "utf8");

  const overview = layout.readChain(["Ada"], { layered: true });
  assert.equal(overview.text, "# Core\n\nAlways visible.");
  assert.doesNotMatch(overview.text, /主题记忆索引/);
  assert.match(overview.index, /`people` — People/);
  assert.equal(overview.embeddedIndex, "");

  // A core polluted by an older release reads back as its body alone.
  const index = renderTopicIndex(overview.topics);
  await writeFile(layout.coreFile("Ada"), `# Core\n\nAlways visible.\n\n${index}`, "utf8");
  const healed = layout.readChain(["Ada"], { layered: true });
  assert.equal(healed.text, "# Core\n\nAlways visible.");
  assert.equal(healed.embeddedIndex, index);
});

test("consolidated topic metadata uses the first heading and first body line", () => {
  assert.deepEqual(topicDescriptor("fallback", "# Project A\n\nKeeps the launch checklist.\nMore."), {
    key: "fallback",
    title: "Project A",
    summary: "Keeps the launch checklist.",
  });
  assert.equal(safeMemoryName("a/b:*?"), "a_b___");
  assert.match(renderTopicIndex([{ key: "project-a", title: "Project A", summary: "Launch notes" }]), /memory_read\(topic\)/);
});

test("topic metadata uses the last dated entry and keeps its summary within that entry", () => {
  const entries = [
    "# PowerShell", "Use Windows PowerShell 5.1.",
    "## 2026-10-08 — Initial test", "PowerShell 7.6.6 is installed.",
    "## 2026-11-07 09:30 — Updated guidance", "- Default to pwsh 7.6.9.",
    "```md", "## 2026-11-08 — Example only", "```",
    "<!--", "## 2026-11-09 — Comment only", "-->",
  ];
  assert.deepEqual(topicDescriptor("powershell", entries.join("\r\n")), {
    key: "powershell",
    title: "2026-11-07 09:30 — Updated guidance",
    summary: "Default to pwsh 7.6.9.",
  });
  entries.push("## 2026-11-10 — Performance", "# Incident", "## Symptoms", "### 2026-10-08 — History", "- Updated guidance.");
  assert.deepEqual(topicDescriptor("powershell", entries.join("\n")), {
    key: "powershell",
    title: "2026-11-10 — Performance",
    summary: "Updated guidance.",
  });
  entries.push("## 2026-11-11 — Heading only", "## Notes", "<!-- No body yet -->");
  assert.deepEqual(topicDescriptor("powershell", entries.join("\n")), {
    key: "powershell",
    title: "2026-11-11 — Heading only",
    summary: "（无摘要 / no summary）",
  });
  assert.deepEqual(topicDescriptor("powershell", [
    "# PowerShell", "> Default to pwsh 7.6.9.", "## History", "### 2026-10-08 — Old", "Old guidance.",
  ].join("\n")), { key: "powershell", title: "PowerShell", summary: "Default to pwsh 7.6.9." });
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

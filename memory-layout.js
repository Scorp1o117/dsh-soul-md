import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

/** Keep user-facing card/topic names inside one managed path segment. */
function safeMemoryName(value, fallback = "memory") {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 64) || fallback;
}

function topicDescriptor(key, text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line.trim()));
  const title = heading ? heading.trim().replace(/^#{1,6}\s+/, "").trim() : key;
  const summaryLine = lines.find((line) => {
    const value = line.trim();
    return value && !/^#{1,6}\s+/.test(value) && !/^<!--/.test(value);
  });
  const summary = summaryLine
    ? summaryLine.trim().replace(/^[-*>]\s*/, "").replace(/\s+/g, " ").slice(0, 240)
    : "（无摘要 / no summary）";
  return { key, title, summary };
}

function renderTopicIndex(topics) {
  if (!topics.length) return "";
  const rows = topics.map(({ key, title, summary }) =>
    `- \`${key}\` — ${title}${summary === title ? "" : `：${summary}`}`);
  return [
    "## 主题记忆索引 / Topic memory index",
    "用 memory_read 的 topic 参数按需读取全文 / Use memory_read(topic) for full text.",
    "",
    ...rows,
  ].join("\n");
}

/**
 * Filesystem-backed memory layout. `readText` must return null for a missing
 * file; callers can provide an mtime cache without changing layout semantics.
 */
function createMemoryLayout(root, readText) {
  const memoryRoot = () => typeof root === "function" ? root() : root;
  const keyOf = (scope) => safeMemoryName(scope, "global");
  const legacyFile = (scope) => join(memoryRoot(), `${keyOf(scope)}.md`);
  const scopeDir = (scope) => join(memoryRoot(), keyOf(scope));
  const coreFile = (scope) => join(scopeDir(scope), "core.md");
  const topicsDir = (scope) => join(scopeDir(scope), "topics");
  const topicFile = (scope, topic) => join(topicsDir(scope), `${safeMemoryName(topic, "topic")}.md`);

  const listTopics = (scope) => {
    try {
      return readdirSync(topicsDir(scope), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
        .sort((a, b) => a.name.localeCompare(b.name, "en"))
        .flatMap((entry) => {
          const file = join(topicsDir(scope), entry.name);
          const text = readText(file);
          if (text === null) return [];
          const key = basename(entry.name, ".md");
          return [{ ...topicDescriptor(key, text), file }];
        });
    } catch {
      return [];
    }
  };

  const readLayeredScope = (scope) => {
    const primary = coreFile(scope);
    const legacy = legacyFile(scope);
    const primaryText = readText(primary);
    const legacyText = primaryText === null ? readText(legacy) : null;
    const topics = listTopics(scope);
    return {
      exists: primaryText !== null || legacyText !== null || topics.length > 0,
      text: primaryText ?? legacyText ?? "",
      source: scope,
      file: primaryText !== null ? primary : legacyText !== null ? legacy : primary,
      topics,
      index: renderTopicIndex(topics),
      inheritedLegacy: primaryText === null && legacyText !== null,
    };
  };

  const readChain = (scopes, { layered = false, topic = "" } = {}) => {
    const chain = [...new Set(scopes)];
    if (!layered) {
      for (const scope of chain) {
        const file = legacyFile(scope);
        const text = readText(file);
        if (text !== null) return { exists: true, text, source: scope, file, topics: [], index: "" };
      }
      const scope = chain[0] ?? "global";
      return { exists: false, text: "", source: scope, file: legacyFile(scope), topics: [], index: "" };
    }

    if (topic) {
      const key = safeMemoryName(topic, "topic");
      for (const scope of chain) {
        const file = topicFile(scope, key);
        const text = readText(file);
        if (text !== null) return { exists: true, text, source: scope, file, topic: key, topics: [], index: "" };
      }
      const scope = chain[0] ?? "global";
      return { exists: false, text: "", source: scope, file: topicFile(scope, key), topic: key, topics: [], index: "" };
    }

    for (const scope of chain) {
      const value = readLayeredScope(scope);
      if (value.exists) return value;
    }
    const scope = chain[0] ?? "global";
    return readLayeredScope(scope);
  };

  const writeTarget = (scope, { layered = false, topic = "" } = {}) => {
    if (!layered) return { file: legacyFile(scope), legacySeed: null, topic: "" };
    if (topic) {
      const key = safeMemoryName(topic, "topic");
      return { file: topicFile(scope, key), legacySeed: null, topic: key };
    }
    return { file: coreFile(scope), legacySeed: legacyFile(scope), topic: "" };
  };

  return { coreFile, legacyFile, listTopics, readChain, readLayeredScope, scopeDir, topicFile, writeTarget };
}

export { createMemoryLayout, renderTopicIndex, safeMemoryName, topicDescriptor };

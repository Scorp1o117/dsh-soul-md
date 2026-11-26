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
  let firstTitle;
  let firstBody;
  let latestEntry;
  let fence;
  let inComment = false;

  for (const line of String(text ?? "").split(/\r?\n/)) {
    const value = line.trim();
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (closing?.startsWith(fence)) fence = undefined;
      continue;
    }
    if (inComment || value.startsWith("<!--")) {
      inComment = !value.includes("-->");
      continue;
    }
    fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence || !value) continue;

    const heading = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/.exec(line.trimEnd());
    if (heading) {
      const [, marks, title] = heading;
      firstTitle ??= title;
      // Only the dated level-two headings written by memory_append delimit entries.
      if (marks.length === 2 && /^\d{4}-\d{2}-\d{2}(?=$|\s|[—–])/.test(title)) {
        latestEntry = { title, body: undefined };
      }
      continue;
    }

    firstBody ??= value;
    if (latestEntry) latestEntry.body ??= value;
  }

  const title = (latestEntry?.title ?? firstTitle ?? key).slice(0, 80);
  const summaryLine = latestEntry ? latestEntry.body : firstBody;
  const summary = summaryLine
    ? summaryLine.trim().replace(/^[-*>]\s*/, "").replace(/\s+/g, " ").slice(0, 240)
    : "（无摘要 / no summary）";
  return { key, title, summary };
}

/** Reserve core aliases after the same normalization used for topic paths. */
function normalizeMemoryTopic(value) {
  const topic = String(value ?? "").trim();
  if (!topic) return "";
  const key = safeMemoryName(topic, "topic");
  return /^(core|core\.md)$/i.test(key) ? "" : key;
}

/** Heading that starts an injected topic index; reserved for the render, never the file. */
const TOPIC_INDEX_HEADING = "## 主题记忆索引 / Topic memory index";

function renderTopicIndex(topics) {
  if (!topics.length) return "";
  const rows = topics.map(({ key, title, summary }) =>
    `- \`${key}\` — ${title}${summary === title ? "" : `：${summary}`}`);
  return [
    TOPIC_INDEX_HEADING,
    "用 memory_read 的 topic 参数按需读取全文 / Use memory_read(topic) for full text.",
    "",
    ...rows,
  ].join("\n");
}

/**
 * Remove an injected topic-index snapshot from stored text.
 *
 * `renderTopicIndex` renders the topics directory for the prompt; it is a view,
 * not file content. An agent that reads that view and writes it back froze a
 * stale snapshot into core.md, which the next assembly then rendered beside the
 * live index. The snapshot always starts at an exact heading line outside a
 * code fence, so that heading ends the file body.
 * @param text - stored memory text, as read from disk.
 * @returns the body before the first index heading, and the removed tail.
 */
function stripTopicIndex(text) {
  const value = String(text ?? "");
  if (!value.includes(TOPIC_INDEX_HEADING)) return { text: value, stripped: "" };
  let fence;
  let offset = 0;
  while (offset <= value.length) {
    const newline = value.indexOf("\n", offset);
    const end = newline === -1 ? value.length : newline;
    const line = value.slice(offset, end).replace(/\r$/, "");
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (closing?.startsWith(fence)) fence = undefined;
    } else {
      const opened = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (opened) fence = opened;
      else if (line.trim() === TOPIC_INDEX_HEADING) {
        return {
          text: value.slice(0, offset).replace(/[\s\uFEFF]+$/, ""),
          stripped: value.slice(offset),
        };
      }
    }
    if (newline === -1) break;
    offset = newline + 1;
  }
  return { text: value, stripped: "" };
}

/** Preserve both old context and recent appends within a character budget. */
function retainMemoryEnds(text, cap) {
  const value = String(text ?? "");
  const limit = Math.max(0, Math.floor(cap));
  if (value.length <= limit) return value;
  if (!limit) return "";
  const separator = "\n…\n";
  if (limit <= separator.length) return value.slice(-limit);
  const contentCap = limit - separator.length;
  const headLength = Math.ceil(contentCap / 2);
  const tailLength = contentCap - headLength;
  return value.slice(0, headLength) + separator + (tailLength ? value.slice(-tailLength) : "");
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
    // The stored core may still carry an index snapshot written by an older
    // release; drop it here so every reader (injection, memory_read, append)
    // sees the body alone and the live index stays the only one.
    const body = stripTopicIndex(primaryText ?? legacyText ?? "");
    return {
      exists: primaryText !== null || legacyText !== null || topics.length > 0,
      text: body.text,
      embeddedIndex: body.stripped,
      source: scope,
      file: primaryText !== null ? primary : legacyText !== null ? legacy : primary,
      topics,
      index: renderTopicIndex(topics),
      inheritedLegacy: primaryText === null && legacyText !== null,
    };
  };

  const readChain = (scopes, { layered = false, topic = "" } = {}) => {
    topic = normalizeMemoryTopic(topic);
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
    topic = normalizeMemoryTopic(topic);
    if (!layered) return { file: legacyFile(scope), legacySeed: null, topic: "" };
    if (topic) {
      const key = safeMemoryName(topic, "topic");
      return { file: topicFile(scope, key), legacySeed: null, topic: key };
    }
    return { file: coreFile(scope), legacySeed: legacyFile(scope), topic: "" };
  };

  return { coreFile, legacyFile, listTopics, readChain, readLayeredScope, scopeDir, topicFile, writeTarget };
}

export { TOPIC_INDEX_HEADING, createMemoryLayout, normalizeMemoryTopic, renderTopicIndex, retainMemoryEnds, safeMemoryName, stripTopicIndex, topicDescriptor };

/** Local lexical search, deliberately not semantic retrieval or an LLM call. */
export function queryTerms(query) {
  const value = String(query ?? "").normalize("NFKC").toLowerCase().slice(0, 2000);
  const terms = new Set(value.match(/[\p{L}\p{N}_-]+/gu) ?? []);
  // Chinese text rarely has spaces: bigrams allow partial phrase matches.
  for (const run of value.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2));
  }
  return [...terms].filter((term) => term.length > 1).slice(0, 64);
}

export function boundedInteger(value, fallback, max) {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;
}

export function searchTopics(topics, query, readText, limit = 5) {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const fold = (text) => String(text).normalize("NFKC").toLowerCase();
  return topics.flatMap((topic) => {
    const body = readText(topic.file);
    if (body === null) return [];
    const label = fold(`${topic.key}\n${topic.title}`);
    const summary = fold(topic.summary);
    const content = fold(body);
    const score = terms.reduce((total, term) => total
      + (label.includes(term) ? 4 : 0)
      + (summary.includes(term) ? 2 : 0)
      + (content.includes(term) ? 1 : 0), 0);
    return score ? [{ key: topic.key, title: topic.title, summary: topic.summary, source: topic.source, score }] : [];
  }).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key, "en"))
    .slice(0, boundedInteger(limit, 5, 20));
}

/** Add complete descriptor rows only; never inject a topic body. */
export function renderRecall(groups, cap) {
  const lines = [];
  for (const { heading, topics } of groups) {
    const rows = [];
    for (const { key, title, summary } of topics) {
      const row = `- ${JSON.stringify(key)} — ${title}：${summary}`;
      if ([...lines, heading, ...rows, row].join("\n").length > cap) continue;
      rows.push(row);
    }
    if (rows.length) lines.push(heading, ...rows);
  }
  return lines.join("\n");
}

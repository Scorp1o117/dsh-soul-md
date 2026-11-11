import test from "node:test";
import assert from "node:assert/strict";
import { digestContentToText, parseDigestOutput, renderDigestTranscript } from "../digest.js";

const limits = (over = {}) => ({ maxMessages: 40, maxCharsPerMessage: 4000, maxTranscriptChars: 12000, ...over });

test("contentToText handles string, text blocks, tool calls and junk", () => {
  assert.equal(digestContentToText("plain"), "plain");
  assert.equal(digestContentToText([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb");
  assert.equal(digestContentToText([{ type: "tool_use", name: "memory_search" }]), "[tool memory_search]");
  assert.equal(digestContentToText([{ type: "tool_call", name: "bash" }]), "[tool bash]");
  assert.equal(digestContentToText({ text: "obj" }), "obj");
  assert.equal(digestContentToText(null), "");
  assert.equal(digestContentToText([null, 42, { type: "thinking" }]), "");
});

test("renderDigestTranscript keeps only the tail window and skips empty messages", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "too-old" }] },
    { role: "assistant", content: [{ type: "text", text: "" }] },
    { role: "user", content: "plain string" },
    { role: "assistant", content: [{ type: "tool_call", name: "memory_search" }] },
  ];
  const out = renderDigestTranscript(messages, limits({ maxMessages: 3 }));
  assert.ok(out.includes("### user\nplain string"));
  assert.ok(out.includes("[tool memory_search]"));
  assert.ok(!out.includes("too-old"), "messages outside the tail window must be dropped");
});

test("renderDigestTranscript truncates a single oversized message", () => {
  const out = renderDigestTranscript([{ role: "user", content: "x".repeat(50) }], limits({ maxCharsPerMessage: 10 }));
  assert.ok(out.includes("xxxxxxxxxx…"));
  assert.ok(!out.includes("x".repeat(11)), "per-message cap must hold");
});

test("renderDigestTranscript caps the whole transcript and keeps its tail", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `m${i}-` + "y".repeat(20) }));
  const out = renderDigestTranscript(messages, limits({ maxMessages: 30, maxTranscriptChars: 80 }));
  assert.ok(out.length <= 80);
  assert.ok(out.includes("m29"), "the newest message survives truncation");
  assert.ok(!out.includes("m0-"), "the oldest message is dropped first");
});

test("renderDigestTranscript tolerates messages without a role", () => {
  const out = renderDigestTranscript([{ content: "no role" }], limits());
  assert.ok(out.startsWith("### unknown"));
});

test("parseDigestOutput reads a clean JSON object", () => {
  const r = parseDigestOutput(JSON.stringify({
    candidates: [{ action: "append", topic: "asr-local", section: "端口", content: "8000", reason: "why", evidence: "ev" }],
    note: "ok",
  }));
  assert.equal(r.candidates.length, 1);
  assert.deepEqual(r.candidates[0], {
    action: "append", topic: "asr-local", section: "端口", content: "8000", reason: "why", evidence: "ev",
  });
  assert.equal(r.note, "ok");
});

test("parseDigestOutput strips a code fence", () => {
  const r = parseDigestOutput('```json\n{"candidates":[]}\n```');
  assert.deepEqual(r.candidates, []);
});

test("parseDigestOutput ignores prose around the JSON", () => {
  const r = parseDigestOutput('结果如下：\n{"candidates":[{"action":"delete","topic":"old"}]}\n以上。');
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].action, "delete");
});

test("parseDigestOutput reports malformed JSON instead of throwing", () => {
  const r = parseDigestOutput('{"candidates": [oops]}');
  assert.deepEqual(r.candidates, []);
  assert.ok(r.note.includes("解析失败"));
  assert.ok(r.raw.length > 0);
});

test("parseDigestOutput reports a truncated JSON object", () => {
  const r = parseDigestOutput('{"candidates":[');
  assert.deepEqual(r.candidates, []);
  assert.ok(r.note.includes("没有完整的 JSON 对象"));
  assert.ok(r.raw.length > 0);
});

test("parseDigestOutput reports a non-JSON reply", () => {
  const r = parseDigestOutput("这轮没什么要记的");
  assert.deepEqual(r.candidates, []);
  assert.ok(r.note.includes("没有完整的 JSON 对象"));
  assert.ok(r.raw.length > 0);
});

test("parseDigestOutput treats an empty reply as empty, not an error", () => {
  const r = parseDigestOutput("");
  assert.deepEqual(r.candidates, []);
  assert.ok(r.note.includes("没有产出"));
});

test("parseDigestOutput drops unknown actions and defaults topic to core", () => {
  const r = parseDigestOutput(JSON.stringify({
    candidates: [{ action: "SKILL", topic: "x" }, { action: "delete" }, null, "junk"],
  }));
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].action, "delete");
  assert.equal(r.candidates[0].topic, "core");
  assert.equal(r.candidates[0].content, "");
});

test("parseDigestOutput tolerates a candidates field of the wrong type", () => {
  const r = parseDigestOutput('{"candidates":"nope"}');
  assert.deepEqual(r.candidates, []);
});

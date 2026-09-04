import test from "node:test";
import assert from "node:assert/strict";
import {
  callGeminiWithRetry,
  InvalidGeminiResponseError,
  normalizeGeminiError,
  parseJsonObject,
  shouldRetry,
} from "../api/_lib/gemini.js";
import { sanitizeChatMessages } from "../api/_lib/helpChat.js";

const quietLogger = {
  info() {},
  warn() {},
  error() {},
};

test("retries transient 503 failures with exponential delays", async () => {
  let calls = 0;
  const delays = [];
  const response = await callGeminiWithRetry({
    generate: async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error("temporarily unavailable");
        error.status = 503;
        throw error;
      }
      return { text: '{"ok":true}' };
    },
    validate: (result) => parseJsonObject(result.text),
    wait: async (ms) => delays.push(ms),
    logger: quietLogger,
  });

  assert.equal(response.text, '{"ok":true}');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("does not retry a permanent 400 response", async () => {
  let calls = 0;
  await assert.rejects(
    callGeminiWithRetry({
      generate: async () => {
        calls += 1;
        const error = new Error("bad request");
        error.status = 400;
        throw error;
      },
      wait: async () => {},
      logger: quietLogger,
    })
  );
  assert.equal(calls, 1);
});

test("retries malformed JSON once and then returns valid output", async () => {
  let calls = 0;
  const result = await callGeminiWithRetry({
    generate: async () => ({ text: ++calls === 1 ? "not json" : '{"ok":true}' }),
    validate: (response) => parseJsonObject(response.text),
    wait: async () => {},
    logger: quietLogger,
  });

  assert.equal(calls, 2);
  assert.deepEqual(parseJsonObject(result.text), { ok: true });
});

test("maps exhausted transient and malformed failures to safe responses", () => {
  const busy = new Error("high demand");
  busy.status = 503;
  assert.equal(shouldRetry(busy), true);
  assert.equal(shouldRetry(Object.assign(new Error("aborted"), { name: "AbortError" })), true);
  assert.deepEqual(normalizeGeminiError(busy), {
    status: 503,
    body: {
      error: "AI_TEMPORARILY_UNAVAILABLE",
      message: "AI service is temporarily busy. Please try again in a moment.",
    },
  });

  assert.equal(
    normalizeGeminiError(new InvalidGeminiResponseError()).body.error,
    "AI_INVALID_RESPONSE"
  );
});

test("chat input is bounded and preserves only supported roles", () => {
  const input = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `message ${index}`,
  }));
  input.push({ role: "user", content: "final question" });

  const sanitized = sanitizeChatMessages(input);
  assert.equal(sanitized.length, 8);
  assert.equal(sanitized.at(-1).role, "user");
  assert.equal(sanitized.at(-1).parts[0].text, "final question");
  assert.equal(sanitizeChatMessages([{ role: "user", content: "x".repeat(1001) }]), null);
});

export const AI_ERROR_MESSAGES = {
  AI_TEMPORARILY_UNAVAILABLE:
    "AI service is temporarily busy. Please try again in a moment.",
  AI_RATE_LIMITED: "AI request limit reached. Please wait a moment and try again.",
  AI_INVALID_RESPONSE: "AI returned an invalid response. Please try again.",
  AI_NETWORK_ERROR: "Couldn't reach the AI service. Check your connection and try again.",
  AI_REQUEST_FAILED: "The AI request failed. Please try again.",
};

export class AIRequestError extends Error {
  constructor(code, message, status = null) {
    super(message || AI_ERROR_MESSAGES[code] || AI_ERROR_MESSAGES.AI_REQUEST_FAILED);
    this.name = "AIRequestError";
    this.code = code;
    this.status = status;
  }
}

function endpoint(path) {
  return import.meta.env.DEV ? `http://localhost:3001${path}` : path;
}

async function requestAI(path, body) {
  let response;

  try {
    response = await fetch(endpoint(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AIRequestError("AI_NETWORK_ERROR");
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const fallbackCode = response.status === 429
      ? "AI_RATE_LIMITED"
      : [500, 502, 503, 504].includes(response.status)
        ? "AI_TEMPORARILY_UNAVAILABLE"
        : "AI_REQUEST_FAILED";
    const code = data?.error || fallbackCode;
    throw new AIRequestError(
      code,
      AI_ERROR_MESSAGES[code] || data?.message || AI_ERROR_MESSAGES.AI_REQUEST_FAILED,
      response.status
    );
  }

  if (typeof data?.text !== "string" || !data.text.trim()) {
    throw new AIRequestError("AI_INVALID_RESPONSE");
  }

  return data.text;
}

export function callGemini(system, userText) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new AIRequestError("AI_NETWORK_ERROR", "You're offline. Check your connection and try again.");
  }

  return requestAI("/api/gemini", { system, userText, expectJson: true });
}

export function callHelpChat(messages) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new AIRequestError("AI_NETWORK_ERROR", "You're offline. Check your connection and try again.");
  }

  return requestAI("/api/help-chat", { messages });
}

export function parseGeminiJson(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new AIRequestError("AI_INVALID_RESPONSE");
  }

  let cleaned = raw.trim();
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end >= start) cleaned = cleaned.slice(start, end + 1);

  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Expected an object.");
    }
    return parsed;
  } catch {
    throw new AIRequestError("AI_INVALID_RESPONSE");
  }
}

export function getAIErrorMessage(error, fallback = AI_ERROR_MESSAGES.AI_REQUEST_FAILED) {
  return AI_ERROR_MESSAGES[error?.code] || error?.message || fallback;
}

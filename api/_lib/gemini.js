const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export class InvalidGeminiResponseError extends Error {
  constructor(message = "Gemini returned malformed output.") {
    super(message);
    this.name = "InvalidGeminiResponseError";
    this.code = "AI_INVALID_RESPONSE";
    this.status = 502;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numericStatus(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  return null;
}

export function getStatus(error) {
  if (!error) return null;

  return (
    numericStatus(error.status) ??
    numericStatus(error.statusCode) ??
    numericStatus(error.code) ??
    numericStatus(error.response?.status) ??
    numericStatus(error.cause?.status) ??
    null
  );
}

export function shouldRetry(error) {
  if (!error || error instanceof InvalidGeminiResponseError) return false;

  if (error.name === "AbortError" || error.name === "TimeoutError") return true;

  const status = getStatus(error);
  if (status !== null) return TRANSIENT_STATUS_CODES.has(status);

  const code = String(error.code || error.cause?.code || "").toUpperCase();
  if (TRANSIENT_NETWORK_CODES.has(code)) return true;

  const message = String(error.message || "").toLowerCase();
  return [
    "network",
    "fetch failed",
    "failed to fetch",
    "socket hang up",
    "timed out",
    "timeout",
    "temporarily unavailable",
    "high demand",
    "unavailable",
  ].some((fragment) => message.includes(fragment));
}

export function parseJsonObject(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new InvalidGeminiResponseError("Gemini returned an empty response.");
  }

  let cleaned = text.trim();
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
      throw new Error("Expected a JSON object.");
    }
    return parsed;
  } catch (error) {
    throw new InvalidGeminiResponseError(error.message);
  }
}

export async function callGeminiWithRetry({
  generate,
  operation = "request",
  maxAttempts = 3,
  backoffMs = [1000, 2000],
  validate,
  malformedMaxAttempts = 2,
  wait = sleep,
  logger = console,
}) {
  let lastError = null;
  let malformedAttempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await generate();
      if (validate) validate(result);

      if (attempt > 1) {
        logger.info(`[Gemini:${operation}] succeeded`, { attempt });
      }
      return result;
    } catch (error) {
      lastError = error;
      const malformed = error instanceof InvalidGeminiResponseError;
      if (malformed) malformedAttempts += 1;

      const retrying =
        attempt < maxAttempts &&
        (shouldRetry(error) || (malformed && malformedAttempts < malformedMaxAttempts));

      logger.warn(`[Gemini:${operation}] attempt failed`, {
        attempt,
        status: getStatus(error),
        code: malformed ? "AI_INVALID_RESPONSE" : "AI_REQUEST_FAILED",
        retrying,
      });

      if (!retrying) break;
      await wait(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 2000);
    }
  }

  logger.error(`[Gemini:${operation}] final failure`, {
    status: getStatus(lastError),
    code:
      lastError instanceof InvalidGeminiResponseError
        ? "AI_INVALID_RESPONSE"
        : "AI_REQUEST_FAILED",
  });
  throw lastError;
}

export function normalizeGeminiError(error) {
  const status = getStatus(error);

  if (error instanceof InvalidGeminiResponseError) {
    return {
      status: 502,
      body: {
        error: "AI_INVALID_RESPONSE",
        message: "AI returned an invalid response. Please try again.",
      },
    };
  }

  if (status === 429) {
    return {
      status: 429,
      body: {
        error: "AI_RATE_LIMITED",
        message: "AI request limit reached. Please wait a moment and try again.",
      },
    };
  }

  if (shouldRetry(error)) {
    return {
      status: 503,
      body: {
        error: "AI_TEMPORARILY_UNAVAILABLE",
        message: "AI service is temporarily busy. Please try again in a moment.",
      },
    };
  }

  return {
    status: status && status >= 400 && status < 500 ? status : 500,
    body: {
      error: "AI_REQUEST_FAILED",
      message: "AI request failed. Please try again.",
    },
  };
}

import { GoogleGenAI } from "@google/genai";
import {
  callGeminiWithRetry,
  InvalidGeminiResponseError,
  normalizeGeminiError,
} from "./_lib/gemini.js";
import {
  HELP_CHAT_MODEL,
  HELP_SYSTEM_PROMPT,
  sanitizeChatMessages,
} from "./_lib/helpChat.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "METHOD_NOT_ALLOWED",
      message: "Method not allowed.",
    });
  }

  const messages = sanitizeChatMessages(req.body?.messages);
  if (!messages) {
    return res.status(400).json({
      error: "INVALID_CHAT_REQUEST",
      message: "Enter a shorter help question and try again.",
    });
  }

  try {
    const response = await callGeminiWithRetry({
      operation: "help-chat",
      generate: () => ai.models.generateContent({
        model: HELP_CHAT_MODEL,
        contents: messages,
        config: {
          systemInstruction: HELP_SYSTEM_PROMPT,
          maxOutputTokens: 500,
          temperature: 0.25,
          httpOptions: { timeout: 15_000 },
        },
      }),
      validate: (result) => {
        if (typeof result?.text !== "string" || !result.text.trim()) {
          throw new InvalidGeminiResponseError("Gemini returned an empty help response.");
        }
      },
    });

    return res.status(200).json({ text: response.text.trim() });
  } catch (error) {
    const normalized = normalizeGeminiError(error);
    return res.status(normalized.status).json({
      ...normalized.body,
      message: normalized.body.error === "AI_RATE_LIMITED"
        ? "Help assistant request limit reached. Please wait a moment and try again."
        : "Help assistant is temporarily unavailable. Please try again.",
    });
  }
}

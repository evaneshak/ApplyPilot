import { GoogleGenAI } from "@google/genai";
import {
  callGeminiWithRetry,
  normalizeGeminiError,
  parseJsonObject,
} from "./_lib/gemini.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const { system, userText, expectJson = true } = req.body || {};

  if (
    typeof system !== "string" ||
    typeof userText !== "string" ||
    !system.trim() ||
    !userText.trim()
  ) {
    return res.status(400).json({
      error: "INVALID_REQUEST",
      message: "system and userText are required.",
    });
  }

  if (system.length > 20_000 || userText.length > 250_000) {
    return res.status(413).json({
      error: "REQUEST_TOO_LARGE",
      message: "The AI request is too large.",
    });
  }

  try {
    const response = await callGeminiWithRetry({
      operation: "app-json",
      generate: () => ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: userText,
        config: {
          systemInstruction: system,
          maxOutputTokens: 2000,
          responseMimeType: expectJson ? "application/json" : undefined,
          httpOptions: { timeout: 15_000 },
        },
      }),
      validate: expectJson ? (result) => parseJsonObject(result?.text) : undefined,
    });

    return res.status(200).json({
      text: response.text,
    });
  } catch (error) {
    const normalized = normalizeGeminiError(error);
    return res.status(normalized.status).json(normalized.body);
  }
}

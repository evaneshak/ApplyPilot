import express from "express";
import importJobHandler from "../api/import-job.js";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import {
  callGeminiWithRetry,
  InvalidGeminiResponseError,
  normalizeGeminiError,
  parseJsonObject,
} from "../api/_lib/gemini.js";
import {
  HELP_SYSTEM_PROMPT,
  sanitizeChatMessages,
} from "../api/_lib/helpChat.js";

dotenv.config();
dotenv.config({path:new URL("../.env.local", import.meta.url).pathname});

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.post("/api/import-job", importJobHandler);

app.post("/api/gemini", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
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
      operation: "local-app-json",
      generate: () => ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
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

    return res.json({
      text: response.text,
    });
  } catch (error) {
    const normalized = normalizeGeminiError(error);
    return res.status(normalized.status).json(normalized.body);
  }
});

app.post("/api/help-chat", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const messages = sanitizeChatMessages(req.body?.messages);

  if (!messages) {
    return res.status(400).json({
      error: "INVALID_CHAT_REQUEST",
      message: "Enter a shorter help question and try again.",
    });
  }

  try {
    const response = await callGeminiWithRetry({
      operation: "local-help-chat",
      generate: () => ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
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

    return res.json({ text: response.text.trim() });
  } catch (error) {
    const normalized = normalizeGeminiError(error);
    return res.status(normalized.status).json({
      ...normalized.body,
      message: normalized.body.error === "AI_RATE_LIMITED"
        ? "Help assistant request limit reached. Please wait a moment and try again."
        : "Help assistant is temporarily unavailable. Please try again.",
    });
  }
});

const PORT = process.env.PORT || 3001;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`ApplyPilot server running on http://localhost:${PORT}`);
  });
}

export default app;

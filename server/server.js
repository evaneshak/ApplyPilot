import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.post("/api/gemini", async (req, res) => {
  try {
    const { system, userText } = req.body;

    if (!system || !userText) {
      return res.status(400).json({
        error: "system and userText are required",
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: userText,
      config: {
        systemInstruction: system,
        maxOutputTokens: 1000,
      },
    });

    res.json({
      text: response.text,
    });
  } catch (error) {
    console.error("Gemini error:", error);

    res.status(500).json({
      error: "Gemini request failed",
    });
  }
});

const PORT = 3001;

app.listen(PORT, () => {
  console.log(`ApplyPilot server running on http://localhost:${PORT}`);
});
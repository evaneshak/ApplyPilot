import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

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

    return res.status(200).json({
      text: response.text,
    });
  } catch (error) {
    console.error("Gemini error:", error);

    return res.status(500).json({
      error: "Gemini request failed",
    });
  }
}
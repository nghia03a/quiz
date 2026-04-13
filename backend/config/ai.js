// ============================================================
// config/ai.js — Groq AI Client
//
// Groq tương thích 100% chuẩn OpenAI Chat Completions.
// Chỉ cần đổi baseURL + apiKey trong .env là xong.
//
// Cách dùng trong controller:
//   const ai = require('../config/ai');
//   const res = await ai.chat.completions.create({ model, messages });
//
// Để đổi sang nhà cung cấp AI khác (Gemini, Grok...):
//   Chỉ cần sửa AI_BASE_URL và AI_API_KEY trong .env
//   Không cần sửa bất kỳ controller nào
// ============================================================

const OpenAI = require("openai");

const ai = new OpenAI({
  baseURL: process.env.AI_BASE_URL || "https://api.groq.com/openai/v1",
  apiKey: process.env.AI_API_KEY || "",
  timeout: parseInt(process.env.AI_TIMEOUT_MS) || 10000,
});

module.exports = ai;

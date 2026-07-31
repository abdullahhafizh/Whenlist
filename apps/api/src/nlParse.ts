/** Natural-language → Whenlist DSL via Gemini free tier. */

import { WHENLIST_DSL_NL_RULES } from "./dslNlRules.js";

export type NlParseResult = {
  label: string;
  formula: string;
  completionMode: "once" | "while_valid";
  allowRemind: boolean;
  explanation: string;
};

const DEFAULT_MODEL = "gemini-2.0-flash";

const SYSTEM_PROMPT = WHENLIST_DSL_NL_RULES;

/** Simple per-isolate rate limit (best-effort on Workers). */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export function checkNlRateLimit(key: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(key, bucket);
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model did not return JSON");
  }
}

export async function parseNaturalLanguage(
  text: string,
  apiKey: string,
  model = DEFAULT_MODEL,
): Promise<NlParseResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [{ text: `Request:\n${text}` }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Gemini HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ""}`,
    );
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  if (!raw.trim()) {
    throw new Error("Empty response from Gemini");
  }

  const parsed = extractJsonObject(raw) as Record<string, unknown>;
  const label = String(parsed.label ?? "").trim();
  const formula = String(parsed.formula ?? "").trim();
  const completionMode =
    parsed.completionMode === "once" ? "once" : "while_valid";
  const allowRemind = parsed.allowRemind === true;
  const explanation = String(parsed.explanation ?? "").trim();

  if (!label) {
    throw new Error("Model returned empty label");
  }

  return { label, formula, completionMode, allowRemind, explanation };
}

export { DEFAULT_MODEL };

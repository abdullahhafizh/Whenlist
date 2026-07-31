/** Portable checklist item definition for copy / share / paste. */

export type ShareItemFields = {
  label: string;
  formula: string;
  completionMode: "once" | "while_valid";
  allowRemind?: boolean;
};

export type ShareItemPayload = ShareItemFields & {
  v: 1;
  whenlist: "item";
};

const MARKER = "---whenlist---";

export function buildSharePayload(fields: ShareItemFields): ShareItemPayload {
  return {
    v: 1,
    whenlist: "item",
    label: fields.label.trim(),
    formula: fields.formula.trim(),
    completionMode:
      fields.completionMode === "once" ? "once" : "while_valid",
    allowRemind: Boolean(fields.allowRemind),
  };
}

export function isShareItemPayload(value: unknown): value is ShareItemPayload {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    o.v === 1 &&
    o.whenlist === "item" &&
    typeof o.label === "string" &&
    o.label.trim().length > 0 &&
    typeof o.formula === "string" &&
    (o.completionMode === "once" || o.completionMode === "while_valid")
  );
}

function modeLabel(p: ShareItemFields): string {
  if (p.completionMode === "once" && !p.formula.trim()) return "Forever";
  if (p.completionMode === "once") return "Once when due";
  return "Recurring while due";
}

/** Human-readable block + machine JSON so chat apps stay usable. */
export function formatShareText(payload: ShareItemPayload): string {
  const lines = [
    "Whenlist item",
    `Name: ${payload.label}`,
    `Schedule: ${modeLabel(payload)}`,
    `Formula: ${payload.formula.trim() || "(always)"}`,
    `Remind: ${payload.allowRemind ? "yes" : "no"}`,
    "",
    MARKER,
    JSON.stringify(payload),
  ];
  return lines.join("\n");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(s: string): Uint8Array | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function encodeShareParam(payload: ShareItemPayload): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeShareParam(raw: string): ShareItemPayload | null {
  const bytes = base64UrlToBytes(raw.trim());
  if (!bytes) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return isShareItemPayload(json) ? json : null;
  } catch {
    return null;
  }
}

export function shareItemUrl(
  payload: ShareItemPayload,
  origin = typeof window !== "undefined" ? window.location.origin : "",
): string {
  return `${origin}/create?item=${encodeShareParam(payload)}`;
}

function parseJsonPayload(text: string): ShareItemPayload | null {
  try {
    const json = JSON.parse(text) as unknown;
    return isShareItemPayload(json) ? json : null;
  } catch {
    return null;
  }
}

function extractJsonObject(text: string, from: number): string | null {
  if (text[from] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

/** Accept clipboard text, share URL, or marked export block. */
export function parseShareClipboard(text: string): ShareItemPayload | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const direct = parseJsonPayload(trimmed);
  if (direct) return direct;

  const markerIdx = trimmed.lastIndexOf(MARKER);
  if (markerIdx >= 0) {
    const after = trimmed.slice(markerIdx + MARKER.length).trim();
    const fromMarker = parseJsonPayload(after);
    if (fromMarker) return fromMarker;
  }

  // Bare JSON somewhere in the paste (pretty-printed ok)
  const whenlistIdx = trimmed.indexOf('"whenlist"');
  if (whenlistIdx >= 0) {
    const start = trimmed.lastIndexOf("{", whenlistIdx);
    if (start >= 0) {
      const blob = extractJsonObject(trimmed, start);
      if (blob) {
        const fromEmbed = parseJsonPayload(blob);
        if (fromEmbed) return fromEmbed;
      }
    }
  }

  try {
    const url = new URL(trimmed);
    const item = url.searchParams.get("item");
    if (item) return decodeShareParam(item);
  } catch {
    /* not a URL */
  }

  const itemMatch = /[?&]item=([^&\s]+)/.exec(trimmed);
  if (itemMatch?.[1]) {
    try {
      return decodeShareParam(decodeURIComponent(itemMatch[1]));
    } catch {
      return decodeShareParam(itemMatch[1]);
    }
  }

  return null;
}

export async function writeShareClipboard(
  payload: ShareItemPayload,
): Promise<void> {
  const text = formatShareText(payload);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard not available");
}

export async function readShareClipboard(): Promise<ShareItemPayload | null> {
  if (!navigator.clipboard?.readText) {
    throw new Error("Clipboard not available");
  }
  const text = await navigator.clipboard.readText();
  return parseShareClipboard(text);
}

/** Prefer native share sheet with link; fall back to copying the share text. */
export async function shareOrCopyItem(
  payload: ShareItemPayload,
): Promise<"shared" | "copied"> {
  const url = shareItemUrl(payload);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: payload.label,
        text: `${payload.label} · ${modeLabel(payload)}`,
        url,
      });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      /* fall through to copy */
    }
  }
  await writeShareClipboard(payload);
  return "copied";
}

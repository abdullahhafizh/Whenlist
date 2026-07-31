import type { DragEvent as ReactDragEvent } from "react";

export type BuilderDragTone =
  | "amber"
  | "sky"
  | "slate"
  | "teal"
  | "rose"
  | "violet";

export type BuilderDragPayload = {
  source: "palette" | "block";
  title: string;
  subtitle?: string;
  tone: BuilderDragTone;
};

let payload: BuilderDragPayload | null = null;
let proxy: HTMLDivElement | null = null;
let overSlotEl: Element | null = null;
let raf = 0;

export function getBuilderDrag(): BuilderDragPayload | null {
  return payload;
}

function ensureProxy(data: BuilderDragPayload): HTMLDivElement {
  if (proxy) return proxy;
  const el = document.createElement("div");
  el.id = "builder-drag-proxy";
  el.className = `builder-drag-proxy builder-drag-proxy--${data.tone}`;
  el.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "builder-drag-proxy__body";

  const title = document.createElement("span");
  title.className = "builder-drag-proxy__title";
  title.textContent = data.title;
  body.appendChild(title);

  if (data.subtitle) {
    const sub = document.createElement("span");
    sub.className = "builder-drag-proxy__sub";
    sub.textContent = data.subtitle;
    body.appendChild(sub);
  }

  el.appendChild(body);
  document.body.appendChild(el);
  proxy = el;
  return el;
}

function hideNativeGhost(e: ReactDragEvent | DragEvent) {
  const img = document.createElement("div");
  img.style.cssText =
    "position:fixed;top:-1000px;left:-1000px;width:1px;height:1px;opacity:0";
  document.body.appendChild(img);
  try {
    e.dataTransfer?.setDragImage(img, 0, 0);
  } catch {
    /* ignore */
  }
  requestAnimationFrame(() => img.remove());
}

function layoutProxy(clientX: number, clientY: number) {
  if (!proxy) return;
  const slot = overSlotEl as HTMLElement | null;
  if (slot) {
    const r = slot.getBoundingClientRect();
    const inset = 2;
    proxy.classList.add("is-expanded");
    proxy.style.width = `${Math.max(r.width - inset * 2, 72)}px`;
    // Sit flush in the slot like a real leaf row — not floating in empty padding.
    proxy.style.transform = `translate(${r.left + inset}px, ${r.top + inset}px)`;
  } else {
    proxy.classList.remove("is-expanded");
    proxy.style.width = "max-content";
    proxy.style.transform = `translate(${clientX + 8}px, ${clientY + 8}px)`;
  }
}

function onWindowDragOver(e: Event) {
  if (!proxy) return;
  const de = e as DragEvent;
  de.preventDefault();
  if (raf) cancelAnimationFrame(raf);
  const x = de.clientX;
  const y = de.clientY;
  raf = requestAnimationFrame(() => layoutProxy(x, y));
}

/** One drag visual: follows cursor, expands into the drop slot (no clone). */
export function setBuilderDrag(e: ReactDragEvent, next: BuilderDragPayload) {
  payload = next;
  document.documentElement.classList.add("builder-is-dragging");
  hideNativeGhost(e);
  const el = ensureProxy(next);
  el.className = `builder-drag-proxy builder-drag-proxy--${next.tone}`;
  layoutProxy(e.clientX || 0, e.clientY || 0);
  window.addEventListener("dragover", onWindowDragOver, true);
}

export function setDragHoverSlot(el: Element | null) {
  overSlotEl = el;
  if (proxy && el) {
    const r = (el as HTMLElement).getBoundingClientRect();
    layoutProxy(r.left + r.width / 2, r.top + r.height / 2);
  }
}

export function clearBuilderDrag() {
  payload = null;
  overSlotEl = null;
  document.documentElement.classList.remove("builder-is-dragging");
  window.removeEventListener("dragover", onWindowDragOver, true);
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  proxy?.remove();
  proxy = null;
}

export function toneForPaletteKind(kind: string): BuilderDragTone {
  if (kind === "and") return "amber";
  if (kind === "or") return "sky";
  if (kind === "group") return "violet";
  if (kind === "not") return "rose";
  if (kind === "weekend" || kind === "status") return "sky";
  return "slate";
}

export function toneForAstType(type: string): BuilderDragTone {
  if (type === "and") return "amber";
  if (type === "or") return "sky";
  if (type === "group") return "violet";
  if (type === "not") return "rose";
  if (type === "program") return "teal";
  return "slate";
}

export function titleForAstType(type: string): string {
  const map: Record<string, string> = {
    and: "And",
    or: "Or",
    not: "Not",
    group: "Group",
    program: "Program",
    compare: "Compare",
    between: "Between",
    in: "In list",
    status: "Check status",
    weekend: "Weekend",
    true: "Always",
  };
  return map[type] ?? type;
}

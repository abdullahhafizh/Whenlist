import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "whenlist.builder.colWidths";

export type ColWidths = [number, number, number];

const DEFAULT_WIDTHS: ColWidths = [18, 34, 48];
const MIN = [12, 22, 28] as const;

function clampTriplet(next: ColWidths): ColWidths {
  let [a, b, c] = next;
  a = Math.max(MIN[0], a);
  b = Math.max(MIN[1], b);
  c = Math.max(MIN[2], c);
  const sum = a + b + c;
  if (Math.abs(sum - 100) < 0.01) return [a, b, c];
  const scale = 100 / sum;
  a *= scale;
  b *= scale;
  c *= scale;
  return [a, b, c];
}

function loadWidths(): ColWidths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WIDTHS;
    const parsed = JSON.parse(raw) as number[];
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      parsed.some((n) => typeof n !== "number" || !Number.isFinite(n))
    ) {
      return DEFAULT_WIDTHS;
    }
    return clampTriplet(parsed as ColWidths);
  } catch {
    return DEFAULT_WIDTHS;
  }
}

export function useResizableColumns() {
  const [widths, setWidths] = useState<ColWidths>(() =>
    typeof window === "undefined" ? DEFAULT_WIDTHS : loadWidths(),
  );
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  }, [widths]);

  const startResize = useCallback((dividerIndex: 0 | 1, clientX: number) => {
    const startX = clientX;
    const start = [...widthsRef.current] as ColWidths;
    const container = document.getElementById("builder-columns");
    if (!container) return;
    const totalPx = container.getBoundingClientRect().width;

    const onMove = (e: PointerEvent) => {
      const dxPct = ((e.clientX - startX) / totalPx) * 100;
      const next: ColWidths = [...start];
      if (dividerIndex === 0) {
        let left = start[0] + dxPct;
        let mid = start[1] - dxPct;
        if (left < MIN[0]) {
          mid -= MIN[0] - left;
          left = MIN[0];
        }
        if (mid < MIN[1]) {
          left -= MIN[1] - mid;
          mid = MIN[1];
        }
        next[0] = left;
        next[1] = mid;
      } else {
        let mid = start[1] + dxPct;
        let right = start[2] - dxPct;
        if (mid < MIN[1]) {
          right -= MIN[1] - mid;
          mid = MIN[1];
        }
        if (right < MIN[2]) {
          mid -= MIN[2] - right;
          right = MIN[2];
        }
        next[1] = mid;
        next[2] = right;
      }
      setWidths(clampTriplet(next));
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  const reset = useCallback(() => {
    setWidths(DEFAULT_WIDTHS);
  }, []);

  return { widths, startResize, reset };
}

export function ResizeHandle({
  onDragStart,
}: {
  onDragStart: (clientX: number) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        onDragStart(e.clientX);
      }}
      className="group relative z-10 w-3 shrink-0 cursor-col-resize touch-none"
    >
      <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-slate-200 transition group-hover:bg-teal-500 group-active:bg-teal-600" />
      <div className="absolute inset-y-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300 opacity-0 transition group-hover:opacity-100 group-active:bg-teal-500" />
    </div>
  );
}

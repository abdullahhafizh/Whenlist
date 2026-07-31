import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { btn, field } from "../ui/styles";

type Props = {
  value: string; // `YYYY-MM-DDTHH:mm`
  onChange: (value: string) => void;
  className?: string;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const PANEL_W = 340;
const PANEL_EST_H = 320;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parseLocal(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return new Date();
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
    0,
  );
}

function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function monthLabel(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function buildCalendarDays(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const prevDays = new Date(year, monthIndex, 0).getDate();
  const cells: { day: number; inMonth: boolean; date: Date }[] = [];

  for (let i = startPad - 1; i >= 0; i--) {
    const day = prevDays - i;
    cells.push({
      day,
      inMonth: false,
      date: new Date(year, monthIndex - 1, day),
    });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      day,
      inMonth: true,
      date: new Date(year, monthIndex, day),
    });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const day = cells.length - (startPad + daysInMonth) + 1;
    cells.push({
      day,
      inMonth: false,
      date: new Date(year, monthIndex + 1, day),
    });
  }
  return cells;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

type PanelPos = { top: number; left: number };

/**
 * Custom datetime picker with OK. Panel portals to document.body so it is
 * not clipped by builder column overflow:hidden.
 */
export default function DateTimePicker({ value, onChange, className }: Props) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0 });

  const committed = useMemo(() => parseLocal(value), [value]);
  const [draft, setDraft] = useState(committed);
  const [viewYear, setViewYear] = useState(committed.getFullYear());
  const [viewMonth, setViewMonth] = useState(committed.getMonth());

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const width = Math.min(PANEL_W, window.innerWidth - 16);
    let left = r.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    const spaceBelow = window.innerHeight - r.bottom - gap;
    const spaceAbove = r.top - gap;
    let top: number;
    if (spaceBelow >= PANEL_EST_H || spaceBelow >= spaceAbove) {
      top = r.bottom + gap;
    } else {
      top = Math.max(8, r.top - PANEL_EST_H - gap);
    }
    // Keep footer on-screen if panel is taller than estimate
    const maxTop = window.innerHeight - 8 - PANEL_EST_H;
    top = Math.min(top, Math.max(8, maxTop));
    setPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    setDraft(committed);
    setViewYear(committed.getFullYear());
    setViewMonth(committed.getMonth());
  }, [open, committed]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const onScroll = () => updatePos();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const cells = useMemo(
    () => buildCalendarDays(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const setDraftDate = (d: Date) => {
    setDraft(
      new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        draft.getHours(),
        draft.getMinutes(),
        0,
        0,
      ),
    );
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const setDraftHour = (h: number) => {
    const next = new Date(draft);
    next.setHours(h);
    setDraft(next);
  };

  const setDraftMinute = (m: number) => {
    const next = new Date(draft);
    next.setMinutes(m);
    setDraft(next);
  };

  const applyOk = () => {
    onChange(toLocalIso(draft));
    setOpen(false);
  };

  const applyToday = () => {
    const n = new Date();
    setDraft(n);
    setViewYear(n.getFullYear());
    setViewMonth(n.getMonth());
  };

  const clearToNow = () => {
    const n = new Date();
    onChange(toLocalIso(n));
    setOpen(false);
  };

  const display = committed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const panel =
    open &&
    createPortal(
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-label="Pick date and time"
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: Math.min(PANEL_W, window.innerWidth - 16),
          zIndex: 1000,
        }}
        className="rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
      >
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  const d = new Date(viewYear, viewMonth - 1, 1);
                  setViewYear(d.getFullYear());
                  setViewMonth(d.getMonth());
                }}
              >
                ‹
              </button>
              <span className="text-xs font-semibold text-slate-800">
                {monthLabel(viewYear, viewMonth)}
              </span>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  const d = new Date(viewYear, viewMonth + 1, 1);
                  setViewYear(d.getFullYear());
                  setViewMonth(d.getMonth());
                }}
              >
                ›
              </button>
            </div>
            <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-slate-400">
              {WEEKDAYS.map((w, i) => (
                <span key={`${w}-${i}`}>{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((c, i) => {
                const selected = sameDay(c.date, draft);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDraftDate(c.date)}
                    className={`rounded-md py-1 text-[11px] ${
                      selected
                        ? "bg-teal-700 font-semibold text-white"
                        : c.inMonth
                          ? "text-slate-800 hover:bg-slate-100"
                          : "text-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {c.day}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex shrink-0 gap-1 border-l border-slate-100 pl-2">
            <div className="flex max-h-48 flex-col overflow-y-auto">
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setDraftHour(h)}
                  className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                    draft.getHours() === h
                      ? "bg-teal-700 text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {pad(h)}
                </button>
              ))}
            </div>
            <div className="flex max-h-48 flex-col overflow-y-auto">
              {MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDraftMinute(m)}
                  className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                    draft.getMinutes() === m
                      ? "bg-teal-700 text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {pad(m)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <div className="flex shrink-0 gap-3">
            <button
              type="button"
              onClick={clearToNow}
              className={btn.link}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={applyToday}
              className={btn.link}
            >
              Today
            </button>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={btn.ghost}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyOk}
              className={btn.primarySm}
            >
              OK
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between ${field} text-left hover:border-slate-400`}
      >
        <span className="font-mono text-xs">{display}</span>
        <span className="text-slate-400">▾</span>
      </button>
      {panel}
    </div>
  );
}

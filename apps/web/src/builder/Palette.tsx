import { useMemo, useState } from "react";
import type { TimeField } from "@whenlist/dsl";
import type { PaletteItem } from "./astEdit";
import { PALETTE } from "./astEdit";

type Props = {
  onAdd: (item: PaletteItem) => void;
};

const FIELD_ORDER: TimeField[] = [
  "date",
  "month",
  "year",
  "hour",
  "weekday",
  "meridiem",
  "dateMonth",
  "monthYear",
  "dateMonthYear",
  "lastDay",
  "monthLength",
];

const FIELD_HINT: Record<TimeField, string> = {
  date: "1–31",
  month: "jan–dec",
  year: "year",
  hour: "0–23",
  weekday: "mon–sun",
  meridiem: "am/pm",
  dateMonth: "DD-MM",
  monthYear: "MM-YYYY",
  dateMonthYear: "DD-MM-YYYY",
  lastDay: "last day of month",
  monthLength: "days in this month",
};

const FIELD_LABEL: Record<TimeField, string> = {
  date: "Day",
  month: "Month",
  year: "Year",
  hour: "Hour",
  weekday: "Weekday",
  meridiem: "AM/PM",
  dateMonth: "Day-Month",
  monthYear: "Month-Year",
  dateMonthYear: "Full date",
  lastDay: "Month end",
  monthLength: "Days in month",
};

export default function Palette({ onAdd }: Props) {
  const [query, setQuery] = useState("");
  const operators = PALETTE.filter((p) =>
    ["and", "or", "group", "not"].includes(p.kind),
  );
  const status = PALETTE.filter(
    (p) => p.kind === "status" || p.kind === "weekend",
  );
  const byField = useMemo(() => {
    const map = new Map<TimeField, PaletteItem[]>();
    for (const field of FIELD_ORDER) {
      map.set(
        field,
        PALETTE.filter((p) => p.field === field),
      );
    }
    return map;
  }, []);

  const q = query.trim().toLowerCase();
  const visibleFields = FIELD_ORDER.filter((f) => {
    if (!q) return true;
    return (
      f.toLowerCase().includes(q) ||
      FIELD_LABEL[f].toLowerCase().includes(q) ||
      FIELD_HINT[f].includes(q) ||
      (byField.get(f) ?? []).some((p) => p.label.toLowerCase().includes(q))
    );
  });

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <div className="shrink-0 border-b border-slate-100 px-3 py-2.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search blocks…"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-600/30"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Logic
          </p>
          <div className="flex flex-wrap gap-1.5">
            {operators.map((item) => (
              <button
                key={item.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/x-palette",
                    JSON.stringify(item),
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(item)}
                className="w-fit cursor-grab rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 active:cursor-grabbing hover:bg-amber-100"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Check status
          </p>
          <div className="flex flex-wrap gap-1.5">
            {status.map((item) => (
              <button
                key={item.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/x-palette",
                    JSON.stringify(item),
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(item)}
                className="w-fit cursor-grab rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-900 active:cursor-grabbing hover:bg-sky-100"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Time
          </p>
          <div className="flex flex-wrap items-start gap-1.5">
            {visibleFields.flatMap((field) => {
              const items = byField.get(field) ?? [];
              return items.map((item) => {
                const op =
                  item.kind === "compare"
                    ? "="
                    : item.kind === "between"
                      ? "between"
                      : "in list";
                return (
                  <button
                    key={item.id}
                    type="button"
                    draggable
                    title={`${FIELD_LABEL[field]} ${op} · ${FIELD_HINT[field]}`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/x-palette",
                        JSON.stringify(item),
                      );
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => onAdd(item)}
                    className="inline-flex w-fit shrink-0 cursor-grab items-baseline gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-left active:cursor-grabbing hover:border-teal-400 hover:bg-teal-50"
                  >
                    <span className="text-[11px] font-semibold text-slate-800">
                      {FIELD_LABEL[field]}
                    </span>
                    <span className="text-[11px] font-medium text-teal-700">
                      {op}
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {FIELD_HINT[field]}
                    </span>
                  </button>
                );
              });
            })}
            {visibleFields.length === 0 && (
              <p className="w-full py-4 text-center text-xs text-slate-400">
                No matches
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="shrink-0 border-t border-slate-100 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
        Drag onto canvas or click to append. Scroll stays inside this panel.
      </p>
    </aside>
  );
}

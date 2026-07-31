import { useMemo, useState } from "react";
import {
  evaluate,
  extractTimeParts,
  type AstNode,
} from "@whenlist/dsl";
import DateTimePicker from "./DateTimePicker";
import { card, sectionTitle, statusFalse, statusNeutral, statusTrue } from "../ui/styles";

type Props = {
  ast: AstNode | null;
  selfId?: string;
  statusMap: Record<string, boolean>;
};

export default function LivePreview({ ast, selfId, statusMap }: Props) {
  const [localIso, setLocalIso] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const now = useMemo(() => new Date(localIso), [localIso]);
  const parts = useMemo(
    () => extractTimeParts(now, "Asia/Jakarta"),
    [now],
  );

  const result = useMemo(() => {
    if (!ast) return null;
    try {
      return evaluate(ast, {
        now,
        statusMap,
        selfId,
        timeZone: "Asia/Jakarta",
      });
    } catch {
      return null;
    }
  }, [ast, now, statusMap, selfId]);

  return (
    <div className={`${card} p-3`}>
      <h3 className={sectionTitle}>Live preview</h3>
      <DateTimePicker
        className="mt-2"
        value={localIso}
        onChange={setLocalIso}
      />
      <dl className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-slate-600">
        <div>
          <dt className="text-slate-400">Day of month</dt>
          <dd className="font-mono">{parts.date}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Month</dt>
          <dd className="font-mono">{parts.month}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Weekday</dt>
          <dd className="font-mono">{parts.weekday}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Hour</dt>
          <dd className="font-mono">{parts.hour}</dd>
        </div>
        <div>
          <dt className="text-slate-400">AM/PM</dt>
          <dd className="font-mono">{parts.meridiem}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Year</dt>
          <dd className="font-mono">{parts.year}</dd>
        </div>
      </dl>
      <div
        className={`mt-3 rounded-xl px-2 py-2 text-center text-xs font-semibold ${
          result === null
            ? statusNeutral
            : result
              ? statusTrue
              : statusFalse
        }`}
      >
        {result === null
          ? "No schedule"
          : result
            ? "Showing now"
            : "Hidden now"}
      </div>
    </div>
  );
}

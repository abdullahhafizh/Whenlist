import { useMemo, useState } from "react";
import {
  evaluate,
  extractTimeParts,
  findNextTrueMoment,
  findPrevTrueMoment,
  usesHourGranularity,
  type AstNode,
} from "@whenlist/dsl";
import DateTimePicker from "./DateTimePicker";
import {
  card,
  sectionTitle,
  statusFalse,
  statusNeutral,
  statusTrue,
} from "../ui/styles";

const TZ = "Asia/Jakarta";

type Props = {
  ast: AstNode | null;
  selfId?: string;
  statusMap: Record<string, boolean>;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Picker wall clock is Asia/Jakarta (same TZ the DSL evaluates in). */
function parseJakartaWall(localIso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localIso);
  if (!m) return new Date();
  return new Date(
    `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+07:00`,
  );
}

function toJakartaPickerIso(absoluteIso: string): string {
  const p = extractTimeParts(new Date(absoluteIso), TZ);
  return `${p.year}-${pad(p.month)}-${pad(p.date)}T${pad(p.hour)}:00`;
}

function formatWindow(iso: string, hourly: boolean): string {
  const p = extractTimeParts(new Date(iso), TZ);
  const day = `${p.year}-${pad(p.month)}-${pad(p.date)}`;
  return hourly ? `${day} ${pad(p.hour)}:00` : day;
}

export default function LivePreview({ ast, selfId, statusMap }: Props) {
  const [localIso, setLocalIso] = useState(() => {
    const p = extractTimeParts(new Date(), TZ);
    return `${p.year}-${pad(p.month)}-${pad(p.date)}T${pad(p.hour)}:00`;
  });

  const now = useMemo(() => parseJakartaWall(localIso), [localIso]);
  const parts = useMemo(() => extractTimeParts(now, TZ), [now]);

  const evalCtx = useMemo(
    () => ({ now, statusMap, selfId, timeZone: TZ }),
    [now, statusMap, selfId],
  );

  const result = useMemo(() => {
    if (!ast) return null;
    try {
      return evaluate(ast, evalCtx);
    } catch {
      return null;
    }
  }, [ast, evalCtx]);

  const hourly = useMemo(
    () => (ast ? usesHourGranularity(ast) : false),
    [ast],
  );

  const prevIso = useMemo(() => {
    if (!ast || result === null) return null;
    try {
      return findPrevTrueMoment(ast, evalCtx);
    } catch {
      return null;
    }
  }, [ast, evalCtx, result]);

  const nextIso = useMemo(() => {
    if (!ast || result === null) return null;
    try {
      return findNextTrueMoment(ast, evalCtx);
    } catch {
      return null;
    }
  }, [ast, evalCtx, result]);

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
      <dl className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-slate-600">
        <div>
          <dt className="text-slate-400">Previous</dt>
          <dd className="font-mono tabular-nums">
            {prevIso ? (
              <button
                type="button"
                className="text-left text-teal-700 underline-offset-2 hover:underline"
                title="Jump to this time"
                onClick={() => setLocalIso(toJakartaPickerIso(prevIso))}
              >
                {formatWindow(prevIso, hourly)}
              </button>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Next</dt>
          <dd className="font-mono tabular-nums">
            {nextIso ? (
              <button
                type="button"
                className="text-left text-teal-700 underline-offset-2 hover:underline"
                title="Jump to this time"
                onClick={() => setLocalIso(toJakartaPickerIso(nextIso))}
              >
                {formatWindow(nextIso, hourly)}
              </button>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

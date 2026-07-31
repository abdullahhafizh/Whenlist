import type {
  AstNode,
  FieldLiteral,
  TimeField,
  ValueExpr,
} from "@whenlist/dsl";
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  fieldLiteralToValueExpr,
  serializeValueExpr,
  valueExprToFieldLiteral,
  tryParse,
} from "@whenlist/dsl";
import { useEffect, useState } from "react";
import type { ItemRecord } from "../api";
import { dslAccent, fieldDense } from "../ui/styles";

type Props = {
  node: AstNode;
  items: ItemRecord[];
  onChange: (node: AstNode) => void;
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function LitInput({
  field,
  value,
  onChange,
}: {
  field: TimeField;
  value: FieldLiteral;
  onChange: (v: FieldLiteral) => void;
}) {
  const inputCls = fieldDense;

  switch (field) {
    case "date":
    case "hour":
    case "year":
    case "lastDay":
    case "monthLength":
    case "prevLastDay":
      return (
        <input
          type="number"
          className={`${inputCls} w-20`}
          value={value as number}
          min={field === "hour" ? 0 : 1}
          max={
            field === "date" ||
            field === "lastDay" ||
            field === "monthLength" ||
            field === "prevLastDay"
              ? 31
              : field === "hour"
                ? 23
                : 9999
          }
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case "month":
      return (
        <select
          className={inputCls}
          value={value as string}
          onChange={(e) => onChange(e.target.value as FieldLiteral)}
        >
          {MONTH_NAMES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      );
    case "weekday":
      return (
        <select
          className={inputCls}
          value={value as string}
          onChange={(e) => onChange(e.target.value as FieldLiteral)}
        >
          {WEEKDAY_NAMES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      );
    case "meridiem":
      return (
        <select
          className={inputCls}
          value={value as string}
          onChange={(e) => onChange(e.target.value as "am" | "pm")}
        >
          <option value="am">am</option>
          <option value="pm">pm</option>
        </select>
      );
    case "dateMonth": {
      const v = value as { day: number; month: number };
      return (
        <input
          type="text"
          className={`${inputCls} w-24`}
          value={`${pad2(v.day)}-${pad2(v.month)}`}
          placeholder="DD-MM"
          onChange={(e) => {
            const m = /^(\d{1,2})-(\d{1,2})$/.exec(e.target.value.trim());
            if (m) onChange({ day: Number(m[1]), month: Number(m[2]) });
          }}
        />
      );
    }
    case "monthYear": {
      const v = value as { month: number; year: number };
      return (
        <input
          type="text"
          className={`${inputCls} w-28`}
          value={`${pad2(v.month)}-${v.year}`}
          placeholder="MM-YYYY"
          onChange={(e) => {
            const m = /^(\d{1,2})-(\d{4})$/.exec(e.target.value.trim());
            if (m) onChange({ month: Number(m[1]), year: Number(m[2]) });
          }}
        />
      );
    }
    case "dateMonthYear": {
      const v = value as { day: number; month: number; year: number };
      return (
        <input
          type="text"
          className={`${inputCls} w-36`}
          value={`${pad2(v.day)}-${pad2(v.month)}-${v.year}`}
          placeholder="DD-MM-YYYY"
          onChange={(e) => {
            const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(e.target.value.trim());
            if (m)
              onChange({
                day: Number(m[1]),
                month: Number(m[2]),
                year: Number(m[3]),
              });
          }}
        />
      );
    }
  }
}

function ValueInput({
  field,
  value,
  onChange,
}: {
  field: TimeField;
  value: ValueExpr;
  onChange: (v: ValueExpr) => void;
}) {
  const lit = valueExprToFieldLiteral(field, value);
  const [text, setText] = useState(serializeValueExpr(value));
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setText(serializeValueExpr(value));
    setErr(null);
  }, [value]);

  if (lit !== null) {
    return (
      <LitInput
        field={field}
        value={lit}
        onChange={(v) => onChange(fieldLiteralToValueExpr(field, v))}
      />
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        type="text"
        spellCheck={false}
        className={`min-w-[8rem] ${fieldDense} font-mono`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = tryParse(`${field} == ${text}`);
          if (!parsed.ok) {
            setErr(parsed.error);
            return;
          }
          if (parsed.ast.type === "compare") {
            onChange(parsed.ast.value);
            setErr(null);
          } else if (
            parsed.ast.type === "program" &&
            parsed.ast.body.type === "compare"
          ) {
            onChange(parsed.ast.body.value);
            setErr(null);
          } else {
            setErr("Expected a value expression");
          }
        }}
      />
      {err && <span className="text-[10px] text-red-600">{err}</span>}
    </div>
  );
}

export default function BlockForm({ node, items, onChange }: Props) {
  if (node.type === "program") {
    return (
      <span className="text-xs text-slate-600">
        Has <code className="font-mono">fn</code>/
        <code className="font-mono">let</code> — edit definitions in text mode;
        body below.
      </span>
    );
  }

  if (node.type === "compare") {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={dslAccent}>
          {node.field}
        </span>
        <select
          className={fieldDense}
          value={node.op}
          onChange={(e) =>
            onChange({ ...node, op: e.target.value as typeof node.op })
          }
        >
          {["==", "!=", ">=", "<=", ">", "<"].map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        <ValueInput
          field={node.field}
          value={node.value}
          onChange={(value) => onChange({ ...node, value })}
        />
      </div>
    );
  }

  if (node.type === "between") {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={dslAccent}>
          {node.field}
        </span>
        <span className="text-xs text-slate-500">between</span>
        <ValueInput
          field={node.field}
          value={node.from}
          onChange={(from) => onChange({ ...node, from })}
        />
        <span className="text-xs text-slate-400">..</span>
        <ValueInput
          field={node.field}
          value={node.to}
          onChange={(to) => onChange({ ...node, to })}
        />
      </div>
    );
  }

  if (node.type === "in") {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={dslAccent}>
          {node.field}
        </span>
        <span className="text-xs text-slate-500">in</span>
        {node.values.map((v, i) => (
          <LitInput
            key={i}
            field={node.field}
            value={v}
            onChange={(nv) => {
              const values = [...node.values];
              values[i] = nv;
              onChange({ ...node, values });
            }}
          />
        ))}
        <button
          type="button"
          className="rounded border border-slate-200 px-1.5 text-xs text-slate-500 hover:bg-slate-50"
          onClick={() =>
            onChange({
              ...node,
              values: [...node.values, node.values[0] ?? 1],
            })
          }
        >
          +
        </button>
      </div>
    );
  }

  if (node.type === "weekend") {
    return (
      <span className="text-xs font-medium text-slate-700">
        weekend{" "}
        <span className="font-normal text-slate-400">(sat–sun)</span>
      </span>
    );
  }

  if (node.type === "status") {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          className={fieldDense}
          value={node.checked ? "checked" : "notChecked"}
          onChange={(e) =>
            onChange({ ...node, checked: e.target.value === "checked" })
          }
        >
          <option value="checked">checked</option>
          <option value="notChecked">notChecked</option>
        </select>
        {node.itemId !== undefined ? (
          <select
            className={fieldDense}
            value={node.itemId}
            onChange={(e) =>
              onChange({ ...node, itemId: e.target.value })
            }
          >
            <option value="">Select item…</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-slate-400">(self)</span>
        )}
      </div>
    );
  }

  return null;
}

import {
  type FieldLiteral,
  type FnDef,
  type MonthName,
  type TimeField,
  type ValueExpr,
  type WeekdayName,
  MONTH_TO_NUM,
  WEEKDAY_TO_NUM,
} from "./ast.js";
import { monthValue, weekdayValue } from "./serialize.js";

/** Numeric calendar snapshot (subset of evaluate TimeParts). */
export type ValueTimeParts = {
  date: number;
  month: number;
  year: number;
  hour: number;
  weekday: number;
};

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function fieldLiteralToValueExpr(
  field: TimeField,
  lit: FieldLiteral,
): ValueExpr {
  switch (field) {
    case "date":
    case "hour":
    case "year":
    case "lastDay":
    case "monthLength":
    case "prevLastDay":
      return { type: "num", value: lit as number };
    case "month":
    case "weekday":
    case "meridiem":
      if (typeof lit === "number") return { type: "num", value: lit };
      return { type: "named", value: lit as string };
    case "dateMonth":
      return {
        type: "composite",
        kind: "dateMonth",
        value: lit as { day: number; month: number },
      };
    case "monthYear":
      return {
        type: "composite",
        kind: "monthYear",
        value: lit as { month: number; year: number },
      };
    case "dateMonthYear":
      return {
        type: "composite",
        kind: "dateMonthYear",
        value: lit as { day: number; month: number; year: number },
      };
  }
}

/** If expr is a plain literal for the field, return FieldLiteral; else null. */
export function valueExprToFieldLiteral(
  field: TimeField,
  expr: ValueExpr,
): FieldLiteral | null {
  const unparen = (e: ValueExpr): ValueExpr =>
    e.type === "paren" ? unparen(e.expr) : e;
  const e = unparen(expr);
  switch (field) {
    case "date":
    case "hour":
    case "year":
    case "lastDay":
    case "monthLength":
    case "prevLastDay":
      return e.type === "num" ? e.value : null;
    case "month":
      if (e.type === "num") return e.value;
      if (e.type === "named" && e.value in MONTH_TO_NUM) return e.value as MonthName;
      return null;
    case "weekday":
      if (e.type === "num") return e.value;
      if (e.type === "named" && e.value in WEEKDAY_TO_NUM)
        return e.value as WeekdayName;
      return null;
    case "meridiem":
      if (e.type === "named" && (e.value === "am" || e.value === "pm"))
        return e.value;
      return null;
    case "dateMonth":
      return e.type === "composite" && e.kind === "dateMonth" ? e.value : null;
    case "monthYear":
      return e.type === "composite" && e.kind === "monthYear" ? e.value : null;
    case "dateMonthYear":
      return e.type === "composite" && e.kind === "dateMonthYear" ? e.value : null;
  }
}

export function ordinalFromLiteral(field: TimeField, lit: FieldLiteral): number {
  switch (field) {
    case "date":
    case "hour":
    case "year":
    case "lastDay":
    case "monthLength":
    case "prevLastDay":
      return lit as number;
    case "month":
      return monthValue(lit);
    case "weekday":
      return weekdayValue(lit);
    case "meridiem":
      return lit === "am" ? 0 : 1;
    case "dateMonth": {
      const v = lit as { day: number; month: number };
      return v.month * 100 + v.day;
    }
    case "monthYear": {
      const v = lit as { month: number; year: number };
      return v.year * 100 + v.month;
    }
    case "dateMonthYear": {
      const v = lit as { day: number; month: number; year: number };
      return v.year * 10000 + v.month * 100 + v.day;
    }
  }
}

function resolveRef(name: string, parts: ValueTimeParts): number {
  const n = name.toLowerCase();
  switch (n) {
    case "date":
      return parts.date;
    case "month":
      return parts.month;
    case "year":
      return parts.year;
    case "hour":
      return parts.hour;
    case "weekday":
      return parts.weekday;
    case "lastday":
    case "monthlength":
      return daysInMonth(parts.year, parts.month);
    case "prevlastday":
      // Calendar month N → Date.UTC(y, N-1, 0) = last day of previous month
      return daysInMonth(parts.year, parts.month - 1);
    default:
      throw new Error(`Unknown reference '${name}'`);
  }
}

const MAX_CALL_DEPTH = 64;

export type ValueEvalEnv = {
  parts: ValueTimeParts;
  vars: Map<string, number>;
  functions: Map<string, FnDef>;
  depth?: number;
};

export function evalValueExpr(expr: ValueExpr, env: ValueEvalEnv): number {
  const depth = env.depth ?? 0;
  if (depth > MAX_CALL_DEPTH) {
    throw new Error("Function call depth exceeded");
  }

  switch (expr.type) {
    case "num":
      return expr.value;
    case "named": {
      if (expr.value in MONTH_TO_NUM) return MONTH_TO_NUM[expr.value as MonthName];
      if (expr.value in WEEKDAY_TO_NUM)
        return WEEKDAY_TO_NUM[expr.value as WeekdayName];
      if (expr.value === "am") return 0;
      if (expr.value === "pm") return 1;
      throw new Error(`Unknown named literal '${expr.value}'`);
    }
    case "composite": {
      const v = expr.value;
      if (expr.kind === "dateMonth") {
        const d = v as { day: number; month: number };
        return d.month * 100 + d.day;
      }
      if (expr.kind === "monthYear") {
        const d = v as { month: number; year: number };
        return d.year * 100 + d.month;
      }
      const d = v as { day: number; month: number; year: number };
      return d.year * 10000 + d.month * 100 + d.day;
    }
    case "ref": {
      if (env.vars.has(expr.name)) return env.vars.get(expr.name)!;
      return resolveRef(expr.name, env.parts);
    }
    case "paren":
      return evalValueExpr(expr.expr, env);
    case "unary": {
      const v = evalValueExpr(expr.arg, env);
      return expr.op === "-" ? -v : v;
    }
    case "binary": {
      const l = evalValueExpr(expr.left, env);
      const r = evalValueExpr(expr.right, env);
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? NaN : l / r;
      }
      break;
    }
    case "call": {
      const name = expr.name;
      const args = expr.args.map((a) => evalValueExpr(a, env));
      switch (name) {
        case "ceil":
          if (args.length !== 1) throw new Error("ceil expects 1 argument");
          return Math.ceil(args[0]!);
        case "floor":
          if (args.length !== 1) throw new Error("floor expects 1 argument");
          return Math.floor(args[0]!);
        case "round":
          if (args.length !== 1) throw new Error("round expects 1 argument");
          return Math.round(args[0]!);
        case "abs":
          if (args.length !== 1) throw new Error("abs expects 1 argument");
          return Math.abs(args[0]!);
        case "min":
          if (args.length < 1) throw new Error("min expects ≥1 arguments");
          return Math.min(...args);
        case "max":
          if (args.length < 1) throw new Error("max expects ≥1 arguments");
          return Math.max(...args);
        default: {
          const fn = env.functions.get(name);
          if (!fn) throw new Error(`Unknown function '${name}'`);
          if (args.length !== fn.params.length) {
            throw new Error(
              `Function '${name}' expects ${fn.params.length} args, got ${args.length}`,
            );
          }
          const vars = new Map(env.vars);
          fn.params.forEach((p, i) => vars.set(p, args[i]!));
          return evalValueExpr(fn.body, {
            ...env,
            vars,
            depth: depth + 1,
          });
        }
      }
    }
  }
}

export function evalValueAsOrdinal(
  _field: TimeField,
  expr: ValueExpr,
  env: ValueEvalEnv,
): number {
  return evalValueExpr(expr, env);
}

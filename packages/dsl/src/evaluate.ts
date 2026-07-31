import {
  type AstNode,
  type BoolAstNode,
  type FieldLiteral,
  type FnDef,
  type TimeField,
  type ValueExpr,
  CYCLIC_FIELDS,
} from "./ast.js";
import {
  evalValueAsOrdinal,
  ordinalFromLiteral,
  daysInMonth,
  type ValueEvalEnv,
} from "./value.js";
import { MONTH_TO_NUM, WEEKDAY_TO_NUM } from "./ast.js";
export type { MonthName, WeekdayName } from "./ast.js";
export { MONTH_TO_NUM, WEEKDAY_TO_NUM };

export type EvalContext = {
  now: Date;
  statusMap: Record<string, boolean>;
  selfId?: string;
  timeZone?: string;
};

export type TimeParts = {
  date: number;
  month: number;
  year: number;
  hour: number;
  weekday: number;
  meridiem: "am" | "pm";
  dateMonth: { day: number; month: number };
  monthYear: { month: number; year: number };
  dateMonthYear: { day: number; month: number; year: number };
};

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function extractTimeParts(
  now: Date,
  timeZone = "Asia/Jakarta",
): TimeParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const day = Number(get("day"));
  const month = Number(get("month"));
  const year = Number(get("year"));
  const hour = Number(get("hour"));
  const weekdayName = get("weekday");
  const weekday = WEEKDAY_MAP[weekdayName] ?? 1;

  return {
    date: day,
    month,
    year,
    hour,
    weekday,
    meridiem: hour < 12 ? "am" : "pm",
    dateMonth: { day, month },
    monthYear: { month, year },
    dateMonthYear: { day, month, year },
  };
}

function ordinal(field: TimeField, lit: FieldLiteral): number {
  return ordinalFromLiteral(field, lit);
}

function currentOrdinal(field: TimeField, parts: TimeParts): number {
  switch (field) {
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
    case "meridiem":
      return parts.meridiem === "am" ? 0 : 1;
    case "dateMonth":
      return parts.month * 100 + parts.date;
    case "monthYear":
      return parts.year * 100 + parts.month;
    case "dateMonthYear":
      return parts.year * 10000 + parts.month * 100 + parts.date;
    case "lastDay":
    case "monthLength":
      return daysInMonth(parts.year, parts.month);
  }
}

function inBetween(
  field: TimeField,
  cur: number,
  from: number,
  to: number,
): boolean {
  if (!CYCLIC_FIELDS.has(field)) {
    return cur >= from && cur <= to;
  }
  if (from <= to) return cur >= from && cur <= to;
  return cur >= from || cur <= to;
}

function compare(op: string, a: number, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  switch (op) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case "<":
      return a < b;
    default:
      return false;
  }
}

export function programParts(ast: AstNode): {
  functions: FnDef[];
  lets: { name: string; value: ValueExpr }[];
  body: BoolAstNode;
} {
  if (ast.type === "program") {
    return {
      functions: ast.functions,
      lets: ast.lets,
      body: ast.body as BoolAstNode,
    };
  }
  return { functions: [], lets: [], body: ast };
}

export function evaluate(ast: AstNode, ctx: EvalContext): boolean {
  const timeZone = ctx.timeZone ?? "Asia/Jakarta";
  const parts = extractTimeParts(ctx.now, timeZone);
  const { functions, lets, body } = programParts(ast);

  const fnMap = new Map(functions.map((f) => [f.name, f]));
  const vars = new Map<string, number>();
  const env: ValueEvalEnv = {
    parts,
    vars,
    functions: fnMap,
  };

  for (const binding of lets) {
    vars.set(binding.name, evalValueAsOrdinal("date", binding.value, env));
  }

  const evalNode = (node: BoolAstNode): boolean => {
    switch (node.type) {
      case "compare": {
        const cur = currentOrdinal(node.field, parts);
        const val = evalValueAsOrdinal(node.field, node.value, env);
        return compare(node.op, cur, val);
      }
      case "between": {
        const cur = currentOrdinal(node.field, parts);
        const from = evalValueAsOrdinal(node.field, node.from, env);
        const to = evalValueAsOrdinal(node.field, node.to, env);
        return inBetween(node.field, cur, from, to);
      }
      case "in": {
        const cur = currentOrdinal(node.field, parts);
        return node.values.some((v) => cur === ordinal(node.field, v));
      }
      case "status": {
        const id = node.itemId ?? ctx.selfId;
        if (id === undefined) return false;
        const isChecked = Boolean(ctx.statusMap[id]);
        return node.checked ? isChecked : !isChecked;
      }
      case "weekend":
        return parts.weekday === 6 || parts.weekday === 7;
      case "and":
        return node.children.every(evalNode);
      case "or":
        return node.children.some(evalNode);
      case "not":
        return !evalNode(node.child);
      case "group":
        return evalNode(node.child);
      case "true":
        return true;
    }
  };

  return evalNode(body);
}

export function isAlwaysTrue(ast: AstNode): boolean {
  const { body, functions, lets } = programParts(ast);
  if (functions.length || lets.length) return false;
  if (body.type === "true") return true;
  if (body.type === "and" && body.children.length === 0) return true;
  return false;
}

export function normalizeAst(ast: AstNode): AstNode {
  if (isAlwaysTrue(ast)) return { type: "true" };
  return ast;
}

function walkBool(
  node: BoolAstNode,
  visit: (n: BoolAstNode) => void,
): void {
  visit(node);
  switch (node.type) {
    case "and":
    case "or":
      node.children.forEach((c) => walkBool(c, visit));
      break;
    case "not":
    case "group":
      walkBool(node.child, visit);
      break;
  }
}

export function collectDependencies(ast: AstNode): string[] {
  const ids = new Set<string>();
  const { body } = programParts(ast);
  walkBool(body, (node) => {
    if (node.type === "status" && node.itemId !== undefined) {
      ids.add(node.itemId);
    }
  });
  return [...ids];
}

export function mapStatusIds(
  ast: AstNode,
  mapId: (id: string) => string,
): AstNode {
  const mapBool = (node: BoolAstNode): BoolAstNode => {
    switch (node.type) {
      case "status":
        if (node.itemId === undefined) return node;
        return { ...node, itemId: mapId(node.itemId) };
      case "and":
      case "or":
        return { ...node, children: node.children.map(mapBool) };
      case "not":
      case "group":
        return { ...node, child: mapBool(node.child) };
      default:
        return node;
    }
  };
  if (ast.type === "program") {
    return { ...ast, body: mapBool(ast.body as BoolAstNode) };
  }
  return mapBool(ast);
}

export function usesHourGranularity(ast: AstNode): boolean {
  const { body } = programParts(ast);
  const walk = (node: BoolAstNode): boolean => {
    switch (node.type) {
      case "compare":
      case "between":
      case "in":
        return node.field === "hour" || node.field === "meridiem";
      case "and":
      case "or":
        return node.children.some(walk);
      case "not":
      case "group":
        return walk(node.child);
      default:
        return false;
    }
  };
  return walk(body);
}

export function usesSelfStatus(ast: AstNode): boolean {
  const { body } = programParts(ast);
  const walk = (node: BoolAstNode): boolean => {
    switch (node.type) {
      case "status":
        return node.itemId === undefined;
      case "and":
      case "or":
        return node.children.some(walk);
      case "not":
      case "group":
        return walk(node.child);
      default:
        return false;
    }
  };
  return walk(body);
}

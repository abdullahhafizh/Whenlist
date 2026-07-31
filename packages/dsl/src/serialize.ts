import {
  type AstNode,
  type FieldLiteral,
  type MonthName,
  type TimeField,
  type ValueExpr,
  type WeekdayName,
  MONTH_TO_NUM,
  NUM_TO_MONTH,
  NUM_TO_WEEKDAY,
  WEEKDAY_TO_NUM,
} from "./ast.js";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function litToString(field: TimeField, value: FieldLiteral): string {
  switch (field) {
    case "date":
    case "hour":
    case "year":
    case "lastDay":
    case "monthLength":
      return String(value as number);
    case "month":
      if (typeof value === "number") return NUM_TO_MONTH[value] ?? String(value);
      return value as string;
    case "weekday":
      if (typeof value === "number") return NUM_TO_WEEKDAY[value] ?? String(value);
      return value as string;
    case "meridiem":
      return value as string;
    case "dateMonth": {
      const v = value as { day: number; month: number };
      return `${pad2(v.day)}-${pad2(v.month)}`;
    }
    case "monthYear": {
      const v = value as { month: number; year: number };
      return `${pad2(v.month)}-${v.year}`;
    }
    case "dateMonthYear": {
      const v = value as { day: number; month: number; year: number };
      return `${pad2(v.day)}-${pad2(v.month)}-${v.year}`;
    }
  }
}

const PREC: Record<string, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
};

export function serializeValueExpr(expr: ValueExpr, parentPrec = 0): string {
  switch (expr.type) {
    case "num":
      return String(expr.value);
    case "named":
      return expr.value;
    case "composite": {
      if (expr.kind === "dateMonth") {
        const v = expr.value as { day: number; month: number };
        return `${pad2(v.day)}-${pad2(v.month)}`;
      }
      if (expr.kind === "monthYear") {
        const v = expr.value as { month: number; year: number };
        return `${pad2(v.month)}-${v.year}`;
      }
      const v = expr.value as { day: number; month: number; year: number };
      return `${pad2(v.day)}-${pad2(v.month)}-${v.year}`;
    }
    case "ref":
      return expr.name;
    case "paren":
      return `(${serializeValueExpr(expr.expr, 0)})`;
    case "unary":
      return `${expr.op}${serializeValueExpr(expr.arg, 3)}`;
    case "binary": {
      const p = PREC[expr.op] ?? 0;
      const s = `${serializeValueExpr(expr.left, p)} ${expr.op} ${serializeValueExpr(expr.right, p + 1)}`;
      return parentPrec > p ? `(${s})` : s;
    }
    case "call":
      return `${expr.name}(${expr.args.map((a) => serializeValueExpr(a)).join(", ")})`;
  }
}

function serializeBool(node: AstNode, parentPrec: number): string {
  if (node.type === "program") {
    return serialize(node);
  }
  switch (node.type) {
    case "true":
      return "";
    case "compare":
      return `${node.field} ${node.op} ${serializeValueExpr(node.value)}`;
    case "between":
      return `${node.field} between ${serializeValueExpr(node.from)} .. ${serializeValueExpr(node.to)}`;
    case "in":
      return `${node.field} in [${node.values.map((v) => litToString(node.field, v)).join(", ")}]`;
    case "status":
      if (node.itemId !== undefined) {
        const escaped = node.itemId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `${node.checked ? "checked" : "notChecked"}("${escaped}")`;
      }
      return node.checked ? "checked" : "notChecked";
    case "weekend":
      return "weekend";
    case "not": {
      if (node.child.type === "and" || node.child.type === "or") {
        return `!(${serializeBool(node.child, 0)})`;
      }
      if (node.child.type === "group") {
        return `!${serializeBool(node.child, 3)}`;
      }
      return `!${serializeBool(node.child, 3)}`;
    }
    case "group":
      return `(${serializeBool(node.child, 0)})`;
    case "and": {
      if (node.children.length === 0) return "";
      const s = node.children.map((c) => serializeBool(c, 2)).join(" && ");
      return parentPrec > 2 ? `(${s})` : s;
    }
    case "or": {
      const s = node.children.map((c) => serializeBool(c, 1)).join(" || ");
      return parentPrec > 1 ? `(${s})` : s;
    }
  }
}

/** Serialize AST to DSL text (canonical form). */
export function serialize(ast: AstNode): string {
  if (ast.type === "program") {
    const parts: string[] = [];
    for (const fn of ast.functions) {
      parts.push(
        `fn ${fn.name}(${fn.params.join(", ")}) { ${serializeValueExpr(fn.body)} }`,
      );
    }
    for (const binding of ast.lets) {
      parts.push(`let ${binding.name} = ${serializeValueExpr(binding.value)};`);
    }
    parts.push(serializeBool(ast.body, 0));
    return parts.filter(Boolean).join("\n");
  }
  return serializeBool(ast, 0);
}

export function normalizeLiteral(
  field: TimeField,
  value: FieldLiteral,
): FieldLiteral {
  if (field === "month") {
    if (typeof value === "number") return NUM_TO_MONTH[value] as MonthName;
    return value;
  }
  if (field === "weekday") {
    if (typeof value === "number") return NUM_TO_WEEKDAY[value] as WeekdayName;
    return value;
  }
  return value;
}

export function monthValue(v: FieldLiteral): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v in MONTH_TO_NUM) return MONTH_TO_NUM[v as MonthName];
  throw new Error(`Invalid month literal: ${JSON.stringify(v)}`);
}

export function weekdayValue(v: FieldLiteral): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v in WEEKDAY_TO_NUM)
    return WEEKDAY_TO_NUM[v as WeekdayName];
  throw new Error(`Invalid weekday literal: ${JSON.stringify(v)}`);
}

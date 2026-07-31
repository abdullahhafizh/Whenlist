import {
  type AstNode,
  type BinaryOp,
  type BoolAstNode,
  type CmpOp,
  type FieldLiteral,
  type FnDef,
  type LetDef,
  type MonthName,
  type TimeField,
  type ValueExpr,
  type WeekdayName,
  MONTH_NAMES,
  MONTH_TO_NUM,
  TIME_FIELDS,
  WEEKDAY_NAMES,
} from "./ast.js";
import { type Token, tokenize, TokenizeError } from "./tokenizer.js";
import { fieldLiteralToValueExpr } from "./value.js";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
  ) {
    super(`${message} at position ${pos}`);
    this.name = "ParseError";
  }
}

const FIELD_BY_LOWER: Record<string, TimeField> = Object.fromEntries(
  TIME_FIELDS.map((f) => [f.toLowerCase(), f]),
) as Record<string, TimeField>;
const MONTH_SET = new Set<string>(MONTH_NAMES);
const WEEKDAY_SET = new Set<string>(WEEKDAY_NAMES);

const REF_CANON: Record<string, string> = {
  date: "date",
  month: "month",
  year: "year",
  hour: "hour",
  weekday: "weekday",
  lastday: "lastDay",
  monthlength: "monthLength",
  prevlastday: "prevLastDay",
};

export function parse(input: string): AstNode {
  let tokens: Token[];
  try {
    tokens = tokenize(input);
  } catch (e) {
    if (e instanceof TokenizeError)
      throw new ParseError(e.message.replace(/ at position \d+$/, ""), e.pos);
    throw e;
  }

  let i = 0;
  const peek = () => tokens[i]!;
  const at = (kind: Token["kind"]) => peek().kind === kind;
  const consume = (kind?: Token["kind"], expected?: string): Token => {
    const t = peek();
    if (kind && t.kind !== kind) {
      throw new ParseError(
        `Expected ${expected ?? kind}, got '${t.value || t.kind}'`,
        t.pos,
      );
    }
    i++;
    return t;
  };

  const parseValueExpr = (): ValueExpr => parseAdd();

  const parseAdd = (): ValueExpr => {
    let left = parseMul();
    while (at("PLUS") || at("MINUS")) {
      const op = consume().value as BinaryOp;
      const right = parseMul();
      left = { type: "binary", op, left, right };
    }
    return left;
  };

  const parseMul = (): ValueExpr => {
    let left = parseUnary();
    while (at("STAR") || at("SLASH")) {
      const op = consume().value as BinaryOp;
      const right = parseUnary();
      left = { type: "binary", op, left, right };
    }
    return left;
  };

  const parseUnary = (): ValueExpr => {
    if (at("PLUS") || at("MINUS")) {
      const op = consume().value as "+" | "-";
      return { type: "unary", op, arg: parseUnary() };
    }
    return parseCallOrAtom();
  };

  const parseCallOrAtom = (): ValueExpr => {
    if (at("IDENT") && tokens[i + 1]?.kind === "LPAREN") {
      const nameTok = consume("IDENT");
      consume("LPAREN");
      const args: ValueExpr[] = [];
      if (!at("RPAREN")) {
        args.push(parseValueExpr());
        while (at("COMMA")) {
          consume("COMMA");
          args.push(parseValueExpr());
        }
      }
      consume("RPAREN", ")");
      return { type: "call", name: nameTok.value, args };
    }
    return parseAtom();
  };

  /** Composite date literals: INT - INT [- INT] */
  const tryParseCompositeAtom = (): ValueExpr | null => {
    if (!at("INT")) return null;
    if (tokens[i + 1]?.kind !== "MINUS" || tokens[i + 2]?.kind !== "INT") {
      return null;
    }
    // Lookahead: if after INT-INT we have another -INT → dateMonthYear
    // or OP/between/etc ends it as dateMonth or monthYear depending on context.
    // Ambiguity: 07-2026 is monthYear; 15-07 is dateMonth; 01-01-2026 is dmy.
    const a = Number(tokens[i]!.value);
    const b = Number(tokens[i + 2]!.value);
    const hasThird =
      tokens[i + 3]?.kind === "MINUS" && tokens[i + 4]?.kind === "INT";

    if (hasThird) {
      const c = Number(tokens[i + 4]!.value);
      i += 5;
      return {
        type: "composite",
        kind: "dateMonthYear",
        value: { day: a, month: b, year: c },
      };
    }

    // Heuristic: if second number looks like a year (>= 1000) → monthYear
    if (b >= 1000) {
      i += 3;
      return {
        type: "composite",
        kind: "monthYear",
        value: { month: a, year: b },
      };
    }
    i += 3;
    return {
      type: "composite",
      kind: "dateMonth",
      value: { day: a, month: b },
    };
  };

  const parseAtom = (): ValueExpr => {
    if (at("LPAREN")) {
      consume("LPAREN");
      const inner = parseValueExpr();
      consume("RPAREN", ")");
      return { type: "paren", expr: inner };
    }

    const composite = tryParseCompositeAtom();
    if (composite) return composite;

    if (at("INT")) {
      const t = consume("INT");
      return { type: "num", value: Number(t.value) };
    }

    if (at("IDENT")) {
      const t = consume("IDENT");
      if (
        MONTH_SET.has(t.value) ||
        WEEKDAY_SET.has(t.value) ||
        t.value === "am" ||
        t.value === "pm"
      ) {
        return { type: "named", value: t.value };
      }
      return { type: "ref", name: REF_CANON[t.value] ?? t.value };
    }

    throw new ParseError(
      `Expected value expression, got '${peek().value || peek().kind}'`,
      peek().pos,
    );
  };

  const expectHyphen = () => {
    if (at("MINUS")) {
      consume("MINUS");
      return;
    }
    throw new ParseError("Expected '-' in date literal", peek().pos);
  };

  const parseLiteral = (field: TimeField): FieldLiteral => {
    switch (field) {
      case "date":
      case "hour":
      case "year":
      case "lastDay":
      case "monthLength":
      case "prevLastDay":
        return parseIntLit(field);
      case "month":
        return parseMonthLit();
      case "weekday":
        return parseWeekdayLit();
      case "meridiem":
        return parseMeridiemLit();
      case "dateMonth":
        return parseDateMonthLit();
      case "monthYear":
        return parseMonthYearLit();
      case "dateMonthYear":
        return parseDateMonthYearLit();
    }
  };

  const parseIntLit = (field: TimeField): number => {
    const t = consume("INT", "number");
    const n = Number(t.value);
    if (
      (field === "date" ||
        field === "lastDay" ||
        field === "monthLength" ||
        field === "prevLastDay") &&
      (n < 1 || n > 31)
    ) {
      throw new ParseError(`${field} must be 1–31, got ${n}`, t.pos);
    }
    if (field === "hour" && (n < 0 || n > 23)) {
      throw new ParseError(`hour must be 0–23, got ${n}`, t.pos);
    }
    if (field === "year" && (n < 1 || n > 9999)) {
      throw new ParseError(`invalid year ${n}`, t.pos);
    }
    return n;
  };

  const parseMonthLit = (): MonthName | number => {
    if (at("IDENT")) {
      const t = consume("IDENT");
      if (!MONTH_SET.has(t.value)) {
        throw new ParseError(`Expected month name, got '${t.value}'`, t.pos);
      }
      return t.value as MonthName;
    }
    const t = consume("INT", "month");
    const n = Number(t.value);
    if (n < 1 || n > 12) throw new ParseError(`month must be 1–12, got ${n}`, t.pos);
    return n;
  };

  const parseWeekdayLit = (): WeekdayName | number => {
    if (at("IDENT")) {
      const t = consume("IDENT");
      if (!WEEKDAY_SET.has(t.value)) {
        throw new ParseError(`Expected weekday name, got '${t.value}'`, t.pos);
      }
      return t.value as WeekdayName;
    }
    const t = consume("INT", "weekday");
    const n = Number(t.value);
    if (n < 1 || n > 7)
      throw new ParseError(`weekday must be 1–7 (mon–sun), got ${n}`, t.pos);
    return n;
  };

  const parseMeridiemLit = (): "am" | "pm" => {
    const t = consume("IDENT", "am|pm");
    if (t.value !== "am" && t.value !== "pm") {
      throw new ParseError(`Expected am|pm, got '${t.value}'`, t.pos);
    }
    return t.value;
  };

  const parseDateMonthLit = (): { day: number; month: number } => {
    const dayTok = consume("INT", "day");
    expectHyphen();
    let month: number;
    if (at("IDENT") && MONTH_SET.has(peek().value)) {
      const m = consume("IDENT");
      month = MONTH_TO_NUM[m.value as MonthName];
    } else {
      const mTok = consume("INT", "month");
      month = Number(mTok.value);
      if (month < 1 || month > 12) {
        throw new ParseError(`month must be 1–12, got ${month}`, mTok.pos);
      }
    }
    const day = Number(dayTok.value);
    if (day < 1 || day > 31)
      throw new ParseError(`day must be 1–31, got ${day}`, dayTok.pos);
    return { day, month };
  };

  const parseMonthYearLit = (): { month: number; year: number } => {
    let month: number;
    if (at("IDENT") && MONTH_SET.has(peek().value)) {
      const m = consume("IDENT");
      month = MONTH_TO_NUM[m.value as MonthName];
    } else {
      const mTok = consume("INT", "month");
      month = Number(mTok.value);
      if (month < 1 || month > 12) {
        throw new ParseError(`month must be 1–12, got ${month}`, mTok.pos);
      }
    }
    expectHyphen();
    const yTok = consume("INT", "year");
    return { month, year: Number(yTok.value) };
  };

  const parseDateMonthYearLit = (): {
    day: number;
    month: number;
    year: number;
  } => {
    const dayTok = consume("INT", "day");
    expectHyphen();
    let month: number;
    if (at("IDENT") && MONTH_SET.has(peek().value)) {
      const m = consume("IDENT");
      month = MONTH_TO_NUM[m.value as MonthName];
    } else {
      const mTok = consume("INT", "month");
      month = Number(mTok.value);
      if (month < 1 || month > 12) {
        throw new ParseError(`month must be 1–12, got ${month}`, mTok.pos);
      }
    }
    expectHyphen();
    const yTok = consume("INT", "year");
    const day = Number(dayTok.value);
    if (day < 1 || day > 31)
      throw new ParseError(`day must be 1–31, got ${day}`, dayTok.pos);
    return { day, month, year: Number(yTok.value) };
  };

  /** Field-directed value: prefer classic literals when no arithmetic. */
  const parseFieldValue = (field: TimeField): ValueExpr => {
    // `in` still uses literals; compare/between use this.
    // If next tokens look like a simple field literal without ops, use lit.
    // Otherwise parse general value_expr.
    const start = i;
    try {
      if (
        field === "dateMonth" ||
        field === "monthYear" ||
        field === "dateMonthYear" ||
        field === "month" ||
        field === "weekday" ||
        field === "meridiem"
      ) {
        // Try literal first if it consumes cleanly up to a stopper
        const litStart = i;
        const lit = parseLiteral(field);
        const stop =
          at("EOF") ||
          at("AND") ||
          at("OR") ||
          at("RPAREN") ||
          at("DOTDOT") ||
          at("COMMA") ||
          at("RBRACK") ||
          at("RBRACE") ||
          at("SEMICOLON");
        // Also stop if next is binary op that would continue value expr —
        // then literal-only parse was wrong for date/hour; for named fields
        // binary after month name is rare. If PLUS/MINUS/STAR/SLASH follow, reparse as value.
        if (
          stop ||
          !(at("PLUS") || at("MINUS") || at("STAR") || at("SLASH") || at("LPAREN"))
        ) {
          // If we stopped because of binary op, rewind
          if (at("PLUS") || at("MINUS") || at("STAR") || at("SLASH")) {
            i = litStart;
          } else {
            return fieldLiteralToValueExpr(field, lit);
          }
        } else {
          i = litStart;
        }
      } else if (
        field === "date" ||
        field === "hour" ||
        field === "year" ||
        field === "lastDay" ||
        field === "monthLength" ||
        field === "prevLastDay"
      ) {
        // If single INT and no following arithmetic, keep as num (with range check)
        if (
          at("INT") &&
          tokens[i + 1]?.kind !== "PLUS" &&
          tokens[i + 1]?.kind !== "STAR" &&
          tokens[i + 1]?.kind !== "SLASH" &&
          tokens[i + 1]?.kind !== "LPAREN"
        ) {
          // MINUS + INT could be binary `15 - 1` — use value expr
          if (tokens[i + 1]?.kind === "MINUS") {
            return parseValueExpr();
          }
          return fieldLiteralToValueExpr(field, parseIntLit(field));
        }
      }
    } catch (e) {
      if (
        e instanceof ParseError &&
        /must be|invalid year|Expected/.test(e.message)
      ) {
        // Re-throw literal validation / hard parse errors (e.g. hour == 25)
        // only when we weren't attempting a soft fallback for composites.
        if (
          field === "date" ||
          field === "hour" ||
          field === "year" ||
          field === "lastDay" ||
          field === "monthLength" ||
          field === "prevLastDay"
        ) {
          throw e;
        }
      }
      i = start;
    }
    return parseValueExpr();
  };

  const parseBoolExpr = (): BoolAstNode => parseOr();

  const parseOr = (): BoolAstNode => {
    const children: BoolAstNode[] = [parseAnd()];
    while (at("OR")) {
      consume("OR");
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0]! : { type: "or", children };
  };

  const parseAnd = (): BoolAstNode => {
    const children: BoolAstNode[] = [parseNot()];
    while (at("AND")) {
      consume("AND");
      children.push(parseNot());
    }
    return children.length === 1 ? children[0]! : { type: "and", children };
  };

  const parseNot = (): BoolAstNode => {
    if (at("NOT")) {
      consume("NOT");
      return { type: "not", child: parseNot() };
    }
    return parsePrimary();
  };

  const parsePrimary = (): BoolAstNode => {
    if (at("LPAREN")) {
      // Could be grouping bool OR start of value — bool grouping: (date == 1)
      // Lookahead: after (, if field cmp or checked/weekend/!/( → bool group
      consume("LPAREN");
      const inner = parseBoolExpr();
      consume("RPAREN", ")");
      return { type: "group", child: inner };
    }
    if (at("CHECKED") || at("NOT_CHECKED")) {
      return parseStatus();
    }
    if (at("WEEKEND")) {
      consume("WEEKEND");
      return { type: "weekend" };
    }
    return parseTimePred();
  };

  const parseStatus = (): BoolAstNode => {
    const t = consume();
    const checked = t.kind === "CHECKED";
    if (at("LPAREN")) {
      consume("LPAREN");
      let itemId: string;
      if (at("STRING")) {
        itemId = consume("STRING").value;
      } else if (at("INT")) {
        itemId = consume("INT").value;
      } else if (at("IDENT")) {
        itemId = consume("IDENT").value;
      } else {
        throw new ParseError(
          "Expected item id (string or number)",
          peek().pos,
        );
      }
      if (!itemId) {
        throw new ParseError("Empty item id", peek().pos);
      }
      consume("RPAREN", ")");
      return { type: "status", checked, itemId };
    }
    return { type: "status", checked };
  };

  const parseTimePred = (): BoolAstNode => {
    const fieldTok = consume("IDENT", "time field");
    const field = FIELD_BY_LOWER[fieldTok.value];
    if (!field) {
      throw new ParseError(`Unknown field '${fieldTok.value}'`, fieldTok.pos);
    }

    if (at("BETWEEN")) {
      consume("BETWEEN");
      const from = parseFieldValue(field);
      consume("DOTDOT", "..");
      const to = parseFieldValue(field);
      return { type: "between", field, from, to };
    }

    if (at("IN")) {
      consume("IN");
      consume("LBRACK", "[");
      const values: FieldLiteral[] = [parseLiteral(field)];
      while (at("COMMA")) {
        consume("COMMA");
        values.push(parseLiteral(field));
      }
      consume("RBRACK", "]");
      return { type: "in", field, values };
    }

    if (at("OP")) {
      const opTok = consume("OP");
      const op = opTok.value as CmpOp;
      const value = parseFieldValue(field);
      return { type: "compare", field, op, value };
    }

    throw new ParseError(
      `Expected comparison operator, 'between', or 'in' after field '${field}'`,
      peek().pos,
    );
  };

  const parseFnDef = (): FnDef => {
    consume("FN");
    const nameTok = consume("IDENT", "function name");
    const name = nameTok.value;
    if (
      TIME_FIELDS.map((f) => f.toLowerCase()).includes(name) ||
      name === "lastday" ||
      name === "monthlength" ||
      MONTH_SET.has(name) ||
      WEEKDAY_SET.has(name)
    ) {
      throw new ParseError(
        `Cannot use reserved name '${name}' as function`,
        nameTok.pos,
      );
    }
    consume("LPAREN", "(");
    const params: string[] = [];
    if (!at("RPAREN")) {
      params.push(consume("IDENT", "parameter").value);
      while (at("COMMA")) {
        consume("COMMA");
        params.push(consume("IDENT", "parameter").value);
      }
    }
    consume("RPAREN", ")");
    consume("LBRACE", "{");
    const body = parseValueExpr();
    consume("RBRACE", "}");
    return { name, params, body };
  };

  if (!input.trim()) {
    return { type: "true" };
  }

  const functions: FnDef[] = [];
  const lets: LetDef[] = [];

  while (at("FN") || at("LET")) {
    if (at("FN")) {
      functions.push(parseFnDef());
    } else {
      consume("LET");
      const nameTok = consume("IDENT", "variable name");
      const name = nameTok.value;
      if (
        TIME_FIELDS.map((f) => f.toLowerCase()).includes(name) ||
        name === "lastday" ||
        name === "monthlength"
      ) {
        throw new ParseError(
          `Cannot shadow calendar ref '${name}'`,
          nameTok.pos,
        );
      }
      consume("ASSIGN", "=");
      const value = parseValueExpr();
      if (at("SEMICOLON")) consume("SEMICOLON");
      lets.push({ name, value });
    }
  }

  const body = parseBoolExpr();
  if (!at("EOF")) {
    throw new ParseError(`Unexpected token '${peek().value}'`, peek().pos);
  }

  if (functions.length === 0 && lets.length === 0) {
    return body;
  }
  return { type: "program", functions, lets, body };
}

export function tryParse(
  input: string,
): { ok: true; ast: AstNode } | { ok: false; error: string; pos: number } {
  try {
    return { ok: true, ast: parse(input) };
  } catch (e) {
    if (e instanceof ParseError) {
      return { ok: false, error: e.message, pos: e.pos };
    }
    throw e;
  }
}

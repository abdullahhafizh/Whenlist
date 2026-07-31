/**
 * Grammar (BNF) — Whenlist DSL
 *
 * program     ::= definition* bool_expr
 * definition  ::= fn_def | let_def
 * fn_def      ::= "fn" IDENT "(" [IDENT ("," IDENT)*] ")" "{" value_expr "}"
 * let_def     ::= "let" IDENT "=" value_expr ";"
 *
 * bool_expr   ::= or_expr
 * or_expr     ::= and_expr ( "||" and_expr )*
 * and_expr    ::= not_expr ( "&&" not_expr )*
 * not_expr    ::= "!" not_expr | primary
 * primary     ::= "(" bool_expr ")" | predicate
 * predicate   ::= time_pred | status_pred
 *
 * time_pred   ::= field cmp_op value_expr
 *               | field "between" value_expr ".." value_expr
 *               | field "in" "[" field_literal ( "," field_literal )* "]"
 *
 * value_expr  ::= add_expr
 * add_expr    ::= mul_expr ( ("+" | "-") mul_expr )*
 * mul_expr    ::= unary_expr ( ("*" | "/") unary_expr )*
 * unary_expr  ::= ("+" | "-") unary_expr | call_expr
 * call_expr   ::= IDENT "(" [value_expr ("," value_expr)*] ")" | atom
 * atom        ::= INT | IDENT | field_literal_composite | "(" value_expr ")"
 *
 * Built-in refs (numeric): date, month, year, hour, weekday, lastDay, monthLength, prevLastDay
 * Built-in calls: ceil, floor, round, abs, min, max
 * Custom fn: defined via fn_def; body is value_expr; call by name
 *
 * field       ::= "date" | "month" | "year" | "hour" | "weekday" | "meridiem"
 *               | "dateMonth" | "monthYear" | "dateMonthYear"
 *               | "lastDay" | "monthLength" | "prevLastDay"
 *
 * cmp_op      ::= "==" | "!=" | ">=" | "<=" | ">" | "<"
 *
 * status_pred ::= ( "checked" | "notChecked" ) [ "(" string_or_id ")" ]
 *               | "weekend"
 *
 * field_literal remains field-directed for `in` lists and named/composite atoms.
 */

export type TimeField =
  | "date"
  | "month"
  | "year"
  | "hour"
  | "weekday"
  | "meridiem"
  | "dateMonth"
  | "monthYear"
  | "dateMonthYear"
  | "lastDay"
  | "monthLength"
  | "prevLastDay";

export type CmpOp = "==" | "!=" | ">=" | "<=" | ">" | "<";

export type MonthName =
  | "jan"
  | "feb"
  | "mar"
  | "apr"
  | "may"
  | "jun"
  | "jul"
  | "aug"
  | "sep"
  | "oct"
  | "nov"
  | "dec";

export type WeekdayName =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

export type Meridiem = "am" | "pm";

export type DateLit = number;
export type HourLit = number;
export type YearLit = number;

export type DateMonthLit = { day: number; month: number };
export type MonthYearLit = { month: number; year: number };
export type DateMonthYearLit = { day: number; month: number; year: number };

export type FieldLiteral =
  | DateLit
  | HourLit
  | YearLit
  | MonthName
  | WeekdayName
  | Meridiem
  | DateMonthLit
  | MonthYearLit
  | DateMonthYearLit;

export type BinaryOp = "+" | "-" | "*" | "/";

export type ValueExpr =
  | { type: "num"; value: number }
  | { type: "named"; value: string }
  | {
      type: "composite";
      kind: "dateMonth" | "monthYear" | "dateMonthYear";
      value: DateMonthLit | MonthYearLit | DateMonthYearLit;
    }
  | { type: "ref"; name: string }
  | { type: "binary"; op: BinaryOp; left: ValueExpr; right: ValueExpr }
  | { type: "unary"; op: "+" | "-"; arg: ValueExpr }
  | { type: "call"; name: string; args: ValueExpr[] }
  | { type: "paren"; expr: ValueExpr };

export type FnDef = {
  name: string;
  params: string[];
  body: ValueExpr;
};

export type LetDef = {
  name: string;
  value: ValueExpr;
};

export type CompareNode = {
  type: "compare";
  field: TimeField;
  op: CmpOp;
  value: ValueExpr;
};

export type BetweenNode = {
  type: "between";
  field: TimeField;
  from: ValueExpr;
  to: ValueExpr;
};

export type InNode = {
  type: "in";
  field: TimeField;
  values: FieldLiteral[];
};

export type StatusNode = {
  type: "status";
  checked: boolean;
  itemId?: string;
};

export type WeekendNode = { type: "weekend" };

export type AndNode = { type: "and"; children: BoolAstNode[] };
export type OrNode = { type: "or"; children: BoolAstNode[] };
export type NotNode = { type: "not"; child: BoolAstNode };
export type GroupNode = { type: "group"; child: BoolAstNode };
export type TrueNode = { type: "true" };

/** Boolean AST nodes (program.body never contains nested program). */
export type BoolAstNode =
  | CompareNode
  | BetweenNode
  | InNode
  | StatusNode
  | WeekendNode
  | AndNode
  | OrNode
  | NotNode
  | GroupNode
  | TrueNode;

export type ProgramNode = {
  type: "program";
  functions: FnDef[];
  lets: LetDef[];
  body: BoolAstNode;
};

export type AstNode = BoolAstNode | ProgramNode;

export type CompletionMode = "once" | "while_valid";

export const TIME_FIELDS: readonly TimeField[] = [
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
  "prevLastDay",
] as const;

export const CYCLIC_FIELDS: ReadonlySet<TimeField> = new Set([
  "date",
  "month",
  "hour",
  "weekday",
  "dateMonth",
]);

export const LINEAR_FIELDS: ReadonlySet<TimeField> = new Set([
  "year",
  "monthYear",
  "dateMonthYear",
]);

export const MONTH_NAMES: readonly MonthName[] = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

export const WEEKDAY_NAMES: readonly WeekdayName[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const MONTH_TO_NUM: Record<MonthName, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export const WEEKDAY_TO_NUM: Record<WeekdayName, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

export const NUM_TO_MONTH: Record<number, MonthName> = Object.fromEntries(
  Object.entries(MONTH_TO_NUM).map(([k, v]) => [v, k]),
) as Record<number, MonthName>;

export const NUM_TO_WEEKDAY: Record<number, WeekdayName> = Object.fromEntries(
  Object.entries(WEEKDAY_TO_NUM).map(([k, v]) => [v, k]),
) as Record<number, WeekdayName>;

/** Built-in numeric calendar refs usable in value expressions. */
export const NUMERIC_REFS = [
  "date",
  "month",
  "year",
  "hour",
  "weekday",
  "lastDay",
  "monthLength",
  "prevLastDay",
] as const;

export type NumericRef = (typeof NUMERIC_REFS)[number];

export const BUILTIN_FUNCS = [
  "ceil",
  "floor",
  "round",
  "abs",
  "min",
  "max",
] as const;

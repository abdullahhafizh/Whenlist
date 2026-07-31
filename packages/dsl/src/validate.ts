import {
  type AstNode,
  type BoolAstNode,
  type TimeField,
  type ValueExpr,
  CYCLIC_FIELDS,
  LINEAR_FIELDS,
} from "./ast.js";
import { collectDependencies, programParts } from "./evaluate.js";
import { parse, ParseError } from "./parser.js";
import { valueExprToFieldLiteral, ordinalFromLiteral } from "./value.js";

export type ValidationIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type ValidateOptions = {
  selfId?: string;
  knownIds?: Set<string> | string[];
  existingDeps?: Map<string, string[]> | Record<string, string[]>;
};

function tryConstOrdinal(
  field: TimeField,
  expr: ValueExpr,
): number | null {
  const lit = valueExprToFieldLiteral(field, expr);
  if (lit !== null) return ordinalFromLiteral(field, lit);
  if (expr.type === "num") return expr.value;
  if (expr.type === "paren") return tryConstOrdinal(field, expr.expr);
  return null;
}

function walkValidate(
  node: BoolAstNode,
  path: string,
  issues: ValidationIssue[],
): void {
  switch (node.type) {
    case "between": {
      const from = tryConstOrdinal(node.field, node.from);
      const to = tryConstOrdinal(node.field, node.to);
      if (from !== null && to !== null && from > to) {
        if (LINEAR_FIELDS.has(node.field)) {
          issues.push({
            path,
            message: `Reversed range for linear field '${node.field}': ${from} .. ${to}`,
            severity: "error",
          });
        } else if (CYCLIC_FIELDS.has(node.field)) {
          issues.push({
            path,
            message: `Wrap-around range for '${node.field}' (${from} .. ${to})`,
            severity: "warning",
          });
        }
      }
      break;
    }
    case "in":
      if (node.values.length === 0) {
        issues.push({ path, message: "Empty 'in' list", severity: "error" });
      }
      break;
    case "and":
      node.children.forEach((c, i) =>
        walkValidate(c, `${path}/${node.type}[${i}]`, issues),
      );
      break;
    case "or":
      if (node.children.length === 0) {
        issues.push({
          path,
          message: "Empty OR group",
          severity: "error",
        });
      }
      node.children.forEach((c, i) =>
        walkValidate(c, `${path}/${node.type}[${i}]`, issues),
      );
      break;
    case "true":
    case "compare":
    case "status":
    case "weekend":
      break;
    case "group":
      walkValidate(node.child, `${path}/group`, issues);
      break;
    case "not":
      walkValidate(node.child, `${path}/not`, issues);
      break;
  }
}

function toDepMap(
  existing?: Map<string, string[]> | Record<string, string[]>,
): Map<string, string[]> {
  if (!existing) return new Map();
  if (existing instanceof Map) return existing;
  return new Map(Object.entries(existing).map(([k, v]) => [k, v as string[]]));
}

export function findCycle(
  selfId: string,
  newDeps: string[],
  existingDeps: Map<string, string[]>,
): string[] | null {
  if (newDeps.includes(selfId)) {
    return [selfId, selfId];
  }

  const graph = new Map(existingDeps);
  graph.set(selfId, newDeps);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (node: string): string[] | null => {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      return [...stack.slice(idx), node];
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  return dfs(selfId);
}

export function validateAst(
  ast: AstNode,
  options: ValidateOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { body, functions, lets } = programParts(ast);

  const fnNames = new Set<string>();
  for (const fn of functions) {
    if (fnNames.has(fn.name)) {
      issues.push({
        path: "",
        message: `Duplicate function '${fn.name}'`,
        severity: "error",
      });
    }
    fnNames.add(fn.name);
  }
  const letNames = new Set<string>();
  for (const binding of lets) {
    if (letNames.has(binding.name)) {
      issues.push({
        path: "",
        message: `Duplicate let '${binding.name}'`,
        severity: "error",
      });
    }
    letNames.add(binding.name);
  }

  walkValidate(body, "", issues);

  const deps = collectDependencies(ast);
  const known =
    options.knownIds instanceof Set
      ? options.knownIds
      : options.knownIds
        ? new Set(options.knownIds)
        : undefined;

  for (const id of deps) {
    if (options.selfId !== undefined && id === options.selfId) {
      issues.push({
        path: "",
        message: `Item cannot depend on itself (checked(${id}))`,
        severity: "error",
      });
    }
    if (known && !known.has(id)) {
      issues.push({
        path: "",
        message: `Referenced checklist item id ${id} does not exist`,
        severity: "error",
      });
    }
  }

  if (options.selfId !== undefined) {
    const cycle = findCycle(
      options.selfId,
      deps,
      toDepMap(options.existingDeps),
    );
    if (cycle) {
      issues.push({
        path: "",
        message: `Circular dependency detected: ${cycle.join(" → ")}`,
        severity: "error",
      });
    }
  }

  return issues;
}

export function validateFormula(
  formula: string,
  options: ValidateOptions = {},
):
  | { ok: true; ast: AstNode; issues: ValidationIssue[] }
  | {
      ok: false;
      error: string;
      pos: number;
      issues: ValidationIssue[];
    } {
  try {
    const ast = parse(formula);
    const issues = validateAst(ast, options);
    const hasError = issues.some((i) => i.severity === "error");
    if (hasError) {
      return {
        ok: false,
        error: issues.find((i) => i.severity === "error")!.message,
        pos: 0,
        issues,
      };
    }
    return { ok: true, ast, issues };
  } catch (e) {
    if (e instanceof ParseError) {
      return {
        ok: false,
        error: e.message,
        pos: e.pos,
        issues: [{ path: "", message: e.message, severity: "error" }],
      };
    }
    throw e;
  }
}

export function topologicalSort(
  itemIds: string[],
  deps: Map<string, string[]> | Record<string, string[]>,
): string[] {
  const graph = toDepMap(deps);
  const idSet = new Set(itemIds);
  const result: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Circular dependency involving item ${id}`);
    }
    visiting.add(id);
    for (const d of graph.get(id) ?? []) {
      if (idSet.has(d)) visit(d);
    }
    visiting.delete(id);
    visited.add(id);
    result.push(id);
  };

  for (const id of itemIds) visit(id);
  return result;
}

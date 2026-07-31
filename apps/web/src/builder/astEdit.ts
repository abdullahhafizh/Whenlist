import {
  type AstNode,
  type FieldLiteral,
  type TimeField,
  fieldLiteralToValueExpr,
} from "@whenlist/dsl";
import { MONTH_NAMES, WEEKDAY_NAMES } from "@whenlist/dsl";

export type BlockKind =
  | "and"
  | "or"
  | "group"
  | "not"
  | "compare"
  | "between"
  | "in"
  | "status"
  | "weekend";

export type PaletteItem = {
  id: string;
  kind: BlockKind;
  label: string;
  field?: TimeField;
  /** For compare/between/in defaults */
  variant?: "eq" | "between" | "in";
  statusChecked?: boolean;
  withId?: boolean;
};

function defaultLit(field: TimeField): FieldLiteral {
  switch (field) {
    case "date":
    case "lastDay":
    case "monthLength":
      return field === "date" ? 1 : 31;
    case "hour":
      return 9;
    case "year":
      return new Date().getFullYear();
    case "month":
      return "jan";
    case "weekday":
      return "mon";
    case "meridiem":
      return "am";
    case "dateMonth":
      return { day: 1, month: 1 };
    case "monthYear":
      return { month: 1, year: new Date().getFullYear() };
    case "dateMonthYear": {
      const y = new Date().getFullYear();
      return { day: 1, month: 1, year: y };
    }
  }
}

export function createDefaultNode(item: PaletteItem): AstNode {
  switch (item.kind) {
    case "and":
      return { type: "and", children: [] };
    case "or":
      return { type: "or", children: [] };
    case "group":
      return { type: "group", child: { type: "and", children: [] } };
    case "not":
      return { type: "not", child: { type: "status", checked: true } };
    case "status":
      return item.withId
        ? {
            type: "status",
            checked: item.statusChecked ?? true,
            itemId: "",
          }
        : { type: "status", checked: item.statusChecked ?? true };
    case "weekend":
      return { type: "weekend" };
    case "compare": {
      const field = item.field!;
      return {
        type: "compare",
        field,
        op: "==",
        value: fieldLiteralToValueExpr(field, defaultLit(field)),
      };
    }
    case "between": {
      const field = item.field!;
      const from = defaultLit(field);
      let to = defaultLit(field);
      if (field === "date") to = 7;
      if (field === "hour") to = 17;
      if (field === "weekday") to = "fri";
      return {
        type: "between",
        field,
        from: fieldLiteralToValueExpr(field, from),
        to: fieldLiteralToValueExpr(field, to),
      };
    }
    case "in": {
      const field = item.field!;
      return { type: "in", field, values: [defaultLit(field)] };
    }
  }
}

export const PALETTE: PaletteItem[] = [
  { id: "and", kind: "and", label: "AND" },
  { id: "or", kind: "or", label: "OR" },
  { id: "group", kind: "group", label: "Group ( )" },
  { id: "not", kind: "not", label: "NOT" },
  ...([
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
  ] as TimeField[]).flatMap((field) => [
    {
      id: `${field}-eq`,
      kind: "compare" as const,
      label: `${field} ==`,
      field,
    },
    {
      id: `${field}-between`,
      kind: "between" as const,
      label: `${field} between`,
      field,
    },
    {
      id: `${field}-in`,
      kind: "in" as const,
      label: `${field} in`,
      field,
    },
  ]),
  {
    id: "weekend",
    kind: "weekend",
    label: "weekend",
  },
  {
    id: "checked-self",
    kind: "status",
    label: "checked (self)",
    statusChecked: true,
  },
  {
    id: "notchecked-self",
    kind: "status",
    label: "notChecked (self)",
    statusChecked: false,
  },
  {
    id: "checked-id",
    kind: "status",
    label: "checked(id)",
    statusChecked: true,
    withId: true,
  },
  {
    id: "notchecked-id",
    kind: "status",
    label: "notChecked(id)",
    statusChecked: false,
    withId: true,
  },
];

export function isContainer(node: AstNode): boolean {
  return (
    node.type === "program" ||
    node.type === "and" ||
    node.type === "or" ||
    node.type === "group" ||
    node.type === "not"
  );
}

export function getChildren(node: AstNode): AstNode[] {
  switch (node.type) {
    case "program":
      return [node.body];
    case "and":
    case "or":
      return node.children;
    case "group":
    case "not":
      return [node.child];
    default:
      return [];
  }
}

/** Immutable update helper: replace node at path (array of child indices). */
export function updateAt(
  root: AstNode | null,
  path: number[],
  updater: (n: AstNode) => AstNode,
): AstNode | null {
  if (!root) return null;
  if (path.length === 0) return updater(root);

  const clone = structuredClone(root) as AstNode;

  const apply = (node: AstNode, p: number[]): AstNode => {
    if (p.length === 0) return updater(node);
    const [i, ...r] = p;
    if (node.type === "program") {
      return { ...node, body: apply(node.body, r) as typeof node.body };
    }
    if (node.type === "and" || node.type === "or") {
      const children = [...node.children];
      children[i!] = apply(children[i!]!, r) as (typeof children)[number];
      return { ...node, children };
    }
    if (node.type === "group" || node.type === "not") {
      return { ...node, child: apply(node.child, r) as typeof node.child };
    }
    return node;
  };

  return apply(clone, path);
}

export function removeAt(root: AstNode, path: number[]): AstNode | null {
  if (path.length === 0) return null;

  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1]!;

  return updateAt(root, parentPath, (parent) => {
    if (parent.type === "and" || parent.type === "or") {
      return {
        ...parent,
        children: parent.children.filter((_, i) => i !== index),
      };
    }
    if (parent.type === "program") {
      return {
        ...parent,
        body: { type: "and", children: [] },
      };
    }
    if (parent.type === "group" || parent.type === "not") {
      return parent.type === "group"
        ? { type: "group", child: { type: "and", children: [] } }
        : { type: "not", child: { type: "status", checked: true } };
    }
    return parent;
  });
}

export function insertChild(
  root: AstNode,
  parentPath: number[],
  index: number,
  child: AstNode,
): AstNode {
  return (
    updateAt(root, parentPath, (parent) => {
      if (parent.type === "and" || parent.type === "or") {
        const children = [...parent.children];
        children.splice(index, 0, child as (typeof children)[number]);
        return { ...parent, children };
      }
      if (parent.type === "program") {
        return { ...parent, body: child as typeof parent.body };
      }
      if (parent.type === "group" || parent.type === "not") {
        return { ...parent, child: child as typeof parent.child };
      }
      return parent;
    }) ?? root
  );
}

export function duplicateAt(root: AstNode, path: number[]): AstNode {
  if (path.length === 0) return structuredClone(root);

  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1]!;

  let copy: AstNode | null = null;
  const withCopy =
    updateAt(root, path, (n) => {
      copy = structuredClone(n);
      return n;
    }) ?? root;

  if (!copy) return root;
  return insertChild(withCopy, parentPath, index + 1, copy);
}

export function nodeErrors(
  node: AstNode,
  knownIds: Set<string>,
  selfId?: string,
): string[] {
  const errs: string[] = [];
  switch (node.type) {
    case "and":
      // Empty AND is always-true — allowed (once forever)
      break;
    case "or":
      if (node.children.length === 0) errs.push("Empty OR group");
      break;
    case "between":
      break;
    case "in":
      if (node.values.length === 0) errs.push("Empty list");
      break;
    case "status":
      if (node.itemId !== undefined) {
        if (!node.itemId) errs.push("Select an item id");
        else if (selfId !== undefined && node.itemId === selfId)
          errs.push("Cannot reference self");
        else if (!knownIds.has(node.itemId))
          errs.push(`Unknown id`);
      }
      break;
  }
  return errs;
}

export { MONTH_NAMES, WEEKDAY_NAMES };
export type { AstNode, TimeField, FieldLiteral };

import type { DragEvent } from "react";
import { serializeValueExpr, type AstNode } from "@whenlist/dsl";
import type { ItemRecord } from "../api";
import BlockForm from "./BlockForm";
import DropSlot, { isBuilderDrag, markBuilderDragging } from "./DropSlot";
import {
  setBuilderDrag,
  titleForAstType,
  toneForAstType,
} from "./builderDrag";
import {
  createDefaultNode,
  nodeErrors,
  type PaletteItem,
} from "./astEdit";

type Props = {
  node: AstNode;
  path: number[];
  items: ItemRecord[];
  knownIds: Set<string>;
  selfId?: string;
  readOnly?: boolean;
  onChange: (path: number[], node: AstNode) => void;
  onRemove: (path: number[]) => void;
  onDuplicate: (path: number[]) => void;
  onDropPalette: (parentPath: number[], index: number, item: PaletteItem) => void;
  onMove: (fromPath: number[], toParentPath: number[], toIndex: number) => void;
};

const CONTAINER_COLORS: Record<string, string> = {
  and: "border-amber-300 bg-amber-50/50",
  or: "border-sky-300 bg-sky-50/50",
  group: "border-violet-300 bg-violet-50/40",
  not: "border-rose-300 bg-rose-50/40",
  program: "border-teal-300 bg-teal-50/40",
};

function isStructurallyEmpty(node: AstNode): boolean {
  switch (node.type) {
    case "and":
    case "or":
      return node.children.length === 0;
    case "group":
    case "not":
      return isStructurallyEmpty(node.child);
    case "program":
      return isStructurallyEmpty(node.body);
    case "true":
      return true;
    default:
      return false;
  }
}

export default function BlockNode({
  node,
  path,
  items,
  knownIds,
  selfId,
  readOnly,
  onChange,
  onRemove,
  onDuplicate,
  onDropPalette,
  onMove,
}: Props) {
  const errs = nodeErrors(node, knownIds, selfId);
  const isContainer =
    node.type === "and" ||
    node.type === "or" ||
    node.type === "group" ||
    node.type === "not" ||
    node.type === "program";

  const onDragStart = (e: DragEvent) => {
    if (readOnly) return;
    if (path.length === 0) return;
    e.dataTransfer.setData("application/x-block-path", JSON.stringify(path));
    e.dataTransfer.effectAllowed = "move";
    setBuilderDrag(e, {
      source: "block",
      title: titleForAstType(node.type),
      subtitle:
        node.type === "compare"
          ? `${node.field} ${node.op}`
          : node.type === "between"
            ? `${node.field} between`
            : undefined,
      tone: toneForAstType(node.type),
    });
    markBuilderDragging(true);
    e.stopPropagation();
  };

  const onDragEnd = () => {
    markBuilderDragging(false);
  };

  const handleDropZone = (
    e: DragEvent,
    parentPath: number[],
    index: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const palette = e.dataTransfer.getData("application/x-palette");
    if (palette) {
      onDropPalette(parentPath, index, JSON.parse(palette) as PaletteItem);
      return;
    }
    const from = e.dataTransfer.getData("application/x-block-path");
    if (from) {
      onMove(JSON.parse(from) as number[], parentPath, index);
    }
  };

  if (isContainer) {
    const label =
      (
        {
          and: "And",
          or: "Or",
          not: "Not",
          group: "Group",
          program: "Program",
        } as Record<string, string>
      )[node.type] ?? node.type.toUpperCase();
    const children =
      node.type === "and" || node.type === "or"
        ? node.children
        : node.type === "program"
          ? [node.body]
          : [node.child];
    const empty = isStructurallyEmpty(node);
    const isProgram = node.type === "program";
    const lets = isProgram ? node.lets : [];
    const fns = isProgram ? node.functions : [];

    return (
      <div
        className={`rounded-xl border-2 p-2 ${CONTAINER_COLORS[node.type]} ${
          errs.length ? "ring-2 ring-red-400" : ""
        }`}
        draggable={!readOnly && path.length > 0}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          if (!isBuilderDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          if (node.type === "and" || node.type === "or") {
            handleDropZone(e, path, node.children.length);
          } else {
            handleDropZone(e, path, 0);
          }
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold tracking-wide text-slate-700">
            {label}
          </span>
          {!readOnly && path.length > 0 && (
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded px-1.5 text-[10px] text-slate-500 hover:bg-white"
                onClick={() => onDuplicate(path)}
              >
                Dup
              </button>
              <button
                type="button"
                className="rounded px-1.5 text-[10px] text-red-500 hover:bg-white"
                onClick={() => onRemove(path)}
              >
                Del
              </button>
            </div>
          )}
        </div>

        {isProgram && (lets.length > 0 || fns.length > 0) && (
          <div className="mb-2 space-y-1.5 rounded-lg border border-teal-200 bg-white/90 px-2.5 py-2 shadow-sm">
            {lets.length > 0 && (
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-teal-700">
                  Variables
                </p>
                <ul className="mt-1 space-y-1">
                  {lets.map((binding) => (
                    <li
                      key={binding.name}
                      className="flex flex-wrap items-baseline gap-x-1.5 rounded-md bg-teal-50 px-2 py-1 font-mono text-[11px] text-teal-950"
                    >
                      <span className="rounded bg-teal-600/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-800">
                        let
                      </span>
                      <span className="font-semibold text-teal-900">
                        {binding.name}
                      </span>
                      <span className="text-teal-500">=</span>
                      <span className="break-all text-slate-700">
                        {serializeValueExpr(binding.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {fns.length > 0 && (
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-teal-700">
                  Functions
                </p>
                <ul className="mt-1 space-y-1">
                  {fns.map((fn) => (
                    <li
                      key={fn.name}
                      className="rounded-md bg-teal-50 px-2 py-1 font-mono text-[11px] text-teal-950"
                    >
                      <span className="rounded bg-teal-600/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-800">
                        fn
                      </span>{" "}
                      <span className="font-semibold">{fn.name}</span>(
                      {fn.params.join(", ")}) {"{ "}
                      {serializeValueExpr(fn.body)}
                      {" }"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {errs.length > 0 && (
          <p className="mb-1 text-[10px] text-red-600">{errs.join("; ")}</p>
        )}
        <div className="space-y-1.5 pl-1">
          {children.map((child, i) => {
            const editPath =
              node.type === "and" || node.type === "or"
                ? [...path, i]
                : [...path, 0];

            return (
              <div key={i}>
                {!readOnly && (node.type === "and" || node.type === "or") && (
                  <DropSlot
                    variant="gap"
                    onDrop={(e) => handleDropZone(e, path, i)}
                  />
                )}
                <BlockNode
                  node={child}
                  path={editPath}
                  items={items}
                  knownIds={knownIds}
                  selfId={selfId}
                  readOnly={readOnly}
                  onChange={onChange}
                  onRemove={onRemove}
                  onDuplicate={onDuplicate}
                  onDropPalette={onDropPalette}
                  onMove={onMove}
                />
              </div>
            );
          })}
          {!readOnly && (node.type === "and" || node.type === "or") && (
            <DropSlot
              variant="append"
              empty={empty}
              onDrop={(e) => handleDropZone(e, path, children.length)}
              onClick={() => {
                const item: PaletteItem = {
                  id: "compare-date",
                  kind: "compare",
                  label: "date ==",
                  field: "date",
                };
                onDropPalette(path, children.length, item);
              }}
            >
              {empty
                ? "Drop here or click to add"
                : "Drop here or click to add another"}
            </DropSlot>
          )}
          {!readOnly &&
            (node.type === "group" || node.type === "not") &&
            empty && (
              <DropSlot
                variant="replace"
                onDrop={(e) => handleDropZone(e, path, 0)}
              >
                Drop a block inside
              </DropSlot>
            )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-lg border bg-white px-2 py-1.5 shadow-sm ${
        errs.length ? "border-red-400 ring-1 ring-red-300" : "border-slate-200"
      }`}
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <BlockForm
        node={node}
        items={items}
        onChange={(n) => onChange(path, n)}
      />
      {errs.length > 0 && (
        <span className="text-[10px] text-red-600">{errs.join("; ")}</span>
      )}
      {!readOnly && (
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            className="rounded px-1 text-[10px] text-slate-400 hover:bg-slate-100"
            onClick={() => onDuplicate(path)}
          >
            Dup
          </button>
          <button
            type="button"
            className="rounded px-1 text-[10px] text-red-500 hover:bg-slate-100"
            onClick={() => onRemove(path)}
          >
            Del
          </button>
        </div>
      )}
    </div>
  );
}

export function dropPaletteNode(item: PaletteItem): AstNode {
  return createDefaultNode(item);
}

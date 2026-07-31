import type { DragEvent } from "react";
import type { AstNode } from "@whenlist/dsl";
import type { ItemRecord } from "../api";
import BlockForm from "./BlockForm";
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
    if (readOnly || path.length === 0) return;
    e.dataTransfer.setData("application/x-block-path", JSON.stringify(path));
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
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
    const childBasePath =
      node.type === "and" || node.type === "or" ? path : [...path, 0];

    return (
      <div
        className={`rounded-xl border-2 p-2 ${CONTAINER_COLORS[node.type]} ${
          errs.length ? "ring-2 ring-red-400" : ""
        }`}
        draggable={!readOnly && path.length > 0}
        onDragStart={onDragStart}
        onDragOver={(e) => {
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
        {errs.length > 0 && (
          <p className="mb-1 text-[10px] text-red-600">{errs.join("; ")}</p>
        )}
        <div className="space-y-1.5 pl-1">
          {children.map((child, i) => {
            const childPath =
              node.type === "and" || node.type === "or"
                ? [...path, i]
                : childBasePath;
            // For group/not only one child — don't remount incorrectly
            const actualPath =
              node.type === "group" || node.type === "not"
                ? [...path /* child accessed via updateAt */]
                : childPath;

            // For group/not the path to the child for remove/edit is parentPath + we update via child field.
            // Our updateAt uses indices into children arrays; for group/not index 0 means .child
            const editPath =
              node.type === "and" || node.type === "or"
                ? [...path, i]
                : [...path, 0];

            return (
              <div key={i}>
                {!readOnly && (node.type === "and" || node.type === "or") && (
                  <div
                    className="my-0.5 h-2 rounded border border-dashed border-transparent hover:border-teal-400"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
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
                {void actualPath}
              </div>
            );
          })}
          {!readOnly && (node.type === "and" || node.type === "or") && (
            <button
              type="button"
              className="w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-[11px] text-slate-400 hover:border-teal-400 hover:text-teal-700"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
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
              Drop here or click to add
            </button>
          )}
        </div>
      </div>
    );
  }

  // Leaf predicate
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-lg border bg-white px-2 py-1.5 shadow-sm ${
        errs.length ? "border-red-400 ring-1 ring-red-300" : "border-slate-200"
      }`}
      draggable={!readOnly}
      onDragStart={onDragStart}
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

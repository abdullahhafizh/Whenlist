import { useCallback, useEffect, useState } from "react";
import type { AstNode } from "@whenlist/dsl";

type Ast = AstNode | null;
type Updater = Ast | ((prev: Ast) => Ast);

type HistoryState = {
  past: Ast[];
  present: Ast;
  future: Ast[];
};

const MAX_HISTORY = 100;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    // Free-text fields keep native undo; number/checkbox/etc. use AST history
    return (
      type === "text" ||
      type === "search" ||
      type === "email" ||
      type === "password" ||
      type === "url" ||
      type === "" ||
      type === undefined
    );
  }
  return false;
}

/**
 * Undo/redo stack for the formula AST.
 * - commitAst: push previous present onto past (formula edits)
 * - replaceAst: reset stacks (load item / New)
 */
export function useAstHistory(initial: Ast) {
  const [hist, setHist] = useState<HistoryState>({
    past: [],
    present: initial,
    future: [],
  });

  const commitAst = useCallback((nextOrFn: Updater) => {
    setHist((h) => {
      const next =
        typeof nextOrFn === "function" ? nextOrFn(h.present) : nextOrFn;
      if (Object.is(next, h.present)) return h;
      return {
        past: [...h.past, h.present].slice(-MAX_HISTORY),
        present: next,
        future: [],
      };
    });
  }, []);

  const replaceAst = useCallback((next: Ast) => {
    setHist({ past: [], present: next, future: [] });
  }, []);

  const undo = useCallback(() => {
    setHist((h) => {
      if (h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1]!;
      return {
        past: h.past.slice(0, -1),
        present: previous,
        future: [h.present, ...h.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHist((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0]!;
      return {
        past: [...h.past, h.present],
        present: next,
        future: h.future.slice(1),
      };
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (isEditableTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
      if (key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return {
    ast: hist.present,
    commitAst,
    replaceAst,
    undo,
    redo,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
  };
}

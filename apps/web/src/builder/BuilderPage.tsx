import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import {
  parse,
  serialize,
  validateAst,
  collectDependencies,
  isAlwaysTrue,
  normalizeAst,
  type AstNode,
} from "@whenlist/dsl";
import { api, shortId, type ItemRecord } from "../api";
import Palette from "../builder/Palette";
import BlockNode, { dropPaletteNode } from "../builder/BlockNode";
import LivePreview from "../builder/LivePreview";
import {
  createDefaultNode,
  duplicateAt,
  insertChild,
  removeAt,
  updateAt,
  type PaletteItem,
} from "../builder/astEdit";
import {
  ResizeHandle,
  useResizableColumns,
} from "../builder/useResizableColumns";
import { useAstHistory } from "../builder/useAstHistory";
import { btn, field, banner, pageTitle, sectionTitle } from "../ui/styles";
import PageLoader from "../ui/PageLoader";

const PAGE_SIZE = 10;

type EditorBaseline = {
  label: string;
  completionMode: "once" | "while_valid";
  isActive: boolean;
  allowRemind: boolean;
  formula: string;
};

const EMPTY_BASELINE: EditorBaseline = {
  label: "",
  completionMode: "while_valid",
  isActive: true,
  allowRemind: false,
  formula: "",
};

function useIsDesktop() {
  const [ok, setOk] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 900px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const fn = () => setOk(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return ok;
}

export default function Builder() {
  const { id: idParam } = useParams();
  const editId = idParam || undefined;
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const { widths, startResize, reset: resetWidths } = useResizableColumns();

  const [items, setItems] = useState<ItemRecord[]>([]);
  const [archived, setArchived] = useState<ItemRecord[]>([]);
  const [allIds, setAllIds] = useState<string[]>([]);
  const [depsById, setDepsById] = useState<Record<string, string[]>>({});
  const [hasMoreItems, setHasMoreItems] = useState(false);
  const [hasMoreArchived, setHasMoreArchived] = useState(false);
  const [loadingMoreItems, setLoadingMoreItems] = useState(false);
  const [loadingMoreArchived, setLoadingMoreArchived] = useState(false);
  const nextItemsOffsetRef = useRef(0);
  const nextArchivedOffsetRef = useRef(0);
  const hasMoreItemsRef = useRef(false);
  const hasMoreArchivedRef = useRef(false);
  const loadingMoreItemsRef = useRef(false);
  const loadingMoreArchivedRef = useRef(false);
  const itemsListRef = useRef<HTMLUListElement | null>(null);
  const [label, setLabel] = useState("");
  const [completionMode, setCompletionMode] = useState<"once" | "while_valid">(
    "while_valid",
  );
  const [isActive, setIsActive] = useState(true);
  const [allowRemind, setAllowRemind] = useState(false);
  const { ast, commitAst, replaceAst } = useAstHistory({
    type: "and",
    children: [],
  });
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ItemRecord | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<EditorBaseline>(EMPTY_BASELINE);
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingAfterDiscard = useRef<(() => void) | null>(null);
  /** Skip discard blocker for intentional post-save / post-discard navigations */
  const bypassBlockRef = useRef(false);
  const [showCompletedOnce, setShowCompletedOnce] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const knownIds = useMemo(
    () => new Set(allIds.length > 0 ? allIds : items.map((i) => i.id)),
    [allIds, items],
  );

  const formulaText = useMemo(() => (ast ? serialize(ast) : ""), [ast]);

  const isDirty = useMemo(() => {
    if (!loaded) return false;
    if (bypassBlockRef.current) return false;
    if (label !== baseline.label) return true;
    if (completionMode !== baseline.completionMode) return true;
    if (isActive !== baseline.isActive) return true;
    if (allowRemind !== baseline.allowRemind) return true;
    if (formulaText !== baseline.formula) return true;
    if (textMode && text !== baseline.formula && text !== formulaText) {
      return true;
    }
    return false;
  }, [
    loaded,
    label,
    completionMode,
    isActive,
    allowRemind,
    formulaText,
    baseline,
    textMode,
    text,
  ]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => {
      if (bypassBlockRef.current) return false;
      if (!isDirty) return false;
      return currentLocation.pathname !== nextLocation.pathname;
    },
  );

  useEffect(() => {
    if (blocker.state === "blocked") {
      setDiscardOpen(true);
    }
  }, [blocker.state]);

  useEffect(() => {
    // Clear one-shot bypass after route/id settles
    bypassBlockRef.current = false;
  }, [editId]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const applyEditorFromItem = useCallback(
    (found: ItemRecord) => {
      setLabel(found.label);
      setCompletionMode(found.completionMode);
      setIsActive(found.isActive);
      setAllowRemind(Boolean(found.allowRemind));
      let formula = found.formula;
      try {
        const a = parse(found.formula);
        replaceAst(a);
        formula = serialize(a);
        setText(formula);
      } catch {
        replaceAst({ type: "and", children: [] });
        setText(found.formula);
        formula = found.formula;
      }
      setBaseline({
        label: found.label,
        completionMode: found.completionMode,
        isActive: found.isActive,
        allowRemind: Boolean(found.allowRemind),
        formula,
      });
      setTextMode(false);
      setTextError(null);
    },
    [replaceAst],
  );

  const load = useCallback(async (mode: "boot" | "refresh" = "refresh") => {
    if (mode === "boot") setBooting(true);
    else setRefreshing(true);
    try {
      const [live, archivedPage] = await Promise.all([
        api.listItems({ limit: PAGE_SIZE, offset: 0 }),
        api.listArchivedItems({ limit: PAGE_SIZE, offset: 0 }),
      ]);

      let nextList = live.items;
      if (editId) {
        let found = nextList.find((i) => i.id === editId) ?? null;
        if (!found) {
          try {
            const { item } = await api.getItem(editId);
            if (!item.deletedAt) {
              found = item;
              nextList = [item, ...nextList.filter((i) => i.id !== item.id)];
            }
          } catch {
            found = null;
          }
        }
        if (found) applyEditorFromItem(found);
      } else {
        setBaseline(EMPTY_BASELINE);
      }

      setItems(nextList);
      setArchived(archivedPage.items);
      setAllIds(nextList.map((i) => i.id));
      hasMoreItemsRef.current = Boolean(live.hasMore);
      setHasMoreItems(Boolean(live.hasMore));
      nextItemsOffsetRef.current = live.nextOffset ?? nextList.length;
      hasMoreArchivedRef.current = Boolean(archivedPage.hasMore);
      setHasMoreArchived(Boolean(archivedPage.hasMore));
      nextArchivedOffsetRef.current =
        archivedPage.nextOffset ?? archivedPage.items.length;
      setLoaded(true);

      void api
        .listItemsMeta()
        .then((meta) => {
          setAllIds(meta.ids);
          setDepsById(meta.deps);
        })
        .catch(() => {
          /* keep ids from loaded page */
        });
    } finally {
      if (mode === "boot") setBooting(false);
      else setRefreshing(false);
    }
  }, [editId, applyEditorFromItem]);

  const loadMoreItems = useCallback(async () => {
    if (loadingMoreItemsRef.current || !hasMoreItemsRef.current) return;
    loadingMoreItemsRef.current = true;
    setLoadingMoreItems(true);
    try {
      const data = await api.listItems({
        limit: PAGE_SIZE,
        offset: nextItemsOffsetRef.current,
      });
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...data.items.filter((i) => !seen.has(i.id))];
      });
      hasMoreItemsRef.current = Boolean(data.hasMore);
      setHasMoreItems(Boolean(data.hasMore));
      nextItemsOffsetRef.current =
        data.nextOffset ?? nextItemsOffsetRef.current + data.items.length;
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      loadingMoreItemsRef.current = false;
      setLoadingMoreItems(false);
      requestAnimationFrame(() => {
        const ul = itemsListRef.current;
        if (!ul || loadingMoreItemsRef.current || !hasMoreItemsRef.current)
          return;
        if (ul.scrollTop <= 0) return;
        const remaining = ul.scrollHeight - (ul.scrollTop + ul.clientHeight);
        if (remaining <= 48) void loadMoreItems();
      });
    }
  }, []);

  const loadMoreArchived = useCallback(async () => {
    if (loadingMoreArchivedRef.current || !hasMoreArchivedRef.current) return;
    loadingMoreArchivedRef.current = true;
    setLoadingMoreArchived(true);
    try {
      const data = await api.listArchivedItems({
        limit: PAGE_SIZE,
        offset: nextArchivedOffsetRef.current,
      });
      setArchived((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...data.items.filter((i) => !seen.has(i.id))];
      });
      hasMoreArchivedRef.current = Boolean(data.hasMore);
      setHasMoreArchived(Boolean(data.hasMore));
      nextArchivedOffsetRef.current =
        data.nextOffset ??
        nextArchivedOffsetRef.current + data.items.length;
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      loadingMoreArchivedRef.current = false;
      setLoadingMoreArchived(false);
    }
  }, []);

  useEffect(() => {
    void load("boot");
  }, [load]);

  // Sidebar: load more only when scrolled to the bottom (no prefetch).
  useEffect(() => {
    const ul = itemsListRef.current;
    if (!ul || !hasMoreItems) return;
    const onScroll = () => {
      if (loadingMoreItemsRef.current || !hasMoreItemsRef.current) return;
      if (ul.scrollTop <= 0) return;
      const remaining = ul.scrollHeight - (ul.scrollTop + ul.clientHeight);
      if (remaining <= 48) void loadMoreItems();
    };
    ul.addEventListener("scroll", onScroll, { passive: true });
    return () => ul.removeEventListener("scroll", onScroll);
  }, [hasMoreItems, loadMoreItems, items.length]);

  useEffect(() => {
    const ul = itemsListRef.current;
    if (!ul || !hasMoreArchived) return;
    const onScroll = () => {
      if (loadingMoreArchivedRef.current || !hasMoreArchivedRef.current) return;
      // Only when archived section is in play — near list bottom.
      const remaining = ul.scrollHeight - (ul.scrollTop + ul.clientHeight);
      if (remaining <= 48) void loadMoreArchived();
    };
    ul.addEventListener("scroll", onScroll, { passive: true });
    return () => ul.removeEventListener("scroll", onScroll);
  }, [hasMoreArchived, loadMoreArchived, archived.length]);

  const issuesFull = useMemo(() => {
    if (!ast) {
      if (completionMode === "once") return [];
      return [
        { path: "", message: "Schedule is empty", severity: "error" as const },
      ];
    }
    if (completionMode === "once" && isAlwaysTrue(ast)) {
      return [
        {
          path: "",
          message: "Empty schedule → always shows until checked (one-time)",
          severity: "warning" as const,
        },
      ];
    }
    if (completionMode === "while_valid" && isAlwaysTrue(ast)) {
      return [
        {
          path: "",
          message:
            "Empty schedule is only allowed for One-time. Add a rule or switch mode.",
          severity: "error" as const,
        },
      ];
    }
    const depMap = new Map<string, string[]>(Object.entries(depsById));
    for (const it of items) {
      if (depMap.has(it.id)) continue;
      try {
        depMap.set(it.id, collectDependencies(parse(it.formula)));
      } catch {
        depMap.set(it.id, []);
      }
    }
    return validateAst(ast, {
      selfId: editId,
      knownIds,
      existingDeps: depMap,
    });
  }, [ast, editId, knownIds, items, depsById, completionMode]);

  const hasError = issuesFull.some((i) => i.severity === "error");

  const remindAllowed = !(
    completionMode === "once" &&
    (!ast || isAlwaysTrue(ast))
  );

  useEffect(() => {
    if (!remindAllowed && allowRemind) setAllowRemind(false);
  }, [remindAllowed, allowRemind]);

  const onChangeNode = (path: number[], node: AstNode) => {
    commitAst((prev) => updateAt(prev, path, () => node));
  };

  const onRemove = (path: number[]) => {
    commitAst((prev) => {
      if (!prev) return prev;
      const next = removeAt(prev, path);
      // Root delete / cleared tree → empty schedule (same as always-true).
      if (!next || isAlwaysTrue(next)) return { type: "and", children: [] };
      return next;
    });
  };

  const onDuplicate = (path: number[]) => {
    commitAst((prev) => (prev ? duplicateAt(prev, path) : prev));
  };

  const onDropPalette = (
    parentPath: number[],
    index: number,
    item: PaletteItem,
  ) => {
    const child = dropPaletteNode(item);
    commitAst((prev) => {
      // Empty / always-true canvas: first block becomes the schedule root.
      if (!prev || isAlwaysTrue(prev)) return child;
      if (parentPath.length === 0 && prev.type !== "and" && prev.type !== "or") {
        return {
          type: "and",
          children: [prev, child],
        } as AstNode;
      }
      return insertChild(prev, parentPath, index, child);
    });
  };

  const onMove = (
    fromPath: number[],
    toParentPath: number[],
    toIndex: number,
  ) => {
    commitAst((prev) => {
      if (!prev) return prev;
      let extracted: AstNode | null = null;
      updateAt(prev, fromPath, (n) => {
        extracted = structuredClone(n);
        return n;
      });
      if (!extracted) return prev;
      let next = removeAt(prev, fromPath);
      if (!next) next = { type: "and", children: [] };
      const sameParent =
        fromPath.length === toParentPath.length + 1 &&
        fromPath.slice(0, -1).every((v, i) => v === toParentPath[i]);
      let idx = toIndex;
      if (sameParent) {
        const fromIdx = fromPath[fromPath.length - 1]!;
        if (fromIdx < toIndex) idx = toIndex - 1;
      }
      return insertChild(next, toParentPath, idx, extracted);
    });
  };

  const addFromPalette = (item: PaletteItem) => {
    const child = createDefaultNode(item);
    commitAst((prev) => {
      if (!prev || isAlwaysTrue(prev)) return child;
      if (prev.type === "and" || prev.type === "or") {
        return {
          ...prev,
          children: [...prev.children, child],
        } as AstNode;
      }
      return { type: "and", children: [prev, child] } as AstNode;
    });
  };

  const switchToText = () => {
    setText(ast ? serialize(ast) : "");
    setTextError(null);
    setTextMode(true);
  };

  const applyText = () => {
    try {
      const a = parse(text);
      commitAst(a);
      setText(serialize(a));
      setTextError(null);
      setTextMode(false);
    } catch (e) {
      setTextError((e as Error).message);
    }
  };

  const save = async () => {
    if (!label.trim()) {
      setSaveError("Label is required");
      return;
    }
    if (hasError) {
      setSaveError("Fix schedule errors before saving");
      return;
    }
    const formulaAst = ast ? normalizeAst(ast) : ({ type: "true" } as AstNode);
    if (completionMode === "while_valid" && isAlwaysTrue(formulaAst)) {
      setSaveError(
        "Empty schedule is only allowed for One-time",
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const formula = serialize(formulaAst);
      const nextBaseline = {
        label: label.trim(),
        completionMode,
        isActive,
        allowRemind: allowRemind && remindAllowed,
        formula,
      };
      flushSync(() => {
        replaceAst(formulaAst);
        setText(formula);
        setTextMode(false);
        setTextError(null);
        setBaseline(nextBaseline);
      });
      if (editId) {
        await api.updateItem(editId, {
          label: label.trim(),
          formula,
          completionMode,
          isActive,
          allowRemind: nextBaseline.allowRemind,
        });
        await load();
      } else {
        const { item } = await api.createItem({
          label: label.trim(),
          formula,
          completionMode,
          isActive,
          allowRemind: nextBaseline.allowRemind,
        });
        bypassBlockRef.current = true;
        navigate(`/builder/${encodeURIComponent(item.id)}`, { replace: true });
      }
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetToNewForm = () => {
    setLabel("");
    setCompletionMode("while_valid");
    setIsActive(true);
    setAllowRemind(false);
    replaceAst({ type: "and", children: [] });
    setText("");
    setTextMode(false);
    setTextError(null);
    setSaveError(null);
    setBaseline(EMPTY_BASELINE);
  };

  const doStartNew = () => {
    bypassBlockRef.current = true;
    if (editId) {
      navigate("/builder");
    }
    resetToNewForm();
  };

  const requestStartNew = () => {
    if (!isDirty) {
      doStartNew();
      return;
    }
    pendingAfterDiscard.current = () => {
      doStartNew();
    };
    setDiscardOpen(true);
  };

  const cancelDiscard = () => {
    pendingAfterDiscard.current = null;
    setDiscardOpen(false);
    if (blocker.state === "blocked") {
      blocker.reset();
    }
  };

  const confirmDiscard = () => {
    const after = pendingAfterDiscard.current;
    pendingAfterDiscard.current = null;
    setDiscardOpen(false);
    bypassBlockRef.current = true;
    if (blocker.state === "blocked") {
      blocker.proceed();
    }
    after?.();
  };

  const requestDelete = (item: ItemRecord) => {
    setDeleteTarget(item);
  };

  const resetCompletedOnce = async (it: ItemRecord) => {
    setResettingId(it.id);
    setSaveError(null);
    try {
      await api.uncheck(it.id);
      await load();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setResettingId(null);
    }
  };

  const visibleItems = useMemo(
    () =>
      showCompletedOnce
        ? items
        : items.filter(
            (i) => !(i.completionMode === "once" && i.checkedAt),
          ),
    [items, showCompletedOnce],
  );

  const cloneItem = async (it: ItemRecord) => {
    setCloningId(it.id);
    setSaveError(null);
    try {
      const { item } = await api.cloneItem(it.id);
      await load();
      bypassBlockRef.current = true;
      navigate(`/builder/${encodeURIComponent(item.id)}`);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setCloningId(null);
    }
  };

  const requestClone = (it: ItemRecord) => {
    if (!isDirty) {
      void cloneItem(it);
      return;
    }
    pendingAfterDiscard.current = () => {
      void cloneItem(it);
    };
    setDiscardOpen(true);
  };

  const cancelDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const id = deleteTarget.id;
      await api.deleteItem(id);
      setDeleteTarget(null);
      if (editId === id) {
        bypassBlockRef.current = true;
        resetToNewForm();
        navigate("/builder");
      }
      await load();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const restoreArchived = async (it: ItemRecord) => {
    setRestoringId(it.id);
    setSaveError(null);
    try {
      await api.restoreItem(it.id);
      await load();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setRestoringId(null);
    }
  };

  useEffect(() => {
    if (!deleteTarget && !discardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (deleting) return;
      if (deleteTarget) setDeleteTarget(null);
      else if (discardOpen) cancelDiscard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteTarget, deleting, discardOpen, blocker.state]);

  if (!loaded || booting) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <h1 className={pageTitle}>Schedule builder</h1>
        <PageLoader label="Loading builder…" />
      </div>
    );
  }

  const busyLabel =
    saving
      ? "Saving…"
      : deleting
        ? "Archiving…"
        : cloningId
          ? "Cloning…"
          : restoringId
            ? "Restoring…"
            : resettingId
              ? "Resetting…"
              : refreshing
                ? "Updating…"
                : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3">
      {busyLabel && <PageLoader overlay label={busyLabel} />}
      {discardOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={cancelDiscard}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="discard-dialog-title"
            aria-describedby="discard-dialog-desc"
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="discard-dialog-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Discard unsaved changes?
            </h2>
            <p id="discard-dialog-desc" className="mt-2 text-sm text-slate-600">
              You have edits that haven’t been saved
              {editId ? " (Update)" : " (Create)"}. Leave anyway and lose them?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelDiscard}
                className={btn.secondary}
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={confirmDiscard}
                className={btn.warning}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={cancelDelete}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-desc"
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="delete-dialog-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Archive checklist item?
            </h2>
            <p id="delete-dialog-desc" className="mt-2 text-sm text-slate-600">
              Hide{" "}
              <span className="font-medium text-slate-900">
                {deleteTarget.label}
              </span>{" "}
              <span className="font-mono text-xs text-slate-400">
                ({shortId(deleteTarget.id)})
              </span>{" "}
              from the checklist. You can restore it anytime from Archived.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={cancelDelete}
                className={btn.secondary}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className={btn.danger}
              >
                {deleting ? "Archiving…" : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className={pageTitle}>Schedule builder</h1>
          <p className="truncate text-sm text-slate-500">
            Preview · settings · when-it-shows blocks
          </p>
        </div>
        <div className="flex items-center gap-2">
          {desktop && (
            <button
              type="button"
              onClick={resetWidths}
              className={btn.secondarySm}
              title="Reset column widths"
            >
              Reset layout
            </button>
          )}
          <button
            type="button"
            disabled={!desktop || saving || hasError || Boolean(textError)}
            onClick={() => void save()}
            className={btn.primary}
          >
            {saving ? "Saving…" : editId ? "Update" : "Create"}
          </button>
          <button
            type="button"
            onClick={requestStartNew}
            className={btn.secondarySm}
          >
            New
          </button>
          {editId && desktop && (
            <button
              type="button"
              disabled={cloningId === editId}
              onClick={() => {
                const cur = items.find((i) => i.id === editId);
                if (cur) requestClone(cur);
              }}
              className={btn.secondarySm}
            >
              {cloningId === editId ? "Cloning…" : "Clone"}
            </button>
          )}
        </div>
      </div>

      {!desktop && (
        <div className={`shrink-0 ${banner.warn}`}>
          Builder works best on a laptop. On this screen size the canvas is
          read-only — open on a computer to edit schedules.
        </div>
      )}

      {(saveError || issuesFull.some((i) => i.severity === "error")) && (
        <div className={`shrink-0 space-y-1 ${banner.error} text-xs`}>
          {saveError && <p>{saveError}</p>}
          {issuesFull
            .filter((i) => i.severity === "error")
            .slice(0, 3)
            .map((iss, i) => (
              <p key={i}>{iss.message}</p>
            ))}
        </div>
      )}

      {/* Left preview · Center settings+canvas · Right Blocks — resizable */}
      <div
        id="builder-columns"
        className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-0"
      >
        {/* LEFT — live preview + items */}
        <aside
          className="flex min-h-0 max-h-[40vh] w-full flex-col gap-3 overflow-hidden lg:max-h-none lg:min-w-0"
          style={
            desktop
              ? { flex: `${widths[0]} 1 0%`, minWidth: 140 }
              : undefined
          }
        >
          <div className="shrink-0">
            <LivePreview
              ast={ast}
              selfId={editId}
              statusMap={Object.fromEntries(
                items.map((i) => [i.id, Boolean(i.checkedAt)]),
              )}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Items</h3>
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-500">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                  checked={showCompletedOnce}
                  onChange={(e) => setShowCompletedOnce(e.target.checked)}
                />
                Show completed one-time items
              </label>
            </div>
            <ul
              ref={itemsListRef}
              className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain"
            >
              {visibleItems.map((it) => {
                const completedOnce =
                  it.completionMode === "once" && Boolean(it.checkedAt);
                return (
                  <li
                    key={it.id}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                      editId === it.id ? "bg-teal-50" : "hover:bg-slate-50"
                    } ${completedOnce ? "opacity-70" : ""}`}
                  >
                    <Link
                      to={`/builder/${encodeURIComponent(it.id)}`}
                      className="min-w-0 flex-1 truncate"
                    >
                      <span className="font-medium font-mono text-[10px] text-slate-400">
                        {shortId(it.id)}
                      </span>{" "}
                      {it.label}
                      {completedOnce && (
                        <span className="ml-1 text-[10px] font-medium uppercase text-emerald-600">
                          done
                        </span>
                      )}
                    </Link>
                    {desktop && (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {completedOnce && (
                          <button
                            type="button"
                            className="text-[10px] font-medium text-slate-600 hover:underline disabled:opacity-50"
                            disabled={resettingId === it.id}
                            onClick={() => void resetCompletedOnce(it)}
                            title="Clear check so it appears on the checklist again"
                          >
                            {resettingId === it.id ? "…" : "Reset"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="text-[10px] font-medium text-teal-700 hover:underline disabled:opacity-50"
                          disabled={cloningId === it.id}
                          onClick={() => requestClone(it)}
                        >
                          {cloningId === it.id ? "…" : "Clone"}
                        </button>
                        <button
                          type="button"
                          className="text-[10px] text-red-500 hover:underline"
                          onClick={() => requestDelete(it)}
                        >
                          Archive
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
              {(hasMoreItems || loadingMoreItems) && (
                <li className="flex items-center justify-center gap-2 px-2 py-3 text-[10px] text-slate-400">
                  {loadingMoreItems ? (
                    <>
                      <span
                        className="page-loader__spin h-3.5 w-3.5 rounded-full border-2 border-slate-200 border-t-teal-600"
                        aria-hidden
                      />
                      Loading more…
                    </>
                  ) : null}
                </li>
              )}
              {(archived.length > 0 || hasMoreArchived) && (
                <>
                  <li className="sticky top-0 z-[1] bg-white pt-3 pb-1">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Archived
                      {archived.length > 0 ? ` (${archived.length}${hasMoreArchived ? "+" : ""})` : ""}
                    </h4>
                  </li>
                  {archived.map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm opacity-75"
                    >
                      <span className="min-w-0 flex-1 truncate text-slate-500">
                        <span className="font-medium font-mono text-[10px] text-slate-400">
                          {shortId(it.id)}
                        </span>{" "}
                        {it.label}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-[10px] font-medium text-teal-700 hover:underline disabled:opacity-50"
                        disabled={restoringId === it.id}
                        onClick={() => void restoreArchived(it)}
                      >
                        {restoringId === it.id ? "…" : "Restore"}
                      </button>
                    </li>
                  ))}
                  {(hasMoreArchived || loadingMoreArchived) && (
                    <li className="flex items-center justify-center gap-2 px-2 py-3 text-[10px] text-slate-400">
                      {loadingMoreArchived ? (
                        <>
                          <span
                            className="page-loader__spin h-3.5 w-3.5 rounded-full border-2 border-slate-200 border-t-teal-600"
                            aria-hidden
                          />
                          Loading more…
                        </>
                      ) : null}
                    </li>
                  )}
                </>
              )}
            </ul>
          </div>
        </aside>

        {desktop && (
          <ResizeHandle onDragStart={(x) => startResize(0, x)} />
        )}

        {/* CENTER — item settings + formula canvas */}
        <section
          className="flex min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          style={
            desktop
              ? { flex: `${widths[1]} 1 0%`, minWidth: 240 }
              : undefined
          }
        >
          <div className="shrink-0 space-y-3 border-b border-slate-100 p-3 sm:p-4">
            <h3 className={sectionTitle}>Item settings</h3>
            <label className="block text-sm">
              <span className="text-slate-500">Label</span>
              <input
                className={`mt-1 ${field}`}
                value={label}
                disabled={!desktop}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Pay electricity bill"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-500">How it finishes</span>
              <select
                className={`mt-1 ${field}`}
                value={completionMode}
                disabled={!desktop}
                onChange={(e) =>
                  setCompletionMode(e.target.value as "once" | "while_valid")
                }
              >
                <option value="while_valid">
                  Repeats — shows again when the schedule matches
                </option>
                <option value="once">One-time — done after you check it</option>
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={isActive}
                  disabled={!desktop}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Active
              </label>
              <label
                className={`flex items-center gap-2 text-sm ${
                  remindAllowed ? "text-slate-600" : "text-slate-400"
                }`}
                title={
                  remindAllowed
                    ? undefined
                    : "Reminders need a timed schedule — not a plain one-time item with no schedule"
                }
              >
                <input
                  type="checkbox"
                  checked={allowRemind && remindAllowed}
                  disabled={!desktop || !remindAllowed}
                  onChange={(e) => setAllowRemind(e.target.checked)}
                />
                Remind me early
              </label>
              <div className="ml-auto flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                    !textMode
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600"
                  }`}
                  onClick={() => {
                    if (textMode) applyText();
                    else setTextMode(false);
                  }}
                >
                  Visual
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                    textMode
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600"
                  }`}
                  onClick={switchToText}
                  disabled={!desktop}
                >
                  Advanced text
                </button>
              </div>
            </div>
            <div className="break-all rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-500">
              {formulaText ||
                (completionMode === "once"
                  ? "(empty = always until checked)"
                  : "(empty schedule)")}
            </div>
            <p className="text-[11px] text-slate-400">
              <Link to="/help#schedule-rules" className="text-teal-700 underline">
                Schedule rules & examples
              </Link>
            </p>
            {issuesFull.some((i) => i.severity === "warning") && (
              <div className="space-y-1 text-[11px] text-amber-700">
                {issuesFull
                  .filter((i) => i.severity === "warning")
                  .map((iss, i) => (
                    <p key={i}>{iss.message}</p>
                  ))}
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
            {textMode ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <textarea
                  className={`min-h-0 w-full flex-1 ${field} font-mono`}
                  value={text}
                  disabled={!desktop}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={() => desktop && applyText()}
                />
                {textError && (
                  <p className="text-xs text-red-600">{textError}</p>
                )}
                <button
                  type="button"
                  className={`${btn.primarySm} self-start`}
                  onClick={applyText}
                >
                  Apply text → blocks
                </button>
              </div>
            ) : (
              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  if (!desktop) return;
                  e.preventDefault();
                  const palette =
                    e.dataTransfer.getData("application/x-palette");
                  if (!palette) return;
                  const item = JSON.parse(palette) as PaletteItem;
                  if (!ast || isAlwaysTrue(ast)) {
                    onDropPalette([], 0, item);
                    return;
                  }
                  onDropPalette(
                    [],
                    ast.type === "and" || ast.type === "or"
                      ? ast.children.length
                      : 0,
                    item,
                  );
                }}
              >
                {ast && !isAlwaysTrue(ast) ? (
                  <BlockNode
                    node={ast}
                    path={[]}
                    items={items.filter((i) => i.id !== editId)}
                    knownIds={knownIds}
                    selfId={editId}
                    readOnly={!desktop}
                    onChange={onChangeNode}
                    onRemove={onRemove}
                    onDuplicate={onDuplicate}
                    onDropPalette={onDropPalette}
                    onMove={onMove}
                  />
                ) : (
                  <p className="py-12 text-center text-sm text-slate-400">
                    Drop blocks here from the palette
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {desktop && (
          <ResizeHandle onDragStart={(x) => startResize(1, x)} />
        )}

        {/* RIGHT — Blocks palette */}
        {desktop ? (
          <section
            className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border-2 border-teal-200/80 bg-white shadow-sm"
            style={{ flex: `${widths[2]} 1 0%`, minWidth: 260 }}
          >
            <div className="flex shrink-0 items-center border-b border-slate-100 bg-teal-50/40 px-4 py-2.5">
              <div>
                <h3 className={sectionTitle}>Blocks</h3>
                <p className="text-[11px] text-slate-500">
                  Drag or click to add to the schedule
                </p>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Palette onAdd={addFromPalette} />
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            Palette available on desktop.
          </section>
        )}
      </div>
    </div>
  );
}

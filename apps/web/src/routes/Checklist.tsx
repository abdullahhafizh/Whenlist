import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api, type ChecklistItemView, type ReminderAlert } from "../api";
import { banner, btn, pageTitle } from "../ui/styles";
import { explodeElement } from "../ui/explodeElement";
import SwipeToDelete from "../ui/SwipeToDelete";
import Holdable from "../ui/Holdable";
import { describeWhen, modeBadge } from "../ui/describeWhen";
import PageLoader from "../ui/PageLoader";

const PRESS_MS = 280;
/** Time the checked row stays visible (with progress line) before exit. */
const HOLD_DONE_MS = 1000;
const EXPLODE_MS = 340;
const CHECK_ANIM_MS = 720;
const SWIPE_OUT_MS = 320;
const UNDO_WINDOW_MS = 5000;
const UNDO_FLASH_MS = 900;
/** First paint + each “load more” chunk — keep small for instant feel. */
const PAGE_SIZE = 10;
/** Empty stack shells from total count (aesthetic); real interactive rows stay PAGE_SIZE. */
const DROP_SLOT_CAP = 60;

/**
 * Timing for cards that peel off the standing first item.
 * Index 0 never drops — it only stands. `--fall-from-y` is measured so the
 * pile sits exactly on that stand seat (not above it).
 */
function fallDropStyle(
  index: number,
  total: number,
): CSSProperties {
  const n = Math.max(1, total);
  const i = Math.min(Math.max(0, index), n - 1);
  if (i === 0) {
    return { zIndex: 1 };
  }
  // Movers only (skip stand). Last row = top of pile → falls first (t=0).
  const movers = Math.max(1, n - 1);
  const moverI = i - 1;
  const t = movers <= 1 ? 0 : (movers - 1 - moverI) / (movers - 1);
  const delayMs = Math.round(1100 * t ** 3.1);
  const durMs = Math.round(380 + 520 * t ** 2.2);

  return {
    "--fall-delay": `${delayMs}ms`,
    "--fall-dur": `${durMs}ms`,
    zIndex: i + 1,
  } as CSSProperties;
}


export default function Checklist() {
  const [items, setItems] = useState<ChecklistItemView[]>([]);
  const [alerts, setAlerts] = useState<ReminderAlert[]>([]);
  const [meta, setMeta] = useState<{ now: string; timeZone: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  /** Stack size for entrance drop — visible checklist count, not all DB rows. */
  const [dropSlots, setDropSlots] = useState(0);
  const [entranceOn, setEntranceOn] = useState(false);
  /** hold = piled & waiting to paint; drop = peeling off */
  const [fallPhase, setFallPhase] = useState<"off" | "hold" | "drop">("off");
  const entranceDoneRef = useRef(false);
  const dropSlotsRef = useRef(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pressingId, setPressingId] = useState<string | null>(null);
  const [animatingCheckIds, setAnimatingCheckIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingRemoveIds, setPendingRemoveIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [progressIds, setProgressIds] = useState<Set<string>>(() => new Set());
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());
  const [swipeOutIds, setSwipeOutIds] = useState<Set<string>>(() => new Set());
  const [snoozeOutIds, setSnoozeOutIds] = useState<Set<string>>(() => new Set());
  const [undoFlashIds, setUndoFlashIds] = useState<Set<string>>(() => new Set());
  const [undoInIds, setUndoInIds] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<{
    item: ChecklistItemView;
    index: number;
  } | null>(null);
  const [holdMenuItem, setHoldMenuItem] = useState<ChecklistItemView | null>(
    null,
  );
  const pendingRemoveRef = useRef<Set<string>>(new Set());
  const exitingRef = useRef<Set<string>>(new Set());
  const pendingDeleteIdRef = useRef<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const nextOffsetRef = useRef(0);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const itemsLenRef = useRef(0);
  const loadGenRef = useRef(0);

  const clearItemTimers = (id: string) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  };

  const clearPressTimer = (id: string) => {
    clearItemTimers(`press-${id}`);
  };

  useEffect(() => {
    return () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
    };
  }, []);

  const mergeKeepLocal = (
    prev: ChecklistItemView[],
    next: ChecklistItemView[],
  ) => {
    const keepLocal = new Set([
      ...pendingRemoveRef.current,
      ...exitingRef.current,
    ]);
    const hideId = pendingDeleteIdRef.current;
    let merged = next;
    if (hideId) {
      merged = merged.filter((i) => i.id !== hideId);
    }
    if (keepLocal.size === 0) return merged;
    const byId = new Map(merged.map((i) => [i.id, i]));
    const kept = prev
      .filter((i) => keepLocal.has(i.id) && !byId.has(i.id))
      .map((i) => ({
        ...i,
        checked: exitingRef.current.has(i.id) || i.checked,
      }));
    return [...merged, ...kept];
  };

  const load = useCallback(async (mode: "replace" | "append" = "replace") => {
    if (mode === "append") {
      if (loadingMoreRef.current || !hasMoreRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }

    const gen = mode === "replace" ? ++loadGenRef.current : loadGenRef.current;
    const offset = mode === "append" ? nextOffsetRef.current : 0;
    const limit = PAGE_SIZE;
    let fetchedLen = 0;

    try {
      setError(null);
      const [data, countRes] = await Promise.all([
        api.getChecklist({ limit, offset }),
        mode === "replace" && !entranceDoneRef.current
          ? api.getChecklistCount().catch(() => ({ total: 0 }))
          : Promise.resolve(null),
      ]);
      if (gen !== loadGenRef.current) return;
      fetchedLen = data.items.length;

      if (countRes && typeof countRes.total === "number") {
        // Hint only — final slot count is resolved after we know hasMore.
        dropSlotsRef.current = Math.min(
          Math.max(0, countRes.total),
          DROP_SLOT_CAP,
        );
      }

      if (mode === "append") {
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          const fresh = data.items.filter((i) => !seen.has(i.id));
          const next = mergeKeepLocal(prev, [...prev, ...fresh]);
          itemsLenRef.current = next.length;
          return next;
        });
      } else {
        setItems((prev) => {
          const head = data.items;
          const headIds = new Set(head.map((i) => i.id));
          const tail = prev
            .filter((i) => !headIds.has(i.id))
            .slice(0, Math.max(0, itemsLenRef.current - PAGE_SIZE));
          const next = mergeKeepLocal(prev, [...head, ...tail]);
          itemsLenRef.current = next.length;
          return next;
        });
        setAlerts(data.alerts ?? []);
        setMeta({ now: data.now, timeZone: data.timeZone });
        if (nextOffsetRef.current <= PAGE_SIZE) {
          nextOffsetRef.current =
            data.nextOffset ?? offset + data.items.length;
          const more = Boolean(data.hasMore);
          hasMoreRef.current = more;
          setHasMore(more);
        }
      }

      if (mode === "append") {
        const more = Boolean(data.hasMore);
        hasMoreRef.current = more;
        setHasMore(more);
        nextOffsetRef.current =
          data.nextOffset ?? offset + data.items.length;
      }
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      setError((e as Error).message);
    } finally {
      if (mode === "append") {
        loadingMoreRef.current = false;
        setLoadingMore(false);
        requestAnimationFrame(() => {
          if (loadingMoreRef.current || !hasMoreRef.current) return;
          if (window.scrollY <= 0) return;
          const doc = document.documentElement;
          const remaining =
            doc.scrollHeight - (window.scrollY + window.innerHeight);
          if (remaining <= 96) void load("append");
        });
      } else if (gen === loadGenRef.current) {
        setLoading(false);
        if (!entranceDoneRef.current) {
          entranceDoneRef.current = true;
          // Exact visible page when no more pages — never invent ghost cards.
          // Only pad with shells when hasMore (count = currently-visible total).
          const slots = hasMoreRef.current
            ? Math.min(
                DROP_SLOT_CAP,
                Math.max(fetchedLen, dropSlotsRef.current || fetchedLen),
              )
            : fetchedLen;
          setDropSlots(slots);
          dropSlotsRef.current = slots;
          // One hold frame to measure align + uniform height, then drop (no pause).
          setFallPhase("hold");
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setFallPhase("drop");
              setEntranceOn(true);
            });
          });
        }
      }
    }
  }, []);

  const loadMore = useCallback(() => {
    void load("append");
  }, [load]);

  useEffect(() => {
    if (!entranceOn) return;
    const t = setTimeout(() => {
      setEntranceOn(false);
      setFallPhase("off");
    }, 2800);
    return () => clearTimeout(t);
  }, [entranceOn]);

  // Compact single-line card height + pile on stand seat (measure only).
  useLayoutEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const rows = [
      ...ul.querySelectorAll<HTMLElement>(":scope > .checklist-row"),
    ];

    if (fallPhase === "off") {
      for (const row of rows) {
        row.style.removeProperty("--fall-card-h");
        row.style.removeProperty("--fall-from-y");
      }
      return;
    }

    if (rows.length === 0) return;

    for (const row of rows) {
      row.classList.add("is-measuring-fall");
      row.style.removeProperty("--fall-card-h");
    }
    void ul.offsetHeight;

    // Use the stand seat (index 0) after 1-line clamp — never max of wrapped cards.
    const standCard =
      rows[0]!.querySelector<HTMLElement>(".checklist-card") ?? rows[0]!;
    const uniformH = `${Math.ceil(standCard.getBoundingClientRect().height)}px`;
    for (const row of rows) {
      row.style.setProperty("--fall-card-h", uniformH);
    }

    // Re-measure tops with uniform height, still untransformed.
    void ul.offsetHeight;
    const baseTop = standCard.getBoundingClientRect().top;
    rows.forEach((row, i) => {
      if (i === 0) {
        row.style.setProperty("--fall-from-y", "0px");
      } else {
        const card =
          row.querySelector<HTMLElement>(".checklist-card") ?? row;
        row.style.setProperty(
          "--fall-from-y",
          `${baseTop - card.getBoundingClientRect().top}px`,
        );
      }
      row.classList.remove("is-measuring-fall");
    });
  }, [fallPhase, dropSlots, items.length]);

  useEffect(() => {
    void load("replace");
    const t = setInterval(() => void load("replace"), 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Load next page only when the user scrolls to the bottom (no prefetch).
  useEffect(() => {
    if (loading || !hasMore) return;
    const onScroll = () => {
      if (loadingMoreRef.current || !hasMoreRef.current) return;
      if (window.scrollY <= 0) return;
      const doc = document.documentElement;
      const remaining =
        doc.scrollHeight - (window.scrollY + window.innerHeight);
      if (remaining <= 96) loadMore();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [loading, hasMore, loadMore, items.length]);

  const playCheckAnim = (id: string) => {
    setAnimatingCheckIds((prev) => new Set(prev).add(id));
    clearItemTimers(`check-${id}`);
    const t = setTimeout(() => {
      setAnimatingCheckIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      timersRef.current.delete(`check-${id}`);
    }, CHECK_ANIM_MS);
    timersRef.current.set(`check-${id}`, t);
  };

  const cancelPendingRemove = (id: string) => {
    clearItemTimers(id);
    pendingRemoveRef.current = new Set(
      [...pendingRemoveRef.current].filter((x) => x !== id),
    );
    setPendingRemoveIds(new Set(pendingRemoveRef.current));
    setProgressIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const beginExit = (id: string) => {
    cancelPendingRemove(id);
    exitingRef.current = new Set(exitingRef.current).add(id);
    setExitingIds(new Set(exitingRef.current));

    const el = cardRefs.current.get(id) ?? null;
    void (async () => {
      try {
        await explodeElement(el, { durationMs: EXPLODE_MS });
      } catch {
        if (el) el.style.visibility = "hidden";
      } finally {
        exitingRef.current = new Set(
          [...exitingRef.current].filter((x) => x !== id),
        );
        setExitingIds(new Set(exitingRef.current));
        setItems((prev) => prev.filter((i) => i.id !== id));
        cardRefs.current.delete(id);
        timersRef.current.delete(id);
        void load();
      }
    })();
  };

  const toggle = async (item: ChecklistItemView) => {
    if (exitingRef.current.has(item.id)) return;
    if (busyId && busyId !== item.id) return;

    const wasPending = pendingRemoveRef.current.has(item.id);

    setBusyId(item.id);
    setPressingId(item.id);
    clearPressTimer(item.id);
    const pressTimer = setTimeout(() => {
      setPressingId((cur) => (cur === item.id ? null : cur));
      timersRef.current.delete(`press-${item.id}`);
    }, PRESS_MS);
    timersRef.current.set(`press-${item.id}`, pressTimer);

    // Uncheck during countdown: cancel removal and undo check
    if (item.checked || wasPending) {
      cancelPendingRemove(item.id);
      clearItemTimers(`check-${item.id}`);
      setAnimatingCheckIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, checked: false } : i)),
      );
      try {
        await api.uncheck(item.id);
        await load();
      } catch (e) {
        setError((e as Error).message);
        await load();
      } finally {
        setBusyId(null);
      }
      return;
    }

    playCheckAnim(item.id);
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, checked: true } : i)),
    );

    if (item.completionMode === "once") {
      pendingRemoveRef.current = new Set(pendingRemoveRef.current).add(item.id);
      setPendingRemoveIds(new Set(pendingRemoveRef.current));
      setProgressIds((prev) => new Set(prev).add(item.id));
      clearItemTimers(item.id);
      const hold = setTimeout(() => {
        beginExit(item.id);
      }, HOLD_DONE_MS);
      timersRef.current.set(item.id, hold);
    }

    try {
      await api.check(item.id);
      // Once items: keep local card for progress + explode; skip reload until exit.
      if (item.completionMode !== "once") {
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
      cancelPendingRemove(item.id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const dismissAlert = async (alert: ReminderAlert) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    try {
      await api.dismissRemind(alert.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    }
  };

  const commitPendingDelete = async (item: ChecklistItemView) => {
    clearItemTimers(`delete-${item.id}`);
    pendingDeleteIdRef.current = null;
    setPendingDelete((cur) => (cur?.item.id === item.id ? null : cur));
    try {
      await api.deleteItem(item.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
      // Restore on failure
      setItems((prev) => {
        if (prev.some((i) => i.id === item.id)) return prev;
        return [...prev, item];
      });
    }
  };

  const undoPendingDelete = () => {
    const pending = pendingDelete;
    if (!pending) return;
    clearItemTimers(`delete-${pending.item.id}`);
    pendingDeleteIdRef.current = null;
    setPendingDelete(null);

    setItems((prev) => {
      if (prev.some((i) => i.id === pending.item.id)) return prev;
      const next = [...prev];
      const idx = Math.min(pending.index, next.length);
      next.splice(idx, 0, { ...pending.item, checked: false });
      return next;
    });
    setUndoInIds((prev) => new Set(prev).add(pending.item.id));
    setUndoFlashIds((prev) => new Set(prev).add(pending.item.id));
    clearItemTimers(`undo-in-${pending.item.id}`);
    clearItemTimers(`undo-flash-${pending.item.id}`);
    timersRef.current.set(
      `undo-in-${pending.item.id}`,
      setTimeout(() => {
        setUndoInIds((prev) => {
          const n = new Set(prev);
          n.delete(pending.item.id);
          return n;
        });
      }, 420),
    );
    timersRef.current.set(
      `undo-flash-${pending.item.id}`,
      setTimeout(() => {
        setUndoFlashIds((prev) => {
          const n = new Set(prev);
          n.delete(pending.item.id);
          return n;
        });
      }, UNDO_FLASH_MS),
    );
  };

  const swipeDeleteItem = (item: ChecklistItemView) => {
    if (exitingRef.current.has(item.id)) return;
    cancelPendingRemove(item.id);

    // Commit any previous pending delete first
    if (pendingDelete && pendingDelete.item.id !== item.id) {
      void commitPendingDelete(pendingDelete.item);
    }

    const index = items.findIndex((i) => i.id === item.id);
    setSwipeOutIds((prev) => new Set(prev).add(item.id));
    clearItemTimers(`swipe-out-${item.id}`);
    timersRef.current.set(
      `swipe-out-${item.id}`,
      setTimeout(() => {
        setSwipeOutIds((prev) => {
          const n = new Set(prev);
          n.delete(item.id);
          return n;
        });
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        pendingDeleteIdRef.current = item.id;
        setPendingDelete({ item, index: Math.max(0, index) });
        clearItemTimers(`delete-${item.id}`);
        timersRef.current.set(
          `delete-${item.id}`,
          setTimeout(() => {
            void commitPendingDelete(item);
          }, UNDO_WINDOW_MS),
        );
      }, SWIPE_OUT_MS),
    );
  };

  const snoozeItem = (item: ChecklistItemView) => {
    if (exitingRef.current.has(item.id)) return;
    if (snoozeOutIds.has(item.id) || swipeOutIds.has(item.id)) return;
    cancelPendingRemove(item.id);
    setBusyId(item.id);
    setSnoozeOutIds((prev) => new Set(prev).add(item.id));
    clearItemTimers(`snooze-out-${item.id}`);
    timersRef.current.set(
      `snooze-out-${item.id}`,
      setTimeout(() => {
        setSnoozeOutIds((prev) => {
          const n = new Set(prev);
          n.delete(item.id);
          return n;
        });
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        void (async () => {
          try {
            await api.snooze(item.id);
          } catch (e) {
            setError((e as Error).message);
            await load();
          } finally {
            setBusyId((cur) => (cur === item.id ? null : cur));
          }
        })();
      }, SWIPE_OUT_MS),
    );
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-4 overflow-x-hidden">
        <div>
          <h1 className={pageTitle}>Checklist</h1>
        </div>
        <PageLoader label="Loading checklist…" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 overflow-x-hidden">
      <div>
        <h1 className={pageTitle}>Checklist</h1>
        {meta && (
          <p className="mt-1 text-sm text-slate-500">
            <span className="sm:hidden">
              {new Date(meta.now).toLocaleString(undefined, {
                timeZone: meta.timeZone,
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <span className="hidden sm:inline">
              {new Date(meta.now).toLocaleString(undefined, {
                timeZone: meta.timeZone,
                dateStyle: "full",
                timeStyle: "short",
              })}{" "}
              · {meta.timeZone}
            </span>
          </p>
        )}
      </div>

      {error && (
        <div className={banner.error}>
          {error}
          <button
            type="button"
            className={`ml-2 ${btn.link}`}
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}

      {alerts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Reminders
          </h2>
          <ul className="space-y-2">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <div className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5 shadow-sm">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-amber-500 bg-amber-400 text-[10px] font-bold text-amber-950"
                    aria-hidden
                  >
                    !
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-medium text-amber-950">
                      {alert.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-amber-700/80">
                      Before the task shows
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void dismissAlert(alert)}
                    className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.length === 0 && alerts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <p className="text-slate-600">Nothing due right now.</p>
          <p className="mt-1 text-sm text-slate-400">
            Items show up when their schedule matches.{" "}
            <Link to="/help" className="text-teal-700 underline">
              How it works
            </Link>
          </p>
        </div>
      ) : items.length === 0 ? null : (
        <ul
          ref={listRef}
          className="w-full min-w-0 space-y-2 overflow-x-clip overflow-y-visible"
        >
          {items.map((item, index) => {
            const exiting = exitingIds.has(item.id);
            const pendingRemove = pendingRemoveIds.has(item.id);
            const showProgress = progressIds.has(item.id);
            const pressing = pressingId === item.id;
            const animatingCheck = animatingCheckIds.has(item.id);
            const swipeOut = swipeOutIds.has(item.id);
            const snoozeOut = snoozeOutIds.has(item.id);
            const undoIn = undoInIds.has(item.id);
            const undoFlash = undoFlashIds.has(item.id);
            const canToggle =
              !exiting &&
              !swipeOut &&
              !snoozeOut &&
              (busyId === null || busyId === item.id);
            return (
              <li
                key={item.id}
                className={`checklist-row relative w-full min-w-0 ${
                  exiting ? "is-exiting" : ""
                } ${swipeOut ? "is-swipe-out" : ""} ${
                  snoozeOut ? "is-swipe-out-right" : ""
                } ${
                  undoIn ? "is-undo-in" : ""
                } ${
                  fallPhase !== "off" && index < PAGE_SIZE
                    ? "is-fall-uniform"
                    : ""
                } ${
                  fallPhase === "hold" && index > 0 && index < PAGE_SIZE
                    ? "is-fall-stacked"
                    : ""
                } ${
                  fallPhase === "drop" && index > 0 && index < PAGE_SIZE
                    ? "is-falling-in"
                    : ""
                }`}
                style={
                  fallPhase !== "off" && index < PAGE_SIZE
                    ? fallDropStyle(index, Math.max(1, dropSlots || items.length))
                    : undefined
                }
              >
                <Holdable
                  className="block w-full min-w-0"
                  disabled={exiting || swipeOut || snoozeOut || pendingRemove}
                  onHold={() => setHoldMenuItem(item)}
                >
                  <SwipeToDelete
                    className="w-full min-w-0"
                    disabled={exiting || swipeOut || snoozeOut || pendingRemove}
                    onSwipeDelete={() => swipeDeleteItem(item)}
                  >
                    <div
                      ref={(el) => {
                        if (el) cardRefs.current.set(item.id, el);
                        else cardRefs.current.delete(item.id);
                      }}
                      className={`checklist-card ${
                        item.checked ? "is-checked" : ""
                      } ${pressing ? "is-pressing" : ""} ${
                        animatingCheck ? "is-success" : ""
                      } ${undoFlash ? "is-undo-flash" : ""} ${
                        holdMenuItem?.id === item.id ? "is-hold-armed" : ""
                      }`}
                    >
                  <div className="checklist-card__sheen" aria-hidden />
                  <div className="checklist-card__body relative z-[1] flex w-full min-w-0 items-start gap-2 px-3 py-3 sm:items-center">
                    <button
                      type="button"
                      disabled={!canToggle}
                      onClick={() => void toggle(item)}
                      className="checklist-toggle flex min-w-0 flex-1 items-start gap-3 text-left disabled:opacity-60 sm:items-center"
                      title={
                        pendingRemove
                          ? "Tap to undo before it disappears"
                          : undefined
                      }
                    >
                      <span
                        className={`checklist-check mt-0.5 sm:mt-0 ${
                          item.checked ? "is-checked" : ""
                        } ${animatingCheck ? "is-animating" : ""}`}
                        aria-hidden
                      >
                        <span className="checklist-check__spark" />
                        <span className="checklist-check__spark" />
                        <span className="checklist-check__spark" />
                        <span className="checklist-check__spark" />
                        <span className="checklist-check__spark" />
                        <span className="checklist-check__ring" />
                        <svg
                          className="checklist-check__svg"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="checklist-check__circle"
                            cx="12"
                            cy="12"
                            r="10"
                          />
                          <path
                            className="checklist-check__mark"
                            d="M7.2 12.4l3.1 3.2 6.5-7.4"
                          />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`checklist-label block text-base font-medium break-words ${
                            item.checked ? "is-checked" : ""
                          } ${animatingCheck ? "is-animating" : ""}`}
                        >
                          {item.label}
                        </span>
                        <span
                          className={`checklist-meta mt-0.5 block text-[11px] transition-colors duration-300 ${
                            pendingRemove
                              ? "text-emerald-600/80"
                              : "text-slate-400"
                          }`}
                        >
                          {pendingRemove
                            ? "Undo · disappearing soon"
                            : describeWhen(
                                item.formula,
                                item.completionMode,
                              )}
                        </span>
                      </span>
                    </button>

                    <div className="checklist-card__actions flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                      {(item.canSnooze ?? item.completionMode === "once") &&
                        !item.checked &&
                        !pendingRemove && (
                          <button
                            type="button"
                            disabled={busyId !== null || snoozeOut || swipeOut}
                            title="Hide for now — comes back next time it should show"
                            onClick={() => snoozeItem(item)}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-100 active:scale-95 sm:px-2.5 sm:py-1.5 sm:text-xs"
                          >
                            Later
                          </button>
                        )}

                      <span className="rounded-full bg-slate-100/90 px-2 py-0.5 text-[10px] font-medium tracking-wide text-slate-500 backdrop-blur-sm">
                        {modeBadge(item.completionMode)}
                      </span>
                    </div>
                  </div>

                  {showProgress && (
                    <div className="checklist-progress-track" aria-hidden>
                      <div
                        key={`progress-${item.id}`}
                        className="checklist-remove-progress h-full"
                        style={
                          {
                            "--hold-ms": `${HOLD_DONE_MS}ms`,
                          } as CSSProperties
                        }
                      />
                    </div>
                  )}
                  </div>
                </SwipeToDelete>
                </Holdable>
              </li>
            );
          })}
          {fallPhase !== "off" &&
            (() => {
              const pageLen = Math.min(items.length, PAGE_SIZE);
              const filler = pageLen > 0 ? items[pageLen - 1]! : null;
              if (!filler) return null;
              const shellCount = Math.max(0, dropSlots - pageLen);
              const pile = Math.max(1, dropSlots);
              return Array.from({ length: shellCount }, (_, k) => {
                const index = pageLen + k;
                return (
                  <li
                    key={`drop-shell-${index}`}
                    aria-hidden
                    className={`checklist-row checklist-row--drop-shell relative w-full min-w-0 is-fall-uniform ${
                      fallPhase === "hold" ? "is-fall-stacked" : ""
                    } ${fallPhase === "drop" ? "is-falling-ghost" : ""}`}
                    style={fallDropStyle(index, pile)}
                  >
                    <div
                      className={`checklist-card checklist-card--drop-shell ${
                        filler.checked ? "is-checked" : ""
                      }`}
                    >
                      <div className="checklist-card__sheen" aria-hidden />
                      <div className="checklist-card__body relative z-[1] flex w-full min-w-0 items-start gap-2 px-3 py-3 sm:items-center">
                        <span className="checklist-toggle flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                          <span
                            className={`checklist-check mt-0.5 sm:mt-0 ${
                              filler.checked ? "is-checked" : ""
                            }`}
                            aria-hidden
                          >
                            <span className="checklist-check__ring" />
                            <svg
                              className="checklist-check__svg"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="checklist-check__circle"
                                cx="12"
                                cy="12"
                                r="10"
                              />
                              <path
                                className="checklist-check__mark"
                                d="M7.2 12.4l3.1 3.2 6.5-7.4"
                              />
                            </svg>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={`checklist-label block text-base font-medium break-words ${
                                filler.checked ? "is-checked" : ""
                              }`}
                            >
                              {filler.label}
                            </span>
                            <span className="checklist-meta mt-0.5 block text-[11px] text-slate-400">
                              {describeWhen(
                                filler.formula,
                                filler.completionMode,
                              )}
                            </span>
                          </span>
                        </span>
                        <span className="rounded-full bg-slate-100/90 px-2 py-0.5 text-[10px] font-medium tracking-wide text-slate-500">
                          {modeBadge(filler.completionMode)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              });
            })()}
        </ul>
      )}

      {(hasMore || loadingMore) && (
        <div className="flex items-center justify-center gap-2 py-3" aria-hidden={!loadingMore}>
          {loadingMore ? (
            <>
              <span
                className="page-loader__spin h-4 w-4 rounded-full border-2 border-slate-200 border-t-teal-600"
                aria-hidden
              />
              <p className="text-xs text-slate-400">Loading more…</p>
            </>
          ) : (
            <span className="h-2 w-2 rounded-full bg-slate-200" />
          )}
        </div>
      )}

      {holdMenuItem && (
        <div
          className="checklist-hold-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Item actions"
          onClick={() => setHoldMenuItem(null)}
        >
          <div
            className="checklist-hold-sheet__panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="checklist-hold-sheet__title">Actions</div>
            <div className="checklist-hold-sheet__label truncate">
              {holdMenuItem.label}
            </div>
            <div className="checklist-hold-sheet__actions">
              <button
                type="button"
                onClick={() => {
                  const target = holdMenuItem;
                  setHoldMenuItem(null);
                  void toggle(target);
                }}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${
                    holdMenuItem.checked
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-slate-300"
                  }`}
                  aria-hidden
                >
                  {holdMenuItem.checked ? "✓" : ""}
                </span>
                {holdMenuItem.checked ? "Uncheck" : "Check"}
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => {
                  const target = holdMenuItem;
                  setHoldMenuItem(null);
                  swipeDeleteItem(target);
                }}
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-600"
                  aria-hidden
                >
                  ×
                </span>
                Archive
              </button>
            </div>
          </div>
          <button
            type="button"
            className="checklist-hold-sheet__cancel"
            onClick={() => setHoldMenuItem(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {pendingDelete && (
        <div
          key={pendingDelete.item.id}
          className="checklist-undo"
          role="status"
          aria-live="polite"
        >
          <div className="checklist-undo__card">
            <div className="checklist-undo__icon" aria-hidden>
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
                <path d="M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </div>
            <div className="checklist-undo__copy">
              <span className="checklist-undo__title">Archived</span>
              <span className="checklist-undo__label">
                {pendingDelete.item.label}
              </span>
            </div>
            <button
              type="button"
              className="checklist-undo__action"
              onClick={() => undoPendingDelete()}
            >
              Undo
            </button>
            <div
              className="checklist-undo__progress"
              style={
                { "--undo-ms": `${UNDO_WINDOW_MS}ms` } as CSSProperties
              }
              aria-hidden
            />
          </div>
        </div>
      )}
    </div>
  );
}

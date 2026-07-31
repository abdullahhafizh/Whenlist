import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api, type ChecklistItemView, type ReminderAlert } from "../api";
import { banner, btn, pageTitle } from "../ui/styles";
import { burstFromElement } from "../ui/burst";

const PRESS_MS = 280;
/** Time the checked row stays visible (with progress line) before exit. */
const HOLD_DONE_MS = 1000;
const EXIT_MS = 520;
const CHECK_ANIM_MS = 720;

export default function Checklist() {
  const [items, setItems] = useState<ChecklistItemView[]>([]);
  const [alerts, setAlerts] = useState<ReminderAlert[]>([]);
  const [meta, setMeta] = useState<{ now: string; timeZone: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
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
  const pendingRemoveRef = useRef<Set<string>>(new Set());
  const exitingRef = useRef<Set<string>>(new Set());
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

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

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.getChecklist();
      setItems((prev) => {
        const keepLocal = new Set([
          ...pendingRemoveRef.current,
          ...exitingRef.current,
        ]);
        if (keepLocal.size === 0) return data.items;
        const byId = new Map(data.items.map((i) => [i.id, i]));
        const kept = prev
          .filter((i) => keepLocal.has(i.id) && !byId.has(i.id))
          .map((i) => ({
            ...i,
            checked: exitingRef.current.has(i.id) || i.checked,
          }));
        return [...data.items, ...kept];
      });
      setAlerts(data.alerts ?? []);
      setMeta({ now: data.now, timeZone: data.timeZone });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

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
    clearItemTimers(`hold-start-${id}`);
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
    burstFromElement(cardRefs.current.get(id) ?? null);
    exitingRef.current = new Set(exitingRef.current).add(id);
    setExitingIds(new Set(exitingRef.current));
    const t = setTimeout(() => {
      exitingRef.current = new Set(
        [...exitingRef.current].filter((x) => x !== id),
      );
      setExitingIds(new Set(exitingRef.current));
      setItems((prev) => prev.filter((i) => i.id !== id));
      cardRefs.current.delete(id);
      timersRef.current.delete(id);
    }, EXIT_MS);
    timersRef.current.set(id, t);
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

    try {
      await api.check(item.id);
      if (item.completionMode === "once") {
        pendingRemoveRef.current = new Set(pendingRemoveRef.current).add(
          item.id,
        );
        setPendingRemoveIds(new Set(pendingRemoveRef.current));
        clearItemTimers(`hold-start-${item.id}`);
        clearItemTimers(item.id);
        const startHold = setTimeout(() => {
          setProgressIds((prev) => new Set(prev).add(item.id));
          const hold = setTimeout(() => {
            beginExit(item.id);
          }, HOLD_DONE_MS);
          timersRef.current.set(item.id, hold);
          timersRef.current.delete(`hold-start-${item.id}`);
        }, CHECK_ANIM_MS);
        timersRef.current.set(`hold-start-${item.id}`, startHold);
        void load();
      } else {
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

  const snoozeItem = async (item: ChecklistItemView) => {
    setBusyId(item.id);
    cancelPendingRemove(item.id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await api.snooze(item.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-xl bg-slate-200/70"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className={pageTitle}>Checklist</h1>
        {meta && (
          <p className="mt-1 text-sm text-slate-500">
            {new Date(meta.now).toLocaleString(undefined, {
              timeZone: meta.timeZone,
              dateStyle: "full",
              timeStyle: "short",
            })}{" "}
            · {meta.timeZone}
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
                      Auto · before checklist appears
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
          <p className="text-slate-600">No checklist items right now.</p>
          <p className="mt-1 text-sm text-slate-400">
            Items appear when their formula evaluates to true.
          </p>
        </div>
      ) : items.length === 0 ? null : (
        <ul className="space-y-2 overflow-visible">
          {items.map((item) => {
            const exiting = exitingIds.has(item.id);
            const pendingRemove = pendingRemoveIds.has(item.id);
            const showProgress = progressIds.has(item.id);
            const pressing = pressingId === item.id;
            const animatingCheck = animatingCheckIds.has(item.id);
            const canToggle = !exiting && (busyId === null || busyId === item.id);
            return (
              <li
                key={item.id}
                className={`checklist-row relative ${
                  exiting ? "is-exiting" : ""
                }`}
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
                  } ${exiting ? "is-exiting" : ""}`}
                >
                  <div className="checklist-card__sheen" aria-hidden />
                  <div className="relative z-[1] flex w-full items-center gap-2 px-3 py-3">
                    <button
                      type="button"
                      disabled={!canToggle}
                      onClick={() => void toggle(item)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60"
                      title={
                        pendingRemove
                          ? "Tap to undo before it disappears"
                          : undefined
                      }
                    >
                      <span
                        className={`checklist-check ${
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
                          className={`checklist-label block truncate text-base font-medium ${
                            item.checked ? "is-checked" : ""
                          } ${animatingCheck ? "is-animating" : ""}`}
                        >
                          {item.label}
                        </span>
                        <span
                          className={`mt-0.5 block truncate font-mono text-[11px] transition-colors duration-300 ${
                            pendingRemove
                              ? "text-emerald-600/80"
                              : "text-slate-400"
                          }`}
                        >
                          {pendingRemove
                            ? "Undo · disappearing soon"
                            : item.formula || "(always)"}
                        </span>
                      </span>
                    </button>

                    {(item.canSnooze ?? item.completionMode === "once") &&
                      !item.checked &&
                      !pendingRemove && (
                        <button
                          type="button"
                          disabled={busyId !== null}
                          title="Hide until a new condition window (or next day if always-on)"
                          onClick={() => void snoozeItem(item)}
                          className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 active:scale-95"
                        >
                          Snooze
                        </button>
                      )}

                    <span className="shrink-0 rounded-full bg-slate-100/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 backdrop-blur-sm">
                      {item.completionMode === "once" ? "once" : "window"}
                    </span>
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

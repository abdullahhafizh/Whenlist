import type { AstNode, CompletionMode } from "./ast.js";
import {
  evaluate,
  extractTimeParts,
  usesHourGranularity,
  type EvalContext,
} from "./evaluate.js";

export type WindowResult = {
  /** ISO string of window start, or null if unbounded / formula false now */
  windowStartAt: string | null;
  /** Formula currently evaluates true */
  currentlyValid: boolean;
  /** Hit the scan limit without finding an edge */
  unbounded: boolean;
};

const MAX_DAY_STEPS = 400;
const MAX_HOUR_STEPS = 400 * 24;

function stepConfig(ast: AstNode): { stepMs: number; maxSteps: number; hourly: boolean } {
  const hourly = usesHourGranularity(ast);
  return {
    hourly,
    stepMs: hourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
    maxSteps: hourly ? MAX_HOUR_STEPS : MAX_DAY_STEPS,
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Stable dismiss / window identity in APP timezone.
 * Day formulas → `d:YYYY-MM-DD`; hour formulas → `d:YYYY-MM-DDTHH`.
 * Avoids millisecond drift from scan cursors breaking dismiss equality.
 */
export function remindWindowKey(
  windowStartsAtIso: string,
  opts: { hourly: boolean; timeZone: string },
): string {
  const p = extractTimeParts(new Date(windowStartsAtIso), opts.timeZone);
  const day = `${p.year}-${pad2(p.month)}-${pad2(p.date)}`;
  return opts.hourly ? `d:${day}T${pad2(p.hour)}` : `d:${day}`;
}

function sameRemindWindow(
  dismissedForWindowAt: string | null,
  windowStartsAt: string,
  opts: { hourly: boolean; timeZone: string },
): boolean {
  if (!dismissedForWindowAt) return false;
  const target = remindWindowKey(windowStartsAt, opts);
  if (dismissedForWindowAt === target) return true;
  // Legacy: raw ISO was stored; compare by calendar key so slight clock drift still matches
  if (/^\d{4}-\d{2}-\d{2}T/.test(dismissedForWindowAt)) {
    return remindWindowKey(dismissedForWindowAt, opts) === target;
  }
  return false;
}

/**
 * Derive the start of the current validity window by scanning backwards
 * while the formula stays true. Dependency/self status held constant.
 */
export function deriveWindowStart(
  ast: AstNode,
  ctx: EvalContext,
): WindowResult {
  const timeZone = ctx.timeZone ?? "Asia/Jakarta";
  const currentlyValid = evaluate(ast, ctx);
  if (!currentlyValid) {
    return { windowStartAt: null, currentlyValid: false, unbounded: false };
  }

  const { stepMs, maxSteps } = stepConfig(ast);

  let cursor = new Date(ctx.now.getTime());
  let lastTrue = new Date(cursor.getTime());
  let steps = 0;

  while (steps < maxSteps) {
    cursor = new Date(cursor.getTime() - stepMs);
    const stillTrue = evaluate(ast, { ...ctx, now: cursor, timeZone });
    if (!stillTrue) {
      return {
        windowStartAt: lastTrue.toISOString(),
        currentlyValid: true,
        unbounded: false,
      };
    }
    lastTrue = new Date(cursor.getTime());
    steps++;
  }

  return {
    windowStartAt: null,
    currentlyValid: true,
    unbounded: true,
  };
}

/**
 * Next moment the formula becomes true *after* any current validity window.
 * If currently true, skips to the end of this window then finds the following one.
 * Returns null if always-true (unbounded) or never true within scan horizon.
 */
export function findNextWindowStart(
  ast: AstNode,
  ctx: EvalContext,
): string | null {
  const timeZone = ctx.timeZone ?? "Asia/Jakarta";
  const { stepMs, maxSteps } = stepConfig(ast);
  let cursor = new Date(ctx.now.getTime());
  let steps = 0;

  if (evaluate(ast, ctx)) {
    while (steps < maxSteps) {
      cursor = new Date(cursor.getTime() + stepMs);
      steps++;
      if (!evaluate(ast, { ...ctx, now: cursor, timeZone })) break;
    }
    if (evaluate(ast, { ...ctx, now: cursor, timeZone })) {
      return null; // never leaves current window
    }
  }

  while (steps < maxSteps) {
    cursor = new Date(cursor.getTime() + stepMs);
    steps++;
    if (evaluate(ast, { ...ctx, now: cursor, timeZone })) {
      return cursor.toISOString();
    }
  }

  return null;
}

/**
 * Arm a remind *before* the checklist item appears.
 * remindAt = one formula step (hour/day) before the next validity window.
 */
export function deriveRemindAt(
  ast: AstNode,
  ctx: EvalContext,
): { remindAt: string; windowStartsAt: string } | null {
  const windowStartsAt = findNextWindowStart(ast, ctx);
  if (!windowStartsAt) return null;

  const { stepMs } = stepConfig(ast);
  const remindAt = new Date(
    Date.parse(windowStartsAt) - stepMs,
  ).toISOString();

  return { remindAt, windowStartsAt };
}

/**
 * Auto remind: no manual arm. If allow_remind is on, derive the next
 * pre-window lead time and show an alert when that lead has started,
 * but only while the checklist item itself is not yet visible.
 *
 * `dismissedForWindowAt` stores a stable window key (`d:YYYY-MM-DD` / hourly)
 * so dismiss survives clock drift between requests.
 */
export function resolveAutoRemind(input: {
  allowRemind: boolean;
  currentlyValid: boolean;
  dismissedForWindowAt: string | null;
  nowIso: string;
  derived: { remindAt: string; windowStartsAt: string } | null;
  hourly: boolean;
  timeZone: string;
}): { remindAt: string; windowStartsAt: string } | null {
  if (!input.allowRemind) return null;
  if (input.currentlyValid) return null;
  if (!input.derived) return null;
  if (input.derived.remindAt > input.nowIso) return null;
  if (
    sameRemindWindow(input.dismissedForWindowAt, input.derived.windowStartsAt, {
      hourly: input.hourly,
      timeZone: input.timeZone,
    })
  ) {
    return null;
  }
  return input.derived;
}

/** Marker to persist on dismiss for the upcoming validity window. */
export function dismissRemindMarker(
  windowStartsAt: string,
  opts: { hourly: boolean; timeZone: string },
): string {
  return remindWindowKey(windowStartsAt, opts);
}

export type EffectiveCheckedInput = {
  completionMode: CompletionMode;
  checkedAt: string | null;
  windowStartAt: string | null;
  currentWindow: WindowResult;
};

/**
 * Compute whether an item is effectively checked right now.
 * - once: checked if checkedAt is set
 * - while_valid: checked if stored window_start_at matches current window start
 */
export function isEffectivelyChecked(input: EffectiveCheckedInput): boolean {
  const { completionMode, checkedAt, windowStartAt, currentWindow } = input;
  if (!checkedAt) return false;

  if (completionMode === "once") {
    return true;
  }

  if (!currentWindow.currentlyValid) {
    return false;
  }

  if (currentWindow.unbounded) {
    return true;
  }

  if (!windowStartAt || !currentWindow.windowStartAt) return false;

  return windowStartAt === currentWindow.windowStartAt;
}

/**
 * Identity of the current once-snooze window.
 * - Bounded formula window → key of that window start
 * - Unbounded / always-true (empty formula) → calendar day (or hour) of `now`
 *   so snooze can expire when a new day/hour begins
 */
export function onceSnoozeKey(
  currentWindow: WindowResult,
  opts: { now: Date; hourly: boolean; timeZone: string },
): string | null {
  if (!currentWindow.currentlyValid) return null;
  if (currentWindow.windowStartAt && !currentWindow.unbounded) {
    return remindWindowKey(currentWindow.windowStartAt, opts);
  }
  return remindWindowKey(opts.now.toISOString(), {
    hourly: opts.hourly,
    timeZone: opts.timeZone,
  });
}

/** Marker to persist when the user snoozes a once item for the current window. */
export function dismissOnceSnoozeMarker(
  currentWindow: WindowResult,
  opts: { now: Date; hourly: boolean; timeZone: string },
): string | null {
  return onceSnoozeKey(currentWindow, opts);
}

/**
 * Once-mode snooze: hide while the stored marker still matches the current
 * snooze key. Reappears when the formula enters a new validity window, or
 * (for always-true) when the calendar day/hour rolls over.
 */
export function isSnoozedAway(input: {
  completionMode: CompletionMode;
  snoozedWindowAt: string | null;
  currentWindow: WindowResult;
  now: Date;
  hourly: boolean;
  timeZone: string;
}): boolean {
  if (input.completionMode !== "once") return false;
  if (!input.snoozedWindowAt) return false;
  const key = onceSnoozeKey(input.currentWindow, {
    now: input.now,
    hourly: input.hourly,
    timeZone: input.timeZone,
  });
  if (!key) return false;
  if (input.snoozedWindowAt === key) return true;
  // Legacy: raw ISO stored — compare via calendar key
  if (/^\d{4}-\d{2}-\d{2}T/.test(input.snoozedWindowAt)) {
    return (
      remindWindowKey(input.snoozedWindowAt, {
        hourly: input.hourly,
        timeZone: input.timeZone,
      }) === key
    );
  }
  return false;
}

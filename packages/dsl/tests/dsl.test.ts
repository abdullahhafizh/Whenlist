import { describe, expect, it } from "vitest";
import {
  parse,
  serialize,
  evaluate,
  validateFormula,
  validateAst,
  findCycle,
  topologicalSort,
  deriveWindowStart,
  findNextWindowStart,
  findPrevWindowStart,
  deriveRemindAt,
  resolveAutoRemind,
  isEffectivelyChecked,
  onceSnoozeKey,
  isSnoozedAway,
  collectDependencies,
  extractTimeParts,
  type AstNode,
} from "../src/index.js";

/** Fixed instant: 2026-07-15 14:30 Asia/Jakarta = 2026-07-15 07:30 UTC */
const TZ = "Asia/Jakarta";
function jakarta(isoLocal: string): Date {
  // Construct a Date that represents the given wall time in Asia/Jakarta
  // by formatting via a known UTC offset (+07:00).
  return new Date(`${isoLocal}+07:00`);
}

const NOW = jakarta("2026-07-15T14:30:00"); // Wed, hour 14, pm, date 15, month 7, year 2026

describe("extractTimeParts", () => {
  it("extracts parts in Asia/Jakarta", () => {
    const p = extractTimeParts(NOW, TZ);
    expect(p.date).toBe(15);
    expect(p.month).toBe(7);
    expect(p.year).toBe(2026);
    expect(p.hour).toBe(14);
    expect(p.weekday).toBe(3); // Wed
    expect(p.meridiem).toBe("pm");
  });
});

describe("parser", () => {
  it("parses simple compare", () => {
    const ast = parse("date == 15");
    expect(ast).toEqual({
      type: "compare",
      field: "date",
      op: "==",
      value: { type: "num", value: 15 },
    });
  });

  it("parses between", () => {
    const ast = parse("date between 1 .. 7");
    expect(ast).toEqual({
      type: "between",
      field: "date",
      from: { type: "num", value: 1 },
      to: { type: "num", value: 7 },
    });
  });

  it("parses in list", () => {
    const ast = parse("weekday in [mon, wed, fri]");
    expect(ast).toEqual({
      type: "in",
      field: "weekday",
      values: ["mon", "wed", "fri"],
    });
  });

  it("parses status self and dependency", () => {
    expect(parse("checked")).toEqual({ type: "status", checked: true });
    expect(parse("notChecked")).toEqual({ type: "status", checked: false });
    expect(parse("checked(3)")).toEqual({ type: "status", checked: true, itemId: "3" });
    expect(parse('checked("01ABC")')).toEqual({ type: "status", checked: true, itemId: "01ABC" });
    expect(parse("notChecked(7)")).toEqual({ type: "status", checked: false, itemId: "7" });
  });

  it("parses weekend", () => {
    expect(parse("weekend")).toEqual({ type: "weekend" });
    expect(serialize(parse("weekend"))).toBe("weekend");
    expect(parse("!weekend")).toEqual({
      type: "not",
      child: { type: "weekend" },
    });
  });

  it("parses && || ! and grouping with precedence", () => {
    const ast = parse("date == 1 || date == 2 && month == jul");
    expect(ast.type).toBe("or");
    if (ast.type === "or") {
      expect(ast.children[1]!.type).toBe("and");
    }
  });

  it("parses not", () => {
    const ast = parse("!checked");
    expect(ast).toEqual({ type: "not", child: { type: "status", checked: true } });
  });

  it("parses month names and dateMonthYear", () => {
    expect(parse("month == dec")).toEqual({
      type: "compare",
      field: "month",
      op: "==",
      value: { type: "named", value: "dec" },
    });
    const ast = parse("dateMonthYear between 01-01-2026 .. 31-01-2026");
    expect(ast.type).toBe("between");
  });

  it("parses dateMonth and monthYear field-directed", () => {
    expect(parse("dateMonth == 15-07")).toEqual({
      type: "compare",
      field: "dateMonth",
      op: "==",
      value: {
        type: "composite",
        kind: "dateMonth",
        value: { day: 15, month: 7 },
      },
    });
    expect(parse("monthYear == 07-2026")).toEqual({
      type: "compare",
      field: "monthYear",
      op: "==",
      value: {
        type: "composite",
        kind: "monthYear",
        value: { month: 7, year: 2026 },
      },
    });
  });

  it("parses empty formula as always-true", () => {
    expect(parse("")).toEqual({ type: "true" });
    expect(parse("   ")).toEqual({ type: "true" });
    expect(evaluate(parse(""), { now: NOW, statusMap: {}, timeZone: TZ })).toBe(
      true,
    );
    expect(serialize(parse(""))).toBe("");
  });

  it("rejects unknown field", () => {
    expect(() => parse("foo == 1")).toThrow(/Unknown field/);
  });

  it("rejects bad hour", () => {
    expect(() => parse("hour == 25")).toThrow(/hour must be/);
  });

  it("parses arithmetic, lastDay, let, and custom fn", () => {
    const a = parse("date == ceil(lastDay / 2)");
    expect(a.type).toBe("compare");
    expect(serialize(a)).toContain("ceil");
    expect(serialize(a)).toContain("lastDay");

    const b = parse("let half = ceil(lastDay / 2);\ndate == half");
    expect(b.type).toBe("program");
    if (b.type === "program") {
      expect(b.lets).toHaveLength(1);
      expect(b.lets[0]!.name).toBe("half");
    }

    const c = parse("fn half(x) { ceil(x / 2) }\ndate == half(lastDay)");
    expect(c.type).toBe("program");
    if (c.type === "program") {
      expect(c.functions[0]!.name).toBe("half");
    }
  });
});

describe("serialize round-trip", () => {
  const samples = [
    "date == 1",
    "date between 1 .. 7 && notChecked",
    "weekday between mon .. fri && hour between 9 .. 17",
    "month == dec && date == 25",
    "hour between 22 .. 6",
    "dateMonthYear between 01-01-2026 .. 31-01-2026",
    "(weekday == sat || weekday == sun) && meridiem == am",
    "date == 5 && checked(3) && notChecked(7)",
    "!(weekday == sun)",
    "year >= 2026",
    "dateMonth == 15-07",
    "monthYear == 07-2026",
    "meridiem == pm",
    "weekday in [mon, tue, wed]",
    "date == ceil(lastDay / 2)",
    "let half = ceil(lastDay / 2);\ndate == half",
    "fn half(x) { ceil(x / 2) }\ndate == half(lastDay)",
  ];

  for (const s of samples) {
    it(`round-trips: ${s}`, () => {
      const ast1 = parse(s);
      const text = serialize(ast1);
      const ast2 = parse(text);
      expect(ast2).toEqual(ast1);
      expect(serialize(ast2)).toBe(text);
    });
  }
});

describe("evaluate", () => {
  const ctx = (statusMap: Record<string, boolean> = {}, selfId = "1") => ({
    now: NOW,
    statusMap,
    selfId,
    timeZone: TZ,
  });

  it("date == 15 is true", () => {
    expect(evaluate(parse("date == 15"), ctx())).toBe(true);
    expect(evaluate(parse("date == 1"), ctx())).toBe(false);
  });

  it("ceil(lastDay/2), let, and custom fn", () => {
    // July 2026 has 31 days → ceil(31/2)=16; NOW is date 15 → false
    expect(evaluate(parse("date == ceil(lastDay / 2)"), ctx())).toBe(false);
    expect(evaluate(parse("date == 15"), ctx())).toBe(true);
    expect(
      evaluate(parse("let half = ceil(lastDay / 2);\ndate == half - 1"), ctx()),
    ).toBe(true);
    expect(
      evaluate(parse("fn half(x) { ceil(x / 2) }\ndate == half(lastDay) - 1"), ctx()),
    ).toBe(true);
    expect(evaluate(parse("monthLength == 31"), ctx())).toBe(true);
    expect(evaluate(parse("date == lastDay"), ctx())).toBe(false);
    const endJul = jakarta("2026-07-31T12:00:00");
    expect(
      evaluate(parse("date == lastDay"), {
        now: endJul,
        statusMap: {},
        selfId: "1",
        timeZone: TZ,
      }),
    ).toBe(true);
  });

  it("prevLastDay is previous month length", () => {
    // July 2026 → June has 30 days
    expect(evaluate(parse("prevLastDay == 30"), ctx())).toBe(true);
    expect(evaluate(parse("prevLastDay == 31"), ctx())).toBe(false);
    const mid = parse(`let prev = prevLastDay;
let mid = 25 + ceil(prev / 2) - prev;
(date == mid - 1 && weekday between sun .. thu) ||
(date == mid - 2 && weekday == thu) ||
(date == mid - 3 && weekday == thu)`);
    // mid = 10 → candidates 9/8/7; Jul 9 2026 is Thu → true
    expect(
      evaluate(mid, {
        now: jakarta("2026-07-09T12:00:00"),
        statusMap: {},
        selfId: "1",
        timeZone: TZ,
      }),
    ).toBe(true);
    expect(
      evaluate(mid, {
        now: jakarta("2026-07-15T12:00:00"),
        statusMap: {},
        selfId: "1",
        timeZone: TZ,
      }),
    ).toBe(false);
  });

  it("month == jul", () => {
    expect(evaluate(parse("month == jul"), ctx())).toBe(true);
    expect(evaluate(parse("month == 7"), ctx())).toBe(true);
    expect(evaluate(parse("month == dec"), ctx())).toBe(false);
  });

  it("year and hour", () => {
    expect(evaluate(parse("year == 2026"), ctx())).toBe(true);
    expect(evaluate(parse("hour == 14"), ctx())).toBe(true);
    expect(evaluate(parse("meridiem == pm"), ctx())).toBe(true);
  });

  it("weekday wed", () => {
    expect(evaluate(parse("weekday == wed"), ctx())).toBe(true);
    expect(evaluate(parse("weekday between mon .. fri"), ctx())).toBe(true);
    expect(evaluate(parse("weekday == sat"), ctx())).toBe(false);
  });

  it("date between", () => {
    expect(evaluate(parse("date between 1 .. 20"), ctx())).toBe(true);
    expect(evaluate(parse("date between 20 .. 31"), ctx())).toBe(false);
  });

  it("hour wrap-around 22 .. 6", () => {
    // 14 is NOT in night shift
    expect(evaluate(parse("hour between 22 .. 6"), ctx())).toBe(false);
    const night = jakarta("2026-07-15T23:00:00");
    expect(
      evaluate(parse("hour between 22 .. 6"), {
        now: night,
        statusMap: {},
        timeZone: TZ,
      }),
    ).toBe(true);
    const early = jakarta("2026-07-15T05:00:00");
    expect(
      evaluate(parse("hour between 22 .. 6"), {
        now: early,
        statusMap: {},
        timeZone: TZ,
      }),
    ).toBe(true);
  });

  it("weekday wrap-around sat .. mon", () => {
    // wed is not in sat..mon wrap
    expect(evaluate(parse("weekday between sat .. mon"), ctx())).toBe(false);
    const sat = jakarta("2026-07-18T12:00:00"); // Saturday
    expect(
      evaluate(parse("weekday between sat .. mon"), {
        now: sat,
        statusMap: {},
        timeZone: TZ,
      }),
    ).toBe(true);
  });

  it("dateMonthYear range", () => {
    expect(
      evaluate(parse("dateMonthYear between 01-01-2026 .. 31-12-2026"), ctx()),
    ).toBe(true);
    expect(
      evaluate(parse("dateMonthYear between 01-01-2025 .. 31-12-2025"), ctx()),
    ).toBe(false);
  });

  it("cross year monthYear", () => {
    expect(evaluate(parse("monthYear == 07-2026"), ctx())).toBe(true);
    expect(evaluate(parse("monthYear between 12-2025 .. 08-2026"), ctx())).toBe(
      true,
    );
  });

  it("logical combinations", () => {
    expect(
      evaluate(parse("date == 15 && month == jul || date == 1"), ctx()),
    ).toBe(true);
    expect(
      evaluate(parse("(weekday == sat || weekday == sun) && meridiem == am"), ctx()),
    ).toBe(false);
    expect(evaluate(parse("!weekday == sun"), ctx())).toBe(true);
  });

  it("status checked / notChecked / deps", () => {
    expect(evaluate(parse("checked"), ctx({ "1": true }, "1"))).toBe(true);
    expect(evaluate(parse("notChecked"), ctx({ "1": true }, "1"))).toBe(false);
    expect(evaluate(parse('checked("3")'), ctx({ "3": true }))).toBe(true);
    expect(evaluate(parse('notChecked("7")'), ctx({ "7": false }))).toBe(true);
    expect(
      evaluate(
        parse('date == 15 && checked("3") && notChecked("7")'),
        ctx({ "3": true, "7": false }),
      ),
    ).toBe(true);
  });

  it("weekend is sat/sun only", () => {
    // NOW is Wed → false
    expect(evaluate(parse("weekend"), ctx())).toBe(false);
    expect(evaluate(parse("!weekend"), ctx())).toBe(true);
    expect(
      evaluate(parse("weekend"), {
        now: jakarta("2026-07-18T10:00:00"), // Sat
        statusMap: {},
        timeZone: TZ,
      }),
    ).toBe(true);
    expect(
      evaluate(parse("weekend"), {
        now: jakarta("2026-07-19T10:00:00"), // Sun
        statusMap: {},
        timeZone: TZ,
      }),
    ).toBe(true);
  });

  it("in list", () => {
    expect(evaluate(parse("weekday in [mon, wed, fri]"), ctx())).toBe(true);
    expect(evaluate(parse("date in [1, 2, 3]"), ctx())).toBe(false);
  });
});

describe("validate", () => {
  it("rejects reversed linear range", () => {
    const r = validateFormula("year between 2030 .. 2020");
    expect(r.ok).toBe(false);
  });

  it("warns on cyclic wrap-around", () => {
    const ast = parse("hour between 22 .. 6");
    const issues = validateAst(ast);
    expect(issues.some((i) => i.severity === "warning")).toBe(true);
  });

  it("detects self-reference", () => {
    const r = validateFormula("checked(5)", {
      selfId: "5",
      knownIds: ["5"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/itself|Circular/i);
  });

  it("detects missing id", () => {
    const r = validateFormula("checked(99)", {
      selfId: "1",
      knownIds: ["1", "2"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not exist/);
  });

  it("detects circular dependency A→B→A", () => {
    const cycle = findCycle("1", ["2"], new Map([["2", ["1"]]]));
    expect(cycle).not.toBeNull();
  });

  it("allows acyclic deps", () => {
    const cycle = findCycle(
      "1",
      ["2"],
      new Map([
        ["2", ["3"]],
        ["3", []],
      ]),
    );
    expect(cycle).toBeNull();
  });

  it("topologicalSort orders deps first", () => {
    const order = topologicalSort(
      ["1", "2", "3"],
      new Map([
        ["1", ["2"]],
        ["2", ["3"]],
        ["3", []],
      ]),
    );
    expect(order.indexOf("3")).toBeLessThan(order.indexOf("2"));
    expect(order.indexOf("2")).toBeLessThan(order.indexOf("1"));
  });

  it("collectDependencies", () => {
    expect(collectDependencies(parse('checked("3") && notChecked("7")'))).toEqual([
      "3", "7",
    ]);
  });
});

describe("window derivation", () => {
  it("finds window start for date between 1 .. 7", () => {
    // On July 5, window 1..7 should start around July 1
    const now = jakarta("2026-07-05T12:00:00");
    const ast = parse("date between 1 .. 7");
    const w = deriveWindowStart(ast, { now, statusMap: {}, timeZone: TZ });
    expect(w.currentlyValid).toBe(true);
    expect(w.unbounded).toBe(false);
    expect(w.windowStartAt).not.toBeNull();
    const start = new Date(w.windowStartAt!);
    const parts = extractTimeParts(start, TZ);
    expect(parts.date).toBe(1);
    expect(parts.month).toBe(7);
  });

  it("returns not valid outside window", () => {
    const now = jakarta("2026-07-15T12:00:00");
    const ast = parse("date between 1 .. 7");
    const w = deriveWindowStart(ast, { now, statusMap: {}, timeZone: TZ });
    expect(w.currentlyValid).toBe(false);
    expect(w.windowStartAt).toBeNull();
  });

  it("unbounded for always-true-ish formula", () => {
    const now = jakarta("2026-07-15T12:00:00");
    // year >= 2000 is true for 400 days back
    const ast = parse("year >= 2000");
    const w = deriveWindowStart(ast, { now, statusMap: {}, timeZone: TZ });
    expect(w.currentlyValid).toBe(true);
    expect(w.unbounded).toBe(true);
  });

  it("findNext / findPrev window for date == 15", () => {
    const ast = parse("date == 15");
    const mid = jakarta("2026-07-20T12:00:00");
    const ctx = { now: mid, statusMap: {}, timeZone: TZ };
    const next = findNextWindowStart(ast, ctx);
    expect(next).not.toBeNull();
    expect(extractTimeParts(new Date(next!), TZ)).toMatchObject({
      date: 15,
      month: 8,
      year: 2026,
    });
    const prev = findPrevWindowStart(ast, ctx);
    expect(prev).not.toBeNull();
    expect(extractTimeParts(new Date(prev!), TZ)).toMatchObject({
      date: 15,
      month: 7,
      year: 2026,
    });
    // From inside a window, next skips ahead and prev goes to prior month
    const onDay = jakarta("2026-07-15T12:00:00");
    const nextFromOn = findNextWindowStart(ast, {
      now: onDay,
      statusMap: {},
      timeZone: TZ,
    });
    expect(extractTimeParts(new Date(nextFromOn!), TZ).month).toBe(8);
    const prevFromOn = findPrevWindowStart(ast, {
      now: onDay,
      statusMap: {},
      timeZone: TZ,
    });
    expect(extractTimeParts(new Date(prevFromOn!), TZ)).toMatchObject({
      date: 15,
      month: 6,
      year: 2026,
    });
  });

  it("effective checked once mode", () => {
    expect(
      isEffectivelyChecked({
        completionMode: "once",
        checkedAt: "2026-01-01T00:00:00.000Z",
        windowStartAt: null,
        currentWindow: { windowStartAt: null, currentlyValid: false, unbounded: false },
      }),
    ).toBe(true);
    expect(
      isEffectivelyChecked({
        completionMode: "once",
        checkedAt: null,
        windowStartAt: null,
        currentWindow: { windowStartAt: null, currentlyValid: true, unbounded: false },
      }),
    ).toBe(false);
  });

  it("effective checked while_valid matches window", () => {
    const win = "2026-07-01T05:00:00.000Z";
    expect(
      isEffectivelyChecked({
        completionMode: "while_valid",
        checkedAt: "2026-07-03T00:00:00.000Z",
        windowStartAt: win,
        currentWindow: {
          windowStartAt: win,
          currentlyValid: true,
          unbounded: false,
        },
      }),
    ).toBe(true);
    expect(
      isEffectivelyChecked({
        completionMode: "while_valid",
        checkedAt: "2026-07-03T00:00:00.000Z",
        windowStartAt: win,
        currentWindow: {
          windowStartAt: "2026-08-01T05:00:00.000Z",
          currentlyValid: true,
          unbounded: false,
        },
      }),
    ).toBe(false);
  });

  it("deriveRemindAt arms one step before the next window", () => {
    // Mid-month: next date 1..7 window is Aug 1; remind = Jul 31
    const now = jakarta("2026-07-15T12:00:00");
    const ast = parse("date between 1 .. 7");
    const derived = deriveRemindAt(ast, { now, statusMap: {}, timeZone: TZ });
    expect(derived).not.toBeNull();
    const windowParts = extractTimeParts(new Date(derived!.windowStartsAt), TZ);
    expect(windowParts.date).toBe(1);
    expect(windowParts.month).toBe(8);
    const remindParts = extractTimeParts(new Date(derived!.remindAt), TZ);
    expect(remindParts.date).toBe(31);
    expect(remindParts.month).toBe(7);
  });

  it("deriveRemindAt skips current window when already valid", () => {
    const now = jakarta("2026-07-05T12:00:00");
    const ast = parse("date between 1 .. 7");
    const derived = deriveRemindAt(ast, { now, statusMap: {}, timeZone: TZ });
    expect(derived).not.toBeNull();
    const windowParts = extractTimeParts(new Date(derived!.windowStartsAt), TZ);
    expect(windowParts.month).toBe(8);
    expect(windowParts.date).toBe(1);
  });

  it("resolveAutoRemind shows in lead window without manual arm", () => {
    const derived = {
      remindAt: "2026-07-31T05:00:00.000Z",
      windowStartsAt: "2026-08-01T05:00:00.000Z",
    };
    const base = {
      allowRemind: true,
      currentlyValid: false,
      nowIso: "2026-07-31T12:00:00.000Z",
      derived,
      hourly: false,
      timeZone: TZ,
    };
    expect(
      resolveAutoRemind({
        ...base,
        dismissedForWindowAt: null,
      }),
    ).toEqual(derived);
    expect(
      resolveAutoRemind({
        ...base,
        currentlyValid: true,
        dismissedForWindowAt: null,
        nowIso: "2026-08-01T12:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      resolveAutoRemind({
        ...base,
        dismissedForWindowAt: "d:2026-08-01",
      }),
    ).toBeNull();
    // Legacy ISO dismiss marker still suppresses despite ms drift
    expect(
      resolveAutoRemind({
        ...base,
        dismissedForWindowAt: "2026-08-01T05:00:07.123Z",
      }),
    ).toBeNull();
    expect(
      resolveAutoRemind({
        ...base,
        allowRemind: false,
        dismissedForWindowAt: null,
      }),
    ).toBeNull();
  });

  it("once snooze hides for current window then clears on new window", () => {
    const now = jakarta("2026-07-05T12:00:00");
    const ast = parse("date between 1 .. 7");
    const currentWindow = deriveWindowStart(ast, {
      now,
      statusMap: {},
      timeZone: TZ,
    });
    expect(currentWindow.currentlyValid).toBe(true);
    expect(currentWindow.unbounded).toBe(false);

    const key = onceSnoozeKey(currentWindow, {
      now,
      hourly: false,
      timeZone: TZ,
    });
    expect(key).toBe("d:2026-07-01");

    expect(
      isSnoozedAway({
        completionMode: "once",
        snoozedWindowAt: key,
        currentWindow,
        now,
        hourly: false,
        timeZone: TZ,
      }),
    ).toBe(true);

    // Next month's window is a new condition
    const next = jakarta("2026-08-03T12:00:00");
    const nextWindow = deriveWindowStart(ast, {
      now: next,
      statusMap: {},
      timeZone: TZ,
    });
    expect(
      isSnoozedAway({
        completionMode: "once",
        snoozedWindowAt: key,
        currentWindow: nextWindow,
        now: next,
        hourly: false,
        timeZone: TZ,
      }),
    ).toBe(false);
  });

  it("once snooze for empty/always formula uses calendar day", () => {
    const now = jakarta("2026-07-15T14:30:00");
    const ast = parse("");
    const currentWindow = deriveWindowStart(ast, {
      now,
      statusMap: {},
      timeZone: TZ,
    });
    expect(currentWindow.currentlyValid).toBe(true);
    expect(currentWindow.unbounded).toBe(true);

    const key = onceSnoozeKey(currentWindow, {
      now,
      hourly: false,
      timeZone: TZ,
    });
    expect(key).toBe("d:2026-07-15");

    expect(
      isSnoozedAway({
        completionMode: "once",
        snoozedWindowAt: key,
        currentWindow,
        now,
        hourly: false,
        timeZone: TZ,
      }),
    ).toBe(true);

    const tomorrow = jakarta("2026-07-16T00:30:00");
    const nextWindow = deriveWindowStart(ast, {
      now: tomorrow,
      statusMap: {},
      timeZone: TZ,
    });
    expect(
      isSnoozedAway({
        completionMode: "once",
        snoozedWindowAt: key,
        currentWindow: nextWindow,
        now: tomorrow,
        hourly: false,
        timeZone: TZ,
      }),
    ).toBe(false);

    // while_valid never snoozes via this helper
    expect(
      isSnoozedAway({
        completionMode: "while_valid",
        snoozedWindowAt: key,
        currentWindow,
        now,
        hourly: false,
        timeZone: TZ,
      }),
    ).toBe(false);
  });
});

describe("example formulas from plan", () => {
  const cases: { formula: string; expectTrue: boolean }[] = [
    { formula: "date == 15", expectTrue: true },
    { formula: "date between 1 .. 7 && notChecked", expectTrue: false },
    { formula: "weekday between mon .. fri && hour between 9 .. 17", expectTrue: true },
    { formula: "month == dec && date == 25", expectTrue: false },
    { formula: "hour between 22 .. 6", expectTrue: false },
    {
      formula: "dateMonthYear between 01-01-2026 .. 31-01-2026",
      expectTrue: false,
    },
    {
      formula: "(weekday == sat || weekday == sun) && meridiem == am",
      expectTrue: false,
    },
  ];

  for (const c of cases) {
    it(`${c.formula} => ${c.expectTrue}`, () => {
      const ast: AstNode = parse(c.formula);
      expect(
        evaluate(ast, {
          now: NOW,
          statusMap: { "1": false },
          selfId: "1",
          timeZone: TZ,
        }),
      ).toBe(c.expectTrue);
    });
  }
});

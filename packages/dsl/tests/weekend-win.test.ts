import { describe, expect, it } from "vitest";
import {
  parse,
  evaluate,
  findNextWindowStart,
  findPrevWindowStart,
  findPrevTrueMoment,
  findNextTrueMoment,
  extractTimeParts,
} from "../src/index.js";

const TZ = "Asia/Jakarta";
function jakarta(isoLocal: string): Date {
  return new Date(`${isoLocal}+07:00`);
}
function day(iso: string | null) {
  if (!iso) return null;
  const p = extractTimeParts(new Date(iso), TZ);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.date).padStart(2, "0")}`;
}

describe("weekend windows", () => {
  const ast = parse("weekend");

  it("preview neighbors step day-by-day through the weekend", () => {
    const sat = {
      now: jakarta("2026-08-01T12:00:00"),
      statusMap: {},
      timeZone: TZ,
    };
    expect(evaluate(ast, sat)).toBe(true);
    // Not window-skip: next is Sunday, not next week
    expect(day(findNextTrueMoment(ast, sat))).toBe("2026-08-02");
    expect(day(findPrevTrueMoment(ast, sat))).toBe("2026-07-26");

    const sun = {
      now: jakarta("2026-08-02T12:00:00"),
      statusMap: {},
      timeZone: TZ,
    };
    expect(day(findNextTrueMoment(ast, sun))).toBe("2026-08-08");
    expect(day(findPrevTrueMoment(ast, sun))).toBe("2026-08-01");

    const fri = {
      now: jakarta("2026-07-31T12:00:00"),
      statusMap: {},
      timeZone: TZ,
    };
    expect(day(findNextTrueMoment(ast, fri))).toBe("2026-08-01");
    expect(day(findPrevTrueMoment(ast, fri))).toBe("2026-07-26");
  });

  it("window finders still skip the full Sat–Sun run", () => {
    const sat = {
      now: jakarta("2026-08-01T12:00:00"),
      statusMap: {},
      timeZone: TZ,
    };
    expect(day(findNextWindowStart(ast, sat))).toBe("2026-08-08");
    expect(day(findPrevWindowStart(ast, sat))).toBe("2026-07-25");
  });
});

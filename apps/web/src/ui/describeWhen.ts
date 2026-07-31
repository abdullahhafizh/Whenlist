/** Plain-language copy helpers — see docs/user-guide.md + whenlist-ui-copy rule. */

export type CompletionModeUi = "once" | "while_valid";

export function modeBadge(mode: CompletionModeUi): string {
  return mode === "once" ? "One-time" : "Repeats";
}

/**
 * Short schedule line under a checklist title. Never dump raw DSL.
 */
export function describeWhen(
  formula: string,
  mode: CompletionModeUi,
): string {
  const f = formula.trim().toLowerCase();
  if (!f) {
    return mode === "once" ? "Until done" : "Always";
  }

  if (f === "weekend") return "Weekends";
  if (/^weekday\s*==\s*mon$/.test(f)) return "Mondays";
  if (/^weekday\s*==\s*tue$/.test(f)) return "Tuesdays";
  if (/^weekday\s*==\s*wed$/.test(f)) return "Wednesdays";
  if (/^weekday\s*==\s*thu$/.test(f)) return "Thursdays";
  if (/^weekday\s*==\s*fri$/.test(f)) return "Fridays";
  if (/^weekday\s*==\s*sat$/.test(f)) return "Saturdays";
  if (/^weekday\s*==\s*sun$/.test(f)) return "Sundays";

  const dateEq = f.match(/^date\s*==\s*(\d{1,2})$/);
  if (dateEq) return `On the ${dateEq[1]}`;

  const dateBetween = f.match(
    /^date\s+between\s+(\d{1,2})\s*\.\.\s*(\d{1,2})$/,
  );
  if (dateBetween) return `Days ${dateBetween[1]}–${dateBetween[2]}`;

  if (f.includes("checked(") || f.includes("notchecked(")) {
    return "After a related item";
  }
  if (f.includes("hour") || f.includes("meridiem")) {
    return "At a set time";
  }
  if (f.includes("weekday") || f.includes("date") || f.includes("month")) {
    return "On a schedule";
  }

  return "On a schedule";
}

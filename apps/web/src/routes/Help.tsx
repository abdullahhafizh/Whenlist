import { Link } from "react-router-dom";
import { pageTitle } from "../ui/styles";

function Code({ children }: { children: string }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-teal-900">
      {children}
    </code>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] leading-relaxed text-slate-800">
      {children}
    </pre>
  );
}

export default function Help() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-10 pb-12">
      <div>
        <h1 className={pageTitle}>Help</h1>
        <p className="mt-1 text-sm text-slate-600">
          Whenlist shows tasks{" "}
          <span className="font-medium">only when their schedule matches</span>.
        </p>
        <nav className="mt-3 flex flex-wrap gap-2 text-xs">
          <a
            href="#basics"
            className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-800"
          >
            Basics
          </a>
          <a
            href="#schedule-rules"
            className="rounded-lg bg-teal-700 px-2.5 py-1 font-medium text-white hover:bg-teal-800"
          >
            Schedule rules
          </a>
          <a
            href="#examples"
            className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-800"
          >
            Examples
          </a>
        </nav>
      </div>

      <section id="basics" className="scroll-mt-20 space-y-6">
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Three ideas</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>
              <span className="font-medium">Title</span> — what to do.
            </li>
            <li>
              <span className="font-medium">When it shows</span> — the schedule.
            </li>
            <li>
              <span className="font-medium">One-time</span> or{" "}
              <span className="font-medium">Repeats</span>.
            </li>
          </ol>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Checklist</h3>
          <ul className="space-y-2 text-sm text-slate-700">
            <li>
              <span className="font-medium">Check</span> — mark done. One-time
              items pop away.
            </li>
            <li>
              <span className="font-medium">Later</span> — hide for now; returns
              next time it should show.
            </li>
            <li>
              <span className="font-medium">Archive</span> — remove; restore in{" "}
              <Link className="text-teal-700 underline" to="/builder">
                Builder
              </Link>
              .
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Create</h3>
          <p className="text-sm text-slate-700">
            On{" "}
            <Link className="text-teal-700 underline" to="/create">
              Create
            </Link>
            , write normally → <span className="font-medium">Make checklist item</span>.
          </p>
        </div>
      </section>

      <section id="schedule-rules" className="scroll-mt-20 space-y-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Schedule rules
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Use these in Builder <span className="font-medium">Advanced text</span>,
            or learn what Create/Builder produced. Keywords are English.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Finishing mode</h3>
          <ul className="space-y-1.5 text-sm text-slate-700">
            <li>
              <span className="font-medium">Repeats</span> — shows whenever the
              schedule is true.
            </li>
            <li>
              <span className="font-medium">One-time</span> — until you check it
              off.
            </li>
            <li>
              Empty schedule + One-time = always listed until done.
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Combine</h3>
          <Pre>{`A && B          both
A || B          either
!A              not
(A || B) && C   group`}</Pre>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Time fields</h3>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Field</th>
                  <th className="px-3 py-2 font-semibold">Meaning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {(
                  [
                    ["date", "Day of month (1–31)"],
                    ["month", "Month (1–12 or jan–dec)"],
                    ["year", "Year"],
                    ["hour", "Hour 0–23"],
                    ["weekday", "mon–sun"],
                    ["meridiem", "am / pm"],
                    ["dateMonth", "Day+month (25-12)"],
                    ["monthYear", "Month+year (07-2026)"],
                    ["dateMonthYear", "Full date"],
                    ["lastDay / monthLength", "Days in this month"],
                    ["prevLastDay", "Days in previous month"],
                  ] as const
                ).map(([f, m]) => (
                  <tr key={f}>
                    <td className="px-3 py-2 font-mono text-xs text-teal-800">
                      {f}
                    </td>
                    <td className="px-3 py-2">{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Compare</h3>
          <Pre>{`date == 15
month == jul
weekday != sun
year >= 2026
meridiem == am`}</Pre>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Between</h3>
          <p className="text-xs text-slate-500">
            Inclusive. Overnight / week wraps are OK for date, month, hour,
            weekday.
          </p>
          <Pre>{`date between 1 .. 7
hour between 22 .. 6
weekday between fri .. mon`}</Pre>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">One of</h3>
          <Pre>{`weekday in [mon, wed, fri]
date in [1, 15, 28]`}</Pre>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Weekend & checks</h3>
          <Pre>{`weekend
!weekend
checked("ITEM_ID")
notChecked("ITEM_ID")`}</Pre>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Math</h3>
          <Pre>{`date == ceil(lastDay / 2)
date == floor(monthLength / 2)
date == min(1, 15, 28)`}</Pre>
          <p className="text-xs text-slate-500">
            Built-ins: <Code>ceil</Code> <Code>floor</Code> <Code>round</Code>{" "}
            <Code>abs</Code> <Code>min</Code> <Code>max</Code>
          </p>
        </div>
      </section>

      <section id="examples" className="scroll-mt-20 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          Copy-ready examples
        </h2>
        <div className="space-y-2 text-sm">
          {(
            [
              ["Every 25th", "date == 25"],
              ["Weekends", "weekend"],
              ["Weekday mornings", "!weekend && meridiem == am"],
              ["Fri–Mon evenings", "weekday between fri .. mon && hour between 20 .. 23"],
              ["Payday-ish", "date == 25 || date == lastDay"],
              ["Christmas", "dateMonth == 25-12"],
              ["Mid-month", "date == ceil(lastDay / 2)"],
              ["One-time always", "(leave empty) + One-time mode"],
            ] as const
          ).map(([title, formula]) => (
            <div
              key={title}
              className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="font-medium text-slate-800">{title}</span>
              <code className="font-mono text-[11px] text-teal-800">
                {formula}
              </code>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-slate-400">
        Same rules live in the repo as{" "}
        <code className="rounded bg-slate-100 px-1">docs/schedule-rules.md</code>
        . Builder blocks are the visual form of this language.
      </p>
    </div>
  );
}

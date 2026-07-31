# Whenlist schedule rules (user reference)

This is the **human-readable** guide to when an item shows.
In the app: open **Help** → Schedule rules (`/help#schedule-rules`).

You can build schedules with **blocks** in Builder, or type them under **Advanced text**.
Keywords below are English only.

---

## How finishing works

| Mode | Meaning |
|------|---------|
| **Repeats** | Shows whenever the schedule is true. After you check it, it can return in a new schedule window. |
| **One-time** | Shows until you check it off, then it’s done (unless you Reset in Builder). |
| Empty schedule + One-time | Always on the list until checked. |

---

## Combine rules

| Write | Meaning | Example |
|-------|---------|---------|
| `A && B` | And — both must match | `date == 25 && meridiem == am` |
| `A \|\| B` | Or — either matches | `weekday == fri \|\| weekend` |
| `!A` | Not | `!weekend` |
| `( … )` | Group | `(date == 1 \|\| date == 15) && meridiem == am` |

---

## Time pieces

| Field | Meaning | Example values |
|-------|---------|----------------|
| `date` | Day of month | `1` … `31` |
| `month` | Month | `1`…`12` or `jan`…`dec` |
| `year` | Year | `2026` |
| `hour` | Hour (0–23) | `9`, `17` |
| `weekday` | Day of week | `mon` … `sun` |
| `meridiem` | Morning / afternoon | `am`, `pm` |
| `dateMonth` | Day + month | `25-12`, `01-jan` |
| `monthYear` | Month + year | `07-2026`, `jul-2026` |
| `dateMonthYear` | Full date | `31-07-2026` |
| `lastDay` / `monthLength` | Last day / length of this month | `28`…`31` |

### Compare

```
date == 15
month == jul
weekday != sun
year >= 2026
meridiem == am
```

### Between (inclusive)

```
date between 1 .. 7
hour between 22 .. 6          ← overnight wrap is OK
weekday between fri .. mon    ← wrap OK
year between 2020 .. 2030     ← year must go forward
```

### One of several

```
weekday in [mon, wed, fri]
date in [1, 15, 28]
month in [jan, jun, dec]
```

### Shortcuts

```
weekend          ← Saturday or Sunday
!weekend
```

---

## Depends on other items

```
checked                      ← this item is checked (rare in schedules)
notChecked
checked("ITEM_ID")           ← another item is checked
notChecked("ITEM_ID")
```

Use a real item id from Builder (not a made-up name).

---

## Math on the right-hand side

```
date == ceil(lastDay / 2)     ← mid-month-ish
date == floor(monthLength / 2)
date == min(1, 15, 28)
date == max(10, date)
```

Built-ins: `ceil`, `floor`, `round`, `abs`, `min`, `max`.

### Optional helpers

```
fn half(x) { ceil(x / 2) }
let mid = half(lastDay);
date == mid
```

---

## Full examples

| Goal | Schedule text | Mode |
|------|---------------|------|
| Always until done | *(leave empty)* | One-time |
| Every 25th | `date == 25` | Repeats |
| Weekends | `weekend` | Repeats |
| Weekday mornings | `!weekend && meridiem == am` | Repeats |
| Fri–Mon nights | `weekday between fri .. mon && hour between 20 .. 23` | Repeats |
| Payday-ish | `date == 25 \|\| date == lastDay` | Repeats |
| Christmas | `dateMonth == 25-12` | Repeats or One-time |

---

## Where to edit

1. **Create** — describe in normal language; review the draft.
2. **Builder** — drag blocks, or open **Advanced text**.
3. **Help** (this doc in the app) — `/help#schedule-rules`.

Agent/dev mirror of the same language: `apps/api/src/dslNlRules.ts`, `packages/dsl/src/ast.ts`.

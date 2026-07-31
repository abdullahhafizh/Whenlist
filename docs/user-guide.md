# Whenlist — user guide

Whenlist shows checklist items **only when their schedule matches**. You don’t need to know any technical language — just these three ideas.

## Core ideas

1. **Title** — what to do (e.g. “Pay electricity”).
2. **When it shows** — the schedule (e.g. every 25th).
3. **One-time or repeats**
   - **One-time** — stays until you check it off; then it’s done for good (reset in Builder if needed).
   - **Repeats** — comes back whenever the schedule matches again (e.g. weekends).

## Pages

| Page | Purpose |
|------|---------|
| **Checklist** | See what’s due, check off, snooze (“Later”), archive |
| **Create** | Add an item from everyday language |
| **Builder** | Fine-tune schedules with blocks (best on a laptop) |
| **Help** | This guide |

---

## Checklist

### What you see

- Only items that **should show right now**.
- Under the title: a short plain schedule line (not code).
- Badges:
  - **One-time** — gone after you check it
  - **Repeats** — can show again later

### Actions

| Action | How | Result |
|--------|-----|--------|
| Check | Tap the circle / long-press → Check | Mark done. **One-time** items disappear with the pop animation. |
| Later | **Later** button | Hidden for now; returns next time it should show. |
| Archive | Swipe left / long-press → Archive | Off the list. **Restore** under Builder → Archived. |
| Undo archive | **Undo** on the snackbar (~5s) | Brings the item back. |

### Examples

- “Buy a tumbler” (**One-time**, until done) → always listed until checked, then gone.
- “Wash the car” (**Repeats**, weekends) → only Sat–Sun.

### Empty list?

Nothing is due right now — the schedule simply doesn’t match. That’s normal.

---

## Create (from text)

1. Write a normal request, e.g.:
   - `pay electricity every 25th, remind me beforehand`
   - `shave every weekend`
   - `buy a bottle — one time only`
2. Press **Make checklist item**.
3. Review **Title**, **when it shows**, **One-time / Repeats**, **Remind me early**.
4. **Save** — then tidy in Builder if you want.

### Options

| Option | Meaning |
|--------|---------|
| **One-time — stays until I check it off** | Always listed until done |
| **Repeats on schedule** | Comes back when the schedule matches |
| **Remind me early** | Nudge before it’s due (needs a timed schedule, not empty “until done”) |

---

## Builder

Build **when an item shows** with blocks:

- **And / Or / Group / Not** — combine rules
- **Day / date / hour / weekend** — time
- **Checked / not checked** — depends on other items

### Done mode

| Builder choice | User meaning |
|----------------|--------------|
| Repeats | Shows again when the schedule matches |
| One-time | Gone after it’s checked |

### Archive

Archived items live under **Archived** in Builder → **Restore**.

### Preview

Change the sample date/time → see **Showing now** or **Hidden now**.

---

## Full behavior examples

### 1. One-time shopping

- Title: Buy tumbler  
- When: until done  
- Mode: **One-time**  
- Result: always on Checklist until checked → pops away.

### 2. Monthly bill

- Title: Pay electricity  
- When: 25th each month  
- Mode: **Repeats**  
- Remind: yes  
- Result: shows around the 25th; after check, waits until next month.

### 3. Weekend chore

- Title: Wash car  
- When: weekend  
- Mode: **Repeats**  
- Result: only Sat–Sun.

### 4. Depends on another item

- Title: Hang laundry  
- When: after “Wash clothes” is checked  
- Mode: **Repeats** or **One-time** as needed  

---

## Words we avoid in UI

Don’t say to users: formula, DSL, AST, `while_valid`, evaluate, parse.  
Say: schedule, when it shows, one-time, repeats, later, archive, restore.

Dev docs: `README.md`, `.cursor/rules/whenlist-dsl.mdc`.

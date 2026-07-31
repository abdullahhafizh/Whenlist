# Whenlist

The checklist that knows when. Mobile-friendly checklist where each item appears only when its formula evaluates to `true`.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript + Vite + Tailwind |
| API | Cloudflare Workers (Hono) |
| Database | Cloudflare D1 |
| Shared DSL | `@whenlist/dsl` (parser, evaluator, window derivation) |

**Deploy A (primary):** Cloudflare Pages + Workers + D1  
**Deploy B (alternate UI):** Vercel (static frontend only; API still hits Workers via `VITE_API_BASE_URL`)

## Assumptions

- Completion modes per item: `once` | `while_valid` (reset when formula validity window changes)
- No per-date status history — viewer is always “now”
- DSL keywords in English
- No auth (hobby)
- Timezone: `APP_TIMEZONE` (default `Asia/Jakarta`)

## Monorepo layout

```
packages/dsl/   # formula language (zero runtime deps)
apps/api/       # Hono Worker + D1
apps/web/       # React UI (viewer + desktop builder)
```

## Local development

Requires Node 22+ and pnpm 9+.

```bash
pnpm install
pnpm --filter @whenlist/api db:migrate:local
pnpm dev:api    # http://127.0.0.1:8787
pnpm dev:web    # http://127.0.0.1:5173
```

Or both: `pnpm dev`

Copy [`apps/web/.env.example`](apps/web/.env.example) → `apps/web/.env` if needed.  
For NL create locally: copy [`apps/api/.dev.vars.example`](apps/api/.dev.vars.example) → `apps/api/.dev.vars` and set `GEMINI_API_KEY`.

Migration `0004` rebuilds ids as TEXT ULIDs (destructive locally).

```bash
pnpm --filter @whenlist/dsl test
pnpm build
```

## IDs

- Item ids are ULIDs (`TEXT` PK), shown as-is in the API and UI
- DSL deps use the same ULID strings: `checked("01H…")` / `notChecked("01H…")`

## DSL quick examples

```
date == 1
date between 1 .. 7 && notChecked
weekday between mon .. fri && hour between 9 .. 17
month == dec && date == 25
hour between 22 .. 6
(weekday == sat || weekday == sun) && meridiem == am
date == 5 && checked("01H…") && notChecked("01H…")
date == ceil(lastDay / 2)
monthLength == 31
let half = ceil(lastDay / 2);
date == half
fn half(x) { ceil(x / 2) }
date == half(lastDay)
```

Value expressions support `+ - * /`, `()`, `ceil`/`floor`/`round`/`abs`/`min`/`max`, calendar refs `lastDay`/`monthLength`, `let` bindings, and custom `fn` definitions in the same formula.

Grammar / AST: see comments in [`packages/dsl/src/ast.ts`](packages/dsl/src/ast.ts).

## Deploy

### A — Cloudflare (production)

1. `npx wrangler login`
2. Create D1: `cd apps/api && npx wrangler d1 create checklist-db`
3. Put the real `database_id` into [`apps/api/wrangler.toml`](apps/api/wrangler.toml)
4. Apply migrations (**confirm before production**):  
   `pnpm --filter @whenlist/api db:migrate:remote`
5. Set vars: `ALLOWED_ORIGINS`, `APP_TIMEZONE`
6. Optional NL create: `npx wrangler secret put GEMINI_API_KEY` (see Voice / deep link below)
7. Deploy API: `pnpm --filter @whenlist/api deploy`
8. Build web with API URL:  
   `VITE_API_BASE_URL=https://whenlist-api.<account>.workers.dev pnpm --filter @whenlist/web build`
9. Deploy `apps/web/dist` to Cloudflare Pages

> **Rebrand note:** The Worker is named `whenlist-api`. If you previously deployed as `checklist-api`, update `VITE_API_BASE_URL` to the new Workers URL after deploy, then remove the old Worker from the Cloudflare dashboard once verified.

### B — Vercel (UI only)

1. Import repo / set root to `apps/web` (or monorepo filter)
2. Env: `VITE_API_BASE_URL` = your Workers URL
3. Build: `pnpm --filter @whenlist/web build` (output `apps/web/dist`)
4. Ensure Workers `ALLOWED_ORIGINS` includes the Vercel domain

Do **not** run D1 or Workers on Vercel.

## API surface

- `GET /api/checklist` — visible items for now
- `POST /api/checklist/:id/check|uncheck`
- `GET|POST|PUT|DELETE /api/items` — builder CRUD
- `POST /api/formula/validate`
- `POST /api/nl/parse` — natural language → label + DSL (requires `GEMINI_API_KEY`)
- `PATCH /api/items/reorder`

## Voice / deep link create (Android)

Google Assistant does **not** know Whenlist natively. The free path is: open a URL that seeds `/create?q=…`, then review and save.

1. Set Gemini free-tier key (local):
   ```bash
   cp apps/api/.dev.vars.example apps/api/.dev.vars
   # edit GEMINI_API_KEY — https://aistudio.google.com/apikey
   ```
   Production: `cd apps/api && npx wrangler secret put GEMINI_API_KEY`  
   Optional model override via var `GEMINI_MODEL` (default `gemini-2.0-flash`).
2. Open in the browser (or PWA):  
   `https://<your-host>/create?q=bayar%20listrik%20tiap%20tanggal%2025`
3. On Android you can:
   - Save a **bookmark / home-screen shortcut** to `/create` (or a Routine that opens a fixed URL).
   - Install the PWA and use the **Create** app shortcut from the manifest.
   - Put the spoken text into `q` yourself (Assistant will not inject free-form speech into the query string unless you build a Routine/URL template that does).

Expect the page to open and show a preview — not a silent background create. SPA hosts must serve `index.html` for `/create` (Vite/Pages SPA fallback).

Copy [`apps/api/.dev.vars.example`](apps/api/.dev.vars.example) for local API secrets (gitignored as `.dev.vars`).

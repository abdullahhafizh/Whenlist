# Whenlist

The checklist that knows when. Mobile-friendly checklist where each item appears only when its schedule matches.

## User guide (plain language)

- In-app: **/help** (basics) and **/help#schedule-rules** (full schedule language + examples)
- Repo: [`docs/user-guide.md`](docs/user-guide.md), [`docs/schedule-rules.md`](docs/schedule-rules.md)

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

**Git-connected Pages / Workers Builds:** this monorepo is **pnpm-only**. Set install to `pnpm install --frozen-lockfile` (see [`apps/web/PUBLIC_DEPLOY.txt`](apps/web/PUBLIC_DEPLOY.txt)). A present `bun.lock` makes Cloudflare run Bun and fail frozen installs.

**Workers Builds:** install `pnpm install --frozen-lockfile`. Deploy may stay as `npx wrangler deploy` (root now includes `wrangler` + [`wrangler.toml`](wrangler.toml)). Put the real D1 `database_id` in **both** root and `apps/api/wrangler.toml`. See [`apps/web/PUBLIC_DEPLOY.txt`](apps/web/PUBLIC_DEPLOY.txt).

> **Worker name:** Cloudflare Workers Builds project is `whenlist` — both [`wrangler.toml`](wrangler.toml) and [`apps/api/wrangler.toml`](apps/api/wrangler.toml) use `name = "whenlist"`.

> **Rebrand note:** Older docs / URLs may say `whenlist-api.<account>.workers.dev`. After first successful deploy, use the URL Cloudflare shows (often `whenlist.<account>.workers.dev`) for `VITE_API_BASE_URL`.

### B — Vercel (UI only)

Connect the **same** GitHub repo. No Root Directory tweaking required: `vercel.json` at repo root (and under `apps/web` / `apps/api`) always builds the web UI. Production API URL defaults to the Worker when `VITE_API_BASE_URL` is unset.

Do **not** expect D1/Workers to run on Vercel — only the static UI.

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

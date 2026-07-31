import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  parse,
  serialize,
  evaluate,
  collectDependencies,
  validateFormula,
  topologicalSort,
  deriveWindowStart,
  deriveRemindAt,
  resolveAutoRemind,
  dismissRemindMarker,
  dismissOnceSnoozeMarker,
  isEffectivelyChecked,
  isSnoozedAway,
  normalizeAst,
  usesHourGranularity,
  isAlwaysTrue,
  type CompletionMode,
  type AstNode,
} from "@whenlist/dsl";
import { ulid } from "./ulid.js";
import {
  checkNlRateLimit,
  DEFAULT_MODEL,
  parseNaturalLanguage,
} from "./nlParse.js";

export type Env = {
  DB: D1Database;
  APP_TIMEZONE: string;
  ALLOWED_ORIGINS: string;
  /** Google AI Studio / Gemini API key (secret). Required for POST /api/nl/parse. */
  GEMINI_API_KEY?: string;
  /** Optional model id; default gemini-2.0-flash (free-tier friendly). */
  GEMINI_MODEL?: string;
};

type ItemRow = {
  id: string;
  label: string;
  formula: string;
  completion_mode: CompletionMode;
  sort_order: number;
  is_active: number;
  allow_remind: number;
  remind_at: string | null;
  snoozed_window_at: string | null;
  checked_at: string | null;
  window_start_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const origins = (c.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin) return origins[0] ?? "*";
      if (origins.includes("*") || origins.includes(origin)) return origin;
      return origins[0] ?? "";
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  });
  return corsMiddleware(c, next);
});

app.get("/api/health", (c) =>
  c.json({ ok: true, timezone: c.env.APP_TIMEZONE || "Asia/Jakarta" }),
);

async function loadAllDeps(db: D1Database): Promise<Map<string, string[]>> {
  const { results } = await db
    .prepare("SELECT item_id, depends_on FROM item_dependencies")
    .all<{ item_id: string; depends_on: string }>();
  const map = new Map<string, string[]>();
  for (const row of results ?? []) {
    const list = map.get(row.item_id) ?? [];
    list.push(row.depends_on);
    map.set(row.item_id, list);
  }
  return map;
}

async function syncDeps(
  db: D1Database,
  itemId: string,
  deps: string[],
): Promise<void> {
  await db
    .prepare("DELETE FROM item_dependencies WHERE item_id = ?")
    .bind(itemId)
    .run();
  for (const d of deps) {
    await db
      .prepare(
        "INSERT INTO item_dependencies (item_id, depends_on) VALUES (?, ?)",
      )
      .bind(itemId, d)
      .run();
  }
}

function itemToJson(row: ItemRow) {
  return {
    id: row.id,
    label: row.label,
    formula: row.formula,
    completionMode: row.completion_mode,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    allowRemind: row.allow_remind === 1,
    remindAt: row.remind_at,
    snoozedWindowAt: row.snoozed_window_at,
    checkedAt: row.checked_at,
    windowStartAt: row.window_start_at,
    deletedAt: row.deleted_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LIVE = "deleted_at IS NULL";
const ARCHIVED = "deleted_at IS NOT NULL";

app.get("/api/items", async (c) => {
  const archived = c.req.query("archived") === "1";
  const where = archived ? ARCHIVED : LIVE;
  const orderBy = archived
    ? "deleted_at DESC, id ASC"
    : "sort_order ASC, id ASC";

  const offsetRaw = Number(c.req.query("offset") ?? "0");
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
  const limitParam = c.req.query("limit");
  const paging = limitParam != null && limitParam !== "";
  const limitParsed = Number(limitParam);
  const limit = paging
    ? Number.isFinite(limitParsed) && limitParsed > 0
      ? Math.min(100, Math.floor(limitParsed))
      : 40
    : null;

  let rows: ItemRow[];
  let hasMore = false;
  let nextOffset: number;
  let total: number | undefined;

  if (limit != null) {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM checklist_items WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
      .bind(limit + 1, offset)
      .all<ItemRow>();
    const fetched = results ?? [];
    hasMore = fetched.length > limit;
    rows = hasMore ? fetched.slice(0, limit) : fetched;
    nextOffset = offset + rows.length;
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM checklist_items WHERE ${where} ORDER BY ${orderBy}`,
    ).all<ItemRow>();
    rows = results ?? [];
    nextOffset = rows.length;
    total = rows.length;
  }

  const items = rows.map(itemToJson);

  return c.json({
    items,
    hasMore,
    nextOffset,
    ...(total != null ? { total } : {}),
  });
});

/** Lightweight id + dependency graph for builder validation (non-blocking for list). */
app.get("/api/items/meta", async (c) => {
  const { results: idRows } = await c.env.DB.prepare(
    `SELECT id FROM checklist_items WHERE ${LIVE} ORDER BY sort_order ASC, id ASC`,
  ).all<{ id: string }>();
  const depMap = await loadAllDeps(c.env.DB);
  return c.json({
    ids: (idRows ?? []).map((r) => r.id),
    deps: Object.fromEntries(depMap),
  });
});

app.get("/api/items/:id", async (c) => {
  const id = c.req.param("id") as string;
  const row = await c.env.DB.prepare(
    "SELECT * FROM checklist_items WHERE id = ?",
  )
    .bind(id)
    .first<ItemRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ item: itemToJson(row) });
});

type UpsertBody = {
  label: string;
  formula: string;
  completionMode?: CompletionMode;
  sortOrder?: number;
  isActive?: boolean;
  allowRemind?: boolean;
};

/** Auto-remind needs a future validity window; once+empty has none. */
function resolveAllowRemindFlag(
  mode: CompletionMode,
  ast: AstNode,
  requested: boolean | undefined,
  existingFlag?: number,
): number {
  if (mode === "once" && isAlwaysTrue(ast)) return 0;
  if (requested === undefined) return existingFlag === 1 ? 1 : 0;
  return requested === true ? 1 : 0;
}

async function validateUpsert(
  db: D1Database,
  body: UpsertBody,
  selfId?: string,
): Promise<
  | { ok: true; ast: AstNode; deps: string[]; formulaInternal: string }
  | { ok: false; status: number; error: string; issues?: unknown }
> {
  if (!body.label?.trim()) {
    return { ok: false, status: 400, error: "label is required" };
  }
  if (
    body.completionMode &&
    body.completionMode !== "once" &&
    body.completionMode !== "while_valid"
  ) {
    return { ok: false, status: 400, error: "invalid completionMode" };
  }

  const mode = body.completionMode ?? "while_valid";
  const formulaRaw = body.formula ?? "";
  if (!formulaRaw.trim() && mode !== "once") {
    return {
      ok: false,
      status: 400,
      error:
        "Empty formula is only allowed for completion mode 'once' (always visible)",
    };
  }

  const { results } = await db
    .prepare(`SELECT id FROM checklist_items WHERE ${LIVE}`)
    .all<{ id: string }>();
  const knownIds = new Set((results ?? []).map((r) => r.id));
  if (selfId !== undefined) knownIds.add(selfId);

  const existingDeps = await loadAllDeps(db);
  const parsed = validateFormula(formulaRaw, {
    selfId,
    knownIds,
    existingDeps,
  });
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      error: parsed.error,
      issues: parsed.issues,
    };
  }
  const deps = collectDependencies(parsed.ast);
  return {
    ok: true,
    ast: normalizeAst(parsed.ast),
    deps,
    formulaInternal: serialize(normalizeAst(parsed.ast)),
  };
}

app.post("/api/items", async (c) => {
  const body = (await c.req.json()) as UpsertBody;
  const v = await validateUpsert(c.env.DB, body);
  if (!v.ok) return c.json({ error: v.error, issues: v.issues }, v.status as 400);

  const mode = body.completionMode ?? "while_valid";
  let sortOrder = body.sortOrder;
  if (sortOrder === undefined) {
    const max = await c.env.DB.prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS m FROM checklist_items",
    ).first<{ m: number }>();
    sortOrder = (max?.m ?? 0) + 1;
  }
  const isActive = body.isActive === false ? 0 : 1;
  const allowRemind = resolveAllowRemindFlag(mode, v.ast, body.allowRemind);
  const id = ulid();

  const result = await c.env.DB.prepare(
    `INSERT INTO checklist_items (id, label, formula, completion_mode, sort_order, is_active, allow_remind)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      id,
      body.label.trim(),
      v.formulaInternal,
      mode,
      sortOrder,
      isActive,
      allowRemind,
    )
    .first<ItemRow>();

  if (!result) return c.json({ error: "Insert failed" }, 500);
  await syncDeps(c.env.DB, result.id, v.deps);
  return c.json({ item: itemToJson(result) }, 201);
});

app.post("/api/items/:id/clone", async (c) => {
  const id = c.req.param("id") as string;
  const existing = await c.env.DB.prepare(
    `SELECT * FROM checklist_items WHERE id = ? AND ${LIVE}`,
  )
    .bind(id)
    .first<ItemRow>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const label = `${existing.label} (copy)`;
  const mode = existing.completion_mode;
  const v = await validateUpsert(
    c.env.DB,
    {
      label,
      formula: existing.formula,
      completionMode: mode,
      isActive: existing.is_active === 1,
      allowRemind: existing.allow_remind === 1,
    },
  );
  if (!v.ok) return c.json({ error: v.error, issues: v.issues }, v.status as 400);

  const max = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS m FROM checklist_items",
  ).first<{ m: number }>();
  const sortOrder = (max?.m ?? 0) + 1;
  const allowRemind = resolveAllowRemindFlag(
    mode,
    v.ast,
    existing.allow_remind === 1,
  );
  const newId = ulid();

  const result = await c.env.DB.prepare(
    `INSERT INTO checklist_items (id, label, formula, completion_mode, sort_order, is_active, allow_remind)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      newId,
      label,
      v.formulaInternal,
      mode,
      sortOrder,
      existing.is_active,
      allowRemind,
    )
    .first<ItemRow>();

  if (!result) return c.json({ error: "Clone failed" }, 500);
  await syncDeps(c.env.DB, result.id, v.deps);
  return c.json({ item: itemToJson(result) }, 201);
});

app.put("/api/items/:id", async (c) => {
  const id = c.req.param("id") as string;

  const existing = await c.env.DB.prepare(
    `SELECT * FROM checklist_items WHERE id = ? AND ${LIVE}`,
  )
    .bind(id)
    .first<ItemRow>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = (await c.req.json()) as UpsertBody;
  const mode = body.completionMode ?? existing.completion_mode;
  const v = await validateUpsert(
    c.env.DB,
    { ...body, completionMode: mode },
    id,
  );
  if (!v.ok) return c.json({ error: v.error, issues: v.issues }, v.status as 400);

  const sortOrder = body.sortOrder ?? existing.sort_order;
  const isActive =
    body.isActive === undefined ? existing.is_active : body.isActive ? 1 : 0;
  const allowRemind = resolveAllowRemindFlag(
    mode,
    v.ast,
    body.allowRemind,
    existing.allow_remind,
  );

  const formulaChanged = v.formulaInternal !== existing.formula;
  const modeChanged = mode !== existing.completion_mode;
  const checkedAt = formulaChanged ? null : existing.checked_at;
  const windowStartAt = formulaChanged ? null : existing.window_start_at;
  const snoozedWindowAt =
    formulaChanged || modeChanged ? null : existing.snoozed_window_at;

  const result = await c.env.DB.prepare(
    `UPDATE checklist_items
     SET label = ?, formula = ?, completion_mode = ?, sort_order = ?,
         is_active = ?, allow_remind = ?, checked_at = ?, window_start_at = ?,
         snoozed_window_at = ?, updated_at = datetime('now')
     WHERE id = ?
     RETURNING *`,
  )
    .bind(
      body.label.trim(),
      v.formulaInternal,
      mode,
      sortOrder,
      isActive,
      allowRemind,
      checkedAt,
      windowStartAt,
      snoozedWindowAt,
      id,
    )
    .first<ItemRow>();

  await syncDeps(c.env.DB, id, v.deps);
  return c.json({ item: itemToJson(result!) });
});

app.delete("/api/items/:id", async (c) => {
  const id = c.req.param("id") as string;

  const dependents = await c.env.DB.prepare(
    `SELECT i.id, i.label FROM item_dependencies d
     JOIN checklist_items i ON i.id = d.item_id
     WHERE d.depends_on = ? AND i.deleted_at IS NULL`,
  )
    .bind(id)
    .all<{ id: string; label: string }>();

  if ((dependents.results ?? []).length > 0) {
    return c.json(
      {
        error: "Item is referenced by other checklist items",
        dependents: (dependents.results ?? []).map((d) => ({
          id: d.id,
          label: d.label,
        })),
      },
      409,
    );
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM checklist_items WHERE id = ? AND ${LIVE}`,
  )
    .bind(id)
    .first();
  if (!existing) return c.json({ error: "Not found" }, 404);

  // Soft-delete — keep row + deps so it can be restored later.
  const result = await c.env.DB.prepare(
    `UPDATE checklist_items
     SET deleted_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND ${LIVE}
     RETURNING *`,
  )
    .bind(id)
    .first<ItemRow>();

  return c.json({ ok: true, item: itemToJson(result!) });
});

app.post("/api/items/:id/restore", async (c) => {
  const id = c.req.param("id") as string;
  const existing = await c.env.DB.prepare(
    `SELECT id FROM checklist_items WHERE id = ? AND ${ARCHIVED}`,
  )
    .bind(id)
    .first();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const result = await c.env.DB.prepare(
    `UPDATE checklist_items
     SET deleted_at = NULL, updated_at = datetime('now')
     WHERE id = ?
     RETURNING *`,
  )
    .bind(id)
    .first<ItemRow>();

  return c.json({ item: itemToJson(result!) });
});

app.patch("/api/items/reorder", async (c) => {
  const body = (await c.req.json()) as { ids: string[] };
  if (!Array.isArray(body.ids)) {
    return c.json({ error: "ids array required" }, 400);
  }
  let order = 0;
  for (const id of body.ids) {
    await c.env.DB.prepare(
      "UPDATE checklist_items SET sort_order = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(order++, id)
      .run();
  }
  return c.json({ ok: true });
});

app.post("/api/formula/validate", async (c) => {
  const body = (await c.req.json()) as {
    formula: string;
    selfId?: string;
  };

  const formula = body.formula ?? "";
  const selfId = body.selfId;

  const { results } = await c.env.DB.prepare(
    `SELECT id FROM checklist_items WHERE ${LIVE}`,
  ).all<{ id: string }>();
  const knownIds = new Set((results ?? []).map((r) => r.id));
  const existingDeps = await loadAllDeps(c.env.DB);
  const result = validateFormula(formula, {
    selfId,
    knownIds,
    existingDeps,
  });
  if (!result.ok) {
    return c.json({
      ok: false,
      error: result.error,
      pos: result.pos,
      issues: result.issues,
    });
  }

  return c.json({
    ok: true,
    formula: serialize(result.ast),
    issues: result.issues,
    dependencies: collectDependencies(result.ast),
  });
});

app.post("/api/nl/parse", async (c) => {
  const apiKey = c.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return c.json(
      {
        error:
          "GEMINI_API_KEY is not configured. Set it with: wrangler secret put GEMINI_API_KEY",
      },
      503,
    );
  }

  const clientKey =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anon";
  if (!checkNlRateLimit(clientKey)) {
    return c.json({ error: "Too many parse requests. Try again shortly." }, 429);
  }

  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim() ?? "";
  if (!text) {
    return c.json({ error: "text is required" }, 400);
  }
  if (text.length > 2000) {
    return c.json({ error: "text is too long (max 2000 chars)" }, 400);
  }

  let candidate;
  try {
    candidate = await parseNaturalLanguage(
      text,
      apiKey,
      c.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    );
  } catch (e) {
    return c.json(
      { error: `NL parse failed: ${(e as Error).message}` },
      502,
    );
  }

  const mode = candidate.completionMode;
  if (!candidate.formula.trim() && mode !== "once") {
    return c.json(
      {
        error:
          "Model produced an empty formula; only allowed with completionMode 'once'",
        label: candidate.label,
        formula: candidate.formula,
        completionMode: mode,
        allowRemind: candidate.allowRemind,
        explanation: candidate.explanation,
      },
      422,
    );
  }

  if (candidate.formula.trim()) {
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM checklist_items WHERE ${LIVE}`,
    ).all<{ id: string }>();
    const knownIds = new Set((results ?? []).map((r) => r.id));
    const existingDeps = await loadAllDeps(c.env.DB);
    const validated = validateFormula(candidate.formula, {
      knownIds,
      existingDeps,
    });
    if (!validated.ok) {
      return c.json(
        {
          error: validated.error,
          pos: validated.pos,
          issues: validated.issues,
          label: candidate.label,
          formula: candidate.formula,
          completionMode: mode,
          allowRemind: candidate.allowRemind,
          explanation: candidate.explanation,
        },
        422,
      );
    }

    return c.json({
      ok: true,
      label: candidate.label,
      formula: serialize(normalizeAst(validated.ast)),
      completionMode: mode,
      allowRemind: candidate.allowRemind,
      explanation: candidate.explanation,
      issues: validated.issues,
      dependencies: collectDependencies(validated.ast),
    });
  }

  return c.json({
    ok: true,
    label: candidate.label,
    formula: "",
    completionMode: mode,
    allowRemind: candidate.allowRemind,
    explanation: candidate.explanation,
    issues: [],
    dependencies: [],
  });
});

async function buildStatusMap(
  db: D1Database,
  now: Date,
  timeZone: string,
  skipId?: string,
): Promise<{
  statusMap: Record<string, boolean>;
  byId: Map<string, ItemRow>;
  results: ItemRow[];
}> {
  const { results } = await db
    .prepare(
      `SELECT * FROM checklist_items WHERE is_active = 1 AND ${LIVE}`,
    )
    .all<ItemRow>();
  const items = results ?? [];
  const deps = await loadAllDeps(db);
  const ids = items.map((i) => i.id);
  let order: string[];
  try {
    order = topologicalSort(ids, deps);
  } catch {
    order = ids;
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const statusMap: Record<string, boolean> = {};
  for (const oid of order) {
    if (skipId !== undefined && oid === skipId) continue;
    const r = byId.get(oid)!;
    let ast: AstNode;
    try {
      ast = parse(r.formula);
    } catch {
      continue;
    }
    const w = deriveWindowStart(ast, {
      now,
      statusMap,
      selfId: oid,
      timeZone,
    });
    statusMap[oid] = isEffectivelyChecked({
      completionMode: r.completion_mode,
      checkedAt: r.checked_at,
      windowStartAt: r.window_start_at,
      currentWindow: w,
    });
  }
  return { statusMap, byId, results: items };
}

app.get("/api/checklist/count", async (c) => {
  // Count items that would appear on the checklist now (same rules as GET /api/checklist),
  // not all active rows — entrance drop shells must match visible cards.
  const timeZone = c.env.APP_TIMEZONE || "Asia/Jakarta";
  const now = new Date();
  const deps = await loadAllDeps(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM checklist_items WHERE is_active = 1 AND ${LIVE} ORDER BY sort_order ASC, id ASC`,
  ).all<ItemRow>();
  const items = results ?? [];
  const ids = items.map((i) => i.id);
  let order: string[];
  try {
    order = topologicalSort(ids, deps);
  } catch {
    order = ids;
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const statusMap: Record<string, boolean> = {};
  for (const id of order) {
    const row = byId.get(id)!;
    let ast: AstNode;
    try {
      ast = parse(row.formula);
    } catch {
      continue;
    }
    const currentWindow = deriveWindowStart(ast, {
      now,
      statusMap,
      selfId: id,
      timeZone,
    });
    statusMap[id] = isEffectivelyChecked({
      completionMode: row.completion_mode,
      checkedAt: row.checked_at,
      windowStartAt: row.window_start_at,
      currentWindow,
    });
  }

  let total = 0;
  for (const row of items) {
    let ast: AstNode;
    try {
      ast = parse(row.formula);
    } catch {
      continue;
    }
    const currentlyValid = evaluate(ast, {
      now,
      statusMap,
      selfId: row.id,
      timeZone,
    });
    if (!currentlyValid) continue;
    const currentWindow = deriveWindowStart(ast, {
      now,
      statusMap,
      selfId: row.id,
      timeZone,
    });
    const hourly = usesHourGranularity(ast);
    const snoozed = isSnoozedAway({
      completionMode: row.completion_mode,
      snoozedWindowAt: row.snoozed_window_at,
      currentWindow,
      now,
      hourly,
      timeZone,
    });
    if (snoozed) continue;
    if (row.completion_mode === "once" && Boolean(statusMap[row.id])) continue;
    total += 1;
  }

  return c.json({ total });
});

app.get("/api/checklist", async (c) => {
  const timeZone = c.env.APP_TIMEZONE || "Asia/Jakarta";
  const now = new Date();
  const nowIso = now.toISOString();

  const offsetRaw = Number(c.req.query("offset") ?? "0");
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
  const limitParam = c.req.query("limit");
  const paging = limitParam != null && limitParam !== "";
  const limitParsed = Number(limitParam);
  const limit = paging
    ? Number.isFinite(limitParsed) && limitParsed > 0
      ? Math.min(100, Math.floor(limitParsed))
      : 12
    : null;
  /** Collect one extra visible item to know hasMore without a full pass. */
  const visibleCap =
    limit != null ? offset + limit + 1 : Number.POSITIVE_INFINITY;

  const deps = await loadAllDeps(c.env.DB);
  const hasAnyDeps = [...deps.values()].some((d) => d.length > 0);

  // Independent rows (no deps): only read a SQL window — critical for large seeds.
  const sqlWindow =
    !hasAnyDeps && limit != null
      ? { offset, limit: limit + 1 + 16 }
      : null;

  const { results } = sqlWindow
    ? await c.env.DB.prepare(
        `SELECT * FROM checklist_items WHERE is_active = 1 AND ${LIVE} ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?`,
      )
        .bind(sqlWindow.limit, sqlWindow.offset)
        .all<ItemRow>()
    : await c.env.DB.prepare(
        `SELECT * FROM checklist_items WHERE is_active = 1 AND ${LIVE} ORDER BY sort_order ASC, id ASC`,
      ).all<ItemRow>();
  const items = results ?? [];
  const ids = items.map((i) => i.id);
  const sqlWindowFull =
    sqlWindow != null && items.length >= sqlWindow.limit;

  // When SQL is already offset to the page, fill only limit+1 within this window.
  const fillCap = sqlWindow != null && limit != null ? limit + 1 : visibleCap;

  let order: string[];
  try {
    order = topologicalSort(ids, deps);
  } catch {
    order = ids;
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const statusMap: Record<string, boolean> = {};
  const astById = new Map<string, AstNode>();

  // Without cross-item deps we can stop parsing once the page (+1) is filled.
  const shortCircuit = !hasAnyDeps && limit != null;
  let shortVisible = 0;

  for (const id of order) {
    const row = byId.get(id)!;
    if (shortCircuit && shortVisible >= fillCap) {
      if (offset > 0 || sqlWindow != null) break;
      if (row.allow_remind !== 1 && !row.remind_at) continue;
    }

    let ast: AstNode;
    try {
      ast = parse(row.formula);
    } catch {
      continue;
    }
    astById.set(id, ast);
    const currentWindow = deriveWindowStart(ast, {
      now,
      statusMap,
      selfId: id,
      timeZone,
    });
    statusMap[id] = isEffectivelyChecked({
      completionMode: row.completion_mode,
      checkedAt: row.checked_at,
      windowStartAt: row.window_start_at,
      currentWindow,
    });

    if (shortCircuit && shortVisible < fillCap) {
      const currentlyValid = evaluate(ast, {
        now,
        statusMap,
        selfId: id,
        timeZone,
      });
      if (currentlyValid) {
        const hourly = usesHourGranularity(ast);
        const snoozed = isSnoozedAway({
          completionMode: row.completion_mode,
          snoozedWindowAt: row.snoozed_window_at,
          currentWindow,
          now,
          hourly,
          timeZone,
        });
        const checked = Boolean(statusMap[id]);
        if (!snoozed && !(row.completion_mode === "once" && checked)) {
          shortVisible += 1;
        }
      }
    }
  }

  const visible = [];
  const alerts: { id: string; label: string; remindAt: string }[] = [];
  const clearDismissIds: string[] = [];
  const clearSnoozeIds: string[] = [];

  // When SQL already windowed by visible offset, collect from the start of this window.
  const pageOffset = sqlWindow != null ? 0 : offset;

  for (const row of items) {
    const ast = astById.get(row.id);
    if (!ast) {
      if (shortCircuit && shortVisible >= fillCap && (offset > 0 || sqlWindow != null))
        break;
      continue;
    }

    const localCap = fillCap;

    if (visible.length >= localCap) {
      if (offset > 0 || sqlWindow != null) break;
      if (row.allow_remind !== 1 && !row.remind_at) continue;
    }

    const currentlyValid = evaluate(ast, {
      now,
      statusMap,
      selfId: row.id,
      timeZone,
    });

    if (offset === 0) {
      if (currentlyValid && row.remind_at) {
        clearDismissIds.push(row.id);
        row.remind_at = null;
      }

      if (row.allow_remind === 1 && !currentlyValid) {
        const derived = deriveRemindAt(ast, {
          now,
          statusMap,
          selfId: row.id,
          timeZone,
        });
        const due = resolveAutoRemind({
          allowRemind: true,
          currentlyValid: false,
          dismissedForWindowAt: row.remind_at,
          nowIso,
          derived,
          hourly: usesHourGranularity(ast),
          timeZone,
        });
        if (due) {
          alerts.push({
            id: row.id,
            label: row.label,
            remindAt: due.remindAt,
          });
        }
      }
    }

    if (!currentlyValid) continue;
    if (visible.length >= localCap) continue;

    const currentWindow = deriveWindowStart(ast, {
      now,
      statusMap,
      selfId: row.id,
      timeZone,
    });
    const hourly = usesHourGranularity(ast);
    const snoozed = isSnoozedAway({
      completionMode: row.completion_mode,
      snoozedWindowAt: row.snoozed_window_at,
      currentWindow,
      now,
      hourly,
      timeZone,
    });
    if (row.snoozed_window_at && !snoozed) {
      clearSnoozeIds.push(row.id);
      row.snoozed_window_at = null;
    }
    if (snoozed) continue;

    const checked = Boolean(statusMap[row.id]);
    if (row.completion_mode === "once" && checked) {
      continue;
    }

    visible.push({
      id: row.id,
      label: row.label,
      checked,
      completionMode: row.completion_mode,
      sortOrder: row.sort_order,
      formula: row.formula,
      allowRemind: row.allow_remind === 1,
      remindAt: row.remind_at,
      canSnooze: true,
    });
  }

  if (clearDismissIds.length > 0) {
    const placeholders = clearDismissIds.map(() => "?").join(",");
    await c.env.DB.prepare(
      `UPDATE checklist_items
       SET remind_at = NULL, updated_at = datetime('now')
       WHERE id IN (${placeholders})`,
    )
      .bind(...clearDismissIds)
      .run();
  }

  if (clearSnoozeIds.length > 0) {
    const placeholders = clearSnoozeIds.map(() => "?").join(",");
    await c.env.DB.prepare(
      `UPDATE checklist_items
       SET snoozed_window_at = NULL, updated_at = datetime('now')
       WHERE id IN (${placeholders})`,
    )
      .bind(...clearSnoozeIds)
      .run();
  }

  let pageItems = visible;
  let hasMore = false;
  let nextOffset = (sqlWindow != null ? offset : 0) + visible.length;
  let total: number | undefined = paging ? undefined : visible.length;
  if (limit != null) {
    const sliced = visible.slice(pageOffset, pageOffset + limit);
    hasMore =
      visible.length > pageOffset + sliced.length || sqlWindowFull;
    pageItems = sliced;
    nextOffset = offset + pageItems.length;
  }

  return c.json({
    now: nowIso,
    timeZone,
    items: pageItems,
    alerts: offset === 0 ? alerts : [],
    hasMore,
    nextOffset,
    ...(total != null ? { total } : {}),
  });
});

app.post("/api/checklist/:id/snooze", async (c) => {
  const id = c.req.param("id") as string;
  const timeZone = c.env.APP_TIMEZONE || "Asia/Jakarta";
  const now = new Date();

  const row = await c.env.DB.prepare(
    `SELECT * FROM checklist_items WHERE id = ? AND is_active = 1 AND ${LIVE}`,
  )
    .bind(id)
    .first<ItemRow>();
  if (!row) return c.json({ error: "Not found" }, 404);

  const { statusMap } = await buildStatusMap(c.env.DB, now, timeZone);

  let ast: AstNode;
  try {
    ast = parse(row.formula);
  } catch (e) {
    return c.json({ error: `Invalid formula: ${(e as Error).message}` }, 400);
  }

  const currentWindow = deriveWindowStart(ast, {
    now,
    statusMap,
    selfId: id,
    timeZone,
  });
  if (!currentWindow.currentlyValid) {
    return c.json({ error: "Item is not currently visible/valid" }, 400);
  }

  const marker = dismissOnceSnoozeMarker(currentWindow, {
    now,
    hourly: usesHourGranularity(ast),
    timeZone,
  });
  if (!marker) {
    return c.json({ error: "Unable to snooze this item right now" }, 400);
  }

  const updated = await c.env.DB.prepare(
    `UPDATE checklist_items
     SET snoozed_window_at = ?, updated_at = datetime('now')
     WHERE id = ?
     RETURNING *`,
  )
    .bind(marker, id)
    .first<ItemRow>();

  return c.json({ item: itemToJson(updated!) });
});

app.post("/api/checklist/:id/remind/dismiss", async (c) => {
  const id = c.req.param("id") as string;
  const timeZone = c.env.APP_TIMEZONE || "Asia/Jakarta";
  const now = new Date();

  const row = await c.env.DB.prepare(
    `SELECT * FROM checklist_items WHERE id = ? AND is_active = 1 AND ${LIVE}`,
  )
    .bind(id)
    .first<ItemRow>();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.allow_remind !== 1) {
    return c.json({ error: "Remind is not enabled for this item" }, 400);
  }

  const { statusMap } = await buildStatusMap(c.env.DB, now, timeZone);

  let ast: AstNode;
  try {
    ast = parse(row.formula);
  } catch (e) {
    return c.json({ error: `Invalid formula: ${(e as Error).message}` }, 400);
  }

  const derived = deriveRemindAt(ast, {
    now,
    statusMap,
    selfId: id,
    timeZone,
  });
  if (!derived) {
    return c.json({ error: "No upcoming window to dismiss remind for" }, 400);
  }

  const marker = dismissRemindMarker(derived.windowStartsAt, {
    hourly: usesHourGranularity(ast),
    timeZone,
  });

  const updated = await c.env.DB.prepare(
    `UPDATE checklist_items
     SET remind_at = ?, updated_at = datetime('now')
     WHERE id = ?
     RETURNING *`,
  )
    .bind(marker, id)
    .first<ItemRow>();

  return c.json({ item: itemToJson(updated!) });
});

app.post("/api/checklist/:id/check", async (c) => {
  const id = c.req.param("id") as string;
  const timeZone = c.env.APP_TIMEZONE || "Asia/Jakarta";
  const now = new Date();

  const row = await c.env.DB.prepare(
    `SELECT * FROM checklist_items WHERE id = ? AND is_active = 1 AND ${LIVE}`,
  )
    .bind(id)
    .first<ItemRow>();
  if (!row) return c.json({ error: "Not found" }, 404);

  const { statusMap } = await buildStatusMap(c.env.DB, now, timeZone, id);

  let ast: AstNode;
  try {
    ast = parse(row.formula);
  } catch (e) {
    return c.json({ error: `Invalid formula: ${(e as Error).message}` }, 400);
  }

  const currentWindow = deriveWindowStart(ast, {
    now,
    statusMap,
    selfId: id,
    timeZone,
  });
  if (!currentWindow.currentlyValid) {
    return c.json({ error: "Item is not currently visible/valid" }, 400);
  }

  const checkedAt = now.toISOString();
  const windowStartAt = currentWindow.unbounded
    ? checkedAt
    : currentWindow.windowStartAt;

  const updated = await c.env.DB.prepare(
    `UPDATE checklist_items
     SET checked_at = ?, window_start_at = ?, updated_at = datetime('now')
     WHERE id = ?
     RETURNING *`,
  )
    .bind(checkedAt, windowStartAt, id)
    .first<ItemRow>();

  return c.json({
    item: {
      id,
      checked: true,
      checkedAt,
      windowStartAt,
      label: updated!.label,
    },
  });
});

app.post("/api/checklist/:id/uncheck", async (c) => {
  const id = c.req.param("id") as string;

  const row = await c.env.DB.prepare(
    `SELECT * FROM checklist_items WHERE id = ? AND is_active = 1 AND ${LIVE}`,
  )
    .bind(id)
    .first<ItemRow>();
  if (!row) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare(
    `UPDATE checklist_items
     SET checked_at = NULL, window_start_at = NULL, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(id)
    .run();

  return c.json({
    item: {
      id,
      checked: false,
      label: row.label,
    },
  });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Internal error" }, 500);
});

export default app;

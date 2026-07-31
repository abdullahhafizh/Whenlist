const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
  /\/$/,
  "",
) ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `HTTP ${res.status}`,
    );
  }
  return data;
}

function itemPath(id: string): string {
  return encodeURIComponent(id);
}

export type ChecklistItemView = {
  id: string;
  label: string;
  checked: boolean;
  completionMode: "once" | "while_valid";
  sortOrder: number;
  formula: string;
  allowRemind: boolean;
  remindAt: string | null;
  canSnooze?: boolean;
};

export type ReminderAlert = {
  id: string;
  label: string;
  remindAt: string;
};

export type ItemRecord = {
  id: string;
  label: string;
  formula: string;
  completionMode: "once" | "while_valid";
  sortOrder: number;
  isActive: boolean;
  allowRemind: boolean;
  remindAt: string | null;
  snoozedWindowAt?: string | null;
  checkedAt: string | null;
  windowStartAt: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Short display for ULID in dense UI lists. */
export function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 10)}…`;
}

export const api = {
  health: () => request<{ ok: boolean; timezone: string }>("/api/health"),
  getChecklistCount: () =>
    request<{ total: number }>("/api/checklist/count"),
  getChecklist: (opts?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    if (opts?.offset != null) q.set("offset", String(opts.offset));
    const qs = q.toString();
    return request<{
      now: string;
      timeZone: string;
      items: ChecklistItemView[];
      alerts: ReminderAlert[];
      hasMore?: boolean;
      nextOffset?: number;
      total?: number;
    }>(`/api/checklist${qs ? `?${qs}` : ""}`);
  },
  check: (id: string) =>
    request<{ item: { id: string; checked: boolean; label: string } }>(
      `/api/checklist/${itemPath(id)}/check`,
      { method: "POST" },
    ),
  uncheck: (id: string) =>
    request<{ item: { id: string; checked: boolean; label: string } }>(
      `/api/checklist/${itemPath(id)}/uncheck`,
      { method: "POST" },
    ),
  dismissRemind: (id: string) =>
    request<{ item: ItemRecord }>(
      `/api/checklist/${itemPath(id)}/remind/dismiss`,
      { method: "POST" },
    ),
  snooze: (id: string) =>
    request<{ item: ItemRecord }>(
      `/api/checklist/${itemPath(id)}/snooze`,
      { method: "POST" },
    ),
  listItems: (opts?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    if (opts?.offset != null) q.set("offset", String(opts.offset));
    const qs = q.toString();
    return request<{
      items: ItemRecord[];
      hasMore?: boolean;
      nextOffset?: number;
      total?: number;
    }>(`/api/items${qs ? `?${qs}` : ""}`);
  },
  listArchivedItems: (opts?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams({ archived: "1" });
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    if (opts?.offset != null) q.set("offset", String(opts.offset));
    return request<{
      items: ItemRecord[];
      hasMore?: boolean;
      nextOffset?: number;
      total?: number;
    }>(`/api/items?${q.toString()}`);
  },
  listItemsMeta: () =>
    request<{ ids: string[]; deps: Record<string, string[]> }>(
      "/api/items/meta",
    ),
  getItem: (id: string) =>
    request<{ item: ItemRecord }>(`/api/items/${itemPath(id)}`),
  createItem: (body: {
    label: string;
    formula: string;
    completionMode?: "once" | "while_valid";
    isActive?: boolean;
    allowRemind?: boolean;
  }) =>
    request<{ item: ItemRecord }>("/api/items", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cloneItem: (id: string) =>
    request<{ item: ItemRecord }>(`/api/items/${itemPath(id)}/clone`, {
      method: "POST",
    }),
  updateItem: (
    id: string,
    body: {
      label: string;
      formula: string;
      completionMode?: "once" | "while_valid";
      isActive?: boolean;
      allowRemind?: boolean;
      sortOrder?: number;
    },
  ) =>
    request<{ item: ItemRecord }>(`/api/items/${itemPath(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  /** Soft-delete (archive). Item can be restored later. */
  deleteItem: (id: string) =>
    request<{ ok: boolean; item?: ItemRecord }>(`/api/items/${itemPath(id)}`, {
      method: "DELETE",
    }),
  restoreItem: (id: string) =>
    request<{ item: ItemRecord }>(`/api/items/${itemPath(id)}/restore`, {
      method: "POST",
    }),
  validateFormula: (formula: string, selfId?: string) =>
    request<{
      ok: boolean;
      error?: string;
      formula?: string;
      issues?: { path: string; message: string; severity: string }[];
      dependencies?: string[];
    }>("/api/formula/validate", {
      method: "POST",
      body: JSON.stringify({ formula, selfId }),
    }),
  parseNl: async (text: string) => {
    const res = await fetch(`${BASE}/api/nl/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      label?: string;
      formula?: string;
      completionMode?: "once" | "while_valid";
      allowRemind?: boolean;
      explanation?: string;
      issues?: { path: string; message: string; severity: string }[];
      dependencies?: string[];
    };
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`) as Error & {
        partial?: {
          label: string;
          formula: string;
          completionMode: "once" | "while_valid";
          allowRemind: boolean;
          explanation?: string;
        };
      };
      if (data.label) {
        err.partial = {
          label: data.label,
          formula: data.formula ?? "",
          completionMode: data.completionMode ?? "while_valid",
          allowRemind: data.allowRemind === true,
          explanation: data.explanation,
        };
      }
      throw err;
    }
    return {
      ok: true as const,
      label: data.label ?? "",
      formula: data.formula ?? "",
      completionMode: data.completionMode ?? ("while_valid" as const),
      allowRemind: data.allowRemind === true,
      explanation: data.explanation,
      issues: data.issues,
      dependencies: data.dependencies,
    };
  },
};

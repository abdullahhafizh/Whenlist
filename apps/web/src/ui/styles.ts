/**
 * Shared UI class tokens — Whenlist brand is teal (theme-color #0d9488).
 * Domain block colors (AND amber / OR sky / NOT rose) stay semantic, not CTAs.
 */

export const btn = {
  primary:
    "inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50",
  primarySm:
    "inline-flex items-center justify-center rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50",
  secondarySm:
    "inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50",
  warning:
    "inline-flex items-center justify-center rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700",
  link: "text-xs font-medium text-teal-700 transition hover:underline",
} as const;

export const field =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-600/30";

export const fieldDense =
  "rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-600/30";

export const fieldMono = `${field} font-mono text-xs`;

export const card =
  "rounded-2xl border border-slate-200 bg-white shadow-sm";

export const banner = {
  error: "rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800",
  warn: "rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800",
  info: "rounded-xl border border-teal-100 bg-teal-50/80 px-3 py-2 text-sm text-teal-900",
} as const;

export const label =
  "text-xs font-medium uppercase tracking-wide text-slate-500";

export const pageTitle =
  "text-2xl font-semibold tracking-tight text-slate-900";

export const sectionTitle = "text-sm font-semibold text-slate-800";

/** DSL operator / field name accent (aligned to brand, not indigo). */
export const dslAccent = "font-mono text-xs font-semibold text-teal-800";

export const dropHover =
  "hover:border-teal-400 hover:text-teal-700";

export const statusTrue = "bg-emerald-100 text-emerald-800";
export const statusFalse = "bg-rose-100 text-rose-800";
export const statusNeutral = "bg-slate-100 text-slate-500";

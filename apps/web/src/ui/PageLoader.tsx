/** Fetch / busy indicator — full page block or absolute overlay. */
export default function PageLoader({
  label = "Loading…",
  overlay = false,
}: {
  label?: string;
  /** Cover parent (needs `relative` ancestor). */
  overlay?: boolean;
}) {
  const body = (
    <div
      className={`flex flex-col items-center justify-center gap-3 ${
        overlay ? "py-8" : "py-16"
      }`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span
        className="page-loader__spin h-8 w-8 rounded-full border-2 border-slate-200 border-t-teal-600"
        aria-hidden
      />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );

  if (!overlay) return body;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-[1px]"
      aria-hidden={false}
    >
      {body}
    </div>
  );
}

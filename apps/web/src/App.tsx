import { Suspense, lazy } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import Checklist from "./routes/Checklist";
import CreateFromQuery from "./routes/CreateFromQuery";

const Builder = lazy(() => import("./routes/Builder"));

function Nav() {
  const loc = useLocation();
  const link = (to: string, label: string) => {
    const active =
      loc.pathname === to || (to !== "/" && loc.pathname.startsWith(to));
    return (
      <Link
        to={to}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
          active
            ? "bg-teal-700 text-white"
            : "text-slate-600 hover:bg-teal-50 hover:text-teal-900"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="z-20 shrink-0 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3">
        <Link
          to="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <img
            src="/favicon.svg"
            alt=""
            width={22}
            height={22}
            className="rounded-md"
          />
          Whenlist
        </Link>
        <nav className="flex items-center gap-1">
          {link("/", "Checklist")}
          {link("/create", "Create")}
          {link("/builder", "Builder")}
        </nav>
      </div>
    </header>
  );
}

export function AppLayout() {
  const loc = useLocation();
  const isBuilder = loc.pathname.startsWith("/builder");

  return (
    <div
      className={`flex min-h-dvh flex-col ${isBuilder ? "h-dvh overflow-hidden" : ""}`}
    >
      <Nav />
      <main
        className={
          isBuilder
            ? "mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-3 py-3 sm:px-4"
            : "mx-auto max-w-6xl px-4 py-6"
        }
      >
        <Outlet />
      </main>
    </div>
  );
}

function BuilderSuspense() {
  return (
    <Suspense
      fallback={<p className="text-sm text-slate-500">Loading builder…</p>}
    >
      <Builder />
    </Suspense>
  );
}

export const appRoutes = [
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Checklist /> },
      { path: "create", element: <CreateFromQuery /> },
      { path: "builder", element: <BuilderSuspense /> },
      { path: "builder/:id", element: <BuilderSuspense /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

import { Suspense, lazy, useEffect } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import Checklist from "./routes/Checklist";
import CreateFromQuery from "./routes/CreateFromQuery";
import Help from "./routes/Help";
import PageLoader from "./ui/PageLoader";

const Builder = lazy(() => import("./routes/Builder"));

function Nav() {
  const loc = useLocation();
  const link = (to: string, label: string, shortLabel?: string) => {
    const active =
      loc.pathname === to || (to !== "/" && loc.pathname.startsWith(to));
    return (
      <Link
        to={to}
        className={`shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium transition sm:px-3 sm:text-sm ${
          active
            ? "bg-teal-700 text-white"
            : "text-slate-600 hover:bg-teal-50 hover:text-teal-900"
        }`}
      >
        <span className="sm:hidden">{shortLabel ?? label}</span>
        <span className="hidden sm:inline">{label}</span>
      </Link>
    );
  };

  return (
    <header className="z-20 hidden shrink-0 border-b border-slate-200 bg-white/90 backdrop-blur sm:block">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <Link
          to="/"
          className="flex min-w-0 shrink items-center gap-1.5 text-sm font-semibold tracking-tight sm:gap-2 sm:text-base"
        >
          <img
            src="/favicon.svg"
            alt=""
            width={22}
            height={22}
            className="shrink-0 rounded-md"
          />
          <span className="truncate">Whenlist</span>
        </Link>
        <nav className="app-nav-links ml-auto flex min-w-0 items-center justify-end gap-0.5 overflow-x-auto sm:gap-1">
          {link("/", "Checklist", "List")}
          {link("/create", "Create")}
          {link("/builder", "Builder", "Build")}
          {link("/help", "Help")}
        </nav>
      </div>
    </header>
  );
}

export function AppLayout() {
  const loc = useLocation();
  const isBuilder = loc.pathname.startsWith("/builder");
  const isChecklist = loc.pathname === "/";

  useEffect(() => {
    const root = document.documentElement;
    if (!isChecklist) {
      root.classList.remove("checklist-route");
      return;
    }
    root.classList.add("checklist-route");
    return () => root.classList.remove("checklist-route");
  }, [isChecklist]);

  return (
    <div
      className={`flex min-h-dvh flex-col overflow-x-hidden ${isBuilder ? "h-dvh overflow-hidden" : ""}`}
    >
      <Nav />
      <main
        className={
          isBuilder
            ? "mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-3 py-3 sm:px-4"
            : "mx-auto w-full max-w-6xl flex-1 px-3 py-5 sm:px-4 sm:py-6"
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
      fallback={
        <div className="flex min-h-0 flex-1 flex-col">
          <PageLoader label="Loading builder…" />
        </div>
      }
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
      { path: "help", element: <Help /> },
      { path: "builder", element: <BuilderSuspense /> },
      { path: "builder/:id", element: <BuilderSuspense /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

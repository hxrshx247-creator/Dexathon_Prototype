import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, friendlyError } from "./api/client";
import { ToastProvider, useToast } from "./components/ui";
import { Icon } from "./components/Icon";
import Home from "./pages/Home";
import Intake from "./pages/Intake";
import CaseDashboard from "./pages/CaseDashboard";
import Escalation from "./pages/Escalation";

function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="FairHold+ home">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="28" height="28" fill="currentColor" />
        <rect x="7" y="8" width="14" height="3.5" fill="var(--ground)" />
        <rect x="7" y="16.5" width="8" height="3.5" fill="var(--ground)" />
        <rect x="17" y="16.5" width="4" height="3.5" fill="var(--accent-bright)" />
      </svg>
      <span>
        FairHold<b>+</b>
      </span>
    </Link>
  );
}

function DemoMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(kind: "seed" | "reset") {
    setBusy(true);
    try {
      await api.resetDemo();
      if (kind === "seed") {
        const c = await api.seedDemo();
        toast("Demo case loaded");
        nav(`/cases/${c.id}`);
      } else {
        toast("All demo data cleared");
        nav("/");
      }
      setOpen(false);
    } catch (e) {
      toast(friendlyError(e), "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="demo" ref={ref}>
      <button
        type="button"
        className="btn btn--quiet btn--small"
        aria-expanded={open}
        aria-controls="demo-panel"
        onClick={() => setOpen((o) => !o)}
      >
        Demo tools
      </button>
      {open && (
        <div className="demo__panel" id="demo-panel">
          <button type="button" disabled={busy} onClick={() => run("seed")}>
            <Icon name="FileText" /> Load the demo case
          </button>
          <button type="button" disabled={busy} onClick={() => run("reset")}>
            <Icon name="CircleDashed" /> Clear all data
          </button>
        </div>
      )}
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <ToastProvider>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="container topbar__in">
          <Wordmark />
          <nav aria-label="Main">
            <NavLink to="/" end>
              Your cases
            </NavLink>
          </nav>
          <DemoMenu />
        </div>
      </header>
      <ScrollToTop />
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<Intake />} />
          <Route path="/cases/:id" element={<CaseDashboard />} />
          <Route path="/cases/:id/escalate" element={<Escalation />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <footer className="foot">
        <div className="container">
          <Icon name="Scale" size={16} />
          <p>FairHold+ organizes your records. It is not legal advice and does not judge your bank.</p>
        </div>
      </footer>
    </ToastProvider>
  );
}

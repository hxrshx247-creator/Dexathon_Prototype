import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { friendlyError, ApiError } from "../api/client";
import type { Tone } from "../lib/labels";
import { Icon } from "./Icon";

// ---------- Chip: a tone is always backed by text, never colour alone ----------

export function Chip({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: Tone;
  icon?: string;
  children: ReactNode;
}) {
  return (
    <span className={`chip chip--${tone}`}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </span>
  );
}

// ---------- Loading and error states ----------

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const notFound = error instanceof ApiError && error.code === "NOT_FOUND";
  return (
    <div className="state" role="alert">
      <Icon name="CircleAlert" size={28} />
      <h2>{notFound ? "We couldn't find that case" : "We couldn't load this"}</h2>
      <p>{friendlyError(error)}</p>
      <div className="state__actions">
        {onRetry && !notFound && (
          <button type="button" className="btn btn--primary" onClick={onRetry}>
            Try again
          </button>
        )}
        <Link to="/" className="btn btn--quiet">
          Back to your cases
        </Link>
      </div>
    </div>
  );
}

// ---------- Form field ----------

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (a: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {children({ id, describedBy, invalid: !!error })}
      {error && (
        <p className="field__error" id={errId}>
          <Icon name="CircleAlert" size={16} />
          {error}
        </p>
      )}
    </div>
  );
}

/** Radio or checkbox group rendered as chips. Real inputs underneath, so keyboard and screen readers work. */
export function ChoiceGroup<T extends string>({
  legend,
  hint,
  error,
  options,
  value,
  onChange,
  multiple = false,
  icons,
  layout = "chips",
}: {
  legend: string;
  hint?: string;
  error?: string;
  options: { value: T; label: string }[];
  value: T[] | T | "";
  onChange: (next: any) => void;
  multiple?: boolean;
  icons?: Record<string, string | undefined>;
  layout?: "chips" | "list";
}) {
  const name = useId();
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (v: T) => {
    if (!multiple) return onChange(v);
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  return (
    <fieldset className={`choice choice--${layout}${error ? " field--error" : ""}`}>
      <legend>{legend}</legend>
      {hint && <p className="field__hint">{hint}</p>}
      <div className="choice__items">
        {options.map((o) => (
          <label key={o.value} className="choice__item">
            <input
              type={multiple ? "checkbox" : "radio"}
              name={name}
              checked={selected.includes(o.value)}
              onChange={() => toggle(o.value)}
            />
            <span>
              {icons?.[o.value] && <Icon name={icons[o.value]} size={17} />}
              {o.label}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p className="field__error">
          <Icon name="CircleAlert" size={16} />
          {error}
        </p>
      )}
    </fieldset>
  );
}

// ---------- Dialog (native <dialog>: focus trap, Esc and inert background for free) ----------

export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      document.body.style.overflow = "hidden";
    }
    if (!open && d.open) d.close();
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet${wide ? " sheet--wide" : ""}`}
      aria-labelledby={titleId}
      onClose={() => {
        document.body.style.overflow = "";
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close(); // click on the backdrop
      }}
    >
      {open && (
        <div className="sheet__panel">
          <header className="sheet__head">
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="btn btn--quiet btn--icon"
              onClick={() => ref.current?.close()}
              aria-label="Close"
            >
              <Icon name="X" size={22} />
            </button>
          </header>
          <div className="sheet__body">{children}</div>
        </div>
      )}
    </dialog>
  );
}

// ---------- Toasts ----------

type ToastFn = (message: string, tone?: "success" | "danger") => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; tone: string } | null>(null);
  const timer = useRef<number>();
  const show = useCallback<ToastFn>((message, tone = "success") => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), message, tone });
    timer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <Icon name={toast.tone === "danger" ? "CircleAlert" : "CircleCheck"} size={18} />
            {toast.message}
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Count-up numeral (display only; the value always comes from the backend) ----------

export function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(to);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(to);
      return;
    }
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span aria-hidden="true">{n}</span>;
}

/** Copy text with feedback. */
export function CopyButton({ text, label, describe }: { text: string; label: string; describe?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn--quiet btn--small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1800);
        } catch {
          /* clipboard blocked: leave the text selectable */
        }
      }}
    >
      <Icon name={done ? "Check" : "Copy"} size={15} />
      {done ? "Copied" : label}
      {describe && <span className="sr-only"> {describe}</span>}
    </button>
  );
}

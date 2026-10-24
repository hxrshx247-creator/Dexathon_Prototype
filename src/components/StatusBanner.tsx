import type { ReactNode } from "react";
import type { CaseStatus } from "../api/client";
import { dayKey, formatDateOnly } from "../lib/format";
import { statusBanner } from "../lib/statusBanner";
import { CountUp } from "./ui";
import { Icon } from "./Icon";

/** The big number comes straight from the backend's own fields. Nothing is recomputed here. */
function figure(s: CaseStatus): { value: number; unit: string } | null {
  const plural = (n: number, w: string) => (n === 1 ? w : `${w}s`);
  switch (s.state) {
    case "within_window": {
      const n = s.days_remaining ?? 0;
      return { value: n, unit: `${plural(n, "day")} left` };
    }
    case "window_expired": {
      const n = Math.abs(s.days_remaining ?? 0);
      return { value: n, unit: `${plural(n, "day")} past the window` };
    }
    case "awaiting_first_contact":
      return { value: s.days_since_freeze, unit: `${plural(s.days_since_freeze, "day")} on hold` };
    default:
      return null;
  }
}

const MAX_CELLS = 60;

/**
 * The day strip is a drawing, not a calculation: one cell per day of the backend's `window_days`,
 * filled in proportion to `days_remaining`. Every number the person reads comes from the backend.
 */
function WindowStrip({ status }: { status: CaseStatus }) {
  const total = Math.min(status.window_days ?? 0, MAX_CELLS);
  if (!total) return null;
  const expired = status.state === "window_expired";
  const remaining = status.days_remaining ?? 0;
  const ratio = expired ? 1 : Math.min(1, Math.max(0, ((status.window_days ?? total) - remaining) / (status.window_days ?? total)));
  const filled = expired ? total : Math.min(total, Math.max(1, Math.round(ratio * total)));

  const label = expired
    ? `The ${status.window_days}-day response window has ended`
    : `${remaining} of ${status.window_days} days left in the response window`;

  return (
    <div className="strip">
      <div className="strip__cells" role="img" aria-label={label}>
        {Array.from({ length: total }, (_, i) => (
          <i
            key={i}
            className={`${i < filled ? "on" : ""}${!expired && i === filled - 1 ? " today" : ""}`}
            style={{ ["--i" as string]: i }}
          />
        ))}
      </div>
      <div className="strip__labels" aria-hidden="true">
        <span>
          {status.first_contact_at ? `First contact ${formatDateOnly(dayKey(status.first_contact_at))}` : ""}
        </span>
        <span>{status.window_deadline ? `Window ends ${formatDateOnly(status.window_deadline)}` : ""}</span>
      </div>
    </div>
  );
}

export function StatusBanner({ status, children }: { status: CaseStatus; children?: ReactNode }) {
  const b = statusBanner(status);
  const fig = figure(status);
  const showStrip = status.state === "within_window" || status.state === "window_expired";

  return (
    <section className="banner" data-tone={b.tone} aria-labelledby="banner-title">
      <div className="banner__main">
        <div className="banner__figure">
          {fig ? (
            <>
              <div className="banner__num">
                <CountUp to={fig.value} />
              </div>
              <div className="banner__unit" aria-hidden="true">
                {fig.unit}
              </div>
            </>
          ) : status.state === "resolved" ? (
            <div className="banner__num banner__num--icon">
              <Icon name="CircleCheck" size={96} />
            </div>
          ) : null}
        </div>

        <div className="banner__body" aria-live="polite">
          <h2 id="banner-title">{b.headline}</h2>
          {b.detail && <p>{b.detail}</p>}
          {showStrip && <WindowStrip status={status} />}
          {children && <div className="banner__actions">{children}</div>}
        </div>
      </div>

      <div className="banner__foot">
        <p>{status.window_basis}</p>
        <p>{status.disclaimer}</p>
      </div>
    </section>
  );
}

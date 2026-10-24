import { Link } from "react-router-dom";
import type { CaseStatus } from "../api/client";
import { ACTION_ICON, iconFor } from "../lib/labels";
import { Icon } from "./Icon";

/** What each blocker means once it is cleared. The unmet text always comes from the backend. */
const MET_TEXT: Record<string, string> = {
  no_first_contact: "You have contacted the bank",
  window_not_elapsed: "The bank's response window has ended",
  no_reference_number: "Your record has a reference number",
};
/** Shown only if the backend leaves a requirement out of its blocker list while the state says it isn't met. */
const UNMET_FALLBACK: Record<string, string> = {
  no_first_contact: "You haven't contacted the bank yet",
  window_not_elapsed: "The bank's response window hasn't ended yet",
  no_reference_number: "None of your entries has a reference number yet",
};
const REQUIREMENTS = ["no_first_contact", "window_not_elapsed", "no_reference_number"];

export type StepAction = "letter" | "evidence" | "escalate" | null;

/** Which screen each backend action code opens. Labels always come from the backend. */
export function actionFor(code: string): { kind: StepAction; button: string } {
  switch (code) {
    case "make_first_request":
      return { kind: "letter", button: "Write the request" };
    case "follow_up_with_bank":
      return { kind: "letter", button: "Write a follow-up" };
    case "log_reference_number":
    case "wait_for_response":
      return { kind: "evidence", button: "Log a reply" };
    case "escalate_to_ombudsman":
      return { kind: "escalate", button: "Open your packet" };
    case "consult_legal_aid":
      return { kind: "escalate", button: "See what to bring" };
    default:
      return { kind: null, button: "" };
  }
}

export function NextSteps({
  status,
  caseId,
  onAction,
}: {
  status: CaseStatus;
  caseId: string;
  onAction: (k: Exclude<StepAction, null>) => void;
}) {
  if (status.state === "resolved") {
    return (
      <section className="panel" aria-labelledby="next-h">
        <h2 id="next-h">What now</h2>
        <p className="muted">
          Nothing is pending. Your record stays here in case you need to show what happened and when.
        </p>
      </section>
    );
  }

  if (status.next_steps.length === 0) return null;

  return (
    <section className="panel" aria-labelledby="next-h">
      <h2 id="next-h">Next steps</h2>
      <ul className="steplist">
        {status.next_steps.map((s, i) => {
          const a = actionFor(s.code);
          // The first step already has its button in the status banner, so it isn't repeated here.
          const showAction = i > 0 && a.kind;
          return (
            <li key={s.code} className={i === 0 ? "is-lead" : undefined}>
              <span className="steplist__icon">
                <Icon name={iconFor(ACTION_ICON, s.code)} />
              </span>
              <p>{s.label}</p>
              {showAction && a.kind === "escalate" ? (
                <Link className="linkbtn" to={`/cases/${caseId}/escalate`}>
                  {a.button}
                  <Icon name="ArrowRight" size={16} />
                </Link>
              ) : showAction ? (
                <button type="button" className="linkbtn" onClick={() => onAction(a.kind!)}>
                  {a.button}
                  <Icon name="ArrowRight" size={16} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A plain checklist of what escalation needs. Met or missing comes from `escalation_blockers`; nothing is recomputed. */
export function EscalationCard({ status, caseId }: { status: CaseStatus; caseId: string }) {
  if (status.state === "resolved") return null;

  const ready = status.escalation_ready;
  const missing = new Map(status.escalation_blockers.map((b) => [b.code as string, b.label]));
  // A blocker code this build doesn't know still shows, as its backend label.
  const extra = status.escalation_blockers.filter((b) => !REQUIREMENTS.includes(b.code));

  return (
    <section className={`panel${ready ? " panel--ready" : ""}`} aria-labelledby="esc-h">
      <h2 id="esc-h">{ready ? "Ready for the ombudsman" : "Not ready to escalate yet"}</h2>
      <ul className="checklist">
        {REQUIREMENTS.map((code) => {
          // Met only when the backend doesn't list it as a blocker AND its own fields agree.
          const agrees =
            code === "no_first_contact"
              ? status.first_contact_at != null
              : code === "window_not_elapsed"
                ? status.state === "window_expired"
                : true;
          const open = !ready && (missing.has(code) || !agrees);
          return (
            <li key={code}>
              <span className={`tick${open ? " tick--open" : ""}`} aria-hidden="true">
                {!open && <Icon name="Check" size={14} />}
              </span>
              <span>
                <span className="sr-only">{open ? "Missing: " : "Done: "}</span>
                {open ? (missing.get(code) ?? UNMET_FALLBACK[code]) : MET_TEXT[code]}
              </span>
            </li>
          );
        })}
        {!ready &&
          extra.map((b) => (
            <li key={b.code}>
              <span className="tick tick--open" aria-hidden="true" />
              <span>
                <span className="sr-only">Missing: </span>
                {b.label}
              </span>
            </li>
          ))}
      </ul>
      <Link className="linkbtn" to={`/cases/${caseId}/escalate`}>
        {ready ? "Preview your packet" : "See what the packet will contain"}
        <Icon name="ArrowRight" size={16} />
      </Link>
    </section>
  );
}

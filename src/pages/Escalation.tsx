import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { friendlyError } from "../api/client";
import { useDashboard } from "../hooks/useDashboard";
import { Chip, ErrorState, Skeleton, useToast } from "../components/ui";
import { Icon } from "../components/Icon";
import { ACCOUNT_TYPE, BLOCKER_ICON, EVENT_TYPE, FREEZE_TYPE, iconFor, meta } from "../lib/labels";
import { dayKey, formatDateOnly, formatDateTime, formatRupees } from "../lib/format";
import { downloadExport } from "../lib/download";

export default function Escalation() {
  const { id } = useParams();
  const { data, error, reload } = useDashboard(id);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} /></div>;
  if (!data)
    return (
      <div className="container page" aria-busy="true" aria-label="Loading your packet">
        <Skeleton className="sk-h1" />
        <Skeleton className="sk-banner" />
      </div>
    );

  const { caseData: c, status, events } = data;
  const refs = events.filter((e) => e.reference_number);
  const resolved = status.state === "resolved";

  async function download() {
    setBusy(true);
    try {
      await downloadExport(c.id);
    } catch (e) {
      toast(friendlyError(e), "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container page">
      <nav aria-label="Breadcrumb">
        <Link to={`/cases/${c.id}`} className="backlink">
          <Icon name="ArrowLeft" size={16} /> Back to {c.bank_name}
        </Link>
      </nav>

      <div className="pagehead">
        <h1>Your packet for the ombudsman</h1>
      </div>

      <section
        className="banner banner--compact"
        data-tone={status.escalation_ready ? "success" : resolved ? "success" : "warning"}
        aria-labelledby="ready-h"
      >
        <div className="banner__main">
          <div className="banner__figure">
            <div className="banner__num banner__num--icon">
              <Icon name={status.escalation_ready || resolved ? "CircleCheck" : "Clock"} size={72} />
            </div>
          </div>
          <div className="banner__body" aria-live="polite">
            <h2 id="ready-h">
              {status.escalation_ready
                ? "Your case is ready to take to the ombudsman"
                : resolved
                  ? "The bank has documented a resolution"
                  : "Your case isn't ready to escalate yet"}
            </h2>
            {status.escalation_ready ? (
              <p>
                The bank's response window has ended with no documented resolution, and your record includes
                reference numbers. Check the packet below, then download it.
              </p>
            ) : resolved ? (
              <p>There is nothing to escalate. You can still download your record.</p>
            ) : (
              <ul className="blockers">
                {status.escalation_blockers.map((b) => (
                  <li key={b.code}>
                    <Icon name={iconFor(BLOCKER_ICON, b.code)} size={18} />
                    {b.label}
                  </li>
                ))}
              </ul>
            )}
            <div className="banner__actions">
              <button type="button" className="btn btn--banner" onClick={download} disabled={busy}>
                <Icon name="Download" size={18} />
                {busy ? "Preparing PDF…" : "Download the PDF"}
              </button>
            </div>
          </div>
        </div>
        <div className="banner__foot">
          <p>{status.disclaimer}</p>
        </div>
      </section>

      <div className="grid grid--packet">
        <div className="desk">
        <article className="paper" aria-labelledby="paper-h">
          <div className="paper__head">
            <h2 id="paper-h">Chronology of an account hold</h2>
            <Chip>Preview of your download</Chip>
          </div>
          <p className="paper__sub">
            {c.bank_name}
            {c.account_last4 ? `, account ending ${c.account_last4}` : ""}
          </p>

          <h3>The account</h3>
          <dl className="facts facts--paper">
            <dt>Account type</dt>
            <dd>{meta(ACCOUNT_TYPE, c.account_type).label}</dd>
            <dt>Kind of hold</dt>
            <dd>{meta(FREEZE_TYPE, c.freeze_type).label}</dd>
            <dt>On hold since</dt>
            <dd>{formatDateOnly(c.freeze_date)}</dd>
            <dt>Amount held</dt>
            <dd>{formatRupees(c.amount_held_minor)}</dd>
            <dt>Reason the bank gave</dt>
            <dd>{c.reason_given || "Not provided"}</dd>
          </dl>

          <h3>Contact with the bank</h3>
          <dl className="facts facts--paper">
            <dt>First contact</dt>
            <dd>{status.first_contact_at ? formatDateTime(status.first_contact_at) : "No contact logged"}</dd>
            <dt>Response window</dt>
            <dd>
              {status.window_days && status.window_deadline
                ? `${status.window_days} days, ending ${formatDateOnly(status.window_deadline)}`
                : "Starts at first contact"}
            </dd>
            <dt>Resolution documented</dt>
            <dd>{resolved ? "Yes" : "No"}</dd>
          </dl>
          <p className="small muted">{status.window_basis}</p>

          {refs.length > 0 && (
            <>
              <h3>Reference numbers</h3>
              <ul className="refs">
                {refs.map((e) => (
                  <li key={e.id}>
                    <b>{e.reference_number}</b>
                    <span className="muted">
                      {meta(EVENT_TYPE, e.type).label}, {formatDateOnly(dayKey(e.occurred_at))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>Chronology</h3>
          {events.length === 0 ? (
            <p className="muted">No entries yet.</p>
          ) : (
            <div className="tablewrap" role="region" aria-label="Chronology table" tabIndex={0}>
              <table className="chrono">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">What happened</th>
                    <th scope="col">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDateTime(e.occurred_at)}</td>
                      <td>
                        <b>{meta(EVENT_TYPE, e.type).label}.</b> {e.summary}
                        {e.bank_statement && (
                          <>
                            <span className="said">The bank said: {e.bank_statement}</span>
                          </>
                        )}
                      </td>
                      <td>{e.reference_number ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="paper__foot">{status.disclaimer}</p>
        </article>
        </div>

        <aside className="grid__side" aria-label="Download and next steps">
          <section className="panel" aria-labelledby="inside-h">
            <h2 id="inside-h">What's inside</h2>
            <ul className="contents">
              {[
                "Your account and the kind of hold",
                "When you first contacted the bank, and the response window",
                refs.length
                  ? `${refs.length} reference ${refs.length === 1 ? "number" : "numbers"}, each with its date`
                  : "Reference numbers, once you log them",
                `${events.length} dated ${events.length === 1 ? "entry" : "entries"}, oldest first`,
                "The bank's own words, quoted as you logged them",
              ].map((t) => (
                <li key={t}>
                  <span className="tick" aria-hidden="true">
                    <Icon name="Check" size={14} />
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              The PDF has the same entries in the same order, so whoever reads it can follow your story without
              asking you to explain.
            </p>
          </section>
          <section className="panel">
            <h2>Where it can go</h2>
            <ul className="plainlist">
              <li>The RBI Integrated Ombudsman, if the bank has not resolved your complaint.</li>
              <li>A consumer forum.</li>
              <li>A legal aid clinic, who can advise on your options.</li>
            </ul>
            <p className="muted small">
              Rules and timelines change. Check the current ombudsman scheme before you file.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

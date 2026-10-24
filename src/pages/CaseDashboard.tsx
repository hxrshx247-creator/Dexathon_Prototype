import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { friendlyError } from "../api/client";
import { useDashboard } from "../hooks/useDashboard";
import { StatusBanner } from "../components/StatusBanner";
import { EscalationCard, NextSteps, actionFor, type StepAction } from "../components/NextSteps";
import { Timeline } from "../components/Timeline";
import { EvidenceSheet } from "../components/EvidenceSheet";
import { LetterSheet } from "../components/LetterSheet";
import { Chip, ErrorState, Skeleton, useToast } from "../components/ui";
import { Icon } from "../components/Icon";
import { ACCOUNT_TYPE, FREEZE_TYPE, URGENCY, meta } from "../lib/labels";
import { formatDateOnly, formatRupees } from "../lib/format";
import { suggestedLetterPurpose } from "../lib/statusBanner";
import { downloadExport } from "../lib/download";

export default function CaseDashboard() {
  const { id } = useParams();
  const { data, error, loading, reload, refresh } = useDashboard(id);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);
  const [newId, setNewId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  // Clear the "just added" highlight after its animation.
  useEffect(() => {
    if (!newId) return;
    const t = window.setTimeout(() => setNewId(null), 3200);
    return () => window.clearTimeout(t);
  }, [newId]);

  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} /></div>;

  if (!data)
    return (
      <div className="container page" aria-busy="true" aria-label="Loading your case">
        <Skeleton className="sk-h1" />
        <Skeleton className="sk-banner" />
        <div className="grid">
          <Skeleton className="sk-block" />
          <Skeleton className="sk-block" />
        </div>
      </div>
    );

  const { caseData: c, status, events } = data;
  const caseId = c.id;

  async function saved(eventId: string, closeFn: () => void, message: string) {
    await refresh();
    closeFn();
    setNewId(eventId);
    toast(message);
    // Bring the new entry into view once it has rendered.
    window.setTimeout(() => {
      document.getElementById(`event-${eventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 350);
  }

  async function exportPdf() {
    setExporting(true);
    try {
      await downloadExport(caseId);
    } catch (e) {
      toast(friendlyError(e), "danger");
    } finally {
      setExporting(false);
    }
  }

  function act(k: Exclude<StepAction, null>) {
    if (k === "letter") setLetterOpen(true);
    if (k === "evidence") setEvidenceOpen(true);
  }

  // The banner shows one clear action: the first thing the backend says to do.
  const lead = status.next_steps[0];
  const lA = lead ? actionFor(lead.code) : null;

  return (
    <div className="container page">
      <nav aria-label="Breadcrumb">
        <Link to="/" className="backlink">
          <Icon name="ArrowLeft" size={16} /> Your cases
        </Link>
      </nav>

      <div className="casehead">
        <div>
          <h1>{c.bank_name}</h1>
          <p className="casehead__meta">
            {meta(ACCOUNT_TYPE, c.account_type).label}
            {c.account_last4 ? ` · ending ${c.account_last4}` : ""} · {meta(FREEZE_TYPE, c.freeze_type).label}
          </p>
        </div>
        <div className="casehead__actions">
          <button type="button" className="btn btn--quiet" onClick={exportPdf} disabled={exporting}>
            <Icon name="Download" size={18} />
            {exporting ? "Preparing PDF…" : "Export PDF"}
          </button>
          <button type="button" className="btn btn--primary hide-sm" onClick={() => setEvidenceOpen(true)}>
            <Icon name="Plus" size={18} /> Add evidence
          </button>
        </div>
      </div>

      <StatusBanner status={status}>
        {lA?.kind === "letter" && (
          <button type="button" className="btn btn--banner" onClick={() => setLetterOpen(true)}>
            {lA.button}
            <Icon name="ArrowRight" size={18} />
          </button>
        )}
        {lA?.kind === "evidence" && (
          <button type="button" className="btn btn--banner" onClick={() => setEvidenceOpen(true)}>
            {lA.button}
            <Icon name="ArrowRight" size={18} />
          </button>
        )}
        {lA?.kind === "escalate" && (
          <Link className="btn btn--banner" to={`/cases/${caseId}/escalate`}>
            {lA.button}
            <Icon name="ArrowRight" size={18} />
          </Link>
        )}
      </StatusBanner>

      <div className="grid">
        <div className="grid__main">
          <section aria-labelledby="timeline-h">
            <div className="sectionhead">
              <h2 id="timeline-h">Your record</h2>
              <p className="muted">
                {events.length} {events.length === 1 ? "entry" : "entries"}, oldest first
              </p>
            </div>
            <Timeline
              events={events}
              caseId={caseId}
              newId={newId}
              onChanged={refresh}
              onAdd={() => setEvidenceOpen(true)}
            />
          </section>
        </div>

        <aside className="grid__side" aria-label="Case summary and next steps">
          <NextSteps status={status} caseId={caseId} onAction={act} />
          <EscalationCard status={status} caseId={caseId} />

          <section className="panel" aria-labelledby="facts-h">
            <h2 id="facts-h">About this hold</h2>
            <dl className="facts">
              <dt>On hold since</dt>
              <dd>{formatDateOnly(c.freeze_date)}</dd>
              <dt>Amount held</dt>
              <dd>{formatRupees(c.amount_held_minor)}</dd>
              <dt>The bank's reason</dt>
              <dd>{c.reason_given || "Not provided"}</dd>
              <dt>Needed for</dt>
              <dd>
                {c.urgency.length ? (
                  <span className="chips">
                    {c.urgency.map((u) => {
                      const m = meta(URGENCY, u);
                      return (
                        <Chip key={u} icon={m.icon}>
                          {m.label}
                        </Chip>
                      );
                    })}
                  </span>
                ) : (
                  "Not provided"
                )}
              </dd>
            </dl>
          </section>
        </aside>
      </div>

      <div className="mobilebar">
        <button type="button" className="btn btn--primary btn--large" onClick={() => setEvidenceOpen(true)}>
          <Icon name="Paperclip" size={18} /> Add evidence
        </button>
      </div>

      <EvidenceSheet
        open={evidenceOpen}
        caseId={caseId}
        onClose={() => setEvidenceOpen(false)}
        onSaved={(eid) => saved(eid, () => setEvidenceOpen(false), "Added to your record")}
      />
      <LetterSheet
        open={letterOpen}
        caseId={caseId}
        defaultPurpose={suggestedLetterPurpose(status)}
        onClose={() => setLetterOpen(false)}
        onSent={(eid) => saved(eid, () => setLetterOpen(false), "Request logged. Your record has started.")}
      />
    </div>
  );
}

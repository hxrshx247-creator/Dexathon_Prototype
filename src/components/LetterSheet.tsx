import { useEffect, useState } from "react";
import { api, friendlyError, type Letter, type LetterPurpose } from "../api/client";
import { ChoiceGroup, CopyButton, Field, Sheet, Skeleton } from "./ui";

const PURPOSES: { value: LetterPurpose; label: string }[] = [
  { value: "initial_request", label: "First request" },
  { value: "follow_up", label: "Follow-up" },
];


export function LetterSheet({
  open,
  caseId,
  defaultPurpose,
  onClose,
  onSent,
}: {
  open: boolean;
  caseId: string;
  defaultPurpose: LetterPurpose;
  onClose: () => void;
  onSent: (eventId: string) => Promise<void>;
}) {
  const [purpose, setPurpose] = useState<LetterPurpose>(defaultPurpose);
  const [letter, setLetter] = useState<Letter | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) setPurpose(defaultPurpose);
  }, [open, defaultPurpose]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError("");
    api
      .generateLetter(caseId, purpose)
      .then((l) => {
        if (!alive) return;
        setLetter(l);
        setSubject(l.subject);
        setBody(l.body);
      })
      .catch((e) => alive && setError(friendlyError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, caseId, purpose]);

  async function sent() {
    setSaving(true);
    setError("");
    try {
      const what = purpose === "initial_request" ? "written request" : "written follow-up";
      const ev = await api.createEvent(caseId, {
        type: "request_sent",
        direction: "outbound",
        occurred_at: new Date().toISOString(),
        summary: `Sent a ${what} to the bank: ${subject}`.slice(0, 1000),
        reference_number: null,
        bank_statement: null,
        is_resolution: false,
        attachment_ids: [],
        source: "manual",
      });
      await onSent(ev.id);
    } catch (e) {
      setError(friendlyError(e));
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Your letter to the bank" wide>
      <div className="stack">
        <p className="muted">
          Read it, change anything that isn't right, then send it by email or hand it in at the branch. Come back and
          tell us when it's sent, and we'll start the dated record.
        </p>

        <ChoiceGroup
          legend="Which letter?"
          options={PURPOSES}
          value={purpose}
          onChange={(v) => setPurpose(v)}
        />

        {error && (
          <p className="notice notice--warning" role="alert">
            {error}
          </p>
        )}

        {loading || !letter ? (
          <div aria-busy="true" aria-label="Writing your letter">
            <Skeleton className="sk-line" />
            <Skeleton className="sk-block" />
          </div>
        ) : (
          <>
            <Field label="Subject">
              {(a) => <input id={a.id} value={subject} onChange={(e) => setSubject(e.target.value)} />}
            </Field>
            <Field label="Letter">
              {(a) => (
                <textarea
                  id={a.id}
                  className="letter"
                  rows={16}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              )}
            </Field>
          </>
        )}

        <div className="actions actions--split">
          <CopyButton text={`${subject}\n\n${body}`} label="Copy letter" />
          <button type="button" className="btn btn--primary" onClick={sent} disabled={saving || loading || !letter}>
            {saving ? "Saving…" : "I've sent this letter"}
          </button>
        </div>
        <p className="muted small">Only press the button once you've actually sent it.</p>
      </div>
    </Sheet>
  );
}

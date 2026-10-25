import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  friendlyError,
  type EventCreate,
  type EventType,
  type EvidenceDraft,
} from "../api/client";
import { DIRECTION_FOR_TYPE, EVENT_TYPE, directionFor, meta, optionsOf } from "../lib/labels";
import { isoToLocalInput, localInputToIso, nowForLocalInput } from "../lib/format";
import { Icon } from "./Icon";
import { Field, Sheet } from "./ui";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "application/pdf", "text/plain"];

const DIR_TEXT: Record<string, string> = {
  outbound: "Logged as: you to the bank",
  inbound: "Logged as: the bank to you",
  internal: "Logged as: your private note",
};

type Draft = {
  type: EventType;
  occurred_at: string; // datetime-local value
  summary: string;
  reference_number: string;
  bank_statement: string;
  is_resolution: boolean;
};

const blank = (): Draft => ({
  type: "call",
  occurred_at: nowForLocalInput(),
  summary: "",
  reference_number: "",
  bank_statement: "",
  is_resolution: false,
});

function fromSuggestion(d: EvidenceDraft): Draft {
  const s = d.suggested_event;
  return {
    type: s.type,
    occurred_at: isoToLocalInput(s.occurred_at),
    summary: s.summary ?? "",
    reference_number: s.reference_number ?? "",
    bank_statement: s.bank_statement ?? "",
    is_resolution: !!s.is_resolution,
  };
}

type Stage = "choose" | "review";

function sizeText(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EvidenceSheet({
  open,
  caseId,
  onClose,
  onSaved,
}: {
  open: boolean;
  caseId: string;
  onClose: () => void;
  onSaved: (eventId: string) => Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>("choose");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft>(blank);
  const [parsed, setParsed] = useState<EvidenceDraft | null>(null);
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const live = useRef<HTMLParagraphElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // A small preview of a chosen screenshot, so the person can see they picked the right one.
  useEffect(() => {
    if (file && file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(null);
  }, [file]);

  // Start fresh every time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setStage("choose");
    setFile(null);
    setText("");
    setDraft(blank());
    setParsed(null);
    setManualFile(null);
    setFileError("");
    setMessage("");
    setErrors({});
    setBusy(false);
  }, [open]);

  function pick(f: File | null) {
    setFileError("");
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) {
      setFile(null);
      return setFileError(friendlyError(new ApiError(413, "FILE_TOO_LARGE", "")));
    }
    if (f.type && !ALLOWED.includes(f.type)) {
      setFile(null);
      return setFileError(friendlyError(new ApiError(415, "UNSUPPORTED_FILE", "")));
    }
    setFile(f);
  }

  async function read() {
    if (!file && !text.trim()) {
      setMessage("Add a screenshot or file, or paste the message text.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const d = await api.parseEvidence(caseId, { file: file ?? undefined, text: text.trim() || undefined });
      setParsed(d);
      setDraft(fromSuggestion(d));
      setStage("review");
    } catch (e) {
      setMessage(friendlyError(e));
      if (e instanceof ApiError && e.code === "PARSE_FAILED") {
        setParsed(null);
        setStage("review"); // Let the user enter details manually when parsing fails.
      }
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const e: Record<string, string> = {};
    if (!draft.summary.trim()) e.summary = "Write a short summary of what happened.";
    if (!draft.occurred_at) e.occurred_at = "Choose the date and time.";
    if (Object.keys(e).length) return setErrors(e);

    setBusy(true);
    setMessage("");
    setErrors({});
    try {
      let attachment_ids: string[] = parsed?.attachment_id ? [parsed.attachment_id] : [];
      if (!parsed && manualFile) {
        const a = await api.uploadAttachment(caseId, manualFile);
        attachment_ids = [a.id];
      }
      const body: EventCreate = {
        type: draft.type,
        direction: directionFor(draft.type),
        occurred_at: localInputToIso(draft.occurred_at),
        summary: draft.summary.trim(),
        reference_number: draft.reference_number.trim() || null,
        bank_statement: draft.bank_statement.trim() || null,
        is_resolution: draft.is_resolution,
        attachment_ids,
        source: parsed ? "parsed" : "manual",
      };
      const ev = await api.createEvent(caseId, body);
      await onSaved(ev.id);
    } catch (err) {
      setMessage(friendlyError(err));
      if (err instanceof ApiError && err.details.length) {
        const map: Record<string, string> = {};
        err.details.forEach((d) => (map[d.field] = d.issue));
        setErrors(map);
      }
      setBusy(false);
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      if (!p[k]) return p;
      const { [k]: _, ...rest } = p;
      return rest;
    });
  };

  const low = (field: string) => parsed && (parsed.confidence[field] ?? 1) < 0.7;

  return (
    <Sheet open={open} onClose={onClose} title={stage === "choose" ? "Add to your record" : "Check the details"}>
      {message && (
        <p className="notice notice--warning" role="alert" ref={live}>
          {message}
        </p>
      )}

      {stage === "choose" && (
        <div className="stack">
          <p className="muted">
            Upload a screenshot or paste a message from the bank. We'll suggest the details and you check them
            before anything is saved.
          </p>

          {file ? (
            <div className="filecard">
              {preview ? (
                <img className="filecard__thumb" src={preview} alt="" />
              ) : (
                <span className="filecard__icon">
                  <Icon name="FileText" size={26} />
                </span>
              )}
              <div>
                <p className="filecard__name">{file.name}</p>
                <p className="muted small">{sizeText(file.size)}</p>
              </div>
              <button
                type="button"
                className="btn btn--icon"
                onClick={() => pick(null)}
                aria-label={`Remove ${file.name}`}
              >
                <Icon name="X" size={20} />
              </button>
            </div>
          ) : (
            <label
              className={`drop${dragging ? " is-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0] ?? null);
              }}
            >
              <span className="drop__icon">
                <Icon name="Upload" size={30} />
              </span>
              <span className="drop__title">Drop a screenshot or file here</span>
              <span className="muted small">or click to browse. PNG, JPEG, PDF or text, up to 10 MB.</span>
              <input
                type="file"
                accept="image/png,image/jpeg,application/pdf,text/plain"
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
          {fileError && (
            <p className="field__error" role="alert">
              <Icon name="CircleAlert" size={16} />
              {fileError}
            </p>
          )}

          <p className="divider-text" aria-hidden="true">
            or
          </p>

          <Field label="Paste the text of an SMS or email">
            {(a) => (
              <textarea
                id={a.id}
                rows={5}
                maxLength={5000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Your request SR-2026-55102 is under review…"
              />
            )}
          </Field>

          <div className="actions actions--split">
            <button type="button" className="btn btn--quiet" onClick={() => setStage("review")}>
              Enter details myself
            </button>
            <button type="button" className="btn btn--primary" onClick={read} disabled={busy}>
              {busy ? "Reading…" : "Read it for me"}
              {!busy && <Icon name="ArrowRight" size={18} />}
            </button>
          </div>
        </div>
      )}

      {stage === "review" && (
        <form
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {parsed?.warnings.length ? (
            <ul className="notice notice--warning">
              {parsed.warnings.map((w) => (
                <li key={w}>
                  {w === "occurred_at_defaulted"
                    ? "We couldn't find a date, so we used the upload time. Please check it."
                    : w}
                </li>
              ))}
            </ul>
          ) : null}

          <Field label="What kind of entry is this?" error={errors.type}>
            {(a) => (
              <>
                <select
                  id={a.id}
                  value={draft.type}
                  onChange={(e) => set("type", e.target.value as EventType)}
                >
                  {optionsOf(EVENT_TYPE).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="field__hint">
                  {DIR_TEXT[DIRECTION_FOR_TYPE[draft.type]]}
                  {draft.type === "bank_response" && ". Use this for any SMS or email you received from the bank."}
                </p>
              </>
            )}
          </Field>

          <Field
            label="When did it happen?"
            hint={low("occurred_at") ? "We weren't sure about this. Please check it." : undefined}
            error={errors.occurred_at}
          >
            {(a) => (
              <input
                id={a.id}
                type="datetime-local"
                className={low("occurred_at") ? "is-uncertain" : ""}
                aria-describedby={a.describedBy}
                aria-invalid={a.invalid}
                value={draft.occurred_at}
                onChange={(e) => set("occurred_at", e.target.value)}
              />
            )}
          </Field>

          <Field
            label="What happened?"
            hint={low("summary") ? "We weren't sure about this. Please check it." : undefined}
            error={errors.summary}
          >
            {(a) => (
              <textarea
                id={a.id}
                rows={3}
                maxLength={1000}
                className={low("summary") ? "is-uncertain" : ""}
                aria-describedby={a.describedBy}
                aria-invalid={a.invalid}
                value={draft.summary}
                onChange={(e) => set("summary", e.target.value)}
                placeholder="Called the helpline to ask why the account is on hold"
              />
            )}
          </Field>

          <Field
            label="Reference number (optional)"
            hint={low("reference_number") ? "We weren't sure about this. Please check it." : "Ticket, complaint or service request number."}
            error={errors.reference_number}
          >
            {(a) => (
              <input
                id={a.id}
                className={`input--short${low("reference_number") ? " is-uncertain" : ""}`}
                aria-describedby={a.describedBy}
                aria-invalid={a.invalid}
                maxLength={100}
                value={draft.reference_number}
                onChange={(e) => set("reference_number", e.target.value)}
              />
            )}
          </Field>

          <Field
            label="What the bank said (optional)"
            hint={low("bank_statement") ? "We weren't sure about this. Please check it." : "Their words as closely as you can."}
            error={errors.bank_statement}
          >
            {(a) => (
              <textarea
                id={a.id}
                rows={3}
                maxLength={2000}
                className={low("bank_statement") ? "is-uncertain" : ""}
                aria-describedby={a.describedBy}
                aria-invalid={a.invalid}
                value={draft.bank_statement}
                onChange={(e) => set("bank_statement", e.target.value)}
              />
            )}
          </Field>

          <label className="check">
            <input
              type="checkbox"
              checked={draft.is_resolution}
              onChange={(e) => set("is_resolution", e.target.checked)}
            />
            <span>
              <b>The bank has documented a resolution.</b>
              <br />
              <span className="muted small">
                Only tick this for a written release, decision or timeline. A promise to “look into it” doesn't count.
              </span>
            </span>
          </label>

          {!parsed && (
            <Field label="Attach a file (optional)" hint="PNG, JPEG, PDF or text. Up to 10 MB.">
              {(a) => (
                <input
                  id={a.id}
                  type="file"
                  accept="image/png,image/jpeg,application/pdf,text/plain"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > MAX_BYTES) {
                      setMessage(friendlyError(new ApiError(413, "FILE_TOO_LARGE", "")));
                      e.target.value = "";
                      return;
                    }
                    setManualFile(f);
                  }}
                />
              )}
            </Field>
          )}

          {parsed?.raw_text && (
            <details className="raw">
              <summary>What we read</summary>
              <pre>{parsed.raw_text}</pre>
            </details>
          )}

          <div className="actions actions--split">
            <button type="button" className="btn btn--quiet" onClick={() => setStage("choose")} disabled={busy}>
              Back
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "Saving…" : "Save to my record"}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}

import { useState } from "react";
import { api, friendlyError, type CaseEvent } from "../api/client";
import { dayKey, dayParts, formatDateOnly, formatTime } from "../lib/format";
import { EVENT_TYPE, meta } from "../lib/labels";
import { Icon } from "./Icon";
import { Chip, CopyButton, useToast } from "./ui";

const DIRECTION_TEXT: Record<string, string> = {
  outbound: "You to the bank",
  inbound: "The bank to you",
  internal: "Private note",
};

function Entry({
  ev,
  caseId,
  index,
  isNew,
  onChanged,
}: {
  ev: CaseEvent;
  caseId: string;
  index: number;
  isNew: boolean;
  onChanged: () => Promise<void>;
}) {
  const m = meta(EVENT_TYPE, ev.type);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function remove() {
    setBusy(true);
    try {
      await api.deleteEvent(caseId, ev.id);
      await onChanged();
      toast("Entry removed from your record");
    } catch (e) {
      toast(friendlyError(e), "danger");
      setBusy(false);
    }
  }

  const hasMeta = !!ev.reference_number || ev.is_resolution || ev.source === "parsed" || ev.attachment_ids.length > 0;

  return (
    <li
      className={`ev ev--${ev.direction}${isNew ? " ev--new" : ""}${ev.is_resolution ? " ev--resolution" : ""}`}
      style={{ ["--i" as string]: Math.min(index, 12) }}
      id={`event-${ev.id}`}
    >
      <span className="ev__node" aria-hidden="true">
        <Icon name={m.icon} size={16} />
      </span>
      <article className="ev__body">
        <header className="ev__head">
          <p className="ev__type">{m.label}</p>
          <p className="ev__when">
            <span>{DIRECTION_TEXT[ev.direction] ?? ev.direction}</span>
            <time dateTime={ev.occurred_at}>{formatTime(ev.occurred_at)}</time>
            {!confirming && (
              <button type="button" className="ev__delete" onClick={() => setConfirming(true)}>
                Remove<span className="sr-only"> entry: {ev.summary}</span>
              </button>
            )}
          </p>
        </header>

        <p className="ev__summary">{ev.summary}</p>

        {ev.bank_statement && (
          <blockquote className="ev__quote">
            <span className="ev__quote-label">The bank said</span>
            <span className="ev__quote-text">{ev.bank_statement}</span>
          </blockquote>
        )}

        {hasMeta && (
          <footer className="ev__meta">
            {ev.reference_number && (
              <span className="ref">
                <span className="ref__label">Ref</span>
                <b>{ev.reference_number}</b>
                <CopyButton text={ev.reference_number} label="Copy" describe={`reference ${ev.reference_number}`} />
              </span>
            )}
            {ev.is_resolution && (
              <Chip tone="success" icon="CircleCheck">
                Resolution documented
              </Chip>
            )}
            {ev.source === "parsed" && <Chip>Read from a screenshot or text</Chip>}
            {ev.attachment_ids.length > 0 && (
              <Chip icon="Paperclip">
                {ev.attachment_ids.length} {ev.attachment_ids.length === 1 ? "file" : "files"} attached
              </Chip>
            )}
          </footer>
        )}

        {confirming && (
          <p className="ev__confirm" role="group" aria-label="Confirm removal">
            <span>Remove this entry from your record?</span>
            <button type="button" className="btn btn--danger btn--small" onClick={remove} disabled={busy}>
              {busy ? "Removing…" : "Remove"}
            </button>
            <button type="button" className="btn btn--quiet btn--small" onClick={() => setConfirming(false)} disabled={busy}>
              Keep
            </button>
          </p>
        )}
      </article>
    </li>
  );
}

export function Timeline({
  events,
  caseId,
  newId,
  onChanged,
  onAdd,
}: {
  events: CaseEvent[];
  caseId: string;
  newId: string | null;
  onChanged: () => Promise<void>;
  onAdd: () => void;
}) {
  if (events.length === 0)
    return (
      <div className="empty">
        <div>
          <h3>Your record starts here</h3>
          <p>
            Add the first call, message or letter. Each entry is saved with its date, time and reference number,
            so the whole story stays in order.
          </p>
          <button type="button" className="btn btn--primary" onClick={onAdd}>
            <Icon name="Plus" size={18} /> Add the first entry
          </button>
        </div>
        <div className="ghost" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );

  const groups: { day: string; items: CaseEvent[] }[] = [];
  for (const ev of events) {
    const k = dayKey(ev.occurred_at);
    const g = groups[groups.length - 1];
    if (g && g.day === k) g.items.push(ev);
    else groups.push({ day: k, items: [ev] });
  }

  let n = 0;
  return (
    <div className="ledger">
      {groups.map((g) => {
        const d = dayParts(g.day);
        return (
          <section key={g.day} className="day" aria-label={formatDateOnly(g.day)}>
            <h3 className="day__head">
              <span className="day__num">{d.day}</span>
              <span className="day__mon">
                {d.month} {d.year}
              </span>
              <span className="day__wd">{d.weekday}</span>
            </h3>
            <ol className="day__list">
              {g.items.map((ev) => (
                <Entry
                  key={ev.id}
                  ev={ev}
                  caseId={caseId}
                  index={n++}
                  isNew={ev.id === newId}
                  onChanged={onChanged}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, friendlyError, type Case } from "../api/client";
import { Chip, ErrorState, Skeleton, useToast } from "../components/ui";
import { ACCOUNT_TYPE, CASE_STATE, meta } from "../lib/labels";
import { dayKey, formatDateOnly, formatRupees } from "../lib/format";
import { Icon } from "../components/Icon";

export default function Home() {
  const [cases, setCases] = useState<Case[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const toast = useToast();

  const load = () => {
    setError(null);
    api.listCases().then(setCases, setError);
  };
  useEffect(load, []);

  async function demo() {
    setBusy(true);
    try {
      await api.resetDemo();
      const c = await api.seedDemo();
      nav(`/cases/${c.id}`);
    } catch (e) {
      toast(friendlyError(e), "danger");
      setBusy(false);
    }
  }

  if (error) return <div className="container page"><ErrorState error={error} onRetry={load} /></div>;

  if (!cases)
    return (
      <div className="container page" aria-busy="true">
        <Skeleton className="sk-h1" />
        <Skeleton className="sk-row" />
        <Skeleton className="sk-row" />
      </div>
    );

  if (cases.length === 0)
    return (
      <div className="container page">
        <section className="hero">
          <div>
            <h1>One clear record of your frozen account.</h1>
            <p className="lead">
              FairHold+ turns every call, message and reference number into a dated chronology you can take to
              the bank, the ombudsman or a legal aid clinic.
            </p>
            <div className="hero__actions">
              <Link to="/new" className="btn btn--primary btn--large">
                Start your record <Icon name="ArrowRight" size={18} />
              </Link>
              <button type="button" className="btn btn--quiet btn--large" onClick={demo} disabled={busy}>
                {busy ? "Loading…" : "See a demo case"}
              </button>
            </div>
          </div>
          <SampleRecord />
        </section>

        <section className="points" aria-label="How it works">
          <div>
            <h2>Write to the bank first.</h2>
            <p>A clear written request starts the clock and gives them one thing to answer.</p>
          </div>
          <div>
            <h2>Log every reply.</h2>
            <p>Keep each reference number next to what the bank actually said.</p>
          </div>
          <div>
            <h2>Take the whole story forward.</h2>
            <p>
              If there is no documented resolution, hand over a complete timeline instead of a pile of
              screenshots.
            </p>
          </div>
        </section>
      </div>
    );

  return (
    <div className="container page">
      <div className="pagehead">
        <h1>Your cases</h1>
        <Link to="/new" className="btn btn--primary">
          <Icon name="Plus" size={18} /> New case
        </Link>
      </div>
      <ul className="caselist">
        {cases.map((c) => {
          const st = meta(CASE_STATE, c.state);
          return (
            <li key={c.id}>
              <Link to={`/cases/${c.id}`} className="caserow">
                <div>
                  <h2>{c.bank_name}</h2>
                  <p className="muted">
                    {meta(ACCOUNT_TYPE, c.account_type).label}
                    {c.account_last4 ? ` · ending ${c.account_last4}` : ""} · on hold since{" "}
                    {formatDateOnly(c.freeze_date)}
                  </p>
                  <p className="muted small">
                    {c.event_count} {c.event_count === 1 ? "entry" : "entries"}
                    {c.last_event_at ? `, last on ${formatDateOnly(dayKey(c.last_event_at))}` : ""}
                  </p>
                </div>
                <div className="caserow__amount">
                  <span className="muted">Held</span>
                  <b>{formatRupees(c.amount_held_minor)}</b>
                </div>
                <Chip tone={st.tone}>{st.label}</Chip>
                <span className="caserow__go" aria-hidden="true">
                  <Icon name="ArrowRight" size={20} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A fixed picture of what a record looks like. Sample text only; it is never saved or sent. */
function SampleRecord() {
  return (
    <div className="sample" aria-hidden="true" data-ui>
      <div className="sample__top">
        <span>Example record</span>
        <span>Example National Bank</span>
      </div>
      <div className="sample__status">
        <span className="sample__num">10</span>
        <p>days left in the bank's response window</p>
      </div>
      <div className="sample__rows">
        <div className="sample__row">
          <time>3 Oct</time>
          <div>
            <p>Called the helpline</p>
            <q>Your account is under review. No timeline can be given.</q>
            <span className="sample__ref">CC-884213</span>
          </div>
        </div>
        <div className="sample__row sample__row--bank">
          <time>9 Oct</time>
          <div>
            <p>Bank's response</p>
            <q>Your request is under review. We will update you shortly.</q>
            <span className="sample__ref">SR-2026-55102</span>
          </div>
        </div>
        <div className="sample__row">
          <time>16 Oct</time>
          <div>
            <p>Branch visit</p>
            <q>It is with head office. We cannot tell you when.</q>
          </div>
        </div>
      </div>
    </div>
  );
}

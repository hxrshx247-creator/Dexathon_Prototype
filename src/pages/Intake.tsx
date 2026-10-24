import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ApiError,
  api,
  friendlyError,
  type AccountType,
  type CaseCreate,
  type FreezeType,
  type Urgency,
} from "../api/client";
import { ChoiceGroup, Field } from "../components/ui";
import { Icon } from "../components/Icon";
import { ACCOUNT_TYPE, FREEZE_TYPE, URGENCY, meta, optionsOf } from "../lib/labels";
import { formatDateOnly, formatRupees, rupeesToPaise, todayIst } from "../lib/format";

type Form = {
  bank_name: string;
  account_type: AccountType | "";
  account_last4: string;
  freeze_type: FreezeType | "";
  freeze_date: string;
  reason_given: string;
  amount: string;
  urgency: Urgency[];
};
type Errors = Record<string, string>;

const STEPS = [
  { title: "Your account", fields: ["bank_name", "account_type", "account_last4"] },
  { title: "The hold", fields: ["freeze_type", "freeze_date", "reason_given"] },
  { title: "What it affects", fields: ["amount_held_minor", "urgency"] },
  { title: "Check and create", fields: [] as string[] },
];

const INITIAL: Form = {
  bank_name: "",
  account_type: "",
  account_last4: "",
  freeze_type: "",
  freeze_date: "",
  reason_given: "",
  amount: "",
  urgency: [],
};

function validate(step: number, f: Form): Errors {
  const e: Errors = {};
  if (step === 0) {
    if (!f.bank_name.trim()) e.bank_name = "Enter the name of your bank.";
    else if (f.bank_name.length > 120) e.bank_name = "Please keep this under 120 characters.";
    if (!f.account_type) e.account_type = "Choose the kind of account.";
    if (f.account_last4 && !/^[0-9]{4}$/.test(f.account_last4))
      e.account_last4 = "Enter exactly 4 digits, or leave this empty.";
  }
  if (step === 1) {
    if (!f.freeze_type) e.freeze_type = "Choose the closest match. “I'm not sure” is fine.";
    if (!f.freeze_date) e.freeze_date = "Enter the date you first noticed the hold.";
    else if (f.freeze_date > todayIst()) e.freeze_date = "This date can't be in the future.";
    if (f.reason_given.length > 1000) e.reason_given = "Please keep this under 1,000 characters.";
  }
  if (step === 2) {
    if (f.amount.trim() && rupeesToPaise(f.amount) === null)
      e.amount_held_minor = "Enter a number, like 45,000.";
  }
  return e;
}

export default function Intake() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(INITIAL);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      const key = k === "amount" ? "amount_held_minor" : k;
      if (!p[key]) return p;
      const { [key]: _, ...rest } = p;
      return rest;
    });
  };

  // Move focus to the step heading after each step change so keyboard and screen reader users land in the right place.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  function next() {
    const e = validate(step, f);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((s) => Math.min(s + 1, STEPS.length - 1));
    else
      // Put the cursor on the first field that needs attention.
      window.requestAnimationFrame(() => {
        const bad = document.querySelector<HTMLElement>(
          '.intake__form [aria-invalid="true"], .intake__form .field--error input',
        );
        bad?.focus();
      });
  }

  async function submit() {
    setBusy(true);
    setFormError("");
    const paise = rupeesToPaise(f.amount);
    const body: CaseCreate = {
      bank_name: f.bank_name.trim(),
      account_type: f.account_type as AccountType,
      account_last4: f.account_last4 || null,
      freeze_type: f.freeze_type as FreezeType,
      freeze_date: f.freeze_date,
      amount_held_minor: paise,
      urgency: f.urgency,
      reason_given: f.reason_given.trim() || null,
    };
    try {
      const c = await api.createCase(body);
      nav(`/cases/${c.id}`);
    } catch (e) {
      setFormError(friendlyError(e));
      if (e instanceof ApiError && e.details.length) {
        const map: Errors = {};
        e.details.forEach((d) => (map[d.field] = d.issue));
        setErrors(map);
        const bad = STEPS.findIndex((s) => s.fields.some((x) => map[x]));
        if (bad >= 0) setStep(bad);
      }
      setBusy(false);
    }
  }

  const last = step === STEPS.length - 1;
  const paise = rupeesToPaise(f.amount);

  return (
    <div className="container page intake">
      <aside className="intake__rail" aria-label="Progress">
        <Link to="/" className="backlink">
          <Icon name="ArrowLeft" size={16} /> Your cases
        </Link>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className={i === step ? "is-current" : i < step ? "is-done" : ""}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="steps__dot" aria-hidden="true">
                {i < step ? "✓" : i + 1}
              </span>
              {s.title}
            </li>
          ))}
        </ol>
        <p className="muted small">Takes about two minutes. You can change anything later.</p>
      </aside>

      <form
        className="intake__form"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          last ? submit() : next();
        }}
      >
        <div className="progress" aria-hidden="true">
          {STEPS.map((_, i) => (
            <i key={i} className={i <= step ? "on" : ""} />
          ))}
        </div>
        <p className="muted small" aria-hidden="true">
          Step {step + 1} of {STEPS.length}
        </p>
        <h1 ref={heading} tabIndex={-1}>
          {[
            "Which account is on hold?",
            "Tell us about the hold",
            "What is it stopping you from doing?",
            "Check your details",
          ][step]}
        </h1>

        {formError && (
          <p className="notice notice--danger" role="alert">
            {formError}
          </p>
        )}

        {step === 0 && (
          <div className="stack intake__step">
            <Field label="Bank name" error={errors.bank_name}>
              {(a) => (
                <input
                  id={a.id}
                  aria-describedby={a.describedBy}
                  aria-invalid={a.invalid}
                  autoComplete="off"
                  autoFocus
                  value={f.bank_name}
                  onChange={(e) => set("bank_name", e.target.value)}
                  placeholder="For example, State Bank of India"
                />
              )}
            </Field>
            <ChoiceGroup
              legend="Type of account"
              error={errors.account_type}
              options={optionsOf(ACCOUNT_TYPE)}
              value={f.account_type}
              onChange={(v) => set("account_type", v)}
            />
            <Field
              label="Last 4 digits of the account number (optional)"
              hint="Only the last four. Never enter your full account number."
              error={errors.account_last4}
            >
              {(a) => (
                <input
                  id={a.id}
                  aria-describedby={a.describedBy}
                  aria-invalid={a.invalid}
                  className="input--short"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  value={f.account_last4}
                  onChange={(e) => set("account_last4", e.target.value.replace(/\D/g, ""))}
                />
              )}
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="stack intake__step">
            <ChoiceGroup
              legend="What best describes what happened?"
              error={errors.freeze_type}
              layout="list"
              options={optionsOf(FREEZE_TYPE)}
              value={f.freeze_type}
              onChange={(v) => set("freeze_type", v)}
            />
            <Field label="Date you first noticed the hold" error={errors.freeze_date}>
              {(a) => (
                <input
                  id={a.id}
                  type="date"
                  className="input--short"
                  aria-describedby={a.describedBy}
                  aria-invalid={a.invalid}
                  max={todayIst()}
                  value={f.freeze_date}
                  onChange={(e) => set("freeze_date", e.target.value)}
                />
              )}
            </Field>
            <Field
              label="What has the bank told you? (optional)"
              hint="Use their words if you can. “No reason given” is also useful to record."
              error={errors.reason_given}
            >
              {(a) => (
                <textarea
                  id={a.id}
                  rows={4}
                  aria-describedby={a.describedBy}
                  aria-invalid={a.invalid}
                  value={f.reason_given}
                  onChange={(e) => set("reason_given", e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="stack intake__step">
            <Field
              label="Amount held (optional)"
              hint="An estimate is fine. Leave it empty if you don't know."
              error={errors.amount_held_minor}
            >
              {(a) => (
                <div className="money">
                  <span aria-hidden="true">₹</span>
                  <input
                    id={a.id}
                    inputMode="decimal"
                    aria-describedby={a.describedBy}
                    aria-invalid={a.invalid}
                    autoComplete="off"
                    value={f.amount}
                    onChange={(e) => set("amount", e.target.value)}
                    placeholder="45,000"
                  />
                </div>
              )}
            </Field>
            {paise !== null && f.amount.trim() && (
              <p className="muted small" aria-live="polite">
                We'll record this as {formatRupees(paise)}.
              </p>
            )}
            <ChoiceGroup
              legend="What is this money needed for? (choose any)"
              multiple
              options={optionsOf(URGENCY)}
              icons={Object.fromEntries(Object.entries(URGENCY).map(([k, v]) => [k, v.icon]))}
              value={f.urgency}
              onChange={(v) => set("urgency", v)}
            />
          </div>
        )}

        {step === 3 && (
          <div className="review intake__step">
            <ReviewGroup title="Account" onEdit={() => setStep(0)}>
              <dt>Bank</dt>
              <dd>{f.bank_name}</dd>
              <dt>Account</dt>
              <dd>
                {f.account_type && meta(ACCOUNT_TYPE, f.account_type).label}
                {f.account_last4 ? ` · ending ${f.account_last4}` : ""}
              </dd>
            </ReviewGroup>
            <ReviewGroup title="The hold" onEdit={() => setStep(1)}>
              <dt>Type</dt>
              <dd>{f.freeze_type && meta(FREEZE_TYPE, f.freeze_type).label}</dd>
              <dt>Since</dt>
              <dd>{formatDateOnly(f.freeze_date)}</dd>
              <dt>Bank's reason</dt>
              <dd>{f.reason_given.trim() || "Not provided"}</dd>
            </ReviewGroup>
            <ReviewGroup title="What it affects" onEdit={() => setStep(2)}>
              <dt>Amount held</dt>
              <dd>{formatRupees(paise)}</dd>
              <dt>Needed for</dt>
              <dd>
                {f.urgency.length ? f.urgency.map((u) => meta(URGENCY, u).label).join(", ") : "Not provided"}
              </dd>
            </ReviewGroup>
          </div>
        )}

        <div className="actions">
          {step > 0 && (
            <button type="button" className="btn btn--quiet" onClick={() => setStep(step - 1)} disabled={busy}>
              Back
            </button>
          )}
          <button type="submit" className="btn btn--primary btn--large" disabled={busy}>
            {last ? (busy ? "Creating…" : "Create my case") : "Continue"}
            {!busy && <Icon name={last ? "Check" : "ArrowRight"} size={18} />}
          </button>
        </div>
      </form>
    </div>
  );
}

function ReviewGroup({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="review__group">
      <div className="review__head">
        <h2>{title}</h2>
        <button type="button" className="btn btn--quiet btn--small" onClick={onEdit}>
          Edit<span className="sr-only"> {title}</span>
        </button>
      </div>
      <dl className="facts">{children}</dl>
    </section>
  );
}

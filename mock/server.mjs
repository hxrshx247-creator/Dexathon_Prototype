// Demo-only stand-in for the FairHold+ backend. Zero dependencies: `npm run mock` (port 8000).
// It follows contract/CONTRACT.md so the frontend can be exercised end to end. Member B's real backend replaces it.
import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8000);
const WINDOW_DAYS = 30;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_ORIGINS = ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"];
const BANK_FACING = ["call", "sms", "email", "branch_visit", "request_sent", "grievance_filed"];
const DIRECTION = {
  call: "outbound", sms: "outbound", email: "outbound", branch_visit: "outbound", request_sent: "outbound",
  grievance_filed: "outbound", ombudsman_filed: "outbound", bank_response: "inbound", note: "internal",
};
const ENUMS = {
  account_type: ["savings", "current", "salary", "joint", "other"],
  freeze_type: ["freeze", "debit_hold", "lien", "partial_hold", "unknown"],
  urgency: ["rent", "medical", "bills", "education", "other"],
};

const db = { cases: [], events: [], files: new Map() };

// ---------- helpers ----------
const IST = 5.5 * 3600 * 1000;
const istDate = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const dayNum = (ymd) => Math.floor(Date.UTC(...ymd.split("-").map((n, i) => (i === 1 ? n - 1 : +n))) / 86400000);
const addDays = (ymd, n) => new Date((dayNum(ymd) + n) * 86400000).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const daysAgo = (n, hh = 10, mm = 30) => {
  const d = new Date(Date.now() - n * 86400000);
  d.setUTCHours(hh, mm, 0, 0);
  return d.toISOString();
};

class HttpError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
const bad = (field, issue) => new HttpError(422, "VALIDATION_ERROR", "Request validation failed", [{ field, issue }]);
const notFound = (what = "Case") => new HttpError(404, "NOT_FOUND", `${what} not found`);

// ---------- validation ----------
function validateCase(b, partial) {
  const out = {};
  const has = (k) => b[k] !== undefined;
  const need = (k) => {
    if (!partial && !has(k)) throw bad(k, "is required");
  };
  need("bank_name");
  if (has("bank_name")) {
    if (typeof b.bank_name !== "string" || !b.bank_name.trim() || b.bank_name.length > 120) throw bad("bank_name", "must be 1 to 120 characters");
    out.bank_name = b.bank_name.trim();
  }
  for (const k of ["account_type", "freeze_type"]) {
    need(k);
    if (has(k)) {
      if (!ENUMS[k].includes(b[k])) throw bad(k, `must be one of ${ENUMS[k].join(", ")}`);
      out[k] = b[k];
    }
  }
  if (has("account_last4")) {
    if (b.account_last4 !== null && !/^[0-9]{4}$/.test(b.account_last4 ?? "")) throw bad("account_last4", "must be exactly 4 digits");
    out.account_last4 = b.account_last4;
  }
  need("freeze_date");
  if (has("freeze_date")) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.freeze_date ?? "") || Number.isNaN(Date.parse(b.freeze_date))) throw bad("freeze_date", "must be a date in YYYY-MM-DD format");
    out.freeze_date = b.freeze_date;
  }
  if (has("amount_held_minor")) {
    if (b.amount_held_minor !== null && (!Number.isInteger(b.amount_held_minor) || b.amount_held_minor < 0)) throw bad("amount_held_minor", "must be a whole number of paise, 0 or more");
    out.amount_held_minor = b.amount_held_minor;
  }
  if (has("urgency")) {
    if (!Array.isArray(b.urgency) || b.urgency.some((u) => !ENUMS.urgency.includes(u))) throw bad("urgency", "contains an unknown value");
    out.urgency = b.urgency;
  }
  if (has("reason_given")) {
    if (b.reason_given !== null && (typeof b.reason_given !== "string" || b.reason_given.length > 1000)) throw bad("reason_given", "must be at most 1000 characters");
    out.reason_given = b.reason_given;
  }
  return out;
}

function validateEvent(b) {
  if (!Object.keys(DIRECTION).includes(b.type)) throw bad("type", "is not a known event type");
  if (b.direction !== DIRECTION[b.type]) throw bad("direction", `must be ${DIRECTION[b.type]} for type ${b.type}`);
  if (typeof b.occurred_at !== "string" || Number.isNaN(Date.parse(b.occurred_at)) || !/(Z|[+-]\d{2}:?\d{2})$/.test(b.occurred_at)) throw bad("occurred_at", "must be an ISO 8601 date-time with Z or an offset");
  if (typeof b.summary !== "string" || !b.summary.trim() || b.summary.length > 1000) throw bad("summary", "must be 1 to 1000 characters");
  for (const [k, max] of [["reference_number", 100], ["bank_statement", 2000]]) {
    if (b[k] != null && (typeof b[k] !== "string" || b[k].length > max)) throw bad(k, `must be at most ${max} characters`);
  }
  return {
    type: b.type,
    direction: b.direction,
    occurred_at: new Date(b.occurred_at).toISOString(),
    summary: b.summary.trim(),
    reference_number: b.reference_number || null,
    bank_statement: b.bank_statement || null,
    is_resolution: !!b.is_resolution,
    attachment_ids: Array.isArray(b.attachment_ids) ? b.attachment_ids : [],
    source: b.source === "parsed" ? "parsed" : "manual",
  };
}

// ---------- domain ----------
const eventsOf = (caseId) =>
  db.events.filter((e) => e.case_id === caseId).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.created_at.localeCompare(b.created_at));

function statusOf(c) {
  const evs = eventsOf(c.id);
  const today = istDate(new Date());
  const resolved = evs.some((e) => e.is_resolution);
  const first = evs.find((e) => e.direction === "outbound" && BANK_FACING.includes(e.type));
  const hasRef = evs.some((e) => e.reference_number);
  const deadline = first ? addDays(istDate(new Date(first.occurred_at)), WINDOW_DAYS) : null;
  const remaining = deadline ? dayNum(deadline) - dayNum(today) : null;
  let state = "awaiting_first_contact";
  if (resolved) state = "resolved";
  else if (first) state = remaining < 0 ? "window_expired" : "within_window";

  const ready = state === "window_expired" && hasRef;
  const blockers = [];
  if (!ready && state !== "resolved") {
    if (!first) blockers.push({ code: "no_first_contact", label: "You haven't contacted the bank in writing yet" });
    else if (state === "within_window") blockers.push({ code: "window_not_elapsed", label: "The bank's response window has not ended yet" });
    if (!hasRef) blockers.push({ code: "no_reference_number", label: "None of your entries has a reference number yet" });
  }
  const steps = [];
  if (state === "awaiting_first_contact") steps.push({ code: "make_first_request", label: "Send the bank a clear written request and log it here" });
  if (state === "within_window") {
    steps.push({ code: "wait_for_response", label: "Wait for the bank's written response and log it when it arrives" });
    if (!hasRef) steps.push({ code: "log_reference_number", label: "Add the reference number from your last contact with the bank" });
  }
  if (state === "window_expired") {
    if (ready) {
      steps.push({ code: "escalate_to_ombudsman", label: "Take your chronology to the ombudsman" });
      steps.push({ code: "consult_legal_aid", label: "Ask a legal aid clinic what else you can do" });
    } else {
      steps.push({ code: "log_reference_number", label: "Add a reference number from your contact with the bank" });
      steps.push({ code: "follow_up_with_bank", label: "Send the bank a written follow-up" });
    }
  }
  return {
    case_id: c.id,
    state,
    as_of: nowIso(),
    days_since_freeze: Math.max(0, dayNum(today) - dayNum(c.freeze_date)),
    first_contact_at: first ? first.occurred_at : null,
    window_days: first ? WINDOW_DAYS : null,
    window_deadline: deadline,
    days_remaining: remaining,
    window_basis: "Configured response window of 30 days. To be verified against the current RBI Integrated Ombudsman Scheme.",
    escalation_ready: ready,
    escalation_blockers: blockers,
    next_steps: steps,
    disclaimer: "FairHold+ organizes your records. It is not legal advice.",
  };
}

const publicCase = (c) => {
  const evs = eventsOf(c.id);
  return { ...c, currency: "INR", state: statusOf(c).state, event_count: evs.length, last_event_at: evs.length ? evs[evs.length - 1].occurred_at : null };
};

function makeCase(b) {
  const c = {
    id: randomUUID(),
    bank_name: b.bank_name, account_type: b.account_type, account_last4: b.account_last4 ?? null,
    freeze_type: b.freeze_type, freeze_date: b.freeze_date, amount_held_minor: b.amount_held_minor ?? null,
    urgency: b.urgency ?? [], reason_given: b.reason_given ?? null, created_at: nowIso(), updated_at: nowIso(),
  };
  db.cases.unshift(c);
  return c;
}
function addEvent(caseId, e) {
  const ev = { id: randomUUID(), case_id: caseId, ...e, created_at: nowIso() };
  db.events.push(ev);
  return ev;
}

function seed() {
  const c = makeCase({
    bank_name: "Example National Bank", account_type: "savings", account_last4: "1234", freeze_type: "debit_hold",
    freeze_date: istDate(new Date(Date.now() - 22 * 86400000)), amount_held_minor: 4500000, urgency: ["rent", "medical"],
    reason_given: "Account under review",
  });
  const E = (type, ago, hh, mm, summary, extra = {}) =>
    addEvent(c.id, { type, direction: DIRECTION[type], occurred_at: daysAgo(ago, hh, mm), summary, reference_number: null, bank_statement: null, is_resolution: false, attachment_ids: [], source: "manual", ...extra });
  E("note", 22, 4, 10, "Tried to pay rent from my account and the payment was declined. The app says the account is on hold.");
  E("call", 20, 5, 30, "Called the helpline to ask why the account is on hold", { reference_number: "CC-884213", bank_statement: "Your account is under review. No timeline can be given." });
  E("request_sent", 18, 8, 15, "Emailed a written request asking for the reason for the hold and the steps to release it");
  E("bank_response", 13, 10, 30, "SMS from the bank about my request", { reference_number: "SR-2026-55102", bank_statement: "Your request SR-2026-55102 is under review. We will update you shortly.", source: "parsed" });
  E("branch_visit", 7, 6, 0, "Went to the branch. The manager said the review is with the head office and gave no date.", { bank_statement: "It is with head office. We cannot tell you when it will be done." });
  return c;
}

function letter(c, purpose) {
  const amt = c.amount_held_minor == null ? "" : ` of about Rs ${(c.amount_held_minor / 100).toLocaleString("en-IN")}`;
  const evs = eventsOf(c.id);
  const refs = [...new Set(evs.filter((e) => e.reference_number).map((e) => e.reference_number))];
  const first = purpose === "initial_request";
  const subject = first
    ? `Request for the reason for, and release of, the hold on my account${c.account_last4 ? ` ending ${c.account_last4}` : ""}`
    : `Follow-up: hold on my account${c.account_last4 ? ` ending ${c.account_last4}` : ""}${refs[0] ? `, reference ${refs[0]}` : ""}`;
  const lines = [
    "To the Branch Manager / Grievance Redressal Officer,",
    c.bank_name,
    "",
    first
      ? `I am writing about my ${c.account_type} account${c.account_last4 ? ` ending ${c.account_last4}` : ""}. Since ${c.freeze_date}, a hold has been placed on it, and I have not been able to use the funds${amt}.`
      : `I am following up on my earlier request about the hold on my ${c.account_type} account${c.account_last4 ? ` ending ${c.account_last4}` : ""}, in place since ${c.freeze_date}. I have not received a written resolution.`,
    c.reason_given ? `The reason I was given was: "${c.reason_given}".` : "I have not been given a reason in writing.",
    "",
    "I request that you:",
    "1. Tell me in writing the reason for the hold.",
    "2. Tell me what documents or steps are needed to release it.",
    "3. Give me a written timeline for the decision.",
    refs.length ? `\nFor reference, my earlier contacts were logged under: ${refs.join(", ")}.` : "",
    "",
    "Please reply in writing and quote a reference number for this request.",
    "",
    "Yours faithfully,",
    "[Your name]",
  ];
  return { subject, body: lines.join("\n"), generated_at: nowIso() };
}

// ---------- multipart ----------
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!m) return { fields: {}, file: null };
  const boundary = Buffer.from("--" + (m[1] ?? m[2]));
  const fields = {};
  let file = null;
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    let part = buf.subarray(start, next);
    if (part.subarray(0, 2).toString() === "\r\n") part = part.subarray(2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = part.subarray(0, split).toString("utf8");
      const data = part.subarray(split + 4, part.length - 2); // drop trailing CRLF
      const name = /name="([^"]*)"/.exec(head)?.[1];
      const filename = /filename="([^"]*)"/.exec(head)?.[1];
      const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim();
      if (filename !== undefined && filename !== "") file = { name, filename, type: type ?? "application/octet-stream", data };
      else if (name) fields[name] = data.toString("utf8");
    }
    pos = next;
  }
  return { fields, file };
}

function checkFile(f) {
  if (f.data.length > MAX_BYTES) throw new HttpError(413, "FILE_TOO_LARGE", "File larger than 10 MB");
  if (!["image/png", "image/jpeg", "application/pdf", "text/plain"].includes(f.type)) throw new HttpError(415, "UNSUPPORTED_FILE", "Use PNG, JPEG, PDF or plain text");
}
function storeFile(caseId, f) {
  const id = randomUUID();
  db.files.set(id, f);
  return { id, case_id: caseId, filename: f.filename, mime_type: f.type, size_bytes: f.data.length, url: `/files/${id}`, created_at: nowIso() };
}

// ---------- parse (very small heuristic, demo only) ----------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseDraft(text, attachmentId) {
  const warnings = [];
  const confidence = {};
  const ref = /\b([A-Z]{2,4}-[A-Z0-9-]{4,})\b/.exec(text)?.[1] ?? null;
  let when = null;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text);
  const dmy = /\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/.exec(text);
  if (iso) when = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T${iso[4] ?? "10"}:${iso[5] ?? "00"}:00+05:30`);
  else if (dmy && MONTHS[dmy[2].toLowerCase()] !== undefined) when = new Date(Date.UTC(+dmy[3], MONTHS[dmy[2].toLowerCase()], +dmy[1], 4, 30));
  if (!when || Number.isNaN(when.getTime())) {
    when = new Date();
    warnings.push("occurred_at_defaulted");
    confidence.occurred_at = 0.3;
  } else confidence.occurred_at = 0.9;
  const trimmed = text.trim().replace(/\s+/g, " ");
  const summary = trimmed ? (/\b(sms|message)\b/i.test(trimmed) ? "Message from the bank" : "Message about the account hold") : "File added to the record";
  const isResolution = /\b(released|resolved|lifted|unfrozen)\b/i.test(text) && !/not|unable/i.test(text);
  confidence.summary = trimmed ? 0.7 : 0.4;
  if (ref) confidence.reference_number = 0.9;
  if (trimmed) confidence.bank_statement = 0.85;
  return {
    suggested_event: {
      type: "bank_response", direction: "inbound", occurred_at: when.toISOString(), summary, reference_number: ref,
      bank_statement: trimmed ? trimmed.slice(0, 2000) : null, is_resolution: isResolution,
      attachment_ids: attachmentId ? [attachmentId] : [], source: "parsed",
    },
    confidence, raw_text: text, attachment_id: attachmentId ?? null, warnings,
  };
}

// ---------- tiny PDF writer (Helvetica, plain text lines) ----------
function pdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, "\\$&").replace(/₹/g, "Rs ").replace(/[^\x20-\x7e]/g, "?");
  const wrap = (s, n = 92) => {
    const out = [];
    for (const raw of s.split("\n")) {
      let line = raw;
      while (line.length > n) {
        let cut = line.lastIndexOf(" ", n);
        if (cut < 20) cut = n;
        out.push(line.slice(0, cut));
        line = line.slice(cut).trimStart();
      }
      out.push(line);
    }
    return out;
  };
  const rows = lines.flatMap((l) => (typeof l === "string" ? wrap(l) : [l]));
  const pages = [];
  for (let i = 0; i < rows.length; i += 48) pages.push(rows.slice(i, i + 48));
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((rs, i) => {
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    const body = rs.map((r) => `(${esc(typeof r === "string" ? r : r.text)}) Tj T*`).join("\n");
    const stream = `BT /F1 10 Tf 12 TL 50 790 Td\n${body}\nET`;
    add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

function exportPdf(c) {
  const s = statusOf(c);
  const evs = eventsOf(c.id);
  const when = (iso) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const lines = [
    "CHRONOLOGY OF AN ACCOUNT HOLD",
    `${c.bank_name}${c.account_last4 ? `, account ending ${c.account_last4}` : ""}`,
    "",
    `On hold since: ${c.freeze_date}`,
    `Amount held: ${c.amount_held_minor == null ? "Not provided" : `Rs ${(c.amount_held_minor / 100).toLocaleString("en-IN")}`}`,
    `Reason given by the bank: ${c.reason_given ?? "Not provided"}`,
    `First contact with the bank: ${s.first_contact_at ? when(s.first_contact_at) : "None logged"}`,
    `Response window ends: ${s.window_deadline ?? "Not started"}`,
    "",
    "ENTRIES, OLDEST FIRST",
    "",
    ...evs.flatMap((e) => [
      `${when(e.occurred_at)}  |  ${e.type.replace(/_/g, " ")}${e.reference_number ? `  |  Ref ${e.reference_number}` : ""}`,
      `   ${e.summary}`,
      ...(e.bank_statement ? [`   The bank said: ${e.bank_statement}`] : []),
      "",
    ]),
    s.disclaimer,
  ];
  return pdf(lines);
}

// ---------- router ----------
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const ch of req) {
    size += ch.length;
    if (size > MAX_BYTES + 1024 * 1024) throw new HttpError(413, "FILE_TOO_LARGE", "File larger than 10 MB");
    chunks.push(ch);
  }
  return Buffer.concat(chunks);
}
const jsonBody = (buf) => {
  try {
    return buf.length ? JSON.parse(buf.toString("utf8")) : {};
  } catch {
    throw new HttpError(422, "VALIDATION_ERROR", "Request body is not valid JSON", [{ field: "body", issue: "must be valid JSON" }]);
  }
};

async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const send = (status, data, headers = {}) => {
    if (status === 204) return res.writeHead(204, headers).end();
    const isBuf = Buffer.isBuffer(data);
    res.writeHead(status, { "Content-Type": isBuf ? headers["Content-Type"] : "application/json", ...headers });
    res.end(isBuf ? data : JSON.stringify(data));
  };

  // user-uploaded files (mock only; the real backend decides its own URLs)
  if (parts[0] === "files" && parts[1]) {
    const f = db.files.get(parts[1]);
    if (!f) throw notFound("File");
    return send(200, f.data, { "Content-Type": f.type });
  }

  if (parts[0] !== "api" || parts[1] !== "v1") throw notFound("Route");
  const [, , a, b, c2, d] = parts;
  const m = req.method;

  if (a === "health" && m === "GET") return send(200, { status: "ok" });

  if (a === "demo") {
    if (b === "seed" && m === "POST") return send(201, publicCase(seed()));
    if (b === "reset" && m === "POST") {
      db.cases = []; db.events = []; db.files.clear();
      return send(204);
    }
  }

  if (a === "cases") {
    if (!b) {
      if (m === "GET") return send(200, { items: db.cases.map(publicCase) });
      if (m === "POST") return send(201, publicCase(makeCase(validateCase(jsonBody(await readBody(req)), false))));
    } else {
      const c = db.cases.find((x) => x.id === b);
      if (!c) throw notFound();
      if (!c2) {
        if (m === "GET") return send(200, publicCase(c));
        if (m === "PATCH") {
          Object.assign(c, validateCase(jsonBody(await readBody(req)), true), { updated_at: nowIso() });
          return send(200, publicCase(c));
        }
      }
      if (c2 === "events") {
        if (!d) {
          if (m === "GET") return send(200, { items: eventsOf(c.id) });
          if (m === "POST") {
            const ev = addEvent(c.id, validateEvent(jsonBody(await readBody(req))));
            c.updated_at = nowIso();
            return send(201, ev);
          }
        } else if (m === "DELETE") {
          const i = db.events.findIndex((e) => e.id === d && e.case_id === c.id);
          if (i === -1) throw notFound("Event");
          db.events.splice(i, 1);
          return send(204);
        }
      }
      if (c2 === "status" && m === "GET") return send(200, statusOf(c));
      if (c2 === "attachments" && m === "POST") {
        const { file } = parseMultipart(await readBody(req), req.headers["content-type"]);
        if (!file) throw bad("file", "is required");
        checkFile(file);
        return send(201, storeFile(c.id, file));
      }
      if (c2 === "evidence" && d === "parse" && m === "POST") {
        const { fields, file } = parseMultipart(await readBody(req), req.headers["content-type"]);
        const text = (fields.text ?? "").slice(0, 5000);
        if (!file && !text.trim()) throw bad("file", "send a file or some text");
        let attachment = null;
        let raw = text;
        if (file) {
          checkFile(file);
          attachment = storeFile(c.id, file);
          if (file.type === "text/plain") raw = `${raw}\n${file.data.toString("utf8")}`.trim();
          if (file.type === "text/plain" && !raw) throw new HttpError(422, "PARSE_FAILED", "Nothing could be extracted");
        }
        const draft = parseDraft(raw, attachment?.id);
        if (file && file.type !== "text/plain" && !raw.trim()) draft.warnings.push("We can't read text from images or PDFs in this demo. Please fill in the details.");
        return send(200, draft);
      }
      if (c2 === "letter" && m === "POST") {
        const purpose = jsonBody(await readBody(req)).purpose;
        if (!["initial_request", "follow_up"].includes(purpose)) throw bad("purpose", "must be initial_request or follow_up");
        return send(200, letter(c, purpose));
      }
      if (c2 === "export" && m === "GET")
        return send(200, exportPdf(c), { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="fairhold-case-${c.id}.pdf"` });
    }
  }
  throw notFound("Route");
}

http
  .createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    try {
      await route(req, res);
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, "INTERNAL_ERROR", "Something went wrong");
      if (!(e instanceof HttpError)) console.error(e);
      res.writeHead(err.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: err.code, message: err.message, details: err.details } }));
    }
  })
  .listen(PORT, () => console.log(`FairHold+ demo mock on http://localhost:${PORT}/api/v1`));

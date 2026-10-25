# Backend implementation and operations

Account-hold evidence organizer with a React interface and a persistent Python backend. Built for a **single-user local demo**; no authentication is part of the agreed contract.

Member A's existing intake, dashboard, evidence review, letters and packet screens connect directly to this backend. The original in-memory mock remains available with `npm run mock`; do not run it alongside the real backend on port 8000. The files in `contract/` are unchanged copies of the supplied integration contract.

## Run locally (Windows PowerShell)

Requires Python 3.11+ and Node 20+. From the repository root:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
npm ci
.venv/Scripts/python.exe -m uvicorn backend.app:create_app --factory --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
npm run dev
```

Open [the frontend](http://localhost:5173). Use **Demo → Load demo case** to create an unresolved case whose first written contact was 35 days ago. Demo reset deletes **all records and files** in this instance. No data is seeded automatically. The demo menu deliberately resets before seeding; calling the seed endpoint alone creates another case.

On macOS/Linux replace `.venv/Scripts/python.exe` with `.venv/bin/python`. You can activate the environment and use `npm run backend` / `npm run test:backend` as shortcuts.

- [Health](http://localhost:8000/api/v1/health)
- [API explorer](http://localhost:8000/api/docs)
- [Canonical OpenAPI file](http://localhost:8000/api/openapi.yaml)

The development frontend defaults to `http://localhost:8000/api/v1`. Override it with `VITE_API_BASE` in `.env` and restart Vite. Built frontend assets default to same-origin `/api/v1`, so one container can serve everything. Do not copy the local `.env` into a production build unless its URL is intended.

## Member B implementation

- **API and storage:** FastAPI, SQLite foreign keys, persistent attachment bytes stored transactionally in SQLite, UUID identifiers, integer paise and UTC timestamps. Case state is calculated from events, never stored as an independent source of truth.
- **Evidence parsing:** local RapidOCR/ONNX models read PNG/JPEG screenshots; pypdf reads text PDFs; UTF-8 text files and pasted SMS are supported. Deterministic extraction finds dates, reference IDs, INR amounts and bank wording. No cloud key or external inference service is required. Model weights ship with the OCR dependency.
- **Review before save:** parsing stores the file and returns a draft, confidence indicators and warnings. It never creates an event. The user reviews and explicitly saves. The parser never marks a resolution automatically.
- **Rules:** all window length, basis text, timezone and disclaimer settings live in `backend/rules.json`. Restart after edits. Status updates after event creation/deletion or intake changes. Date boundaries use India calendar dates, including midnight.
- **Letters:** initial-request and follow-up templates include the actual account details, amount, essential expenses and reference numbers. Generation neither sends a letter nor logs a sent event. Optional LLM polish was omitted: the factual template works offline and avoids sending banking evidence to a provider.
- **Export:** ReportLab generates an ordered chronology PDF with case details, status, full recorded statements, reference numbers, source labels and an attachment manifest. Original files are available separately; they are not embedded in the PDF.

### Extraction limits and contract choices

Dates without a timezone are interpreted in Asia/Kolkata; a date with no time uses midnight and gets a review warning. Missing dates default to upload time with `occurred_at_defaulted`. Confidence numbers are **review heuristics, not calibrated probabilities**. OCR is currently best for clear English screenshots. Scanned/image-only PDFs return `PARSE_FAILED`; upload a screenshot of the relevant page instead. PDFs are limited to 20 pages for parsing, images to 25 megapixels, files to 10 MB, pasted text to 5,000 characters and extracted raw text to 20,000 characters.

`EventCreate` has no amount property. To keep the supplied contract unchanged, the extracted amount remains in the review summary/bank statement and is reported exactly as integer paise in the draft warnings (`amount_detected_minor=...`). Parsing never silently changes the case's intake amount. Reference/date extraction is conservative and can miss unfamiliar message formats; the draft is editable.

Attachment retrieval uses the returned `Attachment.url`: `GET /api/v1/cases/{caseId}/attachments/{attachmentId}`. This supporting route is not listed in the supplied OpenAPI file and does not change any existing shape. Unknown case/event/attachment IDs return the standard error envelope. Files cannot be linked to an event in another case. No full bank account number is requested.

### Rules are a prototype policy

The contract requires a fixed window starting from the earliest logged bank-facing contact, including calls, plus a reference-number gate. This is implemented exactly as a **packet preparation policy**, not a legal eligibility decision. A documented resolution takes priority over all other states. The deadline date itself is still within the window; the following India calendar day is expired.

An [official RBI FAQ search result for the 2026 scheme](https://old.rbi.org.in/commonman/english/scripts/faqs.aspx?id=3407), checked October 25, 2026, describes 30 days **or a longer applicable RBI/NPCI/card-network period**, and separate grounds where a reply is unsatisfactory. The full RBI scheme was blocked by CAPTCHA during verification. Full legal verification remains pending. A call timestamp is not proof of receipt of a written complaint. This prototype does not evaluate jurisdiction, exclusions, filing limits, prior proceedings, special response periods or whether a restriction can legally be lifted. The status basis and disclaimer make this limitation visible. Do not present the banner as an RBI acceptance decision.

## Verify

```powershell
.venv/Scripts/python.exe -m pytest backend/tests -q
npm run build
.venv/Scripts/python.exe scripts/make_demo_artifacts.py
```

Tests exercise every contracted endpoint, response schemas, input/error shapes, exact day-30 and India-midnight boundaries, overrides, resolution/deletion, OCR on a generated screenshot, upload size/content validation, attachment ownership, persistence across app instances, letter content, PDF contents/order and demo reset. Artifact generation creates a sample screenshot, SMS and chronology PDF under `output/` without modifying live cases.

## Deployment

```powershell
docker compose up --build -d
```

Open [the integrated application](http://localhost:8000). Compose binds it to localhost; SQLite and file bytes survive container replacement in the `fairhold-data` volume. `docker compose down` retains the volume; `down -v` deletes it. Docker installs a Unicode font for PDF output and the system libraries used by OCR. The process runs as a non-root user and has a health check.

Docker image build, healthy startup, all 31 backend tests inside Linux, live OCR/letter/PDF requests, and data persistence across service restart were verified on October 25, 2026. To repeat the live smoke test after creating the demo artifacts, run `.venv/Scripts/python.exe scripts/verify_deployment.py`; run it again after `docker compose restart fairhold` to check the same records. The script creates a fictional case on its first run and stores its identifiers in `tmp/docker-verification.json`. Docker's named volume is separate from the local Python server's `data/` directory.

Without Docker, build with `npm run build`, then start uvicorn from the repository root. It serves `dist/` and `/api/v1` on port 8000. Build before starting the backend, since the frontend mount is discovered at startup.

`DATA_DIR`, `RULES_PATH`, `FRONTEND_DIST` and comma-separated `CORS_ORIGINS` are backend environment variables; see `backend/.env.example`. Export them in the launch shell (the backend does not automatically load dotenv files). Do not expose this unauthenticated demo to the public internet or store real banking evidence on a shared instance. Public deployment requires authentication, per-user authorization, removal/protection of reset endpoints, TLS, encrypted storage/backups, retention/deletion controls and abuse/rate limits. No public hosting account was supplied; deployment files are ready, but no public service has been provisioned.

See [architecture](ARCHITECTURE.md), [Member A handoff and demo sequence](HANDOFF.md), and [verification notes](VERIFICATION.md).

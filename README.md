# FairHold+

**Turn scattered bank messages into one clear account-hold record.**

FairHold+ helps people document a frozen bank account, track a response window, and prepare a chronology for the bank or ombudsman. Screenshot OCR extracts dates, reference numbers, INR amounts and bank wording into an editable draft. The user reviews the draft before anything enters the timeline.

## Run with Docker

Requires Docker Desktop with the Linux engine running.

```sh
git clone https://github.com/hxrshx247-creator/Dexathon_Prototype.git
cd Dexathon_Prototype
docker compose up --build -d --wait
```

Open **[localhost:8000](http://localhost:8000)**. No API keys or extra configuration are needed. The first build downloads dependencies and bundled OCR models.

To stop: `docker compose down`. Records survive in a named volume; `docker compose down -v` deletes them.

## Try the demo

1. Select **See a demo case** to load fictional bank contacts and reference numbers. This resets the demo instance's existing records.
2. Select **Add evidence** and upload a screenshot or paste a bank message. Review the extracted details, then save the event.
3. Open the escalation packet and download the chronology PDF.

Example message to paste:

```text
Date: 23/10/2026
Reference: SR-2026-55102
INR 45,000.00 is on hold. Your account is under review.
We will update you shortly.
```

The app also provides an intake wizard, status dashboard, manual timeline entries, evidence uploads, and initial-request/follow-up letters. A fictional screenshot and sample PDF can be generated with `python scripts/make_demo_artifacts.py` after installing the Python dependencies below; generated files go to `output/demo/`.

## Develop locally

Requires **Node.js 20+** and **Python 3.11+**. Stop the Docker service first to free port 8000.

```sh
python -m venv .venv
```

Activate with `.venv/Scripts/Activate.ps1` on Windows PowerShell, or `source .venv/bin/activate` on macOS/Linux. Then:

```sh
python -m pip install -r backend/requirements-dev.txt
npm ci
npm run backend
```

In a second terminal, run `npm run dev` and open [localhost:5173](http://localhost:5173).

Development uses `http://localhost:8000/api/v1`; production uses same-origin `/api/v1`. Set `VITE_API_BASE` in a local `.env` to override it. Backend environment options are listed in [backend/.env.example](backend/.env.example).

## Architecture

**React + TypeScript + Vite** provide the interface. **FastAPI + SQLite** persist cases, timeline events and original attachments. **RapidOCR/ONNX** processes screenshots locally, and **ReportLab** generates the chronology PDF. No external inference service is used.

```text
src/                  Frontend and typed API client
backend/              API, OCR, rules, storage, letters and PDF generation
backend/tests/        Contract, OCR, deadline and persistence tests
contract/             OpenAPI schema and API behavior
public/               Bundled frontend fonts
scripts/              Fictional demo artifact generator
docs/ARCHITECTURE.md   System diagram and data model
Dockerfile            Frontend build and backend runtime
compose.yaml          Local service and persistent data volume
```

[Architecture and data model](docs/ARCHITECTURE.md) · [API schema](contract/openapi.yaml) · [API behavior](contract/CONTRACT.md)

## Validate

With the Python environment active:

```sh
python -m pytest backend/tests -q
npm run build
```

**31 backend tests pass on Windows and Linux.** Docker startup, screenshot OCR, letter generation, PDF export and persistence after a service restart have also been verified.

API explorer: [localhost:8000/api/docs](http://localhost:8000/api/docs). Health check: `/api/v1/health`. Response-window settings: [backend/rules.json](backend/rules.json).

## Prototype scope

FairHold+ organizes records and is **not legal advice**. The default 30-day window is a configurable demonstration policy; readiness is not a legal eligibility decision, and full verification of applicable RBI rules remains pending. OCR works best with clear English screenshots; image-only PDFs require a screenshot of the relevant page. Amount extraction does not overwrite the case's recorded amount. Uploaded originals are stored separately from the exported PDF.

This is a single-user, unauthenticated local prototype. Use fictional data for the demo. Public use with real banking evidence requires authentication and per-user access controls. Local databases, secrets, dependency folders and generated output are excluded from version control.

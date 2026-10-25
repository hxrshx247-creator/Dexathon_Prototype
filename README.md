# FairHold+

**One clear record of a frozen bank account.**

FairHold+ helps people collect bank communications, track a configured response window, and prepare a chronology they can take to a bank, ombudsman or legal aid clinic. It turns screenshots and pasted messages into editable timeline drafts, keeping dates, reference numbers and bank statements together.

This is a single-user hackathon prototype. **FairHold+ organizes records; it is not legal advice.** Escalation readiness reflects a simplified, configurable policy and does not establish legal eligibility.

## Features

- Intake for bank, account type, hold details, amount and essential expenses.
- Dashboard with backend-computed status, deadlines and next steps.
- Chronological record of calls, messages, emails, visits and uploaded evidence.
- Local screenshot OCR and SMS extraction with editable drafts and review warnings.
- Initial-request and follow-up letter templates.
- Downloadable chronology PDF with reference numbers and an evidence manifest.
- Fictional demo case and persistent SQLite storage.

## Quick start with Docker

Requires Docker Desktop with its Linux engine running.

```sh
git clone https://github.com/hxrshx247-creator/Dexathon_Prototype.git
cd Dexathon_Prototype
docker compose up --build -d --wait
```

Open **[http://localhost:8000](http://localhost:8000)** and choose **See a demo case**. The demo contains fictional records. Loading or resetting the demo clears all records in that instance.

```sh
docker compose logs -f fairhold
docker compose down
```

Cases and original attachment bytes persist in the `fairhold-data` Docker volume. Stopping the service retains them; `docker compose down -v` deletes them. The service binds to localhost and runs as a non-root user.

## Local development

Requires Node.js 20+ and Python 3.11+.

```sh
python -m venv .venv
```

Activate the virtual environment:

```powershell
# Windows PowerShell
.venv/Scripts/Activate.ps1
```

```sh
# macOS / Linux
source .venv/bin/activate
```

Then install dependencies and start the backend:

```sh
python -m pip install -r backend/requirements-dev.txt
npm ci
npm run backend
```

In a second terminal, start the frontend:

```sh
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The backend listens on port 8000. Avoid running it alongside the Docker service on the same port.

The development API defaults to `http://localhost:8000/api/v1`. To use another backend, put `VITE_API_BASE=https://your-host/api/v1` in a local `.env` file and restart Vite. Production builds use same-origin `/api/v1` by default. Backend environment examples are in [backend/.env.example](backend/.env.example).

## Repository layout

```text
backend/        FastAPI routes, SQLite storage, OCR, rules, letters and PDF export
  tests/        API contract, validation, OCR, rules and persistence tests
contract/       Shared OpenAPI specification and integration behavior
docs/           Architecture, backend details, demo handoff and verification
mock/           Optional in-memory server for frontend-only development
public/         Bundled frontend fonts
scripts/        Demo artifact generator and live deployment smoke test
src/            React interface and generated API types
Dockerfile      Frontend build and Python runtime image
compose.yaml    Local deployment with a persistent data volume
```

Dependencies, builds, databases, uploaded evidence, secrets and generated demo output are excluded from Git. `package-lock.json` and pinned backend requirements are included for installation.

## Tests and demo inputs

With the Python environment active:

```sh
python -m pytest backend/tests -q
npm run build
python scripts/make_demo_artifacts.py
```

The generator creates a fictional SMS, screenshot and sample PDF in ignored `output/demo/`, without changing the running database. These inputs can be uploaded through the evidence flow.

To test a running Docker deployment:

```sh
python scripts/verify_deployment.py
docker compose restart fairhold
python scripts/verify_deployment.py
```

The first smoke-test run adds a fictional case and evidence; later runs check the same records using ignored `tmp/docker-verification.json`. It never resets other cases.

**Verified:** 31 backend tests pass on Windows and inside Linux; frontend builds, Docker health checks, live OCR, letters, PDF export and persistence across a container restart pass. See [verification notes](docs/VERIFICATION.md) for details and remaining limits.

## API and configuration

- Base path: `/api/v1`
- Health: `GET /api/v1/health`
- Interactive API docs: [http://localhost:8000/api/docs](http://localhost:8000/api/docs)
- Shared specification: [contract/openapi.yaml](contract/openapi.yaml)
- Deadline policy: [backend/rules.json](backend/rules.json)
- Backend settings: `DATA_DIR`, `RULES_PATH`, `FRONTEND_DIST`, `CORS_ORIGINS`

Money is stored as integer paise, timestamps use UTC, and deadline dates use the configured India timezone. The backend owns status calculations. Parsing returns a draft and never saves an event until the user confirms it.

## Documentation and limitations

- [Architecture and data model](docs/ARCHITECTURE.md)
- [Backend implementation, extraction limits and policy sources](docs/BACKEND.md)
- [Frontend handoff and three-minute demo](docs/HANDOFF.md)
- [Verification results](docs/VERIFICATION.md)
- [Integration contract](contract/CONTRACT.md)

OCR currently targets clear English screenshots. Image-only PDFs require a screenshot of the relevant page. No cloud AI key is needed. Legal verification of the applicable RBI rules remains pending. This unauthenticated local prototype needs identity, per-user access controls and other production safeguards before public use with real banking evidence.

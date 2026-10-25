# Verification - October 25, 2026

## Passed

- Backend integration suite: **31 tests**, including local OCR from an actual generated PNG, successful posting of the reviewed draft, schema checks against the supplied OpenAPI, SQLite reopening, error envelopes, upload boundaries and cross-case attachment rejection.
- Frontend: `npm run build` completed TypeScript checking, type regeneration and Vite production output.
- Runtime: integrated FastAPI server started on `127.0.0.1:8000` and served the built frontend and API together.
- Browser: fictional case dashboard rendered live status, references and five seed events; pasted SMS produced an editable review form with extracted date, reference and amount; saving showed a sixth event with its parsed badge without reloading the page.
- PDF: generated the sample chronology, checked extracted content and ordering in tests, rendered both pages with Poppler, and visually reviewed the final pagination, references, statements, manifest and footers. Entries stay with their reference and statement where page space allows.
- Dependency consistency: `pip check` passed. Python sources compiled.
- Deployment syntax: `docker compose config --quiet` passed.
- Docker execution: image built successfully on Docker Engine 29.9.2; Compose started the service and its health check passed. All **31 backend tests also passed inside a disposable Linux container** using the built image.
- Live Docker smoke test: frontend, API health, real screenshot OCR, amount/reference extraction, draft review/save, status, letter generation and two-page PDF export passed through the published localhost port.
- Docker restart persistence: case, six timeline events and original screenshot bytes survived a service restart in the named volume. `pip check` inside the running container passed. Reproduce with `python scripts/verify_deployment.py`, `docker compose restart fairhold`, then the same script again. The smoke test creates only fictional demo data and never resets existing data; its record is saved in ignored `tmp/docker-verification.json`.
- Contract integrity: SHA-256 hashes of both files in `contract/` match their supplied Downloads originals.

## Limits

- Both local Python and Docker deployment are verified. No public hosting was provisioned.
- RBI's full scheme documents were behind CAPTCHA. The source excerpt and simplified policy are documented in the README and rules config; full legal verification remains pending.
- The existing frontend dependency installation reported four audit findings (three moderate, one high). No automatic major-version dependency changes were made as part of the backend implementation.
- A Starlette/AnyIO deprecation warning appears in the test client; it does not fail the suite. The disposable non-root container also emitted pytest cache permission warnings because `/app` is read-only to that user; all tests passed and runtime storage in `/data` is writable.
- OCR verification uses a clear English sample; this is not an accuracy benchmark across banks, languages or screenshot quality.

Run instructions and reproducible verification commands are in the repository README. Demo inputs and the visually checked sample export are in `output/demo/`. Local Python demo data is in ignored `data/fairhold.sqlite3`; Docker data is separate in the `fairhold-data` named volume.

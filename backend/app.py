import io
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

import yaml
from fastapi import FastAPI, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from jsonschema import Draft4Validator, FormatChecker
from PIL import Image
from starlette.exceptions import HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse, JSONResponse

from .domain import DIRECTIONS, iso, now, status
from .evidence import extract, file_text
from .outputs import chronology, letter
from .store import Store

ROOT = Path(__file__).resolve().parent.parent
MAX_FILE = 10 * 1024 * 1024
MIMES = {'image/png', 'image/jpeg', 'application/pdf', 'text/plain'}


def compatible_schema(value):
    if isinstance(value, list):
        return [compatible_schema(v) for v in value]
    if not isinstance(value, dict):
        return value
    out = {k: compatible_schema(v) for k, v in value.items() if k != 'nullable'}
    if value.get('nullable') and 'type' in out:
        out['type'] = [out['type'], 'null']
    return out


SPEC = compatible_schema(yaml.safe_load((ROOT / 'contract/openapi.yaml').read_text(encoding='utf-8')))


class ApiFailure(Exception):
    def __init__(self, status_code, code, message, details=None):
        self.status_code, self.code, self.message, self.details = status_code, code, message, details or []


def invalid(field, issue):
    raise ApiFailure(422, 'VALIDATION_ERROR', 'Request validation failed', [{'field': field, 'issue': issue}])


def validate(name, value):
    schema = dict(SPEC, **{'$ref': f'#/components/schemas/{name}'})
    errors = sorted(Draft4Validator(schema, format_checker=FormatChecker()).iter_errors(value), key=lambda e: str(e.path))
    if errors:
        raise ApiFailure(422, 'VALIDATION_ERROR', 'Request validation failed',
                         [{'field': '.'.join(map(str, e.path)) or 'body', 'issue': e.message} for e in errors])
    if name == 'EventCreate':
        stamp = value['occurred_at']
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})', stamp):
            invalid('occurred_at', 'must be an ISO 8601 date-time with seconds and Z or a timezone offset')
        try:
            datetime.fromisoformat(stamp.upper().replace('Z', '+00:00'))
        except ValueError:
            invalid('occurred_at', 'must be a valid calendar date and time')
    allowed = SPEC['components']['schemas'][name].get('properties', {})
    return {k: v for k, v in value.items() if k in allowed}


class LimitBody:
    """Bound streamed and chunked request bodies before multipart parsing."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        size = 0
        async def limited():
            nonlocal size
            msg = await receive()
            size += len(msg.get('body', b''))
            if size > MAX_FILE + 128 * 1024:
                raise ApiFailure(413, 'FILE_TOO_LARGE', 'The file limit is 10 MB')
            return msg
        # Middleware lives inside error handling, so stream failures use the same envelope.
        await self.app(scope, limited, send)


def create_app(data_dir=None, rules_path=None):
    rules = json.loads(Path(rules_path or os.getenv('RULES_PATH', ROOT / 'backend/rules.json')).read_text(encoding='utf-8'))
    if not isinstance(rules['window_days'], int) or rules['window_days'] < 1:
        raise ValueError('window_days must be a positive integer')
    store = Store(data_dir or os.getenv('DATA_DIR', ROOT / 'data'))
    app = FastAPI(title='FairHold+ backend', version='1.0.0', docs_url='/api/docs', openapi_url='/api/openapi.json')
    app.openapi = lambda: yaml.safe_load((ROOT / 'contract/openapi.yaml').read_text(encoding='utf-8'))
    app.state.store, app.state.rules = store, rules
    origins = os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173').split(',')
    app.add_middleware(LimitBody)
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['*'], allow_headers=['*'],
                       expose_headers=['Content-Disposition'])

    @app.exception_handler(ApiFailure)
    async def api_error(_, exc):
        return JSONResponse({'error': {'code': exc.code, 'message': exc.message, 'details': exc.details}}, status_code=exc.status_code)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        if exc.status_code == 404:
            return await api_error(request, ApiFailure(404, 'NOT_FOUND', 'Resource not found'))
        return await api_error(request, ApiFailure(422, 'VALIDATION_ERROR', str(exc.detail)))

    @app.exception_handler(RequestValidationError)
    async def request_error(request, exc):
        return await api_error(request, ApiFailure(422, 'VALIDATION_ERROR', 'Request validation failed',
            [{'field': '.'.join(map(str, e['loc'])), 'issue': e['msg']} for e in exc.errors()]))

    @app.exception_handler(Exception)
    async def internal_error(request, exc):
        logging.exception('Request failed', exc_info=exc)
        return await api_error(request, ApiFailure(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'))

    async def body(request, name):
        try:
            value = await request.json()
        except (ValueError, UnicodeError):
            invalid('body', 'must be valid JSON')
        return validate(name, value)

    def get_case(identifier):
        item = store.get('cases', identifier)
        if not item:
            raise ApiFailure(404, 'NOT_FOUND', 'Case not found')
        return item

    def events(identifier):
        return sorted(store.list('events', identifier), key=lambda e: (e['occurred_at'], e['created_at'], e['id']))

    def public_case(item):
        evs = events(item['id'])
        return dict(item, currency='INR', state=status(item, evs, rules)['state'], event_count=len(evs),
                    last_event_at=evs[-1]['occurred_at'] if evs else None)

    def new_case(values):
        item = dict(account_last4=None, amount_held_minor=None, urgency=[], reason_given=None)
        item.update(values)
        item.update(id=str(uuid4()), created_at=iso(), updated_at=iso())
        store.save('cases', item)
        return item

    def add_event(case, values):
        values = validate('EventCreate', values)
        if values['direction'] != DIRECTIONS[values['type']]:
            invalid('direction', f"must be {DIRECTIONS[values['type']]} for {values['type']}")
        if not values['summary'].strip():
            invalid('summary', 'must not be blank')
        for aid in values.get('attachment_ids', []):
            a = store.get('attachments', aid)
            if not a or a['case_id'] != case['id']:
                invalid('attachment_ids', 'must refer to attachments belonging to this case')
        item = dict(reference_number=None, bank_statement=None, is_resolution=False, attachment_ids=[], source='manual')
        item.update(values)
        item.update(id=str(uuid4()), case_id=case['id'], created_at=iso())
        item['occurred_at'] = iso(datetime.fromisoformat(item['occurred_at'].upper().replace('Z', '+00:00')))
        store.save('events', item)
        case['updated_at'] = iso()
        store.save('cases', case)
        return item

    async def upload(case, file):
        if not isinstance(file, UploadFile) and not hasattr(file, 'read'):
            invalid('file', 'a file is required')
        mime = (file.content_type or '').split(';')[0]
        if mime not in MIMES:
            raise ApiFailure(415, 'UNSUPPORTED_FILE', 'Use PNG, JPEG, PDF or plain text')
        data = await file.read(MAX_FILE + 1)
        if len(data) > MAX_FILE:
            raise ApiFailure(413, 'FILE_TOO_LARGE', 'The file limit is 10 MB')
        try:
            if mime.startswith('image/'):
                with Image.open(io.BytesIO(data)) as im:
                    if im.format != ('PNG' if mime == 'image/png' else 'JPEG') or im.width * im.height > 25_000_000:
                        raise ValueError('Image format or dimensions are invalid')
                    im.verify()
            elif mime == 'application/pdf':
                if not data.startswith(b'%PDF-'):
                    raise ValueError('Invalid PDF')
            else:
                decoded = data.decode('utf-8-sig')
                if '\0' in decoded:
                    raise ValueError('Binary file is not plain text')
        except Exception:
            raise ApiFailure(415, 'UNSUPPORTED_FILE', 'File content does not match the supplied type or is unreadable')
        identifier = str(uuid4())
        filename = re.sub(r'[\x00-\x1f\x7f]', '', (file.filename or 'evidence').replace('\\', '/').split('/')[-1])[:180] or 'evidence'
        item = dict(id=identifier, case_id=case['id'], filename=filename, mime_type=mime,
                    size_bytes=len(data), url=f"/api/v1/cases/{case['id']}/attachments/{identifier}", created_at=iso())
        store.save('attachments', item, data)
        return item, data

    @asynccontextmanager
    async def form(request):
        try:
            fields = await request.form(max_files=1, max_fields=2)
        except ApiFailure:
            raise
        except Exception:
            invalid('body', 'must be valid multipart/form-data with one file and optional text')
        try:
            yield fields
        finally:
            await fields.close()

    @app.get('/api/v1/health')
    def health():
        return {'status': 'ok'}

    @app.get('/api/v1/cases')
    def list_cases():
        return {'items': [public_case(c) for c in sorted(store.list('cases'), key=lambda c: c['created_at'], reverse=True)]}

    @app.post('/api/v1/cases', status_code=201)
    async def post_case(request: Request):
        values = await body(request, 'CaseCreate')
        if not values['bank_name'].strip():
            invalid('bank_name', 'must not be blank')
        return public_case(new_case(values))

    @app.get('/api/v1/cases/{case_id}')
    def read_case(case_id: str):
        return public_case(get_case(case_id))

    @app.patch('/api/v1/cases/{case_id}')
    async def patch_case(case_id: str, request: Request):
        case = get_case(case_id)
        values = await body(request, 'CaseUpdate')
        if 'bank_name' in values and not values['bank_name'].strip():
            invalid('bank_name', 'must not be blank')
        case.update(values, updated_at=iso())
        store.save('cases', case)
        return public_case(case)

    @app.get('/api/v1/cases/{case_id}/events')
    def list_events(case_id: str):
        get_case(case_id)
        return {'items': events(case_id)}

    @app.post('/api/v1/cases/{case_id}/events', status_code=201)
    async def post_event(case_id: str, request: Request):
        return add_event(get_case(case_id), await body(request, 'EventCreate'))

    @app.delete('/api/v1/cases/{case_id}/events/{event_id}', status_code=204)
    def delete_event(case_id: str, event_id: str):
        case = get_case(case_id)
        ev = store.get('events', event_id)
        if not ev or ev['case_id'] != case_id:
            raise ApiFailure(404, 'NOT_FOUND', 'Event not found')
        store.delete_event(event_id)
        case['updated_at'] = iso()
        store.save('cases', case)
        return Response(status_code=204)

    @app.get('/api/v1/cases/{case_id}/status')
    def get_status(case_id: str):
        return status(get_case(case_id), events(case_id), rules)

    @app.post('/api/v1/cases/{case_id}/attachments', status_code=201)
    async def post_attachment(case_id: str, request: Request):
        case = get_case(case_id)
        async with form(request) as fields:
            item, _ = await upload(case, fields.get('file'))
        return item

    # Attachment.url requires a retrieval route. It is additive infrastructure for the existing contract.
    @app.get('/api/v1/cases/{case_id}/attachments/{attachment_id}')
    def get_attachment(case_id: str, attachment_id: str):
        get_case(case_id)
        item = store.get('attachments', attachment_id)
        if not item or item['case_id'] != case_id:
            raise ApiFailure(404, 'NOT_FOUND', 'Attachment not found')
        return Response(store.content(attachment_id), media_type=item['mime_type'],
                        headers={'Content-Disposition': f'attachment; filename="evidence-{attachment_id}"',
                                 'X-Content-Type-Options': 'nosniff'})

    @app.post('/api/v1/cases/{case_id}/evidence/parse')
    async def parse_evidence(case_id: str, request: Request):
        case = get_case(case_id)
        async with form(request) as fields:
            text = fields.get('text', '')
            if not isinstance(text, str) or len(text) > 5000:
                invalid('text', 'must be at most 5000 characters')
            file = fields.get('file')
            if file is None and not text.strip():
                invalid('body', 'send at least one of file or text')
            item = None
            extraction_warnings = []
            if file is not None:
                item, data = await upload(case, file)
                try:
                    read = await run_in_threadpool(file_text, data, item['mime_type'])
                    text = '\n'.join(s for s in (read, text) if s.strip())
                except Exception as exc:
                    if not text.strip():
                        raise ApiFailure(422, 'PARSE_FAILED', 'Could not read this file. Try a clearer screenshot or enter the details manually.') from exc
                    extraction_warnings.append('file_text_unreadable: draft uses pasted text only')
            try:
                draft = extract(text, item['id'] if item else None, now())
            except ValueError as exc:
                raise ApiFailure(422, 'PARSE_FAILED', str(exc))
            draft['warnings'].extend(extraction_warnings)
            validate('EventCreate', draft['suggested_event'])
            return draft

    @app.post('/api/v1/cases/{case_id}/letter')
    async def generate_letter(case_id: str, request: Request):
        case = get_case(case_id)
        values = await body(request, 'LetterRequest')
        return letter(case, events(case_id), values['purpose'])

    @app.get('/api/v1/cases/{case_id}/export')
    def export_case(case_id: str):
        case = get_case(case_id)
        evs = events(case_id)
        return Response(chronology(case, evs, status(case, evs, rules), store.list('attachments', case_id)),
                        media_type='application/pdf', headers={'Content-Disposition': f'attachment; filename="fairhold-case-{case_id}.pdf"'})

    @app.post('/api/v1/demo/seed', status_code=201)
    def seed():
        at = now()
        case = new_case(dict(bank_name='Example National Bank', account_type='savings', account_last4='1234',
                             freeze_type='debit_hold', freeze_date=(at - timedelta(days=36)).date().isoformat(),
                             amount_held_minor=4500000, urgency=['rent', 'medical'], reason_given='Account under review'))
        for days, kind, summary, ref, statement in [
            (36, 'note', 'Rent payment declined; account shows a debit hold.', None, None),
            (35, 'request_sent', 'Sent a written complaint requesting the basis of the hold and a review timeline.', 'SR-2026-55102', None),
            (32, 'call', 'Called customer care to follow up on the complaint.', 'CC-884213', 'Your account is under review.'),
            (24, 'bank_response', 'Received a bank SMS acknowledging the review.', 'SR-2026-55102', 'Your request is under review. We will update you shortly.'),
            (12, 'branch_visit', 'Visited the branch; no written decision or release date was provided.', None, 'The review is with head office.'),
        ]:
            add_event(case, dict(type=kind, direction=DIRECTIONS[kind], occurred_at=iso(at - timedelta(days=days)),
                summary=summary, reference_number=ref, bank_statement=statement, source='manual'))
        return public_case(case)

    @app.post('/api/v1/demo/reset', status_code=204)
    def reset():
        store.reset()
        return Response(status_code=204)

    @app.get('/api/openapi.yaml', include_in_schema=False)
    def contract():
        return FileResponse(ROOT / 'contract/openapi.yaml', media_type='application/yaml')

    # A single container can serve the Vite build and the API on the same origin.
    dist = Path(os.getenv('FRONTEND_DIST', ROOT / 'dist'))
    if dist.is_dir():
        @app.get('/{path:path}', include_in_schema=False)
        def frontend(path: str):
            if path == 'api' or path.startswith('api/'):
                raise ApiFailure(404, 'NOT_FOUND', 'Resource not found')
            candidate = (dist / path).resolve()
            if candidate.is_relative_to(dist.resolve()) and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / 'index.html')
    return app

"""Local OCR plus conservative extraction. Evidence is always an untrusted draft."""
import io
import re
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from functools import lru_cache

from PIL import Image, ImageOps
from pypdf import PdfReader

IST = timezone(timedelta(hours=5, minutes=30))


@lru_cache(maxsize=1)
def ocr_engine():
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)


def image_text(data):
    import numpy as np
    with Image.open(io.BytesIO(data)) as image:
        if image.width * image.height > 25_000_000:
            raise ValueError('Image exceeds 25 megapixels; crop it before uploading')
        image = ImageOps.exif_transpose(image).convert('RGB')
        result, _ = ocr_engine()(np.asarray(image))
    return '\n'.join(row[1] for row in result or [])


def file_text(data, mime):
    if mime == 'text/plain':
        return data.decode('utf-8-sig')
    if mime.startswith('image/'):
        return image_text(data)
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ValueError('Unlock the PDF before uploading it')
    if len(reader.pages) > 20:
        raise ValueError('Use a PDF with 20 pages or fewer')
    pages = [(page.extract_text() or '') for page in reader.pages]
    # Render scanned pages locally; PyMuPDF is optional to keep the default small.
    if not ''.join(pages).strip():
        raise ValueError('This PDF has no readable text. Upload a screenshot of the relevant page for OCR')
    return '\n'.join(pages)


def extract(text, attachment_id, uploaded_at):
    text = text.strip()[:20000]
    if not text or not any(c.isalnum() for c in text):
        raise ValueError('No readable text found; use the manual event form')
    warnings = ['Review every extracted field before saving. No event has been added.']
    found_date = None
    # Full ISO timestamps preserve offsets; dates printed without a zone are interpreted in IST.
    timestamp = re.search(r'\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?', text)
    candidates = [(timestamp.group(), 'iso')] if timestamp else []
    for pattern, formats in [
        (r'\b\d{4}-\d{2}-\d{2}\b', ('%Y-%m-%d',)),
        (r'\b\d{1,2}[/.-]\d{1,2}[/.-]\d{4}\b', ('%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y')),
        (r'\b\d{1,2}[ -][A-Za-z]{3,9}[ ,-]+\d{4}\b', ('%d %b %Y', '%d %B %Y', '%d-%b-%Y')),
    ]:
        for match in re.finditer(pattern, text):
            candidates.extend((match.group(), fmt) for fmt in formats)
    for value, fmt in candidates:
        try:
            found_date = datetime.fromisoformat(value.replace('Z', '+00:00')) if fmt == 'iso' else datetime.strptime(value, fmt)
            if found_date.tzinfo is None:
                found_date = found_date.replace(tzinfo=IST)
                warnings.append('Date/time without timezone interpreted in Asia/Kolkata; date-only values use midnight. Please check it.')
            break
        except ValueError:
            continue
    if not found_date:
        warnings.append('occurred_at_defaulted')
    ref = re.search(r'\b(?:reference|ref|complaint|ticket|service\s+request|sr)\s*(?:number|no\.?|id)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{3,99})\b', text, re.I)
    # Prefer explicit prefixed IDs over words after generic labels.
    prefixed = re.search(r'\b(?:SR|CC|REF|CMP|TKT|GRV)[-/][A-Z0-9]+(?:[-/][A-Z0-9]+)*\b', text, re.I)
    reference = prefixed.group() if prefixed else ref.group(1) if ref and re.search(r'\d', ref.group(1)) else None
    amount = re.search(r'(?:₹|INR\b|Rs\.?\s*)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?![0-9.])', text, re.I)
    summary = 'Bank communication: ' + re.sub(r'\s+', ' ', text)[:975]
    if amount:
        try:
            paise = int(Decimal(amount.group(1).replace(',', '')) * 100)
            warnings.append(f'amount_detected_minor={paise} (INR paise). Review the amount in the message; case amount is unchanged.')
        except InvalidOperation:
            pass
    if not reference:
        warnings.append('reference_number_not_found')
    warnings.append('Resolution is not inferred automatically. Mark it only after reviewing a documented resolution.')
    return {
        'suggested_event': dict(type='bank_response', direction='inbound',
            occurred_at=(found_date or uploaded_at).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
            summary=summary, reference_number=reference, bank_statement=text[:2000],
            is_resolution=False, attachment_ids=[attachment_id] if attachment_id else [], source='parsed'),
        'confidence': {'occurred_at': 0.85 if found_date else 0.0,
                       'reference_number': 0.85 if reference else 0.0,
                       'bank_statement': 0.65 if attachment_id else 0.95, 'summary': 0.65},
        'raw_text': text, 'attachment_id': attachment_id, 'warnings': warnings,
    }

import io
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether

from .domain import iso


def money(amount):
    return 'Not recorded' if amount is None else f'INR {amount / 100:,.2f}'


def letter(case, events, purpose):
    refs = ', '.join(dict.fromkeys(e['reference_number'] for e in events if e['reference_number'])) or 'None recorded'
    subject = ('Follow-up: ' if purpose == 'follow_up' else 'Request: ') + 'written explanation and review of account hold'
    body = f'''To the Grievance Redressal Officer,
{case['bank_name']}

Subject: {subject}

I am writing about my {case['account_type']} account{(' ending ' + case['account_last4']) if case['account_last4'] else ''}, which has been subject to a {case['freeze_type'].replace('_', ' ')} since {case['freeze_date']}.
Amount held: {money(case['amount_held_minor'])}.
Reason communicated to me: {case['reason_given'] or 'No reason has been recorded'}.
Previous reference numbers: {refs}.
Essential expenses affected: {', '.join(case['urgency']) or 'Not specified'}.

Please acknowledge this complaint and provide a reference number and receipt date. Please explain in writing the reason and basis for the restriction, the amount affected, the documents or steps required from me, and the expected review timeline. If any details cannot be shared, please explain what can be disclosed and whom I should contact.

Please review whether access to funds for essential expenses can be considered through an appropriate process, and provide your written decision and grievance escalation contact.
'''
    if purpose == 'follow_up':
        body += '\nThis is a follow-up to the contacts listed in my chronology. Please address the outstanding questions and provide a written update.\n'
    body += '\nYours faithfully,\n[Your name]\n[Your contact details]\n\nDraft prepared with FairHold+. Review all facts before sending. This is not legal advice.'
    return dict(subject=subject, body=body, generated_at=iso())


def chronology(case, events, status, attachments):
    # Bundle DejaVu with ReportLab if available, otherwise its built-in font is portable.
    font = 'Helvetica'
    for path in (Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
                 Path('C:/Windows/Fonts/arial.ttf')):
        if path.exists():
            if 'FairHold' not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont('FairHold', str(path)))
            font = 'FairHold'
            break
    styles = getSampleStyleSheet()
    for name in ('Normal', 'BodyText', 'Title', 'Heading1', 'Heading2', 'Heading3'):
        styles[name].fontName = font
    styles['BodyText'].fontSize = 9
    styles['BodyText'].leading = 14
    styles['BodyText'].spaceAfter = 7
    styles['Title'].textColor = colors.HexColor('#183c32')
    styles['Title'].alignment = TA_LEFT
    small = ParagraphStyle('Small', parent=styles['BodyText'], fontSize=8, leading=12, textColor=colors.HexColor('#52615c'))
    def p(value, style='BodyText'):
        return Paragraph(escape(str(value)).replace('\n', '<br/>'), styles[style] if isinstance(style, str) else style)
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, rightMargin=48, leftMargin=48,
                            topMargin=48, bottomMargin=52, title='FairHold+ account hold chronology', author='FairHold+')
    story = [p('FairHold+', 'Title'), p('Chronology of an account hold', 'Heading1'),
             p(f"Case {case['id']} | Generated {status['as_of']}", small),
             p(status['disclaimer'], small), Spacer(1, 8), p('Account and current status', 'Heading2')]
    facts = [('Bank', case['bank_name']), ('Account', f"{case['account_type']} / ending {case['account_last4'] or 'not recorded'}"),
             ('Hold', case['freeze_type'].replace('_', ' ')), ('Freeze date', case['freeze_date']),
             ('Amount held', money(case['amount_held_minor'])), ('Essential expenses', ', '.join(case['urgency']) or 'Not recorded'),
             ('Reason given', case['reason_given'] or 'Not recorded'), ('Status', status['state'].replace('_', ' ')),
             ('First contact (UTC)', status['first_contact_at'] or 'Not recorded'),
             ('Window deadline (India)', status['window_deadline'] or 'Not started'),
             ('Packet readiness', 'Ready under prototype policy' if status['escalation_ready'] else 'Not ready under prototype policy')]
    table = Table([[p(a, small), p(b)] for a, b in facts], colWidths=[140, 359])
    table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                               ('LINEBELOW', (0, 0), (-1, -1), .3, colors.HexColor('#dbe4df'))]))
    story.extend([table, Spacer(1, 12), p(status['window_basis'], small), p('Timeline - oldest first', 'Heading2'),
                  p('Times below are UTC. Entries are user records, not independently verified findings.', small)])
    for number, event in enumerate(events, 1):
        block = [p(f"{number:02d}. {event['type'].replace('_', ' ').title()} | {event['occurred_at']}", 'Heading3'),
                      p(event['summary']), p(f"Direction: {event['direction']} | Source: {event['source']} | Resolution recorded: {'Yes' if event['is_resolution'] else 'No'}", small)]
        if event['reference_number']:
            block.append(p('Reference: ' + event['reference_number']))
        if event['bank_statement']:
            block.append(p('The bank said: ' + event['bank_statement']))
        if event['attachment_ids']:
            block.append(p('Evidence IDs: ' + ', '.join(event['attachment_ids']), small))
        block.append(Spacer(1, 7))
        story.append(KeepTogether(block))
    if not events:
        story.append(p('No timeline events have been recorded.'))
    story.append(p('Attachment manifest', 'Heading2'))
    story.append(p('Original files are stored separately. This PDF lists them but does not embed them.', small))
    for a in attachments:
        story.append(p(f"{a['filename']} | {a['mime_type']} | {a['size_bytes']} bytes\nEvidence ID: {a['id']}", small))
    if not attachments:
        story.append(p('No files uploaded.', small))
    def footer(canvas, _):
        canvas.saveState()
        canvas.setFont(font, 8)
        canvas.setFillColor(colors.HexColor('#52615c'))
        canvas.drawString(48, 28, 'FairHold+ | Personal record | Not legal advice')
        canvas.drawRightString(A4[0] - 48, 28, f'Page {doc.page}')
        canvas.restoreState()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return out.getvalue()

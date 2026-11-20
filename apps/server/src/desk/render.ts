import type { RecapSummary } from '@ave/shared';
import type { RecapFacts, RecapProperty } from './facts.js';

/**
 * Renders the recap as a branded HTML email (inline styles, table layout for mail clients),
 * a plain-text email body and a short WhatsApp message. Facts only come from RecapFacts;
 * the AI summary, when present, is shown as its own clearly separate block.
 */

export const BRAND_NAME = 'Agora Virtual Estates';
/** Heading for what the human advisor promised; promises awaiting approval are never listed. */
const FOLLOW_UP_TITLE = 'What our team is following up on';
const SAMPLE_DATA_NOTE = 'Property details, prices and documents in this recap are sample data for a demonstration. Amounts are estimates.';

/** Brand tokens from the design system (BUILD_PLAN section 11). */
const C = {
  canvas: '#FFFFFF',
  paper: '#F6F8FB',
  ink: '#0E1726',
  inkSoft: '#5B6677',
  line: '#E6EAF0',
  blue: '#099DFD',
  blueDeep: '#0B6FD6',
  blueTint: '#E8F5FF',
  mint: '#1FC98E',
  mintTint: '#E3F8EF',
} as const;
const DISPLAY_FONT = "'Bricolage Grotesque', 'Plus Jakarta Sans', Arial, Helvetica, sans-serif";
const TEXT_FONT = "'Plus Jakarta Sans', Arial, Helvetica, sans-serif";

export interface RenderedRecap {
  subject: string;
  html: string;
  text: string;
  whatsapp: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const KIND_LABEL: Record<RecapProperty['kind'], string> = { sale: 'For sale', lease: 'For lease' };

export function recapSubject(facts: RecapFacts): string {
  return facts.visit ? `Your ${BRAND_NAME} recap and site visit on ${facts.visit.date}` : `Your ${BRAND_NAME} call recap`;
}

function emiSentence(p: RecapProperty): string | null {
  if (!p.emi) return null;
  const e = p.emi;
  return `${e.monthly} a month on a loan of ${e.loan} over ${e.tenureYears} years at ${e.ratePct}%, with ${e.downPayment} down.`;
}

function statedRows(facts: RecapFacts): { label: string; value: string }[] {
  const s = facts.stated;
  return [
    s.purpose ? { label: 'Looking for', value: s.purpose } : null,
    s.budget ? { label: 'Budget', value: s.budget } : null,
    s.timeline ? { label: 'Timeline', value: s.timeline } : null,
    s.needs.length ? { label: 'Must-haves', value: s.needs.join(', ') } : null,
  ].filter((r): r is { label: string; value: string } => r !== null);
}

/* ------------------------------------------------------------------ */
/* HTML email                                                          */
/* ------------------------------------------------------------------ */

const p = (text: string, style = '') => `<p style="margin:0 0 12px;font:400 15px/1.55 ${TEXT_FONT};color:${C.ink};${style}">${text}</p>`;
const eyebrow = (text: string, color: string = C.blueDeep) =>
  `<p style="margin:0 0 6px;font:700 12px/1.4 ${TEXT_FONT};color:${color};letter-spacing:0.06em;text-transform:uppercase;">${esc(text)}</p>`;

function rowsTable(rows: { label: string; value: string }[]): string {
  if (!rows.length) return '';
  const tr = rows
    .map(
      (r, i) => `<tr>
        <td style="padding:8px 0;${i ? `border-top:1px solid ${C.line};` : ''}font:400 14px/1.4 ${TEXT_FONT};color:${C.inkSoft};">${esc(r.label)}</td>
        <td align="right" style="padding:8px 0 8px 12px;${i ? `border-top:1px solid ${C.line};` : ''}font:700 14px/1.4 ${TEXT_FONT};color:${C.ink};">${esc(r.value)}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 12px;">${tr}</table>`;
}

function chips(items: string[]): string {
  return items
    .map(
      (i) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border:1.5px solid ${C.ink};border-radius:999px;background:${C.blueTint};font:600 12px/1.4 ${TEXT_FONT};color:${C.ink};">${esc(i)}</span>`,
    )
    .join('');
}

function propertyCard(prop: RecapProperty): string {
  const offers = prop.offers
    .map((o) => p(`<strong>${esc(o.title)}</strong> applied.${o.saving ? ` You save ${esc(o.saving)}.` : ''}`, `padding:10px 12px;border-radius:12px;background:${C.mintTint};`))
    .join('');
  const emi = emiSentence(prop);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:2px solid ${C.ink};border-radius:16px;background:${C.canvas};">
    <tr><td style="padding:20px 20px 8px;">
      ${eyebrow(`${KIND_LABEL[prop.kind]} · ${prop.locality}`)}
      <h2 style="margin:0 0 2px;font:700 21px/1.25 ${DISPLAY_FONT};color:${C.ink};">${esc(prop.name)}</h2>
      ${p(esc(prop.configuration), `color:${C.inkSoft};font-size:14px;`)}
      ${prop.viewsSeen.length ? `<div style="margin:0 0 10px;">${chips(prop.viewsSeen)}</div>` : ''}
      ${rowsTable(prop.rows)}
      ${offers}
      ${emi ? p(`<strong>EMI you discussed:</strong> ${esc(emi)}`, `padding:10px 12px;border-radius:12px;background:${C.blueTint};`) : ''}
      ${prop.estimateNote ? p(esc(prop.estimateNote), `font-size:12px;color:${C.inkSoft};`) : ''}
    </td></tr>
  </table>`;
}

function summaryBlock(summary: RecapSummary): string {
  const list = (title: string, items: string[]) =>
    items.length
      ? `${eyebrow(title, C.inkSoft)}<ul style="margin:0 0 12px;padding:0 0 0 18px;">${items
          .map((i) => `<li style="margin:0 0 4px;font:400 14px/1.5 ${TEXT_FONT};color:${C.ink};">${esc(i)}</li>`)
          .join('')}</ul>`
      : '';
  return `<tr><td style="padding:4px 32px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;background:${C.blueTint};">
      <tr><td style="padding:18px 20px 8px;">
        ${eyebrow('In short')}
        <h2 style="margin:0 0 8px;font:700 18px/1.3 ${DISPLAY_FONT};color:${C.ink};">${esc(summary.headline)}</h2>
        ${p(esc(summary.summary))}
        ${list('What matters to you', summary.priorities)}
        ${list('Still to answer', summary.openQuestions)}
      </td></tr>
    </table>
  </td></tr>`;
}

export function renderEmailHtml(facts: RecapFacts, summary: RecapSummary | null): string {
  const subject = recapSubject(facts);
  const intro = `Hi ${esc(facts.buyer.firstName)}, here is what you covered with ${esc(facts.advisorName)} on ${esc(facts.callDate)}${
    facts.humanAdvisor ? ` and ${esc(facts.humanAdvisor)} from our team` : ''
  }.`;
  const visit = facts.visit;
  const stated = statedRows(facts);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;">${esc(facts.nextStep)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.canvas};border:2px solid ${C.ink};border-radius:20px;">
  <tr><td style="padding:28px 32px 0;">
    <p style="margin:0;font:800 15px/1.2 ${DISPLAY_FONT};color:${C.ink};">${BRAND_NAME}</p>
    <div style="width:40px;height:4px;margin:8px 0 0;border-radius:2px;background:${C.blue};"></div>
  </td></tr>
  <tr><td style="padding:20px 32px 8px;">
    <h1 style="margin:0 0 10px;font:800 30px/1.15 ${DISPLAY_FONT};color:${C.ink};">Your call recap</h1>
    ${p(intro, `color:${C.inkSoft};`)}
  </td></tr>
  ${summary ? summaryBlock(summary) : ''}
  ${
    visit
      ? `<tr><td style="padding:8px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ${C.ink};border-left:8px solid ${C.mint};border-radius:16px;background:${C.mintTint};">
      <tr><td style="padding:18px 20px 8px;">
        ${eyebrow('Site visit booked', C.ink)}
        <h2 style="margin:0 0 4px;font:700 20px/1.25 ${DISPLAY_FONT};color:${C.ink};">${esc(visit.date)}</h2>
        ${p(`${esc(visit.time)} at ${esc(visit.propertyName)}`, 'margin-bottom:4px;font-weight:600;')}
        ${p(esc(visit.address), `color:${C.inkSoft};font-size:14px;`)}
        ${p('The calendar invite is attached to this email.', `font-size:13px;color:${C.inkSoft};`)}
      </td></tr>
    </table>
  </td></tr>`
      : ''
  }
  ${
    facts.properties.length
      ? `<tr><td style="padding:16px 32px 0;">
    ${eyebrow(facts.properties.length > 1 ? 'The properties you saw' : 'The property you saw', C.inkSoft)}
    ${facts.properties.map(propertyCard).join('')}
  </td></tr>`
      : ''
  }
  ${
    stated.length
      ? `<tr><td style="padding:8px 32px 0;">
    ${eyebrow('What you told us', C.inkSoft)}
    ${rowsTable(stated)}
  </td></tr>`
      : ''
  }
  ${
    facts.followUps.length
      ? `<tr><td style="padding:8px 32px 0;">
    ${eyebrow(FOLLOW_UP_TITLE, C.inkSoft)}
    <ul style="margin:0 0 12px;padding:0 0 0 18px;">${facts.followUps.map((f) => `<li style="margin:0 0 4px;font:400 14px/1.5 ${TEXT_FONT};color:${C.ink};">${esc(f)}</li>`).join('')}</ul>
  </td></tr>`
      : ''
  }
  <tr><td style="padding:8px 32px 20px;">
    ${eyebrow('Next step', C.inkSoft)}
    ${p(esc(facts.nextStep), 'font-weight:600;')}
  </td></tr>
  <tr><td style="padding:16px 32px 28px;border-top:1px solid ${C.line};">
    ${p(esc(SAMPLE_DATA_NOTE), `font-size:12px;color:${C.inkSoft};`)}
    ${p(`Sent by ${BRAND_NAME} after your call on ${esc(facts.callDate)}. <a href="${esc(facts.appUrl)}" style="color:${C.blueDeep};font-weight:700;">${esc(facts.appUrl.replace(/^https?:\/\//, ''))}</a>`, `font-size:12px;color:${C.inkSoft};margin:0;`)}
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Plain text email and WhatsApp                                       */
/* ------------------------------------------------------------------ */

export function renderEmailText(facts: RecapFacts, summary: RecapSummary | null): string {
  const out: string[] = [`Hi ${facts.buyer.firstName},`, '', `Here is what you covered with ${facts.advisorName} on ${facts.callDate}.`, ''];
  if (summary) out.push(summary.headline, summary.summary, '');
  if (facts.visit) {
    const v = facts.visit;
    out.push('SITE VISIT BOOKED', `${v.date}, ${v.time}`, `${v.propertyName}, ${v.address}`, 'The calendar invite is attached.', '');
  }
  for (const prop of facts.properties) {
    out.push(`${prop.name.toUpperCase()} (${KIND_LABEL[prop.kind]}, ${prop.locality})`, prop.configuration);
    if (prop.viewsSeen.length) out.push(`You looked at: ${prop.viewsSeen.join(', ')}`);
    for (const r of prop.rows) out.push(`${r.label}: ${r.value}`);
    for (const o of prop.offers) out.push(`${o.title} applied.${o.saving ? ` You save ${o.saving}.` : ''}`);
    const emi = emiSentence(prop);
    if (emi) out.push(`EMI you discussed: ${emi}`);
    if (prop.estimateNote) out.push(prop.estimateNote);
    out.push('');
  }
  const stated = statedRows(facts);
  if (stated.length) {
    out.push('WHAT YOU TOLD US');
    for (const r of stated) out.push(`${r.label}: ${r.value}`);
    out.push('');
  }
  if (facts.followUps.length) {
    out.push(FOLLOW_UP_TITLE.toUpperCase(), ...facts.followUps.map((f) => `- ${f}`), '');
  }
  out.push('NEXT STEP', facts.nextStep, '', SAMPLE_DATA_NOTE, `${BRAND_NAME} · ${facts.appUrl}`);
  return out.join('\n');
}

export function renderWhatsApp(facts: RecapFacts): string {
  const out: string[] = [`Hi ${facts.buyer.firstName}, here is your recap from ${BRAND_NAME}.`];
  for (const prop of facts.properties) {
    out.push('', `*${prop.name}* (${prop.configuration}, ${prop.locality})`);
    out.push(`${prop.headline.label}: ${prop.headline.value}`);
    for (const o of prop.offers) out.push(o.saving ? `${o.title} applied, saving ${o.saving}` : `${o.title} applied`);
    if (prop.emi) out.push(`EMI: ${prop.emi.monthly}/month, ${prop.emi.tenureYears} years at ${prop.emi.ratePct}%`);
  }
  // A booked visit is the next step, so it replaces the generic line.
  if (facts.visit) out.push('', `*Site visit:* ${facts.visit.date}, ${facts.visit.time}`, facts.visit.address);
  else out.push('', `Next: ${facts.nextStep}`);
  out.push('', '_Sample data for a demonstration. Amounts are estimates._');
  return out.join('\n');
}

export function renderRecap(facts: RecapFacts, summary: RecapSummary | null): RenderedRecap {
  return {
    subject: recapSubject(facts),
    html: renderEmailHtml(facts, summary),
    text: renderEmailText(facts, summary),
    whatsapp: renderWhatsApp(facts),
  };
}

const fs = require('fs');
const path = require('path');
const { parse, plain } = require('./markdown');
const { fill, fieldsFor, varsIn } = require('./variables');

// The document catalogue, and the one place a template is turned into drawable blocks.
//
// The five templates are designed to work together, in this order: a Master Agreement is
// signed once per client; a Service Schedule or a Statement of Work hangs off it per
// engagement; a Change Request amends a Statement of Work; and a Data Processing Agreement
// is added only where Complex AI processes personal information for the client.
//
// Kept free of pdfkit and supabase on purpose -- everything here is a pure function of the
// template files, so documents.test.js can check the whole content layer without I/O.

const DIR = path.join(__dirname, 'templates');

const TEMPLATES = [
  // Standalone: signed on its own, for one website deal, and defines its own payment,
  // liability, IP and termination terms rather than deferring to the Master Agreement.
  // It exists because 14 pages is the wrong document to put in front of a small business
  // buying one website -- the length is proportionate to a POS rollout, not a R7,500 site.
  // Never sign this AND the Master Agreement for the same piece of work.
  {
    slug: 'website-agreement',
    title: 'Website Agreement',
    short: 'Website Agreement',
    refPrefix: 'WA',
    file: 'websiteAgreement.md',
    standalone: true,
    blurb: 'One website, start to finish. Signed on its own when you convert a deal.',
  },
  {
    slug: 'master-agreement',
    title: 'Master Client Services Agreement',
    short: 'Master Agreement',
    refPrefix: 'MCA',
    file: 'masterAgreement.md',
    blurb: 'Signed once per client. Governs everything else.',
  },
  {
    slug: 'service-schedule',
    title: 'Website / SaaS Service Schedule',
    short: 'Service Schedule',
    refPrefix: 'SS',
    file: 'serviceSchedule.md',
    blurb: 'One ongoing service: website, SaaS, hosting or maintenance.',
  },
  {
    slug: 'statement-of-work',
    title: 'Statement of Work',
    short: 'Statement of Work',
    refPrefix: 'SOW',
    file: 'statementOfWork.md',
    blurb: 'One custom project: scope, milestones, acceptance.',
  },
  {
    slug: 'change-request',
    title: 'Change Request',
    short: 'Change Request',
    refPrefix: 'CR',
    file: 'changeRequest.md',
    blurb: 'Amends a Statement of Work. Stops scope creep.',
  },
  {
    slug: 'data-processing',
    title: 'POPIA Data Processing Agreement',
    short: 'Data Processing Agreement',
    refPrefix: 'DPA',
    file: 'dataProcessing.md',
    blurb: 'Only where personal information is processed for the client.',
  },
];

// Everything after this marker is the attorney review section, which belongs on a copy for
// review and never on a copy going to a client.
const NOTES_MARKER = '[[REVIEW-NOTES]]';
const REVIEW_CALLOUT = /ATTORNEY REVIEW REQUIRED/i;

const bySlug = (slug) => TEMPLATES.find((t) => t.slug === slug);

// ponytail: read per call rather than cached at require time. These are five small files
// and it means editing a clause shows up on the next generate without restarting the API.
function templateText(slug) {
  const template = bySlug(slug);
  if (!template) throw new Error(`Unknown document template: ${slug}`);
  return fs.readFileSync(path.join(DIR, template.file), 'utf8');
}

// The catalogue the admin form builds itself from. Fields come from scanning the template,
// so a clause that introduces a new {{VAR}} grows a form field with no other change.
function listTemplates() {
  return TEMPLATES.map((t) => {
    const text = templateText(t.slug);
    return { ...t, fields: fieldsFor(text), variables: varsIn(text) };
  });
}

// Template plus values in, drawable blocks out.
//
// reviewNotes controls which copy this is. With it on you get the review markers and the
// notes section -- the copy that goes to the attorney. With it off both are stripped, which
// is the copy that goes to the client: a client should not be reading our notes to counsel.
function documentBlocks(slug, { values = {}, settings = {}, reviewNotes = true } = {}) {
  const raw = templateText(slug);
  const main = reviewNotes ? raw.replace(NOTES_MARKER, '[[PAGEBREAK]]') : raw.split(NOTES_MARKER)[0];
  const blocks = parse(fill(main, values, settings));
  if (reviewNotes) return blocks;
  return blocks.filter((b) => !(b.type === 'callout' && REVIEW_CALLOUT.test(plain(b.runs))));
}

// "Master-Agreement-Acme-Pty-Ltd-2026-08-18.pdf" -- readable in a downloads folder and in
// an email attachment list, which is where these actually get filed.
function documentFilename(slug, values = {}) {
  const template = bySlug(slug);
  if (!template) throw new Error(`Unknown document template: ${slug}`);
  const client = String(values.CLIENT_LEGAL_NAME || values.CLIENT_NAME || '').trim();
  const slugify = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return [
    slugify(template.short),
    client ? slugify(client) : null,
    new Date().toISOString().slice(0, 10),
  ]
    .filter(Boolean)
    .join('-')
    .concat('.pdf');
}

module.exports = { TEMPLATES, bySlug, templateText, listTemplates, documentBlocks, documentFilename };

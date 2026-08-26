const { formatMoney, formatDate } = require('../lib/invoices');

// The single registry of every {{PLACEHOLDER}} the templates in ./templates may use.
//
// The form in the admin console is built by scanning a template for {{VARS}} and looking
// each one up here -- the field list is derived from the content, never maintained
// alongside it, so a clause added to a .md file cannot leave a field missing from the form.
// documents.test.js fails if a template uses a name this file does not define.
//
// `source` names an app_settings column: those are filled from the saved business details
// and never shown on the form. Everything else is typed per document.

const VARIABLES = {
  // --- Complex AI, from the single app_settings row -------------------------------
  // No hints here: these are filled from Settings and never rendered as form fields.
  COMPANY_NAME: { label: 'Business name', source: 'business_name' },
  COMPANY_LEGAL_NAME: { label: 'Legal name', source: 'legal_name' },
  COMPANY_ADDRESS: { label: 'Business address', source: 'address', type: 'textarea' },
  COMPANY_EMAIL: { label: 'Business email', source: 'email' },
  COMPANY_PHONE: { label: 'Business phone', source: 'phone' },
  COMPANY_TAX_NUMBER: { label: 'Tax number', source: 'tax_number' },

  // --- Client --------------------------------------------------------------------
  CLIENT_LEGAL_NAME: {
    label: 'Client legal name',
    hint: 'The registered name, exactly as CIPC has it, e.g. Acme Trading (Pty) Ltd. This is the party that is bound.',
  },
  CLIENT_NAME: {
    label: 'Client trading name',
    hint: 'The name they actually trade under. Same as the legal name if they never registered a different one.',
  },
  CLIENT_REG_NUMBER: {
    label: 'Client registration / ID number',
    hint: 'CIPC registration number for a company, or the ID number of the person signing if they trade as an individual.',
  },
  CLIENT_VAT_NUMBER: {
    label: 'Client VAT number',
    hint: 'Leave blank if they are not VAT registered. It prints as an empty cell on the client copy, which is correct.',
  },
  CLIENT_ADDRESS: {
    label: 'Client address',
    type: 'textarea',
    hint: 'Where legal notices are sent. A postal or trading address is fine. Type it over several lines; it prints on one inside the party table.',
  },
  CLIENT_EMAIL: {
    label: 'Client email',
    hint: 'Where notices under the agreement go. Use the address they actually read, not a generic info@ nobody checks.',
  },
  CLIENT_PHONE: { label: 'Client phone', hint: 'For the party table only. Notices go to the email address, not here.' },
  CLIENT_REPRESENTATIVE: {
    label: 'Client representative',
    hint: 'The person who signs for the client. Has to be someone with authority to bind the business.',
  },
  CLIENT_REP_CAPACITY: {
    label: 'Representative capacity',
    hint: 'What that person is to the business, e.g. Director, Member, Owner. It is what makes their signature binding.',
  },

  // --- Document metadata ---------------------------------------------------------
  DOCUMENT_REF: {
    label: 'Document reference',
    hint: 'Leave blank and one is generated: document, date and client, e.g. WA-20260824-ACMETR. Type your own only if you already file these some other way.',
  },
  DOCUMENT_VERSION: {
    label: 'Version',
    default: '1.0',
    hint: 'Bump this when you reissue a document after changes, so you and the client can tell two copies apart.',
  },
  EFFECTIVE_DATE: {
    label: 'Effective date',
    type: 'date',
    hint: 'The date the agreement starts to bind. It can differ from the signing date, but only backdate it if both sides know that is what you are doing.',
  },

  // --- Money and payment ---------------------------------------------------------
  // Payment timing is defined once, in the Master Agreement. The Schedule and the SOW
  // state amounts only and point back at it, so the documents cannot contradict each other.
  PAYMENT_TERMS: {
    label: 'Payment terms',
    default: '30 days from the date of invoice',
    hint: 'How long the client has to pay an invoice. Set once here and referenced by every other document. It is also the window for disputing an invoice.',
  },
  LATE_INTEREST_RATE: {
    label: 'Late payment interest',
    default: 'the prime rate plus 2% per annum',
    hint: 'What overdue amounts may be charged. The clause requires written notice before you actually charge it.',
  },
  SETUP_FEE: { label: 'Setup fee', type: 'money', hint: 'One-off fee, due on signature. Numbers only, no R.' },
  PROJECT_FEE: {
    label: 'Total project fee',
    type: 'money',
    hint: 'The whole price for the project, deposit included, not the balance. Numbers only, no R.',
  },
  DEPOSIT_AMOUNT: {
    label: 'Deposit',
    type: 'money',
    hint: 'Payable on signature, before work starts. Numbers only, no R.',
  },
  MONTHLY_FEE: { label: 'Monthly fee', type: 'money', hint: 'The recurring fee per month. Numbers only, no R.' },
  ANNUAL_FEE: {
    label: 'Annual fee',
    type: 'money',
    hint: 'Only where an annual term applies. Leave blank on month-to-month deals.',
  },
  HOURLY_RATE: {
    label: 'Rate for additional work',
    type: 'money',
    default: '250',
    hint: 'Charged for work outside the agreed scope, and only after an approved change request. Numbers only, no R.',
  },
  THIRD_PARTY_COSTS: {
    label: 'Third-party costs',
    type: 'textarea',
    hint: 'Hosting, domains and APIs recharged to the client. Anything you leave off this list you are absorbing.',
  },
  BILLING_FREQUENCY: {
    label: 'Billing frequency',
    default: 'Monthly in advance',
    hint: 'How often the fee is billed, and whether it is in advance or in arrears. In advance is what stops you funding their month.',
  },

  // --- Service -------------------------------------------------------------------
  SERVICE_TYPE: {
    label: 'Service type',
    hint: 'One line naming what this schedule covers, e.g. Website, SaaS subscription, Hosting.',
  },
  SERVICE_DESCRIPTION: {
    label: 'Description of services',
    type: 'textarea',
    hint: 'What you are actually providing, in plain terms. This is the clause a dispute gets read against, so be specific.',
  },
  DELIVERABLES: {
    label: 'Deliverables',
    type: 'textarea',
    hint: 'One per line. Each becomes a separate item the client accepts or rejects on its own.',
  },
  // Separate from DELIVERABLES on purpose, and the reason is the default below. On the
  // Service Schedule and the Statement of Work that placeholder sits under "Additional
  // deliverables agreed for this project" -- a shared default would quietly promise a
  // website build as extra work on a POS rollout. Here it means the whole build.
  WEBSITE_DELIVERABLES: {
    label: 'Deliverables',
    type: 'textarea',
    hint: 'What the client actually receives. The default is the standard website handover -- check it against what you really ship on this deal, because it is a promise, not a note.',
    default: [
      '- One Page Responsive Website',
      '- A contact form that sends to your email address',
      '- An SSL certificate, so the site loads securely over https',
      '- Basic on-page SEO: page titles, descriptions and a sitemap',
      '- Setup on the hosting named in clause 9',
    ].join('\n'),
  },
  SOFTWARE_NAME: {
    label: 'Software name',
    hint: 'The product the subscription is for, named the way the client knows it.',
  },
  SUBSCRIPTION_TIER: {
    label: 'Subscription tier',
    hint: 'Which plan they are on, e.g. Standard, Pro. Match what your pricing actually says.',
  },
  USER_LIMIT: {
    label: 'Number of users',
    hint: 'How many users or devices the fee covers. A number is worth far more here than the words "reasonable use".',
  },
  STORAGE_LIMIT: { label: 'Storage limit', hint: 'Included storage, e.g. 10 GB. Leave blank if there is no cap.' },
  USAGE_LIMITS: {
    label: 'Usage limits',
    type: 'textarea',
    hint: 'Anything else that is capped: transactions, API calls, emails. Whatever you do not cap here is uncapped.',
  },
  FEATURES_INCLUDED: {
    label: 'Features included',
    type: 'textarea',
    hint: 'One per line. Anything not on this list is not included in the fee.',
  },
  INTEGRATIONS: {
    label: 'Integrations',
    type: 'textarea',
    hint: 'Third-party systems you are connecting, one per line. Name them: "integrations as required" is unenforceable.',
  },
  HOSTING_PROVIDER: {
    label: 'Hosting provider',
    hint: 'Who it is actually hosted with, e.g. Vercel, Host Africa.',
  },
  HOSTING_TERMS: {
    label: 'Hosting arrangement',
    type: 'textarea',
    hint: 'What is included and what the limits are: traffic, storage, uptime, and who pays when they are exceeded.',
  },
  DOMAIN: { label: 'Domain name', hint: 'The domain this covers, with no http:// and no www.' },
  DOMAIN_TERMS: {
    label: 'Domain arrangement',
    type: 'textarea',
    hint: 'Who registers it, who renews it, who owns it, and what happens to it if the agreement ends.',
  },
  // Defaulted because it is the same answer on almost every website deal, and a blank here
  // is the clause a client is most likely to argue about later. Overwrite it per deal.
  MAINTENANCE_SCOPE: {
    label: 'Maintenance included',
    type: 'textarea',
    hint: 'What the monthly fee covers. The default is the usual website answer; overwrite it per deal, because this is the clause clients argue about later.',
    default: [
      '- Hosting, and keeping the site online',
      '- Security updates and patches',
      '- Regular backups',
      '- Fixing anything that breaks through no fault of yours',
      '- Small content changes, such as prices, opening hours, staff photos and contact details',
    ].join('\n'),
  },
  MAINTENANCE_LIMIT: {
    label: 'Maintenance limit',
    hint: 'Where the included work stops, e.g. 2 hours of content changes per month. Without a number, "small changes" means whatever they decide it means.',
  },
  SUPPORT_LEVEL: {
    label: 'Support level',
    hint: 'e.g. Standard business-hours support. Left blank, the Master Agreement falls back to reasonable endeavours charged at the hourly rate.',
  },
  SUPPORT_HOURS: {
    label: 'Support hours',
    default: 'Monday to Friday, 09:00 to 17:00 SAST, excluding public holidays',
    hint: 'Outside these hours nothing is promised. Name the timezone explicitly.',
  },
  SUPPORT_CHANNEL: {
    label: 'Support contact method',
    hint: 'How they are meant to reach you, e.g. email to support@... Name one channel, or requests arrive in four places.',
  },
  RESPONSE_TIME: {
    label: 'Target response time',
    hint: 'Time to first response, not to resolution. Do not promise a fix time here.',
  },
  BACKUP_FREQUENCY: {
    label: 'Backup frequency',
    hint: 'Leave blank if no backups are agreed. Do not state a frequency you are not actually running.',
  },
  SERVICE_LIMITATIONS: {
    label: 'Not included in this service',
    type: 'textarea',
    hint: 'One per line. Everything listed is chargeable as additional work, so this list is what keeps scope creep from being free.',
  },

  // --- Term ----------------------------------------------------------------------
  START_DATE: {
    label: 'Start date',
    type: 'date',
    hint: 'When the service or project actually starts. Often later than the effective date.',
  },
  END_DATE: {
    label: 'End date',
    type: 'date',
    hint: 'Fixed end date, if there is one. Leave blank where the term rolls on until someone cancels.',
  },
  INITIAL_TERM: {
    label: 'Initial term',
    hint: 'The minimum commitment, e.g. 12 months. Cancellation notice cannot cut this short.',
  },
  RENEWAL_TERM: {
    label: 'Renewal term',
    hint: 'What it becomes once the initial term ends, e.g. month to month.',
  },
  CANCELLATION_NOTICE: {
    label: 'Cancellation notice',
    default: '1 calendar month',
    hint: 'Notice to end one service or schedule. It expires at the end of a billing period, and fees already paid for that period are not refunded.',
  },
  TERMINATION_NOTICE: {
    label: 'Termination notice',
    default: '30 days',
    hint: 'Notice to end the Master Agreement itself. It cannot be used while a Service Schedule or Statement of Work is still running.',
  },

  // --- Project / SOW -------------------------------------------------------------
  PROJECT_NAME: {
    label: 'Project name',
    hint: 'What you both call this project. It is how the Statement of Work gets identified in later change requests.',
  },
  PROJECT_DESCRIPTION: {
    label: 'Project description',
    type: 'textarea',
    hint: 'A short factual summary of the work. The detail belongs in Scope, not here.',
  },
  PROJECT_OBJECTIVE: {
    label: 'Project objective',
    type: 'textarea',
    hint: 'What the client is trying to achieve, written for them rather than for you. It is what "done" gets judged against.',
  },
  PROJECT_MANAGER: {
    label: 'Client project manager',
    hint: 'The one person on their side who gives approvals. Naming one is what stops three people sending you conflicting instructions.',
  },
  COMPANY_REPRESENTATIVE: {
    label: 'Complex AI representative',
    // Defaulted because it is a one-person business and this is the answer every time.
    // Also the signature block's source for the pre-printed name -- see documentPdf.js.
    default: 'Jerrell Abrahams',
    hint: 'Who signs and is the contact on your side. Usually you.',
  },
  SCOPE: {
    label: 'Scope of work',
    type: 'textarea',
    hint: 'One item per line. If it is not on this list it is out of scope and chargeable.',
  },
  OUT_OF_SCOPE: {
    label: 'Explicitly out of scope',
    type: 'textarea',
    hint: 'One item per line. Worth filling in even though the scope list implies it: spelling out the obvious exclusions is what prevents the argument.',
  },
  FEATURES: {
    label: 'Features',
    type: 'textarea',
    hint: 'One per line, concrete enough that you can test whether each one is done.',
  },
  MILESTONES: {
    label: 'Milestones',
    type: 'textarea',
    hint: 'One per line, with a date where you have one. Payment points key off these.',
  },
  REVISION_ROUNDS: {
    label: 'Revision rounds included',
    default: '2',
    hint: 'Rounds of changes included per deliverable. Anything past this is charged at the additional-work rate.',
  },
  ACCEPTANCE_PERIOD: {
    label: 'Acceptance period',
    default: '7 business days',
    hint: 'How long the client has to test a deliverable and either accept it or send one list of defects. Once it lapses the deliverable counts as accepted.',
  },
  TARGET_COMPLETION_DATE: {
    label: 'Target completion date',
    type: 'date',
    hint: 'A target, not a deadline. No penalty attaches to it in these templates.',
  },
  DEPLOYMENT_DATE: {
    label: 'Target deployment date',
    type: 'date',
    hint: 'When it goes live. Leave blank if that depends on client sign-off you do not control.',
  },
  ASSUMPTIONS: {
    label: 'Assumptions',
    type: 'textarea',
    hint: 'One per line. When an assumption turns out to be wrong, this is what a change request points back at.',
  },
  DEPENDENCIES: {
    label: 'Dependencies',
    type: 'textarea',
    hint: 'What you need from the client or a third party before you can finish: content, access, API keys, hosting.',
  },
  RISKS: {
    label: 'Known risks',
    type: 'textarea',
    hint: 'One per line. Naming a risk here is cheaper than discovering it mid-project with nothing in writing.',
  },
  IP_TERMS: {
    label: 'Project-specific IP terms',
    type: 'textarea',
    hint: 'Leave blank to rely on the Master Agreement. Only fill this in where this project departs from it.',
  },

  // --- Change request ------------------------------------------------------------
  CR_NUMBER: {
    label: 'Change request number',
    hint: 'Sequential per project, e.g. 001. Change requests get referred to by number later.',
  },
  CR_DATE: {
    label: 'Change request date',
    type: 'date',
    hint: 'The date the change was requested, not the date you got round to writing it up.',
  },
  REQUESTED_CHANGE: {
    label: 'Requested change',
    type: 'textarea',
    hint: 'What the client is asking for, in their words. Quote them where you can.',
  },
  CHANGE_REASON: {
    label: 'Reason for the change',
    type: 'textarea',
    hint: 'Why they are asking. It is what justifies the extra cost when they read this again in three months.',
  },
  SCOPE_IMPACT: {
    label: 'Impact on scope',
    type: 'textarea',
    hint: 'What this adds to, or removes from, the original scope.',
  },
  ADDITIONAL_DELIVERABLES: {
    label: 'Additional deliverables',
    type: 'textarea',
    hint: 'One per line, new items only. Do not repeat what the Statement of Work already covers.',
  },
  ADDITIONAL_DEVELOPMENT: {
    label: 'Additional development required',
    type: 'textarea',
    hint: 'The work itself: what you are building or changing to deliver this.',
  },
  ORIGINAL_PROJECT_FEE: {
    label: 'Original project fee',
    type: 'money',
    hint: 'The fee from the original Statement of Work, before this change. Numbers only, no R.',
  },
  ADDITIONAL_COST: {
    label: 'Additional cost',
    type: 'money',
    hint: 'What this change costs on its own. Numbers only, no R.',
  },
  NEW_PROJECT_TOTAL: {
    label: 'New project total',
    type: 'money',
    hint: 'Original fee plus the additional cost. Nothing adds this up for you.',
  },
  ORIGINAL_COMPLETION_DATE: {
    label: 'Original completion date',
    type: 'date',
    hint: 'The date from the Statement of Work, so the shift is visible on the page.',
  },
  NEW_COMPLETION_DATE: {
    label: 'New estimated completion date',
    type: 'date',
    hint: 'The revised date once this change is included.',
  },
  CHANGE_DEPENDENCIES: {
    label: 'Dependencies for this change',
    type: 'textarea',
    hint: 'Anything this change needs that the original project did not.',
  },
  EXISTING_FEATURE_IMPACT: {
    label: 'Impact on existing features',
    type: 'textarea',
    hint: 'What already-built work this touches or breaks. Write "none" if nothing.',
  },

  // --- POPIA / data processing ---------------------------------------------------
  PROCESSING_PURPOSE: {
    label: 'Purpose of processing',
    type: 'textarea',
    hint: 'Why you process their personal information at all. POPIA holds you to this purpose, so keep it accurate rather than broad.',
  },
  PI_CATEGORIES: {
    label: 'Categories of personal information',
    type: 'textarea',
    hint: 'One per line: names, ID numbers, contact details, payment details. Categories, not the data itself.',
  },
  DATA_SUBJECTS: {
    label: 'Categories of data subjects',
    type: 'textarea',
    hint: 'One per line: whose information this is. Usually their customers, staff or suppliers.',
  },
  PROCESSING_ACTIVITIES: {
    label: 'Processing activities',
    type: 'textarea',
    hint: 'One per line: what you do with it. Storing, hosting, backing up, displaying.',
  },
  SUBPROCESSORS: {
    label: 'Sub-operators',
    type: 'textarea',
    hint: 'One per line: name, service, where it processes data. Anyone whose systems touch the data counts, hosting included.',
  },
  DATA_LOCATIONS: {
    label: 'Where data is processed',
    type: 'textarea',
    hint: 'Name the countries or regions if known. Cross-border transfer is the part POPIA cares about here.',
  },
  RETENTION_PERIOD: {
    label: 'Retention period',
    hint: 'How long data is kept after termination, and what happens to it then.',
  },
  SECURITY_ADDITIONS: {
    label: 'Additional security measures',
    type: 'textarea',
    hint: 'Only list what is actually in place. Promising a control you do not have is worse than listing nothing.',
  },

  // --- Legal ---------------------------------------------------------------------
  GOVERNING_LAW: {
    label: 'Governing law',
    default: 'the Republic of South Africa',
    hint: 'Whose law the agreement runs under. Leave the default unless the client sits outside South Africa.',
  },
  MEDIATION_BODY: {
    label: 'Mediation body',
    hint: 'Who mediates before anyone litigates, e.g. an accredited mediator agreed between the parties.',
  },
};

// What an unfilled placeholder becomes on the REVIEW copy: a visible gap you and your
// attorney can spot, rather than a sentence that quietly reads as though it were finished.
//
// The client copy passes '' instead (see documentBlocks). Several fields are meant to end
// up empty -- a client who is not VAT registered, a deal with no backups agreed -- and
// printing [________] against those states a value is missing when none was ever due.
const BLANK = '[________]';

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

// One table cell, with the wreckage of a blanked value cleared: empty parentheses dropped,
// and an "a · b" pair rejoined around whichever half survived. Pipes are never touched, so
// the row still parses as a table.
const tidyCell = (cell) => {
  const parts = cell
    .replace(/\s*\(\s*\)/g, '')
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? ` ${parts.join(' · ')} ` : ' ';
};

// Every {{VAR}} a template uses, in first-appearance order, deduplicated.
function varsIn(text) {
  return [...new Set(Array.from(String(text).matchAll(PLACEHOLDER), (m) => m[1]))];
}

// Money and dates are typed as plain numbers and ISO dates in the form, and printed the
// same way the invoices print them. A value that will not parse is passed through
// untouched -- "on acceptance" is a legitimate thing to write in a payment column.
function display(name, value) {
  const { type } = VARIABLES[name] || {};
  const raw = String(value).trim();
  if (type === 'money' && raw !== '' && !Number.isNaN(Number(raw))) return formatMoney(raw);
  if (type === 'date' && !Number.isNaN(Date.parse(raw))) return formatDate(raw);
  return raw;
}

function resolve(name, values, settings, blank = BLANK) {
  const spec = VARIABLES[name];
  const value = spec && spec.source ? settings[spec.source] : values[name];
  if (value === undefined || value === null || String(value).trim() === '') {
    // Through display() as well, not returned raw: a `money` default is stored as '250' the
    // same way a typed one is, and skipping the formatter prints "250" against a column
    // where every other figure reads "R 250,00". Prose defaults pass through untouched.
    return spec && spec.default ? display(name, spec.default) : blank;
  }
  return display(name, value);
}

// Substitution happens before parsing, so a multi-line value expands into real markdown
// blocks -- which is what you want for {{SCOPE}} and {{DELIVERABLES}}.
//
// Inside a table it is what you least want. A table row is one line by definition, so a
// three-line address dropped into a cell ends the table at line one and orphans every row
// below it into a loose paragraph. That is not hypothetical: every party table in these
// documents has an address cell, and addresses are normally typed over several lines.
// Values landing in a table row are therefore flattened onto one.
function fill(text, values = {}, settings = {}, blank = BLANK) {
  return String(text)
    .split('\n')
    .map((line) => {
      const inTableRow = line.trim().startsWith('|');
      const filled = line.replace(PLACEHOLDER, (_, name) => {
        const out = resolve(name, values, settings, blank);
        return inTableRow ? out.replace(/\s*\n+\s*/g, ', ') : out;
      });
      // Blanking a value leaves the punctuation that framed it. The party table writes
      // "{{CLIENT_REPRESENTATIVE}} ({{CLIENT_REP_CAPACITY}})" and "{{CLIENT_EMAIL}} ·
      // {{CLIENT_PHONE}}", so a client with no phone gets a trailing bullet and one with no
      // stated capacity gets "Jane Doe ()". Both shapes only occur in table cells, and only
      // the client copy blanks anything, so the tidy is scoped to both.
      return blank === '' && inTableRow ? filled.replace(/[^|]+/g, tidyCell) : filled;
    })
    .join('\n');
}

// The form field list for a template: everything it references except the business details,
// which come from Settings. An unregistered name still surfaces, so the test can fail on it.
function fieldsFor(text) {
  return varsIn(text)
    .filter((name) => !(VARIABLES[name] && VARIABLES[name].source))
    .map((name) => ({
      name,
      label: (VARIABLES[name] && VARIABLES[name].label) || name,
      type: (VARIABLES[name] && VARIABLES[name].type) || 'text',
      hint: (VARIABLES[name] && VARIABLES[name].hint) || '',
      default: (VARIABLES[name] && VARIABLES[name].default) || '',
    }));
}

module.exports = { VARIABLES, BLANK, varsIn, fill, fieldsFor, display };

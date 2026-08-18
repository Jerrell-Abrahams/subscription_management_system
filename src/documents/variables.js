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
  COMPANY_NAME: { label: 'Business name', source: 'business_name' },
  COMPANY_LEGAL_NAME: { label: 'Legal name', source: 'legal_name' },
  COMPANY_ADDRESS: { label: 'Business address', source: 'address', type: 'textarea' },
  COMPANY_EMAIL: { label: 'Business email', source: 'email' },
  COMPANY_PHONE: { label: 'Business phone', source: 'phone' },
  COMPANY_TAX_NUMBER: { label: 'Tax number', source: 'tax_number' },

  // --- Client --------------------------------------------------------------------
  CLIENT_LEGAL_NAME: { label: 'Client legal name', hint: 'Registered name, e.g. Acme Trading (Pty) Ltd' },
  CLIENT_NAME: { label: 'Client trading name' },
  CLIENT_REG_NUMBER: { label: 'Client registration / ID number' },
  CLIENT_VAT_NUMBER: { label: 'Client VAT number', hint: 'Leave blank if not registered' },
  CLIENT_ADDRESS: { label: 'Client address', type: 'textarea' },
  CLIENT_EMAIL: { label: 'Client email' },
  CLIENT_PHONE: { label: 'Client phone' },
  CLIENT_REPRESENTATIVE: { label: 'Client representative' },
  CLIENT_REP_CAPACITY: { label: 'Representative capacity', hint: 'e.g. Director, Member, Owner' },

  // --- Document metadata ---------------------------------------------------------
  DOCUMENT_REF: { label: 'Document reference', hint: 'e.g. MCA-2026-0001' },
  DOCUMENT_VERSION: { label: 'Version', default: '1.0' },
  EFFECTIVE_DATE: { label: 'Effective date', type: 'date' },

  // --- Money and payment ---------------------------------------------------------
  // Payment timing is defined once, in the Master Agreement. The Schedule and the SOW
  // state amounts only and point back at it, so the documents cannot contradict each other.
  PAYMENT_TERMS: { label: 'Payment terms', default: '30 days from the date of invoice' },
  LATE_INTEREST_RATE: { label: 'Late payment interest', default: 'the prime rate plus 2% per annum' },
  SETUP_FEE: { label: 'Setup fee', type: 'money' },
  PROJECT_FEE: { label: 'Total project fee', type: 'money' },
  DEPOSIT_AMOUNT: { label: 'Deposit', type: 'money' },
  MONTHLY_FEE: { label: 'Monthly fee', type: 'money' },
  ANNUAL_FEE: { label: 'Annual fee', type: 'money' },
  HOURLY_RATE: { label: 'Rate for additional work', type: 'money' },
  THIRD_PARTY_COSTS: { label: 'Third-party costs', type: 'textarea', hint: 'Hosting, domains, APIs recharged to the client' },
  BILLING_FREQUENCY: { label: 'Billing frequency', default: 'Monthly in advance' },

  // --- Service -------------------------------------------------------------------
  SERVICE_TYPE: { label: 'Service type', hint: 'e.g. Website, SaaS subscription, Hosting' },
  SERVICE_DESCRIPTION: { label: 'Description of services', type: 'textarea' },
  DELIVERABLES: { label: 'Deliverables', type: 'textarea', hint: 'One per line' },
  SOFTWARE_NAME: { label: 'Software name' },
  SUBSCRIPTION_TIER: { label: 'Subscription tier' },
  USER_LIMIT: { label: 'Number of users' },
  STORAGE_LIMIT: { label: 'Storage limit' },
  USAGE_LIMITS: { label: 'Usage limits', type: 'textarea' },
  FEATURES_INCLUDED: { label: 'Features included', type: 'textarea', hint: 'One per line' },
  INTEGRATIONS: { label: 'Integrations', type: 'textarea' },
  HOSTING_PROVIDER: { label: 'Hosting provider' },
  HOSTING_TERMS: { label: 'Hosting arrangement', type: 'textarea', hint: 'What is included, and what the limits are' },
  DOMAIN: { label: 'Domain name' },
  DOMAIN_TERMS: { label: 'Domain arrangement', type: 'textarea', hint: 'Who registers, who renews, who owns it' },
  // Defaulted because it is the same answer on almost every website deal, and a blank here
  // is the clause a client is most likely to argue about later. Overwrite it per deal.
  MAINTENANCE_SCOPE: {
    label: 'Maintenance included',
    type: 'textarea',
    default: [
      '- Hosting, and keeping the site online',
      '- Security updates and patches',
      '- Regular backups',
      '- Fixing anything that breaks through no fault of yours',
      '- Small content changes, such as prices, opening hours, staff photos and contact details',
    ].join('\n'),
  },
  MAINTENANCE_LIMIT: { label: 'Maintenance limit', hint: 'e.g. 2 hours of content changes per month' },
  SUPPORT_LEVEL: { label: 'Support level', hint: 'e.g. Standard business-hours support' },
  SUPPORT_HOURS: { label: 'Support hours', default: 'Monday to Friday, 09:00 to 17:00 SAST, excluding public holidays' },
  SUPPORT_CHANNEL: { label: 'Support contact method', hint: 'e.g. email to support@...' },
  RESPONSE_TIME: { label: 'Target response time', hint: 'Time to first response, not to resolution' },
  BACKUP_FREQUENCY: { label: 'Backup frequency', hint: 'Leave blank if no backups are agreed' },
  SERVICE_LIMITATIONS: { label: 'Not included in this service', type: 'textarea' },

  // --- Term ----------------------------------------------------------------------
  START_DATE: { label: 'Start date', type: 'date' },
  END_DATE: { label: 'End date', type: 'date' },
  INITIAL_TERM: { label: 'Initial term', hint: 'e.g. 12 months' },
  RENEWAL_TERM: { label: 'Renewal term', hint: 'e.g. month to month' },
  CANCELLATION_NOTICE: { label: 'Cancellation notice', default: '1 calendar month' },
  TERMINATION_NOTICE: { label: 'Termination notice', default: '30 days' },

  // --- Project / SOW -------------------------------------------------------------
  PROJECT_NAME: { label: 'Project name' },
  PROJECT_DESCRIPTION: { label: 'Project description', type: 'textarea' },
  PROJECT_OBJECTIVE: { label: 'Project objective', type: 'textarea' },
  PROJECT_MANAGER: { label: 'Client project manager' },
  COMPANY_REPRESENTATIVE: { label: 'Complex AI representative' },
  SCOPE: { label: 'Scope of work', type: 'textarea', hint: 'One item per line' },
  OUT_OF_SCOPE: { label: 'Explicitly out of scope', type: 'textarea', hint: 'One item per line' },
  FEATURES: { label: 'Features', type: 'textarea', hint: 'One per line' },
  MILESTONES: { label: 'Milestones', type: 'textarea', hint: 'One per line' },
  REVISION_ROUNDS: { label: 'Revision rounds included', default: '2' },
  ACCEPTANCE_PERIOD: { label: 'Acceptance period', default: '7 business days' },
  TARGET_COMPLETION_DATE: { label: 'Target completion date', type: 'date' },
  DEPLOYMENT_DATE: { label: 'Target deployment date', type: 'date' },
  ASSUMPTIONS: { label: 'Assumptions', type: 'textarea', hint: 'One per line' },
  DEPENDENCIES: { label: 'Dependencies', type: 'textarea', hint: 'Client, third-party, API and hosting dependencies' },
  RISKS: { label: 'Known risks', type: 'textarea', hint: 'One per line' },
  IP_TERMS: { label: 'Project-specific IP terms', type: 'textarea', hint: 'Leave blank to rely on the Master Agreement' },

  // --- Change request ------------------------------------------------------------
  CR_NUMBER: { label: 'Change request number', hint: 'e.g. 001' },
  CR_DATE: { label: 'Change request date', type: 'date' },
  REQUESTED_CHANGE: { label: 'Requested change', type: 'textarea' },
  CHANGE_REASON: { label: 'Reason for the change', type: 'textarea' },
  SCOPE_IMPACT: { label: 'Impact on scope', type: 'textarea' },
  ADDITIONAL_DELIVERABLES: { label: 'Additional deliverables', type: 'textarea', hint: 'One per line' },
  ADDITIONAL_DEVELOPMENT: { label: 'Additional development required', type: 'textarea' },
  ORIGINAL_PROJECT_FEE: { label: 'Original project fee', type: 'money' },
  ADDITIONAL_COST: { label: 'Additional cost', type: 'money' },
  NEW_PROJECT_TOTAL: { label: 'New project total', type: 'money' },
  ORIGINAL_COMPLETION_DATE: { label: 'Original completion date', type: 'date' },
  NEW_COMPLETION_DATE: { label: 'New estimated completion date', type: 'date' },
  CHANGE_DEPENDENCIES: { label: 'Dependencies for this change', type: 'textarea' },
  EXISTING_FEATURE_IMPACT: { label: 'Impact on existing features', type: 'textarea' },

  // --- POPIA / data processing ---------------------------------------------------
  PROCESSING_PURPOSE: { label: 'Purpose of processing', type: 'textarea' },
  PI_CATEGORIES: { label: 'Categories of personal information', type: 'textarea', hint: 'One per line' },
  DATA_SUBJECTS: { label: 'Categories of data subjects', type: 'textarea', hint: 'One per line' },
  PROCESSING_ACTIVITIES: { label: 'Processing activities', type: 'textarea', hint: 'One per line' },
  SUBPROCESSORS: { label: 'Sub-operators', type: 'textarea', hint: 'One per line: name, service, where it processes data' },
  DATA_LOCATIONS: { label: 'Where data is processed', type: 'textarea', hint: 'Name the countries or regions if known' },
  RETENTION_PERIOD: { label: 'Retention period', hint: 'How long data is kept after termination' },
  SECURITY_ADDITIONS: { label: 'Additional security measures', type: 'textarea', hint: 'Only list what is actually in place' },

  // --- Legal ---------------------------------------------------------------------
  GOVERNING_LAW: { label: 'Governing law', default: 'the Republic of South Africa' },
  COURT_JURISDICTION: { label: 'Court jurisdiction', hint: 'Confirm with your attorney before relying on this' },
  MEDIATION_BODY: { label: 'Mediation body', hint: 'e.g. an accredited mediator agreed between the parties' },
};

// What an unfilled placeholder becomes. Never an empty string: a half-completed contract
// must print as a form with visible blanks, not as a sentence with a hole in it.
const BLANK = '[________]';

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

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

function resolve(name, values, settings) {
  const spec = VARIABLES[name];
  const value = spec && spec.source ? settings[spec.source] : values[name];
  if (value === undefined || value === null || String(value).trim() === '') {
    return spec && spec.default ? spec.default : BLANK;
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
function fill(text, values = {}, settings = {}) {
  return String(text)
    .split('\n')
    .map((line) => {
      const inTableRow = line.trim().startsWith('|');
      return line.replace(PLACEHOLDER, (_, name) => {
        const out = resolve(name, values, settings);
        return inTableRow ? out.replace(/\s*\n+\s*/g, ', ') : out;
      });
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

// Bulk-import a day's cold calls that were tracked on paper/WhatsApp before the Leads
// tab existed. Edit CALL_DATE + CALLS below and re-run for a new batch.
//
//   node scripts/import-call-log.js            # dry run, prints what it would write
//   node scripts/import-call-log.js --commit   # actually writes
//
// Safe to re-run: a lead is matched by name, and a lead that already has an activity
// logged on CALL_DATE is skipped rather than double-counted (which would inflate the
// weekly goal numbers this whole feature exists to report on).

require('dotenv').config();
const supabase = require('../src/config/supabase');
const { statusForOutcome } = require('../src/lib/leads');

const CALL_DATE = '2026-08-07'; // Friday
const CATEGORY = 'websites';
const METHOD = 'cold_call';

// `note` keeps the original wording -- the mapped outcome is lossy ("Call Sonja on
// Tuesday" and "Call Tuesday" both become follow_up, but only one names a contact).
const CALLS = [
  // --- Doctors ---
  { name: 'Harmony Health Centre', industry: 'Doctors', outcome: 'potential', note: 'Sent Demo' },
  { name: 'Dr Pieter Brune', industry: 'Doctors', outcome: 'potential', note: 'Sent Email' },
  { name: 'Dr Dawie van Staden', industry: 'Doctors', outcome: 'not_interested', note: 'Has website' },
  { name: 'ALFRED LE CLUS', industry: 'Doctors', outcome: 'no_answer', note: 'Not open' },
  { name: 'Dr CF Kruger', industry: 'Doctors', outcome: 'not_interested', note: 'Not interested' },
  { name: 'Dr RB Dyason', industry: 'Doctors', outcome: 'not_interested', note: 'Has website' },
  { name: 'Drs Van Niekerk GJ & Alessandrini RA', industry: 'Doctors', outcome: 'follow_up', followUpDate: '2026-08-11', note: 'Call Sonja on Tuesday' },
  { name: 'Dr Van Der Walt Charl', industry: 'Doctors', outcome: 'not_interested', note: 'Not interested' },
  { name: 'Dr A van der Vyver', industry: 'Doctors', outcome: 'not_interested', note: 'Working on one' },
  { name: 'Dr Lawrence de Villiers', industry: 'Doctors', outcome: 'no_answer', note: 'No answer' },
  { name: 'Steyn M', industry: 'Doctors', outcome: 'not_interested', note: 'Not interested' },

  // --- Dentists ---
  { name: 'Touch Dental Studio', industry: 'Dentist', outcome: 'not_interested', note: 'Not interested' },
  { name: 'Dr. Bhula H M', industry: 'Dentist', outcome: 'not_interested', note: 'Not interested' },
  { name: 'Noeleen White', industry: 'Dentist', outcome: 'not_interested', note: 'Not interested' },
  { name: 'The Dental Junction', industry: 'Dentist', outcome: 'no_answer', note: 'No answer' },
  { name: 'Dr H D Delport', industry: 'Dentist', outcome: 'not_interested', note: 'Not interested' },

  // --- Auto repair ---
  { name: 'MOOLMANS AUTO ELECTRICAL', industry: 'Auto Repair', outcome: 'follow_up', followUpDate: '2026-08-11', note: 'Call on Tuesday' },

  // --- Funerals ---
  { name: 'PYRAMID FUNERAL PARLOUR', industry: 'Funerals', outcome: 'follow_up', followUpDate: '2026-08-11', note: 'Go to them Tuesday (visit in person)' },
  { name: 'Sincere Funeral Services Cc', industry: 'Funerals', outcome: 'not_interested', note: 'In development (someone else building theirs)' },
  { name: 'S.A funerals germiston', industry: 'Funerals', outcome: 'follow_up', followUpDate: '2026-08-11', note: 'Call Tuesday' },
  { name: 'GP Funeral Service', industry: 'Funerals', outcome: 'not_interested', note: 'In development (someone else building theirs)' },
];

const commit = process.argv.includes('--commit');
// Midday local-ish rather than midnight, so the timestamp reads as a working hour and
// can't slip to the previous day under a timezone shift.
const occurredAt = new Date(`${CALL_DATE}T12:00:00Z`).toISOString();

async function findLeadByName(name) {
  const { data } = await supabase.from('leads').select('id, name').ilike('name', name).maybeSingle();
  return data;
}

async function alreadyLogged(leadId) {
  const { count } = await supabase
    .from('lead_activities')
    .select('*', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .gte('occurred_at', `${CALL_DATE}T00:00:00Z`)
    .lt('occurred_at', `${CALL_DATE}T23:59:59Z`);
  return (count || 0) > 0;
}

async function main() {
  console.log(`${commit ? 'IMPORTING' : 'DRY RUN'} — ${CALLS.length} calls on ${CALL_DATE}, category "${CATEGORY}"\n`);

  const tally = {};
  let created = 0;
  let skipped = 0;

  for (const call of CALLS) {
    const status = statusForOutcome(call.outcome);
    if (!status) {
      console.log(`  !! ${call.name}: unknown outcome "${call.outcome}" — skipped`);
      continue;
    }
    tally[call.outcome] = (tally[call.outcome] || 0) + 1;

    if (!commit) {
      console.log(`  ${call.name.padEnd(38)} ${call.outcome.padEnd(15)} -> ${status}${call.followUpDate ? ` (due ${call.followUpDate})` : ''}`);
      continue;
    }

    let lead = await findLeadByName(call.name);

    if (lead && (await alreadyLogged(lead.id))) {
      console.log(`  = ${call.name} — already has a ${CALL_DATE} activity, skipped`);
      skipped += 1;
      continue;
    }

    if (!lead) {
      const { data, error } = await supabase
        .from('leads')
        .insert({
          name: call.name,
          industry: call.industry,
          category: CATEGORY,
          status,
          follow_up_date: call.followUpDate || null,
          notes: call.note,
          created_at: occurredAt,
        })
        .select('id')
        .single();
      if (error) {
        console.log(`  !! ${call.name}: ${error.message}`);
        continue;
      }
      lead = data;
      created += 1;
    } else {
      await supabase
        .from('leads')
        .update({ status, follow_up_date: call.followUpDate || null, category: CATEGORY, updated_at: occurredAt })
        .eq('id', lead.id);
    }

    const { error: actError } = await supabase.from('lead_activities').insert({
      lead_id: lead.id,
      method: METHOD,
      outcome: call.outcome,
      category: CATEGORY,
      note: call.note,
      occurred_at: occurredAt,
    });
    if (actError) {
      console.log(`  !! ${call.name} activity: ${actError.message}`);
      continue;
    }

    console.log(`  + ${call.name.padEnd(38)} ${call.outcome} -> ${status}`);
  }

  console.log('\n--- outcome tally ---');
  Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .forEach(([outcome, n]) => console.log(`  ${outcome.padEnd(16)} ${n}`));

  if (commit) {
    console.log(`\nleads created: ${created} | already logged, skipped: ${skipped}`);
  } else {
    console.log('\nNothing written. Re-run with --commit to import.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

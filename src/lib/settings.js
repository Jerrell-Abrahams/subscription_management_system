const supabase = require('../config/supabase');

// The single app_settings row, seeded by src/db/settings.sql.
//
// Returns {} rather than throwing when the row or table is missing: a PDF with blank
// business details is a visible problem the admin can fix in one screen, whereas a 500
// on send is an invoice that silently never got raised.
async function loadSettings() {
  const { data, error } = await supabase.from('app_settings').select('*').maybeSingle();
  if (error) {
    console.error('[settings] could not load business details:', error.message);
    return {};
  }
  return data || {};
}

module.exports = { loadSettings };

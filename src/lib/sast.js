// SAST is a fixed UTC+2 with no DST, so resolving a moment to its South African calendar
// day is safe to do with a fixed IANA zone rather than hand-rolled offset math.
const SAST_TZ = 'Africa/Johannesburg';

// 'en-CA' is the ISO-shaped locale (YYYY-MM-DD), so this is the SAST calendar day as a
// sortable string -- not a UTC one. Handing a Date to toISOString() instead would read the
// wrong day for two hours after each SAST midnight (22:00-23:59 UTC), which is exactly what
// this file exists to avoid: reference numbers, filenames and signed-on dates were doing
// that before this was pulled out.
const sastDay = (date) => date.toLocaleDateString('en-CA', { timeZone: SAST_TZ });

// A Date good for LOCAL-timezone display of "today" in SAST. Noon keeps it inside the
// correct calendar day for any runtime offset from -12 to +14, so formatDate() (which reads
// the server's own zone, UTC on Vercel) still prints the SAST date regardless of what time
// zone actually renders it.
const sastNow = () => new Date(`${sastDay(new Date())}T12:00:00`);

module.exports = { SAST_TZ, sastDay, sastNow };

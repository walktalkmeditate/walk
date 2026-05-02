/* walk.lc — cadence + .ics generation.
   Computes the next walk date from a city's cadence rule and generates the
   calendar download on the fly so the page never goes stale.

   Cadence rule shape (in #city-data):
     { pattern: "second-saturday", time: "08:00", tz: "America/Chicago",
       recurrenceCount: 3, effectiveFrom: "2026-06-01" }
     pattern:         "{first|second|third|fourth|last}-{sunday|monday|...|saturday}"
     recurrenceCount: how many future walks the .ics emits as RRULE COUNT (default 3)
     effectiveFrom:   optional ISO date (YYYY-MM-DD). If set, the next walk is
                      never earlier than this date — used when a city's cadence
                      changes and we want to skip to the next valid month.

   Auto-init at DOMContentLoaded:
     [data-cadence-next]      → text content replaced with "Next: Saturday, June 13 — 8 AM CDT"
     [data-cadence-ics]       → click intercepted, dynamic .ics built from current next-walk
*/

(function() {

  const ORD_MAP = { first: 1, second: 2, third: 3, fourth: 4, last: 'last' };
  const DAY_MAP = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  };
  const DAY_NAME   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAY_CODE   = ['SU','MO','TU','WE','TH','FR','SA'];
  const MONTH_NAME = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const DEFAULT_RRULE_COUNT = 3;

  function parsePattern(pattern) {
    const m = /^([a-z]+)-([a-z]+)$/.exec(pattern || '');
    if (!m) return null;
    const ord = ORD_MAP[m[1]];
    const dow = DAY_MAP[m[2]];
    if (ord == null || dow == null) return null;
    return { ord, dow };
  }

  // Day-of-month for nth occurrence of dow in (year, month). month is 1-12.
  function nthWeekdayOfMonth(year, month, ord, dow) {
    if (ord === 'last') {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (let d = lastDay; d >= 1; d--) {
        if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === dow) return d;
      }
      return null;
    }
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(year, month - 1, d));
      if (dt.getUTCMonth() !== month - 1) break;
      if (dt.getUTCDay() === dow) {
        count++;
        if (count === ord) return d;
      }
    }
    return null;
  }

  function nowInTz(tz, now) {
    const ref = now || new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(ref);
    const get = (type) => +parts.find((p) => p.type === type).value;
    let hour = get('hour');
    if (hour === 24) hour = 0;
    return { year: get('year'), month: get('month'), day: get('day'), hh: hour, mm: get('minute') };
  }

  function isStrictlyBefore(a, b) {
    if (a.year !== b.year)   return a.year < b.year;
    if (a.month !== b.month) return a.month < b.month;
    return a.day < b.day;
  }

  function isSameDay(a, b) {
    return a.year === b.year && a.month === b.month && a.day === b.day;
  }

  function computeNextWalk(cadence, now) {
    const parsed = parsePattern(cadence.pattern);
    if (!parsed) return null;

    const tz = cadence.tz || 'UTC';
    const [hhStr, mmStr] = (cadence.time || '08:00').split(':');
    const hh = +hhStr, mm = +mmStr;
    const durationMinutes = +(cadence.durationMinutes || 90);

    const current = nowInTz(tz, now);

    let day = nthWeekdayOfMonth(current.year, current.month, parsed.ord, parsed.dow);
    let candidate = { year: current.year, month: current.month, day };

    // Advance to next month if the candidate is in the past, OR if the
    // candidate is today AND the walk's end time has already passed.
    const walkEndedToday = isSameDay(candidate, current)
      && (current.hh * 60 + current.mm) >= (hh * 60 + mm + durationMinutes);

    if (day == null || isStrictlyBefore(candidate, current) || walkEndedToday) {
      let ny = current.year, nm = current.month + 1;
      if (nm > 12) { nm = 1; ny += 1; }
      day = nthWeekdayOfMonth(ny, nm, parsed.ord, parsed.dow);
      candidate = { year: ny, month: nm, day };
    }

    return { year: candidate.year, month: candidate.month, day: candidate.day, hh, mm, tz };
  }

  function formatNextLabel(walk) {
    const dt = new Date(Date.UTC(walk.year, walk.month - 1, walk.day));
    const dayName   = DAY_NAME[dt.getUTCDay()];
    const monthName = MONTH_NAME[walk.month - 1];
    const hour12    = (walk.hh % 12) || 12;
    const ampm      = walk.hh < 12 ? 'AM' : 'PM';
    const minStr    = walk.mm === 0 ? '' : `:${String(walk.mm).padStart(2, '0')}`;
    const tzAbbr    = tzAbbrev(walk.tz, walk);
    return `Next: ${dayName}, ${monthName} ${walk.day} — ${hour12}${minStr} ${ampm} ${tzAbbr}`;
  }

  function tzAbbrev(tz, walk) {
    try {
      const ref = new Date(Date.UTC(walk.year, walk.month - 1, walk.day, 12, 0));
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, timeZoneName: 'short', hour: 'numeric',
      }).formatToParts(ref);
      const tzPart = parts.find((p) => p.type === 'timeZoneName');
      return tzPart ? tzPart.value : '';
    } catch (e) {
      return '';
    }
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /* Convert a wall-clock time in the event's timezone to a UTC Date.
   * Trick: format the same wall-clock as if it were UTC, then compute the
   * offset that this tz would apply to that fake UTC instant. Works across
   * DST transitions without per-tz VTIMEZONE blocks. */
  function localWallToUtc(year, month, day, hh, mm, tz) {
    const fakeUtcMs = Date.UTC(year, month - 1, day, hh, mm);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date(fakeUtcMs));
    const get = (type) => +parts.find((p) => p.type === type).value;
    let hour = get('hour');
    if (hour === 24) hour = 0;
    const projectedMs = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'));
    const offsetMs = fakeUtcMs - projectedMs;
    return new Date(fakeUtcMs + offsetMs);
  }

  function toIcsUtc(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function rruleFromPattern(pattern, count) {
    const parsed = parsePattern(pattern);
    if (!parsed) return null;
    const code = DAY_CODE[parsed.dow];
    const ord  = parsed.ord === 'last' ? '-1' : String(parsed.ord);
    return `FREQ=MONTHLY;BYDAY=${ord}${code};COUNT=${count}`;
  }

  function buildIcs(walk, eventMeta) {
    const {
      uid, summary, location, description, url, rrule,
      durationMinutes = 90,
    } = eventMeta;

    /* Emit start/end as UTC instants so any timezone is handled correctly
     * without maintaining per-tz VTIMEZONE blocks. Calendar apps render the
     * UTC instant in the user's local time. */
    const startUtc = localWallToUtc(walk.year, walk.month, walk.day, walk.hh, walk.mm, walk.tz);
    const endUtc   = new Date(startUtc.getTime() + durationMinutes * 60_000);
    const dtstart  = toIcsUtc(startUtc);
    const dtend    = toIcsUtc(endUtc);
    const dtstamp  = toIcsUtc(new Date());

    const escIcs = (s) => String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Local Circle//walk.lc//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
    ];
    if (rrule) lines.push(`RRULE:${rrule}`);
    lines.push(
      `SUMMARY:${escIcs(summary)}`,
      `LOCATION:${escIcs(location)}`,
      `DESCRIPTION:${escIcs(description)}`,
      `URL:${url}`,
      'END:VEVENT',
      'END:VCALENDAR',
    );
    return lines.join('\r\n') + '\r\n';
  }

  function downloadIcs(filename, ics) {
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  function init() {
    const dataEl = document.getElementById('city-data');
    if (!dataEl) return;

    let data;
    try { data = JSON.parse(dataEl.textContent); }
    catch (err) { console.error('[cadence] failed to parse #city-data:', err); return; }

    let effectiveNow = new Date();
    if (data.cadence.effectiveFrom) {
      const from = new Date(`${data.cadence.effectiveFrom}T00:00:00Z`);
      if (!isNaN(from) && from > effectiveNow) effectiveNow = from;
    }

    const walk = computeNextWalk(data.cadence, effectiveNow);
    if (!walk) return;

    document.querySelectorAll('[data-cadence-next]').forEach((el) => {
      el.textContent = formatNextLabel(walk);
    });

    const slug = (data.name || 'circle').toLowerCase().replace(/\W+/g, '');
    const filename = `${slug}-${walk.year}-${pad(walk.month)}-${pad(walk.day)}.ics`;
    const recurrenceCount = data.cadence.recurrenceCount || DEFAULT_RRULE_COUNT;
    const rrule = rruleFromPattern(data.cadence.pattern, recurrenceCount);
    const eventMeta = {
      uid: `${slug}-circle@walk.lc`,
      summary: `The ${data.name} Circle`,
      location: data.where ? `${data.where.address}${data.where.note ? ', ' + data.where.note : ''}` : '',
      description: `Monthly walking circle. ${data.loopDescription || ''}\n\nMore: https://walk.lc/${slug}/`,
      url: `https://walk.lc/${slug}/`,
      rrule,
    };

    document.querySelectorAll('[data-cadence-ics]').forEach((a) => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        const ics = buildIcs(walk, eventMeta);
        downloadIcs(filename, ics);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.LocalCircleCadence = { computeNextWalk, formatNextLabel, buildIcs, rruleFromPattern };

})();

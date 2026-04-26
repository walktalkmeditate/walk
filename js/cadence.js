/* walk.lc — cadence + .ics generation.
   Computes the next walk date from a city's cadence rule and generates the
   calendar download on the fly so the page never goes stale.

   Cadence rule shape (in #city-data):
     { pattern: "first-saturday", time: "08:00", tz: "America/Chicago" }
     pattern: "{first|second|third|fourth|last}-{sunday|monday|...|saturday}"

   Auto-init at DOMContentLoaded:
     [data-cadence-next]      → text content replaced with "Next: Saturday, May 2 — 8:00 AM CT"
     [data-cadence-ics]       → click intercepted, dynamic .ics built from current next-walk
*/

(function() {

  const ORD_MAP = { first: 1, second: 2, third: 3, fourth: 4, last: 'last' };
  const DAY_MAP = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  };
  const DAY_NAME   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_NAME = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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

  function todayInTz(tz, now) {
    const ref = now || new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(ref);
    const get = (type) => +parts.find((p) => p.type === type).value;
    return { year: get('year'), month: get('month'), day: get('day') };
  }

  function isBefore(a, b) {
    if (a.year !== b.year)   return a.year < b.year;
    if (a.month !== b.month) return a.month < b.month;
    return a.day < b.day;
  }

  function computeNextWalk(cadence, now) {
    const parsed = parsePattern(cadence.pattern);
    if (!parsed) return null;

    const tz = cadence.tz || 'UTC';
    const [hhStr, mmStr] = (cadence.time || '08:00').split(':');
    const hh = +hhStr, mm = +mmStr;

    const today = todayInTz(tz, now);

    let day = nthWeekdayOfMonth(today.year, today.month, parsed.ord, parsed.dow);
    let candidate = { year: today.year, month: today.month, day };

    // If candidate already passed (calendar date in event tz), advance to next month.
    // Same-day stays — the walk is "today" until the calendar flips.
    if (day == null || isBefore(candidate, today)) {
      let ny = today.year, nm = today.month + 1;
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

  function buildIcs(walk, eventMeta) {
    const {
      uid, summary, location, description, url,
      durationMinutes = 90,
    } = eventMeta;

    const totalMin = walk.hh * 60 + walk.mm + durationMinutes;
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;

    const dateStr = `${walk.year}${pad(walk.month)}${pad(walk.day)}`;
    const dtstart = `${dateStr}T${pad(walk.hh)}${pad(walk.mm)}00`;
    const dtend   = `${dateStr}T${pad(endH)}${pad(endM)}00`;
    const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const escIcs = (s) => String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Local Circle//walk.lc//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VTIMEZONE',
      `TZID:${walk.tz}`,
      'BEGIN:DAYLIGHT',
      'TZOFFSETFROM:-0600',
      'TZOFFSETTO:-0500',
      'TZNAME:CDT',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0600',
      'TZNAME:CST',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${walk.tz}:${dtstart}`,
      `DTEND;TZID=${walk.tz}:${dtend}`,
      `SUMMARY:${escIcs(summary)}`,
      `LOCATION:${escIcs(location)}`,
      `DESCRIPTION:${escIcs(description)}`,
      `URL:${url}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n';
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

    const walk = computeNextWalk(data.cadence);
    if (!walk) return;

    document.querySelectorAll('[data-cadence-next]').forEach((el) => {
      el.textContent = formatNextLabel(walk);
    });

    const slug = (data.name || 'circle').toLowerCase().replace(/\W+/g, '');
    const filename = `${slug}-${walk.year}-${pad(walk.month)}-${pad(walk.day)}.ics`;
    const eventMeta = {
      uid: `${slug}-circle-${walk.year}-${pad(walk.month)}-${pad(walk.day)}@walk.lc`,
      summary: `The ${data.name} Circle`,
      location: data.where ? `${data.where.address}${data.where.note ? ', ' + data.where.note : ''}` : '',
      description: `Monthly walking circle. ${data.loopDescription || ''}\n\nMore: https://walk.lc/${slug}/`,
      url: `https://walk.lc/${slug}/`,
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

  window.LocalCircleCadence = { computeNextWalk, formatNextLabel, buildIcs };

})();

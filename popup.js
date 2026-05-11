/**
 * popup.js — Streak Extension UI
 *
 * Owns all popup rendering and user interactions:
 *   • Monthly calendar view  — full month grid, Mon-Sun columns
 *   • Yearly calendar view   — GitHub-style contribution heatmap
 *   • Mark Today flow        — inline note textarea → save → fire animation
 *   • Tooltip                — hover over any logged day to see the note
 *   • Stats header           — current streak, longest streak, total days
 *
 * Data flow:
 *   chrome.storage.local → appDays (in-memory cache) → render functions → DOM
 *   User action → update appDays → chrome.storage.local.set → re-render
 *
 * All dates are in local time. Keys are "YYYY-MM-DD" strings.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const EMOJI_COMPLETE = '🔥';
const EMOJI_MISSED   = '💀';

// Streak thresholds that determine colour intensity in the yearly heatmap
const STREAK_TIER_LOW  = 7;   // 1–7  days → dim orange
const STREAK_TIER_MID  = 30;  // 8–30 days → mid orange
// > 30 days → bright orange (completed-high CSS class)

const TOOLTIP_DELAY_MS  = 200; // ms to wait before showing tooltip on hover
const NOTE_ANIMATE_MS   = 400; // ms for the mark-pop animation to finish

// Cell width (px) used to compute month label widths in the yearly view.
// Must match .year-cell { width } + .year-grid { gap } in popup.css.
const YEAR_CELL_WIDTH_PX = 11;

const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                           'Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Application state ────────────────────────────────────────────────────────

/**
 * In-memory mirror of chrome.storage.local { days }.
 * Kept in sync immediately on every save so renders don't need async reads.
 * Shape: { "YYYY-MM-DD": { completed: boolean, note: string } }
 */
let appDays = {};

/** Which month/year the monthly calendar is showing. */
let viewMonth = new Date().getMonth();
let viewYear  = new Date().getFullYear();

/**
 * Offset from the current year for the yearly heatmap view.
 * 0 = current year, -1 = last year, etc.
 * Capped at 0 (can't navigate to the future).
 */
let viewYearOffset = 0;

/** 'monthly' | 'yearly' */
let currentView = 'monthly';

/** setTimeout handle for the tooltip delay. */
let tooltipTimeout = null;

// ─── DOM references ───────────────────────────────────────────────────────────
// Collected once at startup. Prefer getElementById over querySelector for speed.

const $currentStreak = document.getElementById('currentStreak');
const $longestStreak = document.getElementById('longestStreak');
const $totalDays     = document.getElementById('totalDays');
const $monthTitle    = document.getElementById('monthTitle');
const $monthGrid     = document.getElementById('monthGrid');
const $yearTitle     = document.getElementById('yearTitle');
const $yearGrid      = document.getElementById('yearGrid');
const $monthLabels   = document.getElementById('monthLabels');
const $monthlyView   = document.getElementById('monthlyView');
const $yearlyView    = document.getElementById('yearlyView');
const $calendarArea  = document.getElementById('calendarArea');
const $markBtn       = document.getElementById('markBtn');
const $noteInputArea = document.getElementById('noteInputArea');
const $noteInput     = document.getElementById('noteInput');
const $noteCancel    = document.getElementById('noteCancel');
const $noteConfirm   = document.getElementById('noteConfirm');
const $btnMonthly    = document.getElementById('btnMonthly');
const $btnYearly     = document.getElementById('btnYearly');
const $prevMonth     = document.getElementById('prevMonth');
const $nextMonth     = document.getElementById('nextMonth');
const $prevYear      = document.getElementById('prevYear');
const $nextYear      = document.getElementById('nextYear');
const $tooltip       = document.getElementById('tooltip');

// ─── Date utilities ───────────────────────────────────────────────────────────

/**
 * Returns a "YYYY-MM-DD" key for the given Date in LOCAL time.
 * Never use date.toISOString() for keys — it returns UTC, which can be a
 * different calendar day near midnight depending on the user's timezone.
 */
function getDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's "YYYY-MM-DD" key. */
function getTodayKey() {
  return getDateKey(new Date());
}

/**
 * Parses a "YYYY-MM-DD" key back into a local-time Date at midnight.
 * Using `new Date(y, m-1, d)` avoids UTC offset issues that occur with
 * `new Date("YYYY-MM-DD")` (which is parsed as UTC).
 */
function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Formats year + month index as "Month YYYY" (e.g. "May 2026"). */
function formatMonthYear(year, month) {
  return new Date(year, month).toLocaleDateString('en-US', {
    month: 'long',
    year:  'numeric',
  });
}

// ─── Streak calculations ──────────────────────────────────────────────────────

/**
 * Current streak: number of consecutive completed days ending at today
 * (or yesterday, if today hasn't been logged yet).
 *
 * This allows the streak counter to stay non-zero all day as long as she
 * logged yesterday — it only drops to 0 at midnight if today is also missed.
 */
function calcCurrentStreak(days) {
  const todayKey = getTodayKey();
  const cursor   = new Date();

  // If today isn't logged, start counting from yesterday
  if (!days[todayKey]?.completed) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (true) {
    const key = getDateKey(cursor);
    if (days[key]?.completed) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break; // gap found — streak ends here
    }
  }
  return streak;
}

/**
 * Longest streak ever achieved, scanning the full history.
 * Counts only completed days; a single missed day breaks the chain.
 *
 * Adds 'T00:00:00' when parsing keys to force local-time midnight,
 * otherwise JS may interpret the date string as UTC.
 */
function calcLongestStreak(days) {
  const completedKeys = Object.keys(days)
    .filter(key => days[key].completed)
    .sort(); // ISO keys sort lexicographically = chronologically

  let longest  = 0;
  let current  = 0;
  let prevDate = null;

  for (const key of completedKeys) {
    const date     = new Date(key + 'T00:00:00');
    const daysDiff = prevDate
      ? Math.round((date - prevDate) / 86_400_000)
      : null;

    if (daysDiff === 1) {
      current++; // consecutive day
    } else {
      current = 1; // first day, or gap resets chain
    }

    if (current > longest) longest = current;
    prevDate = date;
  }

  return longest;
}

/** Total number of days ever logged as completed. */
function calcTotal(days) {
  return Object.values(days).filter(entry => entry.completed).length;
}

/**
 * Streak length at a specific day (looking backwards from that day).
 * Used to colour heatmap cells: a cell on a 25-day streak gets mid-orange.
 *
 * This is O(streak_length) per cell, acceptable for a year's worth of data
 * (~365 cells × average streak ≪ 10k operations total).
 */
function getStreakAt(key) {
  const cursor = parseKey(key);
  let streak   = 0;
  while (true) {
    const k = getDateKey(cursor);
    if (appDays[k]?.completed) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// ─── Stats header ─────────────────────────────────────────────────────────────

/** Re-reads appDays and updates the three stat labels in the header. */
function updateStats() {
  const current = calcCurrentStreak(appDays);
  const longest = calcLongestStreak(appDays);
  const total   = calcTotal(appDays);

  $currentStreak.textContent = current;
  $longestStreak.textContent = longest + (longest === 1 ? ' day' : ' days');
  $totalDays.textContent     = total   + (total   === 1 ? ' day' : ' days');
}

// ─── Mark Today button state ──────────────────────────────────────────────────

/**
 * Syncs the Mark Today button to match storage state.
 * Called on init and after every save so the button is always accurate.
 */
function updateMarkButton() {
  const todayKey   = getTodayKey();
  const todayEntry = appDays[todayKey];

  if (todayEntry?.completed) {
    $markBtn.textContent = '✓ Logged today';
    $markBtn.disabled    = true;
    $markBtn.classList.add('logged');
    closeNotePanel(/* immediate */ true);
  } else {
    $markBtn.textContent = 'Mark Today';
    $markBtn.disabled    = false;
    $markBtn.classList.remove('logged');
  }
}

// ─── Note panel (slide-in textarea) ──────────────────────────────────────────

/**
 * Slides the note textarea into view and focuses it.
 * Uses requestAnimationFrame to let the browser paint the un-hidden state
 * before the CSS transition starts; without it the transition is skipped.
 */
function openNotePanel() {
  $noteInputArea.classList.remove('hidden');
  requestAnimationFrame(() => $noteInputArea.classList.add('visible'));
  $noteInput.focus();
}

/**
 * Slides the note panel out of view.
 * @param {boolean} immediate - if true, hides without waiting for transition
 */
function closeNotePanel(immediate = false) {
  $noteInputArea.classList.remove('visible');
  if (immediate) {
    $noteInputArea.classList.add('hidden');
  } else {
    setTimeout(() => $noteInputArea.classList.add('hidden'), 200);
  }
  $noteInput.value = '';
}

// ─── Save today ───────────────────────────────────────────────────────────────

/**
 * Writes today's entry to storage and refreshes the UI.
 * Triggered by the "Save ✓" button or Cmd/Ctrl+Enter in the textarea.
 */
function saveToday() {
  const todayKey = getTodayKey();
  const note     = $noteInput.value.trim();

  // Update in-memory state first so all subsequent renders see it immediately
  appDays[todayKey] = { completed: true, note };

  const longest = calcLongestStreak(appDays);

  chrome.storage.local.set({ days: appDays, longestStreak: longest }, () => {
    closeNotePanel();
    updateMarkButton();
    updateStats();
    refreshCalendar();
    animateTodayCell();
  });
}

/** Re-renders whichever calendar view is currently active. */
function refreshCalendar() {
  if (currentView === 'monthly') {
    renderMonthly();
  } else {
    renderYearly();
  }
}

/**
 * Triggers the "pop" animation on today's cell in the monthly grid.
 * Runs after renderMonthly() has rebuilt the DOM, so today's cell exists.
 */
function animateTodayCell() {
  if (currentView !== 'monthly') return;

  const todayDate = new Date().getDate();

  // Find the cell whose day number matches today's date
  const cells = $monthGrid.querySelectorAll('.day-cell.completed');
  cells.forEach(cell => {
    const numEl = cell.querySelector('.day-num');
    if (numEl && parseInt(numEl.textContent, 10) === todayDate) {
      cell.classList.add('pop');
      setTimeout(() => cell.classList.remove('pop'), NOTE_ANIMATE_MS);
    }
  });
}

// ─── Monthly calendar ─────────────────────────────────────────────────────────

/**
 * Renders the monthly calendar grid for viewYear/viewMonth.
 *
 * Grid layout: 7 columns (Mon–Sun). Each cell is a square div containing
 * a date number and, for non-future days, an emoji.
 *
 * Cell states:
 *   .empty          — padding cells before day 1 (no content)
 *   .future         — days after today (dimmed, no emoji)
 *   .completed      — logged day (🔥, hoverable tooltip, orange bg tint)
 *   .today-completed — today AND logged (stronger orange border)
 *   .today-unmarked — today, not yet logged (pulsing ring)
 *   .missed         — past day with no entry (💀, dark red bg)
 */
function renderMonthly() {
  $monthTitle.textContent = formatMonthYear(viewYear, viewMonth);

  const today    = new Date();
  const todayKey = getTodayKey();

  // Prevent navigating forward past the current month
  $nextMonth.disabled =
    viewYear > today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth >= today.getMonth());

  $monthGrid.innerHTML = '';

  // Determine how many blank cells to prefix before day 1.
  // JS getDay(): 0=Sun, 1=Mon … 6=Sat. We want Mon=0, so shift by -1.
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset    = (firstDayOfWeek === 0) ? 6 : firstDayOfWeek - 1;
  const daysInMonth    = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Blank filler cells
  for (let i = 0; i < startOffset; i++) {
    const cell = document.createElement('div');
    cell.className = 'day-cell empty';
    cell.setAttribute('aria-hidden', 'true');
    $monthGrid.appendChild(cell);
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const date    = new Date(viewYear, viewMonth, day);
    const key     = getDateKey(date);
    const entry   = appDays[key];
    const isToday  = (key === todayKey);
    const isPast   = (date < today) && !isToday;
    const isFuture = (date > today);

    const cell   = document.createElement('div');
    const numEl  = document.createElement('div');
    const emojiEl = document.createElement('div');

    cell.classList.add('day-cell');
    cell.setAttribute('aria-label', date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }));
    numEl.className    = 'day-num';
    numEl.textContent  = day;
    emojiEl.className  = 'day-emoji';

    if (isFuture) {
      // Future — show date only, no emoji
      cell.classList.add('future');
      cell.appendChild(numEl);

    } else if (entry?.completed) {
      // Logged day 🔥
      cell.classList.add('completed');
      if (isToday) cell.classList.add('today-completed');
      emojiEl.textContent = EMOJI_COMPLETE;
      cell.appendChild(numEl);
      cell.appendChild(emojiEl);
      attachTooltip(cell, key, entry);

    } else if (isPast) {
      // Missed day 💀
      cell.classList.add('missed');
      emojiEl.textContent = EMOJI_MISSED;
      cell.appendChild(numEl);
      cell.appendChild(emojiEl);

    } else {
      // Today, not yet logged — pulsing ring
      cell.classList.add('today-unmarked');
      cell.appendChild(numEl);
    }

    $monthGrid.appendChild(cell);
  }
}

// ─── Yearly heatmap ───────────────────────────────────────────────────────────

/**
 * Renders the GitHub-style yearly heatmap for (current year + viewYearOffset).
 *
 * Layout:
 *   • Weeks run left→right (columns), days run top→bottom (rows, Mon at top).
 *   • The grid starts on the Monday of the week containing Jan 1, and ends
 *     on the Sunday of the week containing Dec 31 — padding with out-of-year
 *     cells so all columns are full 7-day weeks.
 *   • Month labels sit above the grid, each spanning its weeks.
 *
 * Cell colours (CSS classes):
 *   completed-low  → 1–7 day streak  (dim orange)
 *   completed-mid  → 8–30 day streak (mid orange)
 *   completed-high → 31+ day streak  (bright orange)
 *   missed         → past, not logged (dark red)
 *   (default)      → future or out-of-year (dark grey)
 */
function renderYearly() {
  const displayYear = new Date().getFullYear() + viewYearOffset;
  $yearTitle.textContent = displayYear;

  // Prevent navigating forward past the current year
  $prevYear.disabled = false;
  $nextYear.disabled = (viewYearOffset >= 0);

  $yearGrid.innerHTML    = '';
  $monthLabels.innerHTML = '';

  const today    = new Date();
  const todayKey = getTodayKey();

  // ── Grid bounds ────────────────────────────────────────────────
  // Start: Monday of the week that contains January 1
  const gridStart = getMondayOf(new Date(displayYear, 0, 1));

  // End: Sunday of the week that contains December 31
  const gridEnd  = getSundayOf(new Date(displayYear, 11, 31));

  // ── Build week columns ─────────────────────────────────────────
  const weeks  = [];
  const cursor = new Date(gridStart);

  while (cursor <= gridEnd) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  // ── Month label positions ──────────────────────────────────────
  // monthFirstWeek[m] = index of the first week column that contains a day
  // in month m of displayYear. Used to position month name labels.
  const monthFirstWeek = {};
  weeks.forEach((week, weekIndex) => {
    week.forEach(day => {
      if (day.getFullYear() !== displayYear) return;
      const m = day.getMonth();
      if (monthFirstWeek[m] === undefined) monthFirstWeek[m] = weekIndex;
    });
  });

  // Render month labels as fixed-width spans
  for (let m = 0; m < 12; m++) {
    if (monthFirstWeek[m] === undefined) continue;

    const nextMonthWeek = (m < 11)
      ? (monthFirstWeek[m + 1] ?? weeks.length)
      : weeks.length;

    const widthPx = (nextMonthWeek - monthFirstWeek[m]) * YEAR_CELL_WIDTH_PX;
    const label   = document.createElement('span');
    label.className   = 'month-label-item';
    label.textContent = MONTH_NAMES_SHORT[m];
    label.style.width = widthPx + 'px';
    $monthLabels.appendChild(label);
  }

  // ── Render week columns and day cells ─────────────────────────
  weeks.forEach(week => {
    const weekEl = document.createElement('div');
    weekEl.className = 'year-week';

    week.forEach(day => {
      const cell     = document.createElement('div');
      const key      = getDateKey(day);
      const entry    = appDays[key];
      const inYear   = (day.getFullYear() === displayYear);
      const isFuture = (day > today);

      cell.className = 'year-cell';
      cell.setAttribute('aria-label', day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));

      if (inYear && !isFuture) {
        if (entry?.completed) {
          // Colour intensity based on streak length at this specific day
          const streakLength = getStreakAt(key);
          if (streakLength <= STREAK_TIER_LOW)       cell.classList.add('completed-low');
          else if (streakLength <= STREAK_TIER_MID)  cell.classList.add('completed-mid');
          else                                        cell.classList.add('completed-high');
        } else {
          cell.classList.add('missed');
        }
        attachTooltip(cell, key, entry);
      }
      // Out-of-year or future cells keep the default dark background

      if (key === todayKey) cell.classList.add('today-cell');

      weekEl.appendChild(cell);
    });

    $yearGrid.appendChild(weekEl);
  });
}

// ─── Date helpers for yearly grid ────────────────────────────────────────────

/** Returns the Monday of the week containing `date` (mutates a copy). */
function getMondayOf(date) {
  const d   = new Date(date);
  const dow = d.getDay(); // 0=Sun … 6=Sat
  // Distance to Monday: Sun→-6, Mon→0, Tue→-1 … Sat→-5 (in Mon-first system)
  const offset = (dow === 0) ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d;
}

/** Returns the Sunday of the week containing `date` (mutates a copy). */
function getSundayOf(date) {
  const d   = new Date(date);
  const dow = d.getDay(); // 0=Sun … 6=Sat
  // Distance to Sunday: Sun→0, Mon→6, Tue→5 … Sat→1
  const offset = (dow === 0) ? 0 : 7 - dow;
  d.setDate(d.getDate() + offset);
  return d;
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

/**
 * Attaches hover listeners to a calendar cell to show/hide the tooltip.
 * The tooltip is a single shared DOM node repositioned on each show.
 *
 * @param {HTMLElement} cell  - the calendar cell element
 * @param {string}      key   - "YYYY-MM-DD" of this cell
 * @param {object|undefined} entry - { completed, note } from appDays, or undefined
 */
function attachTooltip(cell, key, entry) {
  cell.addEventListener('mouseenter', (e) => {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => showTooltip(e, key, entry), TOOLTIP_DELAY_MS);
  });

  cell.addEventListener('mouseleave', () => {
    clearTimeout(tooltipTimeout);
    hideTooltip();
  });

  // Keep tooltip pinned to cursor while hovering
  cell.addEventListener('mousemove', positionTooltip);
}

/**
 * Builds and displays the tooltip for a given cell.
 * XSS-safe: all user-supplied note text passes through escapeHtml().
 */
function showTooltip(e, key, entry) {
  const date    = parseKey(key);
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  const note = entry?.note?.trim() || '';

  let noteHtml;
  if (entry?.completed) {
    noteHtml = note
      ? `<div class="tt-note">${escapeHtml(note)}</div>`
      : `<div class="tt-note">${EMOJI_COMPLETE} Logged</div>`;
  } else {
    noteHtml = `<div class="tt-note" style="color:#555">Not logged</div>`;
  }

  $tooltip.innerHTML  = `<div class="tt-date">${dateStr}</div>${noteHtml}`;
  $tooltip.classList.add('visible');
  positionTooltip(e);
}

/**
 * Positions the tooltip near the cursor, keeping it within the popup viewport.
 * Prefers above-and-right of cursor; flips left if it would overflow, and
 * flips below if it would overflow above.
 */
function positionTooltip(e) {
  const tw = $tooltip.offsetWidth  || 180;
  const th = $tooltip.offsetHeight || 50;

  let x = e.clientX + 10;
  let y = e.clientY - th - 10;

  // Overflow right → flip left
  if (x + tw > window.innerWidth - 4)  x = e.clientX - tw - 10;
  // Overflow top → flip below cursor
  if (y < 4)                            y = e.clientY + 14;

  $tooltip.style.left = x + 'px';
  $tooltip.style.top  = y + 'px';
}

function hideTooltip() {
  $tooltip.classList.remove('visible');
}

/** Prevents XSS in tooltip note content. */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── View switching ───────────────────────────────────────────────────────────

/**
 * Switches between monthly and yearly views.
 * Adds a brief fade-in animation so the transition isn't jarring.
 *
 * @param {'monthly'|'yearly'} view
 */
function switchView(view) {
  currentView = view;

  const isMonthly = (view === 'monthly');
  $btnMonthly.classList.toggle('active', isMonthly);
  $btnYearly.classList.toggle('active', !isMonthly);
  $monthlyView.classList.toggle('hidden', !isMonthly);
  $yearlyView.classList.toggle('hidden',  isMonthly);

  if (isMonthly) {
    renderMonthly();
  } else {
    renderYearly();
  }

  // Brief fade-in so the content change doesn't feel abrupt
  $calendarArea.classList.add('fade-in');
  $calendarArea.addEventListener('animationend', () => {
    $calendarArea.classList.remove('fade-in');
  }, { once: true });
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// View toggle buttons
$btnMonthly.addEventListener('click', () => switchView('monthly'));
$btnYearly.addEventListener('click',  () => switchView('yearly'));

// Monthly nav arrows
$prevMonth.addEventListener('click', () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderMonthly();
});

$nextMonth.addEventListener('click', () => {
  const today = new Date();
  // Guard: never navigate past current month (button is also disabled, but be safe)
  if (viewYear === today.getFullYear() && viewMonth >= today.getMonth()) return;
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderMonthly();
});

// Yearly nav arrows
$prevYear.addEventListener('click', () => {
  viewYearOffset--;
  renderYearly();
});

$nextYear.addEventListener('click', () => {
  if (viewYearOffset >= 0) return; // guard: can't go to the future
  viewYearOffset++;
  renderYearly();
});

// Mark Today — opens the note panel
$markBtn.addEventListener('click', () => {
  if (appDays[getTodayKey()]?.completed) return; // already logged, ignore
  openNotePanel();
  $markBtn.textContent = 'Adding note…';
  $markBtn.disabled    = true;
});

// Note panel — cancel
$noteCancel.addEventListener('click', () => {
  closeNotePanel();
  updateMarkButton(); // restore button to "Mark Today"
});

// Note panel — confirm (button)
$noteConfirm.addEventListener('click', saveToday);

// Note panel — confirm (keyboard shortcut: Cmd+Enter or Ctrl+Enter)
$noteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    saveToday();
  }
});

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Entry point — loads persisted data from storage, then renders the UI.
 * Everything hangs off this callback; the popup is blank until storage responds.
 */
chrome.storage.local.get(['days', 'longestStreak'], (result) => {
  appDays = result.days || {};

  // If the computed longest streak is higher than the stored value
  // (e.g. the background worker missed a rollover), fix it silently.
  const computedLongest = calcLongestStreak(appDays);
  const storedLongest   = result.longestStreak || 0;
  if (computedLongest > storedLongest) {
    chrome.storage.local.set({ longestStreak: computedLongest });
  }

  updateStats();
  updateMarkButton();
  switchView('monthly'); // always open on monthly view
});

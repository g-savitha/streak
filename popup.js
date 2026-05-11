/**
 * popup.js — Streak Extension v2 UI
 *
 * New in v2:
 *   • Daily motivational quote (stable per day, no storage needed)
 *   • Confetti + celebration banner on marking today
 *   • Light/dark theme toggle (persisted to storage)
 *   • Shareable PNG export of yearly heatmap + stats card
 *   • Code-based friend challenge (Base64 encoded, no backend)
 *   • Missed day emoji changed from 💀 to 😢
 *   • Gradient UI
 *
 * Data flow (unchanged from v1):
 *   chrome.storage.local → appDays (in-memory) → render → DOM
 *   User action → update appDays → chrome.storage.local.set → re-render
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const EMOJI_COMPLETE = '🔥';
const EMOJI_MISSED   = '😢';  // v2: changed from 💀 to be encouraging not punishing

// Streak length thresholds for heatmap colour tiers (yearly view)
const STREAK_TIER_LOW = 7;   // 1–7  → dim orange
const STREAK_TIER_MID = 30;  // 8–30 → mid orange  /  31+ → bright orange

const TOOLTIP_DELAY_MS  = 200;
const NOTE_ANIMATE_MS   = 400;
const CELEBRATION_MS    = 3000; // how long the celebration banner stays visible

// Yearly heatmap: cell width (9px) + gap (2px) = 11px per week column.
// Must stay in sync with .year-cell and .year-grid { gap } in popup.css.
const YEAR_CELL_WIDTH_PX = 11;

const MONTH_NAMES_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun',
                            'Jul','Aug','Sep','Oct','Nov','Dec'];

// Challenge codes older than this are considered expired
const CHALLENGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Daily motivational quotes ────────────────────────────────────────────────

/**
 * Shown in the quote bar at the top of the popup.
 * Selection is stable per calendar day: index = floor(now / MS_PER_DAY) % length
 * so it changes exactly at midnight without requiring storage.
 */
const QUOTES = [
  // APJ Abdul Kalam
  "You have to dream before your dreams can come true. — APJ Abdul Kalam",
  "Excellence is a continuous process and not an accident. — APJ Abdul Kalam",
  "If you want to shine like a sun, first burn like a sun. — APJ Abdul Kalam",
  "Learning gives creativity, creativity leads to thinking, thinking provides knowledge, knowledge makes you great. — APJ Abdul Kalam",

  // Swami Vivekananda
  "Arise, awake and do not stop until the goal is reached. — Swami Vivekananda",
  "Take up one idea. Make it your life — think of it, dream of it, live on it. — Swami Vivekananda",
  "All the strength and succour you want is within yourself. — Swami Vivekananda",
  "The greatest sin is to think yourself weak. — Swami Vivekananda",

  // Steve Jobs
  "Stay hungry, stay foolish. — Steve Jobs",
  "The people who are crazy enough to think they can change the world are the ones who do. — Steve Jobs",
  "Your time is limited, so don't waste it living someone else's life. — Steve Jobs",
  "The only way to do great work is to love what you do. — Steve Jobs",

  // Jack Ma
  "Today is hard, tomorrow will be worse, but the day after tomorrow will be sunshine. — Jack Ma",
  "If you don't give up, you still have a chance. — Jack Ma",
  "No matter how tough the chase is, you should always have the dream you saw on the first day. — Jack Ma",

  // Elon Musk
  "When something is important enough, you do it even if the odds are not in your favour. — Elon Musk",
  "Persistence is very important. You should not give up unless you are forced to give up. — Elon Musk",
  "Work like hell. I mean you just have to put in 80–100 hour weeks every week. — Elon Musk",

  // Gary Vaynerchuk
  "Every day is a new opportunity to grow. Use it. — Gary Vee",

  // Naval Ravikant
  "Read what you love until you love to read. — Naval Ravikant",
  "The best investment you can make is in yourself. — Naval Ravikant",
  "Specific knowledge is knowledge you cannot be trained for. — Naval Ravikant",
  "A calm mind, a fit body, a house full of books. Pick three. — Naval Ravikant",

  // Warren Buffett
  "The more you learn, the more you earn. — Warren Buffett",
  "Someone is sitting in the shade today because someone planted a tree a long time ago. — Warren Buffett",

  // James Clear
  "You do not rise to the level of your goals. You fall to the level of your systems. — James Clear",
  "Every action you take is a vote for the type of person you wish to become. — James Clear",
  "The most practical way to change who you are is to change what you do. — James Clear",
  "Success is the product of daily habits — not once-in-a-lifetime transformations. — James Clear",
];

/**
 * Shown in the celebration banner after marking today complete.
 * Picked randomly each time for variety.
 */
const CELEBRATION_QUOTES = [
  "🎉 You showed up today. That's everything.",
  "🔥 Another day, another victory. You're on fire!",
  "✨ Streak alive! Your future self is proud of you.",
  "🌟 That's what consistency looks like. Keep it up!",
  "💪 Done! You're building something extraordinary.",
  "🚀 One more day added to your legend. Let's go!",
  "📚 You read today. That's not small — that's huge.",
  "🎯 Nailed it! Your streak grows stronger.",
  "⚡ You did the thing. Champions log every day.",
  "🏆 Today? Crushed. Tomorrow? Same energy!",
];

// ─── Application state ────────────────────────────────────────────────────────

/** In-memory mirror of chrome.storage.local { days }. Always written through to storage. */
let appDays = {};

/** App settings — theme and display name for challenges. */
let appSettings = { theme: 'dark', name: '' };

let viewMonth      = new Date().getMonth();
let viewYear       = new Date().getFullYear();
let viewYearOffset = 0;   // 0 = current year, -1 = last year, etc.
let currentView    = 'monthly';
let tooltipTimeout = null;

// ─── DOM references ───────────────────────────────────────────────────────────

const $currentStreak    = document.getElementById('currentStreak');
const $longestStreak    = document.getElementById('longestStreak');
const $totalDays        = document.getElementById('totalDays');
const $monthTitle       = document.getElementById('monthTitle');
const $monthGrid        = document.getElementById('monthGrid');
const $yearTitle        = document.getElementById('yearTitle');
const $yearGrid         = document.getElementById('yearGrid');
const $monthLabels      = document.getElementById('monthLabels');
const $monthlyView      = document.getElementById('monthlyView');
const $yearlyView       = document.getElementById('yearlyView');
const $calendarArea     = document.getElementById('calendarArea');
const $markBtn          = document.getElementById('markBtn');
const $noteInputArea    = document.getElementById('noteInputArea');
const $noteInput        = document.getElementById('noteInput');
const $noteCancel       = document.getElementById('noteCancel');
const $noteConfirm      = document.getElementById('noteConfirm');
const $btnMonthly       = document.getElementById('btnMonthly');
const $btnYearly        = document.getElementById('btnYearly');
const $prevMonth        = document.getElementById('prevMonth');
const $nextMonth        = document.getElementById('nextMonth');
const $prevYear         = document.getElementById('prevYear');
const $nextYear         = document.getElementById('nextYear');
const $tooltip          = document.getElementById('tooltip');
const $quoteText        = document.getElementById('quoteText');
const $themeToggle      = document.getElementById('themeToggle');
const $themeIcon        = document.getElementById('themeIcon');
const $celebrationBanner = document.getElementById('celebrationBanner');
const $confettiCanvas   = document.getElementById('confettiCanvas');
const $shareDownloadBtn = document.getElementById('shareDownloadBtn');
const $shareCopyBtn     = document.getElementById('shareCopyBtn');
const $challengeToggle  = document.getElementById('challengeToggle');
const $challengeSection = document.getElementById('challengeSection');
const $challengeBody    = document.getElementById('challengeBody');
const $tabYourCode      = document.getElementById('tabYourCode');
const $tabEnterCode     = document.getElementById('tabEnterCode');
const $panelYourCode    = document.getElementById('panelYourCode');
const $panelEnterCode   = document.getElementById('panelEnterCode');
const $userName         = document.getElementById('userName');
const $generatedCode    = document.getElementById('generatedCode');
const $copyCodeBtn      = document.getElementById('copyCodeBtn');
const $friendCodeInput  = document.getElementById('friendCodeInput');
const $compareBtn       = document.getElementById('compareBtn');
const $challengeResult  = document.getElementById('challengeResult');

// ─── Date utilities ───────────────────────────────────────────────────────────

/**
 * Returns "YYYY-MM-DD" in LOCAL time.
 * Never use toISOString() — it returns UTC and can be a different calendar
 * date near midnight depending on the user's timezone.
 */
function getDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayKey() { return getDateKey(new Date()); }

/**
 * Parses "YYYY-MM-DD" into a local-time Date at midnight.
 * `new Date("YYYY-MM-DD")` would parse as UTC — this avoids that.
 */
function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatMonthYear(year, month) {
  return new Date(year, month).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });
}

// ─── Streak calculations ──────────────────────────────────────────────────────

/**
 * Current streak: consecutive completed days ending at today (or yesterday
 * if today isn't logged yet). Drops to 0 only after midnight if today is missed.
 */
function calcCurrentStreak(days) {
  const todayKey = getTodayKey();
  const cursor   = new Date();
  if (!days[todayKey]?.completed) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (true) {
    const key = getDateKey(cursor);
    if (days[key]?.completed) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  return streak;
}

/** Longest consecutive completed-day run across all history. */
function calcLongestStreak(days) {
  const keys = Object.keys(days).filter(k => days[k].completed).sort();
  let longest = 0, current = 0, prevDate = null;
  for (const key of keys) {
    const date = new Date(key + 'T00:00:00');
    const diff = prevDate ? Math.round((date - prevDate) / 86_400_000) : null;
    current    = diff === 1 ? current + 1 : 1;
    if (current > longest) longest = current;
    prevDate = date;
  }
  return longest;
}

/** Total completed days ever. */
function calcTotal(days) {
  return Object.values(days).filter(e => e.completed).length;
}

/**
 * Streak length ending at a specific day (looking backwards).
 * Used to pick the correct colour tier for heatmap cells.
 */
function getStreakAt(key) {
  const cursor = parseKey(key);
  let streak = 0;
  while (true) {
    const k = getDateKey(cursor);
    if (appDays[k]?.completed) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  return streak;
}

// ─── Theme ────────────────────────────────────────────────────────────────────

/**
 * Applies the given theme to <html data-theme="..."> and updates the icon.
 * Does NOT persist — call saveSettings() separately if needed.
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
  appSettings.theme = theme;
}

function toggleTheme() {
  const next = appSettings.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  saveSettings();
}

// ─── Settings persistence ─────────────────────────────────────────────────────

function saveSettings() {
  chrome.storage.local.set({ settings: appSettings });
}

// ─── Stats update ─────────────────────────────────────────────────────────────

function updateStats() {
  const current = calcCurrentStreak(appDays);
  const longest = calcLongestStreak(appDays);
  const total   = calcTotal(appDays);
  $currentStreak.textContent = current;
  $longestStreak.textContent = longest + (longest === 1 ? ' day' : ' days');
  $totalDays.textContent     = total   + (total   === 1 ? ' day' : ' days');
}

// ─── Daily quote ──────────────────────────────────────────────────────────────

/**
 * Picks today's quote using a stable day-based index — same quote all day,
 * changes at midnight, no storage required.
 */
function renderQuote() {
  const index = Math.floor(Date.now() / 86_400_000) % QUOTES.length;
  $quoteText.textContent = QUOTES[index];
}

// ─── Mark Today button state ──────────────────────────────────────────────────

function updateMarkButton() {
  const entry = appDays[getTodayKey()];
  if (entry?.completed) {
    $markBtn.textContent = '✓ Logged today';
    $markBtn.disabled    = true;
    $markBtn.classList.add('logged');
    closeNotePanel(true);
  } else {
    $markBtn.textContent = 'Mark Today';
    $markBtn.disabled    = false;
    $markBtn.classList.remove('logged');
  }
}

// ─── Note panel ───────────────────────────────────────────────────────────────

function openNotePanel() {
  $noteInputArea.classList.remove('hidden');
  requestAnimationFrame(() => $noteInputArea.classList.add('visible'));
  $noteInput.focus();
}

function closeNotePanel(immediate = false) {
  $noteInputArea.classList.remove('visible');
  if (immediate) $noteInputArea.classList.add('hidden');
  else setTimeout(() => $noteInputArea.classList.add('hidden'), 220);
  $noteInput.value = '';
}

// ─── Save today ───────────────────────────────────────────────────────────────

function saveToday() {
  const todayKey = getTodayKey();
  const note     = $noteInput.value.trim();
  appDays[todayKey] = { completed: true, note };

  const longest = calcLongestStreak(appDays);
  chrome.storage.local.set({ days: appDays, longestStreak: longest }, () => {
    closeNotePanel();
    updateMarkButton();
    updateStats();
    refreshCalendar();
    animateTodayCell();
    showCelebration();   // 🎉 confetti + banner
    refreshChallengeCode(); // update code if challenge panel is open
  });
}

function refreshCalendar() {
  if (currentView === 'monthly') renderMonthly();
  else renderYearly();
}

function animateTodayCell() {
  if (currentView !== 'monthly') return;
  const todayDate = new Date().getDate();
  $monthGrid.querySelectorAll('.day-cell.completed').forEach(cell => {
    const numEl = cell.querySelector('.day-num');
    if (numEl && parseInt(numEl.textContent, 10) === todayDate) {
      cell.classList.add('pop');
      setTimeout(() => cell.classList.remove('pop'), NOTE_ANIMATE_MS);
    }
  });
}

// ─── Celebration banner + confetti ────────────────────────────────────────────

/**
 * Shows the celebration banner with a random quote, then auto-dismisses.
 * Simultaneously launches confetti and scrolls to the top so the quote is visible.
 */
function showCelebration() {
  const quote = CELEBRATION_QUOTES[Math.floor(Math.random() * CELEBRATION_QUOTES.length)];
  $celebrationBanner.textContent   = quote;
  $celebrationBanner.ariaHidden    = 'false';
  $celebrationBanner.classList.add('visible');

  // Scroll the popup body to top so the celebration banner and quote are in view
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  launchConfetti();

  setTimeout(() => {
    $celebrationBanner.classList.remove('visible');
    setTimeout(() => { $celebrationBanner.ariaHidden = 'true'; }, 300);
  }, CELEBRATION_MS);
}

/**
 * Pure JS canvas confetti — no external libraries.
 *
 * Spawns PARTICLE_COUNT particles from the top of the popup, each with random
 * position, velocity, rotation, size, and colour. An rAF loop runs for
 * DURATION_MS then clears the canvas.
 *
 * Gravity (vy accumulates), slight horizontal drift, and opacity fade near the
 * bottom create a natural falling effect.
 */
function launchConfetti() {
  const canvas = $confettiCanvas;
  const ctx    = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLOURS        = ['#f97316','#ec4899','#22c55e','#3b82f6','#a855f7','#facc15'];
  const PARTICLE_COUNT = 80;
  const DURATION_MS    = 2600;
  const GRAVITY        = 0.28;

  const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x:             Math.random() * canvas.width,
    y:             Math.random() * canvas.height * -0.3,  // start above viewport
    vx:            (Math.random() - 0.5) * 3,
    vy:            Math.random() * 2 + 1,
    rotation:      Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.15,
    width:         Math.random() * 7 + 4,
    height:        Math.random() * 4 + 3,
    colour:        COLOURS[Math.floor(Math.random() * COLOURS.length)],
    opacity:       1,
  }));

  const startTime = Date.now();

  function frame() {
    const elapsed  = Date.now() - startTime;
    const progress = elapsed / DURATION_MS; // 0 → 1

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(p => {
      p.vy        += GRAVITY;
      p.x         += p.vx;
      p.y         += p.vy;
      p.rotation  += p.rotationSpeed;
      // Fade out in the last 40% of the animation
      p.opacity    = progress < 0.6 ? 1 : 1 - ((progress - 0.6) / 0.4);

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.colour;
      ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
      ctx.restore();
    });

    if (elapsed < DURATION_MS) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  requestAnimationFrame(frame);
}

// ─── Monthly calendar ─────────────────────────────────────────────────────────

function renderMonthly() {
  $monthTitle.textContent = formatMonthYear(viewYear, viewMonth);

  const today    = new Date();
  const todayKey = getTodayKey();

  $nextMonth.disabled =
    viewYear > today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth >= today.getMonth());

  $monthGrid.innerHTML = '';

  // JS getDay(): 0=Sun…6=Sat. Shift so Mon=0 (Sun → 6).
  const firstDow    = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Blank padding cells before day 1
  for (let i = 0; i < startOffset; i++) {
    const cell = document.createElement('div');
    cell.className = 'day-cell empty';
    cell.setAttribute('aria-hidden', 'true');
    $monthGrid.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date     = new Date(viewYear, viewMonth, day);
    const key      = getDateKey(date);
    const entry    = appDays[key];
    const isToday  = key === todayKey;
    const isPast   = date < today && !isToday;
    const isFuture = date > today;

    const cell    = document.createElement('div');
    const numEl   = document.createElement('div');
    const emojiEl = document.createElement('div');

    cell.classList.add('day-cell');
    cell.setAttribute('aria-label', date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }));
    numEl.className   = 'day-num';
    numEl.textContent = day;
    emojiEl.className = 'day-emoji';

    if (isFuture) {
      cell.classList.add('future');
      cell.appendChild(numEl);

    } else if (entry?.completed) {
      cell.classList.add('completed');
      if (isToday) cell.classList.add('today-completed');
      emojiEl.textContent = EMOJI_COMPLETE;
      cell.appendChild(numEl);
      cell.appendChild(emojiEl);
      attachTooltip(cell, key, entry);

    } else if (isPast) {
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

function renderYearly() {
  const displayYear = new Date().getFullYear() + viewYearOffset;
  $yearTitle.textContent = displayYear;
  $prevYear.disabled = false;
  $nextYear.disabled = viewYearOffset >= 0;

  $yearGrid.innerHTML    = '';
  $monthLabels.innerHTML = '';

  const today    = new Date();
  const todayKey = getTodayKey();

  // Grid spans from the Monday of the week containing Jan 1
  // to the Sunday of the week containing Dec 31
  const gridStart = getMondayOf(new Date(displayYear, 0, 1));
  const gridEnd   = getSundayOf(new Date(displayYear, 11, 31));

  // Build all week columns
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

  // Month label positions: first week index that contains a day of that month
  const monthFirstWeek = {};
  weeks.forEach((week, wi) => {
    week.forEach(day => {
      if (day.getFullYear() !== displayYear) return;
      const m = day.getMonth();
      if (monthFirstWeek[m] === undefined) monthFirstWeek[m] = wi;
    });
  });

  for (let m = 0; m < 12; m++) {
    if (monthFirstWeek[m] === undefined) continue;
    const nextWeek = m < 11 ? (monthFirstWeek[m + 1] ?? weeks.length) : weeks.length;
    const label = document.createElement('span');
    label.className   = 'month-label-item';
    label.textContent = MONTH_NAMES_SHORT[m];
    label.style.width = (nextWeek - monthFirstWeek[m]) * YEAR_CELL_WIDTH_PX + 'px';
    $monthLabels.appendChild(label);
  }

  weeks.forEach(week => {
    const weekEl = document.createElement('div');
    weekEl.className = 'year-week';

    week.forEach(day => {
      const cell     = document.createElement('div');
      const key      = getDateKey(day);
      const entry    = appDays[key];
      const inYear   = day.getFullYear() === displayYear;
      const isFuture = day > today;

      cell.className = 'year-cell';
      cell.setAttribute('aria-label', day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));

      if (inYear && !isFuture) {
        if (entry?.completed) {
          const s = getStreakAt(key);
          if (s <= STREAK_TIER_LOW)      cell.classList.add('completed-low');
          else if (s <= STREAK_TIER_MID) cell.classList.add('completed-mid');
          else                           cell.classList.add('completed-high');
        } else {
          cell.classList.add('missed');
        }
        attachTooltip(cell, key, entry);
      }

      if (key === todayKey) cell.classList.add('today-cell');
      weekEl.appendChild(cell);
    });

    $yearGrid.appendChild(weekEl);
  });
}

// Returns the Monday of the week containing `date`
function getMondayOf(date) {
  const d   = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d;
}

// Returns the Sunday of the week containing `date`
function getSundayOf(date) {
  const d   = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? 0 : 7 - dow));
  return d;
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function attachTooltip(cell, key, entry) {
  cell.addEventListener('mouseenter', e => {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => showTooltip(e, key, entry), TOOLTIP_DELAY_MS);
  });
  cell.addEventListener('mouseleave', () => { clearTimeout(tooltipTimeout); hideTooltip(); });
  cell.addEventListener('mousemove', positionTooltip);
}

function showTooltip(e, key, entry) {
  const dateStr = parseKey(key).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  const note = entry?.note?.trim() || '';
  const noteHtml = entry?.completed
    ? (note ? `<div class="tt-note">${escapeHtml(note)}</div>` : `<div class="tt-note">${EMOJI_COMPLETE} Logged</div>`)
    : `<div class="tt-note" style="color:#555">Not logged</div>`;

  $tooltip.innerHTML = `<div class="tt-date">${dateStr}</div>${noteHtml}`;
  $tooltip.classList.add('visible');
  positionTooltip(e);
}

function positionTooltip(e) {
  const tw = $tooltip.offsetWidth  || 180;
  const th = $tooltip.offsetHeight || 50;
  let x = e.clientX + 10;
  let y = e.clientY - th - 10;
  if (x + tw > window.innerWidth  - 4) x = e.clientX - tw - 10;
  if (y < 4)                           y = e.clientY + 14;
  $tooltip.style.left = x + 'px';
  $tooltip.style.top  = y + 'px';
}

function hideTooltip() { $tooltip.classList.remove('visible'); }

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── View switching ───────────────────────────────────────────────────────────

function switchView(view) {
  currentView = view;
  const isMonthly = view === 'monthly';
  $btnMonthly.classList.toggle('active', isMonthly);
  $btnYearly.classList.toggle('active', !isMonthly);
  $monthlyView.classList.toggle('hidden', !isMonthly);
  $yearlyView.classList.toggle('hidden', isMonthly);
  isMonthly ? renderMonthly() : renderYearly();
  $calendarArea.classList.add('fade-in');
  $calendarArea.addEventListener('animationend', () => $calendarArea.classList.remove('fade-in'), { once: true });
}

// ─── Share card (PNG export) ──────────────────────────────────────────────────

/**
 * Draws an 800×400 share card on an offscreen canvas and returns it.
 * Respects the current theme so light-mode users get a light card.
 *
 * Layout:
 *   - Background matching current theme
 *   - App name top-left
 *   - Streak count (large, orange→pink gradient) + stat line
 *   - Full year heatmap grid
 *   - Footer tagline
 */
function buildShareCanvas() {
  const W = 800, H = 400;
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const isLight = appSettings.theme === 'light';

  // Theme-aware colours
  const colours = isLight ? {
    bgFrom:    '#f4f2ef',
    bgTo:      '#fff3e8',
    appName:   '#9a9490',
    dayLabel:  '#9a9490',
    stats:     '#6b6460',
    footer:    '#c8c0b8',
    cellEmpty: '#e8e2dc',
    cellMissed:'#f8d8d4',
    cellLow:   '#fdba74',
    cellMid:   '#f97316',
    cellHigh:  '#ea580c',
    cellToday: '#f97316',
  } : {
    bgFrom:    '#0f0f0f',
    bgTo:      '#1a0800',
    appName:   '#555555',
    dayLabel:  '#666666',
    stats:     '#888888',
    footer:    '#333333',
    cellEmpty: '#1c1c1e',
    cellMissed:'#1c1416',
    cellLow:   '#7c2d00',
    cellMid:   '#c2410c',
    cellHigh:  '#f97316',
    cellToday: '#f97316',
  };

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, colours.bgFrom);
  bg.addColorStop(1, colours.bgTo);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle radial glow
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.8);
  glow.addColorStop(0, 'rgba(249,115,22,0.08)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // App name
  ctx.fillStyle = colours.appName;
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('STREAK', 40, 46);

  // Streak count — orange→pink gradient text
  const streakCount = String(calcCurrentStreak(appDays));
  ctx.font = 'bold 72px system-ui, sans-serif';
  const grad = ctx.createLinearGradient(40, 0, 220, 0);
  grad.addColorStop(0, '#f97316');
  grad.addColorStop(1, '#ec4899');
  ctx.fillStyle = grad;
  ctx.fillText(streakCount, 40, 126);

  // "day streak" label
  ctx.fillStyle = colours.dayLabel;
  ctx.font = '500 15px system-ui, sans-serif';
  ctx.letterSpacing = '1px';
  ctx.fillText('day streak', 40, 152);

  // Stats line
  const longest = calcLongestStreak(appDays);
  const total   = calcTotal(appDays);
  ctx.fillStyle = colours.stats;
  ctx.font = '400 13px system-ui, sans-serif';
  ctx.letterSpacing = '0px';
  ctx.fillText(`Longest: ${longest} days   ·   Total: ${total} days`, 40, 180);

  // Heatmap — replicate yearly grid logic
  const displayYear = new Date().getFullYear();
  const today       = new Date();
  const todayKey    = getTodayKey();
  const gridStart   = getMondayOf(new Date(displayYear, 0, 1));
  const gridEnd     = getSundayOf(new Date(displayYear, 11, 31));

  const CELL = 8, GAP = 2, COLS_X = 40, ROWS_Y = 210;
  const cursor = new Date(gridStart);
  let col = 0;

  while (cursor <= gridEnd) {
    for (let row = 0; row < 7; row++) {
      const day    = new Date(cursor);
      day.setDate(day.getDate() + row);

      const key      = getDateKey(day);
      const entry    = appDays[key];
      const inYear   = day.getFullYear() === displayYear;
      const isFuture = day > today;

      let colour = colours.cellEmpty;
      if (inYear && !isFuture) {
        if (entry?.completed) {
          const s = getStreakAt(key);
          colour  = s <= STREAK_TIER_LOW ? colours.cellLow
                  : s <= STREAK_TIER_MID ? colours.cellMid
                  : colours.cellHigh;
        } else {
          colour = colours.cellMissed;
        }
      }
      if (key === todayKey) colour = colours.cellToday;

      ctx.fillStyle    = colour;
      ctx.beginPath();
      ctx.roundRect(COLS_X + col * (CELL + GAP), ROWS_Y + row * (CELL + GAP), CELL, CELL, 2);
      ctx.fill();
    }
    cursor.setDate(cursor.getDate() + 7);
    col++;
  }

  // Footer
  ctx.fillStyle = colours.footer;
  ctx.font = '400 12px system-ui, sans-serif';
  ctx.letterSpacing = '0.5px';
  ctx.fillText('Keep reading. Keep growing.  — streak', 40, H - 24);

  return canvas;
}

function downloadShareCard() {
  const canvas = buildShareCanvas();
  canvas.toBlob(blob => {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = 'my-streak.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

function copyShareCard() {
  const canvas = buildShareCanvas();
  canvas.toBlob(blob => {
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      .then(() => {
        const orig = $shareCopyBtn.textContent;
        $shareCopyBtn.textContent = '✓ Copied!';
        setTimeout(() => { $shareCopyBtn.textContent = orig; }, 2000);
      })
      .catch(() => {
        // Clipboard API may be blocked in some contexts — fall back to download
        downloadShareCard();
      });
  }, 'image/png');
}

// ─── Friend challenge ─────────────────────────────────────────────────────────

/**
 * Encodes last 90 days as a compact bit string ("1" = completed, "0" = missed/unknown).
 * Included in the challenge payload so the recipient can draw a mini heat strip.
 */
function encodeLast90Days(days) {
  let bits = '';
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - 89); // start 89 days ago
  for (let i = 0; i < 90; i++) {
    bits += days[getDateKey(cursor)]?.completed ? '1' : '0';
    cursor.setDate(cursor.getDate() + 1);
  }
  return bits;
}

/**
 * Generates a Base64-encoded challenge code containing public streak stats.
 * Notes are deliberately excluded for privacy.
 */
function generateChallengeCode() {
  const payload = {
    v:       2,                                  // payload version
    name:    appSettings.name?.trim() || 'Friend',
    streak:  calcCurrentStreak(appDays),
    longest: calcLongestStreak(appDays),
    total:   calcTotal(appDays),
    heat:    encodeLast90Days(appDays),
    ts:      Date.now(),
  };
  // btoa produces standard Base64; strip padding for a cleaner-looking code
  return btoa(JSON.stringify(payload)).replace(/=/g, '');
}

/**
 * Decodes a challenge code. Returns the payload object, or null if invalid.
 * Also returns null if the code is older than CHALLENGE_MAX_AGE_MS (7 days).
 */
function decodeChallengeCode(code) {
  try {
    // Re-add stripped padding before decoding
    const padded  = code + '=='.slice(0, (4 - (code.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (!payload?.v || !payload?.heat) return null;
    if (Date.now() - payload.ts > CHALLENGE_MAX_AGE_MS) return { expired: true, name: payload.name };
    return payload;
  } catch {
    return null; // malformed Base64 or JSON
  }
}

/**
 * Regenerates and displays the challenge code in the "Your Code" tab.
 * Called on init (if challenge panel is open) and after saving today.
 */
function refreshChallengeCode() {
  $generatedCode.value = generateChallengeCode();
}

/**
 * Renders the side-by-side comparison panel from a decoded friend payload.
 *
 * Layout:
 *   [Your name]   vs   [Friend name]
 *   🔥 12 days         🔥 8 days
 *   Longest: 29        Longest: 15
 *   [heat strip]       [heat strip]
 */
function renderComparison(friend) {
  const myStreak  = calcCurrentStreak(appDays);
  const myLongest = calcLongestStreak(appDays);
  const myHeat    = encodeLast90Days(appDays);
  const myName    = appSettings.name?.trim() || 'You';

  function heatStrip(bits) {
    const wrap = document.createElement('div');
    wrap.className = 'heat-strip';
    // Show last 30 days for compactness
    const recent = bits.slice(-30);
    for (const bit of recent) {
      const dot = document.createElement('div');
      dot.className = 'heat-dot' + (bit === '1' ? ' on' : '');
      wrap.appendChild(dot);
    }
    return wrap;
  }

  const grid = document.createElement('div');
  grid.className = 'comparison-grid';

  function col(name, streak, longest, heat, alignRight) {
    const c = document.createElement('div');
    c.className = 'comparison-col' + (alignRight ? ' right' : '');
    c.innerHTML = `
      <div class="comparison-name">${escapeHtml(name)}</div>
      <div class="comparison-streak">🔥 ${streak}</div>
      <div class="comparison-meta">Longest: ${longest} days</div>
    `;
    c.appendChild(heatStrip(heat));
    return c;
  }

  const vs = document.createElement('div');
  vs.className   = 'comparison-vs';
  vs.textContent = 'vs';

  grid.appendChild(col(myName,      myStreak,      myLongest,      myHeat,       false));
  grid.appendChild(vs);
  grid.appendChild(col(friend.name, friend.streak, friend.longest, friend.heat,  true));

  $challengeResult.innerHTML = '';
  $challengeResult.appendChild(grid);
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Theme toggle
$themeToggle.addEventListener('click', toggleTheme);

// View toggle
$btnMonthly.addEventListener('click', () => switchView('monthly'));
$btnYearly.addEventListener('click',  () => switchView('yearly'));

// Month navigation
$prevMonth.addEventListener('click', () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderMonthly();
});
$nextMonth.addEventListener('click', () => {
  const today = new Date();
  if (viewYear === today.getFullYear() && viewMonth >= today.getMonth()) return;
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderMonthly();
});

// Year navigation
$prevYear.addEventListener('click', () => { viewYearOffset--; renderYearly(); });
$nextYear.addEventListener('click', () => {
  if (viewYearOffset >= 0) return;
  viewYearOffset++;
  renderYearly();
});

// Mark Today
$markBtn.addEventListener('click', () => {
  if (appDays[getTodayKey()]?.completed) return;
  openNotePanel();
  $markBtn.textContent = 'Adding note…';
  $markBtn.disabled    = true;
});
$noteCancel.addEventListener('click',  () => { closeNotePanel(); updateMarkButton(); });
$noteConfirm.addEventListener('click', saveToday);
$noteInput.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveToday(); });

// Share buttons
$shareDownloadBtn.addEventListener('click', downloadShareCard);
$shareCopyBtn.addEventListener('click', copyShareCard);

// Challenge toggle (expand/collapse)
$challengeToggle.addEventListener('click', () => {
  const isOpen = $challengeSection.classList.toggle('open');
  $challengeBody.classList.toggle('hidden', !isOpen);
  $challengeToggle.setAttribute('aria-expanded', isOpen);
  if (isOpen) refreshChallengeCode();
});

// Challenge tabs
[$tabYourCode, $tabEnterCode].forEach(tab => {
  tab.addEventListener('click', () => {
    const isYours = tab === $tabYourCode;
    $tabYourCode.classList.toggle('active', isYours);
    $tabEnterCode.classList.toggle('active', !isYours);
    $panelYourCode.classList.toggle('hidden', !isYours);
    $panelEnterCode.classList.toggle('hidden', isYours);
  });
});

// Challenge: update code when name changes
$userName.addEventListener('input', () => {
  appSettings.name = $userName.value.trim();
  saveSettings();
  refreshChallengeCode();
});

// Challenge: copy code
$copyCodeBtn.addEventListener('click', () => {
  navigator.clipboard.writeText($generatedCode.value).then(() => {
    const orig = $copyCodeBtn.textContent;
    $copyCodeBtn.textContent = '✓ Copied!';
    setTimeout(() => { $copyCodeBtn.textContent = orig; }, 2000);
  });
});

// Challenge: compare with friend's code
$compareBtn.addEventListener('click', () => {
  const code    = $friendCodeInput.value.trim();
  $challengeResult.innerHTML = '';

  if (!code) return;

  const payload = decodeChallengeCode(code);

  if (!payload) {
    $challengeResult.innerHTML = '<div class="challenge-error">⚠️ Invalid code. Ask your friend to generate a fresh one.</div>';
    return;
  }
  if (payload.expired) {
    $challengeResult.innerHTML = `<div class="challenge-error">⏰ This code from <strong>${escapeHtml(payload.name)}</strong> has expired (codes last 7 days). Ask them to share a new one.</div>`;
    return;
  }

  renderComparison(payload);
});

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Entry point — reads storage, applies theme, then renders everything.
 * All rendering waits for this callback so the popup is never in a partial state.
 */
chrome.storage.local.get(['days', 'longestStreak', 'settings'], (result) => {
  appDays = result.days || {};

  // Restore settings (theme + display name)
  if (result.settings) {
    appSettings = { ...appSettings, ...result.settings };
  }
  applyTheme(appSettings.theme || 'dark');

  // Pre-fill name field if saved
  if (appSettings.name) $userName.value = appSettings.name;

  // Silently fix longestStreak if it's stale (e.g. missed a rollover)
  const computed = calcLongestStreak(appDays);
  const stored   = result.longestStreak || 0;
  if (computed > stored) chrome.storage.local.set({ longestStreak: computed });

  renderQuote();
  updateStats();
  updateMarkButton();
  switchView('monthly');
});

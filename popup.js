/**
 * popup.js — Hustler Extension v3 UI
 *
 * New in v3:
 *   • Multi-category habit tracking (create any habit, independent streaks)
 *   • Multiple notes per day per category (append entries at any time)
 *   • Persistent friend streak (saved friend auto-loads in challenge panel + new tab)
 *   • New tab wallpaper (newtab.html reads same storage)
 *   • Schema migration from v2 flat days → nested days[date][catId]
 *
 * Data flow:
 *   chrome.storage.local → appDays / appCategories / appFriends → render → DOM
 *   User action → update in-memory → chrome.storage.local.set → re-render
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const EMOJI_COMPLETE = '🔥';
const EMOJI_MISSED   = '😢';

const STREAK_TIER_LOW = 7;
const STREAK_TIER_MID = 30;

const TOOLTIP_DELAY_MS  = 200;
const NOTE_ANIMATE_MS   = 400;
const CELEBRATION_MS    = 3000;
const YEAR_CELL_WIDTH_PX = 11;

const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                           'Jul','Aug','Sep','Oct','Nov','Dec'];

const CHALLENGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const PRESET_EMOJIS = ['📚','🏋️','🧘','🎸','🎨','✍️','🏃','🍎','💻','🌱','🎯','🎮'];

const DEFAULT_CATEGORY = { id: 'reading', name: 'Reading', emoji: '📚', createdAt: 0 };

// ─── Celebration quotes ───────────────────────────────────────────────────────

const CELEBRATION_QUOTES = [
  "🎉 You showed up today. That's everything.",
  "🔥 Another day, another victory. You're on fire!",
  "✨ Hustler alive! Your future self is proud of you.",
  "🌟 That's what consistency looks like. Keep it up!",
  "💪 Done! You're building something extraordinary.",
  "🚀 One more day added to your legend. Let's go!",
  "🎯 Nailed it! Your streak grows stronger.",
  "⚡ You did the thing. Champions log every day.",
  "🏆 Today? Crushed. Tomorrow? Same energy!",
];

// ─── Application state ────────────────────────────────────────────────────────

let appDays          = {};
let appCategories    = [DEFAULT_CATEGORY];
let appLongestStreaks = {};
let appFriends       = [];   // array of up to 3 saved friends
let appSettings      = { theme: 'dark', name: '', activeCategoryId: '' };
let activeCatId      = 'reading';

let viewMonth      = new Date().getMonth();
let viewYear       = new Date().getFullYear();
let viewYearOffset = 0;
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
const $entryList        = document.getElementById('entryList');
const $addNoteBtn       = document.getElementById('addNoteBtn');
const $addNoteArea      = document.getElementById('addNoteArea');
const $addNoteInput     = document.getElementById('addNoteInput');
const $addNoteCancel    = document.getElementById('addNoteCancel');
const $addNoteConfirm   = document.getElementById('addNoteConfirm');
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
const $savedFriendsPanel = document.getElementById('savedFriendsPanel');
const $categoryTabs     = document.getElementById('categoryTabs');
const $addCategoryModal = document.getElementById('addCategoryModal');
const $newCatName       = document.getElementById('newCatName');
const $newCatEmoji      = document.getElementById('newCatEmoji');
const $addCatConfirm    = document.getElementById('addCatConfirm');
const $addCatCancel     = document.getElementById('addCatCancel');
const $emojiPicker      = document.getElementById('emojiPicker');

// ─── Migration ────────────────────────────────────────────────────────────────

function needsMigration(days) {
  const vals = Object.values(days);
  if (!vals.length) return false;
  const first = vals[0];
  // Old schema: { completed: bool, note: string }
  // New schema: { [catId]: { completed, entries } }
  return typeof first.completed === 'boolean';
}

function migrateData(result) {
  const oldDays = result.days || {};
  const newDays = {};
  for (const [date, entry] of Object.entries(oldDays)) {
    newDays[date] = {
      reading: {
        completed: entry.completed,
        entries: entry.note ? [{ text: entry.note, ts: 0 }] : [],
      },
    };
  }
  const longestStreaks = { reading: result.longestStreak || 0 };
  chrome.storage.local.set({
    days: newDays,
    categories: [DEFAULT_CATEGORY],
    longestStreaks,
  });
  return { days: newDays, categories: [DEFAULT_CATEGORY], longestStreaks };
}

// ─── Active category slice ────────────────────────────────────────────────────

function getActiveDaysSlice() {
  const slice = {};
  for (const [date, cats] of Object.entries(appDays)) {
    if (cats[activeCatId]) slice[date] = cats[activeCatId];
  }
  return slice;
}

function getActiveCategory() {
  return appCategories.find(c => c.id === activeCatId) || appCategories[0];
}

// ─── Theme ────────────────────────────────────────────────────────────────────

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
  const slice   = getActiveDaysSlice();
  const current = calcCurrentStreak(slice);
  const longest = calcLongestStreak(slice);
  const total   = calcTotal(slice);
  $currentStreak.textContent = current;
  $longestStreak.textContent = longest + (longest === 1 ? ' day' : ' days');
  $totalDays.textContent     = total   + (total   === 1 ? ' day' : ' days');
}

// ─── Daily quote ──────────────────────────────────────────────────────────────

function renderQuote() {
  $quoteText.textContent = getQuoteOfDay();
}

// ─── Category tabs ────────────────────────────────────────────────────────────

function renderCategoryTabs() {
  $categoryTabs.innerHTML = '';
  for (const cat of appCategories) {
    const btn = document.createElement('button');
    btn.className = 'cat-pill' + (cat.id === activeCatId ? ' active' : '');
    btn.dataset.catId = cat.id;
    btn.textContent = cat.emoji + ' ' + cat.name;
    btn.setAttribute('aria-pressed', cat.id === activeCatId);
    btn.addEventListener('click', () => switchCategory(cat.id));
    $categoryTabs.appendChild(btn);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'cat-pill cat-add-btn';
  addBtn.textContent = '+ Add';
  addBtn.setAttribute('aria-label', 'Add new habit category');
  addBtn.addEventListener('click', openAddCategoryModal);
  $categoryTabs.appendChild(addBtn);
}

function switchCategory(catId) {
  activeCatId = catId;
  appSettings.activeCategoryId = catId;
  saveSettings();
  renderCategoryTabs();
  updateStats();
  refreshCalendar();
  updateMarkSection();
}

function openAddCategoryModal() {
  $newCatName.value = '';
  selectedEmoji = PRESET_EMOJIS[0];
  renderEmojiPicker();
  $addCategoryModal.classList.remove('hidden');
  $newCatName.focus();
}

function closeAddCategoryModal() {
  $addCategoryModal.classList.add('hidden');
}

let selectedEmoji = PRESET_EMOJIS[0];

function renderEmojiPicker() {
  $emojiPicker.innerHTML = '';
  for (const emoji of PRESET_EMOJIS) {
    const btn = document.createElement('button');
    btn.className = 'emoji-option' + (emoji === selectedEmoji ? ' selected' : '');
    btn.textContent = emoji;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      selectedEmoji = emoji;
      renderEmojiPicker();
    });
    $emojiPicker.appendChild(btn);
  }
  $newCatEmoji.textContent = selectedEmoji;
}

function addCategory() {
  const name = $newCatName.value.trim();
  if (!name) { $newCatName.focus(); return; }
  const emoji = selectedEmoji;
  const id = crypto.randomUUID();
  const cat = { id, name, emoji, createdAt: Date.now() };
  appCategories.push(cat);
  chrome.storage.local.set({ categories: appCategories }, () => {
    closeAddCategoryModal();
    switchCategory(id);
  });
}

function deleteCategory(catId) {
  if (appCategories.length <= 1) return;
  if (!confirm('Delete this habit and all its data? This cannot be undone.')) return;

  appCategories = appCategories.filter(c => c.id !== catId);
  for (const date of Object.keys(appDays)) {
    delete appDays[date][catId];
  }
  delete appLongestStreaks[catId];

  const nextId = appCategories[0].id;
  chrome.storage.local.set({ days: appDays, categories: appCategories, longestStreaks: appLongestStreaks }, () => {
    switchCategory(nextId);
  });
}

// ─── Mark Today section ───────────────────────────────────────────────────────

function updateMarkSection() {
  const todayKey = getTodayKey();
  const entry    = appDays[todayKey]?.[activeCatId];

  if (entry?.completed) {
    $markBtn.textContent = '✓ Logged today';
    $markBtn.disabled    = true;
    $markBtn.classList.add('logged');
    closeNotePanel(true);
    renderEntryList(entry.entries || []);
    $entryList.classList.remove('hidden');
    $addNoteBtn.classList.remove('hidden');
  } else {
    $markBtn.textContent = 'Mark Today';
    $markBtn.disabled    = false;
    $markBtn.classList.remove('logged');
    $entryList.classList.add('hidden');
    $addNoteBtn.classList.add('hidden');
    closeAddNotePanel(true);
  }
}

// legacy alias used by some internal calls
function updateMarkButton() { updateMarkSection(); }

function renderEntryList(entries) {
  $entryList.innerHTML = '';
  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'entry-empty';
    p.textContent = 'Logged with no notes.';
    $entryList.appendChild(p);
    return;
  }
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = 'entry-item';
    const time = document.createElement('span');
    time.className = 'entry-time';
    time.textContent = entry.ts
      ? new Date(entry.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '';
    const text = document.createElement('span');
    text.className = 'entry-text';
    text.textContent = entry.text;
    div.appendChild(time);
    div.appendChild(text);
    $entryList.appendChild(div);
  }
}

// ─── Note panel (first-time mark) ────────────────────────────────────────────

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

// ─── Add Note panel (additional entries after marking) ───────────────────────

function openAddNotePanel() {
  $addNoteArea.classList.remove('hidden');
  requestAnimationFrame(() => $addNoteArea.classList.add('visible'));
  $addNoteInput.focus();
}

function closeAddNotePanel(immediate = false) {
  $addNoteArea.classList.remove('visible');
  if (immediate) $addNoteArea.classList.add('hidden');
  else setTimeout(() => $addNoteArea.classList.add('hidden'), 220);
  $addNoteInput.value = '';
}

function addEntryToday() {
  const text = $addNoteInput.value.trim();
  if (!text) return;
  const todayKey = getTodayKey();
  const catEntry = appDays[todayKey]?.[activeCatId];
  if (!catEntry) return;
  const newEntry = { text, ts: Date.now() };
  catEntry.entries.push(newEntry);
  chrome.storage.local.set({ days: appDays }, () => {
    closeAddNotePanel();
    renderEntryList(catEntry.entries);
  });
}

// ─── Save today ───────────────────────────────────────────────────────────────

function saveToday() {
  const todayKey = getTodayKey();
  const text     = $noteInput.value.trim();
  if (!appDays[todayKey]) appDays[todayKey] = {};
  appDays[todayKey][activeCatId] = {
    completed: true,
    entries: text ? [{ text, ts: Date.now() }] : [],
  };

  const slice   = getActiveDaysSlice();
  const longest = calcLongestStreak(slice);
  appLongestStreaks = { ...appLongestStreaks, [activeCatId]: longest };

  chrome.storage.local.set({ days: appDays, longestStreaks: appLongestStreaks }, () => {
    closeNotePanel();
    updateMarkSection();
    updateStats();
    refreshCalendar();
    animateTodayCell();
    showCelebration();
    refreshChallengeCode();
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

function showCelebration() {
  const quote = CELEBRATION_QUOTES[Math.floor(Math.random() * CELEBRATION_QUOTES.length)];
  $celebrationBanner.textContent = quote;
  $celebrationBanner.ariaHidden  = 'false';
  $celebrationBanner.classList.add('visible');
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  launchConfetti();
  setTimeout(() => {
    $celebrationBanner.classList.remove('visible');
    setTimeout(() => { $celebrationBanner.ariaHidden = 'true'; }, 300);
  }, CELEBRATION_MS);
}

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
    y:             Math.random() * canvas.height * -0.3,
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
    const progress = elapsed / DURATION_MS;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.vy       += GRAVITY;
      p.x        += p.vx;
      p.y        += p.vy;
      p.rotation += p.rotationSpeed;
      p.opacity   = progress < 0.6 ? 1 : 1 - ((progress - 0.6) / 0.4);
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.colour;
      ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
      ctx.restore();
    });
    if (elapsed < DURATION_MS) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
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

  const firstDow    = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < startOffset; i++) {
    const cell = document.createElement('div');
    cell.className = 'day-cell empty';
    cell.setAttribute('aria-hidden', 'true');
    $monthGrid.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date     = new Date(viewYear, viewMonth, day);
    const key      = getDateKey(date);
    const catEntry = appDays[key]?.[activeCatId];
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
    } else if (catEntry?.completed) {
      cell.classList.add('completed');
      if (isToday) cell.classList.add('today-completed');
      emojiEl.textContent = EMOJI_COMPLETE;
      cell.appendChild(numEl);
      cell.appendChild(emojiEl);
      attachTooltip(cell, key);
    } else if (isPast) {
      cell.classList.add('missed');
      emojiEl.textContent = EMOJI_MISSED;
      cell.appendChild(numEl);
      cell.appendChild(emojiEl);
    } else {
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

  const gridStart = getMondayOf(new Date(displayYear, 0, 1));
  const gridEnd   = getSundayOf(new Date(displayYear, 11, 31));

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
      const catEntry = appDays[key]?.[activeCatId];
      const inYear   = day.getFullYear() === displayYear;
      const isFuture = day > today;

      cell.className = 'year-cell';
      cell.setAttribute('aria-label', day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));

      if (inYear && !isFuture) {
        if (catEntry?.completed) {
          const s = getStreakAt(key);
          if (s <= STREAK_TIER_LOW)      cell.classList.add('completed-low');
          else if (s <= STREAK_TIER_MID) cell.classList.add('completed-mid');
          else                           cell.classList.add('completed-high');
        } else {
          cell.classList.add('missed');
        }
        attachTooltip(cell, key);
      }

      if (key === todayKey) cell.classList.add('today-cell');
      weekEl.appendChild(cell);
    });

    $yearGrid.appendChild(weekEl);
  });
}

function getMondayOf(date) {
  const d   = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d;
}

function getSundayOf(date) {
  const d   = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? 0 : 7 - dow));
  return d;
}

function getStreakAt(key) {
  const slice  = getActiveDaysSlice();
  const cursor = parseKey(key);
  let streak = 0;
  while (true) {
    const k = getDateKey(cursor);
    if (slice[k]?.completed) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  return streak;
}

function formatMonthYear(year, month) {
  return new Date(year, month).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function attachTooltip(cell, key) {
  cell.addEventListener('mouseenter', e => {
    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => showTooltip(e, key), TOOLTIP_DELAY_MS);
  });
  cell.addEventListener('mouseleave', () => { clearTimeout(tooltipTimeout); hideTooltip(); });
  cell.addEventListener('mousemove', positionTooltip);
}

function showTooltip(e, key) {
  const dateStr  = parseKey(key).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  const catEntry = appDays[key]?.[activeCatId];
  const entries  = catEntry?.entries || [];

  let noteHtml;
  if (!catEntry?.completed) {
    noteHtml = `<div class="tt-note" style="color:#555">Not logged</div>`;
  } else if (!entries.length) {
    noteHtml = `<div class="tt-note">${EMOJI_COMPLETE} Logged</div>`;
  } else {
    noteHtml = entries.map(en =>
      `<div class="tt-note">${en.text ? escapeHtml(en.text) : EMOJI_COMPLETE + ' Logged'}</div>`
    ).join('');
  }

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

function buildShareCanvas() {
  const W = 800, H = 400;
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const isLight = appSettings.theme === 'light';
  const colours = isLight ? {
    bgFrom: '#f4f2ef', bgTo: '#fff3e8', appName: '#9a9490', dayLabel: '#9a9490',
    stats: '#6b6460', footer: '#c8c0b8', cellEmpty: '#e8e2dc', cellMissed: '#f8d8d4',
    cellLow: '#fdba74', cellMid: '#f97316', cellHigh: '#ea580c', cellToday: '#f97316',
  } : {
    bgFrom: '#0f0f0f', bgTo: '#1a0800', appName: '#555555', dayLabel: '#666666',
    stats: '#888888', footer: '#333333', cellEmpty: '#1c1c1e', cellMissed: '#1c1416',
    cellLow: '#7c2d00', cellMid: '#c2410c', cellHigh: '#f97316', cellToday: '#f97316',
  };

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, colours.bgFrom);
  bg.addColorStop(1, colours.bgTo);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.8);
  glow.addColorStop(0, 'rgba(249,115,22,0.08)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const cat = getActiveCategory();
  ctx.fillStyle = colours.appName;
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('STREAK', 40, 46);

  const slice = getActiveDaysSlice();
  const streakCount = String(calcCurrentStreak(slice));
  ctx.font = 'bold 72px system-ui, sans-serif';
  const grad = ctx.createLinearGradient(40, 0, 220, 0);
  grad.addColorStop(0, '#f97316');
  grad.addColorStop(1, '#ec4899');
  ctx.fillStyle = grad;
  ctx.fillText(streakCount, 40, 126);

  ctx.fillStyle = colours.dayLabel;
  ctx.font = '500 15px system-ui, sans-serif';
  ctx.letterSpacing = '1px';
  ctx.fillText('day streak', 40, 152);

  ctx.fillStyle = colours.stats;
  ctx.font = '400 13px system-ui, sans-serif';
  ctx.letterSpacing = '0px';
  const longest = calcLongestStreak(slice);
  const total   = calcTotal(slice);
  ctx.fillText(`${cat.emoji} ${cat.name}   ·   Longest: ${longest} days   ·   Total: ${total} days`, 40, 180);

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
      const day = new Date(cursor);
      day.setDate(day.getDate() + row);
      const key      = getDateKey(day);
      const catEntry = appDays[key]?.[activeCatId];
      const inYear   = day.getFullYear() === displayYear;
      const isFuture = day > today;

      let colour = colours.cellEmpty;
      if (inYear && !isFuture) {
        if (catEntry?.completed) {
          const s = getStreakAt(key);
          colour = s <= STREAK_TIER_LOW ? colours.cellLow
                 : s <= STREAK_TIER_MID ? colours.cellMid
                 : colours.cellHigh;
        } else {
          colour = colours.cellMissed;
        }
      }
      if (key === todayKey) colour = colours.cellToday;

      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.roundRect(COLS_X + col * (CELL + GAP), ROWS_Y + row * (CELL + GAP), CELL, CELL, 2);
      ctx.fill();
    }
    cursor.setDate(cursor.getDate() + 7);
    col++;
  }

  ctx.fillStyle = colours.footer;
  ctx.font = '400 12px system-ui, sans-serif';
  ctx.letterSpacing = '0.5px';
  ctx.fillText('Keep going. — hustler', 40, H - 24);

  return canvas;
}

function downloadShareCard() {
  const canvas = buildShareCanvas();
  canvas.toBlob(blob => {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = 'my-hustler.png';
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
      .catch(() => { downloadShareCard(); });
  }, 'image/png');
}

// ─── Friend challenge ─────────────────────────────────────────────────────────

function encodeLast90Days(slice) {
  let bits = '';
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - 89);
  for (let i = 0; i < 90; i++) {
    bits += slice[getDateKey(cursor)]?.completed ? '1' : '0';
    cursor.setDate(cursor.getDate() + 1);
  }
  return bits;
}

// Unicode-safe base64: encode via UTF-8 bytes so emoji in names never break btoa.
function toBase64(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function fromBase64(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
}

function generateChallengeCode() {
  const slice   = getActiveDaysSlice();
  const cat     = getActiveCategory();
  const payload = {
    v:            3,
    name:         appSettings.name?.trim() || 'Friend',
    categoryName: cat.emoji + ' ' + cat.name,
    streak:       calcCurrentStreak(slice),
    longest:      calcLongestStreak(slice),
    total:        calcTotal(slice),
    heat:         encodeLast90Days(slice),
    ts:           Date.now(),
  };
  return toBase64(JSON.stringify(payload)).replace(/=/g, '');
}

function decodeChallengeCode(code) {
  try {
    const padded = code + '=='.slice(0, (4 - (code.length % 4)) % 4);
    // Try new UTF-8 decode first, fall back to plain atob for old v2 codes
    let json;
    try { json = fromBase64(padded); }
    catch { json = atob(padded); }
    const payload = JSON.parse(json);
    if (!payload?.heat) return null;
    if ((payload.v || 2) < 2) return null;
    if (!payload.categoryName) payload.categoryName = 'Reading 📚';
    if (Date.now() - payload.ts > CHALLENGE_MAX_AGE_MS) return { expired: true, name: payload.name };
    return payload;
  } catch {
    return null;
  }
}

function refreshChallengeCode() {
  $generatedCode.value = generateChallengeCode();
}

function renderComparison(friend) {
  const slice     = getActiveDaysSlice();
  const myStreak  = calcCurrentStreak(slice);
  const myLongest = calcLongestStreak(slice);
  const myHeat    = encodeLast90Days(slice);
  const myName    = appSettings.name?.trim() || 'You';
  const cat       = getActiveCategory();

  function heatStrip(bits) {
    const wrap = document.createElement('div');
    wrap.className = 'heat-strip';
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

  function col(name, streak, longest, heat, catLabel, alignRight) {
    const c = document.createElement('div');
    c.className = 'comparison-col' + (alignRight ? ' right' : '');
    c.innerHTML = `
      <div class="comparison-name">${escapeHtml(name)}</div>
      <div class="comparison-cat-label">${escapeHtml(catLabel)}</div>
      <div class="comparison-streak">🔥 ${streak}</div>
      <div class="comparison-meta">Longest: ${longest} days</div>
    `;
    c.appendChild(heatStrip(heat));
    return c;
  }

  const vs = document.createElement('div');
  vs.className   = 'comparison-vs';
  vs.textContent = 'vs';

  grid.appendChild(col(myName,      myStreak,      myLongest,      myHeat,        cat.emoji + ' ' + cat.name, false));
  grid.appendChild(vs);
  grid.appendChild(col(friend.name, friend.streak, friend.longest, friend.heat,   friend.categoryName || '', true));

  $challengeResult.innerHTML = '';
  $challengeResult.appendChild(grid);

  const isAlreadySaved = appFriends.some(f => f.ts === friend.ts);
  const canSaveMore    = appFriends.length < 3;
  if (!isAlreadySaved && canSaveMore) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-friend-btn';
    saveBtn.textContent = '💾 Save this friend';
    saveBtn.addEventListener('click', () => {
      saveFriend(friend);
      saveBtn.textContent = '✓ Saved!';
      saveBtn.disabled = true;
    });
    $challengeResult.appendChild(saveBtn);
  } else if (!isAlreadySaved && !canSaveMore) {
    const note = document.createElement('p');
    note.className = 'challenge-hint';
    note.textContent = 'Remove a saved friend to save this one (max 3).';
    $challengeResult.appendChild(note);
  }
}

// ─── Persistent friends (up to 3) ────────────────────────────────────────────

function saveFriend(payload) {
  if (appFriends.length >= 3) {
    alert('You can save up to 3 friends. Remove one to add another.');
    return;
  }
  // Avoid exact duplicates (same ts)
  if (appFriends.some(f => f.ts === payload.ts)) return;
  appFriends.push({ ...payload, savedAt: Date.now() });
  chrome.storage.local.set({ friends: appFriends }, renderSavedFriends);
}

function clearFriend(index) {
  appFriends.splice(index, 1);
  chrome.storage.local.set({ friends: appFriends }, () => {
    renderSavedFriends();
    $challengeResult.innerHTML = '';
  });
}

function renderSavedFriends() {
  if (!appFriends.length) {
    $savedFriendsPanel.classList.add('hidden');
    $savedFriendsPanel.innerHTML = '';
    return;
  }

  $savedFriendsPanel.classList.remove('hidden');
  $savedFriendsPanel.innerHTML = '';

  for (let i = 0; i < appFriends.length; i++) {
    const f = appFriends[i];
    const daysAgo = Math.floor((Date.now() - f.savedAt) / 86_400_000);
    const agoText = daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;

    const card = document.createElement('div');
    card.className = 'saved-friend-card';
    card.innerHTML = `
      <div class="saved-friend-header">
        <span class="saved-friend-name">${escapeHtml(f.name)}</span>
        <span class="saved-friend-streak">🔥 ${f.streak}</span>
        <span class="saved-friend-cat">${escapeHtml(f.categoryName || '')}</span>
        <span class="saved-friend-ago">${agoText}</span>
        <button class="saved-friend-clear" data-idx="${i}" aria-label="Remove friend">✕</button>
      </div>
    `;
    card.querySelector('.saved-friend-clear').addEventListener('click', () => clearFriend(i));
    // Click card to load comparison
    card.addEventListener('click', e => {
      if (e.target.classList.contains('saved-friend-clear')) return;
      renderComparison(f);
      // Switch to Enter Code tab so comparison is visible
      $tabEnterCode.click();
    });
    $savedFriendsPanel.appendChild(card);
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

$themeToggle.addEventListener('click', toggleTheme);

$btnMonthly.addEventListener('click', () => switchView('monthly'));
$btnYearly.addEventListener('click',  () => switchView('yearly'));

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

$prevYear.addEventListener('click', () => { viewYearOffset--; renderYearly(); });
$nextYear.addEventListener('click', () => {
  if (viewYearOffset >= 0) return;
  viewYearOffset++;
  renderYearly();
});

$markBtn.addEventListener('click', () => {
  if (appDays[getTodayKey()]?.[activeCatId]?.completed) return;
  openNotePanel();
  $markBtn.textContent = 'Adding note…';
  $markBtn.disabled    = true;
});
$noteCancel.addEventListener('click',  () => { closeNotePanel(); updateMarkButton(); });
$noteConfirm.addEventListener('click', saveToday);
$noteInput.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveToday(); });

$addNoteBtn.addEventListener('click', openAddNotePanel);
$addNoteCancel.addEventListener('click',  () => closeAddNotePanel());
$addNoteConfirm.addEventListener('click', addEntryToday);
$addNoteInput.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addEntryToday(); });

$shareDownloadBtn.addEventListener('click', downloadShareCard);
$shareCopyBtn.addEventListener('click', copyShareCard);

$challengeToggle.addEventListener('click', () => {
  const isOpen = $challengeSection.classList.toggle('open');
  $challengeBody.classList.toggle('hidden', !isOpen);
  $challengeToggle.setAttribute('aria-expanded', isOpen);
  // Code is always refreshed on open so it's never stale
  if (isOpen) refreshChallengeCode();
});

[$tabYourCode, $tabEnterCode].forEach(tab => {
  tab.addEventListener('click', () => {
    const isYours = tab === $tabYourCode;
    $tabYourCode.classList.toggle('active', isYours);
    $tabEnterCode.classList.toggle('active', !isYours);
    $panelYourCode.classList.toggle('hidden', !isYours);
    $panelEnterCode.classList.toggle('hidden', isYours);
  });
});

$userName.addEventListener('input', () => {
  appSettings.name = $userName.value.trim();
  saveSettings();
  refreshChallengeCode();
});

$copyCodeBtn.addEventListener('click', () => {
  navigator.clipboard.writeText($generatedCode.value).then(() => {
    const orig = $copyCodeBtn.textContent;
    $copyCodeBtn.textContent = '✓ Copied!';
    setTimeout(() => { $copyCodeBtn.textContent = orig; }, 2000);
  });
});

$compareBtn.addEventListener('click', () => {
  const code = $friendCodeInput.value.trim();
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

$addCatConfirm.addEventListener('click', addCategory);
$addCatCancel.addEventListener('click', closeAddCategoryModal);
$newCatName.addEventListener('keydown', e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') closeAddCategoryModal(); });
$addCategoryModal.addEventListener('click', e => { if (e.target === $addCategoryModal) closeAddCategoryModal(); });

// ─── Initialisation ───────────────────────────────────────────────────────────

chrome.storage.local.get(['days', 'longestStreak', 'longestStreaks', 'categories', 'settings', 'friends', 'friend'], (result) => {
  let days          = result.days || {};
  let categories    = result.categories;
  let longestStreaks = result.longestStreaks || {};

  // Migrate v2 flat schema → v3 nested schema
  if (Object.keys(days).length && needsMigration(days)) {
    const migrated = migrateData(result);
    days           = migrated.days;
    categories     = migrated.categories;
    longestStreaks  = migrated.longestStreaks;
  }

  appDays          = days;
  appCategories    = categories || [DEFAULT_CATEGORY];
  appLongestStreaks = longestStreaks;

  // Migrate old single 'friend' → new 'friends' array
  if (result.friends) {
    appFriends = result.friends.filter(Boolean);
  } else if (result.friend) {
    appFriends = [result.friend];
    chrome.storage.local.set({ friends: appFriends });
    chrome.storage.local.remove('friend');
  }

  if (result.settings) {
    appSettings = { ...appSettings, ...result.settings };
  }
  applyTheme(appSettings.theme || 'dark');

  const savedCatId = appSettings.activeCategoryId;
  if (savedCatId && appCategories.find(c => c.id === savedCatId)) {
    activeCatId = savedCatId;
  } else {
    activeCatId = appCategories[0].id;
  }

  if (appSettings.name) $userName.value = appSettings.name;

  selectedEmoji = PRESET_EMOJIS[0];

  renderQuote();
  renderCategoryTabs();
  updateStats();
  updateMarkSection();
  switchView('monthly');

  // Always generate code so it's ready the moment the panel opens
  refreshChallengeCode();

  // Show saved friends
  renderSavedFriends();
});

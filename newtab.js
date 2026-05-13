'use strict';

const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

function formatFullDate(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeIcon').textContent = theme === 'dark' ? '🌙' : '☀️';
}

// ─── State ────────────────────────────────────────────────────────────────────

let ntDays       = {};
let ntCategories = [];
let ntActiveCatId = '';

// ─── Render selected category stats ──────────────────────────────────────────

function renderSelectedCategory(catId) {
  ntActiveCatId = catId;
  const cat    = ntCategories.find(c => c.id === catId) || ntCategories[0];
  const slice  = buildCategorySlice(ntDays, catId);
  const streak = calcCurrentStreak(slice);
  const longest = calcLongestStreak(slice);
  const total   = calcTotal(slice);

  document.getElementById('streakCount').textContent = streak;
  document.getElementById('catName').textContent     = cat.emoji + ' ' + cat.name;
  document.getElementById('statLongest').textContent = 'Longest: ' + longest + (longest === 1 ? ' day' : ' days');
  document.getElementById('statTotal').textContent   = 'Total: '   + total   + (total   === 1 ? ' day' : ' days');

  // Update active pill styling
  document.querySelectorAll('.nt-cat-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.catId === catId);
  });
}

// ─── Category pills ───────────────────────────────────────────────────────────

function renderCategoryTabs(activeCatId) {
  const container = document.getElementById('ntCategoryTabs');
  container.innerHTML = '';

  // Only render pills if there's more than 1 habit
  if (ntCategories.length <= 1) return;

  for (const cat of ntCategories) {
    const btn = document.createElement('button');
    btn.className = 'nt-cat-pill' + (cat.id === activeCatId ? ' active' : '');
    btn.dataset.catId = cat.id;
    btn.textContent = cat.emoji + ' ' + cat.name;
    btn.addEventListener('click', () => renderSelectedCategory(cat.id));
    container.appendChild(btn);
  }
}

// ─── All habits summary row ───────────────────────────────────────────────────

function renderAllHabits() {
  const row = document.getElementById('allHabitsRow');
  row.innerHTML = '';

  // Only show when there are 2+ categories
  if (ntCategories.length <= 1) return;

  const todayKey = getTodayKey();

  for (const cat of ntCategories) {
    const slice   = buildCategorySlice(ntDays, cat.id);
    const streak  = calcCurrentStreak(slice);
    const logged  = ntDays[todayKey]?.[cat.id]?.completed || false;

    const chip = document.createElement('div');
    chip.className = 'habit-chip' + (logged ? ' logged' : '');
    chip.innerHTML = `
      <span class="habit-chip-emoji">${cat.emoji}</span>
      <span class="habit-chip-name">${escapeHtml(cat.name)}</span>
      <span class="habit-chip-streak">${streak}🔥</span>
      ${logged ? '<span class="habit-chip-done">✓</span>' : ''}
    `;
    chip.addEventListener('click', () => renderSelectedCategory(cat.id));
    row.appendChild(chip);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Friends area (up to 3) ───────────────────────────────────────────────────

function renderFriendsArea(friends) {
  const area = document.getElementById('friendsArea');
  area.innerHTML = '';
  if (!friends || !friends.length) return;

  for (const friend of friends) {
    if (!friend) continue;
    const strip = document.createElement('div');
    strip.className = 'friend-strip';
    strip.innerHTML = `
      <span class="friend-strip-label">vs</span>
      <div class="friend-divider"></div>
      <span class="friend-strip-name">${escapeHtml(friend.name)}</span>
      <span class="friend-strip-streak">🔥 ${friend.streak}</span>
      <span class="friend-strip-cat">${escapeHtml(friend.categoryName || '')}</span>
    `;
    area.appendChild(strip);
  }
}

// ─── Notification: fire once per day if active habit not yet logged ───────────

function checkAndNotify(days, categories, settings) {
  const todayKey    = getTodayKey();
  const today       = new Date().toDateString();
  const lastNotified = sessionStorage.getItem('streak_notified_date');
  if (lastNotified === today) return; // already notified this session's first open

  const activeCatId = settings.activeCategoryId || (categories[0]?.id || 'reading');

  let alreadyLogged;
  // Handle either schema shape
  const firstDayVal = Object.values(days)[0];
  const isOldSchema = firstDayVal && typeof firstDayVal.completed === 'boolean';
  if (isOldSchema) {
    alreadyLogged = days[todayKey]?.completed;
  } else {
    alreadyLogged = days[todayKey]?.[activeCatId]?.completed;
  }

  if (alreadyLogged) return;

  sessionStorage.setItem('streak_notified_date', today);

  const cat = categories.find(c => c.id === activeCatId) || categories[0];
  const catLabel = cat ? `${cat.emoji} ${cat.name}` : 'your habit';

  const MESSAGES = [
    `Don't break your streak! Log ${catLabel} before midnight 🔥`,
    `Your streak is waiting — a few minutes for ${catLabel} keeps it alive 💪`,
    `Keep it going! Log ${catLabel} today and stay on track 🌟`,
    `Small wins add up. Log ${catLabel} today! ✨`,
  ];
  const msg = MESSAGES[new Date().getDate() % MESSAGES.length];

  if (Notification.permission === 'granted') {
    new Notification("Don't break your streak! 🔥", {
      body:    msg,
      icon:    '/icons/icon128.png',
      silent:  false,
      tag:     'streak-daily',
    });
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        new Notification("Don't break your streak! 🔥", { body: msg, tag: 'streak-daily' });
      }
    });
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

chrome.storage.local.get(['days', 'categories', 'settings', 'friends'], (result) => {
  const settings = result.settings || {};
  applyTheme(settings.theme || 'dark');

  ntDays       = result.days || {};
  ntCategories = result.categories || [{ id: 'reading', name: 'Reading', emoji: '📚' }];

  const savedCatId = settings.activeCategoryId;
  const startCatId = (savedCatId && ntCategories.find(c => c.id === savedCatId))
    ? savedCatId
    : ntCategories[0].id;

  renderCategoryTabs(startCatId);
  renderSelectedCategory(startCatId);
  renderAllHabits();

  document.getElementById('quoteText').textContent = getQuoteOfDay();
  document.getElementById('todayDate').textContent = formatFullDate(new Date());

  // Friends (up to 3)
  const friends = (result.friends || []).filter(Boolean);
  renderFriendsArea(friends);

  // Notify on tab open (once per day)
  checkAndNotify(ntDays, ntCategories, settings);
});

document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next    = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  chrome.storage.local.get('settings', (r) => {
    const s = r.settings || {};
    s.theme = next;
    chrome.storage.local.set({ settings: s });
  });
});

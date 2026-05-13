/**
 * background.js — Streak Extension v3 Service Worker
 *
 * Responsibilities:
 *   1. Schedule two daily alarms on install/startup:
 *        • "daily-reminder"    → 9:00 PM  — notify if active category not logged
 *        • "midnight-rollover" → 12:01 AM — seal yesterday as missed per category
 *   2. Handle those alarms when they fire.
 *
 * Storage schema (v3):
 *   {
 *     categories: [{ id, name, emoji, createdAt }],
 *     days: { "YYYY-MM-DD": { [catId]: { completed: boolean, entries: [] } } },
 *     longestStreaks: { [catId]: number },
 *     settings: { name, theme, activeCategoryId }
 *   }
 */

const ALARM_ROLLOVER  = 'midnight-rollover';
const ROLLOVER_HOUR   = 0;
const ROLLOVER_MINUTE = 1;
const MS_PER_DAY      = 86_400_000;
const MINUTES_PER_DAY = 1440;

const DEFAULT_CAT_ID = 'reading';

// ─── Date utilities ───────────────────────────────────────────────────────────

function getDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayKey() { return getDateKey(new Date()); }

// ─── Streak calculation (operates on a flat per-category slice) ───────────────

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

function calcLongestStreak(days) {
  const keys = Object.keys(days).filter(k => days[k].completed).sort();
  let longest = 0, current = 0, prevDate = null;
  for (const key of keys) {
    const date = new Date(key + 'T00:00:00');
    const diff = prevDate ? Math.round((date - prevDate) / MS_PER_DAY) : null;
    current    = diff === 1 ? current + 1 : 1;
    if (current > longest) longest = current;
    prevDate   = date;
  }
  return longest;
}

// Builds a { "YYYY-MM-DD": { completed, entries } } slice for a single category.
function buildCategorySlice(days, catId) {
  const slice = {};
  for (const [date, cats] of Object.entries(days)) {
    if (cats[catId]) slice[date] = cats[catId];
  }
  return slice;
}

// ─── Schema detection ─────────────────────────────────────────────────────────

function isOldSchema(days) {
  const vals = Object.values(days);
  if (!vals.length) return false;
  return typeof vals[0].completed === 'boolean';
}

// ─── Alarm scheduling ─────────────────────────────────────────────────────────

function getNextAlarmTime(hour, minute = 0) {
  const now  = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

// Background only handles the midnight rollover alarm.
// Notifications were removed in v3 — users see their streak on every new tab open.

function scheduleAlarms() {
  chrome.alarms.getAll((existingAlarms) => {
    const existingNames = new Set(existingAlarms.map(a => a.name));

    if (!existingNames.has(ALARM_ROLLOVER)) {
      chrome.alarms.create(ALARM_ROLLOVER, {
        when: getNextAlarmTime(ROLLOVER_HOUR, ROLLOVER_MINUTE),
        periodInMinutes: MINUTES_PER_DAY,
      });
    }

    // Clean up old reminder alarm if it still exists from v2
    if (existingNames.has('daily-reminder')) {
      chrome.alarms.clear('daily-reminder');
    }
  });
}

// ─── Lifecycle listeners ──────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => { scheduleAlarms(); });
chrome.runtime.onStartup.addListener(()   => { scheduleAlarms(); });

// ─── Alarm handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_ROLLOVER) handleRolloverAlarm();
});

function handleRolloverAlarm() {
  chrome.storage.local.get(['days', 'categories', 'longestStreaks', 'longestStreak'], (result) => {
    const days = result.days || {};

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getDateKey(yesterday);

    // Handle old schema gracefully (migration hasn't run yet — user hasn't opened popup)
    if (isOldSchema(days)) {
      if (days[yesterdayKey] === undefined) {
        days[yesterdayKey] = { completed: false, entries: [] };
      }
      const longest = Math.max(calcLongestStreak(days), result.longestStreak || 0);
      chrome.storage.local.set({ days, longestStreak: longest });
      return;
    }

    // New schema: write missed entry per category
    const categories = result.categories || [{ id: DEFAULT_CAT_ID }];
    if (!days[yesterdayKey]) days[yesterdayKey] = {};

    for (const cat of categories) {
      if (!days[yesterdayKey][cat.id]) {
        days[yesterdayKey][cat.id] = { completed: false, entries: [] };
      }
    }

    // Recompute longest streak per category
    const longestStreaks = { ...(result.longestStreaks || {}) };
    for (const cat of categories) {
      const slice   = buildCategorySlice(days, cat.id);
      const longest = calcLongestStreak(slice);
      longestStreaks[cat.id] = Math.max(longest, longestStreaks[cat.id] || 0);
    }

    chrome.storage.local.set({ days, longestStreaks });
  });
}

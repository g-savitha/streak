/**
 * background.js — Streak Extension Service Worker
 *
 * Responsibilities:
 *   1. Schedule two daily alarms on install/startup:
 *        • "daily-reminder"   → 9:00 PM  — notify user if today isn't logged yet
 *        • "midnight-rollover" → 12:01 AM — seal yesterday as missed, recompute longest streak
 *   2. Handle those alarms when they fire.
 *
 * Why a service worker (not a persistent background page)?
 *   Manifest V3 requires service workers. They can be terminated by Chrome at
 *   any time and are restarted on events, so all state lives in chrome.storage.
 *
 * Storage schema (chrome.storage.local):
 *   {
 *     days: {
 *       "YYYY-MM-DD": { completed: boolean, note: string }
 *     },
 *     longestStreak: number,   // cached to avoid recomputing on every popup open
 *     settings: {
 *       name: string,          // display name for challenge codes
 *       theme: string          // 'dark' | 'light'
 *     }
 *   }
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const ALARM_REMINDER  = 'daily-reminder';
const ALARM_ROLLOVER  = 'midnight-rollover';
const REMINDER_HOUR   = 21;   // 9 PM local time
const ROLLOVER_HOUR   = 0;
const ROLLOVER_MINUTE = 1;    // 12:01 AM — one minute after midnight to be safe
const MS_PER_DAY      = 86_400_000;
const MINUTES_PER_DAY = 1440;

// ─── Date utilities ───────────────────────────────────────────────────────────

/**
 * Returns a "YYYY-MM-DD" key for a given Date in local time.
 * Always use this instead of toISOString(), which returns UTC and can be
 * off by one day near midnight depending on the user's timezone.
 */
function getDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Shorthand for today's key. */
function getTodayKey() {
  return getDateKey(new Date());
}

// ─── Streak calculations ──────────────────────────────────────────────────────

/**
 * Counts consecutive completed days ending at today (or yesterday if today
 * hasn't been logged yet). This is the "live" current streak shown in the UI.
 *
 * Logic:
 *   - If today is completed, count backwards from today.
 *   - If today is NOT completed, count backwards from yesterday (streak is
 *     still alive — she has until midnight).
 *   - Stop at the first gap or missed day.
 */
function calcCurrentStreak(days) {
  const todayKey = getTodayKey();
  const cursor   = new Date(); // mutated in loop — start from today

  // If today hasn't been logged, treat yesterday as the latest possible day
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
      break;
    }
  }
  return streak;
}

/**
 * Finds the longest consecutive completed-day run across all stored history.
 * Called after the midnight rollover writes a missed-day entry, so longestStreak
 * in storage always reflects the true all-time best.
 *
 * Uses `new Date(key + 'T00:00:00')` (local midnight) rather than
 * `new Date(key)` to avoid UTC-offset issues when computing day diffs.
 */
function calcLongestStreak(days) {
  // Only consider completed days; sort chronologically
  const completedKeys = Object.keys(days)
    .filter(key => days[key].completed)
    .sort(); // ISO format sorts lexicographically = chronologically

  let longest = 0;
  let current = 0;
  let prevDate = null;

  for (const key of completedKeys) {
    const date = new Date(key + 'T00:00:00');

    if (prevDate !== null) {
      const daysDiff = Math.round((date - prevDate) / MS_PER_DAY);
      current = daysDiff === 1 ? current + 1 : 1; // consecutive → extend; gap → reset
    } else {
      current = 1; // first completed day
    }

    if (current > longest) longest = current;
    prevDate = date;
  }

  return longest;
}

// ─── Alarm scheduling ─────────────────────────────────────────────────────────

/**
 * Returns the Unix timestamp (ms) for the next occurrence of a given
 * local-time hour:minute. If that time has already passed today, it
 * returns tomorrow's occurrence.
 *
 * Chrome alarm `when` values must be in the future; this ensures we never
 * schedule an alarm in the past.
 */
function getNextAlarmTime(hour, minute = 0) {
  const now  = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1); // already passed today → use tomorrow
  }

  return next.getTime();
}

/**
 * Creates the two daily alarms if they don't already exist.
 * Called on install AND on startup, because Chrome may clear alarms
 * when the extension is updated or Chrome is restarted.
 *
 * We check existence before creating to avoid resetting the schedule
 * on every Chrome startup if the alarm is already set.
 */
function scheduleAlarms() {
  chrome.alarms.getAll((existingAlarms) => {
    const existingNames = new Set(existingAlarms.map(a => a.name));

    if (!existingNames.has(ALARM_REMINDER)) {
      chrome.alarms.create(ALARM_REMINDER, {
        when: getNextAlarmTime(REMINDER_HOUR),
        periodInMinutes: MINUTES_PER_DAY,
      });
      console.log(`[Streak] Scheduled alarm: ${ALARM_REMINDER} at ${REMINDER_HOUR}:00`);
    }

    if (!existingNames.has(ALARM_ROLLOVER)) {
      chrome.alarms.create(ALARM_ROLLOVER, {
        when: getNextAlarmTime(ROLLOVER_HOUR, ROLLOVER_MINUTE),
        periodInMinutes: MINUTES_PER_DAY,
      });
      console.log(`[Streak] Scheduled alarm: ${ALARM_ROLLOVER} at ${ROLLOVER_HOUR}:${String(ROLLOVER_MINUTE).padStart(2,'0')}`);
    }
  });
}

// ─── Lifecycle listeners ──────────────────────────────────────────────────────

// First install or extension update
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[Streak] onInstalled reason=${details.reason}`);
  scheduleAlarms();
});

// Browser restart — Chrome may have cleared alarms
chrome.runtime.onStartup.addListener(() => {
  console.log('[Streak] onStartup — verifying alarms');
  scheduleAlarms();
});

// ─── Alarm handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  console.log(`[Streak] Alarm fired: ${alarm.name}`);

  if (alarm.name === ALARM_REMINDER) {
    handleReminderAlarm();
  } else if (alarm.name === ALARM_ROLLOVER) {
    handleRolloverAlarm();
  }
});

/**
 * Motivational reminder messages — rotated by day-of-month so it feels fresh.
 * Chosen to feel encouraging rather than nagging.
 */
const REMINDER_MESSAGES = [
  "There's still time — even 10 minutes of reading counts. You've got this! 🔥",
  "Your streak is waiting. A few pages before midnight keeps it alive 💪",
  "Don't let today slip away. You're one habit away from a new high streak!",
  "Hey! The best time to read is right now. Your future self will thank you 📚",
  "Small steps, big dreams. Log today's reading before midnight 🌙",
  "You've built something beautiful. Don't let it end tonight — go read! ✨",
];

/**
 * 9 PM reminder: send a notification only if today hasn't been logged.
 * If she already logged, stay silent — no need to nag.
 */
function handleReminderAlarm() {
  chrome.storage.local.get(['days'], (result) => {
    const days     = result.days || {};
    const todayKey = getTodayKey();

    if (days[todayKey]?.completed) {
      console.log('[Streak] Reminder skipped — today already logged');
      return;
    }

    // Rotate through messages by day-of-month so it feels fresh each day
    const msg = REMINDER_MESSAGES[new Date().getDate() % REMINDER_MESSAGES.length];

    chrome.notifications.create(ALARM_REMINDER, {
      type:     'basic',
      iconUrl:  'icons/icon128.png',
      title:    "Don't break your streak! 🔥",
      message:  msg,
      priority: 2,
    });

    console.log('[Streak] Reminder notification sent');
  });
}

/**
 * Midnight rollover: run at 12:01 AM.
 *   1. If yesterday has no entry at all, write { completed: false, note: '' }
 *      so the calendar correctly shows it as a missed day.
 *   2. Recompute and persist longestStreak in case it changed.
 *
 * We do NOT touch today's entry here — the user may still log today.
 */
function handleRolloverAlarm() {
  chrome.storage.local.get(['days', 'longestStreak'], (result) => {
    const days = result.days || {};

    // "Yesterday" from the perspective of 12:01 AM is the day that just ended
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getDateKey(yesterday);

    if (days[yesterdayKey] === undefined) {
      days[yesterdayKey] = { completed: false, note: '' };
      console.log(`[Streak] Marked ${yesterdayKey} as missed`);
    }

    const newLongest  = calcLongestStreak(days);
    const prevLongest = result.longestStreak || 0;
    const longest     = Math.max(newLongest, prevLongest);

    chrome.storage.local.set({ days, longestStreak: longest }, () => {
      console.log(`[Streak] Rollover complete. longestStreak=${longest}`);
    });
  });
}

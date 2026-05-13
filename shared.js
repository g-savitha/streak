'use strict';

// ─── Date utilities ───────────────────────────────────────────────────────────

function getDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayKey() { return getDateKey(new Date()); }

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ─── Streak calculations (operate on a flat { "YYYY-MM-DD": { completed, entries } } slice) ──

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
    const diff = prevDate ? Math.round((date - prevDate) / 86_400_000) : null;
    current    = diff === 1 ? current + 1 : 1;
    if (current > longest) longest = current;
    prevDate = date;
  }
  return longest;
}

function calcTotal(days) {
  return Object.values(days).filter(e => e.completed).length;
}

// ─── Category helper ──────────────────────────────────────────────────────────

function buildCategorySlice(days, catId) {
  const slice = {};
  for (const [date, cats] of Object.entries(days)) {
    if (cats[catId]) slice[date] = cats[catId];
  }
  return slice;
}

// ─── Quotes ───────────────────────────────────────────────────────────────────

const QUOTES = [
  "You have to dream before your dreams can come true. — APJ Abdul Kalam",
  "Excellence is a continuous process and not an accident. — APJ Abdul Kalam",
  "If you want to shine like a sun, first burn like a sun. — APJ Abdul Kalam",
  "Learning gives creativity, creativity leads to thinking, thinking provides knowledge, knowledge makes you great. — APJ Abdul Kalam",
  "Arise, awake and do not stop until the goal is reached. — Swami Vivekananda",
  "Take up one idea. Make it your life — think of it, dream of it, live on it. — Swami Vivekananda",
  "All the strength and succour you want is within yourself. — Swami Vivekananda",
  "The greatest sin is to think yourself weak. — Swami Vivekananda",
  "Stay hungry, stay foolish. — Steve Jobs",
  "The people who are crazy enough to think they can change the world are the ones who do. — Steve Jobs",
  "Your time is limited, so don't waste it living someone else's life. — Steve Jobs",
  "The only way to do great work is to love what you do. — Steve Jobs",
  "Today is hard, tomorrow will be worse, but the day after tomorrow will be sunshine. — Jack Ma",
  "If you don't give up, you still have a chance. — Jack Ma",
  "No matter how tough the chase is, you should always have the dream you saw on the first day. — Jack Ma",
  "When something is important enough, you do it even if the odds are not in your favour. — Elon Musk",
  "Persistence is very important. You should not give up unless you are forced to give up. — Elon Musk",
  "Work like hell. I mean you just have to put in 80–100 hour weeks every week. — Elon Musk",
  "Every day is a new opportunity to grow. Use it. — Gary Vee",
  "Read what you love until you love to read. — Naval Ravikant",
  "The best investment you can make is in yourself. — Naval Ravikant",
  "Specific knowledge is knowledge you cannot be trained for. — Naval Ravikant",
  "A calm mind, a fit body, a house full of books. Pick three. — Naval Ravikant",
  "The more you learn, the more you earn. — Warren Buffett",
  "Someone is sitting in the shade today because someone planted a tree a long time ago. — Warren Buffett",
  "You do not rise to the level of your goals. You fall to the level of your systems. — James Clear",
  "Every action you take is a vote for the type of person you wish to become. — James Clear",
  "The most practical way to change who you are is to change what you do. — James Clear",
  "Success is the product of daily habits — not once-in-a-lifetime transformations. — James Clear",
];

function getQuoteOfDay() {
  return QUOTES[Math.floor(Date.now() / 86_400_000) % QUOTES.length];
}

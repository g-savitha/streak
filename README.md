# Hustler

A Chrome extension for tracking daily habits and streaks. Mark any habit complete each day, add timestamped notes, and watch per-habit streaks grow — all without an account or a server.

---

## Features

- **Multi-habit categories** — create Reading, Workout, Meditation, or any custom habit with an emoji
- **New tab wallpaper** — your active streak is front and center every time you open a tab
- **Mark from the new tab** — log today's habit without opening the popup
- **Monthly calendar** — Mon–Sun grid with 🔥 for logged days, 😢 for missed days; navigate back to any month
- **Yearly heatmap** — GitHub-style contribution grid, orange intensity scaled to streak length; export as PNG or copy to clipboard
- **Multiple notes per day** — add timestamped entries for a single day; hover any 🔥 cell to see them
- **Friend challenge codes** — encode your streak as a shareable Base64 code; save up to 3 friends and see their streaks on the wallpaper
- **Dark / light theme** — persisted to storage; popup and new tab each read the preference on load

---

## Installation (Developer Mode)

1. **Generate icons** — open `generate-icons.html` in Chrome, download the three PNGs, place them in `icons/`
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `streak/` folder
5. Click the 🔥 icon in the toolbar to open the popup

---

## Project Structure

```
streak/
├── manifest.json          Chrome extension manifest (MV3)
├── background.js          Service worker — midnight rollover, longestStreaks recompute
├── shared.js              Pure utilities — date helpers, streak math, quotes (used by popup + newtab)
├── popup.html             Extension popup markup
├── popup.css              All popup styles — dark theme, animations, calendar, challenge section
├── popup.js               All popup logic — categories, calendar, entries, friend challenges, storage
├── newtab.html            New tab override page markup
├── newtab.css             New tab styles — full-viewport, category pills, friend strips
├── newtab.js              New tab logic — renders wallpaper, handles mark-today
├── generate-icons.html    Dev utility — open in browser to download icon PNGs (not a runtime file)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Data Model (v3)

All data is stored in `chrome.storage.local`. No data ever leaves the device.

```js
{
  // One entry per habit category
  categories: [
    { id: "reading", name: "Reading", emoji: "📚", createdAt: 1715000000000 },
    { id: "550e...", name: "Workout", emoji: "🏋️", createdAt: 1715100000000 }
  ],

  // Nested: date → categoryId → { completed, entries[] }
  days: {
    "2026-05-13": {
      "reading": {
        completed: true,
        entries: [
          { text: "Finished chapter 4 of SICP", ts: 1747123456789 }
        ]
      },
      "550e...": {
        completed: true,
        entries: []
      }
    },
    "2026-05-12": {
      "reading": { completed: false, entries: [] }
    }
  },

  // Cached longest streak per category
  longestStreaks: { "reading": 42, "550e...": 7 },

  settings: {
    theme: "dark",           // "dark" | "light"
    name: "Savvy",           // display name for challenge codes
    activeCategoryId: "reading"
  },

  // Up to 3 saved friends (decoded from challenge codes)
  friends: [
    {
      name: "Priya", streak: 38, longest: 45, total: 120,
      heat: "...",           // base64 bit-array of last 90 days
      categoryName: "📚 Reading",
      savedAt: 1747000000000
    }
  ]
}
```

Keys are `YYYY-MM-DD` in **local time** (never UTC).

---

## Tech Stack

- **Vanilla JS + CSS** — no build step, no npm, no bundler
- **Manifest V3** — service worker background script
- **chrome.storage.local** — all persistence, no external server
- **chrome.alarms** — midnight rollover only (no push notifications)

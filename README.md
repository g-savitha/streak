# 🔥 Streak

A premium Chrome extension for tracking your daily reading habit. Mark each day as complete, add a note about what you read, and watch your streak grow.

---

## Features

- **Daily logging** — mark today as read with an optional note about what you studied
- **Monthly calendar** — Mon–Sun grid with 🔥 for logged days, 😢 for missed days
- **Yearly heatmap** — GitHub-style contribution grid with orange intensity based on streak length
- **Hover tooltips** — hover any 🔥 cell to see the note you wrote that day
- **Streak stats** — current streak, longest streak ever, total days logged
- **9 PM reminder** — Chrome notification fires if you haven't logged by evening
- **Midnight rollover** — background service worker seals missed days at 12:01 AM

---

## Screenshots

> Load the extension and open the popup to see it in action.

---

## Installation (Developer Mode)

1. **Generate icons** — open `generate-icons.html` in Chrome, download the three PNGs, place them in `icons/`
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `streak/` folder
5. Click the 🔥 icon in your toolbar

---

## Project Structure

```
streak/
├── manifest.json          Chrome extension manifest (MV3)
├── background.js          Service worker — alarms, notifications, midnight rollover
├── popup.html             Extension popup markup
├── popup.css              All styles — dark theme, glassmorphism, animations
├── popup.js               All UI logic — calendars, streaks, tooltips, storage
├── generate-icons.html    Open in browser to download icon PNGs
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Data Model

All data is stored in `chrome.storage.local`:

```json
{
  "days": {
    "2026-05-12": { "completed": true,  "note": "Read 20 pages of SICP" },
    "2026-05-11": { "completed": false, "note": "" }
  },
  "longestStreak": 29
}
```

Keys are `YYYY-MM-DD` strings in local time.

---

## Tech Stack

- **Vanilla JS + CSS** — no build step, no npm, no bundler
- **Manifest V3** — service worker background script
- **chrome.storage.local** — all persistence, no external server
- **chrome.alarms + chrome.notifications** — daily reminders

---

## Roadmap (v2)

See [AGENTS.md](AGENTS.md) for the full v2 feature plan.

- Glassmorphism UI + gradient accents
- Light / dark mode toggle
- Daily motivational quote
- Confetti + celebration animation on mark
- Shareable PNG export of your heatmap
- Code-based friend challenge (no backend)
- Motivational reminder notification copy

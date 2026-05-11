# AGENTS.md — Streak Extension: Agent Instructions & Product Context

This file exists so that future AI agents (or humans) picking up this codebase have full context on what was built, why, and what comes next. Read this before making any changes.

---

## What this is

A Chrome extension (Manifest V3) for daily reading habit tracking. Built for a single user — she opens the popup, marks the day as complete after reading, optionally writes a note, and her streak grows. If she misses a day, the streak resets at midnight.

**No backend. No accounts. No npm. No build step.** Everything runs in the browser.

---

## Original instructions from the product owner

> I want to build a Chrome extension for my friend, where she can track her progress everyday. Whenever she reads something, she comes and marks the day as complete. 24 hrs time should be there — if she doesn't mark that day that means streak is gone.
>
> I want a premium-looking streak. It should have a yearly calendar. Longest streak maintained. A note option where she can write what she has studied that day. When hovered over the fire emoji it should show the note that she added.

### Decisions made during v1

| Decision | Reasoning |
|---|---|
| Chrome local storage (not sync) | Single device; simpler; no sync needed |
| Popup (not new tab override) | Quick access without disrupting browsing |
| Both monthly + yearly views | Monthly for daily use; yearly for the big picture |
| 9 PM reminder notification | Enough time to still read before midnight |
| Vanilla JS, no build step | Load directly as unpacked extension; no tooling friction |
| Mon–Sun column order | User is based in India; Monday-first is standard |

---

## v1 Feature Set (shipped)

- Monthly calendar — Mon–Sun grid, navigate backwards, forward blocked at current month
- Yearly heatmap — GitHub-style, orange intensity = streak length at that day
- Mark Today flow — click button → textarea slides down → optional note → Cmd+Enter or Save button
- Hover tooltip — shows date + note on any 🔥 cell
- Stats — current streak, longest streak, total days
- 9 PM Chrome alarm → notification if today not logged
- 12:01 AM midnight rollover → marks yesterday as missed, recomputes longestStreak
- Emoji: 🔥 = logged, 😢 = missed (changed from 💀 in v2 per feedback)

---

## v2 Feature Plan (approved, not yet built)

### 1. Visual upgrade
- Glassmorphism cards: `backdrop-filter: blur(12px)`, semi-transparent backgrounds
- Gradient streak count: orange → pink linear-gradient on the header number
- Gradient Mark Today button: `linear-gradient(135deg, #f97316, #ec4899)`
- Body background: `radial-gradient(ellipse at 50% 0%, rgba(249,115,22,0.08) 0%, #0a0a0a 60%)`

### 2. Light / dark mode toggle
- Sun/moon icon button in header (top-right, absolutely positioned)
- Toggle sets `data-theme="light"` on `<html>` and persists to `chrome.storage.local` as `settings.theme`
- All light-mode overrides live under `[data-theme="light"] { }` in CSS
- Light palette: `--bg: #fafaf9`, `--surface: #f5f0eb`, `--card: rgba(255,255,255,0.7)`, `--text: #1a1a1a`

### 3. Daily motivational quote
- Array of ~30 short reading/study quotes in `popup.js` (constant `QUOTES`)
- Stable daily selection: `index = Math.floor(Date.now() / 86_400_000) % QUOTES.length`
- Appears in a `<div id="quoteBar">` between stats and view toggle
- Style: italic, 11px, `--muted` colour, thin left border in `--orange`

### 4. Confetti + celebration on mark
- `<canvas id="confettiCanvas">` fixed overlay (full popup, `pointer-events: none`)
- `launchConfetti()` — 80 particles, random colours, gravity + drift, runs 2.5s
- `showCelebration()` — slides down a `<div id="celebrationBanner">` with a random quote from `CELEBRATION_QUOTES` array (e.g. "🎉 You showed up today. That's everything."), auto-dismisses after 3s
- Both fire inside `saveToday()` after storage write completes

### 5. Shareable PNG export
- `<button id="shareBtn">` visible only in yearly view
- `renderShareCard()` draws to an offscreen `<canvas>` (800×400px):
  - Dark gradient background
  - Streak count + stats in white/orange text
  - Yearly heatmap cells drawn as rectangles
  - Footer tagline
- `canvas.toBlob()` → `<a download="my-streak.png">` → `.click()` to save
- A second "📋 Copy" button uses `ClipboardItem` + `navigator.clipboard.write()`

### 6. Code-based friend challenge (no backend)
- `generateChallengeCode()` — encodes `{ v, name, streak, longest, total, heat, ts }` as Base64 JSON
  - `heat` = last 90 days as compact bit array (1=completed, 0=missed)
- `decodeChallengeCode(code)` — decodes, validates version + age (<7 days)
- UI: collapsible `<section id="challengeSection">` at the bottom of the popup
  - "Your code" tab: name input + read-only code field + Copy button
  - "Enter a code" tab: text input + Compare button → renders side-by-side mini stats
- Expired (>7 days) or malformed codes show an error state, never crash
- New storage key: `settings.name` (user's display name for challenge codes)

### 7. Motivational reminder copy (background.js)
Replace the static notification message with a rotating array:
```js
const REMINDER_MESSAGES = [
  "There's still time — even 10 minutes of reading counts. You've got this! 🔥",
  "Your streak is waiting. A few pages before midnight keeps it alive 💪",
  "Don't let today slip away. You're one habit away from a new high streak!",
];
```
Pick by `new Date().getDate() % REMINDER_MESSAGES.length`.

---

## Storage schema

```js
// chrome.storage.local
{
  days: {
    "YYYY-MM-DD": { completed: boolean, note: string }
  },
  longestStreak: number,
  settings: {
    name: string,    // display name for challenge codes
    theme: string    // 'dark' | 'light'
  }
}
```

---

## Key implementation rules

1. **All dates in local time.** Never use `date.toISOString()` for storage keys — it returns UTC and will be wrong near midnight. Always use `getDateKey(date)` which uses `getFullYear/getMonth/getDate`.

2. **No build step.** Do not introduce npm, webpack, or any bundler. The extension loads directly from source files.

3. **No external dependencies.** No CDN links, no third-party libraries. Vanilla JS only.

4. **Constants over magic values.** All threshold numbers, emoji strings, and timing values belong in the constants section at the top of each file.

5. **Comment the WHY.** Don't comment what the code does (names do that). Comment why a non-obvious decision was made (e.g. why `T00:00:00` is appended when parsing date keys).

6. **`chrome.storage.local` is the single source of truth.** `appDays` in popup.js is an in-memory mirror that is always written through to storage before re-rendering.

7. **Service worker is stateless.** All state lives in storage. Never assume the service worker is alive between events.

---

## File responsibilities

| File | Owns |
|---|---|
| `background.js` | Alarms, notifications, midnight rollover, longestStreak recompute |
| `popup.js` | All UI rendering, user interactions, in-memory state, storage reads/writes |
| `popup.css` | All styles — theme variables, layout, animations, cell states |
| `popup.html` | Static markup shell — all dynamic content injected by popup.js |
| `manifest.json` | Extension config — permissions: `storage`, `alarms`, `notifications` |

---

## Design tokens (dark mode defaults)

```
--bg:         #0a0a0a   deepest background
--surface:    #111111   textarea backgrounds
--card:       #161616   card / calendar containers
--border:     #222222   subtle card outlines
--border2:    #2a2a2a   interactive element borders
--text:       #f5f5f5   primary text
--muted:      #666666   labels, secondary text
--muted2:     #444444   disabled/tertiary text
--orange:     #f97316   primary accent (Tailwind orange-500)
--orange-h:   #fb923c   orange hover (Tailwind orange-400)
--orange-dim: #7c2d00   low-streak heatmap (Tailwind orange-950)
--orange-mid: #ea580c   mid-streak heatmap (Tailwind orange-600)
--green:      #22c55e   success / logged state (Tailwind green-500)
--missed-bg:  #1a0a0a   missed day cell background
--radius:     10px      default border radius
```

# AGENTS.md — Streak Extension: Product History & Context

This file records what was built, why key decisions were made, and what the product looked like at each version. It is the product memory, not the coding guide — see [CLAUDE.md](CLAUDE.md) for coding conventions, architecture, and schema reference.

---

## What this is

A Chrome extension (Manifest V3) for daily habit tracking. Originally built for a single user — she opens the popup, marks a habit as complete, optionally writes a note, and her streak grows. If she misses a day, the streak resets at midnight.

**No backend. No accounts. No npm. No build step.** Everything runs in the browser.

---

## Original brief from the product owner

> I want to build a Chrome extension for my friend, where she can track her progress everyday. Whenever she reads something, she comes and marks the day as complete. 24 hrs time should be there — if she doesn't mark that day that means streak is gone.
>
> I want a premium-looking streak. It should have a yearly calendar. Longest streak maintained. A note option where she can write what she has studied that day. When hovered over the fire emoji it should show the note that she added.

---

## Version history

### v1 — Single-habit reading tracker
- Monthly calendar (Mon–Sun, navigate back, forward blocked at current month)
- Yearly heatmap (GitHub-style, orange intensity = streak length)
- Mark Today flow: button → textarea → optional note → Cmd+Enter or Save
- Hover tooltip: date + note on any 🔥 cell
- Stats: current streak, longest streak, total days
- 9 PM Chrome alarm → notification if today not logged
- 12:01 AM midnight rollover → marks yesterday as missed, recomputes longestStreak

### v2 — Visual upgrade + social
- Glassmorphism → replaced with solid surfaces (better readability)
- Orange→pink gradient on header number, Mark Today button, category pills
- Light / dark mode toggle (persisted to storage)
- Daily motivational quote (stable daily index into QUOTES array)
- Confetti + celebration banner on mark
- Shareable PNG export of yearly heatmap (+ clipboard copy)
- Code-based friend challenge (Base64 JSON, no backend): name input, code field, side-by-side comparison

### v3 — Multi-habit + new tab wallpaper (current)
- **Multi-category habits** — create any habit with emoji; each has an independent streak
- **New tab wallpaper** — streak front and center on every new tab open
- **Mark from new tab** — log today without opening the popup
- **Multiple notes per day** — timestamped entries per habit (was single string)
- **Persistent friend streaks** — save up to 3 friends; visible on wallpaper
- **Removed notifications** — redundant now that streak is visible on every new tab
- Storage schema migrated from flat `{ completed, note }` → nested `{ [catId]: { completed, entries[] } }`

---

## Key design decisions

| Decision | Reasoning |
|---|---|
| Chrome local storage (not sync) | Single device; no cross-device sync needed; simpler |
| No backend | Privacy first; friend challenges work via copy-paste codes |
| Popup + new tab override | Popup for detailed logging; new tab for ambient awareness |
| Both monthly + yearly views | Monthly for daily use; yearly for long-range motivation |
| Mon–Sun column order | User is based in India; Monday-first is standard |
| Vanilla JS, no build step | Load directly as unpacked extension; zero tooling friction |
| Notifications removed in v3 | Users see their streak on every new tab — notification is redundant and disruptive |
| Unicode-safe base64 | Challenge codes include emoji in category names; raw btoa() crashes on non-Latin1 chars |
| Max 3 saved friends | Balance: social motivation without UI clutter |

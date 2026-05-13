# CLAUDE.md — Streak Chrome Extension: Agent Instructions

Read this before making any changes. It defines the architecture, schema, and invariants that every agent must respect.

---

## Project snapshot

Streak is a vanilla JS Chrome extension (Manifest V3) for daily habit tracking. It overrides the new tab page to show streaks as a wallpaper and provides a popup for detailed logging. There is no backend, no npm, no build step, and no external dependencies. All state lives in `chrome.storage.local`. The extension loads directly as unpacked source.

---

## Architecture — file responsibilities

| File | Owns |
|---|---|
| `manifest.json` | Extension config — permissions: `storage`, `alarms` only |
| `shared.js` | Pure utility functions — date helpers, streak math, quotes. No DOM, no storage access. Used by popup.js and newtab.js via `<script src>`. |
| `background.js` | Service worker — midnight rollover alarm (12:01 AM), longestStreaks recompute. Stateless: no in-memory state survives between events. |
| `popup.html` | Static markup shell — all dynamic content injected by popup.js |
| `popup.css` | All popup styles — theme variables, layout, animations, calendar cells, challenge section |
| `popup.js` | All popup logic — categories, calendar, entry list, friend challenges, storage reads/writes. Runs migration on init. |
| `newtab.html` | New tab override page markup |
| `newtab.css` | New tab styles — full-viewport, category pills, habit chips, friend strips, mark button |
| `newtab.js` | New tab logic — renders wallpaper, handles mark-today, reads storage directly |

---

## Storage schema (v3 — current)

```js
chrome.storage.local = {
  // Array of habit categories. Order is preserved for UI rendering.
  categories: [
    { id: string, name: string, emoji: string, createdAt: number }
  ],

  // date → categoryId → entry. Date keys are YYYY-MM-DD in LOCAL TIME.
  days: {
    "YYYY-MM-DD": {
      "[catId]": {
        completed: boolean,
        entries: [{ text: string, ts: number }]  // ts=0 for migrated v2 notes
      }
    }
  },

  // Cached longest streak per category. Recomputed by background.js on rollover.
  longestStreaks: { "[catId]": number },

  settings: {
    theme: "dark" | "light",
    name: string,             // display name for challenge codes
    activeCategoryId: string  // last-used category; persisted across popup opens
  },

  // Up to 3 saved friends (decoded from challenge codes).
  friends: [
    {
      name: string, streak: number, longest: number, total: number,
      heat: string,           // Unicode-safe base64 bit-array of last 90 days
      categoryName: string,   // e.g. "📚 Reading"
      savedAt: number         // Date.now() when saved
    }
  ]
}
```

### Migration
- `popup.js` detects v2 schema on init via `needsMigration(days)`: if `typeof Object.values(days)[0].completed === 'boolean'`, it's old.
- `migrateData(result)` converts flat `{ completed, note }` → `{ reading: { completed, entries } }` and writes atomically.
- Always idempotent — safe to call twice.
- `background.js` has its own `isOldSchema()` guard for the rollover path (user may not have opened popup yet).

---

## Coding conventions

### Must follow — these exist to prevent known bugs

1. **Date keys always in local time.** Use `getDateKey(date)` from `shared.js`. It calls `getFullYear() / getMonth() / getDate()`. **Never** use `date.toISOString()` — it returns UTC and produces wrong keys near midnight.

2. **Unicode-safe base64 for challenge codes.** Use `toBase64(str)` / `fromBase64(b64)` in `popup.js`. They use `TextEncoder` / `TextDecoder`. **Never** call `btoa()` directly on user strings — category names contain emoji that crash `btoa()` with `InvalidCharacterError`.

3. **Light mode active pill selector.** When writing `[data-theme="light"]` overrides for `.cat-pill`, use `.cat-pill:not(.active)` — **not** `.cat-pill`. Applying a white background to `.cat-pill` without the `:not(.active)` exception overrides the orange-pink gradient on active pills, making white text invisible.

4. **Service worker is stateless.** Never cache computed state in `background.js` module scope. Service workers restart between events. All state must be read from storage each time an alarm fires.

5. **chrome.storage.local is the single source of truth.** `appDays` (popup.js) and `ntDays` (newtab.js) are in-memory mirrors. All re-renders that depend on a write must happen inside the `chrome.storage.local.set()` callback — never after it, because the write is asynchronous. Never render from stale in-memory state.

### Code style

6. **All streak math via shared.js.** Use `calcCurrentStreak()`, `calcLongestStreak()`, `calcTotal()`, `buildCategorySlice()`. Never inline streak logic. These functions are the canonical implementations.

7. **Always pass a slice to streak functions, never the raw `days` object.** `buildCategorySlice(days, catId)` converts nested v3 `days` into the flat `{ "YYYY-MM-DD": { completed, entries } }` shape that `calcCurrentStreak`, `calcLongestStreak`, and `calcTotal` expect. Passing raw `days` silently produces wrong numbers.

8. **Constants over magic values.** All threshold numbers, emoji strings, timing values, and alarm names belong at the top of the file as `const`. No magic literals inline.

9. **Comment the WHY, not the WHAT.** Well-named identifiers explain what. Comments explain non-obvious constraints, subtle invariants, and known gotchas (e.g. why `T00:00:00` is appended when parsing stored date keys as `new Date()`).

10. **No eval, no unsafe innerHTML.** User-provided strings (names, notes) must be passed through `escapeHtml()` before being injected into innerHTML. Alternatively, use `textContent` or `createElement`.

11. **No external dependencies, no build step.** No CDN links, no npm, no third-party libraries, no webpack/rollup/esbuild. The extension loads directly from source files. This is a constraint, not a suggestion — it keeps the extension zero-dependency, auditable, and installable by loading the folder directly in Chrome.

### CSS conventions

12. **Dark mode is the default.** All base styles target dark mode. Light mode overrides live under `[data-theme="light"]` in a dedicated section (search `── 15.` in popup.css). Never mix light-mode overrides into general sections.

13. **CSS custom properties for all tokens.** Use `var(--orange)`, `var(--card)`, etc. Never hardcode color hex values outside of `:root` / `[data-theme="light"]`.

14. **Gradient on active interactive elements.** `linear-gradient(135deg, var(--grad-start), var(--grad-end))` — `--grad-start: #f97316`, `--grad-end: #ec4899`. Applied to: active category pills, Mark Today button, streak count text (via `-webkit-background-clip: text`).

---

## Code quality — for open-source contributors and agents

This project is read by humans. Every line should be optimized for the next person to read it, not for the person who wrote it. These rules apply to every change, no matter how small.

### Readability

**Name things for what they mean, not what they do mechanically.**
`isTodayLogged()` is good. `checkDayStatus()` is vague. `getTodayCompletedBool()` is mechanical. A function named after its intent lets you read call sites without jumping to the definition.

**One level of abstraction per function.**
A function that reads from storage, builds a date slice, calculates a streak, and updates four DOM nodes is doing four jobs. Extract until each function does one. The caller reads like prose (`renderSelectedCategory(catId)`); the callee handles the detail (`buildCategorySlice`, `calcCurrentStreak`). If you can't describe a function in one clause without using "and", split it.

**Prefer positive conditions.**
`if (isLoggedToday)` over `if (!isNotLoggedToday)`. Negated booleans force readers to mentally invert. If you need a negative, name it from the negative (`isEmpty`, `isDisabled`).

**Keep functions under ~40 lines.**
Beyond that, readers can't hold the whole function in their head. If a function is growing because it handles multiple cases, split by case. If it's growing because it does setup + logic + teardown, extract each phase. The popup.js render functions (~50–80 lines) are the existing ceiling — new functions should aim lower.

**Group related DOM queries, state variables, and event listeners together.**
Readers scan top-to-bottom. Constants at the top, DOM refs below, then state, then functions, then event wiring. Don't scatter these.

### Maintainability

**Every function has one reason to change.**
`renderCalendar()` changes when calendar layout changes. `calcCurrentStreak()` changes when streak rules change. If a function would change for two different reasons, split it. This is the single-responsibility test.

**Avoid defensive programming for impossible states.**
Don't add `if (!categories) return` inside a function that is only called after `categories` is guaranteed to be populated. Defensive guards for impossible states make readers wonder "when does this actually happen?" and mask real bugs. Guard only at true system boundaries: storage reads, user input, decoded challenge codes.

**All storage writes are asynchronous — re-render inside the callback, never after it.**
`chrome.storage.local.set()` is async. Code that runs after the `set()` call but outside its callback executes before the write completes. Pattern to follow:
```js
chrome.storage.local.set({ days: appDays }, () => {
  renderStats();   // ✓ inside callback — write is guaranteed complete
});
renderStats();     // ✗ outside callback — write may not be done
```

**Schema changes require a migration.**
Any change to the shape of `days`, `categories`, `settings`, or `friends` in storage must include: (1) a version detection check, (2) a migration function that converts old → new, (3) idempotency — running it twice must be safe. Document the old shape in a comment inside the migration function so future readers understand what was being converted from.

**Feature flags don't exist here.**
There is no A/B testing, no gradual rollout, no conditional feature toggles. A feature is either shipped or it isn't. Don't add `if (ENABLE_NEW_THING)` guards.

### Extensibility

**New habit categories must require zero code changes.**
The category system is data-driven: `categories[]` in storage drives all rendering, streak calculation, and calendar display. Adding a new category should only require the user clicking "+ Add". If you find yourself hardcoding a category ID or name anywhere outside the migration default (`'reading'`), that's a bug.

**New storage keys go through `chrome.storage.local.get([...keys], callback)`.**
When adding a new storage key, add it to the `get` call in the relevant init function and provide a safe default: `|| []` for arrays, `|| {}` for objects, `|| 'defaultString'` for strings. Never assume a key exists in storage — it won't on first install or after the user clears extension data.

**shared.js is the extension's stdlib.**
Any pure function that operates on dates, streak data, or categories and could be used by more than one file belongs in `shared.js`. Do not duplicate logic between popup.js and newtab.js. If you find the same calculation in two places, extract it to shared.js.

**CSS sections are numbered and labeled.**
popup.css is organized into 20 numbered sections. When adding new styles, find the right section or append a new numbered section at the bottom. Do not add rules between existing sections or scatter them at the end.

### Reliability

**Storage reads must always handle missing keys gracefully.**
Every value read from `chrome.storage.local` may be `undefined` on a fresh install or after the user removes the extension. Defaults by type:
```js
result.categories || []          // arrays — never || null, null breaks .filter()
result.longestStreaks || {}       // objects
result.settings?.theme || 'dark' // nested fields — use optional chaining
result.days[key]?.completed === true  // booleans — explicit === true, not truthy check
```
Never use `|| null` as a default for an array — callers that call `.filter()` or `.map()` will throw.

**The midnight rollover is the only thing that writes to `days` outside of explicit user action.**
`background.js` writes missed-day entries at 12:01 AM. `popup.js` and `newtab.js` write on user action. Nothing else writes to `days`. If you find a third write path, question it.

**Never silently swallow errors in challenge code decoding.**
`decodeChallengeCode()` must show a visible error state for: malformed JSON, wrong version, expired code (>7 days), missing required fields. It must never crash and never display corrupted data as if it were valid.

**Rendered output is always derived from storage, never from previous render state.**
When re-rendering after a state change, always read from `appDays` / `appCategories` (the in-memory mirrors of storage), never from DOM state. The DOM is write-only output, not a data source.

**Test the sad path before shipping any change.**
For every change, ask: what happens on first install (empty storage)? What happens if the user has only one category and tries to delete it? What happens with a v2 challenge code in a v3 build? Run these manually before considering a feature done.

---

## Key invariants

- `getDateKey()` → `YYYY-MM-DD` in local time. Non-negotiable.
- `calcCurrentStreak(slice)`: if today is logged, count starts today; else start from yesterday and walk back.
- `buildCategorySlice(days, catId)` → `{ "YYYY-MM-DD": { completed, entries } }` for one category only.
- Challenge codes: v3 payload `{ v:3, name, categoryName, streak, longest, total, heat, ts }`, Unicode-safe base64, 7-day expiry enforced on decode.
- Friends stored as `friends[]` array (max 3). The old singular `friend` key is migrated to `friends[0]` on first popup open after upgrade.
- `longestStreaks` object keyed by `catId`. Default to `|| 0` for new categories.

---

## What NOT to do

| Don't | Because |
|---|---|
| `date.toISOString()` for storage keys | Returns UTC — wrong near midnight in non-UTC timezones |
| `btoa(str)` on user strings | Crashes on emoji / non-Latin1 characters — use `toBase64()` |
| `el.innerHTML = userString` without `escapeHtml()` | XSS — user names and notes are unsanitized input |
| `[data-theme="light"] .cat-pill { background: ... }` | Overrides active pill gradient, makes white text invisible |
| State in `background.js` module scope | Lost on service worker restart |
| Re-render outside `storage.set()` callback | Write is async — render may use stale data |
| `|| null` as default for array storage keys | Callers using `.filter()` / `.map()` will throw |
| `chrome.notifications` API | Removed by design in v3 — redundant with new tab wallpaper |
| New npm dependencies or build tools | Breaks zero-dependency, zero-build-step invariant |
| Inline streak logic | Use shared.js functions — they handle edge cases correctly |

---

## Design tokens (current)

### Dark mode (default — `:root`)
```
--bg:         #0f0f0f   page / body
--surface:    #161618   inputs, code fields
--card:       #1c1c1e   cards, calendar, stats bar
--card2:      #242428   elevated: challenge body, comparison
--card3:      #2a2a2f   extra lift: active input borders
--border:     #2c2c30   card outlines
--border2:    #38383e   interactive element borders
--text:       #efefef   primary text       (11.2:1 on --card)
--body-text:  #d0d0d0   body text           (7.2:1)
--label:      #9a9a9a   labels              (4.8:1)
--subtle:     #767676   fine print ≥11px italic only (3.9:1)
--orange:     #f97316   primary accent
--orange-h:   #fb923c   orange hover
--orange-dim: #7c2d00   low-streak heatmap
--orange-mid: #c2410c   mid-streak heatmap
--grad-start: #f97316   gradient left
--grad-end:   #ec4899   gradient right
--green:      #4ade80   success / logged state
--green-bg:   #0d3320   logged day cell background
--red-text:   #fca5a5   error messages
--missed-bg:  #1c1416   missed day cell background
--shadow-sm:     0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4)
--shadow-md:     0 4px 12px rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.4)
--shadow-lg:     0 8px 24px rgba(0,0,0,0.7), 0 4px 8px rgba(0,0,0,0.5)
--shadow-orange: 0 4px 20px rgba(249,115,22,0.3)
--radius:     10px      default border radius
```

### Light mode overrides (`[data-theme="light"]`)
```
--bg:         #f4f2ef
--surface:    #ffffff
--card:       #ffffff
--border:     #e0d8d0
--text:       #1c1917
--body-text:  #3a3530
--label:      #6b6460
--subtle:     #6b6460
--shadow-lg:  0 8px 24px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08)
```

---

## Verification checklist (after any change)

### Happy path
1. Load unpacked extension at `chrome://extensions` — zero errors in the Errors tab
2. Open popup — categories render, streak count correct, calendar loads
3. Open new tab — wallpaper shows, Mark Today button logs and updates the count immediately
4. Toggle theme in popup and new tab — both update, preference persists on reload
5. Create a new category — pill appears, independent streak starts at 0, switching between categories shows independent counts
6. Mark today in two different categories — each shows its own streak, neither affects the other
7. Add a second note to today — both entries appear in the entry list with timestamps
8. Generate challenge code — copy it, paste into "Enter a code" tab, comparison renders with heat grid
9. Save a friend — close popup, reopen — friend still shown in saved panel and on new tab wallpaper

### Sad path (run these for any storage or schema change)
10. Clear extension storage (`chrome.storage.local.clear()` in DevTools) and reload — fresh install must work with no errors and show default "Reading" category
11. Try to delete the last remaining category — must be blocked with an error, not silently removed
12. Paste a malformed or expired challenge code — must show a clear error state, not crash or display garbage
13. Open the new tab with no categories in storage — must fall back to default gracefully
14. Mark today from the new tab, then open the popup — popup must show today as logged (data is in storage, not just local state)

### Manifest
15. Check `manifest.json` — permissions are `["storage", "alarms"]` only, no `notifications`

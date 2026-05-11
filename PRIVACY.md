# Privacy Policy — Streak Chrome Extension

_Last updated: May 12, 2026_

---

## Summary

Streak does not collect, transmit, or share any personal data. Everything stays on your device.

---

## What data is stored

Streak stores the following data **locally on your device** using Chrome's built-in `chrome.storage.local` API:

- A log of which days you marked as complete (`true` or `false` per calendar date)
- Optional notes you write about what you read on a given day
- Your longest streak count
- Your app preferences (theme)

This data never leaves your device. It is not sent to any server, not shared with any third party, and not accessible to the developer.

## What data is NOT collected

- No personally identifiable information (name, email, age, etc.)
- No location data
- No browsing history or web activity
- No analytics or usage tracking
- No crash reporting

## Permissions used

| Permission | Why it's needed |
|---|---|
| `storage` | Saves your reading log and preferences locally on your device |
| `alarms` | Schedules a daily 9 PM reminder and a midnight rollover check |
| `notifications` | Sends a single daily reminder if you haven't logged your reading yet |

No permission is used for any purpose beyond what is described above.

## Third parties

Streak does not integrate with any third-party services, analytics platforms, or advertising networks.

## Data deletion

To delete all data stored by Streak, go to `chrome://extensions`, find Streak, and click **Remove**. This permanently deletes all locally stored data.

## Changes to this policy

If this policy changes in a future version, the updated date at the top of this page will reflect that. No changes will affect data collected in the past, since no data is collected at all.

## Contact

If you have questions about this privacy policy, open an issue at:  
https://github.com/g-savitha/streak/issues

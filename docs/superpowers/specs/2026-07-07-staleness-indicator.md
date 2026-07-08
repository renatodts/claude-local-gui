# Staleness indicator — design

**Date:** 2026-07-07
**Status:** approved

## Problem

The page has a connection banner for a dropped SSE stream, but nothing
indicates *data* staleness on a healthy connection. If the agent goes quiet
(thinking, driving a browser, off on another task), the last published state
just sits there — a `status` spinner or an `active` step pulses forever and
the user can't tell "working" from "stalled".

## Decisions

- **Client-only.** No server heartbeat, no `server.mjs` changes. `base.js`
  records `lastUpdate = Date.now()` on every valid SSE state message and a
  1s `setInterval` compares against it.
- **Threshold: 15s.** Normal interactive publishing happens within a few
  seconds; real agent gaps start around 10–30s. 15s avoids flicker during
  ordinary pauses while catching genuine staleness early.
- **Presentation:** a fixed bottom-right pill badge (`#stale-badge`) reading
  `updated 42s ago` (switches to `updated Nm ago` from 60s). Muted card
  styling — informational, deliberately not error-red.
- **Hidden while the connection banner is showing.** A dropped connection is
  the stronger, superseding signal; showing both is noise. On reconnect the
  server immediately re-pushes current state, which resets the timer.
- **Appended to `<body>` by `base.js`**, not added to the server shell — it
  therefore also works on custom `page.html` pages, which replace `#app`
  but keep `base.js`.

## Out of scope

- Server-side heartbeats / SSE keepalive pings.
- Per-block timestamps or freshness indicators.
- Any change to how agents are told to publish (covered by a SKILL.md note,
  not enforcement).

---
name: local-gui
description: Hosts an ephemeral, interactive local web GUI (live dashboard, approvals, forms, chat, editable tables) while a task runs — a local alternative to Artifact, with no persistence. Use when the user asks for a local visual interface, a live dashboard, a GUI to follow/interact with a task, or when another skill needs visual progress + user input via a browser. Trigger terms: local GUI, live dashboard, visual interface, approve in browser, interactive local web UI, local-gui.
---

# local-gui

Ephemeral local server with a live page. Communication is 100% file-based:
you write `state.json` (the page updates via SSE); user interactions become
lines in `inbox.jsonl`.

## Start it

```bash
D="<session-scratchpad>/gui-<task-name>"   # use the scratchpad directory noted in your system prompt
mkdir -p "$D"
# write the initial $D/state.json BEFORE starting the server (see protocol below)
node <skill-base-dir>/server.mjs --dir "$D" &
```

The skill's base directory is announced when the skill is invoked — use that
path in place of `<skill-base-dir>`.

Wait for `$D/server.info` to exist (poll ~2s) and read `{port, pid, url}` from it.
Open it for the user: `xdg-open "$url"`. Also share the URL in chat.

## Publish / update

Rewrite `$D/state.json` with Write/Edit — the page updates itself (SSE,
100ms debounce). Invalid JSON is ignored (the last good state is kept).

Avoid republishing state while a form/table is awaiting user input — a
re-render wipes in-progress typing (chat input is preserved automatically).

The page shows a small "updated Ns ago" badge (bottom-right) once 15s pass
with no state broadcast. Whenever you start or switch long-running work,
republish state (e.g. update a `status` block's text) so the user can tell
you're alive and working — a spinner with no fresh writes behind it looks
stalled.

### `state.json` protocol

```json
{ "title": "Title", "blocks": [
  { "type": "status",   "text": "Processing...", "spinner": true },
  { "type": "steps",    "direction": "vertical|horizontal",
    "items": [ { "label": "Step", "state": "done|active|pending|error" } ] },
  { "type": "markdown", "content": "# Full markdown\nCommonMark + GFM tables/strikethrough. Raw HTML is escaped — use the html block for that." },
  { "type": "choices",  "id": "x", "prompt": "Question?", "answered": false,
    "options": [ { "value": "v", "label": "Label", "style": "primary|danger|ghost" } ] },
  { "type": "form",     "id": "y", "submit": "Save", "answered": false,
    "fields": [ { "name": "n", "label": "L", "kind": "text|number|date|textarea|select",
                  "required": true, "options": ["if select"] } ] },
  { "type": "chat",     "id": "z", "messages": [ { "role": "assistant|user", "text": "..." } ] },
  { "type": "table",    "id": "w", "editable": true, "answered": false,
    "columns": ["A"], "rows": [ [ "cell", { "kind": "checkbox", "checked": true } ] ] },
  { "type": "html",     "content": "<div>free-form inline HTML</div>" } ] }
```

- Steps: `direction` is optional (default vertical). Horizontal steps truncate
  long labels with an ellipsis; the full label shows on hover.
- Markdown: full CommonMark plus GFM tables and strikethrough (markdown-it).
  Raw HTML inside markdown renders as escaped text — use the `html` block for
  raw HTML. Bare URLs auto-link; single newlines become line breaks. Chat
  messages also render markdown.
- Interactive blocks require a unique `id`. After processing a response,
  republish the state with `"answered": true` on that block (disables the controls).
  After any click/submit the page shows a built-in "waiting for a response…"
  hint until the next republish — process inbox lines and republish promptly.
- In chat, echo the user's message and your reply in `messages` when you republish.
  Chat does NOT respect `answered` (the message field always stays active).
- Fully custom page: write `$D/page.html` — it replaces the renderer.
  `page.html` is an HTML FRAGMENT injected inside `<main id="app">` (not a
  full document — no `<html>`/`<head>`/`<body>`).
  Use the global `guiSubmit(blockId, kind, value)` to send input back and listen for
  `window.addEventListener('gui:state', e => ...)` to receive state updates.
- Tables (`table`): edited text cells come back as strings — do the type
  coercion yourself.
- Forms (`form`): an empty `number` field comes back as 0.

## Waiting for user input

state.json → page is push (SSE), but page → agent is only a file
(`inbox.jsonl`) — the agent side of that direction is necessarily a poll.
Run that poll as a **backgrounded** Bash call, never in the foreground:
a foreground wait blocks the whole turn (up to 8 minutes) and the user
can't chat, ask something else, or interact with you while it's running —
only with the page. Launch the loop below with the background option
right after publishing any interactive block (`choices`/`form`/`chat`/
`table`), then go on to whatever's next (respond to the user, prep the
next state.json, work on something else); you get notified automatically
when the loop exits, so don't sleep-poll it yourself from the outside.

```bash
# OFFSET = inbox lines already processed (start at 0; after each read, set it to the total lines read)
D=...; PID=...; OFFSET=0
end=$((SECONDS+480))
while [ $SECONDS -lt $end ]; do
  n=$([ -f "$D/inbox.jsonl" ] && wc -l < "$D/inbox.jsonl" || echo 0)
  [ "$n" -gt "$OFFSET" ] && { tail -n +$((OFFSET+1)) "$D/inbox.jsonl"; OFFSET=$n; exit 0; }
  kill -0 "$PID" 2>/dev/null || { echo "SERVER_DEAD"; exit 1; }
  sleep 2
done
echo "TIMEOUT"
```

Line format: `{"ts", "block", "kind": "choice|form|chat|table", "value"}`.
On `TIMEOUT` (~8 min), tell the user in the terminal and ask whether to keep
waiting — if so, relaunch the same loop in the background again (fresh
`OFFSET`/`end`). On `SERVER_DEAD`, report it and offer to restart. If you
were mid-response when the notification arrives, finish that thought before
switching to the new input — don't drop your own train of thought to react
instantly.

## Shutdown (required at the end of the task)

```bash
kill "$PID" 2>/dev/null
```

Backstop: the server shuts itself down after 30 minutes with no tab connected
(`--idle-timeout`, default 1800s).

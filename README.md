# claude-local-gui

An ephemeral, zero-dependency local web GUI that Claude Code skills and tasks
can drive entirely through files. Think of it as a local, ephemeral
alternative to hosted Artifacts: a live dashboard, an approval prompt, a
form, a chat window, or an editable table that appears in the user's browser
while a task runs — and disappears with nothing persisted once the server
process dies.

The protocol is dead simple:

```
Claude writes state.json  →  server pushes it over SSE  →  browser page renders it
browser page              →  POST /submit               →  server appends to inbox.jsonl
Claude tails inbox.jsonl  →  reacts, republishes state.json
```

No database, no build step, no external dependencies — just a small
Node.js `http` server, a state file, and a JSON-lines inbox.

## Features

- **8 block types**: `status`, `steps`, `markdown`, `choices`, `form`,
  `chat`, editable `table`, and raw `html`.
- **Live updates** over Server-Sent Events (SSE), with a 100ms debounce on
  `state.json` writes.
- **Dark/light theme**, following the browser's system preference.
- **Answered-flag flow**: republish a block with `"answered": true` to
  disable its controls after processing a response. Chat inputs are the
  exception — they always stay active.
- **`page.html` escape hatch**: drop in a fully custom HTML fragment and
  wire it up with the `guiSubmit()` helper and the `gui:state` browser
  event, bypassing the built-in renderer entirely.
- **Idle-timeout backstop**: the server shuts itself down automatically
  after a period (default 30 minutes) with no browser tab connected.

## Install

### Option 1 — as a plugin

```
/plugin marketplace add renatodts/claude-local-gui
/plugin install local-gui@claude-local-gui
```

### Option 2 — manual

Copy `skills/local-gui/` into `~/.claude/skills/`.

## Quick protocol reference

`state.json`:

```json
{
  "title": "My Task",
  "blocks": [
    { "type": "status", "text": "Processing...", "spinner": true },
    {
      "type": "choices",
      "id": "confirm",
      "prompt": "Proceed?",
      "answered": false,
      "options": [
        { "value": "yes", "label": "Yes", "style": "primary" },
        { "value": "no", "label": "No", "style": "ghost" }
      ]
    }
  ]
}
```

`inbox.jsonl` (one JSON object per line, appended on every user interaction):

```
{"ts":1730000000000,"block":"confirm","kind":"choice","value":"yes"}
```

See `skills/local-gui/SKILL.md` for the full protocol, including forms,
chat, editable tables, and the `page.html` custom-rendering escape hatch.

## Security model

- Binds to `127.0.0.1` only — never reachable from the network.
- Host-header allowlist: only `127.0.0.1:<port>` and `localhost:<port>` are
  accepted; anything else gets a `403`.
- `/submit` requires a `Content-Type: application/json` request (CSRF
  hardening — a plain HTML form or fetch from another origin can't hit it
  by accident).
- Markdown links are restricted to `https:`, `http:`, `mailto:`, `#`, and
  `/` schemes.
- The `html` block renders raw, unsanitized HTML by design: content is
  always authored by the Claude Code session driving the GUI, not by an
  untrusted third party. This is a local trust model — don't point this
  server at content you don't control.

## Requirements

Node.js >= 20 (no external dependencies).

## Tests

```bash
node --test skills/local-gui/server.test.mjs
```

15 tests covering server startup, static assets, SSE streaming, `/submit`
validation, Host-header enforcement, idle-timeout, and the `page.html`
override.

## License

MIT — see [LICENSE](./LICENSE).

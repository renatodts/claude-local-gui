# Changelog

## 1.0.0 — initial release

- Zero-dependency Node.js local web server driven entirely by files (`state.json` in, `inbox.jsonl` out).
- Live updates over Server-Sent Events with a 100ms debounce on `state.json` changes.
- 8 block types: status, steps, markdown, choices, form, chat, editable table, and raw HTML.
- Dark/light theme support (follows system preference).
- Answered-flag flow to disable controls after a response is processed; chat input always stays active.
- `page.html` escape hatch for a fully custom page, with a `guiSubmit()` / `gui:state` event bridge.
- Idle-timeout backstop (default 30 minutes) that shuts the server down automatically when no client is connected.
- Security hardening: binds to 127.0.0.1 only, Host-header allowlist, CSRF-hardened `/submit` (requires `application/json`), restricted markdown link schemes.
- Ships as both a Claude Code skill and an installable plugin/marketplace.

# Changelog

## 1.2.0

- Staleness badge: a bottom-right "updated Ns ago" pill appears after 15s
  without a state update and resets on every broadcast; hidden while the
  connection-lost banner is showing.

## 1.1.0

- Horizontal steps: `{ "type": "steps", "direction": "horizontal" }` renders a stepper with connector lines; long labels truncate with an ellipsis and show in full on hover.
- Submit feedback: clicking any choice/form/table button now disables the block, spins the clicked button and shows a "Sent — waiting for a response…" hint until the next state republish; network failures re-enable the controls with an error message.
- Chat: messages appear instantly as an optimistic bubble (dimmed while sending, outlined on failure) instead of waiting for the agent's echo.
- Visual refresh in the spirit of shadcn/ui: neutral zinc palette in light and dark, solid dark primary buttons, focus rings on buttons and inputs, subtle card shadows, refined typography, table row hover, underlined links.
- Fixed the favicon 404 console error.

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

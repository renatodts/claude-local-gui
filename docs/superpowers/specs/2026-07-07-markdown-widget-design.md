# Markdown widget via markdown-it — design

**Date:** 2026-07-07
**Status:** approved

## Problem

The `markdown` block in the local-gui renderer (`skills/local-gui/assets/base.js`)
uses a hand-rolled regex converter that only supports bold, italic, inline code,
links and paragraphs. Agents frequently emit richer markdown (headings, lists,
code fences, tables), which currently renders as literal text. Chat messages
render as plain text only.

## Goal

Render full markdown in the `markdown` block and in chat messages using a real
markdown library, without breaking the project's zero-dependency, offline,
ephemeral design.

## Decisions

- **Library:** markdown-it 14.x, vendored as a single minified UMD bundle at
  `skills/local-gui/assets/markdown-it.min.js` (~110KB). No package.json, no
  runtime network access.
- **Scope:** the `markdown` block AND chat messages (assistant, user, and the
  optimistic pending bubble). Prompts, table cells and other blocks stay plain
  text.
- **Rejected alternatives:** marked + DOMPurify vendored (two moving parts for
  a smaller footprint); CDN loading (breaks offline use).

## Design

### 1. Serving the library (`server.mjs`)

- Add `'markdown-it.min.js': 'text/javascript; charset=utf-8'` to `ASSET_TYPES`.
- In `shell()`, add `<script src="/assets/markdown-it.min.js"></script>` before
  the `base.js` script tag (also on custom `page.html` pages, so custom pages
  can use it too).

### 2. Renderer (`assets/base.js`)

- Single shared instance:
  `const mdit = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: true }) : null`.
  - `html: false` — raw HTML in markdown is escaped, matching the current
    renderer's trust model; no separate sanitizer needed.
  - `breaks: true` — single `\n` becomes `<br>`, preserving current behavior.
  - `linkify: true` — bare URLs become links.
- Override the `link_open` render rule to add `target="_blank" rel="noreferrer"`
  (markdown-it's default `validateLink` already blocks `javascript:` etc.).
- Replace the regex `md()` function with `md(src)` that calls
  `mdit.render(String(src))`, falling back to escaped text wrapped in `<p>`
  (with `\n` → `<br>`) if the library failed to load.
- `markdown` block renderer: unchanged call site (`d.innerHTML = md(b.content)`).
- Chat: message bubbles set `innerHTML` via `md(m.text)` instead of text nodes;
  the optimistic user bubble does the same with the typed text.

### 3. Styles (`assets/base.css`)

- Inside `.markdown` and `.msg`: compact margins for `p` (existing rule covers
  `.markdown p`; add `.msg p`), plus styles for `h1–h6` (scaled-down sizes),
  `ul/ol` padding, `blockquote` (left border + muted), `pre` blocks
  (background `--accent`, border, radius, horizontal scroll; inner `code`
  loses its own border/background), `hr`, and `img { max-width: 100% }`.
- Remove `white-space: pre-wrap` from `.msg` (line breaks now come from
  `breaks: true`).
- Tables inside markdown reuse the existing global `table` styles.

### 4. Documentation (`skills/local-gui/SKILL.md`)

- Update the `markdown` block line in the state.json protocol: full
  CommonMark + GFM tables/strikethrough, raw HTML escaped (use the `html`
  block for raw HTML).
- Note that chat messages render markdown.

### 5. Versioning

- `CHANGELOG.md`: new `1.2.0` entry.
- `.claude-plugin/plugin.json`: version → `1.2.0`.

### 6. Testing

- `skills/local-gui/server.test.mjs`: add tests that
  `GET /assets/markdown-it.min.js` returns 200 with the JS content type, and
  that the shell HTML references the script before `base.js`.
- Markdown-to-HTML conversion itself is client-side (browser), covered by a
  manual end-to-end check: run the GUI with a state.json exercising headings,
  lists, fenced code, a table, a link, and chat messages with markdown.

## Error handling

- Library file missing/failed to load → `md()` falls back to escaped
  plain text; the page keeps working.
- Malicious content (`<script>`, `javascript:` links) → neutralized by
  `html: false` and markdown-it's link validation; same model as today.

## Out of scope

- Syntax highlighting in code fences.
- Markdown in prompts, table cells, form labels.
- Bundler/package.json — the library is vendored as a static asset.

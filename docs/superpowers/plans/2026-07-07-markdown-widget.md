# Markdown Widget (markdown-it) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the regex-based markdown renderer in local-gui with a vendored markdown-it library, applied to the `markdown` block and chat messages.

**Architecture:** markdown-it 14.1.0 is vendored as a single minified UMD file in `skills/local-gui/assets/` and served by `server.mjs` like the existing assets. `base.js` builds one shared `markdownit` instance (`html: false`, `linkify: true`, `breaks: true`) with a `link_open` rule adding `target="_blank" rel="noreferrer"`, and uses it in the `markdown` block renderer and chat bubbles, with a one-line escaped-text fallback if the library fails to load.

**Tech Stack:** Node.js ≥ 18 (no package.json — zero runtime dependencies), vanilla browser JS, `node:test` for server tests.

**Spec:** `docs/superpowers/specs/2026-07-07-markdown-widget-design.md`

## Global Constraints

- Zero dependencies: NO package.json, NO node_modules. The library is a static vendored file.
- No network access at runtime; the download happens once, during implementation.
- Library and version: markdown-it **14.1.0**, minified UMD dist bundle (exposes `window.markdownit` in the browser).
- Security model unchanged: raw HTML in markdown must render as escaped text (`html: false`); `javascript:` links must not become anchors (markdown-it default `validateLink`).
- Tests run with: `node --test skills/local-gui/` from the repo root. All existing tests must keep passing.
- Plugin version after this feature: **1.3.0** (1.2.0 was released concurrently for the staleness badge).

---

### Task 1: Vendor markdown-it and serve it from the server

**Files:**
- Create: `skills/local-gui/assets/markdown-it.min.js` (downloaded, ~110KB)
- Modify: `skills/local-gui/server.mjs` (ASSET_TYPES map + `shell()` script tags)
- Test: `skills/local-gui/server.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /assets/markdown-it.min.js` → 200, `text/javascript`; the shell HTML loads `/assets/markdown-it.min.js` BEFORE `/assets/base.js`, so `window.markdownit` (a factory function: `window.markdownit(options) → { render(src) → html string, renderer }`) exists when `base.js` runs. Task 2 relies on this global.

- [ ] **Step 1: Write the failing test**

Append to `skills/local-gui/server.test.mjs`:

```js
test('serves vendored markdown-it and loads it in the shell before base.js', async () => {
  const { base } = await startServer();
  const res = await fetch(base + '/assets/markdown-it.min.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/javascript/);
  const body = await res.text();
  assert.ok(body.length > 10000, 'vendored bundle should be present, not a stub');
  const html = await (await fetch(base + '/')).text();
  const mdIdx = html.indexOf('/assets/markdown-it.min.js');
  const baseIdx = html.indexOf('/assets/base.js');
  assert.ok(mdIdx > -1, 'shell must reference markdown-it');
  assert.ok(mdIdx < baseIdx, 'markdown-it must load before base.js');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test skills/local-gui/`
Expected: the new test FAILS (`/assets/markdown-it.min.js` returns 404 → `assert.equal(res.status, 200)` fails). All pre-existing tests PASS.

- [ ] **Step 3: Download the library**

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js \
  -o skills/local-gui/assets/markdown-it.min.js
```

Verify it is the real UMD bundle and works with the required options (this also proves `html: false` escapes raw HTML):

```bash
node --input-type=commonjs -e "
const md = require('./skills/local-gui/assets/markdown-it.min.js')({ html: false, linkify: true, breaks: true });
const out = md.render('# Hi\n<script>alert(1)</script>\nwww.example.com');
console.log(out);
if (!out.includes('<h1>Hi</h1>')) throw new Error('heading not rendered');
if (out.includes('<script>')) throw new Error('raw HTML not escaped');
if (!out.includes('&lt;script&gt;')) throw new Error('raw HTML should appear escaped');
if (!out.includes('<a href=\"http://www.example.com\"')) throw new Error('linkify not working');
console.log('BUNDLE OK');
"
```

Expected: prints the rendered HTML then `BUNDLE OK`.

- [ ] **Step 4: Serve the asset and add it to the shell**

In `skills/local-gui/server.mjs`, change the `ASSET_TYPES` line:

```js
const ASSET_TYPES = {
  'base.css': 'text/css; charset=utf-8',
  'base.js': 'text/javascript; charset=utf-8',
  'markdown-it.min.js': 'text/javascript; charset=utf-8',
};
```

In the `shell()` function, change the script section at the bottom of the returned HTML from:

```
${custom !== null ? '<script>window.__customPage = true</script>' : ''}
<script src="/assets/base.js"></script>
```

to:

```
${custom !== null ? '<script>window.__customPage = true</script>' : ''}
<script src="/assets/markdown-it.min.js"></script>
<script src="/assets/base.js"></script>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test skills/local-gui/`
Expected: ALL tests PASS (including the new one).

- [ ] **Step 6: Commit**

```bash
git add skills/local-gui/assets/markdown-it.min.js skills/local-gui/server.mjs skills/local-gui/server.test.mjs
git commit -m "feat: vendor markdown-it 14.1.0 and serve it in the shell"
```

---

### Task 2: Use markdown-it in the markdown block and chat bubbles

**Files:**
- Modify: `skills/local-gui/assets/base.js` (the `md()` function around line 35–46; the `chat` renderer around line 134–160)

**Interfaces:**
- Consumes: `window.markdownit` global from Task 1.
- Produces: `md(src) → html string` (same signature as before — the `markdown` block renderer keeps calling `d.innerHTML = md(b.content ?? '')` unchanged). Chat bubbles render `md(m.text)` as HTML.

- [ ] **Step 1: Replace the regex renderer**

In `skills/local-gui/assets/base.js`, DELETE these lines (the `SAFE_HREF` constant and the whole old `md()` function):

```js
  const SAFE_HREF = /^(https?:|mailto:|#|\/)/i;

  function md(src) {
    const esc = String(src).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return esc
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) =>
        SAFE_HREF.test(url) ? `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>` : label)
      .split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  }
```

and REPLACE them, at the same spot, with:

```js
  // Full markdown via vendored markdown-it. html:false escapes raw HTML
  // (same trust model as the old regex renderer); validateLink blocks
  // javascript: etc. by default. Falls back to escaped text if the
  // bundle failed to load.
  const mdit = window.markdownit
    ? window.markdownit({ html: false, linkify: true, breaks: true })
    : null;
  if (mdit) {
    const defaultLink = mdit.renderer.rules.link_open
      ?? ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    mdit.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noreferrer');
      return defaultLink(tokens, idx, options, env, self);
    };
  }

  function md(src) {
    if (mdit) return mdit.render(String(src ?? ''));
    const esc = String(src ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return `<p>${esc.replace(/\n/g, '<br>')}</p>`;
  }
```

- [ ] **Step 2: Render markdown in chat bubbles**

Still in `base.js`, in the `chat(b)` renderer, change the log construction from:

```js
      const log = el('div', { class: 'chat-log' }, (b.messages ?? []).map(m =>
        el('div', { class: `msg ${m.role}` }, m.text ?? '')));
```

to:

```js
      const log = el('div', { class: 'chat-log' }, (b.messages ?? []).map(m => {
        const d = el('div', { class: `msg ${m.role}` });
        d.innerHTML = md(m.text ?? '');
        return d;
      }));
```

And in the `send` function of the same renderer, change the optimistic bubble from:

```js
        const bubble = el('div', { class: 'msg user sending' }, text);
```

to:

```js
        const bubble = el('div', { class: 'msg user sending' });
        bubble.innerHTML = md(text);
```

- [ ] **Step 3: Run the server tests (regression check)**

Run: `node --test skills/local-gui/`
Expected: ALL tests PASS (this task changes browser-side code only; rendering is verified end-to-end in Task 5).

- [ ] **Step 4: Commit**

```bash
git add skills/local-gui/assets/base.js
git commit -m "feat: render markdown block and chat messages with markdown-it"
```

---

### Task 3: Styles for rich markdown elements

**Files:**
- Modify: `skills/local-gui/assets/base.css` (the `.msg` rule around line 141–144; the `.markdown p` / `code` rules around line 160–167)

**Interfaces:**
- Consumes: HTML produced by markdown-it inside `.card.markdown` and `.msg` containers (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Drop pre-wrap from chat bubbles**

In `skills/local-gui/assets/base.css`, change:

```css
.msg {
  padding: 8px 12px; border-radius: 10px; max-width: 85%;
  white-space: pre-wrap; font-size: .9375rem;
}
```

to (line breaks now come from markdown-it's `breaks: true`, and `pre-wrap` would render the whitespace between generated tags):

```css
.msg {
  padding: 8px 12px; border-radius: 10px; max-width: 85%;
  font-size: .9375rem;
}
```

- [ ] **Step 2: Extend the markdown styles**

Replace the existing three `.markdown p` rules:

```css
.markdown p { margin: .5em 0; }
.markdown p:first-child { margin-top: 0; }
.markdown p:last-child { margin-bottom: 0; }
```

with:

```css
.markdown p, .msg p { margin: .5em 0; }
.markdown > *:first-child, .msg > *:first-child { margin-top: 0; }
.markdown > *:last-child, .msg > *:last-child { margin-bottom: 0; }
.markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 {
  margin: 1.1em 0 .45em; line-height: 1.3; letter-spacing: -0.01em; font-weight: 600;
}
.markdown h1 { font-size: 1.25rem; }
.markdown h2 { font-size: 1.125rem; }
.markdown h3 { font-size: 1rem; }
.markdown h4, .markdown h5, .markdown h6 { font-size: .9375rem; }
.markdown ul, .markdown ol, .msg ul, .msg ol { margin: .5em 0; padding-left: 1.4em; }
.markdown li { margin: .15em 0; }
.markdown blockquote, .msg blockquote {
  margin: .6em 0; padding: 2px 14px;
  border-left: 3px solid var(--border); color: var(--muted);
}
pre {
  background: var(--accent); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 12px 14px;
  overflow-x: auto; margin: .6em 0;
}
pre code { background: none; border: none; padding: 0; font-size: .8125rem; }
.markdown hr { border: none; border-top: 1px solid var(--border); margin: 1.2em 0; }
.markdown img, .msg img { max-width: 100%; border-radius: var(--radius-sm); }
```

(Tables inside markdown blocks are covered by the existing global `table` rules further up in the file. `pre` is global so code fences also work in chat bubbles and custom pages.)

- [ ] **Step 3: Run the server tests (regression check)**

Run: `node --test skills/local-gui/`
Expected: ALL tests PASS. Visual verification happens in Task 5.

- [ ] **Step 4: Commit**

```bash
git add skills/local-gui/assets/base.css
git commit -m "feat: styles for rich markdown elements (headings, lists, code fences, quotes)"
```

---

### Task 4: Documentation and version bump to 1.3.0

**Files:**
- Modify: `skills/local-gui/SKILL.md` (markdown line in the state.json protocol, ~line 42, and the bullet list below it)
- Modify: `CHANGELOG.md` (new entry at top)
- Modify: `.claude-plugin/plugin.json` (version field)

**Interfaces:**
- Consumes: behavior implemented in Tasks 1–3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update SKILL.md**

In `skills/local-gui/SKILL.md`, change the protocol line:

```json
  { "type": "markdown", "content": "**basic** markdown: bold, italic, `code`, [link](url)" },
```

to:

```json
  { "type": "markdown", "content": "# Full markdown\nCommonMark + GFM tables/strikethrough. Raw HTML is escaped — use the html block for that." },
```

And in the bullet list under the protocol (after the "Steps:" bullet), add:

```markdown
- Markdown: full CommonMark plus GFM tables and strikethrough (markdown-it).
  Raw HTML inside markdown renders as escaped text — use the `html` block for
  raw HTML. Bare URLs auto-link; single newlines become line breaks. Chat
  messages also render markdown.
```

- [ ] **Step 2: Update CHANGELOG.md**

Insert at the top of `CHANGELOG.md`, right after the `# Changelog` heading:

```markdown
## 1.3.0

- Markdown blocks now render full CommonMark + GFM tables/strikethrough via a vendored markdown-it 14.1.0 (previously a minimal regex renderer: bold/italic/code/links only). Raw HTML in markdown is escaped; use the `html` block for raw HTML. Bare URLs auto-link and single newlines become line breaks.
- Chat messages (assistant and user) also render markdown.
- New styles for rich markdown: headings, lists, blockquotes, fenced code blocks, horizontal rules and images, in light and dark themes.
```

- [ ] **Step 3: Bump plugin.json**

In `.claude-plugin/plugin.json`, change `"version": "1.2.0"` to `"version": "1.3.0"`.

- [ ] **Step 4: Commit**

```bash
git add skills/local-gui/SKILL.md CHANGELOG.md .claude-plugin/plugin.json
git commit -m "docs: document full markdown rendering, bump to v1.3.0"
```

---

### Task 5: End-to-end verification in a real browser

**Files:**
- No repo changes. Uses a scratch directory for the GUI state; nothing committed.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: verified feature; evidence (browser snapshot) reported back.

- [ ] **Step 1: Start the server with a markdown-heavy state**

Write `<scratchpad>/gui-mdtest/state.json` (use the session scratchpad directory; create the dir first):

```json
{
  "title": "markdown e2e",
  "blocks": [
    { "type": "markdown", "content": "# Heading 1\n## Heading 2\n\n- item one\n- item two with **bold** and `code`\n\n1. first\n2. second\n\n> a quote\n\n```js\nconst x = 1;\n```\n\n| Col A | Col B |\n| --- | --- |\n| a | b |\n\n[link](https://example.com) and bare www.example.com\n\n~~struck~~ and <script>alert(1)</script>\n\n---\ndone" },
    { "type": "chat", "id": "c1", "messages": [ { "role": "assistant", "text": "Hello **bold** `code`\nsecond line" }, { "role": "user", "text": "ok *italic*" } ] }
  ]
}
```

Then:

```bash
node skills/local-gui/server.mjs --dir <scratchpad>/gui-mdtest --idle-timeout 300 &
# wait for <scratchpad>/gui-mdtest/server.info, read {port, url} from it
```

- [ ] **Step 2: Verify rendering in a browser**

Open the URL with the Playwright browser tools (`browser_navigate`, then `browser_snapshot`). Verify in the snapshot/DOM:

- `h1` "Heading 1" and `h2` "Heading 2" exist (real heading elements, not literal `#` text).
- Bulleted and numbered lists render as list elements.
- A `blockquote`, a `pre > code` block with `const x = 1;`, a `table` with header "Col A", and an `hr` exist.
- The `[link](...)` anchor has `target="_blank"` and `rel="noreferrer"`; `www.example.com` became an anchor too (linkify).
- `<script>alert(1)</script>` appears as literal escaped TEXT in the page; no alert fired; `~~struck~~` renders as strikethrough (`s` element).
- Chat: assistant bubble shows bold "bold" and a `<br>` line break; user bubble shows italic "ok".

If Playwright tools are unavailable, run `xdg-open <url>` and ask the user to confirm the same checklist visually.

- [ ] **Step 3: Shut down**

```bash
kill <server pid from server.info>
```

- [ ] **Step 4: Report**

Report the verification results (pass/fail per item above) in the final summary. No commit in this task.

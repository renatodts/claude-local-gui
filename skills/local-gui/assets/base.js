(() => {
  const app = document.getElementById('app');
  const banner = document.getElementById('banner');

  window.guiSubmit = (block, kind, value) =>
    fetch('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ block, kind, value }),
    });

  let lastUpdate = Date.now();

  const es = new EventSource('/events');
  es.onopen = () => { banner.hidden = true; };
  es.onerror = () => { banner.hidden = false; };
  es.onmessage = (e) => {
    let state;
    try { state = JSON.parse(e.data); } catch { return; }
    lastUpdate = Date.now();
    document.title = state.title || 'local-gui';
    window.dispatchEvent(new CustomEvent('gui:state', { detail: state }));
    if (window.__customPage) return;
    render(state);
  };

  // Staleness badge: shows how long since the last state broadcast once it
  // exceeds STALE_AFTER_MS. Hidden while the connection banner is showing
  // (a dropped connection is the stronger signal). Appended to <body> so it
  // also works on custom page.html pages, which replace #app but keep base.js.
  const STALE_AFTER_MS = 15_000;
  const stale = document.createElement('div');
  stale.id = 'stale-badge';
  stale.hidden = true;
  document.body.append(stale);
  setInterval(() => {
    const age = Date.now() - lastUpdate;
    const show = age >= STALE_AFTER_MS && banner.hidden;
    stale.hidden = !show;
    if (!show) return;
    const secs = Math.round(age / 1000);
    stale.textContent = secs < 60 ? `updated ${secs}s ago` : `updated ${Math.floor(secs / 60)}m ago`;
  }, 1000);

  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) n.append(c.nodeType ? c : String(c));
    return n;
  }

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

  // Disables controls, spins the clicked button and shows a "waiting" hint
  // until the next state republish re-renders the block. On network failure,
  // re-enables everything so the user can retry.
  function sendPending(card, btn, controls, block, kind, value) {
    for (const c of controls) c.disabled = true;
    btn.classList.add('loading');
    const hint = el('div', { class: 'pending-hint' },
      el('span', { class: 'spinner sm' }),
      el('span', {}, 'Sent — waiting for a response…'));
    card.append(hint);
    guiSubmit(block, kind, value)
      .then(r => { if (!r.ok) throw new Error('submit failed'); })
      .catch(() => {
        btn.classList.remove('loading');
        for (const c of controls) c.disabled = false;
        hint.classList.add('error');
        hint.replaceChildren('Failed to send — check the connection and try again.');
      });
  }

  const renderers = {
    status(b) {
      return el('div', { class: 'card status' },
        b.spinner ? el('span', { class: 'spinner' }) : null,
        el('span', {}, b.text ?? ''));
    },
    steps(b) {
      const horizontal = b.direction === 'horizontal';
      return el('div', { class: 'card' }, el('ol', { class: `steps${horizontal ? ' horizontal' : ''}` },
        (b.items ?? []).map(it => el('li', { class: `step ${it.state ?? 'pending'}`, title: it.label ?? '' },
          el('span', { class: 'step-icon' }),
          el('span', { class: 'step-label' }, it.label ?? '')))));
    },
    markdown(b) {
      const d = el('div', { class: 'card markdown' });
      d.innerHTML = md(b.content ?? '');
      return d;
    },
    html(b) {
      const d = el('div', { class: 'card' });
      d.innerHTML = b.content ?? '';
      return d;
    },
    choices(b) {
      const card = el('div', { class: 'card' });
      const choicesDiv = el('div', { class: 'choices' }, (b.options ?? []).map(o =>
        el('button', {
          class: `btn ${o.style ?? 'primary'}`,
          disabled: !!b.answered,
          onclick: (e) => sendPending(card, e.currentTarget,
            choicesDiv.querySelectorAll('button'), b.id, 'choice', o.value),
        }, o.label ?? o.value)));
      card.append(el('p', { class: 'prompt' }, b.prompt ?? ''), choicesDiv);
      return card;
    },
    form(b) {
      const form = el('form', { class: 'card form' });
      for (const f of b.fields ?? []) {
        const id = `${b.id}-${f.name}`;
        let input;
        if (f.kind === 'textarea') {
          input = el('textarea', { id, name: f.name, required: !!f.required });
        } else if (f.kind === 'select') {
          input = el('select', { id, name: f.name, required: !!f.required },
            (f.options ?? []).map(o => el('option', { value: o }, o)));
        } else {
          input = el('input', { id, name: f.name, type: f.kind ?? 'text', required: !!f.required });
        }
        input.disabled = !!b.answered;
        form.append(el('label', { for: id }, f.label ?? f.name), input);
      }
      const submitBtn = el('button', { class: 'btn primary', type: 'submit', disabled: !!b.answered },
        b.submit ?? 'Submit');
      form.append(submitBtn);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = {};
        for (const f of b.fields ?? []) {
          const raw = form.elements[f.name].value;
          value[f.name] = f.kind === 'number' ? Number(raw) : raw;
        }
        sendPending(form, submitBtn,
          form.querySelectorAll('input, textarea, select, button'), b.id, 'form', value);
      });
      return form;
    },
    chat(b) {
      const log = el('div', { class: 'chat-log' }, (b.messages ?? []).map(m => {
        const d = el('div', { class: `msg ${m.role}` });
        d.innerHTML = md(m.text ?? '');
        return d;
      }));
      const input = el('input', { type: 'text', placeholder: 'Message…', 'data-gui-chat': b.id });
      const send = () => {
        const text = input.value.trim();
        if (!text) return;
        // Optimistic bubble: replaced by the echoed message on the next re-render.
        const bubble = el('div', { class: 'msg user sending' });
        bubble.innerHTML = md(text);
        log.append(bubble);
        log.scrollTop = log.scrollHeight;
        input.value = '';
        guiSubmit(b.id, 'chat', text)
          .then(r => { if (!r.ok) throw new Error('submit failed'); bubble.classList.remove('sending'); })
          .catch(() => {
            bubble.classList.remove('sending');
            bubble.classList.add('failed');
            bubble.title = 'Failed to send';
          });
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
      const wrap = el('div', { class: 'card chat' }, log,
        el('div', { class: 'chat-input' }, input,
          el('button', { class: 'btn primary', onclick: send }, 'Send')));
      queueMicrotask(() => { log.scrollTop = log.scrollHeight; });
      return wrap;
    },
    table(b) {
      const rows = (b.rows ?? []).map(r => [...r]);
      const tbl = el('table', {},
        el('thead', {}, el('tr', {}, (b.columns ?? []).map(c => el('th', {}, c)))),
        el('tbody', {}, rows.map((row, ri) => el('tr', {}, row.map((cell, ci) => {
          if (cell && typeof cell === 'object' && cell.kind === 'checkbox') {
            const cb = el('input', { type: 'checkbox' });
            cb.checked = !!cell.checked;
            cb.disabled = !!b.answered || !b.editable;
            cb.addEventListener('change', () => {
              rows[ri][ci] = { kind: 'checkbox', checked: cb.checked };
            });
            return el('td', {}, cb);
          }
          if (b.editable && !b.answered) {
            const inp = el('input', { type: 'text' });
            inp.value = String(cell);
            inp.addEventListener('input', () => { rows[ri][ci] = inp.value; });
            return el('td', {}, inp);
          }
          return el('td', {}, String(cell));
        })))));
      const card = el('div', { class: 'card' }, tbl);
      if (b.editable) {
        card.append(el('button', {
          class: 'btn primary',
          disabled: !!b.answered,
          onclick: (e) => sendPending(card, e.currentTarget,
            card.querySelectorAll('input, button'), b.id, 'table', { rows }),
        }, b.submit ?? 'Submit'));
      }
      return card;
    },
  };

  function render(state) {
    const active = document.activeElement;
    let chatPreserve = null;
    if (active && active.hasAttribute && active.hasAttribute('data-gui-chat')) {
      chatPreserve = {
        blockId: active.getAttribute('data-gui-chat'),
        value: active.value,
        selectionStart: active.selectionStart,
        selectionEnd: active.selectionEnd,
      };
    }

    app.replaceChildren(
      el('h1', {}, state.title ?? ''),
      ...(state.blocks ?? []).map(b => {
        const r = renderers[b.type];
        return r ? r(b) : el('div', { class: 'card' }, `[unknown block: ${b.type}]`);
      }),
    );

    if (chatPreserve) {
      const next = app.querySelector(`[data-gui-chat="${CSS.escape(chatPreserve.blockId)}"]`);
      if (next) {
        next.value = chatPreserve.value;
        try { next.setSelectionRange(chatPreserve.selectionStart, chatPreserve.selectionEnd); } catch {}
        next.focus();
      }
    }
  }
})();

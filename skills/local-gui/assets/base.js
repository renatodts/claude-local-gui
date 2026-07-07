(() => {
  const app = document.getElementById('app');
  const banner = document.getElementById('banner');

  window.guiSubmit = (block, kind, value) =>
    fetch('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ block, kind, value }),
    });

  const es = new EventSource('/events');
  es.onopen = () => { banner.hidden = true; };
  es.onerror = () => { banner.hidden = false; };
  es.onmessage = (e) => {
    let state;
    try { state = JSON.parse(e.data); } catch { return; }
    document.title = state.title || 'local-gui';
    window.dispatchEvent(new CustomEvent('gui:state', { detail: state }));
    if (window.__customPage) return;
    render(state);
  };

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

  const renderers = {
    status(b) {
      return el('div', { class: 'card status' },
        b.spinner ? el('span', { class: 'spinner' }) : null,
        el('span', {}, b.text ?? ''));
    },
    steps(b) {
      return el('div', { class: 'card' }, el('ol', { class: 'steps' },
        (b.items ?? []).map(it => el('li', { class: `step ${it.state ?? 'pending'}` },
          el('span', { class: 'step-icon' }), it.label ?? ''))));
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
      const choicesDiv = el('div', { class: 'choices' }, (b.options ?? []).map(o =>
        el('button', {
          class: `btn ${o.style ?? 'primary'}`,
          disabled: !!b.answered,
          onclick: (e) => {
            for (const btn of choicesDiv.querySelectorAll('button')) btn.disabled = true;
            guiSubmit(b.id, 'choice', o.value);
          },
        }, o.label ?? o.value)));
      return el('div', { class: 'card' },
        el('p', { class: 'prompt' }, b.prompt ?? ''),
        choicesDiv);
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
      form.append(el('button', { class: 'btn primary', type: 'submit', disabled: !!b.answered },
        b.submit ?? 'Submit'));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = {};
        for (const f of b.fields ?? []) {
          const raw = form.elements[f.name].value;
          value[f.name] = f.kind === 'number' ? Number(raw) : raw;
        }
        guiSubmit(b.id, 'form', value);
      });
      return form;
    },
    chat(b) {
      const log = el('div', { class: 'chat-log' }, (b.messages ?? []).map(m =>
        el('div', { class: `msg ${m.role}` }, m.text ?? '')));
      const input = el('input', { type: 'text', placeholder: 'Message…', 'data-gui-chat': b.id });
      const send = () => {
        const text = input.value.trim();
        if (!text) return;
        guiSubmit(b.id, 'chat', text);
        input.value = '';
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
          onclick: () => guiSubmit(b.id, 'table', { rows }),
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

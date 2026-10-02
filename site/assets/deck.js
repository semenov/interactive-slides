// Slide engine shared by all presentations.
// Markup: <div class="deck"><div class="slides"><section class="slide">…</section>…</div></div>
// Interactive parts: any element with data-demo="name"; register with Deck.demo(name, el => ({start, stop})).
// start/stop are called when the slide becomes active/inactive; the factory runs on first visit.
(() => {
  'use strict';

  const factories = {};

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    }
    return el;
  }

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const KW = 'func|go|chan|select|case|default|for|range|return|var|const|make|close|if|else|struct|type|package|import|defer|len|cap|panic|nil|true|false|uint|uint16|uint32|int|string|bool';
  const TOKEN = new RegExp(
    String.raw`(\/\/.*$)|("(?:[^"\\\n]|\\.)*")|(&lt;-)|\b(` + KW + String.raw`)\b|\b(\d+)\b`,
    'gm'
  );

  // Minimal Go highlighter: comments, strings, the channel arrow, keywords, numbers.
  function highlight(src) {
    return esc(src).replace(TOKEN, (m, c, s, op, k, n) => {
      const cls = c ? 'c' : s ? 's' : op ? 'op' : k ? 'k' : 'n';
      return `<span class="${cls}">${m}</span>`;
    });
  }

  window.Deck = { demo: (name, factory) => { factories[name] = factory; }, h, highlight };

  document.addEventListener('DOMContentLoaded', () => {
    const deck = document.querySelector('.deck');
    const slidesEl = deck.querySelector('.slides');
    const slides = [...slidesEl.querySelectorAll('.slide')];
    const instances = new Map();
    let cur = -1;

    document.querySelectorAll('pre.code code').forEach(el => {
      el.innerHTML = highlight(el.textContent.replace(/^\n+|\s+$/g, ''));
    });

    const fill = h('span');
    const count = h('span', { class: 'deck-count', 'aria-live': 'polite' });
    const prev = h('button', { class: 'deck-nav', 'aria-label': 'Предыдущий слайд', onclick: () => go(cur - 1) }, '←');
    const next = h('button', { class: 'deck-nav next', 'aria-label': 'Следующий слайд', onclick: () => go(cur + 1) }, '→');
    const home = h('a', {
      class: 'deck-home',
      href: '/',
      html: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="2" y="3" width="16" height="2.5" rx="1"/><rect x="2" y="8.75" width="16" height="2.5" rx="1"/><rect x="2" y="14.5" width="16" height="2.5" rx="1"/></svg><span>Все презентации</span>',
    });
    deck.append(h('nav', { class: 'deck-bar' }, home, h('div', { class: 'deck-progress' }, fill), count, prev, next));

    slides.forEach(s => { s.inert = true; });

    function demosOf(slide) {
      if (!instances.has(slide)) {
        const els = [...slide.querySelectorAll('[data-demo]')];
        instances.set(slide, els.map(el => (factories[el.dataset.demo] && factories[el.dataset.demo](el)) || {}));
      }
      return instances.get(slide);
    }

    function go(i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      if (i === cur) return;
      const old = slides[cur];
      if (old) {
        old.classList.remove('is-active');
        old.inert = true;
        demosOf(old).forEach(d => d.stop && d.stop());
      }
      const s = slides[i];
      s.dataset.enter = i < cur ? 'prev' : 'next';
      cur = i;
      s.inert = false;
      s.classList.add('is-active');
      s.scrollTop = 0;
      demosOf(s).forEach(d => d.start && d.start());

      fill.style.width = ((i + 1) / slides.length) * 100 + '%';
      count.textContent = `${i + 1} / ${slides.length}`;
      prev.disabled = i === 0;
      next.disabled = i === slides.length - 1;
      const hash = '#' + (i + 1);
      if (location.hash !== hash) history.replaceState(null, '', hash);
    }

    const fromHash = () => (parseInt(location.hash.slice(1), 10) || 1) - 1;
    window.addEventListener('hashchange', () => go(fromHash()));

    document.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': go(cur + 1); break;
        case 'ArrowLeft': case 'PageUp': go(cur - 1); break;
        case ' ':
          if (tag === 'BUTTON' || tag === 'A') return;
          go(cur + (e.shiftKey ? -1 : 1));
          break;
        case 'Home': go(0); break;
        case 'End': go(slides.length - 1); break;
        default: return;
      }
      e.preventDefault();
    });

    // Horizontal swipe; ignored when it starts on a control or on scrollable code.
    let sx = null, sy = 0;
    slidesEl.addEventListener('touchstart', e => {
      const t = e.touches[0];
      sx = e.touches.length === 1 && !e.target.closest('input, button, pre, .no-swipe') ? t.clientX : null;
      sy = t.clientY;
    }, { passive: true });
    slidesEl.addEventListener('touchend', e => {
      if (sx == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(cur + (dx < 0 ? 1 : -1));
    }, { passive: true });

    go(fromHash());
  });
})();

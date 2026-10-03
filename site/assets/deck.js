// Slide engine shared by all presentations.
// Markup: <div class="deck"><div class="slides"><section class="slide">…</section>…</div></div>
// Code: <pre class="code"><code class="lang-sql"> (default Go; lang-plain disables highlighting).
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
  const GO_KW = 'func|go|chan|select|case|default|for|range|return|var|const|make|close|if|else|struct|type|package|import|defer|len|cap|panic|nil|true|false|uint|uint16|uint32|int|string|bool';
  const SQL_KW = 'select|from|where|and|or|not|insert|into|values|update|set|delete|begin|commit|rollback|create|table|index|on|using|check|primary|key|references|group|by|order|limit|for|skip|locked|returning|as|join|count|sum|null|now|interval|explain|analyze|engine|mergetree|like|desc|asc|is|in|alter|add|column|drop|vacuum|full|with|include|exists|distinct|case|when|then|else|end|true|false|between';
  const RULES = {
    go: new RegExp(String.raw`(\/\/.*$)|("(?:[^"\\\n]|\\.)*")|(&lt;-)|\b(` + GO_KW + String.raw`)\b|\b(\d+)\b`, 'gm'),
    sql: new RegExp(String.raw`(--.*$)|('(?:[^'\n])*')|(&lt;-)|\b(` + SQL_KW + String.raw`)\b|\b(\d+)\b`, 'gmi'),
  };

  // Minimal highlighter: comments, strings, the Go channel arrow, keywords, numbers.
  function highlight(src, lang = 'go') {
    const re = RULES[lang];
    if (!re) return esc(src);
    return esc(src).replace(re, (m, c, s, op, k, n) => {
      const cls = c ? 'c' : s ? 's' : op ? 'op' : k ? 'k' : 'n';
      return `<span class="${cls}">${m}</span>`;
    });
  }

  // Russian plural: plural(5, ['задача', 'задачи', 'задач'])
  function plural(n, forms) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  // requestAnimationFrame loop with dt in seconds; pausing freezes simulated time.
  function rafLoop(fn) {
    let id = 0, last = 0;
    const frame = t => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      fn(dt);
      id = requestAnimationFrame(frame);
    };
    return {
      start() { if (!id) { last = performance.now(); id = requestAnimationFrame(frame); } },
      stop() { cancelAnimationFrame(id); id = 0; },
    };
  }

  window.Deck = { demo: (name, factory) => { factories[name] = factory; }, h, highlight, plural, rafLoop };

  // Multiple-choice question: .opt buttons (one with data-correct) and an .explain block.
  factories.quiz = root => {
    const explain = root.querySelector('.explain');
    const opts = [...root.querySelectorAll('.opt')];
    explain.hidden = true;
    opts.forEach(b => b.addEventListener('click', () => {
      opts.forEach(o => {
        o.disabled = true;
        if (o.hasAttribute('data-correct')) o.classList.add('right');
      });
      if (!b.hasAttribute('data-correct')) b.classList.add('wrong');
      explain.hidden = false;
      explain.classList.toggle('missed', !b.hasAttribute('data-correct'));
    }));
    return {};
  };

  document.addEventListener('DOMContentLoaded', () => {
    const deck = document.querySelector('.deck');
    const slidesEl = deck.querySelector('.slides');
    const slides = [...slidesEl.querySelectorAll('.slide')];
    const instances = new Map();
    let cur = -1;

    document.querySelectorAll('pre.code code').forEach(el => {
      const lang = el.className.match(/lang-(\w+)/);
      el.innerHTML = highlight(el.textContent.replace(/^\n+|\s+$/g, ''), lang ? lang[1] : 'go');
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

    function go(i, swiped) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      if (i === cur) return;
      const old = slides[cur];
      if (old) {
        old.classList.remove('is-active');
        old.inert = true;
        demosOf(old).forEach(d => d.stop && d.stop());
      }
      const s = slides[i];
      s.dataset.enter = swiped ? 'none' : i < cur ? 'prev' : 'next';
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

    // Swipe that follows the finger. The gesture becomes a horizontal drag after a few pixels of
    // mostly-horizontal movement; vertical movement stays native scrolling of the slide.
    // Not started on range inputs, scrollable code or .no-swipe elements.
    let drag = null, settling = false;
    const EASE = 'transform 0.3s cubic-bezier(0.2, 0.7, 0.2, 1)';

    function place(off) {
      const cs = slides[cur];
      cs.style.transform = `translateX(${off}px)`;
      if (drag.nb) drag.nb.style.transform = `translateX(${off + drag.dir * slidesEl.clientWidth}px)`;
    }
    function setNeighbour(dir) {
      const nb = slides[cur + dir] || null;
      if (drag.nb === nb) return;
      if (drag.nb) { drag.nb.classList.remove('is-peek'); drag.nb.style.transform = ''; }
      drag.nb = nb;
      drag.dir = dir;
      if (nb) {
        demosOf(nb); // build demo content so the peeking slide is not empty
        nb.style.transition = 'none';
        nb.scrollTop = 0;
        nb.classList.add('is-peek');
      }
    }

    slidesEl.addEventListener('touchstart', e => {
      drag = null;
      if (settling || e.touches.length !== 1 || e.target.closest('input, textarea, pre, .no-swipe')) return;
      const t = e.touches[0];
      drag = { x0: t.clientX, y0: t.clientY, x: t.clientX, t: performance.now(), v: 0, off: 0, mode: null, nb: null, dir: 0 };
    }, { passive: true });

    slidesEl.addEventListener('touchmove', e => {
      if (!drag || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - drag.x0, dy = t.clientY - drag.y0;
      if (!drag.mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        drag.mode = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (drag.mode === 'x') {
          const cs = slides[cur];
          cs.style.animation = 'none';
          cs.style.transition = 'none';
        }
      }
      if (drag.mode !== 'x') return;
      if (e.cancelable) e.preventDefault();
      setNeighbour(dx < 0 ? 1 : -1);
      const now = performance.now(), dt = Math.max(1, now - drag.t);
      drag.v = 0.8 * ((t.clientX - drag.x) / dt) + 0.2 * drag.v;
      drag.x = t.clientX;
      drag.t = now;
      drag.off = drag.nb ? dx : dx / 3; // resist at the first and last slide
      place(drag.off);
    }, { passive: false });

    function endDrag() {
      const d = drag;
      drag = null;
      if (!d || d.mode !== 'x') return;
      const w = slidesEl.clientWidth;
      const cs = slides[cur], nb = d.nb;
      const flick = performance.now() - d.t < 100 && Math.abs(d.v) > 0.35 && Math.sign(d.v) === Math.sign(d.off);
      const commit = nb && (Math.abs(d.off) > w * 0.25 || flick);
      settling = true;
      cs.style.transition = EASE;
      if (nb) nb.style.transition = EASE;
      void cs.offsetWidth;
      cs.style.transform = `translateX(${commit ? -d.dir * w : 0}px)`;
      if (nb) nb.style.transform = `translateX(${commit ? 0 : d.dir * w}px)`;
      setTimeout(() => {
        for (const el of [cs, nb]) {
          if (!el) continue;
          el.classList.remove('is-peek');
          el.style.transform = el.style.transition = el.style.animation = '';
        }
        if (commit) go(cur + d.dir, true);
        settling = false;
      }, 310);
    }
    slidesEl.addEventListener('touchend', endDrag);
    slidesEl.addEventListener('touchcancel', endDrag);

    go(fromHash());
  });
})();

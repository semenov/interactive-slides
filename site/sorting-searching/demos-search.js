// Demos for slides 12–16: binary search (lower/upper bound, bug), binary search on the answer, rotated array, sweep line.
(() => {
  'use strict';
  const { h, highlight, plural } = Deck;

  function logger(el, keep = 2) {
    const lines = [];
    const say = (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
    say.clear = () => { lines.length = 0; };
    return say;
  }
  const btnGroup = (items, onPick, initial = 0) => {
    const btns = items.map((label, i) => h('button', { class: 'btn small' + (i === initial ? ' sel' : ''), onclick: () => pick(i) }, label));
    function pick(i) {
      btns.forEach((b, k) => b.classList.toggle('sel', k === i));
      onPick(i);
    }
    return { el: btns, pick };
  };
  const codeBlock = () => h('pre', { class: 'code bs-code' }, h('code'));
  const setCode = (pre, src) => { pre.firstChild.innerHTML = highlight(src, 'py'); };

  // ---------------------------------------------------------------- binary search: lower/upper bound and a classic bug
  Deck.demo('bsearch', root => {
    const A = [1, 3, 3, 5, 7, 7, 7, 9, 12, 15, 15, 18, 21, 24, 24, 30];
    const n = A.length;
    const TARGETS = [7, 15, 10, 31, 0];
    const MODES = [
      ['lower_bound', 'if a[mid] < x: lo = mid + 1\nelse:          hi = mid'],
      ['upper_bound', 'if a[mid] <= x: lo = mid + 1\nelse:           hi = mid'],
      ['с ошибкой', 'lo, hi = 0, len(a) - 1\nwhile lo < hi:\n    mid = (lo + hi) // 2\n    if a[mid] < x: lo = mid   # забыли + 1\n    else:          hi = mid'],
    ];
    let x = 7, mode = 0, lo, hi, mid, steps, done, stuck;
    const tG = btnGroup(TARGETS.map(t => 'x = ' + t), i => { x = TARGETS[i]; reset(); });
    const mG = btnGroup(MODES.map(m => m[0]), i => { mode = i; reset(); });
    const cells = h('div', { class: 'bs-cells' });
    const code = codeBlock();
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(
      h('div', { class: 'controls' }, tG.el),
      h('div', { class: 'controls' }, mG.el),
      cells, code,
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      logEl,
    );
    function reset() {
      say.clear();
      lo = 0; hi = mode === 2 ? n - 1 : n; mid = -1; steps = 0; done = false; stuck = 0;
      setCode(code, MODES[mode][1]);
      const what = mode === 0 ? `первый индекс, где a[i] ≥ ${x}` : mode === 1 ? `первый индекс, где a[i] > ${x}` : `${x}, но в коде ошибка`;
      say(`Ищем ${what}. ${mode === 2 ? 'Отрезок закрытый: [0, 15].' : 'Полуинтервал [0, 16): hi указывает за конец массива.'}`);
      render();
    }
    function step() {
      if (done) return;
      if (!(lo < hi)) { finish(); return; }
      mid = (lo + hi) >> 1;
      steps++;
      const v = A[mid];
      const goRight = mode === 1 ? v <= x : v < x;
      const oldLo = lo, oldHi = hi;
      if (mode === 2) { if (goRight) lo = mid; else hi = mid; }
      else if (goRight) lo = mid + 1; else hi = mid;
      if (mode === 2 && lo === oldLo && hi === oldHi) {
        stuck++;
        say(`mid = (${lo} + ${hi}) // 2 = ${mid}, a[${mid}] = ${v} &lt; ${x} → lo = mid = ${mid}. Ничего не изменилось: при hi = lo + 1 деление округляет вниз, mid = lo, и цикл крутится вечно. Нужно <code>lo = mid + 1</code>.`, 'bad');
        done = true;
        render();
        return;
      }
      const op = mode === 1 ? '≤' : '&lt;';
      say(goRight
        ? `mid = ${mid}, a[${mid}] = ${v} ${op} ${x} → lo = ${lo}. ${mode === 2 ? '' : `Всё левее ${lo} точно ${mode === 1 ? '≤' : '&lt;'} ${x}.`}`
        : `mid = ${mid}, a[${mid}] = ${v} ${mode === 1 ? '&gt;' : '≥'} ${x} → hi = ${hi}. ${mode === 2 ? '' : `Всё начиная с ${hi} точно ${mode === 1 ? '&gt;' : '≥'} ${x}.`}`);
      if (!(lo < hi)) finish();
      render();
    }
    function finish() {
      done = true;
      const log2 = Math.ceil(Math.log2(n + 1));
      if (mode === 2) {
        const right = A.findIndex(v => v >= x), want = right < 0 ? n : right;
        const ok = lo === want;
        say(`Цикл кончился: lo = hi = ${lo}. ${ok ? 'На этом входе повезло — ответ правильный. Попробуйте x = 7 или x = 31.' : `А правильный ответ — ${want}: закрытый отрезок [0, ${n - 1}] не умеет вернуть «за концом».`}`, ok ? 'warn' : 'bad');
      } else {
        const res = lo;
        const where = res === n ? `${n} — за концом массива, все элементы ${mode === 1 ? '≤' : '&lt;'} ${x}` : `${res}, a[${res}] = ${A[res]}`;
        say(`lo = hi = ${where}. ${steps} ${plural(steps, ['шаг', 'шага', 'шагов'])} — не больше ⌈log₂(n+1)⌉ = ${log2}.` +
          (mode === 0 && A[res] !== x ? ` Значения ${x} в массиве нет: это точка вставки, как у <code>bisect_left</code>.` : ''), 'ok');
      }
      render();
    }
    function render() {
      const fin = done && !stuck;
      let html = '';
      for (let i = 0; i <= n; i++) {
        let c = '';
        if (mode !== 2) {
          if (i < lo) c = 'lt'; else if (i >= hi) c = 'ge';
        } else if (i < lo || i > hi) c = 'out';
        if (i === mid && !fin) c += ' mid';
        if (fin && i === lo) c += ' ans';
        if (i === n) c += ' end';
        const marks = [];
        if (i === lo) marks.push('lo');
        if (i === mid && !fin) marks.push('mid');
        if (i === hi) marks.push('hi');
        html += `<div class="bs-c ${c}"><span class="v">${i < n ? A[i] : '∅'}</span><small>${i}</small><em>${marks.join(' ')}</em></div>`;
      }
      cells.innerHTML = html;
      stepBtn.disabled = done;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- binary search on the answer: ship within D days
  Deck.demo('ship', root => {
    const W = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const MIN = Math.max(...W), MAX = W.reduce((s, v) => s + v, 0);
    let days = 5, lo, hi, mid, steps, done;
    const split = cap => {
      const groups = [[]];
      let load = 0;
      for (const x of W) {
        if (load + x > cap) { groups.push([]); load = 0; }
        groups[groups.length - 1].push(x); load += x;
      }
      return groups;
    };
    const fits = cap => split(cap).length <= days;
    const slider = h('input', { type: 'range', min: 1, max: 10, value: days, 'aria-label': 'дней' });
    const out = h('output', null, String(days));
    slider.addEventListener('input', () => { days = +slider.value; out.textContent = days; reset(); });
    const strip = h('div', { class: 'sh-strip' });
    const groupsEl = h('div', { class: 'sh-days' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'дней D'), slider, out),
      h('div', { class: 'label' }, `вместимость от max(w) = ${MIN} до sum(w) = ${MAX}: зелёная — успеваем`),
      strip, groupsEl,
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      logEl,
    );
    function reset() {
      say.clear();
      lo = MIN; hi = MAX; mid = -1; steps = 0; done = false;
      say(`Грузы [${W.join(', ')}] надо отправить по порядку за ${days} ${plural(days, ['день', 'дня', 'дней'])}. Какая минимальная вместимость корабля?`);
      render(null);
    }
    function step() {
      if (done) return;
      mid = (lo + hi) >> 1;
      steps++;
      const g = split(mid);
      const ok = g.length <= days;
      if (ok) hi = mid; else lo = mid + 1;
      say(`Пробуем ${mid}: нужно ${g.length} ${plural(g.length, ['день', 'дня', 'дней'])} — ${ok ? `успеваем, значит, ответ ≤ ${mid}: hi = ${mid}` : `не успеваем, значит, ответ > ${mid}: lo = ${mid + 1}`}.`, ok ? 'ok' : 'warn');
      if (lo === hi) {
        done = true;
        say(`lo = hi = ${lo}: минимальная вместимость. ${steps} ${plural(steps, ['проверка', 'проверки', 'проверок'])} вместо ${MAX - MIN + 1} при переборе — каждая за O(n).`, 'ok');
        mid = lo;
      }
      render(split(mid));
    }
    function render(groups) {
      let html = '';
      for (let c = MIN; c <= MAX; c++) {
        let cls = fits(c) ? 'y' : 'n';
        if (c < lo || c > hi) cls += ' out';
        if (c === mid) cls += ' mid';
        html += `<i class="${cls}" title="${c}"></i>`;
      }
      strip.innerHTML = html + `<div class="sh-scale"><span>${MIN}</span><span>${lo}…${hi}</span><span>${MAX}</span></div>`;
      groupsEl.innerHTML = groups
        ? groups.map((g, k) => `<div class="sh-day${k >= days ? ' over' : ''}"><small>день ${k + 1}</small><div>${g.map(v => `<span class="val">${v}</span>`).join('')}</div><b>${g.reduce((s, v) => s + v, 0)}/${mid}</b></div>`).join('')
        : '<span class="empty">Нажмите «Шаг» — проверим середину диапазона.</span>';
      stepBtn.disabled = done;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- rotated sorted array
  Deck.demo('rotated', root => {
    const A = [15, 18, 22, 27, 31, 2, 5, 8, 11, 13];
    const TARGETS = [5, 27, 13, 20];
    let x = 5, lo, hi, mid, done, found, sortedSide;
    const tG = btnGroup(TARGETS.map(t => 'x = ' + t), i => { x = TARGETS[i]; reset(); });
    const cells = h('div', { class: 'bs-cells rt' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(h('div', { class: 'controls' }, tG.el), cells,
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')), logEl);
    function reset() {
      say.clear();
      lo = 0; hi = A.length - 1; mid = -1; done = false; found = -1; sortedSide = null;
      say(`Ищем ${x}. Отрезок [lo, hi] закрытый: [0, ${hi}].`);
      render();
    }
    function step() {
      if (done) return;
      if (lo > hi) { done = true; say(`lo = ${lo} > hi = ${hi}: отрезок пуст, ${x} в массиве нет. ${'O(log n)'} шагов, как у обычного бинарного поиска.`, 'warn'); render(); return; }
      mid = (lo + hi) >> 1;
      if (A[mid] === x) { done = true; found = mid; sortedSide = null; say(`a[${mid}] = ${x} — нашли.`, 'ok'); render(); return; }
      const oldLo = lo, oldHi = hi;
      let msg;
      if (A[lo] <= A[mid]) {
        sortedSide = [lo, mid];
        const inside = A[lo] <= x && x < A[mid];
        msg = `mid = ${mid}. a[lo] = ${A[lo]} ≤ a[mid] = ${A[mid]} — левая половина отсортирована. ${x} ${inside ? 'в' : 'не в'} [${A[lo]}, ${A[mid]})`;
        if (inside) hi = mid - 1; else lo = mid + 1;
      } else {
        sortedSide = [mid, hi];
        const inside = A[mid] < x && x <= A[hi];
        msg = `mid = ${mid}. a[lo] = ${A[lo]} > a[mid] = ${A[mid]} — значит, излом слева, а правая половина отсортирована. ${x} ${inside ? 'в' : 'не в'} (${A[mid]}, ${A[hi]}]`;
        if (inside) lo = mid + 1; else hi = mid - 1;
      }
      say(`${msg} → ${lo !== oldLo ? `lo = ${lo}` : `hi = ${hi}`}.`);
      render([oldLo, oldHi]);
    }
    function render(prev) {
      const range = prev || [lo, hi];
      cells.innerHTML = A.map((v, i) => {
        let c = '';
        if (i < range[0] || i > range[1]) c = 'out';
        if (sortedSide && i >= sortedSide[0] && i <= sortedSide[1]) c += ' srt';
        if (i === mid) c += found === i ? ' ans' : ' mid';
        const marks = [];
        if (i === range[0]) marks.push('lo');
        if (i === mid) marks.push('mid');
        if (i === range[1]) marks.push('hi');
        return `<div class="bs-c ${c}"><span class="v">${v}</span><small>${i}</small><em>${marks.join(' ')}</em></div>`;
      }).join('');
      stepBtn.disabled = done;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- meeting rooms / merge intervals
  Deck.demo('rooms', root => {
    const T0 = 9 * 60, T1 = 15 * 60;
    const hm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    const t = s => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
    const MEET = [
      ['A', '9:00', '10:00'], ['B', '9:30', '11:00'], ['C', '9:45', '10:30'], ['D', '10:30', '12:00'],
      ['E', '11:00', '11:30'], ['F', '13:00', '14:00'], ['G', '13:30', '15:00'], ['H', '14:00', '14:30'],
    ].map(([name, s, e]) => ({ name, s: t(s), e: t(e) }));
    const events = MEET.flatMap(m => [{ t: m.s, d: +1, m }, { t: m.e, d: -1, m }])
      .sort((a, b) => a.t - b.t || a.d - b.d); // at equal time an end goes first
    const bySt = MEET.slice().sort((a, b) => a.s - b.s);
    let mode = 0, i, cur, best, bestAt, merged, active;
    const mG = btnGroup(['Сколько переговорок', 'Слить пересечения'], k => { mode = k; reset(); });
    const chart = h('div', { class: 'rm' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(h('div', { class: 'controls' }, mG.el), chart, stats,
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')), logEl);
    const pct = m => ((m - T0) / (T1 - T0)) * 100;

    function reset() {
      say.clear();
      i = 0; cur = 0; best = 0; bestAt = null; merged = []; active = new Set();
      say(mode === 0
        ? `${MEET.length} встреч → ${events.length} событий. Отсортировали по времени, при равенстве конец раньше начала. Нажимайте «Шаг».`
        : 'Отсортировали встречи по началу. Идём по порядку и либо расширяем текущий занятый отрезок, либо начинаем новый.');
      render();
    }
    function step() {
      if (mode === 0) {
        if (i >= events.length) return;
        const ev = events[i++];
        cur += ev.d;
        if (ev.d > 0) active.add(ev.m); else active.delete(ev.m);
        if (cur > best) { best = cur; bestAt = ev.t; }
        say(`${hm(ev.t)} — ${ev.d > 0 ? 'начало' : 'конец'} ${ev.m.name}: занято ${cur}, максимум ${best}.` +
          (i === events.length ? ` Готово: нужно ${best} ${plural(best, ['переговорка', 'переговорки', 'переговорок'])} (впервые в ${hm(bestAt)}).` : ''), i === events.length ? 'ok' : '');
      } else {
        if (i >= bySt.length) return;
        const m = bySt[i++];
        const last = merged[merged.length - 1];
        if (last && m.s <= last.e) {
          const grow = m.e > last.e;
          last.e = Math.max(last.e, m.e);
          say(`${m.name} ${hm(m.s)}–${hm(m.e)} начинается не позже конца текущего (${hm(last.e)}) — ${grow ? 'расширяем' : 'целиком внутри, ничего не меняется'}.`);
        } else {
          merged.push({ s: m.s, e: m.e });
          say(last ? `${m.name} начинается в ${hm(m.s)}, после конца текущего отрезка (${hm(last.e)}) — новый отрезок.` : `${m.name} — первый отрезок ${hm(m.s)}–${hm(m.e)}.`);
        }
        active = new Set(bySt.slice(0, i));
        if (i === bySt.length) say(`Готово: занято ${merged.map(r => hm(r.s) + '–' + hm(r.e)).join(' и ')}. Свободное время — промежутки между ними.`, 'ok');
      }
      render();
    }
    function render() {
      const done = mode === 0 ? i >= events.length : i >= bySt.length;
      const lineT = mode === 0 && i > 0 ? events[i - 1].t : null;
      const lanes = (mode === 0 ? MEET : bySt).map(m => {
        const cls = active.has(m) ? (mode === 0 ? ' on' : ' seen') : '';
        return `<div class="rm-lane"><b>${m.name}</b><div class="rm-track"><span class="rm-bar${cls}" style="left:${pct(m.s)}%;width:${pct(m.e) - pct(m.s)}%"></span></div></div>`;
      }).join('');
      const mergedLane = mode === 1 ? `<div class="rm-lane merged"><b>занято</b><div class="rm-track">${merged.map(r => `<span class="rm-bar m" style="left:${pct(r.s)}%;width:${pct(r.e) - pct(r.s)}%"></span>`).join('')}</div></div>` : '';
      const ticks = [9, 10, 11, 12, 13, 14, 15].map(hh => `<span style="left:${pct(hh * 60)}%">${hh}</span>`).join('');
      chart.innerHTML = `<div class="rm-body">${lanes}${mergedLane}${lineT != null ? `<i class="rm-line" style="--x:${pct(lineT)}"></i>` : ''}</div><div class="rm-axis"><div class="rm-track">${ticks}</div></div>`;
      stats.innerHTML = mode === 0
        ? `<div class="stat"><b>${lineT != null ? hm(lineT) : '—'}</b><span>время</span></div><div class="stat"><b>${cur}</b><span>занято сейчас</span></div><div class="stat${done ? '' : ''}"><b>${best}</b><span>максимум</span></div>`
        : `<div class="stat"><b>${i}/${bySt.length}</b><span>просмотрено</span></div><div class="stat"><b>${merged.length}</b><span>отрезков</span></div><div class="stat"><b>${String(merged.reduce((s, r) => s + r.e - r.s, 0) / 60).replace(".", ",")} ч</b><span>занято всего</span></div>`;
      stepBtn.disabled = done;
    }
    reset();
    return {};
  });
})();

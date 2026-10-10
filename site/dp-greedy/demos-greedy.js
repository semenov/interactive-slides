// Demos for slides 13–18: interval scheduling, Huffman coding, line breaking, interview patterns.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs = {}, text) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  };
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }

  // ---------------------------------------------------------------- interval scheduling
  Deck.demo('intervals', root => {
    const TRAP = [[0, 16], [1, 4], [4, 8], [7, 9], [8, 12], [12, 15], [16, 20], [19, 23], [20, 24]];
    const STRATS = [
      ['end', 'раньше закончится', (p, q) => p[1] - q[1] || p[0] - q[0]],
      ['start', 'раньше начнётся', (p, q) => p[0] - q[0] || p[1] - q[1]],
      ['short', 'самая короткая', (p, q) => (p[1] - p[0]) - (q[1] - q[0]) || p[0] - q[0]],
    ];
    let iv, strat = 0, order, pos, taken, rejected, counts, timer = 0;
    const chart = h('div', { class: 'iv-chart' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const sBtns = STRATS.map(([, name], k) => h('button', { class: 'btn small' + (k === strat ? ' sel' : ''), onclick: () => { strat = k; sBtns.forEach((b, j) => b.classList.toggle('sel', j === k)); restart(); } }, name));
    const runBtn = h('button', { class: 'btn primary', onclick: () => run() }, 'Пуск');
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'сортировать по:'), ...sBtns),
      h('div', { class: 'controls' }, runBtn,
        h('button', { class: 'btn', onclick: () => { halt(); step(); } }, 'Шаг'),
        h('button', { class: 'btn', onclick: () => { iv = TRAP.map(x => x.slice()); restart(); } }, 'Ловушка'),
        h('button', { class: 'btn', onclick: () => { randomSet(); restart(); } }, 'Случайные')),
      chart, stats, logEl);

    function randomSet() {
      iv = [];
      for (let i = 0; i < 9; i++) {
        const len = 1 + Math.floor(Math.random() * 7);
        const st = Math.floor(Math.random() * (24 - len + 1));
        iv.push([st, st + len]);
      }
    }
    function greedy(cmp) {
      const ord = iv.map((x, i) => i).sort((p, q) => cmp(iv[p], iv[q]));
      const res = [];
      for (const i of ord) if (res.every(j => iv[j][1] <= iv[i][0] || iv[i][1] <= iv[j][0])) res.push(i);
      return { ord, res };
    }
    function restart() {
      halt();
      counts = STRATS.map(st => greedy(st[2]).res.length);
      order = greedy(STRATS[strat][2]).ord;
      pos = 0; taken = []; rejected = [];
      render();
      say(`Сортируем по правилу «${STRATS[strat][1]}» и берём каждую встречу, которая не пересекается с уже взятыми. Нажмите «Пуск».`);
    }
    function step() {
      if (pos >= order.length) return false;
      const i = order[pos++];
      const clash = taken.find(j => !(iv[j][1] <= iv[i][0] || iv[i][1] <= iv[j][0]));
      const [a, b] = iv[i];
      if (clash === undefined) { taken.push(i); say(`${a}:00–${b}:00 не пересекается со взятыми — берём.`); }
      else { rejected.push(i); say(`${a}:00–${b}:00 пересекается с ${iv[clash][0]}:00–${iv[clash][1]}:00 — пропускаем.`, 'warn'); }
      render(i);
      if (pos >= order.length) {
        const best = Math.max(...counts);
        say(taken.length === best
          ? `Итого ${taken.length} ${plural(taken.length, ['встреча', 'встречи', 'встреч'])} — оптимум.${strat === 0 ? ' Правило «раньше закончится» оптимально всегда.' : ' Но это совпадение — нажмите «Ловушка».'}`
          : `Итого ${taken.length}, а можно ${best}. Правило «${STRATS[strat][1]}» не доказано и ошибается.`, taken.length === best ? 'ok' : 'warn');
        halt();
        return false;
      }
    }
    function run() {
      if (timer) { halt(); return; }
      if (pos >= order.length) restart();
      timer = setInterval(() => { if (step() === false) halt(); }, 550);
      runBtn.textContent = 'Пауза';
    }
    function halt() { clearInterval(timer); timer = 0; runBtn.textContent = 'Пуск'; }
    function render(cur) {
      chart.textContent = '';
      const axis = h('div', { class: 'iv-axis' });
      for (let t = 0; t <= 24; t += 6) axis.append(h('span', { style: `left:${(t / 24) * 100}%` }, t + ':00'));
      const rows = iv.map((x, i) => i).sort((p, q) => iv[p][0] - iv[q][0] || iv[p][1] - iv[q][1]);
      for (const i of rows) {
        const [a, b] = iv[i];
        const cls = 'iv-bar' + (taken.includes(i) ? ' on' : '') + (rejected.includes(i) ? ' off' : '') + (i === cur ? ' cur' : '');
        const rank = order.indexOf(i) + 1;
        chart.append(h('div', { class: 'iv-row' }, h('span', { class: cls, style: `left:${(a / 24) * 100}%;width:${((b - a) / 24) * 100}%` }, String(rank))));
      }
      chart.append(axis);
      stats.innerHTML = STRATS.map(([, name], k) => `<div class="stat${counts[k] < Math.max(...counts) ? ' warn' : ''}"><b>${counts[k]}</b><span>${name}</span></div>`).join('');
    }
    iv = TRAP.map(x => x.slice());
    restart();
    return { stop: halt };
  });

  // ---------------------------------------------------------------- Huffman coding
  Deck.demo('huffman', root => {
    const PRESETS = ['абракадабра', 'mississippi', 'aaaaaaaabbbccd', 'hello, world'];
    let text, heap, uid, done, codes;
    const input = h('input', { class: 'txt-in wide', maxlength: 28, 'aria-label': 'Текст' });
    const heapEl = h('div', { class: 'hf-heap' });
    const svg = s('svg', { class: 'hf-svg', role: 'img', 'aria-label': 'Дерево Хаффмана' });
    const table = h('div', { class: 'hf-codes' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    input.addEventListener('input', () => load());
    root.append(
      h('div', { class: 'controls' }, ...PRESETS.map(p => h('button', { class: 'btn small', onclick: () => { input.value = p; load(); } }, p))),
      h('div', { class: 'controls' }, input),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => merge() }, 'Склеить два редких'),
        h('button', { class: 'btn', onclick: () => { while (merge(true) !== false); } }, 'Всё сразу')),
      h('div', { class: 'hf-main' }, h('div', { class: 'hf-left' }, h('span', { class: 'label' }, 'куча (по возрастанию частоты)'), heapEl, svg), table),
      stats, logEl);

    const label = n => n.ch != null ? (n.ch === ' ' ? '␣' : n.ch) : null;
    const sortHeap = () => heap.sort((p, q) => p.w - q.w || p.id - q.id);
    function load() {
      text = [...input.value].slice(0, 28);
      const freq = new Map();
      for (const c of text) freq.set(c, (freq.get(c) || 0) + 1);
      uid = 0;
      heap = [...freq].map(([ch, w]) => ({ ch, w, id: uid++ }));
      sortHeap();
      done = heap.length <= 1;
      codes = null;
      if (done && heap.length) finish();
      render();
      if (!done) say(`${heap.length} ${plural(heap.length, ['символ', 'символа', 'символов'])} в куче. Каждый шаг достаёт два самых редких узла (heappop × 2) и кладёт обратно их сумму.`);
    }
    function merge(silent) {
      if (done) return false;
      const a = heap.shift(), b = heap.shift();
      const n = { w: a.w + b.w, l: a, r: b, id: uid++ };
      heap.push(n);
      sortHeap();
      if (heap.length === 1) { done = true; finish(); }
      render(n);
      const nm = x => label(x) != null ? `«${label(x)}»` : 'узел';
      if (!done) say(`Склеили ${nm(a)} (${a.w}) и ${nm(b)} (${b.w}) → узел ${n.w}. Редкие символы оказываются глубже — их коды длиннее.`);
    }
    function finish() {
      codes = new Map();
      const walk = (n, code) => {
        if (n.ch != null) { codes.set(n.ch, code || '0'); return; }
        walk(n.l, code + '0'); walk(n.r, code + '1');
      };
      walk(heap[0], '');
      const bits = text.reduce((acc, c) => acc + codes.get(c).length, 0);
      const k = codes.size;
      const fixed = text.length * Math.max(1, Math.ceil(Math.log2(k)));
      const utf8 = new TextEncoder().encode(text.join('')).length * 8;
      stats.innerHTML = `<div class="stat"><b>${bits}</b><span>бит Хаффманом</span></div><div class="stat"><b>${fixed}</b><span>бит кодом равной длины</span></div><div class="stat"><b>${utf8}</b><span>бит в UTF-8</span></div>`;
      say(`Готово: ${bits} бит вместо ${utf8} в UTF-8. Чтобы распаковать, нужна и сама таблица кодов — в DEFLATE она передаётся в начале блока в сжатом виде.`, 'ok');
    }
    function render(fresh) {
      heapEl.innerHTML = heap.map(n => `<span class="hf-chip${n === fresh ? ' new' : ''}">${label(n) != null ? `<b>${esc(label(n))}</b>` : '<b>•</b>'}${n.w}</span>`).join('');
      // the tree: draw the current forest
      svg.textContent = '';
      const leaves = [];
      const depthOf = n => n.ch != null ? 0 : 1 + Math.max(depthOf(n.l), depthOf(n.r));
      const maxD = Math.max(0, ...heap.map(depthOf));
      const place = (n, d) => {
        n.d = d;
        if (n.ch != null) { n.x = leaves.length; leaves.push(n); return; }
        place(n.l, d + 1); place(n.r, d + 1);
        n.x = (n.l.x + n.r.x) / 2;
      };
      heap.forEach(n => place(n, maxD - depthOf(n)));
      const W = 320, H = 30 + maxD * 40;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.style.display = maxD ? '' : 'none';
      if (!maxD) { renderCodes(); return; }
      const X = n => 14 + (leaves.length > 1 ? n.x / (leaves.length - 1) : 0.5) * (W - 28);
      const Y = n => 14 + n.d * 40;
      const draw = n => {
        if (n.ch == null) {
          for (const [kid, bit] of [[n.l, '0'], [n.r, '1']]) {
            svg.append(s('line', { x1: X(n), y1: Y(n), x2: X(kid), y2: Y(kid), class: 'hf-edge' }));
            svg.append(s('text', { x: (X(n) + X(kid)) / 2 + (bit === '0' ? -6 : 6), y: (Y(n) + Y(kid)) / 2, class: 'hf-bit' }, bit));
            draw(kid);
          }
        }
        const g = s('g', { class: 'hf-node' + (n.ch != null ? ' leaf' : '') + (n === fresh ? ' new' : '') });
        g.append(s('circle', { cx: X(n), cy: Y(n), r: 10 }));
        g.append(s('text', { x: X(n), y: Y(n) + 4 }, n.ch != null ? label(n) : String(n.w)));
        svg.append(g);
      };
      heap.forEach(draw);
      renderCodes();
    }
    function renderCodes() {
      if (!codes) { table.innerHTML = '<span class="label">коды появятся, когда останется один узел</span>'; stats.innerHTML = ''; return; }
      const freq = new Map();
      for (const c of text) freq.set(c, (freq.get(c) || 0) + 1);
      table.innerHTML = '<span class="label">символ · частота · код</span>' + [...codes].sort((p, q) => freq.get(q[0]) - freq.get(p[0]))
        .map(([ch, code]) => `<div><b>${esc(ch === ' ' ? '␣' : ch)}</b><span>${freq.get(ch)}</span><code>${code}</code></div>`).join('');
    }
    input.value = PRESETS[0];
    load();
    return {};
  });

  // ---------------------------------------------------------------- line breaking: greedy vs DP
  Deck.demo('justify', root => {
    const TEXTS = [
      ['Абзац', 'Жадный перенос смотрит только на текущую строку и не думает о том, что будет дальше, а динамическое программирование выбирает разбиение всего абзаца сразу.'],
      ['Классика', 'aaa bb cc ddddd'],
    ];
    let words, width = 24, minW;
    const sl = h('input', { type: 'range', min: 10, max: 40, value: width, 'aria-label': 'Ширина строки' });
    const out = h('output');
    const cols = h('div', { class: 'jt-cols' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    sl.addEventListener('input', () => { width = +sl.value; update(); });
    const tBtns = TEXTS.map(([name, t], k) => h('button', { class: 'btn small' + (k ? '' : ' sel'), onclick: () => { tBtns.forEach((b, j) => b.classList.toggle('sel', j === k)); load(t, k ? 6 : 24); } }, name));
    root.append(
      h('div', { class: 'controls' }, ...tBtns),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'ширина, символов'), sl, out),
      cols, logEl);

    const cost = (i, j) => { // words i..j-1 on one line
      const len = words.slice(i, j).reduce((a, w) => a + w.length, 0) + (j - i - 1);
      if (len > width) return Infinity;
      return j === words.length ? 0 : (width - len) ** 2;
    };
    function greedyLines() {
      const lines = [];
      let cur = [];
      for (const w of words) {
        if (cur.length && [...cur, w].join(' ').length > width) { lines.push(cur); cur = []; }
        cur.push(w);
      }
      if (cur.length) lines.push(cur);
      return lines;
    }
    function dpLines() {
      const n = words.length, dp = Array(n + 1).fill(Infinity), nxt = Array(n + 1).fill(n);
      dp[n] = 0;
      for (let i = n - 1; i >= 0; i--) {
        for (let j = i + 1; j <= n; j++) {
          const c = cost(i, j);
          if (c === Infinity) break;
          if (c + dp[j] < dp[i]) { dp[i] = c + dp[j]; nxt[i] = j; }
        }
      }
      const lines = [];
      for (let i = 0; i < n; i = nxt[i]) lines.push(words.slice(i, nxt[i]));
      return lines;
    }
    const total = lines => lines.reduce((a, l, k) => a + (k === lines.length - 1 ? 0 : (width - l.join(' ').length) ** 2), 0);
    function col(title, lines, best) {
      const t = total(lines);
      return `<div class="jt-col${t > best ? ' worse' : ''}"><div class="jt-h"><b>${title}</b><span>цена ${t}</span></div><div class="jt-box" style="--w:${width}">` +
        lines.map((l, k) => {
          const txt = l.join(' '), gap = width - txt.length;
          const c = k === lines.length - 1 ? 0 : gap * gap;
          return `<div class="jt-line"><span>${esc(txt)}</span><i style="width:${gap}ch"></i><small>${c || ''}</small></div>`;
        }).join('') + '</div></div>';
    }
    function load(t, w) {
      words = t.split(/\s+/);
      minW = Math.max(...words.map(x => x.length));
      sl.min = Math.max(minW, 6);
      sl.max = t.length > 40 ? 40 : 16;
      width = Math.max(+sl.min, Math.min(+sl.max, w));
      sl.value = width;
      update();
    }
    function update() {
      out.textContent = width;
      const g = greedyLines(), d = dpLines();
      const tg = total(g), td = total(d);
      cols.innerHTML = col('Жадно', g, td) + col('ДП', d, td);
      logEl.className = 'log ' + (tg > td ? 'warn' : 'ok');
      logEl.innerHTML = tg > td
        ? `Жадный перенос набил первые строки до отказа и оставил дыру ниже: цена ${tg} против ${td}. ДП перенёс слово раньше, чтобы выровнять строки.`
        : 'При этой ширине жадный перенос совпал с оптимальным. Подвигайте ползунок — на других ширинах они разойдутся.';
    }
    load(TEXTS[0][1], 24);
    return {};
  });

  // ---------------------------------------------------------------- interview pattern recognition
  Deck.demo('classify', root => {
    const P = [
      ['Сколькими способами разменять сумму монетами?', 'ДП · «сколько способов»', '<code>dp[s] += dp[s − c]</code>. Цикл по монетам снаружи — считаем наборы, а не порядки.', 'O(n·S)'],
      ['Минимальная стоимость пути по сетке вправо и вниз', 'ДП · «минимальная стоимость»', '<code>dp[i][j] = a[i][j] + min(dp[i−1][j], dp[i][j−1])</code>, одна строка памяти.', 'O(n·m)'],
      ['Можно ли разбить массив на две части с равной суммой?', 'ДП · «можно ли достичь»', 'Рюкзак на суммах: <code>dp[s]</code> — достижима ли сумма. В Python — битовая маска: <code>bits |= bits &lt;&lt; x</code>.', 'O(n·S)'],
      ['Можно ли разбить строку на слова из словаря?', 'ДП · «можно ли достичь»', '<code>dp[i] = any(dp[j] and s[j:i] in words)</code>; j — не дальше длины самого длинного слова.', 'O(n·L)'],
      ['Максимальная сумма подотрезка массива', 'ДП с O(1) памяти (Кадане)', '<code>cur = max(x, cur + x)</code> — лучший отрезок, кончающийся здесь; ответ — максимум.', 'O(n)'],
      ['Выведите все подмножества / перестановки', 'Перебор с возвратом', 'Ответ сам экспоненциальный — быстрее вывода не сделать. Отсекайте дубликаты сортировкой.', 'O(2ⁿ·n) / O(n!·n)'],
      ['Сколько встреч поместится в одну переговорку?', 'Жадный · сортировка по концу', 'Аргумент обмена: самая рано закончившаяся встреча не хуже любой другой первой.', 'O(n log n)'],
      ['Сколько переговорок нужно для всех встреч?', 'Жадный + куча', 'Сортировка по началу, в <code>heapq</code> — концы занятых комнат. Освободилась — переиспользуем.', 'O(n log n)'],
      ['Можно ли допрыгнуть до конца массива? (Jump Game)', 'Жадный · «можно ли достичь»', 'Храним самую дальнюю достижимую позицию. ДП тоже сработает, но O(n²) — на собеседовании ждут жадное.', 'O(n)'],
      ['Кратчайший обход всех n ≤ 15 точек', 'ДП по маскам (Хелд — Карп)', '<code>dp[mask][v]</code> — лучший путь по множеству mask, кончающийся в v. n ≤ 20 — намёк на 2ⁿ.', 'O(2ⁿ·n²)'],
    ];
    const list = h('div', { class: 'cl-list' });
    const detail = h('div', { class: 'cl-detail', 'aria-live': 'polite' });
    const btns = P.map(([q], k) => h('button', { class: 'cl-btn', onclick: () => pick(k) }, q));
    list.append(...btns);
    root.append(h('span', { class: 'label' }, 'Нажмите на задачу — какой это шаблон?'), list, detail);
    function pick(k) {
      btns.forEach((b, j) => b.classList.toggle('sel', j === k));
      const [q, kind, how, cx] = P[k];
      detail.className = 'cl-detail ' + (kind.startsWith('Жад') ? 'greedy' : kind.startsWith('Пере') ? 'bt' : 'dp');
      detail.innerHTML = `<b>${kind}</b><p>${how}</p><span class="cl-cx">${cx}</span>`;
    }
    detail.innerHTML = '<p class="note">Здесь появится техника, состояние или правило выбора и сложность.</p>';
    return {};
  });
})();

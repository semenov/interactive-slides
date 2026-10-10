// Demos for interview patterns: two pointers, sliding window, prefix sums, binary search on the answer,
// monotonic stack, and the interview walkthrough.
(() => {
  'use strict';
  const { h, highlight, plural } = Deck;
  const { logger, fmt } = CP;
  const rnd = n => Math.floor(Math.random() * n);

  function stepper(root, onStep, onReset, extra = []) {
    const stepBtn = h('button', { class: 'btn primary', onclick: () => onStep() }, 'Шаг');
    const resetBtn = h('button', { class: 'btn', onclick: () => onReset() }, 'Сначала');
    root.append(h('div', { class: 'controls' }, stepBtn, resetBtn, ...extra));
    return stepBtn;
  }

  // ---------------------------------------------------------------- two pointers
  Deck.demo('twopointers', root => {
    let a, target, l, r, steps, done;
    const cells = h('div', { class: 'cells' });
    const info = h('div', { class: 'tp-info' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const stepBtn = stepper(root, step, start, [h('button', { class: 'btn', onclick: fresh }, 'Новый массив')]);
    root.append(cells, info, logEl);

    function fresh() {
      const set = new Set();
      while (set.size < 9) set.add(1 + rnd(30));
      a = [...set].sort((x, y) => x - y);
      if (Math.random() < 0.8) {
        const i = rnd(9); let j = rnd(9); while (j === i) j = rnd(9);
        target = a[i] + a[j];
      } else target = 2 + rnd(55);
      start();
    }
    function start() {
      l = 0; r = a.length - 1; steps = 0; done = false;
      say(`Ищем пару с суммой ${target}. Левый указатель — на самом маленьком, правый — на самом большом.`);
      render();
    }
    function step() {
      if (done) return;
      if (l >= r) { done = true; say(`Указатели встретились: пары с суммой ${target} нет. Проверено ${steps} ${plural(steps, ['сумма', 'суммы', 'сумм'])}.`, 'warn'); render(); return; }
      const s = a[l] + a[r];
      steps++;
      if (s === target) {
        done = true;
        say(`${a[l]} + ${a[r]} = ${target} — нашли за ${steps} ${plural(steps, ['шаг', 'шага', 'шагов'])}. Перебор проверил бы до ${a.length * (a.length - 1) / 2} пар.`, 'ok');
      } else if (s < target) {
        say(`${a[l]} + ${a[r]} = ${s} &lt; ${target}. Даже с самым большим числом ${a[l]} мало — выбрасываем его, сдвигаем левый.`);
        l++;
      } else {
        say(`${a[l]} + ${a[r]} = ${s} &gt; ${target}. Даже с самым маленьким числом ${a[r]} много — выбрасываем его, сдвигаем правый.`);
        r--;
      }
      render();
    }
    function render() {
      cells.innerHTML = a.map((v, i) => {
        const out = i < l || i > r;
        const found = done && l < r && a[l] + a[r] === target && (i === l || i === r);
        const cls = found ? 'hit' : out ? 'out' : i === l || i === r ? 'ptr' : '';
        const tag = i === l && i === r ? 'L R' : i === l ? 'L' : i === r ? 'R' : '';
        return `<div class="cell ${cls}"><b>${v}</b><small>${tag || i}</small></div>`;
      }).join('');
      const s = l < r ? a[l] + a[r] : null;
      info.innerHTML = `<span>target <b>${target}</b></span><span>сейчас ${s == null ? '—' : `<b>${a[l]} + ${a[r]} = ${s}</b>`}</span><span>шагов <b>${steps}</b></span>`;
      stepBtn.disabled = done;
    }
    fresh();
    return {};
  });

  // ---------------------------------------------------------------- sliding window
  Deck.demo('window', root => {
    const WORDS = ['abcabcbb', 'pwwkew', 'dvdfabcaeb'];
    let s = WORDS[2], r, l, last, best, bestL, done;
    const wbtn = WORDS.map(w => h('button', { class: 'btn small', onclick: () => { s = w; start(); } }, w));
    const cells = h('div', { class: 'cells' });
    const mapEl = h('div', { class: 'sw-map' });
    const info = h('div', { class: 'tp-info' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('div', { class: 'controls' }, ...wbtn));
    const stepBtn = stepper(root, step, start);
    root.append(cells, mapEl, info, logEl);

    function start() {
      wbtn.forEach(b => b.classList.toggle('sel', b.textContent === s));
      r = 0; l = 0; last = {}; best = 0; bestL = 0; done = false;
      say('Окно пустое. Правая граница будет добавлять по символу.');
      render();
    }
    function step() {
      if (done) return;
      const ch = s[r];
      let msg;
      if (ch in last && last[ch] >= l) {
        const nl = last[ch] + 1;
        msg = `«${ch}» уже в окне на позиции ${last[ch]} — левая граница прыгает на ${nl}.`;
        l = nl;
      } else msg = `«${ch}» в окне нет — расширяем.`;
      last[ch] = r;
      const len = r - l + 1;
      if (len > best) { best = len; bestL = l; msg += ` Новый рекорд: ${len}.`; }
      r++;
      if (r >= s.length) { done = true; msg += ` Конец строки: ответ ${best} — «${s.slice(bestL, bestL + best)}». Правая граница прошла ${s.length} раз, левая только вперёд.`; }
      say(msg, done ? 'ok' : '');
      render();
    }
    function render() {
      cells.innerHTML = [...s].map((c, i) => {
        const inWin = i >= l && i < r;
        const isBest = done && i >= bestL && i < bestL + best;
        const cls = isBest ? 'hit' : inWin ? 'win' : i < l ? 'out' : '';
        const tag = (i === l && l < r ? 'l' : '') + (i === r - 1 ? (i === l && l < r ? ' ' : '') + 'r' : '');
        return `<div class="cell ${cls}"><b>${c}</b><small>${tag || i}</small></div>`;
      }).join('');
      const keys = Object.keys(last);
      mapEl.innerHTML = '<span class="label">last =</span> ' + (keys.length ? keys.map(k => `<span class="kv ${last[k] >= l ? '' : 'stale'}">${k}:${last[k]}</span>`).join('') : '<span class="empty">{}</span>');
      info.innerHTML = `<span>окно <b>${r > l ? `«${s.slice(l, r)}»` : '—'}</b></span><span>лучшее <b>${best}</b></span>`;
      stepBtn.disabled = done;
    }
    start();
    return {};
  });

  // ---------------------------------------------------------------- prefix sums
  Deck.demo('prefix', root => {
    let a = [3, -1, 4, 1, -5, 9, 2, -6, 5, 3];
    const lIn = h('input', { type: 'range', min: 0, max: 9, value: 2, 'aria-label': 'Левая граница' });
    const rIn = h('input', { type: 'range', min: 0, max: 9, value: 6, 'aria-label': 'Правая граница' });
    const lOut = h('output'), rOut = h('output');
    const grid = h('div', { class: 'ps-grid' });
    const formula = h('div', { class: 'ps-formula' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'l'), lIn, lOut),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'r'), rIn, rOut),
      grid, formula,
      h('div', { class: 'controls' }, h('button', { class: 'btn small', onclick: () => { a = a.map(() => rnd(19) - 9); update(); } }, 'Другие числа')),
      logEl,
    );
    lIn.addEventListener('input', () => { if (+lIn.value > +rIn.value) rIn.value = lIn.value; update(); });
    rIn.addEventListener('input', () => { if (+rIn.value < +lIn.value) lIn.value = rIn.value; update(); });
    function update() {
      const l = +lIn.value, r = +rIn.value;
      lOut.textContent = l; rOut.textContent = r;
      const P = [0];
      a.forEach(x => P.push(P[P.length - 1] + x));
      const row = (label, arr, cls) => `<span class="ps-l">${label}</span>` + arr.map((v, i) => `<span class="ps-c ${cls(i)}"><b>${v}</b><small>${i}</small></span>`).join('');
      grid.innerHTML =
        `<div class="ps-row a">${row('a', a, i => i >= l && i <= r ? 'in' : '')}<span class="ps-c ghost"></span></div>` +
        `<div class="ps-row p">${row('P', P, i => i === l ? 'lo' : i === r + 1 ? 'hi' : '')}</div>`;
      const sum = P[r + 1] - P[l];
      formula.innerHTML = `сумма a[${l}..${r}] = <span class="hi">P[${r + 1}]</span> − <span class="lo">P[${l}]</span> = ${P[r + 1]} − ${P[l] < 0 ? '(' + P[l] + ')' : P[l]} = <b>${sum}</b>`;
      const k = r - l + 1;
      logEl.innerHTML = `Наивно — ${k} ${plural(k, ['сложение', 'сложения', 'сложений'])} на каждый запрос, с префиксами — одно вычитание. P[i] хранит сумму всего, что левее i, поэтому лишнее «до l» просто вычитается.`;
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- binary search on the answer
  Deck.demo('binans', root => {
    const W = [3, 2, 2, 4, 1, 4, 7, 3, 5, 2];
    const LO = Math.max(...W), HI = W.reduce((s, x) => s + x, 0);
    let D = 4, lo, hi, mid, tries, done;
    const dbtn = [2, 3, 4, 5].map(d => h('button', { class: 'btn small', onclick: () => { D = d; start(); } }, `D = ${d}`));
    const range = h('div', { class: 'ba-range' });
    const pk = h('div', { class: 'ba-pk' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('div', { class: 'controls' }, ...dbtn));
    const stepBtn = stepper(root, step, start);
    root.append(range, pk, logEl);

    function groups(c) {
      const g = [[]]; let load = 0;
      for (const w of W) {
        if (load + w > c) { g.push([]); load = 0; }
        g[g.length - 1].push(w); load += w;
      }
      return g;
    }
    function start() {
      dbtn.forEach(b => b.classList.toggle('sel', b.textContent === `D = ${D}`));
      lo = LO; hi = HI; mid = null; tries = 0; done = false;
      say(`Ответ где-то между ${LO} (самая тяжёлая посылка) и ${HI} (всё за один день). Проверка «хватит ли C» — жадно: грузим, пока влезает.`);
      render();
    }
    function step() {
      if (done) return;
      mid = Math.floor((lo + hi) / 2);
      tries++;
      const days = groups(mid).length;
      if (days <= D) {
        say(`C = ${mid}: нужно ${days} ${plural(days, ['день', 'дня', 'дней'])} ≤ ${D} — хватает. Ответ не больше ${mid}: hi = ${mid}.`, 'ok');
        hi = mid;
      } else {
        say(`C = ${mid}: нужно ${days} ${plural(days, ['день', 'дня', 'дней'])} &gt; ${D} — мало. Ответ больше: lo = ${mid + 1}.`, 'warn');
        lo = mid + 1;
      }
      if (lo === hi) {
        done = true;
        mid = lo;
        say(`lo = hi = ${lo} — это ответ. ${tries} ${plural(tries, ['проверка', 'проверки', 'проверок'])} вместо ${HI - LO + 1} при переборе всех C подряд.`, 'ok');
      }
      render();
    }
    function render() {
      const X = v => ((v - LO) / (HI - LO)) * 100;
      range.innerHTML = `<div class="ba-track"><span class="ba-live" style="left:${X(lo)}%;width:${Math.max(0.8, X(hi) - X(lo))}%"></span>` +
        (mid != null ? `<i class="ba-mid" style="left:${X(mid)}%"></i>` : '') + `</div>` +
        `<div class="ba-axis"><span>${LO}</span><span>lo = <b>${lo}</b> · hi = <b>${hi}</b>${mid != null ? ` · C = <b>${mid}</b>` : ''}</span><span>${HI}</span></div>`;
      if (mid == null) {
        pk.innerHTML = '<span class="label">посылки по порядку:</span> ' + W.map(w => `<span class="val">${w}</span>`).join('');
      } else {
        const g = groups(mid);
        pk.innerHTML = `<span class="label">C = ${mid}: ${g.length} ${plural(g.length, ['день', 'дня', 'дней'])}</span>` +
          g.map((grp, i) => `<span class="ba-day d${i % 6} ${i >= D ? 'over' : ''}"><small>день ${i + 1}</small>${grp.map(w => `<span class="val">${w}</span>`).join('')}<em>${grp.reduce((s, x) => s + x, 0)}</em></span>`).join('');
      }
      stepBtn.disabled = done;
    }
    start();
    return {};
  });

  // ---------------------------------------------------------------- monotonic stack
  Deck.demo('monostack', root => {
    const A = [73, 74, 75, 71, 69, 72, 76, 73];
    let i, st, ans, ops, done;
    const cells = h('div', { class: 'cells ms-cells' });
    const stackEl = h('div', { class: 'ms-stack' });
    const info = h('div', { class: 'tp-info' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const stepBtn = stepper(root, step, start);
    root.append(cells, stackEl, info, logEl);

    function start() {
      i = 0; st = []; ans = A.map(() => null); ops = 0; done = false;
      say('Температуры по дням. Для каждого дня ищем ближайший следующий, когда станет теплее.');
      render();
    }
    function step() {
      if (done) return;
      if (i >= A.length) {
        st.forEach(j => { ans[j] = -1; });
        say(`Массив кончился. В стеке остались ${st.map(j => A[j]).join(', ')} — для них большего справа нет: −1. Всего ${ops} ${plural(ops, ['операция', 'операции', 'операций'])} со стеком ≤ 2n = ${2 * A.length}.`, 'ok');
        st = []; done = true;
      } else if (st.length && A[st[st.length - 1]] < A[i]) {
        const j = st.pop();
        ans[j] = A[i];
        ops++;
        say(`${A[i]} &gt; ${A[j]} на вершине: вынимаем ${A[j]}, его ответ — ${A[i]}.`);
      } else {
        st.push(i);
        ops++;
        say(st.length > 1 ? `${A[i]} не больше вершины — кладём в стек. Значения в стеке убывают.` : `Стек пуст — кладём ${A[i]}.`);
        i++;
      }
      render();
    }
    function render() {
      const inSt = new Set(st);
      cells.innerHTML = A.map((v, k) => {
        const cls = k === i && !done ? 'ptr' : inSt.has(k) ? 'wait' : ans[k] != null ? 'out' : '';
        const a = ans[k] == null ? '·' : ans[k] === -1 ? '−1' : ans[k];
        return `<div class="cell ${cls}"><b>${v}</b><small>${k}</small><span class="ms-ans ${ans[k] != null ? 'set' : ''}">${a}</span></div>`;
      }).join('');
      stackEl.innerHTML = '<span class="label">стек (вершина справа)</span>' +
        `<div class="ms-items">${st.length ? st.map(j => `<span class="val">${A[j]}</span>`).join('') : '<span class="empty">пуст</span>'}</div>`;
      info.innerHTML = `<span>i = <b>${Math.min(i, A.length)}</b></span><span>операций со стеком <b>${ops}</b></span>`;
      stepBtn.disabled = done;
    }
    start();
    return {};
  });

  // ---------------------------------------------------------------- interview walkthrough
  Deck.demo('interview', root => {
    const STAGES = [
      ['Уточнить', 'Задача: дан массив чисел и target, вернуть индексы двух элементов с суммой target. Спросите: отсортирован ли массив? Может ли быть несколько ответов — вернуть любой? Можно ли взять один элемент дважды? Какой размер — до 10⁵? Что вернуть, если пары нет?', null],
      ['Примеры', 'Разберите 2–3 примера руками, включая неудобные. Это ловит недопонимание раньше, чем вы напишете код.', '[2, 7, 11, 15], 9  ->  (0, 1)\n[3, 3], 6          ->  (0, 1)   # дубликаты\n[3, 2, 4], 6       ->  (1, 2)   # не (0, 0)!\n[1, 2], 7          ->  None'],
      ['Перебор', 'Сначала — очевидное решение вслух, с оценкой. Код пока можно не писать: важно показать, что решение вообще есть.', 'for i in range(n):\n    for j in range(i + 1, n):\n        if a[i] + a[j] == target:\n            return i, j\n# O(n²) времени, O(1) памяти: при n = 10⁵ — 5·10⁹ шагов'],
      ['Оптимизация', 'Где узкое место? Внутренний цикл ищет число target − a[i]. Быстрый поиск — хеш-таблица: O(1). Сортировка + два указателя дала бы O(n log n), но потеряла бы исходные индексы. Обсудите варианты и выберите.', null],
      ['Код', 'Пишите чисто: понятные имена, без лишних оптимизаций. Проговаривайте, что делаете.', 'def two_sum(a, target):\n    seen = {}                  # значение -> индекс\n    for i, x in enumerate(a):\n        j = seen.get(target - x)\n        if j is not None:\n            return j, i\n        seen[x] = i            # после проверки!\n    return None'],
      ['Тесты', 'Прогоните код руками на своих примерах. [3, 3], 6: i=0 — seen пуст, кладём {3: 0}; i=1 — 6 − 3 = 3 есть, ответ (0, 1). [3, 2, 4], 6: при i=0 ищем 3 — его ещё нет в seen, поэтому (0, 0) не получится. Пустой массив — None.', null],
      ['Сложность', 'Время O(n) — один проход, операции dict в среднем O(1). Память O(n) — словарь. Назовите компромисс: если массив уже отсортирован, два указателя дают O(n) времени и O(1) памяти.', null],
    ];
    let cur = 0;
    const chips = STAGES.map(([t], i) => h('button', { class: 'iv-chip', onclick: () => go(i) }, h('span', null, i + 1), t));
    const body = h('div', { class: 'iv-body', 'aria-live': 'polite' });
    const prev = h('button', { class: 'btn', onclick: () => go(cur - 1) }, '← Назад');
    const next = h('button', { class: 'btn primary', onclick: () => go(cur + 1) }, 'Дальше →');
    root.append(h('div', { class: 'iv-chips' }, ...chips), body, h('div', { class: 'controls' }, prev, next));
    function go(i) {
      cur = Math.max(0, Math.min(STAGES.length - 1, i));
      const [t, text, code] = STAGES[cur];
      chips.forEach((c, k) => { c.classList.toggle('sel', k === cur); c.classList.toggle('done', k < cur); });
      body.innerHTML = `<b>${cur + 1}. ${t}</b><p>${text}</p>` + (code ? `<pre class="code"><code>${highlight(code, 'py')}</code></pre>` : '');
      prev.disabled = cur === 0;
      next.disabled = cur === STAGES.length - 1;
    }
    go(0);
    return {};
  });
})();

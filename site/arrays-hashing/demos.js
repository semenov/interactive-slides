// Demos for slides 2–4: dynamic array, array vs linked list in memory, ring buffer.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const fmt = n => n.toLocaleString('ru-RU');

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  window.ArrDemo = { logger, fmt };

  // A row of segmented buttons; returns a setter that marks the selected one.
  function segmented(items, onPick, cls = '') {
    const wrap = h('div', { class: 'controls seg ' + cls });
    const btns = items.map(([id, label]) => h('button', { class: 'btn small', onclick: () => { mark(id); onPick(id); } }, label));
    btns.forEach(b => wrap.append(b));
    function mark(id) { btns.forEach((b, i) => b.classList.toggle('sel', items[i][0] === id)); }
    return { el: wrap, mark };
  }
  window.ArrDemo.segmented = segmented;

  // ---------------------------------------------------------------- dynamic array
  Deck.demo('array', root => {
    // Growth rules as the runtimes implement them (for one extra element).
    const GROW = {
      py: {
        name: 'Python list',
        // CPython list_resize: also shrinks when less than half is used.
        resize(cap, n) {
          if (cap >= n && n >= cap >> 1) return cap;
          if (n === 0) return 0;
          return (n + (n >> 3) + 6) & ~3;
        },
        rule: 'n + n/8 + 6, кратно 4 (≈ ×1,125); сжимается, когда занято меньше половины',
      },
      go: {
        name: 'Go slice',
        resize(cap, n) {
          if (n <= cap) return cap;
          if (cap === 0) return n;
          if (cap < 256) return Math.max(n, cap * 2);
          let c = cap;
          while (c < n) c += (c + 3 * 256) >> 2;
          return c;
        },
        rule: '×2 до 256 элементов, дальше плавно к ×1,25 (плюс округление до класса размера аллокатора)',
      },
      java: {
        name: 'Java ArrayList',
        resize(cap, n) {
          if (n <= cap) return cap;
          if (cap === 0) return Math.max(10, n);
          return Math.max(n, cap + (cap >> 1));
        },
        rule: '10 при первом add, дальше ×1,5',
      },
    };
    let mode = 'py', arr, cap, copies, shifts, appends, reallocs, flash, nextVal;
    const seg = segmented([['py', 'Python'], ['go', 'Go'], ['java', 'Java']], id => { mode = id; reset(); });
    const rule = h('p', { class: 'note ar-rule' });
    const cells = h('div', { class: 'ar-cells' });
    const stats = h('div', { class: 'stats ar-stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      seg.el, rule,
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => append(1) }, h('code', null, 'append')),
        h('button', { class: 'btn', onclick: () => append(10) }, '×10'),
        h('button', { class: 'btn', onclick: () => append(100) }, '×100'),
        h('button', { class: 'btn', onclick: insert0 }, h('code', null, 'insert(0, x)')),
        h('button', { class: 'btn', onclick: pop0 }, h('code', null, 'pop(0)')),
        h('button', { class: 'btn', onclick: popEnd }, h('code', null, 'pop()')),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс'),
      ),
      cells, stats, logEl,
    );

    function reset() {
      arr = []; cap = 0; copies = 0; shifts = 0; appends = 0; reallocs = 0; flash = false; nextVal = 1;
      seg.mark(mode);
      rule.innerHTML = `<b>${GROW[mode].name}:</b> ${GROW[mode].rule}.`;
      say('Пустой массив: ёмкость 0. Нажмите <code>append</code>.');
      render();
    }
    // Ensure room for n elements; returns copied count (0 if no reallocation).
    function ensure(n) {
      const nc = GROW[mode].resize(cap, n);
      if (nc === cap) return 0;
      reallocs++;
      copies += arr.length;
      const old = cap;
      cap = nc;
      flash = true;
      return { old, moved: arr.length };
    }
    function append(k) {
      let last = null, grew = 0;
      for (let i = 0; i < k; i++) {
        const r = ensure(arr.length + 1);
        if (r) { last = r; grew++; }
        arr.push(nextVal++);
        appends++;
      }
      if (k === 1) {
        if (last) say(`Место кончилось: выделен блок на ${cap}, скопировано ${last.moved} ${plural(last.moved, ['элемент', 'элемента', 'элементов'])}. Следующие ${cap - arr.length} append — без копирования.`, 'warn');
        else say(`append в свободный слот: O(1). Свободно ещё ${cap - arr.length}.`);
      } else {
        say(`${k} append: ${grew ? `${grew} ${plural(grew, ['перевыделение', 'перевыделения', 'перевыделений'])}` : 'без перевыделений'}. За всё время скопировано ${fmt(copies)} — ${(copies / appends).toFixed(2).replace('.', ',')} на один append.`, grew ? 'warn' : '');
      }
      render();
    }
    function insert0() {
      const r = ensure(arr.length + 1);
      const moved = arr.length;
      arr.unshift(nextVal++);
      shifts += moved;
      say(`insert(0, x): ${r ? `сначала перевыделение на ${cap}, потом ` : ''}сдвиг ${moved} ${plural(moved, ['элемента', 'элементов', 'элементов'])} вправо — O(n).`, moved > 20 ? 'warn' : '');
      render();
    }
    function pop0() {
      if (!arr.length) { say('Массив пуст.'); return; }
      arr.shift();
      const moved = arr.length;
      shifts += moved;
      const r = mode === 'py' ? shrink() : 0;
      say(`pop(0): ${moved} ${plural(moved, ['элемент сдвинут', 'элемента сдвинуты', 'элементов сдвинуты'])} влево — O(n).${r ? ` И список сжался до ${cap}.` : ''}`, moved > 20 ? 'warn' : '');
      render();
    }
    function popEnd() {
      if (!arr.length) { say('Массив пуст.'); return; }
      arr.pop();
      const r = mode === 'py' ? shrink() : 0;
      say(`pop(): просто уменьшили длину — O(1).${r ? ` Занято меньше половины — CPython сжал список до ${cap}, скопировав ${arr.length}.` : ''}`);
      render();
    }
    function shrink() {
      const nc = GROW.py.resize(cap, arr.length);
      if (nc === cap) return 0;
      copies += arr.length; reallocs++; cap = nc; flash = true;
      return 1;
    }
    function render() {
      cells.innerHTML = '';
      if (cap <= 64) {
        cells.className = 'ar-cells';
        for (let i = 0; i < cap; i++) {
          cells.append(h('span', { class: 'ar-c' + (i < arr.length ? ' on' : '') + (flash ? ' new' : '') }, i < arr.length ? String(arr[i]) : ''));
        }
        if (!cap) cells.append(h('span', { class: 'empty' }, 'памяти под элементы ещё нет'));
      } else {
        cells.className = 'ar-cells big';
        cells.append(
          h('div', { class: 'ar-bar' + (flash ? ' new' : '') }, h('span', { style: `width:${(arr.length / cap) * 100}%` })),
          h('span', { class: 'label' }, `${fmt(arr.length)} из ${fmt(cap)} занято`));
      }
      flash = false;
      stats.innerHTML = [
        ['длина / ёмкость', `${fmt(arr.length)} / ${fmt(cap)}`],
        ['перевыделений', fmt(reallocs)],
        ['копий при росте', fmt(copies)],
        ['сдвигов', fmt(shifts)],
      ].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- array vs linked list
  Deck.demo('chase', root => {
    const LINES = 12, SLOTS = 8, N = 12, MISS = 100, HIT = 1;
    // Array: slots 0..11. List nodes: 2 slots each (value, next), node positions in lines 2..11.
    const NODE_POS = (LINES - 2) * SLOTS / 2;
    let nodePos, cached, timer = 0, cur = null, misses, hits, ns, which, scattered = true;
    const mem = h('div', { class: 'ch-mem' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const shufBtn = h('button', { class: 'btn small', onclick: toggleLayout }, '');
    const legend = h('div', { class: 'ch-legend' },
      h('span', null, h('i', { class: 'sw ch-a' }), 'массив'),
      h('span', null, h('i', { class: 'sw ch-v' }), 'узел: значение'),
      h('span', null, h('i', { class: 'sw ch-p' }), 'узел: next'),
      h('span', null, h('i', { class: 'sw ch-l' }), 'линия в кэше'));
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => run('arr') }, 'Пройти массив'),
        h('button', { class: 'btn primary', onclick: () => run('list') }, 'Пройти список'),
        shufBtn),
      mem, legend, stats, logEl);

    function layout() {
      const all = [...Array(NODE_POS).keys()];
      if (scattered) {
        for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
      }
      nodePos = all.slice(0, N);
      shufBtn.textContent = scattered ? 'Узлы подряд (только что созданы)' : 'Узлы вразброс (после долгой работы)';
    }
    const nodeSlot = i => 2 * SLOTS + nodePos[i] * 2;
    const lineOf = slot => Math.floor(slot / SLOTS);
    const addr = slot => '0x' + (0x1000 + slot * 8).toString(16);

    function toggleLayout() {
      stopRun();
      scattered = !scattered;
      layout();
      resetStats();
      say(scattered
        ? 'Узлы разбросаны по куче: так бывает, когда список долго жил среди других аллокаций, вставок и удалений.'
        : 'Узлы созданы подряд и лежат рядом — аллокатор выдал соседние куски. Пока список молод, он почти как массив.');
      render();
    }
    function resetStats() { cached = new Set(); misses = 0; hits = 0; ns = 0; cur = null; which = null; }
    function stopRun() { clearInterval(timer); timer = 0; }

    function run(kind) {
      stopRun();
      resetStats();
      which = kind;
      let i = 0, prevLine = -1;
      const step = () => {
        if (i >= N) {
          stopRun();
          cur = null;
          const t = ns;
          say(kind === 'arr'
            ? `Массив: ${misses} ${plural(misses, ['промах', 'промаха', 'промахов'])} на ${N} элементов, ~${t} нс. Элементы идут подряд, одна линия — 8 значений, а следующую подтягивает префетчер.`
            : `Список: ${misses} ${plural(misses, ['промах', 'промаха', 'промахов'])} на ${N} узлов, ~${fmt(t)} нс. ${scattered ? 'Каждый следующий адрес известен только после загрузки текущего узла — промахи идут строго друг за другом.' : 'Узлы лежат подряд, и префетчер справляется — но это ненадолго.'}`,
            kind === 'list' && misses > 4 ? 'warn' : 'ok');
          render();
          return;
        }
        const slots = kind === 'arr' ? [i] : [nodeSlot(i), nodeSlot(i) + 1];
        const line = lineOf(slots[0]);
        const hit = cached.has(line);
        if (hit) { hits++; ns += HIT; } else { misses++; ns += MISS; cached.add(line); }
        // Hardware prefetcher: moving to the next line in order → fetch the one after it too.
        if (line !== prevLine) {
          if (prevLine === line - 1) cached.add(line + 1);
          prevLine = line;
        }
        cur = slots;
        if (kind === 'list') {
          const nx = i + 1 < N ? `следующий узел по адресу ${addr(nodeSlot(i + 1))}` : 'next = nil';
          say(`Узел ${i + 1} на линии ${line}: ${hit ? 'попадание, ~1 нс' : 'промах — ждём память ~100 нс'}. Читаем next → ${nx}.`, hit ? '' : 'warn');
        } else {
          say(`a[${i}] по адресу ${addr(i)}, линия ${line}: ${hit ? 'попадание, ~1 нс' : 'промах, ~100 нс — зато загружены сразу 8 элементов'}.`, hit ? '' : 'warn');
        }
        i++;
        render();
      };
      step();
      timer = setInterval(step, 380);
    }

    function render() {
      const owner = new Map();
      for (let i = 0; i < N; i++) owner.set(i, ['ch-a', String(i + 1)]);
      for (let i = 0; i < N; i++) {
        const s = nodeSlot(i);
        owner.set(s, ['ch-v', String(i + 1)]);
        owner.set(s + 1, ['ch-p', i + 1 < N ? '→' + (i + 2) : '∅']);
      }
      mem.innerHTML = '';
      for (let l = 0; l < LINES; l++) {
        const row = h('div', { class: 'ch-row' + (cached && cached.has(l) ? ' in' : '') }, h('span', { class: 'ch-addr' }, addr(l * SLOTS)));
        for (let s = 0; s < SLOTS; s++) {
          const slot = l * SLOTS + s;
          const o = owner.get(slot);
          const isCur = cur && cur.includes(slot);
          row.append(h('span', { class: 'ch-c ' + (o ? o[0] : 'ch-x') + (isCur ? ' cur' : '') }, o ? o[1] : ''));
        }
        mem.append(row);
      }
      stats.innerHTML = [
        ['промахов кэша', misses],
        ['попаданий', hits],
        ['время, нс', fmt(ns)],
      ].map(([l, v], k) => `<div class="stat${k === 0 && misses > 4 ? ' warn' : ''}"><b>${v}</b><span>${l}</span></div>`).join('');
    }

    layout();
    resetStats();
    say('Сверху — массив из 12 чисел, ниже — список из 12 узлов среди чужих объектов. Строка — одна кэш-линия, 64 байта.');
    render();
    return { stop: stopRun };
  });

  // ---------------------------------------------------------------- ring buffer
  Deck.demo('ring', root => {
    let cap, buf, head, len, next, overwrite = false, last = -1;
    const cells = h('div', { class: 'rg-cells' });
    const formula = h('div', { class: 'rg-formula' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const seg = segmented([['grow', 'Переполнение: расти'], ['over', 'Переполнение: затирать']], id => { overwrite = id === 'over'; seg.mark(id); });
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: pushBack }, h('code', null, 'push_back')),
        h('button', { class: 'btn primary', onclick: popFront }, h('code', null, 'pop_front')),
        h('button', { class: 'btn', onclick: pushFront }, h('code', null, 'push_front')),
        h('button', { class: 'btn', onclick: popBack }, h('code', null, 'pop_back')),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      seg.el, cells, formula, logEl);

    const tail = () => (head + len) % cap;
    function reset() {
      cap = 8; buf = Array(cap).fill(null); head = 5; len = 0; next = 1; last = -1;
      seg.mark(overwrite ? 'over' : 'grow');
      say('Пустое кольцо на 8 ячеек; head специально начинает с 5, чтобы быстрее дойти до края. Очередь: push_back + pop_front.');
      render();
    }
    function grow() {
      if (cap >= 32) return false;
      const nb = Array(cap * 2).fill(null);
      for (let i = 0; i < len; i++) nb[i] = buf[(head + i) % cap];
      const old = cap;
      buf = nb; cap *= 2; head = 0;
      say(`Кольцо заполнено: новый массив на ${cap}, ${old} элементов скопированы по порядку начиная с head — кольцо «распрямилось», head = 0.`, 'warn');
      return true;
    }
    function full() {
      if (len < cap) return 'ok';
      if (overwrite) return 'over';
      if (grow()) return 'grew';
      say('Дальше не растём: максимум 32 ячейки в этой схеме.', 'warn');
      return 'no';
    }
    function pushBack() {
      const f = full();
      if (f === 'no') return;
      const v = next++;
      if (f === 'over') {
        const lost = buf[head];
        buf[head] = v; last = head; head = (head + 1) % cap;
        say(`Места нет: ${v} записан поверх самого старого (${lost}), head сдвинулся на ${head}. Так работают логи фиксированного размера.`, 'warn');
      } else {
        const t = tail();
        buf[t] = v; last = t; len++;
        if (f === 'ok') say(`push_back(${v}) в ячейку ${t}. ${t === cap - 1 ? 'Это последняя ячейка — следующий tail будет (' + t + ' + 1) % ' + cap + ' = 0.' : ''}`);
      }
      render();
    }
    function pushFront() {
      const f = full();
      if (f === 'no') return;
      const v = next++;
      const was = head;
      head = (head - 1 + cap) % cap;
      if (f === 'over') {
        const lost = buf[head];
        buf[head] = v; last = head;
        say(`Места нет: ${v} записан в начало поверх самого нового (${lost}).`, 'warn');
      } else {
        buf[head] = v; last = head; len++;
        if (f === 'ok') say(`push_front(${v}): head = (${was} − 1 + ${cap}) % ${cap} = ${head}.${was === 0 ? ' Перешли через начало массива на его конец.' : ''}`);
      }
      render();
    }
    function popFront() {
      if (!len) { say('Пусто: head == tail и len = 0.'); return; }
      const v = buf[head];
      buf[head] = null; last = -1;
      const was = head;
      head = (head + 1) % cap; len--;
      say(`pop_front() → ${v}. head = (${was} + 1) % ${cap} = ${head}${head === 0 ? ' — перешли через конец' : ''}. Ничего не сдвигалось: O(1).`, 'ok');
      render();
    }
    function popBack() {
      if (!len) { say('Пусто.'); return; }
      const t = (head + len - 1) % cap;
      const v = buf[t];
      buf[t] = null; len--; last = -1;
      say(`pop_back() → ${v} из ячейки ${t}. O(1).`, 'ok');
      render();
    }
    function render() {
      cells.innerHTML = '';
      cells.style.setProperty('--cols', Math.min(cap, 8));
      const t = tail();
      for (let i = 0; i < cap; i++) {
        const used = buf[i] != null;
        const marks = [];
        if (i === head) marks.push('<b class="rg-h">head</b>');
        if (i === t && len < cap) marks.push('<b class="rg-t">tail</b>');
        cells.append(h('div', { class: 'rg-cell' + (used ? ' on' : '') + (i === last ? ' new' : ''), html:
          `<small>${i}</small><span>${used ? buf[i] : ''}</span><em>${marks.join('')}</em>` }));
      }
      formula.innerHTML = `cap = ${cap}, head = ${head}, len = ${len}, tail = (head + len) % cap = <b>${t}</b>`;
    }
    reset();
    return {};
  });
})();

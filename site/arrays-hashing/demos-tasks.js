// Demos for slides 16–18: LRU cache, interview patterns, prefix sums.
(() => {
  'use strict';
  const { h, highlight, plural } = Deck;
  const { logger, segmented } = window.ArrDemo;

  // ---------------------------------------------------------------- LRU cache
  Deck.demo('lru', root => {
    const CAP = 4, KEYS = 'ABCDEFGH'.split('');
    const ADDR = Object.fromEntries(KEYS.map((k, i) => [k, '0x7f' + (0xa0 + i * 0x18).toString(16)]));
    let list, hits, misses, moved, evicted, timer = 0;
    const keysEl = h('div', { class: 'controls lru-keys' });
    KEYS.forEach(k => keysEl.append(h('button', { class: 'btn', onclick: () => { stopScan(); get(k); } }, h('code', null, `get(${k})`))));
    const mapEl = h('div', { class: 'lru-map' });
    const listEl = h('div', { class: 'lru-list' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      keysEl,
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: scan }, 'Скан A → H'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('div', { class: 'lru-body' },
        h('div', null, h('div', { class: 'label' }, 'dict: ключ → узел'), mapEl),
        h('div', null, h('div', { class: 'label' }, 'список: свежие → давние'), listEl)),
      stats, logEl);

    function reset() {
      stopScan();
      list = ['D', 'C', 'B', 'A']; hits = 0; misses = 0; moved = null; evicted = null;
      say('Кэш полон: A, B, C, D. Голова списка — самый свежий, хвост — кандидат на вытеснение.');
      render();
    }
    function get(k) {
      evicted = null;
      const i = list.indexOf(k);
      if (i >= 0) {
        hits++;
        const prev = list[i - 1], next = list[i + 1];
        list.splice(i, 1);
        list.unshift(k);
        moved = k;
        say(i === 0
          ? `get(${k}): попадание, ${k} уже в голове — ничего не двигаем.`
          : `get(${k}): попадание. dict дал узел ${ADDR[k]} за O(1); вынули его: ${prev}.next = ${next || 'None'}${next ? `, ${next}.prev = ${prev}` : ''} — и вставили в голову. Без поиска по списку.`, 'ok');
      } else {
        misses++;
        list.unshift(k);
        moved = k;
        let ev = '';
        if (list.length > CAP) {
          evicted = list.pop();
          ev = ` Кэш переполнен: из хвоста вытеснен ${evicted} — удалён из списка и из dict.`;
        }
        say(`get(${k}): промах — значение загружено (медленно) и вставлено в голову.${ev}`, 'warn');
      }
      render();
    }
    function scan() {
      stopScan();
      let i = 0;
      const step = () => {
        if (i >= KEYS.length) {
          stopScan();
          say(`Скан по 8 ключам при кэше на 4: каждое обращение — промах, и скан вымыл из кэша всё полезное. Поэтому Postgres читает большие таблицы через маленький кольцевой буфер, а в Linux есть две LRU-очереди: активная и неактивная.`, 'bad');
          return;
        }
        get(KEYS[i++]);
      };
      step();
      timer = setInterval(step, 450);
    }
    function stopScan() { clearInterval(timer); timer = 0; }
    function render() {
      mapEl.innerHTML = [...list].sort().map(k => `<div class="${k === moved ? 'hot' : ''}"><b>'${k}'</b><span>→ ${ADDR[k]}</span></div>`).join('') +
        (evicted ? `<div class="gone"><b>'${evicted}'</b><span>удалён</span></div>` : '');
      listEl.innerHTML = list.map((k, i) => `${i ? '<em>⇄</em>' : ''}<i class="${k === moved ? 'hot' : ''}${i === list.length - 1 && list.length === CAP ? ' tail' : ''}"><b>${k}</b><small>${ADDR[k]}</small></i>`).join('') +
        (evicted ? `<em>✕</em><i class="gone"><b>${evicted}</b></i>` : '');
      const total = hits + misses;
      stats.innerHTML = [
        ['попаданий', hits],
        ['промахов', misses],
        ['hit rate', total ? Math.round((hits / total) * 100) + '%' : '—'],
      ].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    }
    reset();
    return { stop: stopScan };
  });

  // ---------------------------------------------------------------- interview patterns
  Deck.demo('patterns', root => {
    const P = {
      two: {
        tab: 'Two Sum',
        task: 'Индексы двух чисел с суммой 10',
        code: 'seen = {}\nfor i, x in enumerate(nums):\n    if target - x in seen:\n        return [seen[target - x], i]\n    seen[x] = i',
        init() { return { nums: [3, 8, 11, 4, 6, 2], target: 10, i: 0, seen: new Map(), done: null }; },
        step(s) {
          const x = s.nums[s.i], need = s.target - x;
          if (s.seen.has(need)) {
            s.done = [s.seen.get(need), s.i];
            return { text: `i = ${s.i}, x = ${x}: нужно ${need} — оно в seen с индексом ${s.seen.get(need)}. Ответ [${s.done.join(', ')}]: один проход, O(n) вместо перебора пар O(n²).`, cls: 'ok' };
          }
          s.seen.set(x, s.i);
          s.i++;
          return { text: `i = ${s.i - 1}, x = ${x}: нужно ${need} — в seen нет. Запоминаем seen[${x}] = ${s.i - 1}.` };
        },
        over: s => s.done || s.i >= s.nums.length,
        view(s) {
          const arr = s.nums.map((v, i) => `<span class="${s.done && s.done.includes(i) ? 'hit' : i === s.i && !s.done ? 'cur' : i < s.i ? 'past' : ''}"><small>${i}</small>${v}</span>`).join('');
          const map = [...s.seen].map(([k, v]) => `<i>${k}: ${v}</i>`).join('') || '<span class="empty">пусто</span>';
          return `<div class="pt-arr">${arr}</div><div class="pt-map"><b>seen</b>${map}</div>`;
        },
      },
      ana: {
        tab: 'Анаграммы',
        task: 'Сгруппировать слова-анаграммы',
        code: 'groups = defaultdict(list)\nfor w in words:\n    key = "".join(sorted(w))\n    groups[key].append(w)\nreturn list(groups.values())',
        init() { return { words: ['eat', 'tea', 'tan', 'ate', 'nat', 'bat'], i: 0, groups: new Map() }; },
        step(s) {
          const w = s.words[s.i++], key = [...w].sort().join('');
          const was = s.groups.has(key);
          if (!was) s.groups.set(key, []);
          s.groups.get(key).push(w);
          return { text: `«${w}» → ключ «${key}»: ${was ? 'такая группа уже есть, добавляем.' : 'новая группа.'}${s.i === s.words.length ? ` Готово: ${s.groups.size} ${plural(s.groups.size, ['группа', 'группы', 'групп'])} за O(n·L log L). Ключ без сортировки — кортеж из 26 счётчиков, O(n·L).` : ''}`, cls: s.i === s.words.length ? 'ok' : '' };
        },
        over: s => s.i >= s.words.length,
        view(s) {
          const arr = s.words.map((w, i) => `<span class="w ${i === s.i ? 'cur' : i < s.i ? 'past' : ''}">${w}</span>`).join('');
          const map = [...s.groups].map(([k, v]) => `<i><b>${k}</b>: ${v.join(', ')}</i>`).join('') || '<span class="empty">пусто</span>';
          return `<div class="pt-arr">${arr}</div><div class="pt-map col"><b>groups</b>${map}</div>`;
        },
      },
      win: {
        tab: 'Окно',
        task: 'Самая длинная подстрока без повторов',
        code: 'last, l, best = {}, 0, 0\nfor r, c in enumerate(s):\n    if last.get(c, -1) >= l:\n        l = last[c] + 1\n    last[c] = r\n    best = max(best, r - l + 1)',
        init() { return { s: 'tmmzuxt', r: 0, l: 0, best: 0, bestL: 0, last: new Map() }; },
        step(st) {
          const c = st.s[st.r], prev = st.last.has(c) ? st.last.get(c) : -1;
          let note;
          if (prev >= st.l) { note = `«${c}» уже был в окне на позиции ${prev} → l = ${prev + 1}.`; st.l = prev + 1; }
          else if (prev >= 0) note = `«${c}» был на позиции ${prev}, но это левее окна (l = ${st.l}) — l не трогаем. Частая ошибка — сдвинуть l назад.`;
          else note = `«${c}» ещё не встречался.`;
          st.last.set(c, st.r);
          const len = st.r - st.l + 1;
          if (len > st.best) { st.best = len; st.bestL = st.l; }
          st.r++;
          const end = st.r >= st.s.length;
          return { text: `r = ${st.r - 1}: ${note} Окно «${st.s.slice(st.l, st.r)}», длина ${len}.${end ? ` Ответ ${st.best} — «${st.s.substr(st.bestL, st.best)}». Каждый символ входит в окно и выходит из него один раз: O(n).` : ''}`, cls: end ? 'ok' : prev >= 0 && prev < st.l ? 'warn' : '' };
        },
        over: st => st.r >= st.s.length,
        view(st) {
          const arr = [...st.s].map((c, i) => `<span class="${i >= st.l && i < st.r ? 'win' : ''}${i === st.r - 1 ? ' cur' : ''}"><small>${i}</small>${c}</span>`).join('');
          const map = [...st.last].map(([k, v]) => `<i>${k}: ${v}</i>`).join('') || '<span class="empty">пусто</span>';
          return `<div class="pt-arr">${arr}</div><div class="pt-map"><b>last</b>${map}<b class="pt-best">l = ${st.l}, best = ${st.best}</b></div>`;
        },
      },
    };
    let cur = 'two', state, timer = 0;
    const seg = segmented(Object.entries(P).map(([k, v]) => [k, v.tab]), id => { cur = id; reset(); });
    const task = h('p', { class: 'pt-task' });
    const code = h('pre', { class: 'code pt-code' });
    const view = h('div', { class: 'pt-view' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { stopRun(); step(); } }, 'Шаг');
    const runBtn = h('button', { class: 'btn', onclick: run }, 'До конца');
    root.append(seg.el, task, code, h('div', { class: 'controls' }, stepBtn, runBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')), view, logEl);

    function reset() {
      stopRun();
      seg.mark(cur);
      state = P[cur].init();
      task.innerHTML = P[cur].task;
      code.innerHTML = highlight(P[cur].code, 'py');
      say('Нажимайте «Шаг».');
      render();
    }
    function step() {
      if (P[cur].over(state)) return false;
      const r = P[cur].step(state);
      say(r.text, r.cls || '');
      render();
      return true;
    }
    function run() { stopRun(); timer = setInterval(() => { if (!step()) stopRun(); }, 500); step(); }
    function stopRun() { clearInterval(timer); timer = 0; }
    function render() {
      view.innerHTML = P[cur].view(state);
      const over = P[cur].over(state);
      stepBtn.disabled = over; runBtn.disabled = over;
    }
    reset();
    return { stop: stopRun };
  });

  // ---------------------------------------------------------------- prefix sums + hash map
  Deck.demo('prefix', root => {
    const PRESETS = [
      { nums: [3, 4, -7, 3, 1, 3, 1, -4, -2, -2], k: 7 },
      { nums: [1, 2, 1, -1, 2, -2, 3], k: 3 },
    ];
    let pi = 0, nums, k, j, s, count, seen, pos, found, last, timer = 0;
    const seg = segmented(PRESETS.map((p, i) => [i, `k = ${p.k}: [${p.nums.slice(0, 3).join(', ')}, …]`]), i => { pi = i; reset(); });
    const arrEl = h('div', { class: 'px-arr' });
    const mapEl = h('div', { class: 'pt-map' });
    const foundEl = h('div', { class: 'px-found' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { stopRun(); step(); } }, 'Шаг');
    const runBtn = h('button', { class: 'btn', onclick: run }, 'До конца');
    root.append(seg.el, h('div', { class: 'controls' }, stepBtn, runBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')), arrEl, mapEl, foundEl, stats, logEl);

    function reset() {
      stopRun();
      seg.mark(pi);
      ({ nums, k } = PRESETS[pi]);
      nums = nums.slice();
      j = 0; s = 0; count = 0; seen = new Map([[0, 1]]); pos = new Map([[0, [0]]]); found = []; last = [];
      say(`Ищем подмассивы с суммой ${k}. В seen сразу лежит {0: 1} — пустой префикс: без него не найдётся подмассив, начинающийся с нуля.`);
      render();
    }
    function step() {
      if (j >= nums.length) return false;
      const x = nums[j];
      s += x;
      const need = s - k;
      const c = seen.get(need) || 0;
      last = (pos.get(need) || []).map(i => [i, j]);
      found.push(...last);
      count += c;
      seen.set(s, (seen.get(s) || 0) + 1);
      if (!pos.has(s)) pos.set(s, []);
      pos.get(s).push(j + 1);
      say(c
        ? `j = ${j}: s = ${s}, ищем s − k = ${need} — встречался ${c} ${plural(c, ['раз', 'раза', 'раз'])}: ${last.map(([a, b]) => `nums[${a}..${b}]`).join(', ')}. count = ${count}.`
        : `j = ${j}: s = ${s}, ищем s − k = ${need} — не встречался. Запоминаем seen[${s}] += 1.`, c ? 'ok' : '');
      j++;
      render();
      return true;
    }
    function run() { stopRun(); timer = setInterval(() => { if (!step()) stopRun(); }, 450); step(); }
    function stopRun() { clearInterval(timer); timer = 0; }
    function render() {
      let p = 0;
      const lastSet = new Set();
      last.forEach(([a, b]) => { for (let i = a; i <= b; i++) lastSet.add(i); });
      arrEl.style.gridTemplateColumns = `repeat(${nums.length}, minmax(0, 1fr))`;
      arrEl.innerHTML = nums.map((v, i) => {
        p += v;
        return `<span class="${i === j - 1 ? 'cur' : ''}${lastSet.has(i) ? ' in' : ''}${i < j ? ' past' : ''}"><small>${i}</small><b>${v}</b><em>${i < j ? p : ''}</em></span>`;
      }).join('');
      mapEl.innerHTML = `<b>seen</b>` + [...seen].map(([key, v]) => `<i class="${j && key === s - k ? 'hit' : ''}">${key}: ${v}</i>`).join('');
      foundEl.innerHTML = found.length ? found.map(([a, b]) => `<i>[${nums.slice(a, b + 1).join(', ')}]</i>`).join('') : '<span class="empty">подмассивов пока нет</span>';
      const n = nums.length;
      stats.innerHTML = [
        ['count', count],
        ['шагов здесь', j],
        ['пар (i, j) перебором', n * (n + 1) / 2],
      ].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
      const over = j >= nums.length;
      stepBtn.disabled = over; runBtn.disabled = over;
    }
    reset();
    return { stop: stopRun };
  });
})();

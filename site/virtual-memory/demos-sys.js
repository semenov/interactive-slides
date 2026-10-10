// Demos for slides 9–17: lazy allocation, overcommit/OOM, RSS/PSS/USS, copy-on-write, swap, page cache.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const { fmt, dec, logger } = VM;
  const mb = n => n >= 1024 ? dec(n / 1024, 1) + ' ГБ' : Math.round(n) + ' МБ';

  // ---------------------------------------------------------------- lazy allocation
  Deck.demo('lazy', root => {
    const CELLS = 64, CELL = 16; // 64 × 16 MB = 1 GB
    const BASE_VSZ = 12, BASE_RSS = 4;
    let cells, allocated, faults, thp;
    const bars = h('div', { class: 'lz-bars' });
    const grid = h('div', { class: 'lz-grid', 'aria-label': 'Области по 16 МБ' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const allocBtn = h('button', { class: 'btn primary', onclick: alloc }, h('code', null, 'p = malloc(1 ГБ)'));
    const writeBtn = h('button', { class: 'btn', onclick: () => touch(true) }, 'Записать 256 МБ');
    const readBtn = h('button', { class: 'btn', onclick: () => touch(false) }, 'Прочитать 256 МБ');
    const freeBtn = h('button', { class: 'btn', onclick: release }, h('code', null, 'free(p)'));
    const thpIn = h('input', { type: 'checkbox' });
    thpIn.addEventListener('change', () => { thp = thpIn.checked; say(thp ? 'THP включены: первое касание выровненных 2 МБ выделяет сразу большую страницу — fault\'ов в 512 раз меньше.' : 'Обычные страницы по 4 КБ: один fault на каждую.'); });
    root.append(
      h('div', { class: 'controls' }, allocBtn, writeBtn, readBtn, freeBtn),
      h('label', { class: 'toggle' }, thpIn, h('span', null, 'transparent huge pages')),
      bars, grid,
      h('div', { class: 'bl-legend' }, h('span', { class: 'sw lz-0' }), 'зарезервировано', h('span', { class: 'sw lz-1' }), 'нулевая страница', h('span', { class: 'sw lz-2' }), 'в RAM'),
      stats, logEl);

    function reset() {
      cells = Array(CELLS).fill(0); allocated = false; faults = 0; thp = thpIn.checked;
      say('Процесс только запустился: VSZ 12 МБ, RSS 4 МБ.');
      render();
    }
    function alloc() {
      allocated = true;
      cells.fill(0);
      say('glibc отдаёт блоки больше 128 КБ через <code>mmap</code>. Ядро создало VMA на 1 ГБ — VSZ вырос сразу, RSS не изменился, ни одного fault.', 'ok');
      render();
    }
    function touch(write) {
      if (!allocated) { say('Сначала выделите память. Обращение к невыделенному адресу — <code>SIGSEGV</code>.', 'warn'); return; }
      const target = write ? 1 : 0;
      const idx = [];
      for (let i = 0; i < CELLS && idx.length < 16; i++) if (cells[i] <= target && (write ? cells[i] < 2 : cells[i] === 0)) idx.push(i);
      if (!idx.length) { say(write ? 'Весь гигабайт уже в RAM. Повторная запись идёт без fault\'ов.' : 'Непрочитанных страниц нет. Повторное чтение идёт без fault\'ов.'); return; }
      const pages = idx.length * CELL * 256;
      const f = thp ? pages / 512 : pages;
      faults += f;
      idx.forEach(i => { cells[i] = write ? 2 : 1; });
      if (write) say(`Запись в ${mb(idx.length * CELL)}: ${fmt(f)} minor ${plural(f, ['fault', 'fault\'а', 'fault\'ов'])}, на каждый ядро выдало обнулённый ${thp ? '2 МБ фрейм' : 'фрейм 4 КБ'}. RSS вырос.`, 'ok');
      else say(`Чтение ${mb(idx.length * CELL)} нетронутой памяти: ${fmt(f)} ${plural(f, ['fault', 'fault\'а', 'fault\'ов'])}, но ядро подключило одну общую нулевую страницу только для чтения. RSS почти не изменился. Запись в эти страницы ещё раз вызовет fault.`);
      render();
    }
    function release() {
      if (!allocated) { say('Освобождать нечего.'); return; }
      allocated = false;
      cells.fill(0);
      say('<code>free</code> большого блока — это <code>munmap</code>: VMA и фреймы возвращены ядру, VSZ и RSS упали. Мелкие блоки glibc держит у себя, и RSS после <code>free</code> часто не уменьшается.', 'ok');
      render();
    }
    function render() {
      const res = cells.filter(c => c === 2).length * CELL;
      const vsz = BASE_VSZ + (allocated ? 1024 : 0), rss = BASE_RSS + res;
      const scale = 1100;
      bars.innerHTML = [['VSZ', vsz, 'lz-v'], ['RSS', rss, 'lz-r']].map(([n, v, c]) =>
        `<div class="lz-row"><span class="label">${n}</span><span class="cost-track"><span class="cost-fill ${c}" style="width:${(v / scale) * 100}%"></span></span><b>${mb(v)}</b></div>`).join('');
      grid.innerHTML = cells.map(c => `<i class="lz-${allocated ? c : 'x'}"></i>`).join('');
      stats.innerHTML = `<div class="stat"><b>${mb(vsz)}</b><span>VSZ</span></div><div class="stat"><b>${mb(rss)}</b><span>RSS</span></div><div class="stat"><b>${fmt(faults)}</b><span>minor faults</span></div>`;
      writeBtn.disabled = readBtn.disabled = freeBtn.disabled = !allocated;
      allocBtn.disabled = allocated;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- overcommit and OOM killer
  Deck.demo('oom', root => {
    const RAM = 8192, KERNEL = 400;
    let procs, cache, free, mode, protect, dead;
    const modeBtns = [0, 1, 2].map(m => h('button', { class: 'btn small', onclick: () => { mode = m; say(MODE_TEXT[m]); render(); } }, String(m)));
    const MODE_TEXT = [
      'Режим 0 (по умолчанию): эвристика отказывает только в заведомо невозможном — больше, чем RAM + swap.',
      'Режим 1: обещать всё. Так советуют для Redis, чтобы fork большого процесса не отказывал.',
      'Режим 2: строгий учёт. Сумма обещаний не больше CommitLimit = swap + RAM × overcommit_ratio (здесь 100%). malloc честно возвращает NULL.',
    ];
    const protIn = h('input', { type: 'checkbox' });
    protIn.addEventListener('change', () => { protect = protIn.checked; render(); });
    const bar = h('div', { class: 'oo-bar' });
    const table = h('div', { class: 'oo-table' });
    const commitEl = h('div', { class: 'label oo-commit' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'overcommit_memory'), modeBtns),
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: () => malloc(4096) }, h('code', null, 'malloc(4 ГБ)')),
        h('button', { class: 'btn small', onclick: () => malloc(16384) }, h('code', null, 'malloc(16 ГБ)')),
        h('button', { class: 'btn small primary', onclick: touch }, 'записать 1 ГБ'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, protIn, h('span', null, h('code', null, 'java: oom_score_adj = −1000'))),
      bar, commitEl, table, logEl);

    function reset() {
      procs = [
        { name: 'nginx', pid: 812, rss: 100, commit: 200, c: 'c1' },
        { name: 'postgres', pid: 1290, rss: 1600, commit: 2000, c: 'c2' },
        { name: 'java', pid: 3170, rss: 3500, commit: 4096, c: 'c3' },
        { name: 'worker', pid: 4242, rss: 200, commit: 300, c: 'c4' },
      ];
      free = 300;
      cache = RAM - KERNEL - free - procs.reduce((s, p) => s + p.rss, 0);
      dead = [];
      if (mode == null) mode = 0;
      protect = protIn.checked;
      say('Память занята почти вся — большей частью кэшем. Это нормально: кэш отдаётся по первому требованию.');
      render();
    }
    const alive = () => procs.filter(p => !dead.includes(p));
    const worker = () => procs[3];
    const committed = () => alive().reduce((s, p) => s + p.commit, 0);
    const adj = p => (p.name === 'java' && protect ? -1000 : 0);
    const score = p => (adj(p) <= -1000 ? 0 : Math.max(0, Math.round((p.rss / RAM) * 1000) + adj(p)));

    function malloc(n) {
      const w = worker();
      if (dead.includes(w)) { say('Воркер убит. Нажмите «Сброс».', 'warn'); return; }
      if (mode === 0 && n > RAM) { say(`Эвристика: ${mb(n)} больше, чем RAM + swap. <code>malloc</code> вернул NULL (в Python — <code>MemoryError</code>).`, 'warn'); return; }
      if (mode === 2 && committed() + n > RAM) { say(`Committed_AS ${mb(committed())} + ${mb(n)} > CommitLimit ${mb(RAM)}. <code>malloc</code> вернул NULL — ошибку видно в коде, а не в dmesg.`, 'warn'); return; }
      w.commit += n;
      say(`<code>malloc(${mb(n)})</code> успешен. Обещано ${mb(committed())} при ${mb(RAM)} RAM — но пока ни одного фрейма не потрачено.`, 'ok');
      render();
    }
    function touch() {
      const w = worker();
      if (dead.includes(w)) { say('Воркер убит. Нажмите «Сброс».', 'warn'); return; }
      if (w.commit - w.rss < 1024) { say('Выделенная память кончилась — сначала <code>malloc</code>. Писать за её пределы — <code>SIGSEGV</code>.', 'warn'); return; }
      let need = 1024;
      const fromFree = Math.min(free, need); free -= fromFree; need -= fromFree;
      const fromCache = Math.min(cache, need); cache -= fromCache; need -= fromCache;
      const killed = [];
      while (need > 0) {
        // The kernel scores by resident memory; the worker already holds the pages it touched so far.
        const rssNow = p => p.rss + (p === w ? 1024 - need : 0);
        const sc = p => Math.round((rssNow(p) / RAM) * 1000) + adj(p);
        const cand = alive().filter(p => adj(p) > -1000).sort((a, b) => sc(b) - sc(a))[0];
        dead.push(cand);
        killed.push(`<code>Out of memory: Killed process ${cand.pid} (${cand.name}) anon-rss:${rssNow(cand) * 1024}kB, oom_score_adj:${adj(cand)}</code>`);
        if (cand === w) {
          free += rssNow(w);
          w.rss = 0; w.commit = 0;
          say(killed.join('<br>') + '<br>Убит сам воркер: теперь он самый большой.', 'bad');
          render();
          return;
        }
        free += cand.rss;
        cand.rss = 0; cand.commit = 0;
        const take = Math.min(free, need); free -= take; need -= take;
      }
      w.rss += 1024;
      if (killed.length) say(killed.join('<br>') + `<br>Кэш кончился, и OOM killer выбрал процесс с наибольшим oom_score — ${dead[dead.length - 1].name}, хотя память ест воркер.`, 'bad');
      else say(`Воркер записал 1 ГБ: ${fmt(262144)} minor faults` + (fromCache ? `, ядро вытеснило ${mb(fromCache)} кэша` : '') + '.' + (cache < 400 ? ' Кэша почти не осталось.' : ''), cache < 400 ? 'warn' : 'ok');
      render();
    }
    function render() {
      modeBtns.forEach((b, i) => b.classList.toggle('sel', i === mode));
      const segs = [['oo-k', KERNEL, 'ядро'], ...alive().map(p => [p.c, p.rss, p.name]), ['oo-cache', cache, 'кэш'], ['oo-free', free, 'free']];
      bar.innerHTML = segs.filter(s => s[1] > 0).map(([c, v, n]) => `<span class="${c}" style="width:${(v / RAM) * 100}%" title="${n}">${v / RAM > 0.09 ? n : ''}</span>`).join('');
      commitEl.innerHTML = `Committed_AS ${mb(committed())}` + (mode === 2 ? ` из CommitLimit ${mb(RAM)}` : ` (лимита нет)`) + ` · кэш ${mb(cache)} · free ${mb(free)}`;
      table.innerHTML = '<div class="oo-row oo-h"><span>процесс</span><span>RSS</span><span>обещано</span><span>oom_score</span></div>' +
        procs.map(p => {
          const d = dead.includes(p);
          return `<div class="oo-row${d ? ' dead' : ''}"><span><i class="sw ${p.c}"></i>${p.name}</span><span>${d ? 'убит' : mb(p.rss)}</span><span>${d ? '—' : mb(p.commit)}</span><span>${d ? '—' : score(p)}</span></div>`;
        }).join('');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- RSS / PSS / USS
  Deck.demo('rsspss', root => {
    const MAPS = [['libc.so', 2, 'lib'], ['libpython.so', 4, 'lib'], ['код и данные приложения (от мастера)', 80, 'app']];
    const HEAP = { master: 10, worker: 30 };
    let broken = false;
    const out = h('output');
    const input = h('input', { type: 'range', min: 1, max: 16, value: 4, 'aria-label': 'Воркеров' });
    input.addEventListener('input', update);
    const brIn = h('input', { type: 'checkbox' });
    brIn.addEventListener('change', () => { broken = brIn.checked; update(); });
    const table = h('div', { class: 'rp-table' });
    const bars = h('div', { class: 'lz-bars' });
    const logEl = h('p', { class: 'log' });
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'воркеров gunicorn'), input, out),
      h('label', { class: 'toggle' }, brIn, h('span', null, 'copy-on-write сломан (воркеры трогают объекты)')),
      table, bars, logEl);

    function update() {
      const w = +input.value, n = w + 1;
      out.textContent = w;
      // Each mapping: size and how many processes share its physical pages.
      const maps = role => MAPS.map(([name, sz, kind]) => ({ name, sz, sharers: kind === 'app' && broken ? 1 : n }))
        .concat([{ name: 'куча', sz: HEAP[role], sharers: 1 }]);
      const calc = role => maps(role).reduce((a, m) => ({
        rss: a.rss + m.sz, pss: a.pss + m.sz / m.sharers, uss: a.uss + (m.sharers === 1 ? m.sz : 0),
      }), { rss: 0, pss: 0, uss: 0 });
      const M = calc('master'), W = calc('worker');
      const tot = { rss: M.rss + W.rss * w, pss: M.pss + W.pss * w, uss: M.uss + W.uss * w };
      const row = (name, r, cls = '') => `<div class="rp-row ${cls}"><span>${name}</span><span>${mb(r.rss)}</span><span>${dec(r.pss, 1)} МБ</span><span>${mb(r.uss)}</span></div>`;
      table.innerHTML = '<div class="rp-row rp-h"><span></span><span>RSS</span><span>PSS</span><span>USS</span></div>' +
        row('мастер', M) + row(`воркер ×${w}`, W) + row('сумма', tot, 'rp-sum');
      const scale = Math.max(tot.rss, 1);
      bars.innerHTML = [['Σ RSS — «как в top»', tot.rss, 'lz-v'], ['Σ PSS — занято на деле', tot.pss, 'lz-r']].map(([l, v, c]) =>
        `<div class="lz-row wide"><span class="label">${l}</span><span class="cost-track"><span class="cost-fill ${c}" style="width:${(v / scale) * 100}%"></span></span><b>${mb(v)}</b></div>`).join('');
      if (broken) {
        logEl.innerHTML = `Каждый воркер скопировал себе 80 МБ данных мастера: USS воркера вырос до ${mb(W.uss)}. Теперь RSS почти не врёт — память и правда занята ${n} раз.`;
        logEl.className = 'log bad';
      } else {
        logEl.innerHTML = `Сложив RSS, получим ${mb(tot.rss)}, а на деле занято ${mb(tot.pss)}: ${mb(86)} общих страниц посчитаны ${n} ${plural(n, ['раз', 'раза', 'раз'])}. Каждый новый воркер стоит ${mb(W.uss)} — его USS.`;
        logEl.className = 'log ok';
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- fork and copy-on-write
  Deck.demo('cow', root => {
    const N = 6;
    let frames, parent, child, copies, faults, nextId;
    const view = h('div', { class: 'cw' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const forkBtn = h('button', { class: 'btn primary', onclick: fork }, h('code', null, 'fork()'));
    const gcBtn = h('button', { class: 'btn', onclick: gcAll }, 'ребёнок: gc обходит все объекты');
    const execBtn = h('button', { class: 'btn', onclick: exec }, h('code', null, 'ребёнок: exec()'));
    root.append(h('div', { class: 'controls' }, forkBtn, gcBtn, execBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')), view, stats, logEl);

    function reset() {
      frames = new Map();
      nextId = 10;
      parent = Array.from({ length: N }, () => { const id = nextId++; frames.set(id, 1); return { f: id, w: true }; });
      child = null; copies = 0; faults = 0;
      say('Процесс с шестью страницами данных. Все записи разрешены (W = 1), у каждого фрейма одна ссылка.');
      render();
    }
    function fork() {
      if (child) return;
      child = parent.map(p => ({ f: p.f, w: false }));
      parent.forEach(p => { p.w = false; frames.set(p.f, 2); });
      say('<code>fork()</code>: скопирована только таблица страниц. Обе таблицы указывают на те же фреймы, у всех страниц снят бит W. Памяти не добавилось.', 'ok');
      render();
    }
    function write(who, i, quiet) {
      const pt = who === 'p' ? parent : child;
      const pg = pt[i];
      const name = who === 'p' ? 'Родитель' : 'Ребёнок';
      if (pg.w) { if (!quiet) say(`${name} пишет в страницу ${i}: она уже своя и с правом записи — обычная запись, без fault.`); return; }
      faults++;
      if (frames.get(pg.f) > 1) {
        frames.set(pg.f, frames.get(pg.f) - 1);
        const id = nextId++;
        frames.set(id, 1);
        pg.f = id; pg.w = true; copies++;
        if (!quiet) say(`${name} пишет в страницу ${i}: W = 0 → page fault. Фрейм общий — ядро копирует 4 КБ в новый фрейм F${id}, и у ${who === 'p' ? 'родителя' : 'ребёнка'} теперь своя копия.`, 'warn');
      } else {
        pg.w = true;
        if (!quiet) say(`${name} пишет в страницу ${i}: page fault, но у фрейма осталась одна ссылка — ядро просто возвращает бит W, ничего не копируя.`, 'ok');
      }
      render();
    }
    function gcAll() {
      if (!child) { say('Сначала <code>fork()</code>.', 'warn'); return; }
      const before = copies;
      for (let i = 0; i < N; i++) write('c', i, true);
      say(`Ребёнок «только читал» объекты, но сборщик мусора и счётчики ссылок записали в каждую страницу: скопировано ${copies - before} ${plural(copies - before, ['страница', 'страницы', 'страниц'])}. Общих страниц больше нет.`, 'bad');
      render();
    }
    function exec() {
      if (!child) { say('Сначала <code>fork()</code>.', 'warn'); return; }
      child.forEach(c => frames.set(c.f, frames.get(c.f) - 1));
      for (const [id, r] of frames) if (r <= 0) frames.delete(id);
      child = null;
      say('<code>exec()</code> заменил программу ребёнка: его таблица выброшена, ссылки на общие фреймы освободились. Так работает <code>subprocess</code>: fork + exec почти ничего не копирует. Родителю при записи копировать уже нечего.', 'ok');
      render();
    }
    function render() {
      const row = (label, pt, who) => h('div', { class: 'cw-row' }, h('span', { class: 'label' }, label),
        h('div', { class: 'cw-pages' }, pt.map((pg, i) => h('button', {
          class: 'cw-pg' + (frames.get(pg.f) > 1 ? ' shared' : ' own') + (pg.w ? '' : ' ro'),
          'aria-label': `${label}: записать в страницу ${i}`,
          onclick: () => write(who, i),
        }, h('small', null, String(i)), h('b', null, 'F' + pg.f), h('span', null, pg.w ? 'rw' : 'r–')))));
      view.innerHTML = '';
      view.append(row('родитель', parent, 'p'));
      if (child) view.append(row('ребёнок', child, 'c'));
      else view.append(h('div', { class: 'cw-row' }, h('span', { class: 'label' }, 'ребёнок'), h('div', { class: 'empty' }, 'ещё не создан')));
      stats.innerHTML = `<div class="stat"><b>${frames.size}</b><span>фреймов занято</span></div><div class="stat"><b>${faults}</b><span>page faults</span></div><div class="stat ${copies ? 'warn' : ''}"><b>${copies}</b><span>скопировано страниц</span></div>`;
      forkBtn.disabled = !!child;
      gcBtn.disabled = execBtn.disabled = !child;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- swap and thrashing
  Deck.demo('thrash', root => {
    const RAM = 16, MEM_NS = 100;
    const WS = [4, 8, 12, 14, 15, 16, 16.5, 17, 18, 20, 24, 32, 48];
    const DEV = [['NVMe SSD', 100e3], ['HDD', 10e6], ['zram', 5e3], ['swap нет', 0]];
    let dev = 0;
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: WS.length - 1, value: 7, 'aria-label': 'Рабочий набор' });
    input.addEventListener('input', update);
    const devBtns = DEV.map(([n], i) => h('button', { class: 'btn small', onclick: () => { dev = i; update(); } }, n));
    const chart = h('div', { class: 'th-chart' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'swap на'), devBtns),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'рабочий набор'), input, out),
      chart, stats, logEl);

    const pFault = ws => Math.max(0, 1 - RAM / ws);
    const slow = (ws, lat) => (MEM_NS + pFault(ws) * lat) / MEM_NS;
    function drawChart(cur, lat) {
      const W = 320, H = 130, X0 = 34, Y1 = 8, Y0 = H - 22, XMAX = 48;
      const x = ws => X0 + (ws / XMAX) * (W - X0 - 8);
      const y = s => Y0 - (Math.log10(s) / 5) * (Y0 - Y1);
      let d = '';
      for (let ws = 1; ws <= XMAX; ws += 0.25) d += (d ? 'L' : 'M') + x(ws).toFixed(1) + ' ' + y(Math.min(1e5, slow(ws, lat))).toFixed(1);
      const grid = [1, 10, 100, 1e3, 1e4, 1e5].map(s => `<line x1="${X0}" x2="${W - 8}" y1="${y(s)}" y2="${y(s)}" class="g"/><text x="${X0 - 4}" y="${y(s) + 3}" class="ax" text-anchor="end">×${s >= 1000 ? s / 1000 + 'к' : s}</text>`).join('');
      const xt = [0, 16, 32, 48].map(v => `<text x="${x(v)}" y="${H - 6}" class="ax" text-anchor="${v === XMAX ? 'end' : 'middle'}">${v} ГБ</text>`).join('');
      const s = Math.min(1e5, slow(cur, lat));
      chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Замедление в зависимости от рабочего набора">${grid}${xt}` +
        `<line x1="${x(RAM)}" x2="${x(RAM)}" y1="${Y1}" y2="${Y0}" class="ram"/><text x="${x(RAM) + 4}" y="${Y1 + 10}" class="ax ram-t">RAM</text>` +
        `<path d="${d}" class="ln"/><circle cx="${x(cur)}" cy="${y(s)}" r="5" class="pt"/></svg>`;
    }
    function update() {
      const ws = WS[+input.value];
      out.textContent = String(ws).replace('.', ',') + ' ГБ';
      devBtns.forEach((b, i) => b.classList.toggle('sel', i === dev));
      const [name, lat] = DEV[dev];
      const p = pFault(ws);
      if (!lat) {
        chart.innerHTML = '';
        stats.innerHTML = `<div class="stat"><b>${dec(Math.min(ws, RAM), 1)} ГБ</b><span>в RAM</span></div><div class="stat ${p ? 'warn' : ''}"><b>${p ? dec((ws - RAM), 1) + ' ГБ' : '0'}</b><span>не помещается</span></div><div class="stat"><b>×1</b><span>замедление</span></div>`;
        logEl.innerHTML = p ? 'Без swap анонимную память выгрузить некуда. Ядро выбросит весь page cache, включая код программ (он перечитывается с диска — тоже трэшинг), а потом придёт OOM killer.' : 'Набор помещается в RAM — swap не нужен.';
        logEl.className = 'log ' + (p ? 'bad' : 'ok');
        return;
      }
      drawChart(ws, lat);
      const eat = MEM_NS + p * lat, s = eat / MEM_NS;
      const t = eat >= 1e6 ? dec(eat / 1e6, 1) + ' мс' : eat >= 1e3 ? dec(eat / 1e3, 1) + ' мкс' : Math.round(eat) + ' нс';
      stats.innerHTML = `<div class="stat ${p ? 'warn' : ''}"><b>${p ? dec(p * 100, p < 0.1 ? 1 : 0) + '%' : '0'}</b><span>обращений — major fault</span></div>` +
        `<div class="stat"><b>${t}</b><span>среднее обращение</span></div>` +
        `<div class="stat ${s > 2 ? 'warn' : ''}"><b>×${s >= 100 ? fmt(Math.round(s)) : dec(s, 1)}</b><span>замедление</span></div>`;
      if (!p) logEl.innerHTML = 'Всё помещается: каждое обращение — около 100 нс. Swap может хранить давно забытые страницы, это никому не мешает.', logEl.className = 'log ok';
      else logEl.innerHTML = `Лишние ${dec(ws - RAM, 1)} ГБ — и ${dec(p * 100, 1)}% обращений идут в ${name} за ${lat >= 1e6 ? lat / 1e6 + ' мс' : lat / 1e3 + ' мкс'}. Среднее обращение дороже в ${s >= 100 ? fmt(Math.round(s)) : dec(s, 1)} ${s >= 100 ? plural(Math.round(s), ['раз', 'раза', 'раз']) : 'раза'}. Реальные программы обращаются неравномерно, поэтому обрыв мягче, но он есть.`, logEl.className = 'log bad';
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- page cache and `free`
  Deck.demo('free', root => {
    const TOTAL = 15880, BASE_USED = 2100, SHARED = 120, FLOOR = 160;
    let used, clean, dirty, freeMem;
    const tbl = h('div', { class: 'fr-out', 'aria-live': 'polite' });
    const bar = h('div', { class: 'oo-bar fr-bar' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: () => readFile(4096) }, h('code', null, 'cat big.log (4 ГБ)')),
        h('button', { class: 'btn small', onclick: () => writeFile(2048) }, 'записать файл 2 ГБ'),
        h('button', { class: 'btn small', onclick: sync }, h('code', null, 'sync')),
        h('button', { class: 'btn small', onclick: () => appAlloc(6144) }, 'приложению +6 ГБ'),
        h('button', { class: 'btn small', onclick: drop }, h('code', null, 'drop_caches')),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      tbl, bar,
      h('div', { class: 'bl-legend' }, h('span', { class: 'sw fr-u' }), 'used', h('span', { class: 'sw fr-c' }), 'кэш', h('span', { class: 'sw fr-d' }), 'грязный кэш', h('span', { class: 'sw fr-f' }), 'free'),
      logEl);

    function reset() {
      used = BASE_USED; clean = 3100; dirty = 0;
      freeMem = TOTAL - used - clean;
      say('Сервер после загрузки: свободно много, кэш небольшой.');
      render();
    }
    // Make room for n MB: free first, then clean cache; dirty pages must be written back first.
    function room(n) {
      const r = { evicted: 0, flushed: 0 };
      // The kernel keeps a small reserve free (watermarks), so `free` never reaches zero.
      let need = n - (freeMem - FLOOR);
      if (need <= 0) { freeMem -= n; return r; }
      freeMem = FLOOR;
      const c = Math.min(clean, need); clean -= c; need -= c; r.evicted = c;
      if (need > 0) { const d = Math.min(dirty, need); dirty -= d; need -= d; r.flushed = d; }
      r.short = need;
      return r;
    }
    function readFile(n) {
      const r = room(n);
      clean += n - (r.short || 0);
      say(r.evicted ? `Файл прочитан в кэш. Места не было — ядро вытеснило ${mb(r.evicted)} самого старого кэша. <b>free</b> около нуля, <b>available</b> не изменился.` :
        `Файл прочитан и остался в page cache: следующее чтение пойдёт из памяти. <b>free</b> упал на 4 ГБ, <b>available</b> почти нет.`);
      render();
    }
    function writeFile(n) {
      const r = room(n);
      dirty += n - (r.short || 0);
      say(`<code>write()</code> вернулся сразу: данные лежат в кэше грязными. Ядро запишет их в фоне (через ~30 с) или по <code>fsync</code>. Пока не записаны, вытеснить их нельзя — <b>available</b> уменьшился.`, 'warn');
      render();
    }
    function sync() {
      if (!dirty) { say('Грязных страниц нет.'); return; }
      clean += dirty; dirty = 0;
      say('<code>sync</code> записал грязные страницы на диск. Они остались в кэше, но теперь чистые — их можно вытеснить в любой момент.', 'ok');
      render();
    }
    function appAlloc(n) {
      const r = room(n);
      if (r.short > 0) {
        used += n - r.short;
        say(`Не хватило ${mb(r.short)} даже после вытеснения всего кэша — пришёл бы OOM killer. Нажмите «Сброс».`, 'bad');
      } else {
        used += n;
        say(r.evicted || r.flushed ? `Приложение заняло 6 ГБ. Ядро освободило место: вытеснило ${mb(r.evicted)} чистого кэша` + (r.flushed ? ` и сначала дописало на диск ${mb(r.flushed)} грязного — на это время выделение памяти тормозило` : '') + '.' : 'Приложение заняло 6 ГБ из свободной памяти.', r.flushed ? 'warn' : 'ok');
      }
      render();
    }
    function drop() {
      freeMem += clean; clean = 0;
      say('<code>echo 3 > /proc/sys/vm/drop_caches</code>: чистый кэш выброшен, <b>free</b> вырос. Пользы никакой: следующие чтения пойдут с диска. Это инструмент для бенчмарков, а не для «освобождения памяти».', 'warn');
      render();
    }
    function render() {
      const cache = clean + dirty;
      const avail = freeMem + clean;
      const cols = [['total', TOTAL], ['used', used], ['free', freeMem], ['shared', SHARED], ['buff/cache', cache], ['available', avail]];
      const cl = n => (n === 'available' ? ' av' : n === 'free' ? ' fr' : '');
      tbl.innerHTML = '<div class="fr-cmd">$ free -m</div><div class="fr-grid">' +
        cols.map(([n, v]) => `<div class="fr-col"><span class="fr-k${cl(n)}">${n}</span><span class="fr-v${cl(n)}">${Math.round(v)}</span></div>`).join('') + '</div>';
      bar.innerHTML = [['fr-u', used], ['fr-c', clean], ['fr-d', dirty], ['fr-f', freeMem]].filter(s => s[1] > 0)
        .map(([c, v]) => `<span class="${c}" style="width:${(v / TOTAL) * 100}%"></span>`).join('');
    }
    reset();
    return {};
  });
})();

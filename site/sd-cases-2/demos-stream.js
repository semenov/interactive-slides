// Cases 3–4 — crawler frontier, simhash; hot counters, Count-Min Sketch + heap, sliding windows.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const rate = n => n >= 1e6 ? dec(n / 1e6, n >= 1e7 ? 0 : 1) + ' млн' : n >= 1e3 ? dec(n / 1e3, n >= 1e4 ? 0 : 1) + ' тыс.' : Math.round(n) + '';
  const stat = (b, s, cls = '') => `<div class="stat ${cls}"><b>${b}</b><span>${s}</span></div>`;
  const fmix = x => { x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };
  const fnv = (s, seed = 0x811c9dc5) => { let x = seed; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); } return x >>> 0; };
  const seeded = seed => () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) / 16777216;
  function slider(root, label, list, idx, f, onChange) {
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
    const set = () => { out.textContent = f(list[+input.value]); };
    set();
    input.addEventListener('input', () => { set(); onChange(); });
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, label), input, out));
    return () => list[+input.value];
  }

  // ---------------------------------------------------------------- crawler frontier with per-host politeness
  Deck.demo('frontier', root => {
    const HOSTS = ['wiki.example', 'news.example', 'shop.example', 'blog.example', 'docs.example', 'forum.example', 'maps.example', 'video.example', 'music.example', 'jobs.example'];
    const rnd = seeded(5);
    let t, hosts, workers, done, history, idleNote;
    const wrap = h('div');
    const delay = slider(wrap, 'Пауза на хост', [0.25, 0.5, 1, 2, 5], 2, v => dec(v, v < 1 ? 2 : 0) + ' с', () => {});
    const nWorkers = slider(wrap, 'Воркеров', [1, 2, 4, 8], 2, v => v, () => resizeWorkers());
    const wEl = h('div', { class: 'fr-workers' });
    const hEl = h('div', { class: 'fr-hosts' });
    const stats = h('div', { class: 'stats' });
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: () => add([HOSTS[0]], 30) }, '+30 URL с wiki.example'),
        h('button', { class: 'btn small', onclick: () => add(HOSTS, 3) }, '+30 URL с 10 сайтов'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      wrap, wEl, hEl, stats, log);

    function reset() {
      t = 0; done = 0; history = [];
      hosts = HOSTS.map(name => ({ name, q: 0, nextAt: 0, busy: false, last: -99 }));
      workers = [];
      resizeWorkers();
      idleNote = '';
      log.innerHTML = 'Очереди пусты. Добавьте URL.';
      log.className = 'log';
      render();
    }
    function resizeWorkers() {
      const n = nWorkers();
      while (workers.length < n) workers.push(null);
      while (workers.length > n) { const w = workers.pop(); if (w) { w.host.busy = false; w.host.q++; } }
    }
    function add(list, per) {
      list.forEach(name => { hosts.find(x => x.name === name).q += per; });
      log.innerHTML = list.length === 1
        ? `30 URL в очередь ${list[0]}. Как бы много ни было воркеров, этот хост обслуживается одним соединением с паузой ${dec(delay(), 2).replace(/,?0+$/, '')} с.`
        : 'По 3 URL в очереди десяти хостов: паузы разных хостов перекрываются, воркеры заняты.';
      log.className = 'log';
    }
    function tick(dt) {
      t += dt;
      workers.forEach((w, i) => {
        if (w && t >= w.until) {
          w.host.busy = false;
          w.host.nextAt = t + delay();
          w.host.last = t;
          done++; history.push(t);
          workers[i] = null;
        }
      });
      // Idle worker takes the ready host with the earliest "allowed after" time (a heap in a real crawler).
      workers.forEach((w, i) => {
        if (w) return;
        let best = null;
        for (const x of hosts) if (x.q > 0 && !x.busy && x.nextAt <= t && (!best || x.nextAt < best.nextAt)) best = x;
        if (!best) return;
        best.q--; best.busy = true;
        workers[i] = { host: best, until: t + 0.15 + rnd() * 0.35 };
      });
      while (history.length && history[0] < t - 5) history.shift();
      const idle = workers.filter(w => !w).length;
      const queued = hosts.reduce((s, x) => s + x.q, 0);
      const note = queued && idle ? 'idle' : queued ? 'busy' : 'empty';
      if (note !== idleNote) {
        idleNote = note;
        if (note === 'idle') {
          const waiting = hosts.filter(x => x.q > 0).length;
          log.innerHTML = `Воркеры простаивают, хотя в очередях ${queued} URL: все они у ${waiting} ${plural(waiting, ['хоста', 'хостов', 'хостов'])} на паузе. Это и есть вежливость — скорость ограничена числом разных хостов, а не воркеров.`;
          log.className = 'log warn';
        } else if (note === 'busy') {
          log.innerHTML = 'Все воркеры заняты: готовых хостов хватает. Пока один хост на паузе, качаются другие.';
          log.className = 'log ok';
        } else if (done) {
          log.innerHTML = `Очереди пусты, скачано ${done} ${plural(done, ['страница', 'страницы', 'страниц'])}.`;
          log.className = 'log';
        }
      }
      render();
    }
    function render() {
      wEl.innerHTML = workers.map((w, i) => `<span class="fr-w${w ? ' busy' : ''}"><b>в${i + 1}</b>${w ? w.host.name.split('.')[0] : 'ждёт'}</span>`).join('');
      const shown = hosts.filter(x => x.q > 0 || x.busy || t - x.last < delay() + 0.3);
      hEl.innerHTML = shown.length ? shown.map(x => {
        const wait = Math.max(0, x.nextAt - t);
        const st = x.busy ? '<span class="fr-st busy">качается</span>'
          : wait > 0 ? `<span class="fr-st wait">пауза ${dec(Math.max(wait, 0.1), 1)} с</span>`
          : x.q ? '<span class="fr-st ready">готов</span>' : '<span class="fr-st">пусто</span>';
        const dots = '<i></i>'.repeat(Math.min(x.q, 14)) + (x.q > 14 ? `<em>+${x.q - 14}</em>` : '');
        return `<div class="fr-host"><b>${x.name}</b><span class="fr-q">${dots}</span>${st}</div>`;
      }).join('') : '<p class="empty">Очереди хостов пусты</p>';
      const r = history.length / Math.min(5, Math.max(t, 0.5));
      stats.innerHTML = stat(done, 'скачано') + stat(dec(r, 1), 'страниц/с (5 с)') + stat(workers.filter(w => !w).length + ' / ' + workers.length, 'воркеров ждут');
    }
    const loop = rafLoop(tick);
    reset();
    add(['news.example', 'blog.example', 'docs.example'], 2);
    log.innerHTML = 'Несколько URL уже ждут. Добавьте 30 с одного сайта, потом 30 с разных.';
    return { start: loop.start, stop: loop.stop };
  });

  // ---------------------------------------------------------------- simhash: near-duplicate detection
  Deck.demo('simhash', root => {
    const A = 'Городские власти объявили о запуске новой линии метро, которая соединит северные районы с центром города. Строительство заняло шесть лет и обошлось дороже, чем планировали изначально. На линии восемь станций, поезда будут ходить каждые три минуты в часы пик и каждые семь минут вечером. По оценкам транспортного департамента, новой линией ежедневно будут пользоваться около трёхсот тысяч пассажиров, а время поездки от окраины до центра сократится почти вдвое. Жители северных районов давно жаловались на пробки и переполненные автобусы. Первые две недели проезд по новой линии будет бесплатным. Стоимость билета после этого не изменится и составит столько же, сколько на остальных линиях. Вдоль станций появятся перехватывающие парковки и велосипедные стоянки. В департаменте отметили, что следующую линию начнут строить уже весной, а её проект обсудят с жителями на публичных слушаниях. Эксперты считают, что новая линия заметно разгрузит дороги, но предупреждают, что в первые месяцы возможны сбои в расписании, пока не наладится работа всех систем.';
    const OTHER = 'Футбольный клуб подписал контракт с молодым нападающим из соседней страны. Сумма сделки не раскрывается, но по данным журналистов она стала рекордной для клуба. Игрок уже прошёл медицинское обследование и приступит к тренировкам на следующей неделе. Тренер сказал, что рассчитывает на новичка уже в ближайших матчах чемпионата.';
    const SWAPS = [['шесть лет', 'семь лет'], ['восемь станций', 'девять станций'], ['каждые три минуты', 'каждые две минуты'], ['весной', 'осенью']];
    const words = s => s.toLowerCase().match(/[а-яёa-z0-9]+/g) || [];
    // 64-bit simhash over 3-word shingles: each shingle votes ±1 for each bit of its 64-bit hash.
    function simhash(s) {
      const w = words(s), v = new Array(64).fill(0);
      for (let i = 0; i + 3 <= w.length; i++) {
        const f = w.slice(i, i + 3).join(' ');
        const a = fmix(fnv(f)), b = fmix(fnv(f, 0x12345678));
        for (let k = 0; k < 32; k++) { v[k] += (a >>> k) & 1 ? 1 : -1; v[32 + k] += (b >>> k) & 1 ? 1 : -1; }
      }
      return v.map(x => (x > 0 ? 1 : 0));
    }
    const exact = s => (fmix(fnv(s)).toString(16).padStart(8, '0') + fmix(fnv(s, 0x9747b28c)).toString(16).padStart(8, '0'));
    const sa = simhash(A), ea = exact(A);
    let b, swaps, changes;
    const out = h('div', { class: 'sh-out' });
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'controls' },
      h('button', { class: 'btn small', onclick: swap }, 'Поменять слово'),
      h('button', { class: 'btn small', onclick: () => edit('Обновлено 14:05. ' + b, 'дата в начале') }, 'Добавить дату'),
      h('button', { class: 'btn small', onclick: () => edit(b + ' Подпишитесь на наш канал, чтобы не пропускать новости.', 'баннер в конце') }, 'Добавить баннер'),
      h('button', { class: 'btn small', onclick: () => { b = OTHER; changes = ['другая статья']; render(); } }, 'Другая статья'),
      h('button', { class: 'btn small', onclick: reset }, 'Сброс')), out, log);
    function swap() {
      if (swaps >= SWAPS.length) return;
      const [x, y] = SWAPS[swaps++];
      edit(b.replace(x, y), `«${x}» → «${y}»`);
    }
    function edit(nb, what) { if (b === OTHER) return; b = nb; changes.push(what); render(); }
    function reset() { b = A; swaps = 0; changes = []; render(); }
    function render() {
      const sb = simhash(b), eb = exact(b);
      const d = sa.reduce((s, x, i) => s + (x !== sb[i]), 0);
      const bits = sa.map((x, i) => `<i class="${x ? 'one' : ''}${x !== sb[i] ? ' diff' : ''}"></i>`).join('');
      const bitsB = sb.map((x, i) => `<i class="${x ? 'one' : ''}${x !== sa[i] ? ' diff' : ''}"></i>`).join('');
      out.innerHTML =
        `<div class="sh-line"><span class="label">точный хеш</span><code>${ea}</code><code class="${eb === ea ? '' : 'neq'}">${eb}</code></div>` +
        `<div class="sh-bits"><span class="label">simhash оригинала</span><div class="sh-grid">${bits}</div></div>` +
        `<div class="sh-bits"><span class="label">simhash копии</span><div class="sh-grid">${bitsB}</div></div>` +
        `<div class="sh-dist"><b>${d}</b> ${plural(d, ['бит', 'бита', 'бит'])} из 64 отличаются</div>`;
      if (!changes.length) { log.innerHTML = 'Копия совпадает с оригиналом (150 слов). Правьте её — изменения накапливаются.'; log.className = 'log'; return; }
      const what = changes.join(', ');
      log.innerHTML = `Правки: ${what}. ` + (eb === ea ? '' : 'Точный хеш изменился полностью — он видит только «не равно». ') +
        (d <= 3 ? `Simhash отличается на ${d} — почти дубликат, вторую копию не индексируем.`
          : d <= 12 ? `Simhash отличается на ${d}: похожие страницы, но выше порога 3. Чем больше правок, тем дальше.`
          : `Simhash отличается на ${d} из 64 — около половины, как у случайных текстов. Это разные страницы.`);
      log.className = 'log ' + (d <= 3 ? 'ok' : d <= 12 ? 'warn' : '');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- hot counter: one row vs sharded vs buffered
  Deck.demo('shardcounter', root => {
    const ROW_CAP = 4000, SERVERS = 100;
    const MODES = [['one', 'Одна строка'], ['shard', '16 строк'], ['buffer', 'Копить 1 с в памяти']];
    let mode = 'one', truth, applied, queues, shardVals, flushT, buffered;
    const modeBtns = MODES.map(([m, l]) => h('button', { class: 'btn small', onclick: () => { mode = m; reset(); } }, l));
    const wrap = h('div');
    const lambda = slider(wrap, 'Просмотров/с', [1e3, 3e3, 10e3, 30e3, 60e3], 3, rate, () => {});
    const viz = h('div', { class: 'sc-rows' });
    const stats = h('div', { class: 'stats' });
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'controls' }, modeBtns), wrap, viz, stats, log);
    const N = () => (mode === 'shard' ? 16 : 1);

    function reset() {
      truth = 0; applied = 0; flushT = 0; buffered = 0;
      queues = new Array(N()).fill(0);
      shardVals = new Array(N()).fill(0);
      modeBtns.forEach((b, i) => b.classList.toggle('sel', MODES[i][0] === mode));
      render();
    }
    function tick(dt) {
      const l = lambda();
      const inc = l * dt;
      truth += inc;
      if (mode === 'buffer') {
        buffered += inc;
        flushT += dt;
        if (flushT >= 1) { flushT -= 1; queues[0] += SERVERS; flushBatch(buffered); buffered = 0; }
      } else {
        for (let i = 0; i < queues.length; i++) queues[i] += inc / queues.length;
      }
      for (let i = 0; i < queues.length; i++) {
        const served = Math.min(queues[i], ROW_CAP * dt);
        queues[i] -= served;
        if (mode !== 'buffer') { shardVals[i] += served; applied += served; }
      }
      render();
    }
    // Each of SERVERS flushes `views/SERVERS` with one UPDATE … += n; the rows apply them at ROW_CAP/s.
    function flushBatch(v) { shardVals[0] += v; applied += v; }
    function render() {
      const l = lambda();
      const cap = mode === 'buffer' ? Infinity : ROW_CAP * N();
      const writes = mode === 'buffer' ? SERVERS : l;
      const backlog = queues.reduce((s, q) => s + q, 0);
      const lagSec = mode === 'buffer' ? 1 : backlog / cap;
      viz.innerHTML = queues.map((q, i) => {
        const fill = mode === 'buffer' ? Math.min(1, q / ROW_CAP) : Math.min(1, q / (ROW_CAP * 2));
        return `<div class="sc-row"><span class="sc-q"><span style="height:${fill * 100}%"></span></span><b>${rate(shardVals[i])}</b></div>`;
      }).join('');
      viz.className = 'sc-rows' + (N() > 1 ? ' many' : '');
      stats.innerHTML =
        stat(rate(writes), 'UPDATE/с в базу') +
        stat(rate(backlog), 'ждут блокировки строки', backlog > l ? 'warn' : '') +
        stat(mode === 'buffer' ? '≤ 1 с' : lagSec > 60 ? '> 1 мин' : dec(lagSec, 1) + ' с', 'отставание счётчика', lagSec > 2 ? 'warn' : '');
      let t, cls;
      if (mode === 'one') {
        t = l > ROW_CAP
          ? `Одна строка выдерживает ~${rate(ROW_CAP)} UPDATE/с: каждый ждёт блокировку предыдущего. Приходит ${rate(l)}/с — очередь растёт без конца, соединения пула висят на блокировке, страдает вся база.`
          : `${rate(l)}/с — строка справляется. Поднимите поток до премьерных 30–60 тыс./с.`;
        cls = l > ROW_CAP ? 'bad' : 'ok';
      } else if (mode === 'shard') {
        t = l > ROW_CAP * 16
          ? `Даже 16 строк дают только ~${rate(ROW_CAP * 16)}/с. Шардов нужно больше — или копить в памяти.`
          : `Запись — в случайную из 16 строк, каждая видит 1/16 потока. Чтение — <code>SUM</code> по 16 строкам: дороже, поэтому итог кэшируют на секунды.`;
        cls = l > ROW_CAP * 16 ? 'bad' : 'ok';
      } else {
        t = `Каждый из ${SERVERS} серверов копит просмотры в памяти и раз в секунду делает один <code>+= n</code>: ${SERVERS} UPDATE/с при любом потоке. Цена — секунда отставания и потеря буфера при падении сервера. Для просмотров это нормально, для денег — нет.`;
        cls = 'ok';
      }
      log.innerHTML = t;
      log.className = 'log ' + cls;
    }
    const loop = rafLoop(tick);
    reset();
    return { start: loop.start, stop: loop.stop };
  });

  // ---------------------------------------------------------------- Count-Min Sketch + heap
  Deck.demo('cms', root => {
    const NAMED = ['погода', 'курс доллара', 'новости', 'перевод', 'карта', 'электрички', 'гороскоп', 'блины', 'футбол', 'кино'];
    const V = 3000, D = 4, K = 5;
    const name = i => (i < NAMED.length ? NAMED[i] : 'запрос №' + (i + 1));
    // Zipf(1.0) over V queries.
    const cum = []; let acc = 0;
    for (let i = 0; i < V; i++) { acc += 1 / (i + 1); cum.push(acc); }
    const rnd = seeded(3);
    const draw = () => { const x = rnd() * acc; let lo = 0, hi = V - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } return lo; };
    let stream = [], W, table, heap, truth;
    const wrap = h('div');
    const width = slider(wrap, 'Ширина w', [8, 16, 32, 64, 256, 1024], 1, v => v, () => replay());
    const grid = h('canvas', { class: 'cm-grid' });
    const tbl = h('div', { class: 'cm-table' });
    const stats = h('div', { class: 'stats' });
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'controls' },
      h('button', { class: 'btn small primary', onclick: () => more(2000) }, '+2 000 запросов'),
      h('button', { class: 'btn small', onclick: () => more(20000) }, '+20 000'),
      h('button', { class: 'btn small', onclick: () => { stream = []; replay(); } }, 'Сброс')), wrap, grid, tbl, stats, log);
    const hashes = Array.from({ length: V }, (_, i) => Array.from({ length: D }, (_, r) => fmix(Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(r + 1, 0x85ebca6b))));

    function add(x) {
      truth[x]++;
      let est = Infinity;
      for (let r = 0; r < D; r++) { const c = r * W + hashes[x][r] % W; table[c]++; if (table[c] < est) est = table[c]; }
      const at = heap.findIndex(e => e.x === x);
      if (at >= 0) heap[at].est = est;
      else if (heap.length < K) heap.push({ x, est });
      else {
        let mi = 0; for (let j = 1; j < K; j++) if (heap[j].est < heap[mi].est) mi = j;
        if (est > heap[mi].est) heap[mi] = { x, est };
      }
    }
    function replay() {
      W = width();
      table = new Uint32Array(D * W); heap = []; truth = new Uint32Array(V);
      stream.forEach(add);
      render();
    }
    function more(n) { for (let i = 0; i < n; i++) { const x = draw(); stream.push(x); add(x); } render(); }
    function render() {
      const N = stream.length;
      // sketch heat map
      const cw = grid.clientWidth || 300, dpr = window.devicePixelRatio || 1;
      grid.width = cw * dpr; grid.height = 44 * dpr;
      const c = grid.getContext('2d');
      c.scale(dpr, dpr);
      const max = Math.max(1, ...table);
      const cellW = cw / W;
      for (let r = 0; r < D; r++) for (let j = 0; j < W; j++) {
        const v = table[r * W + j] / max;
        c.fillStyle = `rgba(214, 51, 108, ${0.06 + 0.94 * Math.sqrt(v)})`;
        c.fillRect(j * cellW, r * 11, Math.max(cellW - (cellW > 4 ? 1 : 0), 0.6), 10);
      }
      const exactTop = Array.from(truth.keys()).sort((a, b) => truth[b] - truth[a]).slice(0, K);
      const top = heap.slice().sort((a, b) => b.est - a.est);
      tbl.innerHTML = '<div class="cm-r head"><span>Куча: топ-5</span><span>оценка</span><span>точно</span><span>ошибка</span></div>' +
        (top.length ? top.map(e => {
          const err = truth[e.x] ? (e.est - truth[e.x]) / truth[e.x] : 0;
          const wrong = !exactTop.includes(e.x);
          return `<div class="cm-r${wrong ? ' wrong' : ''}"><span>${name(e.x)}</span><b>${fmt(e.est)}</b><span>${fmt(truth[e.x])}</span><span>${err >= 10 ? '×' + Math.round(err + 1) : '+' + Math.round(err * 100) + '%'}</span></div>`;
        }).join('') : '<div class="cm-r"><span class="empty">поток пуст</span></div>');
      const distinct = truth.reduce((s, v) => s + (v ? 1 : 0), 0);
      stats.innerHTML = stat(fmt(N), 'запросов в потоке') + stat(fmt(D * W * 4) + ' Б', `скетч ${D}×${W}`) + stat(fmt(distinct * 60) + ' Б', `точно: ${fmt(distinct)} ключей`);
      const wrongs = top.filter(e => !exactTop.includes(e.x)).length;
      if (!N) { log.innerHTML = 'Добавьте запросов. Частоты — по закону Ципфа, как у настоящих поисковых запросов: несколько лидеров и длинный хвост.'; log.className = 'log'; }
      else if (wrongs) { log.innerHTML = `w = ${W}: в каждой ячейке смешано ~${fmt(N / W)} запросов, и хвост переоценён настолько, что в топ попал${wrongs > 1 ? 'и' : ''} ${wrongs} ${plural(wrongs, ['чужой', 'чужих', 'чужих'])} (выделено). Увеличьте ширину.`; log.className = 'log bad'; }
      else { log.innerHTML = `Топ совпадает с точным. Оценки завышены, но с высокой вероятностью не больше чем на e·N/w ≈ ${fmt(Math.E * N / W)} — для лидеров это проценты. Скетч занимает ${fmt(D * W * 4)} Б и не растёт с числом разных запросов.`; log.className = 'log ok'; }
    }
    replay();
    more(4000);
    return { start: render };
  });

  // ---------------------------------------------------------------- sliding window top-K
  Deck.demo('window', root => {
    const TERMS = [['погода', 30, '#5a6e80'], ['новости', 25, '#7a95b0'], ['курс доллара', 20, '#9fb4c6'], ['футбол', 10, '#00a29c'], ['блины', 8, '#e8a33a'], ['гол в финале', 0, 'var(--accent)']];
    const SHOW = 20, SPIKE = [90, 70, 45, 25, 10];
    const rnd = seeded(9);
    let minute, buckets, total, spike, acc, win = 5;
    const chart = h('div', { class: 'wn-chart' });
    const tops = h('div', { class: 'wn-tops' });
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    const winBtns = [5, 15].map(w => h('button', { class: 'btn small', onclick: () => { win = w; render(); } }, `окно ${w} мин`));
    const pauseBtn = h('button', { class: 'btn small', onclick: () => { paused = !paused; pauseBtn.textContent = paused ? 'Дальше' : 'Пауза'; } }, 'Пауза');
    let paused = false;
    root.append(h('div', { class: 'controls' },
      h('button', { class: 'btn small primary', onclick: burst }, 'Всплеск: «гол в финале»'), winBtns, pauseBtn),
      chart, h('div', { class: 'wn-legend' }, TERMS.map(([n, , c]) => h('span', null, h('i', { style: `background:${c}` }), n))), tops, log);

    const clock = m => { const x = 12 * 60 + m; return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
    function bucket() {
      const b = TERMS.map(([, base]) => Math.max(0, Math.round(base * (0.75 + rnd() * 0.5))));
      if (spike.length) b[5] += spike.shift();
      return b;
    }
    function reset() {
      minute = 0; buckets = []; total = TERMS.map(() => 0); spike = []; acc = 0;
      for (let i = 0; i < 60; i++) push();
    }
    function push() {
      const b = bucket();
      buckets.push(b);
      b.forEach((v, i) => { total[i] += v; });
      if (buckets.length > 120) buckets.shift();
      minute++;
    }
    function burst() {
      spike = SPIKE.slice();
      log.innerHTML = 'Всплеск начнётся в следующую минуту: 90, 70, 45, 25, 10 запросов в минуту — и затихнет.';
      log.className = 'log';
    }
    function topOf(sum) {
      return sum.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    }
    function render() {
      winBtns.forEach((b, i) => b.classList.toggle('sel', [5, 15][i] === win));
      const vis = buckets.slice(-SHOW);
      const max = Math.max(...vis.map(b => b.reduce((s, v) => s + v, 0)), 1);
      chart.innerHTML = vis.map((b, j) => {
        const inWin = j >= SHOW - win;
        const segs = b.map((v, i) => v ? `<i style="height:${(v / max) * 100}%;background:${TERMS[i][2]}"></i>` : '').join('');
        const m = minute - SHOW + j;
        return `<div class="wn-col${inWin ? ' in' : ''}"><div class="wn-stack">${segs}</div><span>${j % 5 === 4 ? clock(m) : ''}</span></div>`;
      }).join('');
      const winSum = TERMS.map((_, i) => buckets.slice(-win).reduce((s, b) => s + b[i], 0));
      const list = (title, arr) => `<div class="wn-top"><span class="label">${title}</span><ol>${arr.map(([i, v]) =>
        `<li class="${i === 5 ? 'hot' : ''}">${TERMS[i][0]} <b>${fmt(v)}</b></li>`).join('')}</ol></div>`;
      tops.innerHTML = list(`За окно ${win} мин`, topOf(winSum)) + list('За всё время', topOf(total));
    }
    function tick(dt) {
      if (paused) return;
      acc += dt;
      if (acc < 0.9) return;
      acc = 0;
      push();
      render();
      const gone = clock(minute - win - 1), added = clock(minute - 1);
      const winSum = TERMS.map((_, i) => buckets.slice(-win).reduce((s, b) => s + b[i], 0));
      const hot = topOf(winSum).some(([i]) => i === 5), hotAll = topOf(total).some(([i]) => i === 5);
      log.innerHTML = `Минута ${added} добавлена в окно, минута ${gone} вышла — её счётчики вычтены. ` +
        (hot ? `«Гол в финале» в топе окна${hotAll ? ' и даже за всё время' : ', но за всё время его не видно — там лидирует то, что ищут всегда'}.` : 'За всё время топ почти не меняется.');
      log.className = 'log ' + (hot ? 'ok' : '');
    }
    const loop = rafLoop(tick);
    reset();
    render();
    log.innerHTML = 'Каждые ~0,9 с проходит минута. Подсвечены корзины, попавшие в окно.';
    return { start: loop.start, stop: loop.stop };
  });
})();

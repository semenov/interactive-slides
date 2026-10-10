// Case 2 — ride hailing: estimates, geo index (grid vs quadtree), atomic driver reservation, hot areas.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const rate = n => n >= 1e6 ? dec(n / 1e6, n >= 1e7 ? 0 : 1) + ' млн' : n >= 1e3 ? dec(n / 1e3, n >= 1e4 ? 0 : 1) + ' тыс.' : Math.round(n) + '';
  const bytes = b => {
    const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let i = 0;
    while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
    return (b >= 100 ? Math.round(b) : b >= 10 ? dec(b, 0) : dec(b, 1)) + ' ' + u[i];
  };
  const stat = (b, s, cls = '') => `<div class="stat ${cls}"><b>${b}</b><span>${s}</span></div>`;
  function slider(root, label, list, idx, fmt, onChange) {
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
    const set = () => { out.textContent = fmt(list[+input.value]); };
    set();
    input.addEventListener('input', () => { set(); onChange(); });
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, label), input, out));
    return () => list[+input.value];
  }
  function seeded(seed) {
    return () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) / 16777216;
  }

  // ---------------------------------------------------------------- estimates
  Deck.demo('geo-calc', root => {
    const up = () => render();
    const drivers = slider(root, 'Водителей онлайн', [100e3, 300e3, 1e6, 3e6], 2, rate, up);
    const every = slider(root, 'Координаты раз в', [1, 2, 4, 8, 15], 2, v => v + ' с', up);
    const riders = slider(root, 'Пассажиров с открытым приложением', [100e3, 500e3, 1e6, 3e6], 2, rate, up);
    const stats = h('div', { class: 'stats' });
    const log = h('p', { class: 'log' });
    root.append(stats, log);
    function render() {
      const w = drivers() / every();
      const s = riders() / 5; // the map refreshes nearby cars every 5 s
      const mem = drivers() * 300; // GEO member ~100 B + status hash ~200 B
      const units = w + s * 5; // a nearby search returns tens of points: ~5 simple ops
      const nodes = Math.max(1, Math.ceil(units / 100e3 / 0.6)); // ~100k ops/s per Redis, keep 60% headroom
      stats.innerHTML =
        stat(rate(w), 'позиций в секунду', w > 300e3 ? 'warn' : '') +
        stat(rate(s), 'поисков «рядом»/с') +
        stat(bytes(mem), 'в памяти на всех') +
        stat(bytes(w * 200), 'в секунду входящих (JSON+TLS)') +
        stat(bytes(w * 86400 * 40), 'истории в сутки (сжато)') +
        stat(nodes + ' ' + plural(nodes, ['узел', 'узла', 'узлов']), 'Redis по нагрузке, не по памяти');
      log.innerHTML = `${bytes(mem)} поместятся в один сервер, а ${rate(w)} записей и ${rate(s)} поисков в секунду — нет. ` +
        `Шардируем по городу или геоячейке ради пропускной способности. История треков — отдельным потоком в Kafka и колоночное хранилище, не в эту же базу.`;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- geo grid vs quadtree
  Deck.demo('geogrid', root => {
    const MAP = 10, R = 1; // km
    const SIZES = [[5, '5 км ≈ geohash 5'], [2.5, '2,5 км'], [1.25, '1,25 км ≈ geohash 6'], [0.625, '625 м'], [0.3125, '310 м'], [0.15625, '155 м ≈ geohash 7']];
    const rnd = seeded(11);
    const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return u - 3; };
    const pts = [];
    const clamp = v => Math.min(MAP - 0.01, Math.max(0.01, v));
    for (let i = 0; i < 1000; i++) {
      const r = rnd();
      if (r < 0.55) pts.push([clamp(5 + gauss() * 1.3), clamp(5.2 + gauss() * 1.3)]);
      else if (r < 0.7) pts.push([clamp(8 + gauss() * 0.45), clamp(2.2 + gauss() * 0.45)]);
      else pts.push([rnd() * MAP, rnd() * MAP]);
    }
    let rider = [5.3, 4.8], mode = 'grid';

    // Quadtree: split a square while it holds more than CAP points.
    const CAP = 10, DEPTH = 8;
    function build(x, y, s, list, d) {
      if (list.length <= CAP || d >= DEPTH) return { x, y, s, list };
      const hs = s / 2;
      const kids = [[x, y], [x + hs, y], [x, y + hs], [x + hs, y + hs]].map(([kx, ky]) =>
        build(kx, ky, hs, list.filter(p => p[0] >= kx && p[0] < kx + hs && p[1] >= ky && p[1] < ky + hs), d + 1));
      return { x, y, s, kids };
    }
    const tree = build(0, 0, MAP, pts, 0);
    const leaves = [];
    (function walk(n) { if (n.kids) n.kids.forEach(walk); else leaves.push(n); })(tree);

    const canvas = h('canvas', { class: 'gg-map no-swipe', 'aria-label': 'Карта: нажмите, чтобы поставить пассажира' });
    const modeBtns = [['grid', 'Сетка'], ['quad', 'Квадродерево']].map(([m, l]) =>
      h('button', { class: 'btn small', onclick: () => { mode = m; draw(); } }, l));
    const sizeWrap = h('div');
    const size = slider(sizeWrap, 'Ячейка', SIZES, 1, v => v[1], () => draw());
    const stats = h('div', { class: 'stats' });
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'controls' }, modeBtns), sizeWrap, canvas, stats, log);
    canvas.addEventListener('click', e => {
      const r = canvas.getBoundingClientRect();
      rider = [((e.clientX - r.left) / r.width) * MAP, ((e.clientY - r.top) / r.height) * MAP];
      draw();
    });
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);

    const css = n => getComputedStyle(root).getPropertyValue(n).trim();
    function query() {
      const inR = p => Math.hypot(p[0] - rider[0], p[1] - rider[1]) <= R;
      if (mode === 'grid') {
        const s = size()[0], n = MAP / s;
        const cx = Math.floor(rider[0] / s), cy = Math.floor(rider[1] / s);
        const k = Math.ceil(R / s);
        const cells = [];
        for (let i = cx - k; i <= cx + k; i++) for (let j = cy - k; j <= cy + k; j++)
          if (i >= 0 && j >= 0 && i < n && j < n) cells.push({ x: i * s, y: j * s, s });
        const cand = pts.filter(p => cells.some(c => p[0] >= c.x && p[0] < c.x + s && p[1] >= c.y && p[1] < c.y + s));
        return { cells, cand, found: cand.filter(inR), k };
      }
      const hits = leaves.filter(l => {
        const dx = Math.max(l.x - rider[0], 0, rider[0] - (l.x + l.s));
        const dy = Math.max(l.y - rider[1], 0, rider[1] - (l.y + l.s));
        return dx * dx + dy * dy <= R * R;
      });
      const cand = hits.flatMap(l => l.list);
      return { cells: hits, cand, found: cand.filter(inR) };
    }
    function draw() {
      sizeWrap.hidden = mode !== 'grid';
      modeBtns.forEach((b, i) => b.classList.toggle('sel', (i === 0) === (mode === 'grid')));
      const W = canvas.clientWidth;
      if (!W) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = W * dpr;
      const c = canvas.getContext('2d');
      c.setTransform(dpr * W / MAP, 0, 0, dpr * W / MAP, 0, 0);
      const px = MAP / W; // one CSS pixel in km
      c.fillStyle = css('--panel'); c.fillRect(0, 0, MAP, MAP);
      const q = query();
      c.fillStyle = css('--accent-soft');
      q.cells.forEach(cl => c.fillRect(cl.x, cl.y, cl.s, cl.s));
      c.strokeStyle = css('--line'); c.lineWidth = px;
      c.beginPath();
      if (mode === 'grid') {
        const s = size()[0];
        if (s / px >= 4) for (let v = 0; v <= MAP + 1e-9; v += s) { c.moveTo(v, 0); c.lineTo(v, MAP); c.moveTo(0, v); c.lineTo(MAP, v); }
      } else leaves.forEach(l => c.rect(l.x, l.y, l.s, l.s));
      c.stroke();
      c.strokeStyle = css('--accent'); c.lineWidth = 1.5 * px;
      c.beginPath(); q.cells.forEach(cl => c.rect(cl.x, cl.y, cl.s, cl.s)); c.stroke();
      const cand = new Set(q.cand), found = new Set(q.found);
      const r = 2.2 * px;
      for (const p of pts) {
        c.fillStyle = found.has(p) ? css('--accent-deep') : cand.has(p) ? '#e8a33a' : '#a9b6c2';
        c.beginPath(); c.arc(p[0], p[1], found.has(p) || cand.has(p) ? r : r * 0.8, 0, 7); c.fill();
      }
      c.strokeStyle = css('--ink'); c.lineWidth = 1.5 * px; c.setLineDash([4 * px, 3 * px]);
      c.beginPath(); c.arc(rider[0], rider[1], R, 0, 7); c.stroke(); c.setLineDash([]);
      c.fillStyle = css('--ink'); c.beginPath(); c.arc(rider[0], rider[1], 5 * px, 0, 7); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(rider[0], rider[1], 2 * px, 0, 7); c.fill();

      const waste = q.cand.length - q.found.length;
      stats.innerHTML = stat(q.cells.length, mode === 'grid' ? 'ячеек прочитано' : 'листьев прочитано') +
        stat(q.cand.length, 'машин проверено', waste > 150 ? 'warn' : '') + stat(q.found.length, 'в радиусе 1 км');
      if (mode === 'grid') {
        const s = size()[0];
        log.innerHTML = (s >= R
          ? `Ячейка не меньше радиуса — хватает своей ячейки и 8 соседей. `
          : `Ячейка меньше радиуса — нужно ${q.k} ${plural(q.k, ['кольцо', 'кольца', 'колец'])} соседей, ${q.cells.length} ${plural(q.cells.length, ['ячейка', 'ячейки', 'ячеек'])}. `) +
          `Проверено ${q.cand.length}, подошло ${q.found.length}` + (waste > 150 ? (s >= R ? ` — ${waste} лишних: ячейки слишком крупные для центра.` : ` — ${waste} лишних в углах квадрата вокруг круга, и уже ${q.cells.length} обращений к индексу.`) : '.');
      } else {
        log.innerHTML = `Квадродерево (не больше ${CAP} машин в листе): в центре листья по ${Math.round(Math.min(...q.cells.map(l => l.s)) * 1000)} м, на окраине — километры. Прочитано ${q.cells.length} листьев, проверено ${q.cand.length} машин.`;
      }
      log.className = 'log ' + (waste > 150 || q.cells.length > 60 ? 'warn' : 'ok');
    }
    return { start: draw, stop() {} };
  });

  // ---------------------------------------------------------------- matching with atomic reservation
  Deck.demo('match', root => {
    const lock = h('input', { type: 'checkbox' });
    const decline = h('input', { type: 'checkbox' });
    const board = h('div', { class: 'mt-board' });
    const redis = h('div', { class: 'mt-redis' });
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(
      h('label', { class: 'toggle' }, lock, 'Бронь SET NX перед предложением'),
      h('label', { class: 'toggle' }, decline, 'D1 отклоняет заказ'),
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала')),
      board, redis, log);
    lock.addEventListener('change', reset);
    decline.addEventListener('change', reset);
    const DR = [['D1', 2], ['D2', 3], ['D3', 5]];
    let script, i;

    function scenario() {
      const S = [];
      const st = (drv, locks, text, cls = '') => S.push({ drv, locks, text, cls });
      st({}, {}, 'R1 и R2 заказали одновременно, их ведут два экземпляра диспетчера. GEOSEARCH у обоих первым вернул D1: ETA 2 мин.');
      if (!lock.checked) {
        st({ D1: 'предложены R1 и R2' }, {}, 'Оба диспетчера читают статус D1 из базы — «свободен» — и оба отправляют предложение. Между проверкой и записью есть окно.', 'warn');
        if (!decline.checked) {
          st({ D1: 'везёт R1 и R2 ✗' }, {}, 'D1 принимает R1, а второй обработчик тоже записывает D1 в поездку R2: проверка и запись не атомарны. Двойное назначение.', 'bad');
          st({ D1: 'везёт R1', D2: 'предложен R2' }, {}, 'Поездку R2 приходится отменять и искать заново — пассажир потерял время. Проверка «свободен» и захват должны быть одной операцией.', 'warn');
        } else {
          st({ D1: 'отклонил' }, {}, 'D1 отклоняет оба заказа. Оба диспетчера ждали его ответа и только теперь идут к следующему.', 'warn');
          st({ D2: 'предложены R1 и R2' }, {}, 'И оба снова выбирают D2 — гонка повторяется на каждом водителе. Синхронный обход одного списка без брони.', 'bad');
        }
      } else {
        st({ D1: 'бронь R1', D2: 'бронь R2' }, { D1: 'R1', D2: 'R2' }, 'R1: SET lock:D1 R1 NX → OK. R2: тот же SET → nil, D1 занят, и диспетчер сразу бронирует следующего: SET lock:D2 R2 NX → OK.', 'ok');
        if (!decline.checked) {
          st({ D1: 'везёт R1', D2: 'везёт R2' }, { D1: 'R1', D2: 'R2' }, 'Каждый водитель получил ровно одно предложение, оба приняли. Бронь превращается в поездку в базе поездок.', 'ok');
          st({ D1: 'везёт R1', D2: 'везёт R2' }, {}, 'Ключи удалены. Если бы диспетчер упал посреди процесса, бронь сама истекла бы через 15 с по TTL — водитель не завис бы навсегда.', 'ok');
        } else {
          st({ D1: 'отклонил', D2: 'бронь R2', D3: 'бронь R1' }, { D2: 'R2', D3: 'R1' }, 'D1 отклонил. Диспетчер R1 снимает бронь — DEL, только если в ключе всё ещё R1 (проверка и удаление в одном Lua-скрипте) — и бронирует D3.', 'ok');
          st({ D2: 'везёт R2', D3: 'везёт R1' }, {}, 'D3 принял R1, D2 — R2. Если бы D1 просто молчал, бронь истекла бы по TTL, и диспетчер пошёл бы дальше.', 'ok');
        }
      }
      return S;
    }
    function render(s) {
      board.innerHTML = '';
      DR.forEach(([d, eta]) => {
        const v = s.drv[d] || 'свободен';
        const cls = v.includes('✗') ? 'bad' : v.startsWith('везёт') ? 'busy' : v.startsWith('бронь') || v.startsWith('предлож') ? 'offer' : v === 'отклонил' ? 'off' : '';
        board.append(h('div', { class: 'mt-drv ' + cls }, h('b', null, d), h('span', { class: 'label' }, `ETA ${eta} мин`), h('span', null, v)));
      });
      const keys = Object.entries(s.locks);
      redis.innerHTML = '<span class="label">Redis</span> ' + (keys.length ? keys.map(([d, r]) => `<code>lock:${d} = ${r}</code>`).join(' ') : '<span class="empty">ключей брони нет</span>');
      log.innerHTML = s.text;
      log.className = 'log ' + s.cls;
    }
    function step() {
      if (i >= script.length - 1) return;
      render(script[++i]);
      stepBtn.disabled = i >= script.length - 1;
    }
    function reset() {
      script = scenario(); i = 0;
      render(script[0]);
      stepBtn.disabled = false;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- hot area
  Deck.demo('hotspot', root => {
    const SH = 8, CAP = 50e3, HOT = 2;
    const opts = {};
    const mk = (key, label) => {
      const cb = h('input', { type: 'checkbox' });
      cb.addEventListener('change', () => { opts[key] = cb.checked; render(); });
      root.append(h('label', { class: 'toggle' }, cb, label));
      return cb;
    };
    const ev = h('button', { class: 'btn primary', onclick: () => { opts.event = !opts.event; render(); } });
    root.append(h('div', { class: 'controls' }, ev));
    mk('split', 'Разбить горячую ячейку на 4 шарда');
    mk('cache', 'Ответ «машины рядом» из кэша ячейки на 2 с');
    mk('replicas', 'Три реплики для поиска');
    const bars = h('div', { class: 'hs-bars' });
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(bars, log);

    function render() {
      ev.textContent = opts.event ? 'Отменить событие' : 'Концерт закончился';
      const searchCost = opts.cache ? 0.2 : 3, hotCost = opts.cache ? 0.2 : 5;
      const load = [];
      for (let i = 0; i < SH; i++) {
        const writes = 5e3 + (i % 3) * 600, searches = 4e3 + (i % 4) * 500;
        load.push({ writes, read: searches * searchCost });
      }
      if (opts.event) {
        const w = 1.5e3, rd = 20e3 * hotCost; // 6k drivers every 4 s; 40k riders refresh every 2 s
        const targets = opts.split ? [HOT, HOT + 1, HOT + 2, HOT + 3] : [HOT];
        targets.forEach(t => { load[t].writes += w / targets.length; load[t].read += rd / targets.length; });
      }
      const util = load.map(l => (l.writes + l.read / (opts.replicas ? 3 : 1)) / CAP);
      const max = Math.max(...util);
      bars.innerHTML = util.map((u, i) => {
        const lat = u < 1 ? Math.round(2 / (1 - Math.min(u, 0.97))) + ' мс' : 'таймауты';
        return `<div class="hs-row${u >= 1 ? ' over' : u > 0.7 ? ' hi' : ''}"><span class="label">шард ${i + 1}</span>` +
          `<span class="hs-track"><span class="hs-fill" style="width:${Math.min(u, 1.6) / 1.6 * 100}%"></span><i class="hs-cap"></i></span>` +
          `<b>${Math.round(u * 100)}%</b><span class="hs-lat">${lat}</span></div>`;
      }).join('');
      let t;
      if (!opts.event) t = 'Обычный вечер: шарды загружены на 35–45%, задержка — единицы миллисекунд. Отметка — 100% мощности узла.';
      else if (max >= 1) t = `Шард ${HOT + 1} загружен на ${Math.round(max * 100)}%: 40 тысяч человек обновляют карту раз в 2 с, и каждый поиск в плотной ячейке возвращает сотни точек. Очередь растёт — таймауты у всего района, а не только у стадиона.`;
      else t = 'Справились. ' + [
        opts.cache && 'Кэш ячейки схлопнул тысячи одинаковых поисков в один пересчёт раз в 2 с — пассажир видит машины с опозданием в пару секунд, и это нормально.',
        opts.split && 'Горячая ячейка разнесена на четыре шарда — но поиск рядом с границей теперь идёт в несколько шардов.',
        opts.replicas && 'Реплики делят чтение, но каждая применяет все записи и отстаёт на доли секунды.',
      ].filter(Boolean).join(' ');
      log.innerHTML = t;
      log.className = 'log ' + (!opts.event ? '' : max >= 1 ? 'bad' : 'ok');
    }
    render();
    return {};
  });
})();

// Demos for slides 12–19: hit ratio, cache stampede, CDN, rate limiting, load shedding, autoscaling.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const big = n => n >= 1e6 ? dec(n / 1e6).replace(',0', '') + ' млн' : n >= 1e4 ? fmt(n / 1e3) + ' тыс.' : fmt(n);

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  function slider(root, label, list, idx, show, onchange) {
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
    const set = () => { out.textContent = show(list[+input.value]); };
    set();
    input.addEventListener('input', () => { set(); onchange(); });
    const el = h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, label), input, out);
    root.append(el);
    return () => list[+input.value];
  }
  function segmented(items, cur, onpick, label) {
    const btns = items.map(([key, text]) => h('button', { class: 'btn small' + (key === cur ? ' sel' : ''), onclick: () => pick(key) }, text));
    function pick(key) {
      btns.forEach((b, i) => b.classList.toggle('sel', items[i][0] === key));
      onpick(key);
    }
    return h('div', { class: 'controls' }, label ? h('span', { class: 'label' }, label) : null, btns);
  }
  const expo = mean => -Math.log(1 - Math.random()) * mean;
  // deterministic PRNG for reproducible traffic
  const mulberry = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const svgEl = (cls, vb) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', vb); s.setAttribute('class', cls); return s; };

  // ---------------------------------------------------------------- hit ratio
  Deck.demo('hitratio', root => {
    const T_CACHE = 0.5, T_DB = 5, DB_CAP = 20000;
    let down = false;
    const hit = slider(root, 'hit ratio', [0, 50, 80, 90, 95, 98, 99, 99.5, 99.9], 4, v => dec(v, v % 1 ? 1 : 0) + '%', update);
    const rps = slider(root, 'чтений в секунду', [1000, 10000, 50000, 100000, 200000], 2, big, update);
    const dIn = h('input', { type: 'checkbox' });
    dIn.addEventListener('change', () => { down = dIn.checked; update(); });
    root.append(h('label', { class: 'toggle' }, dIn, h('span', null, 'Кэш упал (или холодный после рестарта)')));
    const grid = h('div', { class: 'hr-grid', 'aria-hidden': 'true' });
    const stats = h('div', { class: 'stats' });
    const bar = h('div', { class: 'hr-bar' });
    const verdict = h('div', { class: 'log' });
    root.append(h('div', { class: 'label' }, '200 запросов: зелёные — из кэша, красные — до базы'), grid, stats, bar, verdict);
    const cells = Array.from({ length: 200 }, () => grid.appendChild(h('i')));
    const order = cells.map((_, i) => i).sort((a, b) => ((a * 7919) % 211) - ((b * 7919) % 211));

    function update() {
      const hr = down ? 0 : hit() / 100, r = rps();
      const miss = 1 - hr;
      const db = r * miss;
      const avg = T_CACHE + miss * T_DB;
      const load = db / DB_CAP;
      const missCells = Math.round(200 * miss);
      cells.forEach((c, i) => c.classList.toggle('m', order.indexOf(i) < missCells));
      const p99 = load > 1 ? null : miss > 0.01 ? T_CACHE + T_DB : T_CACHE;
      stats.innerHTML = `<div class="stat${load > 1 ? ' warn' : ''}"><b>${big(db)}</b><span>QPS до базы</span></div>
        <div class="stat"><b>${load > 1 ? '∞' : dec(avg, 2) + ' мс'}</b><span>средняя задержка</span></div>
        <div class="stat${p99 == null || p99 > 1 ? ' warn' : ''}"><b>${p99 == null ? 'таймауты' : dec(p99) + ' мс'}</b><span>p99</span></div>`;
      bar.innerHTML = `<span class="label">база: ${big(db)} из ${big(DB_CAP)} QPS</span><span class="cost-track"><span class="cost-fill${load > 1 ? ' over' : ''}" style="width:${Math.min(100, load * 100)}%"></span></span>`;
      if (load > 1) {
        verdict.innerHTML = down ? `Кэш упал: все ${big(r)} чтений идут в базу, а она держит ${big(DB_CAP)}. Очереди, таймауты, повторы — и база ложится. Нужен прогрев, ограничение потока к базе или запасная копия кэша.` :
          `Промахов ${big(db)} в секунду — больше, чем база может обработать. Поднимайте hit ratio или масштабируйте базу.`;
        verdict.className = 'log bad';
      } else if (hr >= 0.95 && r / DB_CAP > 1) {
        verdict.innerHTML = `Без кэша базе пришлось бы держать ${big(r)} QPS — в ${dec(r / DB_CAP)} раза больше её потолка. Кэш стал несущей стеной: его падение уронит всё. Отметьте галочку и посмотрите.`;
        verdict.className = 'log warn';
      } else {
        verdict.innerHTML = `${dec(miss * 100, miss < 0.01 ? 1 : 0)}% промахов — ${big(db)} QPS до базы. Каждый «девятый» после запятой делит нагрузку ещё раз: 90% → 99% — в 10 раз меньше.`;
        verdict.className = 'log ok';
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- cache stampede
  Deck.demo('stampede', root => {
    const RPS = 2000, TTL = 8, Q = 0.3, CORES = 8, MAXCONN = 100, INST = 20, BETA = 1;
    const NB = 100, BW = 0.2; // chart: 100 bars × 0.2 s
    let mode = 'none', t, expiresAt, queries, lockQ, flight, acc, bars, cur, errors, cycle, delta, early;
    const DESC = {
      none: 'Без защиты: каждый промах сам идёт в базу.',
      lock: 'Блокировка: первый промах берёт lock в Redis и пересчитывает, остальные ждут значение.',
      coalesce: `Склейка запросов внутри процесса: один запрос в базу на каждый из ${INST} экземпляров приложения.`,
      xfetch: 'Раннее вероятностное обновление: чем ближе к истечению, тем выше шанс, что запрос обновит ключ заранее.',
    };
    root.append(segmented([['none', 'Без защиты'], ['lock', 'Lock'], ['coalesce', 'Single flight'], ['xfetch', 'Раннее обновление']], mode, m => { mode = m; reset(); }));
    const ttlEl = h('div', { class: 'st-ttl' });
    const chart = h('div', { class: 'st-chart', 'aria-hidden': 'true' });
    const barEls = Array.from({ length: NB }, () => chart.appendChild(h('i')));
    chart.append(h('span', { class: 'st-max' }, `${MAXCONN} соединений`));
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(ttlEl, h('div', { class: 'label' }, `Запросов в базе одновременно, последние 20 с (${fmt(RPS)} RPS на ключ, пересчёт ${fmt(Q * 1000)} мс)`), chart, stats, logEl);

    function reset() {
      t = 0; expiresAt = 3; queries = []; lockQ = null; flight = new Map(); acc = 0; errors = 0; delta = Q; early = 0;
      bars = Array.from({ length: NB }, () => ({ a: 0, e: 0 }));
      cur = { a: 0, e: 0, t: 0 };
      cycle = { started: 0, maxA: 0, err: 0, active: false };
      say(DESC[mode] + ' Ключ истечёт через 3 секунды.');
      render();
    }
    function startQuery(kind) {
      if (queries.length >= MAXCONN) return null;
      const q = { left: Q, t0: t, kind };
      queries.push(q);
      cycle.started++;
      return q;
    }
    function request() {
      if (t < expiresAt) {
        if (mode === 'xfetch' && t - delta * BETA * Math.log(Math.random()) >= expiresAt) {
          if (startQuery('early')) early++;
        }
        return;
      }
      if (!cycle.active) { cycle = { started: 0, maxA: 0, err: 0, active: true }; }
      let q;
      if (mode === 'none') q = startQuery();
      else if (mode === 'lock') { if (lockQ) return; q = lockQ = startQuery(); }
      else if (mode === 'coalesce') {
        const i = Math.floor(Math.random() * INST);
        if (flight.has(i)) return;
        q = startQuery();
        if (q) flight.set(i, q);
      } else q = startQuery(); // xfetch: a real expiry is unprotected
      if (!q) { errors++; cycle.err++; cur.e++; }
    }
    function step(dt) {
      t += dt;
      acc += RPS * dt;
      while (acc >= 1) { acc -= 1; request(); }
      const share = Math.min(1, CORES / Math.max(1, queries.length));
      const done = [];
      queries = queries.filter(q => { q.left -= dt * share; if (q.left <= 0) { done.push(q); return false; } return true; });
      for (const q of done) {
        delta = t - q.t0;
        expiresAt = t + TTL;
        if (q === lockQ) lockQ = null;
        for (const [k, v] of flight) if (v === q) flight.delete(k);
      }
      if (done.length && cycle.active && !queries.length) finishCycle();
      cycle.maxA = Math.max(cycle.maxA, queries.length);
      cur.a = Math.max(cur.a, queries.length);
      cur.t += dt;
      if (cur.t >= BW) { bars.shift(); bars.push(cur); cur = { a: 0, e: 0, t: 0 }; }
    }
    function finishCycle() {
      cycle.active = false;
      const c = cycle;
      if (mode === 'none') say(`Ключ истёк: ${fmt(c.started)} одинаковых запросов в базу (больше не пустил лимит соединений), пик ${c.maxA} соединений — потолок. Каждый запрос получил лишь ${CORES}/${c.maxA} ядра, пересчёт растянулся в ${dec(c.maxA * Q / CORES)} с, ${fmt(c.err)} запросов получили ошибку.`, 'bad');
      else if (mode === 'lock') say(`Один запрос в базу. Остальные ${fmt(RPS * Q)} запросов ждали ~${fmt(Q * 1000)} мс (или могли получить старое значение, если его хранить дольше TTL).`, 'ok');
      else if (mode === 'coalesce') say(`${c.started} ${plural(c.started, ['запрос', 'запроса', 'запросов'])} в базу — по одному на экземпляр. Терпимо, и не нужен распределённый lock.`, 'ok');
      else say('Ключ всё же истёк, и его пересчитал один запрос.', 'ok');
    }
    let lastEarlyLog = -1;
    function render() {
      const left = Math.max(0, expiresAt - t);
      ttlEl.innerHTML = `<span class="label">ключ <code>feed:top</code></span><span class="cost-track"><span class="cost-fill${left ? '' : ' over'}" style="width:${Math.min(100, left / TTL * 100)}%"></span></span><b>${left ? dec(left) + ' с' : 'истёк'}</b>`;
      bars.forEach((b, i) => {
        const el = barEls[i];
        el.style.height = (b.a / MAXCONN * 100) + '%';
        el.className = b.e ? 'e' : '';
      });
      stats.innerHTML = `<div class="stat"><b>${queries.length}</b><span>запросов в базе сейчас</span></div>
        <div class="stat"><b>${mode === 'xfetch' ? fmt(early) : fmt(cycle.started)}</b><span>${mode === 'xfetch' ? 'ранних обновлений' : 'запросов за пересчёт'}</span></div>
        <div class="stat${errors ? ' warn' : ''}"><b>${fmt(errors)}</b><span>ошибок (нет соединений)</span></div>`;
      if (mode === 'xfetch' && early !== lastEarlyLog && early > 0 && !queries.length) {
        lastEarlyLog = early;
        say(`Ключ обновлён заранее (обновлений: ${early}). Промаха не было — пользователи этого не заметили.`, 'ok');
      }
    }
    reset();
    let racc = 0;
    return rafLoop(dt => {
      const n = Math.max(1, Math.round(dt / 0.005));
      for (let i = 0; i < n; i++) step(dt / n);
      racc += dt;
      if (racc > 0.1) { racc = 0; render(); }
    });
  });

  // ---------------------------------------------------------------- CDN calculator
  Deck.demo('cdn', root => {
    const R = 50000, N = 20000, S = 0.9, SIZE = 200; // KB
    const w = []; let H = 0;
    for (let i = 1; i <= N; i++) { const x = i ** -S; w.push(x); H += x; }
    for (let i = 0; i < N; i++) w[i] /= H;
    let shield = false, dirty = false;
    const pops = slider(root, 'точек присутствия', [1, 10, 50, 200], 2, String, update);
    const ttl = slider(root, 'TTL', [10, 60, 600, 3600, 86400], 1, v => v < 60 ? v + ' с' : v < 3600 ? v / 60 + ' мин' : v < 86400 ? v / 3600 + ' ч' : 'сутки', update);
    const sIn = h('input', { type: 'checkbox' });
    const dIn = h('input', { type: 'checkbox' });
    sIn.addEventListener('change', () => { shield = sIn.checked; update(); });
    dIn.addEventListener('change', () => { dirty = dIn.checked; update(); });
    root.append(h('label', { class: 'toggle' }, sIn, h('span', null, 'Origin shield')),
      h('label', { class: 'toggle' }, dIn, h('span', null, 'utm-метки и cookie в ключе кэша')));
    const flow = h('div', { class: 'cd-flow' });
    const stats = h('div', { class: 'stats' });
    const verdict = h('div', { class: 'log' });
    root.append(flow, stats, verdict);

    const missRate = (lam, T) => lam / (1 + lam * T); // TTL cache, Poisson requests: one miss per TTL cycle
    function update() {
      const P = pops(), T = ttl(), V = dirty ? 1000 : 1;
      let edgeMiss = 0, origin = 0;
      for (let i = 0; i < N; i++) {
        const lv = R * w[i] / P / V;           // per PoP, per key variant
        const mv = missRate(lv, T);           // misses per PoP per variant
        edgeMiss += mv * P * V;
        if (shield) origin += missRate(mv * P, T) * V;
      }
      if (!shield) origin = edgeMiss;
      const hitEdge = 1 - edgeMiss / R;
      const gbit = origin * SIZE * 8 / 1e6;
      const pct = x => x / R * 100;
      flow.innerHTML = `<div class="cd-step"><span>пользователи</span><b>${big(R)}/с</b></div>
        <div class="cd-step"><span>${P} ${plural(P, ['точка', 'точки', 'точек'])} CDN</span><b>промахов ${big(edgeMiss)}/с</b><span class="cost-track"><span class="cost-fill" style="width:${Math.max(0.5, pct(edgeMiss))}%"></span></span></div>
        ${shield ? `<div class="cd-step"><span>origin shield</span><b>промахов ${big(origin)}/с</b><span class="cost-track"><span class="cost-fill" style="width:${Math.max(0.5, pct(origin))}%"></span></span></div>` : ''}
        <div class="cd-step origin"><span>ваш origin</span><b>${big(origin)} RPS</b></div>`;
      stats.innerHTML = `<div class="stat"><b>${dec(hitEdge * 100)}%</b><span>hit ratio на краю</span></div>
        <div class="stat"><b>${dec(origin / R * 100, origin / R < 0.01 ? 2 : 1)}%</b><span>трафика до origin</span></div>
        <div class="stat${gbit > 10 ? ' warn' : ''}"><b>${dec(gbit, gbit < 10 ? 1 : 0)}</b><span>Гбит/с с origin</span></div>`;
      if (dirty) { verdict.innerHTML = 'Каждая комбинация utm-меток и cookie — отдельный объект в кэше. Почти всё — промахи. Нормализуйте ключ: выбрасывайте лишние параметры, не кэшируйте по cookie.'; verdict.className = 'log bad'; }
      else if (!shield && P >= 50) { verdict.innerHTML = `Каждая из ${P} точек сама ходит к вам за непопулярными объектами — «длинный хвост» плохо кэшируется. Включите origin shield.`; verdict.className = 'log warn'; }
      else { verdict.innerHTML = `Объектов ${fmt(N)}, популярность по закону Ципфа. До origin доходит ${dec(origin / R * 100, 1)}% запросов. Длиннее TTL — меньше промахов, но дольше живёт устаревшая версия.`; verdict.className = 'log ok'; }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- rate limiting
  Deck.demo('ratelimit', root => {
    const LIMIT = 10, SPAN = 6, H = 170;
    const W = root.clientWidth && root.clientWidth < 460 ? 400 : 600;
    let algo = 'fixed', traffic = 'boundary', reveal = SPAN, playing = false;
    root.append(
      segmented([['fixed', 'Fixed window'], ['sliding', 'Sliding log'], ['counter', 'Sliding counter'], ['bucket', 'Token bucket']], algo, a => { algo = a; play(); }),
      segmented([['boundary', 'на стыке окон'], ['steady', '15 в секунду'], ['bursts', 'пачками']], traffic, tr => { traffic = tr; play(); }, 'Трафик:'),
    );
    const svg = svgEl('rl-svg', `0 0 ${W} ${H}`);
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(svg, stats, logEl);

    function gen() {
      const rnd = mulberry(traffic === 'boundary' ? 7 : traffic === 'steady' ? 11 : 5);
      const ts = [];
      if (traffic === 'boundary') {
        for (let i = 0; i < 10; i++) ts.push(0.8 + 0.2 * rnd());
        for (let i = 0; i < 10; i++) ts.push(1.0 + 0.2 * rnd());
        for (let i = 0; i < 8; i++) ts.push(3.7 + 0.3 * rnd());
        for (let i = 0; i < 8; i++) ts.push(4.0 + 0.3 * rnd());
      } else if (traffic === 'steady') {
        let x = 0; while ((x += -Math.log(1 - rnd()) / 15) < SPAN) ts.push(x);
      } else {
        for (const b of [0.4, 2.4, 4.4]) for (let i = 0; i < 18; i++) ts.push(b + 0.35 * rnd());
      }
      return ts.sort((a, b) => a - b);
    }
    // returns decisions and a state curve [t, value]
    function run(ts) {
      const ok = [], curve = [];
      if (algo === 'fixed') {
        let n = 0, win = 0, i = 0;
        const roll = w => { curve.push([w, n]); n = 0; win = w; curve.push([w, 0]); };
        for (let s = 0; s <= SPAN + 1e-9; s += 0.02) {
          while (i < ts.length && ts[i] <= s) {
            const x = ts[i++];
            if (Math.floor(x) !== win) roll(Math.floor(x));
            const a = n < LIMIT; if (a) n++; ok.push(a); curve.push([x, n]);
          }
          if (Math.floor(s + 1e-9) !== win) roll(Math.floor(s + 1e-9));
          curve.push([s, n]);
        }
      } else if (algo === 'sliding') {
        const acc = [];
        for (const x of ts) { while (acc.length && acc[0] <= x - 1) acc.shift(); const a = acc.length < LIMIT; if (a) acc.push(x); ok.push(a); }
        const accepted = ts.filter((_, i) => ok[i]);
        for (let s = 0; s <= SPAN; s += 0.02) curve.push([s, accepted.filter(a => a <= s && a > s - 1).length]);
      } else if (algo === 'counter') {
        const cnt = {};
        const est = x => { const wi = Math.floor(x); return (cnt[wi - 1] || 0) * (1 - (x - wi)) + (cnt[wi] || 0); };
        let i = 0;
        for (let s = 0; s <= SPAN + 1e-9; s += 0.02) {
          while (i < ts.length && ts[i] <= s) { const x = ts[i]; const a = est(x) < LIMIT; if (a) cnt[Math.floor(x)] = (cnt[Math.floor(x)] || 0) + 1; ok.push(a); i++; }
          curve.push([s, est(s)]);
        }
      } else {
        const CAP = LIMIT, RATE = LIMIT; let tok = CAP, last = 0;
        let i = 0;
        for (let s = 0; s <= SPAN + 1e-9; s += 0.02) {
          while (i < ts.length && ts[i] <= s) { const x = ts[i]; tok = Math.min(CAP, tok + (x - last) * RATE); last = x; const a = tok >= 1; if (a) tok -= 1; ok.push(a); i++; curve.push([x, tok]); }
          tok = Math.min(CAP, tok + (s - last) * RATE); last = s;
          curve.push([s, tok]);
        }
      }
      return { ok, curve };
    }
    const X = x => 14 + x / SPAN * (W - 28);
    const Y = v => H - 18 - v / 20 * 90;
    function draw() {
      const ts = gen(), { ok, curve } = run(ts);
      const rnd = mulberry(3);
      let s = '';
      for (let i = 0; i <= SPAN; i++) s += `<line x1="${X(i)}" x2="${X(i)}" y1="4" y2="${H - 14}" class="rl-grid"/><text x="${X(i)}" y="${H - 2}" class="rl-ax" text-anchor="${i === SPAN ? 'end' : i ? 'middle' : 'start'}">${i} с</text>`;
      s += `<line x1="${X(0)}" x2="${X(SPAN)}" y1="${Y(LIMIT)}" y2="${Y(LIMIT)}" class="rl-limit"/><text x="${X(SPAN) - 2}" y="${Y(LIMIT) - 4}" class="rl-ax" text-anchor="end">${algo === 'bucket' ? 'ёмкость 10' : 'лимит 10'}</text>`;
      const vis = curve.filter(p => p[0] <= reveal);
      if (vis.length) s += `<path d="${vis.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('')}" class="rl-curve"/>`;
      ts.forEach((x, i) => {
        const y = 10 + rnd() * 34;
        if (x <= reveal) s += `<circle cx="${X(x).toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" class="${ok[i] ? 'rl-ok' : 'rl-no'}"/>`;
      });
      if (reveal < SPAN) s += `<line x1="${X(reveal)}" x2="${X(reveal)}" y1="4" y2="${H - 14}" class="rl-cursor"/>`;
      svg.innerHTML = s;
      const acc = ts.filter((_, i) => ok[i] && ts[i] <= reveal);
      let maxW = 0;
      for (let i = 0, j = 0; i < acc.length; i++) { while (acc[i] - acc[j] >= 1) j++; maxW = Math.max(maxW, i - j + 1); }
      const shown = ts.filter(x => x <= reveal).length;
      stats.innerHTML = `<div class="stat"><b>${acc.length}</b><span>пропущено</span></div>
        <div class="stat"><b>${shown - acc.length}</b><span>отклонено (429)</span></div>
        <div class="stat${maxW > LIMIT ? ' warn' : ''}"><b>${maxW}</b><span>макс. за любую 1 с</span></div>`;
      return maxW;
    }
    const TEXT = {
      fixed: 'Счётчик на каждую секунду, обнуляется на границе. Линия — значение счётчика.',
      sliding: 'Журнал меток времени: пропускаем, если за последнюю секунду меньше 10. Точно, но память — на каждый запрос (в Redis — sorted set).',
      counter: 'Оценка: прошлое окно с весом оставшейся доли плюс текущее. Два счётчика вместо журнала, ошибка — несколько процентов.',
      bucket: 'Корзина на 10 токенов, пополняется 10 в секунду. Линия — токены в корзине. Всплеск до 10 проходит сразу, дальше — со скоростью пополнения.',
    };
    function finish(maxW) {
      if (algo === 'fixed' && maxW > LIMIT) logEl.innerHTML = `${TEXT.fixed} <b>На стыке окон за одну секунду прошло ${maxW} запросов — вдвое больше лимита.</b>`;
      else logEl.innerHTML = TEXT[algo] + (maxW > LIMIT ? (algo === 'bucket' ? ` Максимум за секунду — ${maxW}: полная корзина плюс пополнение за эту секунду.` : ` Максимум за секунду — ${maxW}: цена приближения.`) : '');
      logEl.className = 'log' + (maxW > LIMIT ? ' warn' : ' ok');
    }
    const loop = rafLoop(dt => {
      reveal = Math.min(SPAN, reveal + dt * 2.4);
      const m = draw();
      if (reveal >= SPAN) { loop.stop(); playing = false; finish(m); }
    });
    function play() { reveal = 0; playing = true; logEl.innerHTML = TEXT[algo]; logEl.className = 'log'; loop.start(); }
    finish(draw());
    return { start() { if (playing) loop.start(); }, stop() { loop.stop(); } };
  });

  // ---------------------------------------------------------------- load shedding
  Deck.demo('shed', root => {
    const C = 8, MEAN = 80, TIMEOUT = 1000, QMAX = 20, WIN = 5000; // ms
    const CAP = C * 1000 / MEAN; // 100 rps
    let mode = 'unbounded', q, workers, simT, events, acc;
    const DESC = {
      unbounded: 'Бесконечная очередь: принимаем всё и обслуживаем по порядку.',
      bounded: `Очередь не длиннее ${QMAX}: остальным сразу 503, клиент повторит позже или уйдёт на другой сервер.`,
      deadline: 'Перед обработкой проверяем дедлайн: если до таймаута клиента осталось меньше, чем нужно на обработку, запрос выбрасываем.',
    };
    root.append(segmented([['unbounded', 'Бесконечная очередь'], ['bounded', `Очередь ≤ ${QMAX} + 503`], ['deadline', 'Отбрасывать просроченные']], mode, m => { mode = m; reset(); }));
    const load = slider(root, 'поток, % мощности', [60, 90, 110, 150, 200], 2, v => v + '%', () => {});
    const wEl = h('div', { class: 'sh-workers' });
    const qEl = h('div', { class: 'sh-queue' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('div', { class: 'label' }, `${C} обработчиков по ~${MEAN} мс = ${CAP} RPS. Таймаут клиента — 1 с.`), wEl,
      h('div', { class: 'label' }, 'Очередь (серые — клиент уже ушёл)'), qEl, stats, logEl);
    let warned;
    function reset() {
      q = []; workers = Array(C).fill(null); simT = 0; events = []; acc = 0; warned = false;
      say(DESC[mode]);
      render();
    }
    function step(ms) {
      const lambda = CAP * load() / 100 / 1000;
      for (let i = 0; i < ms; i++) {
        simT++;
        if (Math.random() < lambda) {
          if (mode === 'bounded' && q.length >= QMAX) events.push([simT, 'rej']);
          else q.push(simT);
        }
        for (let k = 0; k < C; k++) {
          const w = workers[k];
          if (w && simT >= w.end) {
            events.push([simT, simT - w.arr <= TIMEOUT ? 'good' : 'waste', simT - w.arr]);
            workers[k] = null;
          }
          if (!workers[k]) {
            while (q.length) {
              const arr = q.shift();
              if (mode === 'deadline' && simT - arr > TIMEOUT - 2 * MEAN) { events.push([simT, 'drop']); continue; } // not enough budget left
              workers[k] = { arr, end: simT + expo(MEAN) };
              break;
            }
          }
        }
      }
      while (events.length && events[0][0] < simT - WIN) events.shift();
    }
    function render() {
      wEl.innerHTML = workers.map(w => `<i class="${w ? (simT - w.arr > TIMEOUT ? 'dead' : 'busy') : ''}"></i>`).join('');
      const shown = Math.min(q.length, 60);
      qEl.innerHTML = q.slice(0, shown).map(a => `<i class="${simT - a > TIMEOUT ? 'dead' : ''}"></i>`).join('') + (q.length > shown ? `<em>+${fmt(q.length - shown)}</em>` : '') + (q.length ? '' : '<span class="empty">пусто</span>');
      const span = Math.min(WIN, simT) / 1000 || 1;
      const cnt = k => events.filter(e => e[1] === k).length / span;
      const good = cnt('good'), waste = cnt('waste'), rej = cnt('rej') + cnt('drop');
      const lat = events.filter(e => e[1] === 'good').map(e => e[2]).sort((a, b) => a - b);
      const p99 = lat.length ? lat[Math.floor(lat.length * 0.99)] : 0;
      stats.innerHTML = `<div class="stat${good < CAP * 0.5 && load() > 60 ? ' warn' : ''}"><b>${fmt(good)}</b><span>успешных RPS</span></div>
        <div class="stat${waste > 1 ? ' warn' : ''}"><b>${fmt(waste)}</b><span>впустую RPS</span></div>
        <div class="stat"><b>${fmt(rej)}</b><span>${mode === 'deadline' ? 'выброшено RPS' : 'быстрый отказ RPS'}</span></div>`;
      if (!warned && simT > 3000) {
        if (mode === 'unbounded' && waste > good && load() > 100) { warned = true; say(`Ожидание в очереди превысило таймаут. Обработчики заняты на 100%, но отвечают тем, кто уже ушёл: полезная работа — ${fmt(good)} RPS. Это перегрузочный коллапс.`, 'bad'); }
        else if (mode === 'bounded' && load() > 100) { warned = true; say(`Сервер делает свои ${fmt(good)} RPS полезной работы, лишнее получает 503 за микросекунды. p99 успешных — ${fmt(p99)} мс.`, 'ok'); }
        else if (mode === 'deadline' && load() > 100) { warned = true; say(`Работы впустую почти нет, но очередь всё равно растёт, и каждый успешный ждёт почти секунду: p99 — ${fmt(p99)} мс. Лучше вместе с ограничением очереди.`, 'warn'); }
      }
    }
    reset();
    let racc = 0;
    return rafLoop(dt => {
      step(Math.round(dt * 1000));
      racc += dt;
      if (racc > 0.15) { racc = 0; render(); }
    });
  });

  // ---------------------------------------------------------------- autoscaling lag
  Deck.demo('autoscale', root => {
    const HOR = 120 * 60, DT = 10, PER = 100, MIN = 3, EVERY = 30, DOWN = 300; // seconds, rps per instance
    let shape = 'spike', boot = 180, target = 0.7, sched = false;
    const W = root.clientWidth && root.clientWidth < 460 ? 400 : 600, H = 210;
    root.append(
      segmented([['ramp', 'утренний рост'], ['spike', 'пуш-рассылка'], ['step', 'ступенька ×3']], shape, v => { shape = v; draw(); }, 'Трафик:'),
      segmented([[30, '30 с'], [180, '3 мин'], [420, '7 мин']], boot, v => { boot = v; draw(); }, 'Запуск:'),
      segmented([[0.5, '50%'], [0.7, '70%'], [0.9, '90%']], target, v => { target = v; draw(); }, 'Цель загрузки:'),
    );
    const sIn = h('input', { type: 'checkbox' });
    sIn.addEventListener('change', () => { sched = sIn.checked; draw(); });
    root.append(h('label', { class: 'toggle' }, sIn, h('span', null, 'Запас по расписанию: минимум 30 экземпляров с 25-й по 60-ю минуту')));
    const svg = svgEl('as-svg', `0 0 ${W} ${H}`);
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(svg, h('div', { class: 'as-leg', html: '<span><i class="sw l-cap"></i>мощность</span><span><i class="sw l-dem"></i>спрос</span><span><i class="sw l-over"></i>перегрузка</span>' }), stats, logEl);

    function demand(t) {
      const m = t / 60;
      if (shape === 'ramp') return m < 20 ? 500 : m < 80 ? 500 + (m - 20) / 60 * 2500 : 3000;
      if (shape === 'step') return m < 30 ? 600 : 1800;
      if (m < 30) return 600;
      if (m < 31) return 600 + (m - 30) * 3400;
      return 600 + 3400 * Math.exp(-(m - 31) / 15);
    }
    function simulate() {
      const pts = [];
      let ready = 6, pending = [], hist = [], served = 0, lost = 0, overMin = 0, instSec = 0, lastDec = 0;
      const desiredHist = [];
      for (let t = 0; t <= HOR; t += DT) {
        pending = pending.filter(p => { if (p <= t) { ready++; return false; } return true; });
        const d = demand(t), cap = ready * PER;
        const s = Math.min(d, cap);
        served += s * DT; if (d > cap) { lost += (d - cap) * DT; overMin += DT / 60; }
        instSec += (ready + pending.length) * DT;
        hist.push(s / cap); if (hist.length > 6) hist.shift(); // 1-minute average utilization
        if (t - lastDec >= EVERY) {
          lastDec = t;
          const util = hist.reduce((a, b) => a + b, 0) / hist.length; // capped at 100%: overload is invisible beyond it
          const minN = sched && t >= 25 * 60 && t < 60 * 60 ? 30 : MIN;
          const want = Math.max(minN, Math.ceil(ready * util / target));
          desiredHist.push([t, want]);
          while (desiredHist.length && desiredHist[0][0] < t - DOWN) desiredHist.shift();
          const stable = Math.max(...desiredHist.map(x => x[1]));
          const total = ready + pending.length;
          if (want > total) for (let k = 0; k < want - total; k++) pending.push(t + boot);
          else if (stable < ready && !pending.length) ready = Math.max(minN, stable);
        }
        pts.push([t, d, ready * PER]);
      }
      return { pts, lost, overMin, instHours: instSec / 3600, util: served / (instSec * PER) };
    }
    function draw() {
      const { pts, lost, overMin, instHours, util } = simulate();
      const maxY = Math.max(2000, ...pts.map(p => Math.max(p[1], p[2]))) * 1.08;
      const X = t => 34 + t / HOR * (W - 44), Y = v => H - 22 - Math.min(v, maxY) / maxY * (H - 34);
      let s = '';
      for (let v = 0; v <= maxY; v += 1000) s += `<line x1="34" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" class="rl-grid"/><text x="30" y="${Y(v) + 4}" class="rl-ax" text-anchor="end">${v / 1000}k</text>`;
      for (let m = 0; m <= 120; m += 30) s += `<text x="${X(m * 60)}" y="${H - 6}" class="rl-ax" text-anchor="${m === 120 ? 'end' : 'middle'}">${m} мин</text>`;
      // capacity area
      s += `<path d="M${X(0)} ${Y(0)}${pts.map(p => `L${X(p[0]).toFixed(1)} ${Y(p[2]).toFixed(1)}`).join('')}L${X(HOR)} ${Y(0)}Z" class="as-cap"/>`;
      // overload: between capacity and demand where demand > capacity
      let over = '';
      for (let i = 1; i < pts.length; i++) {
        const [t0, d0, c0] = pts[i - 1], [t1, d1, c1] = pts[i];
        if (d0 > c0 || d1 > c1) over += `M${X(t0).toFixed(1)} ${Y(Math.max(d0, c0)).toFixed(1)}L${X(t1).toFixed(1)} ${Y(Math.max(d1, c1)).toFixed(1)}L${X(t1).toFixed(1)} ${Y(Math.min(d1, c1)).toFixed(1)}L${X(t0).toFixed(1)} ${Y(Math.min(d0, c0)).toFixed(1)}Z`;
      }
      if (over) s += `<path d="${over}" class="as-over"/>`;
      s += `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('')}" class="as-dem"/>`;
      svg.innerHTML = s;
      stats.innerHTML = `<div class="stat${overMin > 1 ? ' warn' : ''}"><b>${dec(overMin, 0)} мин</b><span>перегрузки</span></div>
        <div class="stat${lost > 0 ? ' warn' : ''}"><b>${big(lost)}</b><span>запросов не обслужено</span></div>
        <div class="stat"><b>${fmt(util * 100)}%</b><span>средняя загрузка (цена)</span></div>`;
      let text;
      if (lost === 0) text = `Перегрузки нет. Платим за запас: средняя загрузка ${fmt(util * 100)}%, ${fmt(instHours)} машино-часов.`;
      else if (shape === 'spike' && !sched) text = `Всплеск пришёл за минуту, а автоскейлер видит загрузку не выше 100% — и растёт ступеньками по ×${dec(1 / target, 2)} за решение, каждый раз ожидая запуска ${boot < 60 ? boot + ' с' : boot / 60 + ' мин'}. ${dec(overMin, 0)} мин перегрузки.`;
      else text = `Автоскейлер отстаёт на время решения и запуска. ${dec(overMin, 0)} мин перегрузки, средняя загрузка ${fmt(util * 100)}%.`;
      logEl.innerHTML = text;
      logEl.className = 'log ' + (lost === 0 ? 'ok' : overMin > 5 ? 'bad' : 'warn');
    }
    draw();
    return {};
  });
})();

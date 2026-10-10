// Demos for slides 2–9: capacity estimate, stateless sessions, balancing algorithms,
// consistent hashing, health checks, architecture evolution.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const big = n => n >= 1e6 ? (n / 1e6 >= 10 ? fmt(n / 1e6) : dec(n / 1e6).replace(',0', '')) + ' млн'
    : n >= 1e3 ? (n / 1e3 >= 10 ? fmt(n / 1e3) : dec(n / 1e3).replace(',0', '')) + ' тыс.' : fmt(n);

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
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, label), input, out));
    return () => list[+input.value];
  }
  function segmented(items, cur, onpick) {
    const btns = items.map(([key, label]) => h('button', { class: 'btn small' + (key === cur ? ' sel' : ''), onclick: () => pick(key) }, label));
    function pick(key) {
      btns.forEach((b, i) => b.classList.toggle('sel', items[i][0] === key));
      onpick(key);
    }
    return { el: h('div', { class: 'controls' }, btns), pick };
  }
  const expo = mean => -Math.log(1 - Math.random()) * mean;

  // ---------------------------------------------------------------- capacity estimate
  Deck.demo('vscale', root => {
    const CAP = { app: 5000, read: 50000, write: 10000 };
    const dau = slider(root, 'DAU', [1e4, 1e5, 1e6, 1e7, 1e8], 2, big, update);
    const rq = slider(root, 'запросов на польз. в день', [10, 30, 100, 300], 2, String, update);
    const peak = slider(root, 'пик / среднее', [2, 3, 5, 10], 1, v => '×' + v, update);
    const wr = slider(root, 'доля записи', [1, 5, 10, 20, 50], 2, v => v + '%', update);
    const stats = h('div', { class: 'stats' });
    const bars = h('div', { class: 'vs-bars' });
    const verdict = h('div', { class: 'log' });
    root.append(stats, bars, verdict);

    function bar(label, need, cap, unit) {
      const r = need / cap;
      return `<div class="vs-row${r > 1 ? ' over' : r > 0.7 ? ' warn' : ''}">
        <span>${label}</span>
        <span class="cost-track"><span class="cost-fill" style="width:${Math.min(100, r * 100)}%"></span></span>
        <b>${r > 1 ? '×' + (r >= 10 ? fmt(r) : dec(r)) : fmt(r * 100) + '%'}</b>
        <small>${big(need)} из ${big(cap)} ${unit}</small></div>`;
    }
    function update() {
      const avg = dau() * rq() / 86400;
      const p = avg * peak();
      const w = wr() / 100;
      const reads = p * (1 - w) * 3, writes = p * w;
      stats.innerHTML = `<div class="stat"><b>${big(avg)}</b><span>RPS в среднем</span></div>
        <div class="stat"><b>${big(p)}</b><span>RPS в пике</span></div>
        <div class="stat"><b>${big(writes)}</b><span>записей/с в пике</span></div>`;
      bars.innerHTML = bar('приложение, 1 сервер', p, CAP.app, 'RPS') +
        bar('Postgres, чтение', reads, CAP.read, 'QPS') +
        bar('Postgres, запись', writes, CAP.write, 'TPS');
      const msgs = [];
      if (p > CAP.app * 0.7) msgs.push(`приложению нужно ${Math.ceil(p / (CAP.app * 0.7))} ${plural(Math.ceil(p / (CAP.app * 0.7)), ['сервер', 'сервера', 'серверов'])} с запасом — это просто, оно stateless`);
      if (reads > CAP.read * 0.7) msgs.push('чтений больше, чем тянет одна база: кэш и реплики');
      if (writes > CAP.write * 0.7) msgs.push('запись не влезает в один primary: пачки, очередь, шардирование');
      if (!msgs.length) {
        verdict.innerHTML = `Пик ${big(p)} RPS — хватит одного сервера приложения и одной базы. Второй экземпляр и реплика нужны для отказоустойчивости, а не для нагрузки.`;
        verdict.className = 'log ok';
      } else {
        verdict.innerHTML = msgs[0][0].toUpperCase() + msgs.join('; ').slice(1) + '.';
        verdict.className = 'log ' + (writes > CAP.write * 0.7 ? 'bad' : 'warn');
      }
    }
    root.append(h('p', { class: 'note vs-note' }, 'Ориентиры: сервер приложения на 16 ядер при ~3 мс CPU на запрос — 5\u00a0000 RPS; Postgres на 32 ядрах с данными в памяти — ~50\u00a0000 простых чтений и ~10\u00a0000 коммитов в секунду. Каждый API-запрос — 3 чтения из базы.'));
    update();
    return {};
  });

  // ---------------------------------------------------------------- stateless sessions
  Deck.demo('stateless', root => {
    const NS = 3, NU = 12;
    let mode = 'mem', servers, users, redis, rr, acc, nreq, lost, lastLog;
    const seg = segmented([['mem', 'Сессии в памяти'], ['sticky', 'Sticky + память'], ['redis', 'Сессии в Redis']], mode, m => { mode = m; reset(); });
    const killBtn = h('button', { class: 'btn small danger', onclick: toggleB }, 'Уронить сервер B');
    const usersEl = h('div', { class: 'sl-users' });
    const srvEl = h('div', { class: 'sl-servers' });
    const redisEl = h('div', { class: 'sl-redis' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(seg.el, h('div', { class: 'controls' }, killBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('div', { class: 'label' }, 'Пользователи'), usersEl,
      h('div', { class: 'label' }, 'Балансировщик → серверы приложения'), srvEl, redisEl, stats, logEl);

    function reset() {
      servers = 'ABC'.split('').map(name => ({ name, up: true, sessions: new Set(), flash: 0 }));
      users = Array.from({ length: NU }, (_, i) => ({ id: i + 1, logged: false, home: null, flash: 0, lostFlash: 0 }));
      redis = new Set();
      rr = 0; acc = 0; nreq = 0; lost = 0; lastLog = -9;
      killBtn.textContent = 'Уронить сервер B';
      say({
        mem: 'Сессия хранится в памяти того сервера, где пользователь вошёл. Балансировщик раздаёт запросы по кругу.',
        sticky: 'Балансировщик привязывает пользователя к серверу (cookie). Пока серверы живы, всё работает.',
        redis: 'Сессии в Redis: любой сервер может обслужить любого пользователя.',
      }[mode]);
      render();
    }
    let t = 0;
    function toggleB() {
      const b = servers[1];
      b.up = !b.up;
      b.sessions.clear();
      killBtn.textContent = b.up ? 'Уронить сервер B' : 'Поднять сервер B';
      if (!b.up) say(mode === 'redis' ? 'Сервер B упал. Его запросы ушли на A и C, сессии остались в Redis — никто не заметил.' :
        mode === 'sticky' ? 'Сервер B упал вместе с сессиями в памяти. Привязанных к нему пользователей перекинет на другие серверы — и разлогинит.' :
          'Сервер B упал, его сессии потеряны.', mode === 'redis' ? 'ok' : 'bad');
      else say('Сервер B снова в пуле — пустой.');
      render();
    }
    function request() {
      const u = users[Math.floor(Math.random() * NU)];
      const alive = servers.filter(s => s.up);
      let s;
      if (mode === 'sticky' && u.home && u.home.up) s = u.home;
      else { s = alive[rr++ % alive.length]; }
      nreq++;
      s.flash = 0.35; u.flash = 0.35;
      const store = mode === 'redis' ? redis : s.sessions;
      if (store.has(u.id)) return;
      if (u.logged) {
        lost++;
        u.lostFlash = 1.2;
        if (t - lastLog > 2) {
          lastLog = t;
          say(mode === 'sticky'
            ? `Пользователь ${u.id} был привязан к упавшему серверу. На сервере ${s.name} сессии нет — снова экран входа.`
            : `Пользователь ${u.id} вошёл на другом сервере, а этот запрос попал на ${s.name} — сессии там нет. Его разлогинило.`, 'bad');
        }
      }
      u.logged = true;
      u.home = s;
      store.add(u.id);
    }
    function render() {
      usersEl.innerHTML = users.map(u => `<i class="${u.lostFlash > 0 ? 'lost' : u.logged ? 'in' : ''}${u.flash > 0 ? ' req' : ''}">${u.id}</i>`).join('');
      srvEl.innerHTML = servers.map(s => `<div class="sl-srv${s.up ? '' : ' down'}${s.flash > 0 ? ' req' : ''}">
        <b>${s.name}</b><span class="label">${s.up ? (mode === 'redis' ? 'без состояния' : 'сессии:') : 'упал'}</span>
        <div class="sl-chips">${mode === 'redis' ? '' : [...s.sessions].sort((a, b) => a - b).map(id => `<i>${id}</i>`).join('')}</div></div>`).join('');
      redisEl.hidden = mode !== 'redis';
      redisEl.innerHTML = `<b>Redis</b> <span class="label">сессии:</span> <span class="sl-chips">${[...redis].sort((a, b) => a - b).map(id => `<i>${id}</i>`).join('')}</span>`;
      stats.innerHTML = `<div class="stat"><b>${nreq}</b><span>запросов</span></div>
        <div class="stat${lost ? ' warn' : ''}"><b>${lost}</b><span>раз разлогинило</span></div>
        <div class="stat"><b>${servers.filter(s => s.up).length} / 3</b><span>серверов живо</span></div>`;
    }
    reset();
    return rafLoop(dt => {
      t += dt;
      acc += dt;
      for (const x of [...servers, ...users]) { x.flash -= dt; if (x.lostFlash !== undefined) x.lostFlash -= dt; }
      if (acc >= 0.3) { acc = 0; request(); }
      render();
    });
  });

  // ---------------------------------------------------------------- balancing algorithms
  Deck.demo('lbalgo', root => {
    const SPEED = [1, 1, 1, 1, 1 / 3];
    const MEAN = 20; // ms of service at speed 1
    const CAP = SPEED.reduce((s, v) => s + v, 0) * 1000 / MEAN; // ≈ 217 rps
    const QMAX = 400;
    let algo = 'rr', servers, lat, latI, rrI, dropped, sent, simT, renderAcc, warned;
    const DESC = {
      rr: 'Round robin: по кругу, не глядя на нагрузку. Каждый получает 20% запросов.',
      random: 'Случайный выбор: в среднем те же 20%, плюс случайные перекосы.',
      hash: 'По хешу пользователя (sticky): привязка не знает о нагрузке — медленному серверу достаются его 20% пользователей.',
      lc: 'Least connections: новый запрос — серверу с наименьшим числом запросов в работе. Нужна точная общая картина.',
      p2c: 'Power of two choices: два случайных сервера, берём менее загруженный. Почти как least connections, но без глобального знания.',
    };
    const seg = segmented([['rr', 'Round robin'], ['random', 'Random'], ['hash', 'Hash'], ['lc', 'Least conn'], ['p2c', 'P2C']], algo, a => { algo = a; reset(); });
    const loadPct = slider(root, 'нагрузка', [50, 70, 85, 95], 1, v => v + '%', () => { warned = false; });
    const srvEl = h('div', { class: 'lb-srv' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.prepend(seg.el);
    root.append(srvEl, stats, logEl);

    function reset() {
      servers = SPEED.map(sp => ({ sp, q: [], busy: null, got: 0 }));
      lat = new Float64Array(3000); latI = 0; rrI = 0; dropped = 0; sent = 0; simT = 0; renderAcc = 0; warned = false;
      say(DESC[algo]);
      render();
    }
    const out = s => s.q.length + (s.busy ? 1 : 0);
    function pick(user) {
      const n = servers.length;
      switch (algo) {
        case 'rr': return servers[rrI++ % n];
        case 'random': return servers[Math.floor(Math.random() * n)];
        case 'hash': return servers[(Math.imul(user, 2654435761) >>> 0) % n];
        case 'lc': {
          let best = Infinity, cand = [];
          for (const s of servers) { const o = out(s); if (o < best) { best = o; cand = [s]; } else if (o === best) cand.push(s); }
          return cand[Math.floor(Math.random() * cand.length)];
        }
        case 'p2c': {
          const a = Math.floor(Math.random() * n);
          let b = Math.floor(Math.random() * (n - 1)); if (b >= a) b++;
          return out(servers[a]) <= out(servers[b]) ? servers[a] : servers[b];
        }
      }
    }
    function step(ms) {
      const lambda = CAP * loadPct() / 100 / 1000; // per ms
      for (let i = 0; i < ms; i++) {
        simT += 1;
        if (Math.random() < lambda) {
          const s = pick(Math.floor(Math.random() * 1000));
          sent++; s.got++;
          if (s.q.length >= QMAX) dropped++;
          else s.q.push(simT);
        }
        for (const s of servers) {
          if (s.busy && simT >= s.busy.end) {
            lat[latI++ % lat.length] = simT - s.busy.arr;
            s.busy = null;
          }
          if (!s.busy && s.q.length) s.busy = { arr: s.q.shift(), end: simT + expo(MEAN / s.sp) };
        }
      }
    }
    function pct(p) {
      const n = Math.min(latI, lat.length);
      if (n < 50) return null;
      const a = Array.from(lat.subarray(0, n)).sort((x, y) => x - y);
      return a[Math.min(n - 1, Math.floor(n * p))];
    }
    const ms = v => v == null ? '…' : v >= 1000 ? dec(v / 1000) + ' с' : fmt(v) + ' мс';
    function render() {
      srvEl.innerHTML = servers.map((s, i) => {
        const o = out(s), shown = Math.min(o, 24);
        return `<div class="lb-row${s.sp < 1 ? ' slow' : ''}"><span class="lb-name">S${i + 1}<small>${s.sp < 1 ? '×⅓' : '×1'}</small></span>
          <span class="lb-q">${'<i></i>'.repeat(shown)}${o > shown ? `<em>+${o - shown}</em>` : ''}</span>
          <span class="lb-share">${sent ? fmt(s.got / sent * 100) : 0}%</span></div>`;
      }).join('');
      const p50 = pct(0.5), p99 = pct(0.99);
      stats.innerHTML = `<div class="stat"><b>${ms(p50)}</b><span>p50</span></div>
        <div class="stat${p99 > 500 ? ' warn' : ''}"><b>${ms(p99)}</b><span>p99</span></div>
        <div class="stat${dropped ? ' warn' : ''}"><b>${fmt(dropped)}</b><span>отброшено</span></div>`;
      const slowQ = out(servers[4]);
      if (!warned && slowQ > 60) {
        warned = true;
        say(`Очередь S5 растёт без предела: он получает ~20% запросов, а успевает обработать ${fmt(SPEED[4] * 1000 / MEAN)} в секунду — меньше, чем ему шлют. Каждый пятый запрос ждёт в этой очереди.`, 'bad');
      }
    }
    reset();
    return rafLoop(dt => {
      step(Math.round(dt * 1000));
      renderAcc += dt;
      if (renderAcc > 0.2) { renderAcc = 0; render(); }
    });
  });

  // ---------------------------------------------------------------- consistent hashing ring
  Deck.demo('ring', root => {
    const COLORS = ['#0ca678', '#336791', '#d9480f', '#7a5ea8', '#e8590c', '#1c7ed6', '#c2255c', '#5c940d'];
    const NK = 2000, SHOWN = 160;
    const fnv = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); } x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995); x ^= x >>> 15; return (x >>> 0) / 4294967296; };
    const keys = Array.from({ length: NK }, (_, i) => fnv('user:' + i));
    const keyInt = Array.from({ length: NK }, (_, i) => Math.floor(fnv('k#' + i) * 4294967296));
    let ids = [1, 2, 3, 4], nextId = 5, vn = 16, points, owner, moved = null;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 240 240');
    svg.setAttribute('class', 'rg-svg');
    const seg = segmented([[1, '1 точка'], [16, '16 точек'], [128, '128 точек']], vn, v => { vn = v; moved = null; build(); render(); say(`${vn} ${plural(vn, ['виртуальный узел', 'виртуальных узла', 'виртуальных узлов'])} на сервер. ${vn === 1 ? 'Доли сильно неравные: участки кольца случайной длины.' : 'Чем больше точек, тем ровнее доли.'}`); });
    const addBtn = h('button', { class: 'btn small primary', onclick: add }, '+ сервер');
    const delBtn = h('button', { class: 'btn small', onclick: del }, '− сервер');
    const shares = h('div', { class: 'rg-shares' });
    const stats = h('div', { class: 'stats rg-stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('div', { class: 'controls' }, addBtn, delBtn), seg.el, h('div', { class: 'rg-wrap' }, svg, shares), stats, logEl);

    function build() {
      points = [];
      for (const id of ids) for (let v = 0; v < vn; v++) points.push({ p: fnv(`S${id}#${v}`), id });
      points.sort((a, b) => a.p - b.p);
      owner = keys.map(k => {
        let lo = 0, hi = points.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (points[m].p < k) lo = m + 1; else hi = m; }
        return points[lo % points.length].id;
      });
    }
    function change(fn, text) {
      const before = owner, nBefore = ids.length;
      const modBefore = keyInt.map(x => ids[x % nBefore]);
      fn();
      build();
      let m = 0; for (let i = 0; i < NK; i++) if (owner[i] !== before[i]) m++;
      const modAfter = keyInt.map(x => ids[x % ids.length]);
      let mm = 0; for (let i = 0; i < NK; i++) if (modAfter[i] !== modBefore[i]) mm++;
      moved = { ring: m / NK, mod: mm / NK, set: new Set(before.map((o, i) => (o !== owner[i] ? i : -1)).filter(i => i >= 0)) };
      say(`${text} На кольце переехало ${fmt(moved.ring * 100)}% ключей, у <code>hash % N</code> — ${fmt(moved.mod * 100)}%. Каждый переезд — промах локального кэша или разорванная сессия.`, moved.ring < 0.4 ? 'ok' : '');
      render();
    }
    function add() { if (ids.length >= 8) return; const id = nextId++; change(() => ids.push(id), `Добавили S${id}: он забирает себе по кусочку у соседей.`); }
    function del() { if (ids.length <= 2) return; const id = ids[1]; change(() => ids.splice(1, 1), `Убрали S${id}: его ключи ушли следующим по кольцу.`); }
    const color = id => COLORS[(id - 1) % COLORS.length];
    function render() {
      const R = 100, C = 120;
      const xy = (p, r) => [C + r * Math.sin(p * 2 * Math.PI), C - r * Math.cos(p * 2 * Math.PI)];
      let s = '';
      // arcs: (prev, cur] belongs to cur
      for (let i = 0; i < points.length; i++) {
        const a = points[(i - 1 + points.length) % points.length].p, b = points[i].p;
        let span = b - a; if (span <= 0) span += 1;
        const [x1, y1] = xy(a, R), [x2, y2] = xy(b, R);
        s += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}A${R} ${R} 0 ${span > 0.5 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${color(points[i].id)}" stroke-width="10" fill="none"/>`;
      }
      for (let i = 0; i < SHOWN; i++) {
        const [x, y] = xy(keys[i], 82);
        const mv = moved && moved.set.has(i);
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${mv ? 3.6 : 2.2}" fill="${color(owner[i])}"${mv ? ' stroke="#13293d" stroke-width="1.4"' : ''}/>`;
      }
      if (vn <= 16) for (const pt of points) {
        const [x, y] = xy(pt.p, R + 9);
        if (vn === 1) s += `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle" class="rg-lbl">S${pt.id}</text>`;
        else { const [x0, y0] = xy(pt.p, R - 6); s += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color(pt.id)}" stroke-width="1.5"/>`; }
      }
      s += `<text x="${C}" y="${C - 4}" text-anchor="middle" class="rg-c">${ids.length} ${plural(ids.length, ['сервер', 'сервера', 'серверов'])}</text><text x="${C}" y="${C + 14}" text-anchor="middle" class="rg-c2">${fmt(NK)} ключей</text>`;
      svg.innerHTML = s;
      const cnt = {}; owner.forEach(o => { cnt[o] = (cnt[o] || 0) + 1; });
      const fair = 100 / ids.length;
      shares.innerHTML = ids.map(id => `<div class="rg-sh"><span class="sw" style="background:${color(id)}"></span>S${id}<span class="cost-track"><span class="cost-fill" style="width:${Math.min(100, (cnt[id] || 0) / NK * 100 / fair * 50)}%;background:${color(id)}"></span></span><b>${fmt((cnt[id] || 0) / NK * 100)}%</b></div>`).join('') +
        `<div class="note">честная доля — ${fmt(fair)}%</div>`;
      stats.innerHTML = moved ? `<div class="stat"><b>${fmt(moved.ring * 100)}%</b><span>переехало (кольцо)</span></div><div class="stat warn"><b>${fmt(moved.mod * 100)}%</b><span>переехало (% N)</span></div><div class="stat"><b>${fmt(100 / ids.length)}%</b><span>идеал ≈ 1/N</span></div>` :
        `<div class="stat"><b>—</b><span>переехало (кольцо)</span></div><div class="stat"><b>—</b><span>переехало (% N)</span></div><div class="stat"><b>${fmt(100 / ids.length)}%</b><span>идеал ≈ 1/N</span></div>`;
      addBtn.disabled = ids.length >= 8;
      delBtn.disabled = ids.length <= 2;
    }
    build();
    render();
    say('Внешнее кольцо — участки серверов, точки внутри — ключи. Нажмите «+ сервер».');
    return {};
  });

  // ---------------------------------------------------------------- health checks and draining
  Deck.demo('health', root => {
    const RPS = 80, DUR = 0.15, TIMEOUT = 1, CHECK = 2, FAILS = 3, OKS = 2, RESTART = 3, EJECT = 10;
    let t, srv, ok, err, rr, acc, strip, bucket, incident, passive = false, drain = false;
    const pIn = h('input', { type: 'checkbox' });
    const dIn = h('input', { type: 'checkbox' });
    pIn.addEventListener('change', () => { passive = pIn.checked; });
    dIn.addEventListener('change', () => { drain = dIn.checked; });
    const hangBtn = h('button', { class: 'btn small danger', onclick: hang }, 'S3 зависает');
    const depBtn = h('button', { class: 'btn small primary', onclick: deploy }, 'Деплой S2');
    const srvEl = h('div', { class: 'hc-srv' });
    const stripEl = h('div', { class: 'hc-strip', title: 'ошибки за последние 30 секунд' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' }, hangBtn, depBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, pIn, h('span', null, 'Пассивная проверка: 5 ошибок подряд → исключить на 10 с')),
      h('label', { class: 'toggle' }, dIn, h('span', null, 'Draining при деплое')),
      srvEl, h('div', { class: 'label' }, `Последние 30 с: доля ошибок (${RPS} RPS)`), stripEl, stats, logEl);

    function reset() {
      hangBtn.textContent = 'S3 зависает';
      t = 0; ok = 0; err = 0; rr = 0; acc = 0; bucket = { ok: 0, err: 0, t: 0 }; incident = null;
      strip = Array(60).fill(0);
      srv = [1, 2, 3, 4].map(i => ({ name: 'S' + i, state: 'up', inPool: true, fails: 0, oks: 0, consec: 0, ejected: 0, nextCheck: CHECK * i / 4, checks: [], fl: [], stateT: 0 }));
      say(`Балансировщик проверяет <code>/health</code> раз в ${CHECK} с и исключает сервер после ${FAILS} неудач подряд.`);
      render();
    }
    function hang() {
      const s = srv[2];
      if (s.state === 'hung') { s.state = 'up'; s.fl = []; hangBtn.textContent = 'S3 зависает'; say('S3 снова отвечает.' + (s.inPool ? '' : ' После двух успешных проверок он вернётся в пул.')); return; }
      s.state = 'hung';
      hangBtn.textContent = 'Починить S3';
      incident = { err: 0, t0: t, what: 'зависание S3' };
      say('S3 завис: принимает соединения, но не отвечает. Запросы к нему ждут таймаута в 1 с.' + (passive ? '' : ' Активная проверка заметит это не раньше чем через 3 неудачи.'), 'warn');
    }
    function deploy() {
      const s = srv[1];
      if (s.state !== 'up') return;
      incident = { err: 0, t0: t, what: 'деплой S2' };
      if (drain) {
        s.state = 'draining'; s.inPool = false; s.stateT = t;
        say('S2 переведён в draining: новые запросы на него не идут, текущие доделываются. Потом рестарт.', 'ok');
      } else {
        const killed = s.fl.length;
        err += killed; incident.err += killed; bucket.err += killed;
        s.fl = []; s.state = 'down'; s.stateT = t;
        say(`S2 убит посреди работы: ${killed} ${plural(killed, ['запрос оборвался', 'запроса оборвались', 'запросов оборвались'])}. Балансировщик ещё ${RESTART} с шлёт ему запросы и получает connection refused.`, 'bad');
      }
    }
    function fail(s, n = 1) {
      err += n; bucket.err += n; if (incident) incident.err += n;
      if (passive && s.inPool) {
        s.consec += n;
        if (s.consec >= 5) {
          s.inPool = false; s.ejected = t + EJECT; s.consec = 0; s.fails = 0;
          say(`Outlier detection: ${s.name} вернул 5 ошибок подряд и исключён на ${EJECT} с, не дожидаясь проверок. Ошибок за сбой: ${incident ? incident.err : 0}.`, 'ok');
        }
      }
    }
    function tick(dt) {
      t += dt;
      // state transitions
      for (const s of srv) {
        if (s.state === 'draining' && !s.fl.length) { s.state = 'down'; s.stateT = t; }
        if (s.state === 'down' && t - s.stateT >= RESTART) { s.state = 'up'; s.stateT = t; s.oks = 0; }
        if (s.ejected && t >= s.ejected) { s.ejected = 0; s.inPool = true; }
        // in-flight requests
        s.fl = s.fl.filter(r => {
          if (t >= r.done && s.state !== 'hung') { ok++; bucket.ok++; s.consec = 0; return false; }
          if (t - r.start >= TIMEOUT) { fail(s); return false; }
          return true;
        });
        // active health check
        if (t >= s.nextCheck) {
          s.nextCheck += CHECK;
          const pass = s.state === 'up';
          s.checks.push(pass); if (s.checks.length > 3) s.checks.shift();
          if (pass) { s.fails = 0; s.oks++; if (!s.inPool && !s.ejected && s.oks >= OKS) { s.inPool = true; if (incident) incident.back = `${s.name} прошёл ${OKS} проверки подряд и вернулся в пул.`; } }
          else if (s.state !== 'draining') {
            s.oks = 0; s.fails++;
            if (s.inPool && s.fails >= FAILS) { s.inPool = false; say(`${s.name} провалил ${FAILS} проверки подряд — исключён из пула через ${dec(t - (incident ? incident.t0 : t))} с после сбоя. Ошибок к этому моменту: ${incident ? incident.err : 0}.`, 'warn'); }
          }
        }
      }
      // arrivals
      acc += dt * RPS;
      while (acc >= 1) {
        acc -= 1;
        const pool = srv.filter(s => s.inPool);
        if (!pool.length) { fail(srv[0]); continue; }
        const s = pool[rr++ % pool.length];
        if (s.state === 'down') fail(s);
        else s.fl.push({ start: t, done: t + DUR * (0.5 + Math.random()) });
      }
      if (incident && srv.every(s => s.state === 'up' && s.inPool && !s.fl.some(r => t - r.start > 0.5))) endIncident(incident.back || 'Все серверы снова работают и в пуле.');
      bucket.t += dt;
      if (bucket.t >= 0.5) {
        strip.shift();
        strip.push(bucket.err / Math.max(1, bucket.ok + bucket.err));
        bucket = { ok: 0, err: 0, t: 0 };
      }
    }
    function endIncident(text) {
      say(`${text} Итого за инцидент (${incident.what}): ${fmt(incident.err)} ${plural(incident.err, ['ошибка', 'ошибки', 'ошибок'])}.`, incident.err ? 'warn' : 'ok');
      incident = null;
    }
    const STATE = { up: 'работает', hung: 'завис', down: 'перезапуск', draining: 'draining' };
    function render() {
      srvEl.innerHTML = srv.map(s => `<div class="hc-card ${s.state}${s.inPool ? '' : ' out'}">
        <b>${s.name}</b><span>${STATE[s.state]}</span>
        <span class="hc-pool">${s.inPool ? 'в пуле' : s.ejected ? 'исключён (outlier)' : 'вне пула'}</span>
        <span class="hc-checks">${s.checks.map(c => `<i class="${c ? 'p' : 'f'}"></i>`).join('')}</span>
        <span class="hc-fl">${s.fl.length} в работе</span></div>`).join('');
      stripEl.innerHTML = strip.map(v => `<i style="--v:${v}" class="${v > 0 ? 'e' : ''}"></i>`).join('');
      stats.innerHTML = `<div class="stat"><b>${fmt(ok)}</b><span>успешных</span></div>
        <div class="stat${err ? ' warn' : ''}"><b>${fmt(err)}</b><span>ошибок</span></div>
        <div class="stat${incident && incident.err ? ' warn' : ''}"><b>${incident ? fmt(incident.err) : '—'}</b><span>за текущий сбой</span></div>`;
    }
    reset();
    let racc = 0;
    return rafLoop(dt => {
      tick(dt);
      racc += dt;
      if (racc > 0.1) { racc = 0; render(); }
    });
  });

  // ---------------------------------------------------------------- architecture evolution
  Deck.demo('evolve', root => {
    // rows: [key, label, count]; "new" lists keys added at this stage; "hot" is the next bottleneck
    const STAGES = [
      { dau: 3e3, rows: [[['one', 'app + Postgres', 1]]], hot: 'one', next: [], qps: 30,
        text: '10 RPS — около процента одного сервера. Нагрузка не проблема, проблема в том, что приложение и база делят машину: деплой, утечка памяти или бэкап бьют по обоим.' },
      { dau: 3e4, rows: [[['app', 'app', 1]], [['db', 'Postgres', 1], ['standby', 'standby', 1]]], add: ['app', 'db', 'standby'], hot: 'app', qps: 300,
        text: 'База отдельно, с горячим резервом. Следующее: единственный сервер приложения — точка отказа, а на 1 000 RPS по 5 мс CPU он займёт 5 ядер.' },
      { dau: 3e5, rows: [[['lb', 'балансировщик', 1]], [['app', 'app', 3]], [['db', 'Postgres', 1], ['standby', 'standby', 1]]], add: ['lb', 'app'], hot: 'db', qps: 3000,
        text: 'Балансировщик и три stateless-экземпляра: деплой без простоя, сервер можно потерять. Следующее: 3 000 QPS в базу пока нормально, но ×10 — это 30 000, у потолка одного Postgres.' },
      { dau: 3e6, rows: [[['lb', 'балансировщик', 1]], [['app', 'app', 10]], [['cache', 'Redis', 1]], [['db', 'Postgres', 1], ['rep', 'реплика', 2]]], add: ['cache', 'rep', 'app'], hot: 'lb', qps: 3000,
        text: 'Кэш с hit ratio 90% снимает с базы 27 000 из 30 000 QPS, остальное чтение — на реплики. Следующее: картинки и статика. 100 тыс. RPS × 100 КБ — это 80 Гбит/с через ваши серверы.' },
      { dau: 3e7, rows: [[['cdn', 'CDN', 1], ['s3', 'S3', 1]], [['lb', 'балансировщик', 2]], [['app', 'app', 40]], [['cache', 'Redis', 6]], [['db', 'Postgres', 1], ['rep', 'реплика', 4]]], add: ['cdn', 's3', 'lb', 'cache'], hot: 'db', qps: 30000,
        text: 'Статика и медиа — в S3 и через CDN, 95% байтов не доходят до вас. Redis — кластер. Следующее: запись. 5% от 1 млн RPS — 50 000 транзакций в секунду, а один primary держит 10–20 тысяч. И тяжёлая работа внутри запроса держит соединения.' },
      { dau: 3e8, rows: [[['cdn', 'CDN', 1], ['s3', 'S3', 1]], [['lb', 'балансировщик', 4]], [['app', 'app', 200]], [['cache', 'Redis', 30], ['queue', 'Kafka', 1]], [['workers', 'воркеры', 50]], [['shard', 'шард БД', 16]]], add: ['queue', 'workers', 'shard'], hot: null, qps: 300000,
        text: 'Очередь и воркеры: письма, ресайз и пересчёт лент — асинхронно, пики сглаживаются. База разбита на 16 шардов по user_id, у каждого свои реплики. Дальше — несколько регионов; об этом в следующих частях серии.' },
    ];
    let i = 0;
    const upBtn = h('button', { class: 'btn primary', onclick: () => go(i + 1) }, 'Пользователей ×10');
    const backBtn = h('button', { class: 'btn', onclick: () => go(0) }, 'Сначала');
    const stats = h('div', { class: 'stats' });
    const diag = h('div', { class: 'ev' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'controls' }, upBtn, backBtn), stats, diag, logEl);

    function go(n) {
      i = Math.max(0, Math.min(STAGES.length - 1, n));
      const st = STAGES[i];
      const rps = st.dau * 100 / 86400 * 3;
      stats.innerHTML = `<div class="stat"><b>${big(st.dau)}</b><span>DAU</span></div>
        <div class="stat"><b>${big(Math.round(rps / 10 ** Math.floor(Math.log10(rps))) * 10 ** Math.floor(Math.log10(rps)))}</b><span>RPS в пике</span></div>
        <div class="stat"><b>${big(st.qps)}</b><span>QPS до базы</span></div>`;
      diag.innerHTML = `<div class="ev-row"><span class="ev-box users">пользователи</span></div>` + st.rows.map(row =>
        `<div class="ev-arrow">↓</div><div class="ev-row">${row.map(([k, label, n]) => `<span class="ev-box ${k}${st.add && st.add.includes(k) ? ' new' : ''}${st.hot === k ? ' hot' : ''}">${label}${n > 1 ? ` <small>×${n}</small>` : ''}</span>`).join('')}</div>`).join('');
      logEl.innerHTML = st.text;
      logEl.className = 'log' + (st.hot ? '' : ' ok');
      upBtn.disabled = i === STAGES.length - 1;
      backBtn.disabled = i === 0;
    }
    go(0);
    return {};
  });
})();

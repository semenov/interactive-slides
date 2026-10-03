// Demos for slides 14–21: locks, connection pooling, replication, failover, PITR, bottlenecks.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const fmt = n => n.toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');

  function logger(el, keep = 3) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }

  // ---------------------------------------------------------------- lock queue
  Deck.demo('locks', root => {
    let now, sessions, nextApp, id, maxWait, timeoutOn = false;
    const holdEl = h('div', { class: 'lk-row' });
    const queueEl = h('div', { class: 'lk-row' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const toIn = h('input', { type: 'checkbox' });
    toIn.addEventListener('change', () => { timeoutOn = toIn.checked; });
    const reportBtn = h('button', { class: 'btn', onclick: () => start('report') }, 'Долгий отчёт (8 с)');
    const alterBtn = h('button', { class: 'btn primary', onclick: () => start('alter') }, h('code', null, 'ALTER TABLE'));
    root.append(
      h('div', { class: 'controls' }, reportBtn, alterBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, toIn, h('span', null, h('code', null, "lock_timeout = '2s'"), ' для ALTER')),
      h('div', { class: 'lk-table' }, h('b', null, 'таблица orders'),
        h('div', { class: 'label' }, 'держат блокировку'), holdEl,
        h('div', { class: 'label' }, 'ждут в очереди'), queueEl),
      stats, logEl,
    );

    const KIND = {
      app: { mode: 'share', dur: 0.25, label: 'SELECT' },
      report: { mode: 'share', dur: 8, label: 'отчёт' },
      alter: { mode: 'excl', dur: 0.4, label: 'ALTER' },
    };
    function reset() {
      now = 0; sessions = []; nextApp = 0; id = 0; maxWait = 0;
      say('Приложение непрерывно делает быстрые SELECT. Всё работает.');
      render();
    }
    function start(kind) {
      if (kind !== 'app' && sessions.some(s => s.kind === kind)) return;
      sessions.push({ id: ++id, kind, ...KIND[kind], state: 'wait', since: now, left: KIND[kind].dur });
      if (kind === 'report') say('Отчёт взял разделяемую блокировку (ACCESS SHARE). С обычными SELECT он совместим.');
      if (kind === 'alter') say('ALTER TABLE просит ACCESS EXCLUSIVE — несовместимую ни с чем.', 'warn');
    }
    function grant() {
      const holders = sessions.filter(s => s.state === 'run');
      let blocked = false;
      for (const s of sessions) {
        if (s.state !== 'wait') continue;
        const conflict = s.mode === 'excl' ? holders.length > 0 : holders.some(o => o.mode === 'excl');
        // A request waits if it conflicts with holders or with anyone earlier in the queue.
        if (conflict || blocked) { blocked = blocked || s.mode === 'excl' || conflict; continue; }
        s.state = 'run';
        holders.push(s);
        if (s.kind === 'alter') say(`ALTER получил блокировку через ${dec(now - s.since)} с и быстро выполнился. Очередь рассосалась.`, 'ok');
      }
    }
    function render() {
      const run = sessions.filter(s => s.state === 'run'), wait = sessions.filter(s => s.state === 'wait');
      const chip = s => `<span class="lk ${s.kind} ${s.mode}">${s.label}${s.kind === 'report' && s.state === 'run' ? ' ' + dec(s.left, 0) + ' с' : ''}</span>`;
      const short = list => list.length > 24 ? list.slice(0, 24).map(chip).join('') + `<span class="more">+${list.length - 24}</span>` : list.map(chip).join('');
      holdEl.innerHTML = short(run) || '<span class="empty">никто</span>';
      queueEl.innerHTML = short(wait) || '<span class="empty">пусто</span>';
      const waitingApps = wait.filter(s => s.kind === 'app');
      stats.innerHTML = `<div class="stat ${waitingApps.length > 3 ? 'warn' : ''}"><b>${waitingApps.length}</b><span>запросов приложения ждут</span></div>` +
        `<div class="stat ${maxWait > 1 ? 'warn' : ''}"><b>${dec(maxWait)} с</b><span>самое долгое ожидание</span></div>` +
        `<div class="stat"><b>${run.length}</b><span>держат блокировку</span></div>`;
      reportBtn.disabled = sessions.some(s => s.kind === 'report');
      alterBtn.disabled = sessions.some(s => s.kind === 'alter');
    }
    reset();
    let tick = 0;
    return rafLoop(dt => {
      now += dt;
      if (now >= nextApp) { start('app'); nextApp = now + 0.3; }
      for (const s of sessions) if (s.state === 'run') s.left -= dt;
      sessions = sessions.filter(s => s.state !== 'run' || s.left > 0);
      const alter = sessions.find(s => s.kind === 'alter' && s.state === 'wait');
      if (alter && timeoutOn && now - alter.since > 2) {
        sessions = sessions.filter(s => s !== alter);
        say('ERROR: canceling statement due to lock timeout. ALTER сдался, очередь сразу пошла. Миграцию повторят, когда отчёт закончится.', 'ok');
      }
      grant();
      const waits = sessions.filter(s => s.state === 'wait' && s.kind === 'app').map(s => now - s.since);
      const curMax = waits.length ? Math.max(...waits) : 0;
      maxWait = Math.max(curMax, maxWait * 0.995);
      if (alter && alter.state === 'wait' && curMax > 1 && !timeoutOn && (tick++ % 120 === 0)) {
        say('Запросы приложения встали в очередь за ALTER, хотя с отчётом они совместимы. Для пользователей сайт лежит.', 'bad');
      }
      render();
    });
  });

  // ---------------------------------------------------------------- connection pooling
  Deck.demo('pool', root => {
    const COUNTS = [20, 50, 100, 200, 500, 1000, 2000];
    const MAXC = 100, POOL = 20, MB = 10;
    let clients = [], n = 200, pooler = false, acc = 0;
    const nIn = h('input', { type: 'range', min: 0, max: COUNTS.length - 1, value: 3, 'aria-label': 'Клиентских соединений' });
    const nOut = h('output', null, n);
    const pIn = h('input', { type: 'checkbox' });
    const cEl = h('div', { class: 'pl-clients' });
    const sEl = h('div', { class: 'pl-servers' });
    const stats = h('div', { class: 'stats' });
    const verdict = h('div', { class: 'log' });
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Соединений от приложения'), nIn, nOut),
      h('label', { class: 'toggle' }, pIn, h('span', null, 'PgBouncer, режим transaction, пул 20')),
      h('div', { class: 'label' }, 'Клиенты (каждый в транзакции ~10% времени)'), cEl,
      h('div', { class: 'label' }, 'Процессы Postgres (max_connections = 100)'), sEl,
      stats, verdict,
    );
    nIn.addEventListener('input', () => { n = COUNTS[+nIn.value]; nOut.textContent = n; build(); });
    pIn.addEventListener('change', () => { pooler = pIn.checked; build(); });

    function build() {
      clients = Array.from({ length: n }, () => ({ busy: 0 }));
      render();
    }
    function step() {
      for (const c of clients) {
        if (c.busy > 0) c.busy--;
        else if (Math.random() < 0.05) c.busy = 1 + Math.floor(Math.random() * 3);
      }
    }
    function render() {
      const active = clients.filter(c => c.busy > 0).length;
      let servers, rejected = 0, waiting = 0, serverBusy;
      if (pooler) {
        servers = Math.min(POOL, Math.max(active, 2));
        serverBusy = Math.min(active, POOL);
        waiting = Math.max(0, active - POOL);
      } else {
        servers = Math.min(n, MAXC);
        rejected = Math.max(0, n - MAXC);
        serverBusy = clients.slice(0, MAXC).filter(c => c.busy > 0).length;
      }
      // One dot per client, or per group of clients when there are many.
      const per = Math.ceil(n / 200);
      const dots = [];
      for (let i = 0; i < n; i += per) {
        const group = clients.slice(i, i + per);
        const busy = group.some(c => c.busy > 0);
        const cls = !pooler && i >= MAXC ? 'rej' : busy ? 'busy' : '';
        dots.push(`<i class="${cls}"></i>`);
      }
      cEl.innerHTML = dots.join('') + (per > 1 ? `<span class="more">точка = ${per} клиента</span>` : '');
      sEl.innerHTML = Array.from({ length: servers }, (_, i) => `<i class="${i < serverBusy ? 'busy' : ''}"></i>`).join('');
      stats.innerHTML = `<div class="stat"><b>${servers}</b><span>процессов Postgres</span></div>` +
        `<div class="stat"><b>${servers * MB} МБ</b><span>памяти на соединения</span></div>` +
        `<div class="stat ${rejected || waiting ? 'warn' : ''}"><b>${pooler ? waiting : rejected}</b><span>${pooler ? 'ждут в пулере' : 'отказано в соединении'}</span></div>`;
      if (!pooler && rejected) {
        verdict.innerHTML = `FATAL: sorry, too many clients already — ${rejected} ${plural(rejected, ['клиент не подключился', 'клиента не подключились', 'клиентов не подключились'])}. Хотя одновременно работает лишь около ${Math.round(n * 0.1)}.`;
        verdict.className = 'log bad';
      } else if (!pooler) {
        verdict.innerHTML = `Все ${n} соединений — процессы Postgres, и почти все простаивают, занимая память.`;
        verdict.className = 'log warn';
      } else {
        verdict.innerHTML = `${n} клиентов обслуживают ${servers} серверных соединений. ${waiting ? 'В пике часть транзакций ждёт свободное соединение доли миллисекунды.' : 'Свободные соединения переиспользуются.'}`;
        verdict.className = 'log ok';
      }
    }
    build();
    return rafLoop(dt => {
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      step();
      render();
    });
  });

  // ---------------------------------------------------------------- replication
  Deck.demo('replication', root => {
    let p, reps, hist, confirmed, pending, mode = 'async', down = false, slowNet = false, crashed = false, acc = 0, lost = 0;
    const view = h('div', { class: 'rp' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const modeBtn = h('button', { class: 'btn', onclick: () => { mode = mode === 'async' ? 'sync' : 'async'; modeBtn.textContent = mode === 'sync' ? 'Сделать асинхронной' : 'Сделать r1 синхронной'; say(mode === 'sync' ? 'r1 синхронная: коммит ждёт, пока r1 запишет WAL у себя.' : 'Асинхронный режим: коммит не ждёт реплик.'); } }, 'Сделать r1 синхронной');
    const downBtn = h('button', { class: 'btn', onclick: () => { down = !down; downBtn.textContent = down ? 'Вернуть r1' : 'Выключить r1'; say(down ? (mode === 'sync' ? 'r1 недоступна. Синхронные коммиты зависли: подтвердить некому.' : 'r1 недоступна. Primary не замечает — асинхронная репликация не ждёт.') : 'r1 вернулась и догоняет по журналу.', down && mode === 'sync' ? 'bad' : ''); } }, 'Выключить r1');
    const netIn = h('input', { type: 'checkbox' });
    netIn.addEventListener('change', () => { slowNet = netIn.checked; });
    const crashBtn = h('button', { class: 'btn danger', onclick: crash }, 'Уронить primary');
    root.append(
      h('div', { class: 'controls' }, modeBtn, downBtn, crashBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, netIn, h('span', null, 'r2 в другом дата-центре, канал узкий')),
      view, stats, logEl,
    );

    function reset() {
      p = 0; hist = [0]; confirmed = 0; pending = 0; crashed = false; lost = 0;
      reps = [{ name: 'r1', lsn: 0 }, { name: 'r2', lsn: 0 }];
      say('Primary принимает коммиты, реплики получают поток WAL.');
      render();
    }
    function crash() {
      if (crashed) return;
      crashed = true;
      const best = Math.max(...reps.map((r, i) => (i === 0 && down ? -1 : r.lsn)));
      lost = Math.max(0, confirmed - best);
      say(lost
        ? `Primary умер. Лучшая реплика отстаёт: ${lost} ${plural(lost, ['подтверждённая транзакция потеряна', 'подтверждённые транзакции потеряны', 'подтверждённых транзакций потеряно'])} при переключении.`
        : 'Primary умер. Всё подтверждённое клиентам есть на реплике — переключение без потерь.', lost ? 'bad' : 'ok');
      render();
    }
    function render() {
      const node = (name, lsn, cls, extra) => `<div class="rp-node ${cls}"><b>${name}</b><span class="rp-lsn">LSN ${fmt(lsn)}</span>` +
        `<span class="track"><span class="fill" style="width:${p ? (lsn / p) * 100 : 100}%"></span></span>${extra}</div>`;
      view.innerHTML = node('primary', p, crashed ? 'down' : 'primary', `<span class="label">${crashed ? 'упал' : 'принимает запись'}</span>`) +
        reps.map((r, i) => node(r.name, r.lsn, i === 0 && down ? 'down' : '',
          `<span class="label">${i === 0 && down ? 'недоступна' : `отстаёт на ${fmt(p - r.lsn)}`}${i === 0 && mode === 'sync' ? ', синхронная' : ''}</span>`)).join('');
      const lat = mode === 'sync' ? (down ? '∞' : '2–5 мс') : '< 1 мс';
      stats.innerHTML = `<div class="stat"><b>${fmt(confirmed)}</b><span>коммитов подтверждено</span></div>` +
        `<div class="stat ${pending > 5 ? 'warn' : ''}"><b>${fmt(pending)}</b><span>коммитов ждут реплику</span></div>` +
        `<div class="stat ${mode === 'sync' && down ? 'warn' : ''}"><b>${lat}</b><span>задержка коммита</span></div>`;
      crashBtn.disabled = crashed;
    }
    reset();
    return rafLoop(dt => {
      acc += dt;
      if (acc < 0.1 || crashed) return;
      acc = 0;
      p += 2;
      hist.push(p);
      if (hist.length > 50) hist.shift();
      // Replicas see the primary's WAL with a network delay; r2 can also be bandwidth-limited.
      const delayed = k => hist[Math.max(0, hist.length - 1 - k)];
      if (!down) reps[0].lsn = delayed(3);
      reps[1].lsn = slowNet ? Math.min(delayed(5), reps[1].lsn + 1.2) : delayed(5);
      if (mode === 'sync') {
        if (!down) confirmed = Math.max(confirmed, reps[0].lsn);
        pending = p - confirmed;
      } else {
        confirmed = p;
        pending = 0;
      }
      render();
    });
  });

  // ---------------------------------------------------------------- Patroni failover
  Deck.demo('failover', root => {
    const TTL = 6, LOOP = 1;
    let nodes, leader, ttl, t, downSince, state, routed, acc;
    const view = h('div', { class: 'fo' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 3);
    const killBtn = h('button', { class: 'btn danger', onclick: () => fail('dead') }, 'Убить primary');
    const cutBtn = h('button', { class: 'btn', onclick: () => fail('isolated') }, 'Отрезать primary от etcd');
    const backBtn = h('button', { class: 'btn', onclick: back }, 'Вернуть старый узел');
    root.append(h('div', { class: 'controls' }, killBtn, cutBtn, backBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')), view, logEl);

    function reset() {
      nodes = [
        { name: 'pg1', role: 'primary', lag: 0, status: 'ok' },
        { name: 'pg2', role: 'replica', lag: 2, status: 'ok' },
        { name: 'pg3', role: 'replica', lag: 40, status: 'ok' },
      ];
      leader = 'pg1'; ttl = TTL; t = 0; downSince = null; state = 'ok'; routed = 'pg1'; acc = 0;
      say('pg1 держит ключ лидера в etcd и продлевает его каждую секунду.');
      render();
    }
    const byName = n => nodes.find(x => x.name === n);
    function fail(how) {
      const l = byName(leader);
      if (state !== 'ok' || !l) return;
      l.status = how;
      downSince = t;
      state = 'expiring';
      if (how === 'dead') {
        routed = null;
        say(`${l.name} умер. Ключ лидера никто не продлевает — ждём, пока истечёт TTL (${TTL} с).`, 'warn');
      } else say(`${l.name} жив и принимает запись, но не может продлить ключ в etcd. Если он продолжит писать после выбора нового лидера — будет два мастера.`, 'warn');
      render();
    }
    function back() {
      const old = nodes.find(n => n.status !== 'ok');
      if (!old || state !== 'ok') return;
      old.status = 'ok';
      old.role = 'replica';
      old.lag = 5;
      say(`${old.name} вернулся. Его журнал мог разойтись с новым лидером — pg_rewind откатывает лишнее, и узел становится репликой.`, 'ok');
      render();
    }
    function tick() {
      t += LOOP;
      const l = byName(leader);
      nodes.forEach(n => { if (n.role === 'replica' && n.status === 'ok') n.lag = Math.max(0, n.lag - (n.lag > 10 ? 8 : 1)); });
      if (state === 'ok') { ttl = TTL; return; }
      if (state === 'expiring') {
        ttl -= LOOP;
        if (l.status === 'isolated' && ttl <= 1 && l.role === 'primary') {
          l.role = 'demoted';
          routed = null;
          say(`${l.name} понял, что не может продлить ключ, и сам перешёл в режим только чтения. Двух мастеров не будет.`, 'ok');
        }
        if (ttl <= 0) {
          const cands = nodes.filter(n => n.role === 'replica' && n.status === 'ok').sort((a, b) => a.lag - b.lag);
          const win = cands[0];
          state = 'promoting';
          leader = win.name;
          win.role = 'promoting';
          say(`Ключ истёк. Реплики сравнили, кто ближе к старому мастеру: ${win.name} (отставание ${win.lag}). Он забрал ключ и повышается.`);
        }
        return;
      }
      if (state === 'promoting') {
        const w = byName(leader);
        w.role = 'primary';
        routed = w.name;
        const down = t - downSince;
        if (byName('pg1').status === 'dead' || byName('pg1').status === 'isolated') byName('pg1').role = byName('pg1').status === 'dead' ? 'down' : 'demoted';
        nodes.filter(n => n.role === 'replica').forEach(n => { n.lag += 3; });
        say(`${w.name} — новый primary. HAProxy переключил запись на него. Запись была недоступна ~${down} с.`, 'ok');
        state = 'ok';
      }
    }
    function render() {
      const ROLE = { primary: 'primary', replica: 'реплика', promoting: 'повышается', demoted: 'только чтение', down: 'недоступен' };
      view.innerHTML = `<div class="fo-dcs"><b>etcd</b><span>ключ лидера: <code>${state === 'promoting' ? leader : byName(leader) ? leader : '—'}</code></span>` +
        `<span class="fo-ttl"><span class="track"><span class="fill" style="width:${(Math.max(0, ttl) / TTL) * 100}%"></span></span>TTL ${Math.max(0, ttl)} с</span></div>` +
        `<div class="fo-route">HAProxy → запись идёт на <b>${routed || 'никуда'}</b></div>` +
        `<div class="fo-nodes">${nodes.map(n => {
          const st = n.status === 'dead' ? 'dead' : n.status === 'isolated' ? 'isolated' : '';
          const role = n.status === 'dead' ? 'down' : n.role;
          return `<div class="fo-node ${role} ${st}"><b>${n.name}</b><span class="role">${ROLE[role]}</span>` +
            `<span class="label">${n.status === 'dead' ? 'выключен' : n.status === 'isolated' ? 'нет связи с etcd' : n.role === 'replica' ? 'отставание ' + n.lag : 'Patroni на месте'}</span></div>`;
        }).join('')}</div>`;
      killBtn.disabled = cutBtn.disabled = state !== 'ok' || nodes.some(n => n.status !== 'ok');
      backBtn.disabled = state !== 'ok' || !nodes.some(n => n.status !== 'ok');
    }
    reset();
    return rafLoop(dt => {
      acc += dt;
      if (acc < LOOP) return;
      acc = 0;
      tick();
      render();
    });
  });

  // ---------------------------------------------------------------- PITR timeline
  Deck.demo('pitr', root => {
    const HOURS = 7 * 24, INCIDENT = 5 * 24 + 15; // Saturday 15:00, week starts Monday 00:00
    const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const WAL_GB_H = 4, REPLAY_GB_H = 120;
    const slider = h('input', { type: 'range', min: 0, max: HOURS - 6, value: INCIDENT - 1, 'aria-label': 'Момент восстановления' });
    const dailyIn = h('input', { type: 'checkbox', checked: true });
    const line = h('div', { class: 'pt-line' });
    const out = h('div', { class: 'pt-out' });
    const verdict = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('label', { class: 'toggle' }, dailyIn, h('span', null, 'полный бэкап каждую ночь (иначе — раз в неделю, в понедельник)')),
      line,
      h('label', { class: 'slider' }, h('span', { class: 'label' }, 'Восстановить на момент'), slider),
      out, verdict,
    );
    [slider, dailyIn].forEach(el => el.addEventListener('input', update));
    const when = hr => `${DAYS[Math.floor(hr / 24)]} ${String(Math.floor(hr % 24)).padStart(2, '0')}:00`;

    function update() {
      const target = +slider.value;
      const backups = dailyIn.checked ? Array.from({ length: 7 }, (_, d) => d * 24 + 2) : [2];
      const base = [...backups].reverse().find(b => b <= target);
      const pos = hr => (hr / HOURS) * 100;
      line.innerHTML = `<span class="pt-wal"></span>` +
        DAYS.map((d, i) => `<span class="pt-day" style="left:${pos(i * 24)}%">${d}</span>`).join('') +
        backups.map(b => `<span class="pt-bk ${b === base ? 'used' : ''}" style="left:${pos(b)}%" title="бэкап"></span>`).join('') +
        (base != null ? `<span class="pt-replay" style="left:${pos(base)}%;width:${pos(target - base)}%"></span>` : '') +
        `<span class="pt-inc" style="left:${pos(INCIDENT)}%"><b>DROP TABLE</b></span>` +
        `<span class="pt-target" style="left:${pos(target)}%"></span>`;
      if (base == null) {
        out.innerHTML = '';
        verdict.textContent = 'Раньше первого бэкапа восстановиться нельзя.';
        verdict.className = 'log bad';
        return;
      }
      const hoursWal = target - base;
      const minutes = Math.round((hoursWal * WAL_GB_H / REPLAY_GB_H) * 60);
      out.innerHTML = `<div class="stats"><div class="stat"><b>${when(base)}</b><span>берём бэкап</span></div>` +
        `<div class="stat"><b>${hoursWal} ч</b><span>журнала проиграть (${hoursWal * WAL_GB_H} ГБ)</span></div>` +
        `<div class="stat ${minutes > 60 ? 'warn' : ''}"><b>${minutes < 60 ? minutes + ' мин' : dec(minutes / 60) + ' ч'}</b><span>на проигрывание</span></div></div>`;
      if (target >= INCIDENT) {
        verdict.textContent = `${when(target)} — уже после DROP TABLE: таблицы в восстановленной базе нет. Сдвиньте раньше.`;
        verdict.className = 'log bad';
      } else {
        const loss = INCIDENT - target;
        verdict.textContent = `Таблица на месте. Изменения после ${when(target)} в восстановленной копии не будет — ${loss} ч. Поэтому обычно восстанавливают копию рядом и переносят из неё только удалённую таблицу.`;
        verdict.className = 'log ok';
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- symptoms → causes
  Deck.demo('symptoms', root => {
    const S = [
      ['FATAL: sorry, too many clients already',
        'Кончились соединения: max_connections исчерпан. Часто большинство соединений просто простаивает в пулах приложений.',
        "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;",
        'Поставить PgBouncer, уменьшить пулы в приложениях. Не поднимать max_connections до тысяч — каждый процесс стоит памяти.'],
      ['Таблица растёт, хотя строк столько же; запросы медленнее',
        'Раздувание: autovacuum не успевает или его держит долгая транзакция, idle in transaction, забытый слот репликации или hot_standby_feedback.',
        "SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables ORDER BY n_dead_tup DESC;",
        'Найти и закрыть долгие транзакции, настроить autovacuum для горячих таблиц, сжать таблицу через pg_repack.'],
      ['Каждые несколько минут — всплеск задержек и записи на диск',
        'Контрольные точки: за раз сбрасывается много грязных страниц, плюс поток полных страниц в WAL после каждой точки.',
        "-- log_checkpoints = on, затем смотреть лог\nSELECT * FROM pg_stat_checkpointer;",
        'Увеличить max_wal_size и checkpoint_timeout, checkpoint_completion_target = 0.9, проверить, что диск тянет запись.'],
      ['После деплоя миграции встали все запросы к таблице',
        'Очередь блокировок: ALTER ждёт долгий запрос, а все новые запросы ждут ALTER.',
        "SELECT pid, wait_event_type, query FROM pg_stat_activity WHERE wait_event_type = 'Lock';",
        'Миграции с lock_timeout и повтором, без долгих транзакций рядом. Тяжёлые изменения — неблокирующими способами (CREATE INDEX CONCURRENTLY).'],
      ['Один запрос внезапно стал в 100 раз медленнее',
        'Поменялся план: устарела статистика, данные стали распределены иначе, или план для одних параметров плох для других.',
        "EXPLAIN (ANALYZE, BUFFERS) SELECT …;",
        'Сравнить ожидаемое и реальное число строк, выполнить ANALYZE, добавить подходящий индекс или расширенную статистику.'],
      ['Коммиты медленные, хотя нагрузка небольшая',
        'Каждый коммит ждёт fsync журнала. Медленный диск или синхронная реплика далеко по сети.',
        "SELECT * FROM pg_stat_wal;",
        'Быстрый диск под WAL, группировать изменения в транзакции. Для некритичных данных — synchronous_commit = off.'],
      ['Диск заполнился, Postgres остановился',
        'Растёт pg_wal: не работает archive_command или неактивный слот репликации держит журнал для пропавшей реплики.',
        "SELECT slot_name, active, wal_status FROM pg_replication_slots;",
        'Мониторить размер pg_wal и ошибки архивации, удалять мёртвые слоты, ограничить max_slot_wal_keep_size.'],
      ['Пользователь сохранил данные и не видит их после обновления страницы',
        'Чтение ушло на реплику, которая отстаёт от primary.',
        "SELECT application_name, replay_lag FROM pg_stat_replication;",
        'Читать свои только что записанные данные с primary, мониторить отставание, не отправлять на реплики критичные чтения.'],
    ];
    const list = h('div', { class: 'sy-list' });
    const detail = h('div', { class: 'sy-detail', 'aria-live': 'polite' });
    const btns = S.map(([sym], i) => h('button', { class: 'sy-btn', onclick: () => show(i) }, sym));
    list.append(...btns);
    root.append(list, detail);
    function show(i) {
      const [sym, cause, check, fix] = S[i];
      btns.forEach((b, j) => b.classList.toggle('sel', i === j));
      detail.innerHTML = `<b>${sym}</b><div class="label">Причина</div><p>${cause}</p><div class="label">Как проверить</div>` +
        `<pre class="code mini"><code>${Deck.highlight(check, 'sql')}</code></pre><div class="label">Что делать</div><p>${fix}</p>`;
    }
    show(0);
    return {};
  });
})();

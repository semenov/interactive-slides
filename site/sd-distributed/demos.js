// Demos for slides 3–11: partial failure, timeouts, retry storm, idempotency, circuit breaker, bulkheads, delivery semantics.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const ms = v => v >= 1000 ? dec(v / 1000, v % 1000 ? 1 : 0) + ' с' : Math.round(v) + ' мс';

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  // Deterministic PRNG so that charts are stable between visits.
  function rng(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function choice(root, items, val, onChange) {
    const box = h('div', { class: 'controls seg', role: 'group' });
    const btns = items.map(([v, label]) => {
      const b = h('button', { class: 'btn small' + (v === val ? ' sel' : ''), onclick: () => { set(v); onChange(v); } }, label);
      b.dataset.v = v;
      box.append(b);
      return b;
    });
    function set(v) { btns.forEach(b => b.classList.toggle('sel', b.dataset.v === String(v))); }
    root.append(box);
    return { el: box, set };
  }
  const stat = (b, s, cls = '') => `<div class="stat ${cls}"><b>${b}</b><span>${s}</span></div>`;

  // ---------------------------------------------------------------- partial failure
  Deck.demo('partial', root => {
    const TIMEOUT = 2;
    const SC = {
      ok: { label: 'Всё хорошо' },
      reqLost: { label: 'Потерялся запрос' },
      respLost: { label: 'Потерялся ответ' },
      slow: { label: 'Сервер тормозит' },
      random: { label: 'Случайно' },
    };
    let scenario = 'ok', req = null, seen = { ok: 0, to: 0, toCharged: 0 }, charged = 0, wanted = 0;
    const rand = rng(7);
    choice(root, Object.entries(SC).map(([k, v]) => [k, v.label]), scenario, v => { scenario = v; });
    const sendBtn = h('button', { class: 'btn primary', onclick: send }, 'Списать 1000 ₽');
    root.append(h('div', { class: 'controls' }, sendBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')));
    const cliState = h('div', { class: 'pf-state' });
    const cliBar = h('span', { class: 'fill' });
    const srvState = h('div', { class: 'pf-state' });
    const srvCount = h('div', { class: 'pf-big' });
    const dot = h('i', { class: 'pf-dot' });
    const lostMark = h('b', { class: 'pf-lost' }, '×');
    root.append(h('div', { class: 'pf-lane' },
      h('div', { class: 'pf-box' }, h('span', { class: 'label' }, 'Клиент'), cliState,
        h('div', { class: 'pf-timer' }, h('span', { class: 'track' }, cliBar), h('small', null, 'таймаут 2 с'))),
      h('div', { class: 'pf-wire' }, dot, lostMark),
      h('div', { class: 'pf-box' }, h('span', { class: 'label' }, 'Сервер платежей'), srvState, srvCount)));
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(stats, logEl);

    function reset() {
      req = null; seen = { ok: 0, to: 0, toCharged: 0 }; charged = 0; wanted = 0;
      say('Клиент отправляет «списать 1000 ₽» и ждёт ответ не дольше 2 секунд.');
      render();
    }
    function send() {
      if (req) return;
      let kind = scenario;
      if (kind === 'random') {
        const r = rand();
        kind = r < 0.55 ? 'ok' : r < 0.7 ? 'reqLost' : r < 0.85 ? 'respLost' : 'slow';
      }
      wanted++;
      req = { kind, t: 0, proc: kind === 'slow' ? 2.6 : 0.3, client: 'wait', server: 'idle', done: false, hidden: scenario === 'random' };
      say('Запрос отправлен. Клиент ждёт…');
    }
    function step(dt) {
      if (!req) return;
      const r = req;
      r.t += dt;
      const arrive = 0.5, done = arrive + r.proc, back = done + 0.5;
      if (r.kind !== 'reqLost' && r.t >= arrive && r.server === 'idle') r.server = 'work';
      if (r.server === 'work' && r.t >= done) {
        r.server = 'done';
        charged++;
        if (r.client === 'timeout' && !r.hidden) say(`Сервер закончил через ${dec(done)} с и списал деньги. Клиент об этом не знает: он сдался на 2-й секунде.`, 'bad');
      }
      if (r.client === 'wait' && (r.kind === 'ok') && r.t >= back) {
        r.client = 'ok';
        seen.ok++;
        say(`200 OK через ${dec(back)} с. Деньги списаны, клиент знает об этом.`, 'ok');
      }
      if (r.client === 'wait' && r.t >= TIMEOUT) {
        r.client = 'timeout';
        seen.to++;
        const truth = {
          reqLost: 'На самом деле запрос не дошёл — денег не списали.',
          respLost: 'На самом деле сервер всё выполнил, потерялся только ответ — деньги списаны.',
          slow: 'На самом деле сервер ещё работает и спишет деньги позже.',
        }[r.kind];
        say(`Таймаут. Клиент не знает, что произошло. ${r.hidden ? 'Что случилось на самом деле, узнаем через секунду-другую.' : truth}`, r.kind === 'reqLost' ? 'warn' : 'bad');
      }
      const end = r.kind === 'ok' || r.kind === 'slow' ? back : TIMEOUT;
      if (r.t >= end + 0.2) {
        if (r.client === 'timeout' && r.server === 'done') seen.toCharged++;
        if (r.hidden && r.client === 'timeout') {
          say({ reqLost: 'Раскроем карты: запрос потерялся по дороге, списания не было.',
            respLost: 'Раскроем карты: сервер списал деньги, потерялся ответ.',
            slow: 'Раскроем карты: сервер тормозил и списал деньги уже после таймаута.' }[r.kind], r.kind === 'reqLost' ? 'warn' : 'bad');
        }
        req = null;
      }
    }
    function render() {
      const r = req;
      sendBtn.disabled = !!r;
      let x = null, back = false, lost = null;
      if (r) {
        const arrive = 0.5, done = arrive + r.proc;
        if (r.t < arrive) {
          x = r.t / arrive;
          if (r.kind === 'reqLost' && x > 0.5) { lost = 0.5; x = null; }
        } else if (r.kind === 'reqLost') lost = 0.5;
        else if (r.t >= done && r.t < done + 0.5) {
          x = 1 - (r.t - done) / 0.5; back = true;
          if (r.kind === 'respLost' && x < 0.5) { lost = 0.5; x = null; }
        } else if (r.kind === 'respLost' && r.t >= done) lost = 0.5;
      }
      dot.style.display = x == null ? 'none' : '';
      if (x != null) { dot.style.left = (x * 100) + '%'; dot.classList.toggle('back', back); }
      lostMark.style.display = lost == null ? 'none' : '';
      cliState.textContent = !r ? 'готов' : r.client === 'wait' ? 'ждёт ответ…' : r.client === 'ok' ? '200 OK' : 'таймаут: ???';
      cliState.className = 'pf-state ' + (r ? r.client : '');
      cliBar.style.width = r ? Math.min(100, r.t / TIMEOUT * 100) + '%' : '0';
      cliBar.parentNode.classList.toggle('over', !!r && r.t >= TIMEOUT);
      const sv = !r ? 'ждёт запросов' : r.server === 'idle' ? (r.kind === 'reqLost' && r.t > 0.5 ? 'запроса не видел' : 'ждёт запросов') : r.server === 'work' ? 'списывает…' : 'списал';
      srvState.textContent = r && r.hidden && r.client !== 'ok' && r.t < 2.2 ? '?' : sv;
      srvState.className = 'pf-state ' + (r ? r.server : '');
      srvCount.innerHTML = `списано: <b>${charged}</b> из ${wanted}`;
      stats.innerHTML = stat(seen.ok, 'клиент видел 200 OK', '') +
        stat(seen.to, plural(seen.to, ['таймаут', 'таймаута', 'таймаутов']) + ' у клиента', seen.to ? 'warn' : '') +
        stat(seen.toCharged, 'из таймаутов деньги всё же списаны', seen.toCharged ? 'warn' : '');
    }
    reset();
    const loop = rafLoop(dt => { step(dt); render(); });
    return loop;
  });

  // ---------------------------------------------------------------- choosing a timeout
  Deck.demo('timeouts', root => {
    const N = 20000;
    const r = rng(42);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    const healthy = [], degraded = [];
    for (let i = 0; i < N; i++) {
      // 96% — обычные ответы (медиана 40 мс), 4% — медленный хвост: GC, холодный кэш, ретрансмиты.
      const base = r() < 0.96 ? 40 * Math.exp(0.5 * gauss()) : 250 * Math.exp(0.7 * gauss());
      healthy.push(base);
      degraded.push(r() < 0.03 ? 30000 : base * 8);
    }
    healthy.sort((a, b) => a - b);
    degraded.sort((a, b) => a - b);
    const TO = [50, 100, 200, 300, 500, 800, 1000, 2000, 5000, 10000, 30000];
    const RPS = 200, POOL = 50;
    let bad = false;
    const input = h('input', { type: 'range', min: 0, max: TO.length - 1, value: 6, 'aria-label': 'Таймаут' });
    const out = h('output');
    const deg = h('input', { type: 'checkbox' });
    input.addEventListener('input', update);
    deg.addEventListener('change', () => { bad = deg.checked; update(); });
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Таймаут'), input, out),
      h('label', { class: 'toggle' }, deg, h('span', null, 'Зависимость деградировала: в 8 раз медленнее, 3% запросов зависают')));
    const hist = h('div', { class: 'to-hist' });
    const axis = h('div', { class: 'to-axis' });
    const pct = h('div', { class: 'to-pct' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'to-chart' }, hist, axis), pct, stats, logEl);
    const LO = Math.log10(5), HI = Math.log10(40000), BINS = 40;
    const pos = v => (Math.log10(v) - LO) / (HI - LO) * 100;
    axis.innerHTML = [10, 100, 1000, 10000].map(v => `<span style="left:${pos(v)}%">${ms(v)}</span>`).join('');
    const bars = [];
    for (let i = 0; i < BINS; i++) { const b = h('i'); bars.push(b); hist.append(b); }
    const mark = h('b', { class: 'to-mark' });
    hist.append(mark);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];

    function update() {
      const t = TO[+input.value];
      const noTo = t === 30000;
      out.textContent = noTo ? 'нет (30 с)' : ms(t);
      const data = bad ? degraded : healthy;
      const counts = Array(BINS).fill(0);
      for (const v of data) counts[Math.max(0, Math.min(BINS - 1, Math.floor(pos(v) / 100 * BINS)))]++;
      const max = Math.max(...counts);
      counts.forEach((c, i) => {
        const left = 10 ** (LO + (i + 0.5) / BINS * (HI - LO));
        bars[i].style.height = c ? Math.max(2, Math.sqrt(c / max) * 100) + '%' : '0';
        bars[i].className = left > t ? 'cut' : '';
      });
      mark.style.left = pos(t) + '%';
      pct.innerHTML = `p50 <b>${ms(q(data, 0.5))}</b> · p99 <b>${ms(q(data, 0.99))}</b> · p99,9 <b>${ms(q(data, 0.999))}</b>`;
      let cut = 0, sum = 0;
      for (const v of data) { if (v > t) cut++; sum += Math.min(v, t); }
      const cutPct = cut / data.length * 100;
      const threads = RPS * sum / data.length / 1000;
      stats.innerHTML = stat((cutPct < 0.1 && cutPct > 0 ? '&lt;0,1' : dec(cutPct, cutPct < 10 ? 1 : 0)) + '%', 'запросов оборвёт таймаут', cutPct > 1 ? 'warn' : '') +
        stat(dec(threads, threads < 10 ? 1 : 0), `потоков занято при ${RPS} rps`, threads > POOL ? 'warn' : '') +
        stat(noTo ? '30 с' : ms(t), 'дольше никто не ждёт', '');
      if (threads > POOL) say(`Пул из ${POOL} потоков не выдержит: нужно ${fmt(threads)}. Запросы встанут в очередь, сервис перестанет отвечать всем — каскадный отказ. Короткий таймаут ограничивает ущерб.`, 'bad');
      else if (cutPct > 1) say(`Таймаут обрывает ${dec(cutPct)}% запросов, которые завершились бы нормально. Каждый станет ошибкой или ретраем — то есть дополнительной нагрузкой.`, 'warn');
      else if (bad) say(`Зависимость тормозит, но таймаут держит ущерб в рамках: часть запросов падает быстро, потоки не кончаются.`, 'warn');
      else say(`Таймаут выше p99,9 — нормальные ответы почти не обрываются, а зависший вызов держит поток не дольше ${noTo ? '30 с' : ms(t)}.`, 'ok');
    }
    const say = logger(logEl, 1);
    update();
    return {};
  });

  // ---------------------------------------------------------------- retry storm
  Deck.demo('storm', root => {
    const CLIENTS = 1000, CAP = 200, QMAX = 100, SPAN = 40, BUCKET = 0.5, SPEED = 4, STEP = 0.01;
    const BUCKETS = SPAN / BUCKET, YMAX = 1000;
    let policy = 'fixed', outage = 5, sim = null;
    const POL = { fixed: 'Раз в секунду', exp: 'Экспонента', jitter: 'Экспонента + джиттер' };
    choice(root, Object.entries(POL), policy, v => { policy = v; run(); });
    const oIn = h('input', { type: 'range', min: 2, max: 10, value: outage, 'aria-label': 'Длительность аварии' });
    const oOut = h('output', null, outage + ' с');
    oIn.addEventListener('input', () => { outage = +oIn.value; oOut.textContent = outage + ' с'; });
    oIn.addEventListener('change', run);
    root.append(h('div', { class: 'controls' },
      h('label', { class: 'slider inline st-sl' }, h('span', { class: 'label' }, 'Авария'), oIn, oOut),
      h('button', { class: 'btn primary', onclick: run }, 'Запустить')));
    const chart = h('div', { class: 'st-chart' });
    const capLine = h('b', { class: 'st-cap' }, h('span', null, `ёмкость ${CAP} rps`));
    const down = h('i', { class: 'st-down' });
    const now = h('i', { class: 'st-now' });
    const bars = [];
    for (let i = 0; i < BUCKETS; i++) {
      const ok = h('span', { class: 'ok' }), rej = h('span', { class: 'rej' }), over = h('em');
      const b = h('div', { class: 'st-bar' }, rej, ok, over);
      bars.push({ ok, rej, over });
      chart.append(b);
    }
    chart.append(down, capLine, now);
    capLine.style.bottom = (CAP / YMAX * 100) + '%';
    const axis = h('div', { class: 'st-axis' }, ...[0, 10, 20, 30, 40].map(s => h('span', { style: `left:${s / SPAN * 100}%` }, s + ' с')));
    const legend = h('div', { class: 'bl-legend' }, h('span', { class: 'sw okc' }), 'обслужено', h('span', { class: 'sw rejc' }), 'отбито (503)', h('span', { class: 'sw downc' }), 'сервер лежит');
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    root.append(h('div', { class: 'st-wrap' }, chart, axis), legend, stats, logEl);

    function delay(attempt, rnd) {
      if (policy === 'fixed') return 1;
      const exp = Math.min(8, 0.5 * 2 ** (attempt - 1)); // 0,5 → 1 → 2 → 4 → 8 с (потолок)
      return policy === 'exp' ? exp : rnd() * exp;
    }
    function run() {
      const rnd = rng(11);
      sim = {
        t: 0, rnd, queue: 0, served: 0, attempts: 0, doneAt: null,
        clients: Array.from({ length: CLIENTS }, () => ({ next: 0, n: 0, done: false })),
        att: Array(BUCKETS).fill(0), ok: Array(BUCKETS).fill(0), credit: 0,
      };
      // t = 0: авария, все запросы падают одновременно и планируют первый ретрай.
      for (const c of sim.clients) { c.n = 1; c.next = delay(1, rnd); }
      sim.attempts = CLIENTS;
      sim.att[0] += CLIENTS;
      down.style.width = (outage / SPAN * 100) + '%';
      say(`t=0: сервер упал, у всех ${fmt(CLIENTS)} клиентов запрос завершился ошибкой. Через ${outage} с сервер вернётся с ёмкостью ${CAP} rps и очередью на ${QMAX} запросов.`);
      render();
    }
    function tick() {
      const s = sim;
      s.t += STEP;
      const b = Math.min(BUCKETS - 1, Math.floor(s.t / BUCKET));
      const up = s.t >= outage;
      if (up) {
        s.credit += CAP * STEP;
        const k = Math.min(s.queue, Math.floor(s.credit));
        s.queue -= k; s.credit -= k; s.served += k; s.ok[b] += k;
        if (s.queue === 0) s.credit = Math.min(s.credit, 1);
      }
      const due = s.clients.filter(c => !c.done && c.next <= s.t);
      for (let i = due.length - 1; i > 0; i--) { const j = Math.floor(s.rnd() * (i + 1)); [due[i], due[j]] = [due[j], due[i]]; }
      for (const c of due) {
        s.attempts++;
        s.att[b]++;
        if (up && s.queue < QMAX) { s.queue++; c.done = true; continue; }
        c.n++;
        c.next = s.t + delay(c.n, s.rnd);
      }
      if (s.doneAt == null && s.served >= CLIENTS) {
        s.doneAt = s.t;
        const after = s.t - outage;
        const tail = policy === 'jitter' ? ' Ретраи размазаны по времени: нагрузка держится около ёмкости, сервер не простаивает и почти ничего не отбивает.'
          : ' Но каждую секунду все ожидающие приходят разом: сервер отбивает почти всю волну, а между волнами простаивает.';
        say(`Все запросы обслужены через ${dec(after)} с после восстановления, ${fmt(s.attempts)} ${plural(s.attempts, ['попытка', 'попытки', 'попыток'])} на ${fmt(CLIENTS)} запросов.${tail}`,
          policy === 'jitter' ? 'ok' : 'warn');
      }
    }
    function render() {
      const s = sim;
      let peak = 0;
      for (let i = 0; i < BUCKETS; i++) {
        const rps = s.att[i] / BUCKET, okr = s.ok[i] / BUCKET;
        if (i * BUCKET >= outage && i * BUCKET < s.t) peak = Math.max(peak, rps);
        const show = Math.min(rps, YMAX);
        const okH = Math.min(okr, show);
        bars[i].ok.style.height = (okH / YMAX * 100) + '%';
        bars[i].rej.style.height = (Math.max(0, show - okH) / YMAX * 100) + '%';
        bars[i].over.textContent = rps > YMAX ? '▲' : '';
        bars[i].over.title = rps > YMAX ? fmt(rps) + ' rps' : '';
      }
      now.style.left = Math.min(100, s.t / SPAN * 100) + '%';
      const waiting = CLIENTS - s.served;
      stats.innerHTML = stat(dec(peak / CAP, peak / CAP < 10 ? 1 : 0) + '×', 'пик после подъёма, от ёмкости', peak > CAP * 2 ? 'warn' : '') +
        stat(fmt(s.attempts), 'попыток всего', '') +
        stat(s.doneAt != null ? dec(s.doneAt - outage) + ' с' : fmt(waiting), s.doneAt != null ? 'до полного разбора после подъёма' : 'запросов ещё ждут', s.doneAt == null && s.t >= SPAN ? 'warn' : '');
    }
    let acc = 0;
    const loop = rafLoop(dt => {
      if (!sim || sim.t >= SPAN) return;
      acc += dt * SPEED;
      while (acc >= STEP && sim.t < SPAN) { tick(); acc -= STEP; }
      if (sim.t >= SPAN && sim.doneAt == null) {
        say(`За ${SPAN} с так и не разобрались: ждут ещё ${fmt(CLIENTS - sim.served)}. Все ретраят в одни и те же моменты: сервер получает волну, берёт ${QMAX} в очередь, остальное отбивает и потом простаивает до следующей волны.`, 'bad');
      }
      render();
    });
    run();
    return loop;
  });

  // ---------------------------------------------------------------- idempotency key
  Deck.demo('idem', root => {
    let useKey = false, lose = true, op = 0, key = null, payments = [], keys = [], intents = 0;
    const kIn = h('input', { type: 'checkbox' });
    const lIn = h('input', { type: 'checkbox', checked: true });
    kIn.addEventListener('change', () => { useKey = kIn.checked; reset(); });
    lIn.addEventListener('change', () => { lose = lIn.checked; });
    root.append(
      h('label', { class: 'toggle' }, kIn, h('span', null, 'Клиент шлёт ', h('code', null, 'Idempotency-Key'))),
      h('label', { class: 'toggle' }, lIn, h('span', null, 'Первый ответ теряется в сети')),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: pay }, 'Оплатить 1000 ₽'),
        h('button', { class: 'btn', onclick: retry }, 'Повторить запрос'),
        h('button', { class: 'btn', onclick: dbl }, 'Двойной клик'),
        h('button', { class: 'btn', onclick: reset }, 'Сброс')));
    const cli = h('div', { class: 'id-cli' });
    const payT = h('div', { class: 'id-rows' });
    const keyT = h('div', { class: 'id-rows' });
    const keyBox = h('div', { class: 'id-tbl' }, h('span', { class: 'label' }, 'idem_keys'), keyT);
    const stats = h('div', { class: 'stats two' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(cli, h('div', { class: 'id-db' }, h('div', { class: 'id-tbl' }, h('span', { class: 'label' }, 'payments'), payT), keyBox), stats, logEl);
    const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');

    function reset() {
      op = 0; key = null; payments = []; keys = []; intents = 0;
      say(useKey ? 'Клиент создаёт ключ на каждую операцию и шлёт его со всеми повторами.' : 'Ключа нет: сервер не может отличить повтор от новой оплаты.');
      render();
    }
    function charge() { payments.push({ op, key }); }
    // Server side. Returns HTTP status as the server sends it.
    function handle(concurrentKey) {
      if (!useKey) { charge(); return '200'; }
      const row = keys.find(k => k.key === key);
      if (row && row.status === 'done') return '200*';
      if (row && row.status === 'processing') return '409';
      if (!concurrentKey) { keys.push({ key, status: 'done' }); charge(); return '200'; }
      keys.push({ key, status: 'processing' });
      return 'hold';
    }
    function pay() {
      op++; intents++;
      key = 'k-' + hex();
      const res = handle();
      if (lose) {
        say(`Операция №${op}: сервер списал 1000 ₽, но ответ потерялся. Клиент видит таймаут и не знает, прошла ли оплата.`, 'warn');
      } else say(`Операция №${op}: 200 OK, списано 1000 ₽.`, 'ok');
      render();
      return res;
    }
    function retry() {
      if (!op) { say('Сначала оплатите.', 'warn'); return; }
      const res = handle();
      if (res === '200*') say(`Повтор с ключом <code>${key}</code>: ключ уже есть со статусом done — сервер вернул сохранённый ответ. Второго списания нет.`, 'ok');
      else if (useKey) say(`Повтор: 200 OK.`, 'ok');
      else say(`Повтор без ключа: сервер видит обычный новый запрос и списывает ещё 1000 ₽. Пользователь заплатил дважды.`, 'bad');
      render();
    }
    function dbl() {
      op++; intents++;
      key = 'k-' + hex();
      if (!useKey) {
        handle(); handle();
        say(`Двойной клик: два одинаковых запроса, два списания.`, 'bad');
      } else {
        handle(true); // first one inserts the key with status processing
        const second = handle();
        keys.find(k => k.key === key).status = 'done';
        charge();
        say(`Двойной клик: первый запрос вставил ключ (processing) и списывает. Второй упёрся в уникальный ключ — сервер ответил ${second === '409' ? '409 Conflict' : second}. Списание одно.`, 'ok');
      }
      render();
    }
    function render() {
      const n = payments.length;
      cli.innerHTML = op ? `Операция №${op}${useKey ? `, ключ <code>${key}</code>` : ''}` : '<span class="empty">Операций ещё не было</span>';
      const chips = (list, f) => list.length ? list.slice(-8).map(f).join('') + (list.length > 8 ? `<span class="more">+${list.length - 8}</span>` : '') : '<span class="empty">пусто</span>';
      const dupOps = new Set(payments.map(p => p.op).filter((o, i, a) => a.indexOf(o) !== i));
      payT.innerHTML = chips(payments, p => `<span class="id-row ${dupOps.has(p.op) ? 'dup' : ''}">1000 ₽ · оп. ${p.op}</span>`);
      keyT.innerHTML = chips(keys, k => `<span class="id-row key"><code>${k.key}</code> ${k.status}</span>`);
      keyBox.classList.toggle('off', !useKey);
      stats.innerHTML = stat(fmt(intents * 1000) + ' ₽', 'хотел заплатить пользователь') +
        stat(fmt(n * 1000) + ' ₽', 'списано', n > intents ? 'warn' : '');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- circuit breaker
  Deck.demo('breaker', root => {
    const RPS = 10, WIN = 20, MINCALLS = 10, THRESH = 0.5, OPEN_FOR = 5, PROBES = 3, CALL_TO = 1, HIST = 40;
    let dep = 'ok', st, t, nextReq, win, hist, inflight, openUntil, probesSent, probesOk, fastFails;
    choice(root, [['ok', 'Зависимость здорова'], ['half', '50% ошибок'], ['down', 'Лежит (таймауты)']], dep, v => {
      dep = v;
      say({ ok: 'Зависимость починили.', half: 'Половина вызовов зависимости падает.', down: 'Зависимость лежит: каждый вызов ждёт таймаута 1 с и падает.' }[v], v === 'ok' ? '' : 'warn');
    });
    const states = ['closed', 'open', 'half'];
    const stEls = {};
    const sm = h('div', { class: 'cb-sm' });
    states.forEach((s, i) => {
      stEls[s] = h('div', { class: 'cb-st ' + s }, h('b', null, { closed: 'CLOSED', open: 'OPEN', half: 'HALF-OPEN' }[s]),
        h('small', null, { closed: 'вызовы идут', open: 'ошибка сразу', half: 'пробные вызовы' }[s]));
      sm.append(stEls[s]);
      if (i < 2) sm.append(h('span', { class: 'cb-arr' }, '→'));
    });
    const timer = h('div', { class: 'cb-timer' });
    const rateFill = h('span', { class: 'fill' });
    const rateTxt = h('span', { class: 'cb-rate' });
    const strip = h('div', { class: 'cb-strip' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(sm, timer,
      h('div', { class: 'cb-win' }, h('span', { class: 'label' }, `ошибки в окне ${WIN}`), h('span', { class: 'track cb-track' }, rateFill, h('i', { class: 'cb-th' })), rateTxt),
      h('div', null, h('span', { class: 'label' }, 'последние запросы'), strip),
      h('div', { class: 'bl-legend' }, h('span', { class: 'sw okc' }), 'успех', h('span', { class: 'sw rejc' }), 'ошибка', h('span', { class: 'sw fastc' }), 'отбит сразу', h('span', { class: 'sw probec' }), 'пробный'),
      stats, logEl);

    function reset() {
      st = 'closed'; t = 0; nextReq = 0; win = []; hist = []; inflight = []; openUntil = 0; probesSent = 0; probesOk = 0; fastFails = 0;
    }
    function record(ok) {
      win.push(ok);
      if (win.length > WIN) win.shift();
    }
    const rate = () => win.length ? win.filter(x => !x).length / win.length : 0;
    function toOpen(why) {
      st = 'open'; openUntil = t + OPEN_FOR; probesSent = 0; probesOk = 0;
      say(why + ` Предохранитель разомкнулся на ${OPEN_FOR} с: вызовов зависимости нет, клиенты получают ошибку сразу.`, 'bad');
    }
    function finish(c, ok) {
      c.ok = ok;
      c.h.cls = c.probe ? 'probe ' + (ok ? 'ok' : 'fail') : ok ? 'ok' : 'fail';
      if (c.probe) {
        if (st !== 'half') return;
        if (!ok) { toOpen('Пробный вызов упал.'); return; }
        if (++probesOk >= PROBES) { st = 'closed'; win = []; say(`${PROBES} пробных вызова прошли — предохранитель замкнулся, трафик идёт как обычно.`, 'ok'); }
        return;
      }
      if (st !== 'closed') return;
      record(ok);
      if (win.length >= MINCALLS && rate() >= THRESH) toOpen(`Ошибок ${Math.round(rate() * 100)}% из последних ${win.length} вызовов.`);
    }
    function request() {
      const hEl = { cls: 'wait' };
      hist.push(hEl);
      if (hist.length > HIST) hist.shift();
      if (st === 'open') { hEl.cls = 'fast'; fastFails++; return; }
      let probe = false;
      if (st === 'half') {
        if (probesSent >= PROBES) { hEl.cls = 'fast'; fastFails++; return; }
        probesSent++; probe = true;
      }
      const fail = dep === 'down' || (dep === 'half' && Math.random() < 0.5);
      // Ошибка «сразу» (500) приходит за 50 мс, «лежит» — ждём таймаута.
      const dur = dep === 'down' ? CALL_TO : 0.05;
      inflight.push({ end: t + dur, fail, probe, h: hEl });
    }
    function step(dt) {
      t += dt;
      while (t >= nextReq) { request(); nextReq += 1 / RPS; }
      const done = inflight.filter(c => c.end <= t);
      inflight = inflight.filter(c => c.end > t);
      done.forEach(c => finish(c, !c.fail));
      if (st === 'open' && t >= openUntil) {
        st = 'half'; probesSent = 0; probesOk = 0;
        say(`Прошло ${OPEN_FOR} с — half-open: пропускаем ${PROBES} пробных вызова, остальные пока отбиваем.`, 'warn');
      }
    }
    function render() {
      states.forEach(s => stEls[s].classList.toggle('on', st === s));
      timer.textContent = st === 'open' ? `до half-open: ${dec(Math.max(0, openUntil - t))} с` : st === 'half' ? `пробных: ${probesOk} из ${PROBES} успешны` : ' ';
      const r = rate();
      rateFill.style.width = (st === 'closed' ? r * 100 : 0) + '%';
      rateFill.parentNode.classList.toggle('hot', r >= THRESH);
      rateTxt.textContent = st === 'closed' ? `${Math.round(r * 100)}% из ${win.length}` : 'не считаем';
      strip.innerHTML = hist.map(x => `<i class="${x.cls}"></i>`).join('');
      stats.innerHTML = stat(inflight.length, 'потоков ждут зависимость', inflight.length > 5 ? 'warn' : '') +
        stat(st === 'open' ? 0 : st === 'half' ? '≤' + PROBES : RPS, 'вызовов/с в зависимость', '') +
        stat(fmt(fastFails), 'отбито сразу', '');
    }
    reset();
    say('Зависимость здорова, все вызовы проходят. Сломайте её.');
    const loop = rafLoop(dt => { step(dt); render(); });
    return loop;
  });

  // ---------------------------------------------------------------- bulkheads
  Deck.demo('bulkhead', root => {
    const POOL = 20, RATE = 50, STEP = 0.005, WINDOW = 2;
    let slowC = false, bulk = false, t = 0, workers, nb = 0, nc = 0.01, events = [], verdict = '', changed = 0;
    const sIn = h('input', { type: 'checkbox' });
    const bIn = h('input', { type: 'checkbox' });
    sIn.addEventListener('change', () => {
      slowC = sIn.checked; changed = t;
      say(slowC ? 'C отвечает за 2 с. Смотрите, кто занимает потоки.' : 'C снова отвечает за 50 мс.', slowC ? 'warn' : '');
    });
    bIn.addEventListener('change', () => {
      bulk = bIn.checked; changed = t;
      say(bulk ? `Переборки: на B не больше ${POOL / 2} потоков, на C не больше ${POOL / 2}.` : 'Один общий пул на всех.');
    });
    root.append(
      h('label', { class: 'toggle' }, sIn, h('span', null, 'C тормозит: 2 с вместо 50 мс')),
      h('label', { class: 'toggle' }, bIn, h('span', null, 'Переборки: по 10 потоков на зависимость')));
    const grid = h('div', { class: 'bh-grid' });
    const cells = [];
    for (let i = 0; i < POOL; i++) { const c = h('i'); cells.push(c); grid.append(c); }
    const rows = h('div', { class: 'bh-rows' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('div', null, h('span', { class: 'label' }, `пул сервиса A: ${POOL} потоков`), grid),
      h('div', { class: 'bl-legend' }, h('span', { class: 'sw bc' }), 'ждёт B', h('span', { class: 'sw cc' }), 'ждёт C', h('span', { class: 'sw freec' }), 'свободен'),
      rows, logEl);
    workers = Array(POOL).fill(null);

    function arrive(dep) {
      const lat = dep === 'C' && slowC ? 2 : 0.05;
      const range = bulk ? (dep === 'B' ? [0, POOL / 2] : [POOL / 2, POOL]) : [0, POOL];
      let slot = -1;
      for (let i = range[0]; i < range[1]; i++) if (!workers[i]) { slot = i; break; }
      events.push({ t, dep, ok: slot >= 0 });
      if (slot >= 0) workers[slot] = { dep, end: t + lat };
    }
    function tick() {
      t += STEP;
      for (let i = 0; i < POOL; i++) if (workers[i] && workers[i].end <= t) workers[i] = null;
      if (t >= nb) { arrive('B'); nb += 1 / RATE; }
      if (t >= nc) { arrive('C'); nc += 1 / RATE; }
    }
    function render() {
      events = events.filter(e => e.t > t - WINDOW);
      cells.forEach((c, i) => {
        c.className = workers[i] ? workers[i].dep.toLowerCase() : '';
        c.classList.toggle('split', bulk && i === POOL / 2);
      });
      const pct = d => {
        const list = events.filter(e => e.dep === d);
        return list.length ? Math.round(list.filter(e => e.ok).length / list.length * 100) : 100;
      };
      const pb = pct('B'), pc = pct('C');
      rows.innerHTML = [['B', pb, '50 мс'], ['C', pc, slowC ? '2 с' : '50 мс']].map(([d, p, lat]) =>
        `<div class="bh-row ${p < 90 ? 'bad' : ''}"><b>${d}</b><span class="track"><span class="fill" style="width:${p}%"></span></span><span>${p}% успешно · ${RATE} rps · ${lat}</span></div>`).join('');
      const v = slowC && !bulk && pb < 60 ? 'cascade' : slowC && bulk && t - changed > 2.5 ? 'iso' : !slowC && t - changed > 1 ? 'fine' : verdict;
      if (v !== verdict) {
        verdict = v;
        if (v === 'cascade') say(`B здоров, но его запросы отбиваются: весь пул занят ожиданием C. Для клиентов сервис A лежит целиком.`, "bad");
        if (v === 'iso') say(`C тонет в своём отсеке: 10 потоков / 2 с = 5 rps из 50. B получает свои 10 потоков и работает на 100%.`, 'ok');
        if (v === 'fine' && changed > 0) say('Обе зависимости быстрые: занято около 5 потоков из 20.', 'ok');
      }
    }
    say('Обе зависимости отвечают за 50 мс. Нужно 100 rps × 0,05 с = 5 потоков из 20.');
    let acc = 0;
    return rafLoop(dt => {
      acc += dt;
      while (acc >= STEP) { tick(); acc -= STEP; }
      render();
    });
  });

  // ---------------------------------------------------------------- delivery semantics
  Deck.demo('delivery', root => {
    const MODES = {
      amo: ['ack', 'apply'],
      alo: ['apply', 'ack'],
      eo: ['apply+id', 'ack'],
    };
    let mode = 'alo', msgs, balance, ids, crashed;
    choice(root, [['amo', 'ack → обработка'], ['alo', 'обработка → ack'], ['eo', '+ идемпотентность']], mode, v => { mode = v; reset(); });
    const nextBtn = h('button', { class: 'btn primary', onclick: () => process(false) }, 'Обработать');
    const crashBtn = h('button', { class: 'btn danger', onclick: () => process(true) }, 'Обработать и упасть посередине');
    root.append(h('div', { class: 'controls' }, nextBtn, crashBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')));
    const steps = h('div', { class: 'dl-steps' });
    const queue = h('div', { class: 'dl-q' });
    const db = h('div', { class: 'dl-db' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(steps, h('div', null, h('span', { class: 'label' }, 'очередь'), queue), db, stats, logEl);

    function reset() {
      msgs = Array.from({ length: 6 }, (_, i) => ({ id: 'm' + (i + 1), st: 'ready', applied: 0, redeliv: false }));
      balance = 0; ids = new Set(); crashed = false;
      const desc = { amo: 'At-most-once: сначала подтверждаем, потом начисляем.', alo: 'At-least-once: сначала начисляем, потом подтверждаем.', eo: 'Начисление и запись ID сообщения — в одной транзакции. Потом ack.' }[mode];
      say(desc);
      render();
    }
    const label = s => ({ ack: 'ack брокеру', apply: 'UPDATE balance + 100', 'apply+id': 'BEGIN; balance + 100; INSERT processed(id); COMMIT' }[s]);
    function process(crash) {
      const m = msgs.find(x => x.st === 'ready');
      if (!m) { say('Очередь пуста. Нажмите «Сброс».'); return; }
      const [first, second] = MODES[mode];
      const run = s => {
        if (s === 'ack') { m.st = 'acked'; return ''; }
        if (s === 'apply') { balance += 100; m.applied++; return ''; }
        if (ids.has(m.id)) return 'dup';
        ids.add(m.id); balance += 100; m.applied++; return '';
      };
      const r1 = run(first);
      if (crash) {
        if (m.st !== 'acked') { m.st = 'ready'; m.redeliv = true; }
        const text = {
          amo: `${m.id}: ack отправлен, потребитель упал до начисления. Брокер считает сообщение доставленным — <b>100 ₽ потеряны</b>.`,
          alo: `${m.id}: начислили, упали до ack. Брокер вернёт ${m.id} в очередь, и после рестарта его обработают снова.`,
          eo: r1 === 'dup' ? `${m.id}: уже было в processed — пропустили, упали до ack. Сообщение придёт ещё раз.` : `${m.id}: транзакция закоммичена вместе с ID, упали до ack. Сообщение придёт снова.`,
        }[mode];
        say(text, mode === 'amo' ? 'bad' : 'warn');
        render();
        return;
      }
      const r2 = run(second);
      const dup = r1 === 'dup' || r2 === 'dup';
      if (dup) say(`${m.id} пришло повторно: ID уже есть в processed, начисление пропущено, ack. Баланс верный.`, 'ok');
      else if (m.applied > 1) say(`${m.id} пришло повторно и начислено второй раз: <b>+100 ₽ лишних</b>. Потребитель не отличает повтор.`, 'bad');
      else say(`${m.id}: ${label(first)} → ${label(second)}.`, '');
      render();
    }
    function render() {
      const [a, b] = MODES[mode];
      steps.innerHTML = `<span class="dl-step">1. ${label(a)}</span><span class="dl-crash">«упасть посередине» — здесь</span><span class="dl-step">2. ${label(b)}</span>`;
      queue.innerHTML = msgs.map(m => `<span class="dl-m ${m.st}${m.redeliv && m.st === 'ready' ? ' again' : ''}">${m.id}${m.applied > 1 ? `<sup>×${m.applied}</sup>` : m.st === 'acked' && !m.applied ? '<sup>×0</sup>' : ''}</span>`).join('');
      const handled = msgs.filter(m => m.st === 'acked').length;
      db.innerHTML = `<span><span class="label">balance</span> <b>${fmt(balance)} ₽</b></span>` +
        (mode === 'eo' ? `<span><span class="label">processed</span> <code>${ids.size ? [...ids].join(', ') : '∅'}</code></span>` : '');
      const exp = msgs.filter(m => m.st === 'acked' || m.applied).length * 100;
      stats.innerHTML = stat(handled, 'подтверждено (ack)') +
        stat(fmt(exp) + ' ₽', 'должно быть начислено') +
        stat(fmt(balance) + ' ₽', 'на балансе', balance !== exp ? 'warn' : '');
      nextBtn.disabled = crashBtn.disabled = !msgs.some(m => m.st === 'ready');
    }
    reset();
    return {};
  });
})();

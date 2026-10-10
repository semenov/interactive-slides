// Demos for slides 17–19: socket API in the kernel, accept queue, ephemeral ports and TIME_WAIT.
(() => {
  'use strict';
  const { h, highlight, plural, rafLoop } = Deck;
  const { logger, fmt, dec } = Net;

  // ---------------------------------------------------------------- socket API step by step
  Deck.demo('sockapi', root => {
    const CODE = [
      's = socket.socket(AF_INET, SOCK_STREAM)',
      's.bind(("0.0.0.0", 8080))',
      's.listen(128)',
      'conn, addr = s.accept()',
      'data = conn.recv(4096)',
      'conn.sendall(response)',
      'conn.close()',
    ];
    // [code line or -1 for client, syscall/strace line, text, state]
    const S = [
      [0, 'socket(AF_INET, SOCK_STREAM, IPPROTO_TCP) = 3', 'Ядро создаёт структуру сокета и возвращает номер дескриптора — как для файла. Адреса ещё нет.', { addr: '—', st: 'CLOSED' }],
      [1, 'bind(3, {0.0.0.0:8080}) = 0', 'Сокет получает адрес. Порт уже занят — <code>EADDRINUSE</code>; после рестарта мешают старые соединения, поэтому серверы ставят <code>SO_REUSEADDR</code>.', { addr: '0.0.0.0:8080', st: 'CLOSED' }],
      [2, 'listen(3, 128) = 0', 'Сокет становится слушающим. Ядро заводит две очереди: полуоткрытых соединений (SYN) и готовых к accept. С этого момента рукопожатия идут без вашего кода.', { addr: '0.0.0.0:8080', st: 'LISTEN', q: true }],
      [-1, 'клиент: connect() → SYN', 'Пришёл SYN. Ядро отвечает SYN-ACK и запоминает полуоткрытое соединение в очереди SYN.', { addr: '0.0.0.0:8080', st: 'LISTEN', q: true, syn: 1 }],
      [-1, 'клиент: ACK', 'Пришёл последний ACK — соединение установлено и ждёт в очереди accept. Клиент уже может слать данные, хотя приложение о нём ещё не знает.', { addr: '0.0.0.0:8080', st: 'LISTEN', q: true, acc: 1 }],
      [3, 'accept(3, ...) = 4', 'accept() забирает соединение из очереди и выдаёт новый дескриптор 4 со своими буферами приёма и отправки. Слушающий сокет 3 продолжает принимать других. Пустая очередь — accept() блокируется.', { addr: '0.0.0.0:8080', st: 'LISTEN', q: true, conn: { rx: 0, tx: 0 } }],
      [-1, 'клиент: «GET / HTTP/1.1…» 420 Б', 'Пришли данные. Ядро кладёт их в буфер приёма и само отправляет ACK. Приложение может быть занято чем угодно.', { addr: '0.0.0.0:8080', st: 'LISTEN', q: true, conn: { rx: 420, tx: 0 } }],
      [4, 'recvfrom(4, ..., 4096) = 420', 'recv() копирует из буфера ядра в память процесса столько, сколько есть, — не обязательно целое сообщение. Буфер пуст — вызов блокируется до прихода данных.', { addr: '0.0.0.0:8080', st: 'LISTEN', q: true, conn: { rx: 0, tx: 0 }, data: true }],
      [5, 'sendto(4, ..., 9000) = 9000', 'sendall() лишь скопировал 9000 байт в буфер отправки и вернулся. Клиент ещё ничего не получил! Байты лежат в ядре, пока их не подтвердят. Буфер полон — вызов блокируется: так медленный клиент тормозит сервер.', { addr: '0.0.0.0:8080', st: 'LISTEN', q: true, conn: { rx: 0, tx: 9000 }, data: true }],
      [-1, 'ядро: отправлено, ACK получен', 'Ядро нарезало данные на сегменты по MSS, отправило в пределах окон и освободило буфер, когда пришли подтверждения. Приложение в этом не участвовало.', { addr: '0.0.0.0:8080', st: 'LISTEN', q: true, conn: { rx: 0, tx: 0 }, data: true }],
      [6, 'close(4) = 0', 'close() отправляет FIN, и дескриптор свободен. Если в буфере приёма остались непрочитанные данные — вместо FIN уйдёт RST, и клиент увидит <code>connection reset by peer</code>.', { addr: '0.0.0.0:8080', st: 'LISTEN', q: true, closed: true, data: true }],
    ];
    let i = -1;
    const code = h('pre', { class: 'code sk-code' });
    const sys = h('div', { class: 'sk-sys' });
    const kern = h('div', { class: 'sk-kern' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => go(i + 1) }, 'Следующий вызов');
    root.append(h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: () => go(-1) }, 'Сброс')), code, sys, kern, logEl);
    const bar = (label, v, cap) => `<div class="sk-buf"><span>${label}</span><span class="track"><span class="fill" style="width:${Math.min(100, v / cap * 100)}%"></span></span><b>${fmt(v)} Б</b></div>`;
    function go(n) {
      i = Math.min(S.length - 1, n);
      const st = i >= 0 ? S[i] : null;
      const line = st ? st[0] : -2;
      code.innerHTML = CODE.map((l, k) => `<span class="sk-line ${k === line ? 'cur' : ''} ${st && k < line ? 'past' : ''}">${highlight(l, 'py')}</span>`).join('\n');
      sys.innerHTML = st ? `<span class="label">${st[0] >= 0 ? 'strace' : 'событие'}</span><code>${st[1]}</code>` : '<span class="label">strace</span><code>—</code>';
      const k = st ? st[3] : null;
      let s = `<div class="sk-sock ${k ? '' : 'none'}"><b>fd 3</b> <span class="label">${k ? k.st : 'нет сокета'}</span><span class="sk-addr">${k ? k.addr : ''}</span>`;
      if (k && k.q) s += `<div class="sk-q"><span>очередь SYN</span>${k.syn ? '<i class="half"></i>' : '<em>пусто</em>'}</div><div class="sk-q"><span>очередь accept</span>${k.acc ? '<i></i>' : '<em>пусто</em>'}<small>до 128</small></div>`;
      s += '</div>';
      if (k && (k.conn || k.closed)) {
        s += `<div class="sk-sock conn ${k.closed ? 'gone' : ''}"><b>fd 4</b> <span class="label">${k.closed ? 'закрыт · FIN отправлен' : 'ESTABLISHED'}</span><span class="sk-addr">10.0.0.5:8080 ↔ 10.0.0.9:51544</span>`;
        if (!k.closed) s += bar('приём', k.conn.rx, 4096) + bar('отправка', k.conn.tx, 16384);
        s += '</div>';
      }
      if (k && k.data) s += '<div class="sk-app"><span class="label">память процесса</span><code>data = b"GET / HTTP/1.1…"</code></div>';
      kern.innerHTML = s;
      logEl.innerHTML = st ? st[2] : 'Сервер на Python: те же системные вызовы делают Go, Java и Node — разница только в обёртках. Нажимайте «Следующий вызов».';
      logEl.className = 'log' + (i === 8 ? ' warn' : '');
      stepBtn.disabled = i === S.length - 1;
    }
    go(-1);
    return {};
  });

  // ---------------------------------------------------------------- accept queue overflow
  Deck.demo('backlog', root => {
    const BACKLOGS = [8, 32, 128];
    let lambda = 150, mu = 220, backlog = 32, q, acc, accAcc, now, lat, accepted, dropped, retrying, burstLeft, playing = true, warned;
    const retries = [], pending = [];
    const s1 = (label, min, max, step, val, unit, set) => {
      const out = h('output', null, val + unit);
      const input = h('input', { type: 'range', min, max, step, value: val, 'aria-label': label });
      input.addEventListener('input', () => { set(+input.value); out.textContent = input.value + unit; });
      return h('label', { class: 'slider inline' }, h('span', { class: 'label bl-lab' }, label), input, out);
    };
    const bBtns = BACKLOGS.map(b => h('button', { class: 'btn small', onclick: () => { backlog = b; q = Math.min(q, b); pending.length = q; mark(); } }, String(b)));
    const mark = () => bBtns.forEach((b, i) => b.classList.toggle('sel', BACKLOGS[i] === backlog));
    const grid = h('div', { class: 'bq-grid' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const playBtn = h('button', { class: 'btn small', onclick: () => { playing = !playing; playBtn.textContent = playing ? 'Пауза' : 'Пуск'; } }, 'Пауза');
    root.append(
      s1('Входящих', 50, 400, 10, lambda, '/с', v => { lambda = v; }),
      s1('accept()', 20, 400, 10, mu, '/с', v => { mu = v; }),
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'backlog'), bBtns,
        h('button', { class: 'btn small', onclick: () => { burstLeft += 300; say('Всплеск: 300 клиентов переподключаются разом — так бывает после рестарта балансировщика или деплоя.'); } }, 'Всплеск ×300'),
        playBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      grid, stats, logEl,
    );
    function reset() {
      q = 0; acc = 0; accAcc = 0; now = 0; lat = []; accepted = 0; dropped = 0; burstLeft = 0; warned = false;
      retries.length = 0; pending.length = 0;
      mark();
      say('Приложение успевает: очередь почти пустая, соединения забираются сразу.');
    }
    function arrive(start, attempt) {
      if (q < backlog) { q++; pending.push(start); return; }
      dropped++;
      if (attempt < 3) retries.push({ at: now + [1, 2, 4][attempt], start, attempt: attempt + 1 });
      if (!warned) { warned = true; say('Очередь полна: ядро молча выбрасывает SYN. Клиент повторит через 1 с, потом через 2 с и 4 с. В логах приложения — ничего, у клиента — секундные задержки и таймауты.', 'bad'); }
    }
    function sim(dt) {
      now += dt;
      acc += lambda * dt;
      while (acc >= 1) { acc -= 1; arrive(now, 0); }
      if (burstLeft > 0) { const k = Math.min(burstLeft, Math.ceil(3000 * dt)); burstLeft -= k; for (let j = 0; j < k; j++) arrive(now, 0); }
      for (let j = retries.length - 1; j >= 0; j--) if (retries[j].at <= now) { const r = retries.splice(j, 1)[0]; arrive(r.start, r.attempt); }
      accAcc = Math.min(accAcc + mu * dt, 5);
      while (accAcc >= 1 && q > 0) { accAcc--; q--; accepted++; lat.push(now - pending.shift()); }
      if (lat.length > 400) lat.splice(0, lat.length - 400);
      if (warned && q < backlog * 0.5 && !retries.length && lambda < mu) { warned = false; say('Очередь разгрузилась. Запас backlog нужен для всплесков, а против постоянной перегрузки помогает только более быстрый accept() — больше воркеров.', 'ok'); }
    }
    function render() {
      const shown = backlog;
      grid.style.setProperty('--cols', backlog > 32 ? 16 : backlog > 8 ? 16 : 8);
      grid.innerHTML = Array.from({ length: shown }, (_, k) => `<i class="${k < q ? 'full' : ''}"></i>`).join('');
      const sorted = [...lat].sort((a, b) => a - b);
      const p99 = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : 0;
      stats.innerHTML = `<div class="stat"><b>${q} / ${backlog}</b><span>в очереди accept</span></div>` +
        `<div class="stat ${dropped ? 'warn' : ''}"><b>${fmt(dropped)}</b><span>SYN отброшено (ListenOverflows)</span></div>` +
        `<div class="stat ${p99 > 0.5 ? 'warn' : ''}"><b>${p99 >= 1 ? dec(p99, 1) + ' с' : Math.round(p99 * 1000) + ' мс'}</b><span>p99 ожидания до accept()</span></div>`;
    }
    reset();
    render();
    let tAcc = 0;
    return rafLoop(dt => {
      if (!playing) return;
      // simulate in small steps so retries and bursts keep order
      sim(dt);
      tAcc += dt;
      if (tAcc > 0.08) { tAcc = 0; render(); }
    });
  });

  // ---------------------------------------------------------------- ephemeral ports and TIME_WAIT
  Deck.demo('ports', root => {
    const RANGE = 60999 - 32768 + 1, TW = 60, SPEED = 6, POOL = 50;
    const RPS = [100, 200, 400, 600, 1000, 2000, 5000];
    let rps = 600, pool = false, t, closes, acc, errs, firstErr, playing = true;
    const rOut = h('output');
    const rIn = h('input', { type: 'range', min: 0, max: RPS.length - 1, value: 3, 'aria-label': 'Запросов в секунду' });
    rIn.addEventListener('input', () => { rps = RPS[+rIn.value]; rOut.textContent = fmt(rps) + '/с'; reset(); });
    rOut.textContent = fmt(rps) + '/с';
    const pIn = h('input', { type: 'checkbox' });
    pIn.addEventListener('change', () => { pool = pIn.checked; reset(); });
    const clock = h('div', { class: 'bd-big' });
    const bar = h('div', { class: 'pt-bar' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const playBtn = h('button', { class: 'btn small', onclick: () => { playing = !playing; playBtn.textContent = playing ? 'Пауза' : 'Пуск'; } }, 'Пауза');
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Запросов к одному ip:port'), rIn, rOut),
      h('label', { class: 'toggle' }, pIn, h('span', null, `пул: ${POOL} соединений с keep-alive`)),
      h('div', { class: 'controls' }, playBtn, h('button', { class: 'btn small', onclick: reset }, 'Сначала')),
      clock, bar, stats, logEl,
    );
    function reset() {
      t = 0; closes = []; acc = 0; errs = 0; firstErr = null;
      say(pool ? `Пул держит ${POOL} открытых соединений и гоняет по ним все запросы. Порты не расходуются, рукопожатий нет.`
        : `Клиент открывает новое соединение на каждый запрос и сам его закрывает. Каждое закрытое соединение держит порт ${TW} секунд.`);
      render();
    }
    const busy = () => pool ? POOL : closes.reduce((s, c) => s + c, 0);
    function second() {
      t++;
      if (pool) return;
      const free = RANGE - busy();
      const ok = Math.min(rps, Math.max(0, free));
      errs = rps - ok;
      closes.push(ok);
      if (closes.length > TW) closes.shift();
      if (errs > 0 && firstErr == null) {
        firstErr = t;
        say(`На ${t}-й секунде свободные порты кончились: <code>connect: cannot assign requested address</code> (EADDRNOTAVAIL, в Python — <code>[Errno 99]</code>). Новые соединения получаются только по мере выхода портов из TIME_WAIT: ${fmt(Math.floor(RANGE / TW))} в секунду.`, 'bad');
      }
    }
    function render() {
      const b = busy();
      clock.innerHTML = `<b>${t} с</b> работы`;
      bar.innerHTML = `<span style="width:${Math.min(100, b / RANGE * 100)}%"></span><em>${fmt(b)} из ${fmt(RANGE)} портов заняты</em>`;
      bar.classList.toggle('full', b >= RANGE);
      stats.innerHTML = `<div class="stat"><b>${fmt(b)}</b><span>${pool ? 'портов в пуле' : 'портов в TIME_WAIT'}</span></div>` +
        `<div class="stat"><b>${pool ? 0 : fmt(rps - errs)}</b><span>рукопожатий в секунду</span></div>` +
        `<div class="stat ${errs ? 'warn' : ''}"><b>${fmt(errs)}</b><span>ошибок в секунду</span></div>`;
      if (!pool && t === TW && !firstErr) say(`Прошла минута: TIME_WAIT начал освобождать порты, занято стабильно ${fmt(rps * TW)}. Предел — ${fmt(Math.floor(RANGE / TW))} новых соединений в секунду к одному адресу.`, 'ok');
    }
    reset();
    return rafLoop(dt => {
      if (!playing || t >= 120) return;
      acc += dt * SPEED;
      let ch = false;
      while (acc >= 1) { acc -= 1; second(); ch = true; }
      if (ch) render();
    });
  });
})();

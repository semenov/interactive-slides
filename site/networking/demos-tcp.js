// Demos for slides 9–16: TCP lifecycle, flow control, congestion control, latency, round trips, HOL, Nagle.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const { logger, ladder, fmt, dec } = Net;
  const ms = v => (v >= 1000 ? dec(v / 1000, v >= 10000 ? 0 : 2) + ' с' : (v < 10 ? dec(v, 1) : fmt(v)) + ' мс');

  // ---------------------------------------------------------------- TCP lifecycle ladder
  Deck.demo('tcpflow', root => {
    const M = [
      { from: 'L', t0: 0, t1: 10, label: 'SYN seq=1000', cls: 'ctl' },
      { from: 'R', t0: 10, t1: 20, label: 'SYN,ACK seq=5000 ack=1001', cls: 'ctl' },
      { from: 'L', t0: 20, t1: 30, label: 'ACK ack=5001', cls: 'ack' },
      { from: 'L', t0: 24, t1: 34, label: 'seq=1001 len=1000', cls: 'data' },
      { from: 'L', t0: 28, t1: 38, label: 'seq=2001 len=1000', cls: 'data', lost: true },
      { from: 'L', t0: 32, t1: 42, label: 'seq=3001', cls: 'data' },
      { from: 'L', t0: 36, t1: 46, label: 'seq=4001', cls: 'data' },
      { from: 'L', t0: 40, t1: 50, label: 'seq=5001', cls: 'data' },
      { from: 'R', t0: 34, t1: 44, label: 'ack=2001', cls: 'ack' },
      { from: 'R', t0: 42, t1: 52, label: 'ack=2001 (дубль)', cls: 'ack dup' },
      { from: 'R', t0: 46, t1: 56, label: 'ack=2001 (дубль)', cls: 'ack dup' },
      { from: 'R', t0: 50, t1: 60, label: 'ack=2001 (дубль)', cls: 'ack dup' },
      { from: 'L', t0: 60, t1: 70, label: 'seq=2001 повтор', cls: 'data rtx' },
      { from: 'R', t0: 70, t1: 80, label: 'ack=6001', cls: 'ack' },
      { from: 'L', t0: 84, t1: 94, label: 'FIN seq=6001', cls: 'ctl' },
      { from: 'R', t0: 94, t1: 104, label: 'ACK ack=6002', cls: 'ack' },
      { from: 'R', t0: 98, t1: 108, label: 'FIN seq=5001', cls: 'ctl' },
      { from: 'L', t0: 108, t1: 118, label: 'ACK ack=5002', cls: 'ack' },
    ];
    // [messages shown, client state, server state, text]
    const STEPS = [
      [0, 'CLOSED', 'LISTEN', 'Сервер слушает порт 80. Клиент вызывает <code>connect()</code>.'],
      [1, 'SYN_SENT', 'SYN_RCVD', 'Клиент выбирает случайный начальный номер 1000 и шлёт SYN. Сервер в ответ…'],
      [2, 'ESTABLISHED', 'SYN_RCVD', '…шлёт свой SYN с номером 5000 и подтверждает клиентский: ack=1001 («жду байт 1001»). Для клиента соединение открыто — <code>connect()</code> вернул управление через 1 RTT.'],
      [3, 'ESTABLISHED', 'ESTABLISHED', 'ACK доходит до сервера: соединение попадает в очередь accept. Рукопожатие сделали ядра — приложения в нём не участвовали.'],
      [8, 'ESTABLISHED', 'ESTABLISHED', 'Клиент отправляет 5000 байт пятью сегментами подряд, не дожидаясь подтверждений: окно позволяет. Второй сегмент потерялся.'],
      [9, 'ESTABLISHED', 'ESTABLISHED', 'Сервер получил байты 1001–2000 и подтверждает: ack=2001.'],
      [12, 'ESTABLISHED', 'ESTABLISHED', 'Сегменты 3001… пришли, но перед ними дыра. Приложению отдаётся только непрерывный поток, поэтому сервер держит их в буфере и каждый раз снова просит 2001. Опция SACK сообщает, что именно уже есть.'],
      [13, 'ESTABLISHED', 'ESTABLISHED', 'Третий дубликат: клиент повторяет только потерянный сегмент (fast retransmit), не дожидаясь таймаута, и вдвое уменьшает окно перегрузки.'],
      [14, 'ESTABLISHED', 'ESTABLISHED', 'Дыра закрыта — подтверждение прыгает сразу на 6001. Приложение сервера получает все 5000 байт разом, потеряв лишний RTT.'],
      [15, 'FIN_WAIT_1', 'ESTABLISHED', 'Клиент вызвал <code>close()</code>: FIN — «я больше ничего не отправлю». FIN занимает один номер в потоке.'],
      [16, 'FIN_WAIT_2', 'CLOSE_WAIT', 'Сервер подтверждает FIN и ждёт, пока его приложение тоже закроет сокет. Тысячи соединений в CLOSE_WAIT — утечка: код забывает <code>close()</code>.'],
      [17, 'FIN_WAIT_2', 'LAST_ACK', 'Сервер закрыл свою половину: FIN.'],
      [18, 'TIME_WAIT', 'CLOSED', 'Клиент закрыл первым — он и ждёт в TIME_WAIT 60 секунд (в Linux): вдруг последний ACK потерялся и сервер повторит FIN; опоздавшие сегменты не должны попасть в новое соединение с той же четвёркой. Порт всё это время занят.'],
    ];
    let i = 0;
    const pic = h('div', { class: 'tf-pic' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => go(i + 1) }, 'Шаг');
    const backBtn = h('button', { class: 'btn', onclick: () => go(i - 1) }, 'Назад');
    root.append(h('div', { class: 'controls' }, stepBtn, backBtn, h('button', { class: 'btn', onclick: () => go(0) }, 'Сброс')), pic, logEl);
    function go(n) {
      i = Math.max(0, Math.min(STEPS.length - 1, n));
      const [shown, cs, ss, text] = STEPS[i];
      const prevShown = i ? STEPS[i - 1][0] : 0;
      const msgs = M.slice(0, shown).map((m, k) => ({ ...m, cur: k >= prevShown }));
      const spans = i === STEPS.length - 1 ? [{ side: 'L', t0: 118, t1: 134, label: 'TIME_WAIT 60 с', cls: 'tw' }] : [];
      pic.innerHTML = ladder({ left: `клиент · <tspan class="lad-st">${cs}</tspan>`, right: `<tspan class="lad-st">${ss}</tspan> · сервер`, T: 136, msgs, spans, unit: 3.2, W: 460 });
      logEl.innerHTML = text;
      logEl.className = 'log' + (i === 4 ? ' warn' : '');
      stepBtn.disabled = i === STEPS.length - 1;
      backBtn.disabled = i === 0;
    }
    go(0);
    return {};
  });

  // ---------------------------------------------------------------- flow control, receive window
  Deck.demo('rwnd', root => {
    const CAP = 16, D = 8, TICK = 0.12, RATES = [0, 1, 2, 4, 6, 8, 10, 15];
    let data, acks, una, nxt, win, buf, rcvNxt, lastAdv, readAcc, rate = 4, acc, tick, persist, delivered, thr, zeroSaid;
    const pipe = h('div', { class: 'rw-pipe' });
    const bufEl = h('div', { class: 'rw-buf' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const rOut = h('output');
    const rIn = h('input', { type: 'range', min: 0, max: RATES.length - 1, value: 3, 'aria-label': 'Скорость чтения приложением' });
    rIn.addEventListener('input', () => { rate = RATES[+rIn.value]; rOut.textContent = rate + ' сегм/с'; if (rate === 0) say('Приложение-получатель перестало читать (завис, ждёт базу, GC-пауза). Данные копятся в буфере ядра.', 'warn'); });
    rOut.textContent = rate + ' сегм/с';
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Приложение читает'), rIn, rOut),
      h('div', { class: 'rw-ends' }, h('span', null, 'отправитель'), h('span', null, 'получатель')),
      pipe,
      h('div', { class: 'rw-brow' }, h('span', { class: 'label' }, 'буфер приёма, 16 сегментов'), bufEl),
      stats, logEl,
      h('div', { class: 'controls' }, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
    );
    function reset() {
      data = []; acks = []; una = 0; nxt = 0; win = CAP; buf = 0; rcvNxt = 0; lastAdv = CAP; readAcc = 0; acc = 0; tick = 0; persist = 0; delivered = []; thr = 0; zeroSaid = false;
      say('Канал пропускает до 8 сегментов в секунду. Пока приложение читает быстро, окно открыто.');
      render();
    }
    function ackNow(probe) {
      lastAdv = CAP - buf;
      acks.push({ ack: rcvNxt, win: lastAdv, pos: 0, probe });
    }
    function step() {
      tick++;
      // move packets
      for (const p of data) p.pos++;
      for (const a of acks) a.pos++;
      while (data.length && data[0].pos >= D) {
        const p = data.shift();
        if (p.probe) { ackNow(true); continue; }
        buf++; rcvNxt++;
        delivered.push(tick);
        ackNow(false);
      }
      while (acks.length && acks[0].pos >= D) {
        const a = acks.shift();
        una = Math.max(una, a.ack);
        const wasZero = win === 0;
        win = a.win;
        if (win === 0 && !zeroSaid) { zeroSaid = true; say('Буфер получателя полон — в ACK пришло win=0. Отправитель остановился. Его приложение заблокируется в <code>write()</code>, когда заполнится и буфер отправки.', 'bad'); }
        else if (wasZero && win > 0) { zeroSaid = false; say(`Окно снова открыто (win=${win}): приложение прочитало данные, и получатель сообщил об этом. Передача продолжилась.`, 'ok'); }
      }
      // receiver app reads
      readAcc = Math.min(readAcc + rate * TICK, 1.5);
      while (readAcc >= 1 && buf > 0) { buf--; readAcc--; }
      if (lastAdv === 0 && CAP - buf >= 1) ackNow(false); // window update
      // sender: one segment per tick (link speed) within the window
      if (nxt < una + win && tick % 1 === 0) { data.push({ seq: nxt++, pos: 0 }); persist = 0; }
      else if (win === 0 && nxt === una) {
        if (++persist >= 14) { persist = 0; data.push({ probe: true, pos: 0 }); say('Проба окна: отправитель периодически спрашивает «не открылось ли?» — иначе потеря обновления окна повесила бы соединение навсегда.', 'warn'); }
      }
      while (delivered.length && delivered[0] < tick - 25) delivered.shift();
      thr = delivered.length / (25 * TICK);
    }
    function render() {
      pipe.innerHTML = data.map(p => `<i class="rw-d ${p.probe ? 'probe' : ''}" style="left:${(p.pos / D) * 100}%"></i>`).join('') +
        acks.map(a => `<i class="rw-a ${a.win === 0 ? 'zero' : ''}" style="left:${(1 - a.pos / D) * 100}%">${a.win}</i>`).join('');
      bufEl.innerHTML = Array.from({ length: CAP }, (_, k) => `<i class="${k < buf ? 'full' : ''}"></i>`).join('');
      const inflight = nxt - una;
      stats.innerHTML = `<div class="stat ${win === 0 ? 'warn' : ''}"><b>${win}</b><span>окно у отправителя</span></div>` +
        `<div class="stat"><b>${inflight}</b><span>в полёте</span></div>` +
        `<div class="stat"><b>${dec(thr)}</b><span>сегм/с доходит</span></div>`;
    }
    reset();
    return rafLoop(dt => {
      acc += dt;
      let ch = false;
      while (acc >= TICK) { acc -= TICK; step(); ch = true; }
      if (ch) render();
    });
  });

  // ---------------------------------------------------------------- congestion control (Reno)
  Deck.demo('cwnd', root => {
    const BDP = 40, QBUF = 20, CAPW = BDP + QBUF, VIEW = 50, YMAX = 90, STEP = 0.45;
    let hist, cwnd, ssth, acc, playing = true, randomLoss = false, pending = null, round, phase;
    const svgBox = h('div', { class: 'cw-graph' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const playBtn = h('button', { class: 'btn', onclick: () => { playing = !playing; playBtn.textContent = playing ? 'Пауза' : 'Пуск'; } }, 'Пауза');
    const rlIn = h('input', { type: 'checkbox' });
    rlIn.addEventListener('change', () => { randomLoss = rlIn.checked; });
    root.append(
      h('div', { class: 'controls' }, playBtn,
        h('button', { class: 'btn', onclick: () => { pending = 'dup'; } }, 'Потеря пакета'),
        h('button', { class: 'btn', onclick: () => { pending = 'rto'; } }, 'Таймаут'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, rlIn, h('span', null, 'случайные потери 0,3% (Wi-Fi, мобильная связь)')),
      svgBox, stats, logEl,
    );
    function reset() {
      hist = []; cwnd = 10; ssth = Infinity; acc = 0; round = 0; pending = null; phase = '';
      hist.push({ c: cwnd, s: ssth, ev: null });
      say('Начальное окно — 10 сегментов (~14 КБ). Медленный старт удваивает его каждый RTT.');
      render();
    }
    function loss(kind, why) {
      ssth = Math.max(2, Math.floor(cwnd / 2));
      if (kind === 'rto') {
        cwnd = 1;
        say(`${why}Таймаут ретрансмиссии: подтверждений нет совсем. Порог = ${ssth}, окно — 1 сегмент, снова медленный старт. Плюс пауза RTO — минимум 200 мс.`, 'bad');
      } else {
        cwnd = ssth;
        say(`${why}Три дубликата ACK: окно вдвое меньше — ${cwnd}. Дальше рост +1 за RTT. Так и получается «пила».`, 'warn');
      }
      phase = '';
    }
    function step() {
      round++;
      let ev = null;
      if (pending) { ev = pending; loss(pending, 'Потеря. '); pending = null; }
      else if (cwnd > CAPW) { ev = 'dup'; loss('dup', `Окно ${cwnd} > ${CAPW}: очередь в узком месте переполнилась, роутер выбросил пакеты. `); }
      else if (randomLoss && Math.random() < 1 - Math.pow(1 - 0.003, cwnd)) { ev = 'dup'; loss('dup', 'Случайная потеря — не от перегрузки, но TCP этого не знает. '); }
      else if (cwnd < ssth) {
        const next = Math.min(cwnd * 2, ssth === Infinity ? cwnd * 2 : ssth);
        if (phase !== 'ss') { phase = 'ss'; if (round > 1) say('Медленный старт: окно удваивается каждый RTT.'); }
        cwnd = next;
      } else {
        if (phase !== 'ca') { phase = 'ca'; say(`Окно дошло до порога ${ssth}: дальше аддитивный рост, +1 сегмент за RTT.`); }
        cwnd += 1;
      }
      hist.push({ c: cwnd, s: ssth, ev });
      if (hist.length > VIEW + 1) hist.shift();
    }
    function render() {
      const W = 400, H = 180, px = i => 30 + (i / VIEW) * (W - 40), py = v => H - 18 - (Math.min(v, YMAX) / YMAX) * (H - 30);
      let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="cwnd по раундам">`;
      s += `<rect class="cw-q" x="30" y="${py(CAPW)}" width="${W - 40}" height="${py(BDP) - py(CAPW)}"/>`;
      s += `<line class="cw-bdp" x1="30" x2="${W - 10}" y1="${py(BDP)}" y2="${py(BDP)}"/><text class="cw-t" x="${W - 12}" y="${py(BDP) + 12}" text-anchor="end">BDP: канал загружен</text>`;
      s += `<line class="cw-cap" x1="30" x2="${W - 10}" y1="${py(CAPW)}" y2="${py(CAPW)}"/><text class="cw-t bad" x="${W - 12}" y="${py(CAPW) - 4}" text-anchor="end">+ буфер роутера: дальше потери</text>`;
      s += `<text class="cw-t" x="${(W - 40) / 2 + 30}" y="${H - 3}" text-anchor="middle">RTT →</text>`;
      for (const v of [0, 20, 40, 60, 80]) s += `<text class="cw-t" x="24" y="${py(v) + 4}" text-anchor="end">${v}</text>`;
      const pts = hist.map((p, i) => `${px(i)},${py(p.c)}`).join(' ');
      const sp = hist.map((p, i) => p.s === Infinity ? null : `${px(i)},${py(p.s)}`);
      const sPts = sp.filter(Boolean).join(' ');
      if (sPts.includes(' ')) s += `<polyline class="cw-ss" points="${sPts}"/>`;
      s += `<polyline class="cw-line" points="${pts}"/>`;
      hist.forEach((p, i) => { if (p.ev) s += `<circle class="cw-ev ${p.ev}" cx="${px(i - 1)}" cy="${py(hist[i - 1] ? hist[i - 1].c : p.c)}" r="4"/>`; });
      svgBox.innerHTML = s + '</svg>';
      const util = Math.min(cwnd, BDP) / BDP * 100;
      const rttUp = cwnd > BDP ? Math.round((cwnd - BDP) / BDP * 100) : 0;
      stats.innerHTML = `<div class="stat"><b>${cwnd}</b><span>cwnd, сегментов</span></div>` +
        `<div class="stat ${util < 60 ? 'warn' : ''}"><b>${Math.round(util)}%</b><span>загрузка канала</span></div>` +
        `<div class="stat ${rttUp > 25 ? 'warn' : ''}"><b>+${rttUp}%</b><span>RTT из-за очереди</span></div>`;
    }
    reset();
    return rafLoop(dt => {
      if (!playing) return;
      acc += dt;
      let ch = false;
      while (acc >= STEP) { acc -= STEP; step(); ch = true; }
      if (ch) render();
    });
  });

  // ---------------------------------------------------------------- latency vs bandwidth
  Deck.demo('bdp', root => {
    const BW = [[1, '1 Мбит/с'], [10, '10 Мбит/с'], [100, '100 Мбит/с'], [1000, '1 Гбит/с'], [10000, '10 Гбит/с']];
    const RTT = [1, 5, 20, 50, 100, 150, 300];
    const SIZE = [[2e3, '2 КБ'], [20e3, '20 КБ'], [100e3, '100 КБ'], [1e6, '1 МБ'], [10e6, '10 МБ'], [100e6, '100 МБ'], [1e9, '1 ГБ']];
    let bw = 3, rtt = 3, size = 1, fresh = true;
    const mk = (label, list, idx, show, set) => {
      const out = h('output');
      const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
      const upd = () => { out.textContent = show(list[+input.value]); };
      upd();
      input.addEventListener('input', () => { set(+input.value); upd(); update(); });
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label bd-l' }, label), input, out));
    };
    mk('Полоса', BW, bw, v => v[1], v => { bw = v; });
    mk('RTT', RTT, rtt, v => v + ' мс', v => { rtt = v; });
    mk('Ответ', SIZE, size, v => v[1], v => { size = v; });
    const fIn = h('input', { type: 'checkbox', checked: true });
    fIn.addEventListener('change', () => { fresh = fIn.checked; update(); });
    root.append(h('label', { class: 'toggle' }, fIn, h('span', null, 'новое соединение: TCP + TLS 1.3 (+2 RTT)')));
    const big = h('div', { class: 'bd-big' });
    const bar = h('div', { class: 'bd-bar' });
    const legend = h('div', { class: 'bd-legend' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(big, bar, legend, stats, logEl);
    function update() {
      const B = BW[bw][0] * 1e6, R = RTT[rtt] / 1000, S = SIZE[size][0];
      const SEG = 1448, N = Math.ceil(S / SEG), bdpSeg = (B * R / 8) / SEG;
      let c = 10, sent = 0, rounds = 0;
      while (sent < N && c < bdpSeg) { sent += c; rounds++; c *= 2; }
      rounds = Math.max(1, rounds);
      const hs = fresh ? 2 : 0;
      const tR = (hs + rounds) * R * 1000, tB = S * 8 / B * 1000, tot = tR + tB;
      big.innerHTML = `<b>${ms(tot)}</b> до последнего байта`;
      bar.innerHTML = `<span class="r" style="width:${tR / tot * 100}%"></span><span class="b" style="width:${tB / tot * 100}%"></span>`;
      legend.innerHTML = `<span><i class="sw r"></i>ожидание: ${hs + rounds} × RTT = ${ms(tR)}</span><span><i class="sw b"></i>передача битов: ${ms(tB)}</span>`;
      const bdpB = B * R / 8;
      const bdpS = bdpB >= 1e6 ? dec(bdpB / 1e6, 1) + ' МБ' : fmt(bdpB / 1e3) + ' КБ';
      const eff = S * 8 / (tot / 1000) / 1e6;
      stats.innerHTML = `<div class="stat"><b>${bdpS}</b><span>BDP: должно быть в полёте</span></div>` +
        `<div class="stat"><b>${rounds}</b><span>${plural(rounds, ['круг', 'круга', 'кругов'])} медленного старта</span></div>` +
        `<div class="stat ${eff < BW[bw][0] * 0.3 ? 'warn' : ''}"><b>${eff >= 100 ? fmt(eff) : dec(eff, 1)}</b><span>Мбит/с вышло на деле</span></div>`;
      const share = tR / tot;
      logEl.className = 'log' + (share > 0.8 ? ' warn' : '');
      logEl.innerHTML = share > 0.8
        ? `${Math.round(share * 100)}% времени — ожидание RTT. Канал в 10 раз шире почти ничего не даст; помогут меньше кругов: переиспользование соединений, сервер ближе к пользователю.`
        : bdpB > 6e6
          ? `BDP ${bdpS} больше буфера сокета по умолчанию в Linux (до 6 МБ, <code>net.ipv4.tcp_rmem</code>): одно соединение такой канал не загрузит. Поднимают буферы или качают в несколько потоков.`
          : `Большой ответ: время определяет полоса. Окно быстро дорастает до BDP, дальше данные идут сплошным потоком.`;
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- round trips: HTTP/1.1, 2, 3
  Deck.demo('rtt', root => {
    let proto = 'h2', tls = 13, open = false, rtt = 80, n = 6;
    const P = [['h1', 'HTTP/1.1'], ['h2', 'HTTP/2'], ['h3', 'HTTP/3']];
    const pBtns = P.map(([k, label]) => h('button', { class: 'btn small', onclick: () => { proto = k; update(); } }, label));
    const tBtns = [12, 13].map(v => h('button', { class: 'btn small', onclick: () => { tls = v; update(); } }, 'TLS 1.' + (v - 10)));
    const oIn = h('input', { type: 'checkbox' });
    oIn.addEventListener('change', () => { open = oIn.checked; update(); });
    const slider = (label, min, max, val, unit, set) => {
      const out = h('output', null, val + unit);
      const input = h('input', { type: 'range', min, max, value: val, 'aria-label': label });
      input.addEventListener('input', () => { set(+input.value); out.textContent = input.value + unit; update(); });
      return h('label', { class: 'slider inline' }, h('span', { class: 'label rt-l' }, label), input, out);
    };
    const big = h('div', { class: 'bd-big' });
    const lane = h('div', { class: 'rt-lane' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' }, pBtns), h('div', { class: 'controls' }, tBtns),
      h('label', { class: 'toggle' }, oIn, h('span', null, 'соединение уже открыто (keep-alive, пул)')),
      slider('RTT', 5, 300, rtt, ' мс', v => { rtt = v; }),
      slider('Запросов', 1, 12, n, '', v => { n = v; }),
      big, lane, stats, logEl,
    );
    function update() {
      pBtns.forEach((b, i) => b.classList.toggle('sel', P[i][0] === proto));
      tBtns.forEach((b, i) => { b.classList.toggle('sel', [12, 13][i] === tls && proto !== 'h3'); b.disabled = proto === 'h3'; });
      const blocks = [];
      if (!open) {
        if (proto === 'h3') blocks.push(['q', 'QUIC + TLS']);
        else {
          blocks.push(['tcp', 'TCP']);
          for (let k = 0; k < (tls === 12 ? 2 : 1); k++) blocks.push(['tls', 'TLS']);
        }
      }
      const conns = proto === 'h1' ? Math.min(n, 6) : 1;
      const reqRounds = proto === 'h1' ? Math.ceil(n / 6) : 1;
      for (let k = 0; k < reqRounds; k++) blocks.push(['req', proto === 'h1' ? `запросы ×${Math.min(6, n - k * 6)}` : `запросы ×${n}`]);
      const total = blocks.length * rtt;
      big.innerHTML = `<b>${fmt(total)} мс</b> · ${blocks.length} ${plural(blocks.length, ['круг', 'круга', 'кругов'])} RTT`;
      lane.innerHTML = blocks.map(([c, l]) => `<span class="rt-b ${c}">${l}</span>`).join('');
      stats.innerHTML = `<div class="stat"><b>${conns}</b><span>${plural(conns, ['соединение', 'соединения', 'соединений'])}</span></div>` +
        `<div class="stat"><b>${open ? 0 : conns}</b><span>${plural(open ? 0 : conns, ['рукопожатие', 'рукопожатия', 'рукопожатий'])}</span></div>` +
        `<div class="stat"><b>${fmt(total - (open ? 0 : 0))}</b><span>мс до последнего ответа</span></div>`;
      let t;
      if (open) t = 'Соединение готово — платим только за сами запросы. Поэтому пул соединений — первое, что проверяют при «медленном API».';
      else if (proto === 'h3') t = 'QUIC делает транспортное и TLS-рукопожатие одним кругом. При повторном визите — 0-RTT: запрос летит в первом же пакете (только идемпотентный — его могут повторить).';
      else if (tls === 12) t = 'TLS 1.2 тратит два круга: договориться о шифрах, затем обменяться ключами. TLS 1.3 сразу присылает ключ в ClientHello.';
      else t = 'TCP, затем TLS 1.3: ClientHello с ключом → ServerHello с сертификатом и Finished → и сразу запрос. Сервер проверяет подпись, клиент — цепочку сертификатов.';
      if (proto === 'h1' && n > 6) t += ' HTTP/1.1: по одному запросу на соединение, браузер держит до 6 соединений к хосту — остальные ждут.';
      logEl.innerHTML = t;
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- head-of-line blocking
  Deck.demo('hol', root => {
    const ORDER = ['A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'A3', 'B3', 'C3'];
    const LOST = 3, D = 4, TICKMS = 10, STEP = 0.32;
    const RTX = LOST + 3 + D + D + D; // 3 later packets arrive → dup ACK goes back → retransmit arrives
    let mode = 'tcp', t, acc, playing;
    const modeBtns = [['tcp', 'HTTP/2 поверх TCP'], ['quic', 'HTTP/3 поверх QUIC']].map(([k, l]) => h('button', { class: 'btn small', onclick: () => { mode = k; reset(); } }, l));
    const runBtn = h('button', { class: 'btn primary', onclick: () => { if (t >= RTX + 1) reset(); playing = true; } }, 'Пуск');
    const wire = h('div', { class: 'hl-wire' });
    const rows = h('div', { class: 'hl-rows' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'controls' }, modeBtns), h('div', { class: 'controls' }, runBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('span', { class: 'label' }, 'порядок отправки'), wire, rows,
      h('div', { class: 'hl-legend' }, h('span', null, h('i', { class: 'hl-p fly' }), 'в пути'), h('span', null, h('i', { class: 'hl-p wait' }), 'пришёл, ждёт в ядре'), h('span', null, h('i', { class: 'hl-p done' }), 'отдан приложению')),
      stats, logEl);
    const arrive = i => (i === LOST ? RTX : i + D);
    function deliverAt(i) {
      if (mode === 'quic') {
        // only earlier packets of the same stream matter
        let at = arrive(i);
        for (let j = 0; j < i; j++) if (ORDER[j][0] === ORDER[i][0]) at = Math.max(at, arrive(j));
        return at;
      }
      let at = arrive(i);
      for (let j = 0; j < i; j++) at = Math.max(at, arrive(j));
      return at;
    }
    function reset() {
      t = 0; acc = 0; playing = false;
      modeBtns.forEach((b, i) => b.classList.toggle('sel', ['tcp', 'quic'][i] === mode));
      logEl.className = 'log';
      logEl.innerHTML = 'Три потока — A, B, C — идут вперемешку. Пакет A2 потеряется. Нажмите «Пуск».';
      render();
    }
    function render() {
      wire.innerHTML = ORDER.map((p, i) => `<span class="hl-w ${i === LOST ? 'lost' : ''} s${p[0]}">${p}</span>`).join('');
      rows.innerHTML = ['A', 'B', 'C'].map(s => `<div class="hl-row"><b class="s${s}">поток ${s}</b>` + ORDER.map((p, i) => {
        if (p[0] !== s) return '';
        const st = t < i ? 'idle' : t < arrive(i) ? 'fly' : t < deliverAt(i) ? 'wait' : 'done';
        return `<i class="hl-p ${st}">${p}</i>`;
      }).join('') + '</div>').join('');
      const fin = s => Math.max(...ORDER.map((p, i) => (p[0] === s ? deliverAt(i) : 0)));
      stats.innerHTML = ['A', 'B', 'C'].map(s => {
        const done = t >= fin(s);
        return `<div class="stat ${done && fin(s) >= RTX ? 'warn' : ''}"><b>${done ? fin(s) * TICKMS + ' мс' : '…'}</b><span>поток ${s} готов</span></div>`;
      }).join('');
    }
    function step() {
      t++;
      if (t === LOST + D) { logEl.className = 'log warn'; logEl.innerHTML = 'A2 не пришёл. Следующие пакеты приходят, получатель шлёт дубликаты ACK…'; }
      if (t === RTX) {
        logEl.className = 'log ' + (mode === 'tcp' ? 'bad' : 'ok');
        logEl.innerHTML = mode === 'tcp'
          ? 'Повтор A2 пришёл — и только теперь ядро отдало приложению всё накопленное. Потоки B и C ждали пакет, который им не нужен: TCP не знает о потоках, у него один поток байтов.'
          : 'Повтор A2 пришёл, поток A догнал. B и C получили свои данные сразу по приходе: QUIC знает границы потоков и не держит чужие данные.';
      }
      if (t > RTX) playing = false;
    }
    reset();
    return rafLoop(dt => {
      if (!playing) return;
      acc += dt;
      let ch = false;
      while (acc >= STEP && playing) { acc -= STEP; step(); ch = true; }
      if (ch) render();
    });
  });

  // ---------------------------------------------------------------- Nagle + delayed ACK
  Deck.demo('nagle', root => {
    const RTT = 20, DELACK = 40;
    let nagle = true, delack = true, single = false;
    const tg = (label, val, set) => {
      const input = h('input', { type: 'checkbox', checked: val });
      input.addEventListener('change', () => { set(input.checked); update(); });
      return h('label', { class: 'toggle' }, input, h('span', { html: label }));
    };
    const pic = h('div', { class: 'ng-pic' });
    const big = h('div', { class: 'bd-big' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      tg('Нейгл включён (нет <code>TCP_NODELAY</code>)', nagle, v => { nagle = v; }),
      tg('отложенный ACK у сервера (40 мс)', delack, v => { delack = v; }),
      tg('заголовок и тело одной записью', single, v => { single = v; }),
      big, pic, logEl,
    );
    function update() {
      const o = RTT / 2;
      const msgs = [], spans = [];
      let done, text, cls = '';
      if (single) {
        msgs.push({ from: 'L', t0: 0, t1: o, label: 'запрос 400 Б', cls: 'data' });
        msgs.push({ from: 'R', t0: o, t1: RTT, label: 'ответ + ACK', cls: 'ctl' });
        done = RTT;
        text = 'Весь запрос ушёл одним сегментом — сервер сразу отвечает, ACK едет вместе с ответом. Буферизуйте вывод: <code>bufio.Writer</code>, <code>BufferedOutputStream</code>, одна строка вместо двух <code>send()</code>.';
        cls = 'ok';
      } else if (!nagle) {
        msgs.push({ from: 'L', t0: 0, t1: o, label: 'заголовок 100 Б', cls: 'data' });
        msgs.push({ from: 'L', t0: 4, t1: o + 4, label: 'тело 300 Б', cls: 'data' });
        msgs.push({ from: 'R', t0: o + 4, t1: RTT + 4, label: 'ответ + ACK', cls: 'ctl' });
        done = RTT + 4;
        text = 'С <code>TCP_NODELAY</code> оба сегмента уходят сразу. Цена — больше мелких пакетов в сети, если приложение пишет по байту.';
        cls = 'ok';
      } else {
        msgs.push({ from: 'L', t0: 0, t1: o, label: 'заголовок 100 Б', cls: 'data' });
        const ackAt = o + (delack ? DELACK : 0);
        if (delack) spans.push({ side: 'R', t0: o, t1: ackAt, label: 'ждёт: вдруг будет ответ', cls: 'tw' });
        spans.push({ side: 'L', t0: 0, t1: ackAt + o, label: 'Нейгл держит тело', cls: 'hold' });
        msgs.push({ from: 'R', t0: ackAt, t1: ackAt + o, label: 'ACK', cls: 'ack' });
        msgs.push({ from: 'L', t0: ackAt + o, t1: ackAt + RTT, label: 'тело 300 Б', cls: 'data' });
        msgs.push({ from: 'R', t0: ackAt + RTT, t1: ackAt + RTT + o, label: 'ответ + ACK', cls: 'ctl' });
        done = ackAt + RTT + o;
        text = delack
          ? 'Тело маленькое, а заголовок ещё не подтверждён — Нейгл ждёт ACK. Сервер ACK не шлёт: у него неполный запрос, ответить нечем, и он ждёт 40 мс. Взаимная вежливость стоит 40 мс на каждом запросе.'
          : 'Без отложенного ACK Нейгл стоит одного лишнего RTT: тело ждёт подтверждения заголовка.';
        cls = delack ? 'bad' : 'warn';
      }
      big.innerHTML = `<b>${done} мс</b> до ответа при RTT ${RTT} мс`;
      const T = 110;
      pic.innerHTML = ladder({ left: 'клиент', right: 'сервер', T, msgs, spans, unit: 2.6, W: 420, ticks: [[0, '0'], [40, '40'], [80, '80 мс']] });
      logEl.className = 'log ' + cls;
      logEl.innerHTML = text;
    }
    update();
    return {};
  });
})();

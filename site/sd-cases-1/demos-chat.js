// Demos for the chat case: message flow through gateways, per-chat ordering and receipts.
(() => {
  'use strict';
  const { h, plural } = Deck;

  // Like Deck.rafLoop, but dt follows the wall clock (clamped to 0.25 s), so slow frames do not slow the story down.
  function clockLoop(fn) {
    let id = 0, last = 0, on = false;
    const frame = t => {
      if (!on) return;
      const dt = Math.min(0.25, Math.max(0, t - last) / 1000);
      last = t;
      fn(dt);
      if (on) id = requestAnimationFrame(frame);
    };
    return {
      start() { if (!on) { on = true; last = performance.now(); id = requestAnimationFrame(frame); } },
      stop() { on = false; cancelAnimationFrame(id); },
    };
  }

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }

  // ---------------------------------------------------------------- message flow between gateways
  Deck.demo('chatflow', root => {
    const USERS = ['A', 'B', 'C', 'D', 'E'];
    const GW = { g1: 'gw1', g2: 'gw2', g3: 'gw3' };
    const GROUP = ['C', 'D', 'E'];
    const STEP = 0.95;
    let conn, online, seqs, queue, active, acc, outbox, pending, msgN;

    const grid = h('div', { class: 'cf-grid' });
    const outEl = h('div', { class: 'cf-out' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const dBtn = h('button', { class: 'btn small danger', onclick: toggleD }, 'Отключить D');
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn small primary', onclick: () => send('D') }, 'A → D'),
        h('button', { class: 'btn small', onclick: () => send('B') }, 'A → B'),
        h('button', { class: 'btn small', onclick: () => send('group') }, 'A → группа C, D, E'),
        dBtn,
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      grid, outEl, logEl,
    );

    function reset() {
      conn = { A: 'g1', B: 'g1', C: 'g2', D: 'g2', E: 'g3' };
      online = { A: true, B: true, C: true, D: true, E: true };
      seqs = { 'A–B': 40, 'A–D': 17, group: 311 };
      queue = []; active = []; acc = 0; outbox = []; pending = []; msgN = 0;
      dBtn.textContent = 'Отключить D';
      say('Пять пользователей на трёх шлюзах. Реестр знает, кто где. Отправьте сообщение.');
      render();
    }
    const chatOf = to => to === 'group' ? 'group' : 'A–' + to;
    const chatName = c => c === 'group' ? 'группа' : c;

    function send(to) {
      const chat = chatOf(to);
      const m = { n: ++msgN, chat, to: to === 'group' ? 'группа' : to, seq: null, status: '…', waiting: [] };
      outbox.unshift(m);
      outbox.length = Math.min(outbox.length, 3);
      const rcpt = to === 'group' ? GROUP : [to];
      queue.push(
        { on: ['A', 'g1'], text: () => `A → gw1: кадр <code>send{chat: ${chatName(chat)}, cid}</code> по своему WebSocket.` },
        { on: ['g1', 'svc'], text: () => `gw1 → сервис чата. Запрос идёт к шарду, который владеет чатом «${chatName(chat)}».` },
        { on: ['svc', 'db'], text: () => `Сервис назначает <code>seq = ${m.seq}</code> и пишет сообщение в хранилище.`, fx: () => { m.seq = ++seqs[chat]; } },
        { on: ['svc', 'g1', 'A'], text: () => `Только после записи — <code>ack{cid, seq: ${m.seq}}</code> отправителю. У A одна галочка: сервер принял и не потеряет.`, fx: () => { m.status = '✓'; } },
        {
          on: ['svc', 'reg'],
          text: () => 'Реестр: ' + rcpt.map(u => online[u] ? `${u} → ${GW[conn[u]]}` : `${u} — нет соединения`).join(', ') + '.',
          fx: () => { deliverSteps(m, rcpt); },
        },
      );
      if (!active.length) acc = STEP;
      loop.start();
    }
    function deliverSteps(m, rcpt) {
      const on = rcpt.filter(u => online[u]), off = rcpt.filter(u => !online[u]);
      const gws = [...new Set(on.map(u => conn[u]))];
      const steps = [];
      if (on.length) {
        steps.push({
          on: ['svc', ...gws],
          text: () => gws.length < on.length
            ? `Одна отправка на шлюз, а не на получателя: ${gws.map(g => GW[g]).join(' и ')} получают сообщение и сами раздают его своим клиентам.`
            : `Сервис отдаёт сообщение на ${gws.map(g => GW[g]).join(', ')} — RPC к шлюзу или его канал в pub/sub.` + (gws.includes('g1') && m.to === 'B' ? ' Тот же шлюз, что у A, — но путь через сервис всё равно нужен: seq и запись.' : ''),
        });
        steps.push({ on: [...gws, ...on], text: () => `Шлюз пишет кадр <code>msg{seq: ${m.seq}}</code> в WebSocket: ${on.join(', ')}.` });
      }
      if (off.length) {
        steps.push({
          on: ['svc', 'push', ...off],
          text: () => `У ${off.join(', ')} нет соединения → событие в очередь пушей, APNs/FCM покажут уведомление. Само сообщение ждёт в хранилище.`,
          fx: () => { off.forEach(u => pending.push({ m, u })); m.waiting = off.slice(); },
        });
      }
      if (on.length) {
        steps.push({
          on: [...on, ...gws, 'svc', 'g1', 'A'],
          text: () => `Клиенты подтверждают <code>delivered{seq: ${m.seq}}</code>, сервис пересылает это A.` + (off.length ? ` Две галочки появятся, когда доставят всем — ${off.join(', ')} пока офлайн.` : ' У A две галочки.'),
          fx: () => { if (!off.length) m.status = '✓✓'; },
        });
      }
      queue.unshift(...steps);
    }
    function toggleD() {
      if (online.D) {
        online.D = false;
        dBtn.textContent = 'Подключить D';
        say('D закрыл приложение. Шлюз заметил разрыв и удалил D из реестра; если шлюз упал — запись истечёт по TTL без heartbeat.', 'warn');
        render();
        return;
      }
      const g = conn.D === 'g2' ? 'g3' : 'g2';
      dBtn.textContent = 'Отключить D';
      const mine = pending.filter(p => p.u === 'D');
      queue.push(
        { on: ['D', g], text: () => `D снова в сети, балансировщик выбрал ${GW[g]} — другой шлюз. Это нормально: состояние не в шлюзе.`, fx: () => { online.D = true; conn.D = g; } },
        { on: [g, 'reg'], text: () => `Реестр: D → ${GW[g]}, TTL 60 с, продлевается heartbeat каждые 20–30 с.` },
      );
      if (mine.length) {
        queue.push(
          { on: ['D', g, 'svc', 'db'], text: () => 'D присылает <code>sync</code> с последним известным seq по каждому чату. Сервис дочитывает из хранилища всё, что новее.' },
          {
            on: [g, 'D'],
            text: () => `D получил ${mine.length} ${plural(mine.length, ['пропущенное сообщение', 'пропущенных сообщения', 'пропущенных сообщений'])} и подтверждает доставку.`,
          },
          {
            on: ['D', g, 'svc', 'g1', 'A'],
            text: () => 'Квитанция <code>delivered</code> дошла до A: две галочки.',
            fx: () => {
              mine.forEach(p => { p.m.waiting = p.m.waiting.filter(u => u !== 'D'); if (!p.m.waiting.length) p.m.status = '✓✓'; });
              pending = pending.filter(p => p.u !== 'D');
            },
          },
        );
      } else queue.push({ on: ['D'], text: () => 'Пропущенных сообщений нет — синхронизация вернула пустой ответ.' });
      if (!active.length) acc = STEP;
      loop.start();
    }

    const loop = clockLoop(dt => {
      acc += dt;
      if (acc < STEP) return;
      acc = 0;
      const st = queue.shift();
      if (!st) { active = []; render(); loop.stop(); return; }
      if (st.fx) st.fx();
      active = st.on;
      say(st.text(), '');
      render();
    });

    function node(id, title, sub, cls = '') {
      return `<div class="cf-n ${cls} ${active.includes(id) ? 'on' : ''}" data-id="${id}"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    }
    function render() {
      const cols = Object.keys(GW).map(g => {
        const us = USERS.filter(u => online[u] && conn[u] === g);
        return `<div class="cf-col"><div class="cf-users">${us.map(u => node(u, u, '', 'user')).join('') || '<span class="empty">нет клиентов</span>'}</div>` +
          node(g, GW[g], `${us.length} ${plural(us.length, ['соединение', 'соединения', 'соединений'])}`, 'gw') + '</div>';
      }).join('');
      const off = USERS.filter(u => !online[u]);
      const reg = USERS.filter(u => online[u]).map(u => `${u}→${GW[conn[u]].slice(2)}`).join(' ');
      grid.innerHTML =
        (off.length ? `<div class="cf-off"><span class="label">не в сети</span>${off.map(u => node(u, u, '', 'user off')).join('')}</div>` : '') +
        `<div class="cf-gws">${cols}</div>` +
        `<div class="cf-svcs">${node('svc', 'сервис чата', 'seq, запись, маршрут')}${node('reg', 'реестр', reg)}${node('db', 'хранилище', 'Cassandra')}${node('push', 'пуши', 'APNs / FCM')}</div>`;
      outEl.innerHTML = outbox.length
        ? '<span class="label">у A на экране</span>' + outbox.map(m => `<span class="cf-msg">→ ${m.to}${m.seq ? ` · seq ${m.seq}` : ''} <b class="${m.status === '✓✓' ? 'dd' : ''}">${m.status}</b></span>`).join('')
        : '';
    }
    reset();
    return { start: () => { if (queue.length || active.length) loop.start(); }, stop: () => loop.stop() };
  });

  // ---------------------------------------------------------------- ordering by seq, gaps, receipts
  Deck.demo('seq', root => {
    const GAP_WAIT = 2, RESEND = 4;
    let next, sent, flight, got, upTo, readPtr, gapSince, syncing, now, lossy, rnd;
    const lossIn = h('input', { type: 'checkbox' });
    lossIn.addEventListener('change', () => { lossy = lossIn.checked; });
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn small primary', onclick: () => burst(5) }, 'Отправить 5'),
        h('button', { class: 'btn small', onclick: () => burst(1) }, 'Отправить 1'),
        h('button', { class: 'btn small', onclick: read }, 'Получатель прочитал'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, lossIn, h('span', null, 'Сеть теряет 25% сообщений')),
    );
    const board = h('div', { class: 'sq-board' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(board, logEl);

    function reset() {
      next = 1; sent = []; flight = []; got = new Set(); upTo = 0; readPtr = 0; gapSince = null; syncing = false; now = 0;
      lossy = lossIn.checked; rnd = 12345;
      say('Сервис назначает номера по порядку. Доставка идёт разными путями и с разной задержкой.');
      render();
    }
    const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
    function launch(seq, kind = 'msg') {
      flight.push({ seq, kind, t: 0, dur: 0.4 + rand() * 1.8, lost: kind === 'msg' && lossy && rand() < 0.25 });
    }
    function burst(k) {
      for (let i = 0; i < k; i++) {
        const seq = next++;
        sent.push({ seq, at: now, last: now });
        launch(seq);
      }
      loop.start();
      render();
    }
    function read() {
      if (readPtr === upTo) { say('Новых показанных сообщений нет — читать нечего.'); return; }
      readPtr = upTo;
      say(`Получатель дочитал до seq ${upTo}: одна квитанция <code>read{seq: ${upTo}}</code> закрывает все сообщения до неё.`, 'ok');
      render();
    }
    function arrive(seq, how) {
      if (seq <= upTo || got.has(seq)) { say(`Повторно пришёл seq ${seq} — дубль, клиент его отбрасывает: номер уже есть.`); return; }
      got.add(seq);
      const before = upTo;
      while (got.has(upTo + 1)) upTo++;
      const hole = [...got].some(s => s > upTo);
      if (upTo > before) {
        say(`${how}seq ${seq}. Показываем подряд до ${upTo}, квитанция <code>delivered{seq: ${upTo}}</code>.` + (hole ? ` Дальше дыра: нет ${upTo + 1}.` : ''), hole ? 'warn' : 'ok');
      } else say(`${how}seq ${seq}, но ${upTo + 1} ещё нет. Держим его в буфере и не показываем, чтобы не нарушить порядок.`, 'warn');
      if (hole) { if (gapSince == null) gapSince = now; } else gapSince = null;
    }
    const loop = clockLoop(dt => {
      now += dt;
      for (const f of flight) f.t += dt;
      const done = flight.filter(f => f.t >= f.dur);
      flight = flight.filter(f => f.t < f.dur);
      for (const f of done) {
        if (f.kind === 'sync') {
          syncing = false;
          const missing = sent.map(s => s.seq).filter(s => s > upTo && !got.has(s));
          missing.forEach(s => arrive(s, 'Ответ на sync: '));
          if (!missing.length) say('Sync ничего не вернул: пропавшее сообщение уже догнало.');
        } else if (f.lost) say(`Сеть потеряла seq ${f.seq}. Получатель об этом пока не знает.`, 'bad');
        else arrive(f.seq, f.kind === 'resend' ? 'Повторная отправка: ' : 'Пришёл ');
      }
      if (gapSince != null && !syncing && now - gapSince > GAP_WAIT) {
        syncing = true;
        gapSince = now;
        flight.push({ seq: upTo, kind: 'sync', t: 0, dur: 0.6 });
        say(`Дыра держится ${GAP_WAIT} с — клиент просит <code>sync after=${upTo}</code>.`, 'warn');
      }
      // The server resends what was not acknowledged in time: covers a lost last message, which leaves no visible gap.
      for (const s of sent) {
        if (s.seq > upTo && !got.has(s.seq) && now - s.last > RESEND && !flight.some(f => f.seq === s.seq)) {
          s.last = now;
          flight.push({ seq: s.seq, kind: 'resend', t: 0, dur: 0.5, lost: false });
          say(`Нет <code>delivered</code> для seq ${s.seq} уже ${RESEND} с — сервер отправляет повторно. Потерю последнего сообщения иначе не заметить: дыры нет.`, 'warn');
        }
      }
      if (!flight.length && gapSince == null && upTo === next - 1) { render(); loop.stop(); return; }
      render();
    });
    function render() {
      const mark = s => s <= readPtr ? '<b class="rd">✓✓</b>' : s <= upTo ? '<b>✓✓</b>' : '<b>✓</b>';
      const shown = sent.filter(s => s.seq <= upTo).slice(-6);
      const buf = [...got].filter(s => s > upTo).sort((a, b) => a - b);
      board.innerHTML =
        `<div class="sq-col"><span class="label">отправитель</span>${sent.slice(-6).map(s => `<div class="sq-m">#${s.seq} ${mark(s.seq)}</div>`).join('') || '<span class="empty">пусто</span>'}</div>` +
        `<div class="sq-col sq-net"><span class="label">в сети</span>${flight.map(f =>
          `<div class="sq-f ${f.lost ? 'lost' : ''} ${f.kind}"><span>${f.kind === 'sync' ? 'sync' : '#' + f.seq}</span><i style="width:${Math.min(100, f.t / f.dur * 100)}%"></i></div>`).join('') || '<span class="empty">пусто</span>'}</div>` +
        `<div class="sq-col"><span class="label">получатель</span>${shown.map(s => `<div class="sq-m ${s.seq <= readPtr ? 'read' : ''}">#${s.seq}</div>`).join('') || '<span class="empty">пусто</span>'}` +
        (buf.length ? `<div class="sq-buf">в буфере: ${buf.map(s => '#' + s).join(', ')}<br>ждём #${upTo + 1}</div>` : '') + '</div>';
    }
    reset();
    return { start: () => { if (flight.length || gapSince != null || upTo < next - 1) loop.start(); }, stop: () => loop.stop() };
  });
})();

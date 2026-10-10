// Demos for slides 13–19: outbox, saga, clocks, Raft, fencing tokens.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
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
    return { el: box, set, btns };
  }
  // Timer helper: steps run one after another and are cancelled by reset / slide leave.
  function sequencer() {
    let timers = [];
    return {
      run(fns, gap) { this.cancel(); fns.forEach((f, i) => timers.push(setTimeout(f, gap * (i + 1)))); },
      cancel() { timers.forEach(clearTimeout); timers = []; },
      get busy() { return timers.length > 0; },
      done() { timers = []; },
    };
  }

  // ---------------------------------------------------------------- dual write vs outbox
  Deck.demo('outbox', root => {
    const MODES = {
      cf: { label: 'COMMIT → publish', steps: ['BEGIN; INSERT orders', 'COMMIT', 'publish OrderCreated'] },
      pf: { label: 'publish → COMMIT', steps: ['BEGIN; INSERT orders', 'publish OrderCreated', 'COMMIT'] },
      ob: { label: 'Outbox + relay', steps: ['BEGIN; INSERT orders; INSERT outbox', 'COMMIT', 'relay: SELECT … WHERE NOT sent', 'relay: publish OrderCreated', 'relay: UPDATE outbox SET sent'] },
    };
    let mode = 'cf', crashAt = 1, db, kafka, cur, seq = sequencer();
    choice(root, Object.entries(MODES).map(([k, v]) => [k, v.label]), mode, v => { mode = v; crashAt = v === 'ob' ? 3 : 1; reset(); });
    const stepsEl = h('div', { class: 'ob-steps' });
    const runBtn = h('button', { class: 'btn primary', onclick: run }, 'Выполнить');
    root.append(h('p', { class: 'note' }, 'Нажмите на шаг, после которого процесс упадёт.'), stepsEl,
      h('div', { class: 'controls' }, runBtn, h('button', { class: 'btn', onclick: () => { crashAt = -1; reset(); } }, 'Без сбоя')));
    const pg = h('div', { class: 'ob-store' });
    const kf = h('div', { class: 'ob-store kafka' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    root.append(h('div', { class: 'ob-stores' }, pg, kf), logEl);

    function reset() {
      seq.cancel();
      db = { orders: [], outbox: [], tx: null };
      kafka = [];
      cur = -1;
      say(crashAt < 0 ? 'Сбоя не будет. Нажмите «Выполнить».' : `Процесс упадёт после шага ${crashAt + 1}. Нажмите «Выполнить».`);
      render();
    }
    function apply(i, relayRun) {
      const s = MODES[mode].steps[i];
      if (s.startsWith('BEGIN')) db.tx = { order: true, outbox: mode === 'ob' };
      else if (s === 'COMMIT') {
        db.orders.push('#42');
        if (db.tx.outbox) db.outbox.push({ id: '#42', sent: false });
        db.tx = null;
      } else if (s === 'publish OrderCreated') kafka.push('OrderCreated #42');
      else if (s.startsWith('relay: SELECT')) relayRun.rows = db.outbox.filter(r => !r.sent);
      else if (s.startsWith('relay: publish')) relayRun.rows.forEach(r => kafka.push('OrderCreated ' + r.id));
      else if (s.startsWith('relay: UPDATE')) relayRun.rows.forEach(r => { r.sent = true; });
    }
    function verdict(note) {
      const order = db.orders.length > 0, ev = kafka.length;
      if (order && ev === 1) say((note || '') + 'Заказ сохранён, событие опубликовано один раз. Всё согласовано.', 'ok');
      else if (order && ev > 1) say((note || '') + `Заказ есть, событие опубликовано ${ev} раза. Дубль — нормальная плата за at-least-once: потребитель отфильтрует его по ID.`, 'warn');
      else if (order && !ev) say((note || '') + 'Заказ в базе есть, а события нет и уже не будет. Склад и доставка о заказе не узнают.', 'bad');
      else if (!order && ev) say((note || '') + 'Транзакция откатилась, заказа нет, а событие о нём уже ушло. Склад резервирует товар под несуществующий заказ.', 'bad');
      else say((note || '') + 'Транзакция откатилась, события нет. Клиент получил ошибку и повторит — согласовано.', 'ok');
    }
    function run() {
      reset();
      const steps = MODES[mode].steps;
      const relayRun = {};
      const fns = [];
      let crashed = false;
      for (let i = 0; i < steps.length; i++) {
        fns.push(() => { cur = i; apply(i, relayRun); render(); });
        if (i === crashAt) {
          crashed = true;
          if (mode !== 'ob' || i < 1) {
            fns.push(() => {
              if (db.tx) db.tx = null;
              cur = -2; render();
              verdict(`Процесс упал после шага ${i + 1}${i === 0 ? ' — незакоммиченная транзакция откатилась' : ''}. `);
            });
            break;
          }
          if (i === 1) {
            fns.push(() => say('Сервис упал после COMMIT — не страшно: событие уже лежит в outbox, relay работает отдельно и отправит его.', 'warn'));
          } else {
            fns.push(() => { say(`Relay упал после шага ${i + 1}. Перезапуск: он снова выбирает неотправленные строки.`, 'warn'); });
            for (let j = 2; j < steps.length; j++) fns.push(() => { cur = j; apply(j, relayRun); render(); });
            break;
          }
        }
      }
      fns.push(() => { cur = -1; render(); verdict(); seq.done(); runBtn.disabled = false; });
      runBtn.disabled = true;
      seq.run(fns, 650);
      if (!crashed) say('Выполняем без сбоя…');
    }
    function render() {
      const steps = MODES[mode].steps;
      stepsEl.innerHTML = '';
      steps.forEach((s, i) => {
        const b = h('button', { class: 'ob-step' + (i === cur ? ' cur' : '') + (i === crashAt ? ' crash' : '') + (s.startsWith('relay') ? ' relay' : ''),
          onclick: () => { if (seq.busy) return; crashAt = crashAt === i ? -1 : i; reset(); } },
          h('span', { class: 'n' }, i + 1), h('code', null, s));
        stepsEl.append(b);
        if (i === crashAt) stepsEl.append(h('div', { class: 'ob-boom' }, 'сбой процесса'));
      });
      const ord = db.orders.map(o => `<span class="ob-row">order ${o}</span>`).join('') + (db.tx ? '<span class="ob-row tx">order #42 (не закоммичено)</span>' : '');
      const out = mode === 'ob' ? `<span class="label">outbox</span><div class="ob-rows">${db.outbox.map(r => `<span class="ob-row ${r.sent ? 'sent' : ''}">#42 ${r.sent ? 'sent' : 'new'}</span>`).join('') || '<span class="empty">пусто</span>'}</div>` : '';
      pg.innerHTML = `<b>Postgres</b><span class="label">orders</span><div class="ob-rows">${ord || '<span class="empty">пусто</span>'}</div>${out}`;
      kf.innerHTML = `<b>Kafka</b><span class="label">orders-events</span><div class="ob-rows">${kafka.map(e => `<span class="ob-row ev">${e}</span>`).join('') || '<span class="empty">пусто</span>'}</div>`;
    }
    reset();
    return { stop() { if (seq.busy) { seq.cancel(); runBtn.disabled = false; reset(); } } };
  });

  // ---------------------------------------------------------------- saga
  Deck.demo('saga', root => {
    const STEPS = [
      { svc: 'Заказы', do: 'заказ PENDING', undo: 'заказ CANCELLED', ev: 'OrderCreated', uev: 'OrderCancelled' },
      { svc: 'Платежи', do: 'списано 1000 ₽', undo: 'возврат 1000 ₽', ev: 'PaymentDone', uev: 'PaymentRefunded', fail: 'PaymentFailed', fmsg: 'карта отклонена' },
      { svc: 'Склад', do: 'товар в резерве', undo: 'резерв снят', ev: 'StockReserved', uev: 'StockReleased', fail: 'OutOfStock', fmsg: 'товара нет' },
      { svc: 'Доставка', do: 'курьер назначен', undo: '', ev: 'CourierAssigned', fail: 'NoCourier', fmsg: 'нет курьеров' },
    ];
    let mode = 'orch', failAt = 2, state, msgs, seq = sequencer();
    choice(root, [['orch', 'Оркестрация'], ['chor', 'Хореография']], mode, v => { mode = v; reset(); });
    choice(root, [['-1', 'Без сбоя'], ['1', 'Платёж отклонён'], ['2', 'Нет на складе'], ['3', 'Нет курьеров']], String(failAt), v => { failAt = +v; reset(); });
    const runBtn = h('button', { class: 'btn primary', onclick: run }, 'Оформить заказ');
    root.append(h('div', { class: 'controls' }, runBtn));
    const svcs = h('div', { class: 'sg-svcs' });
    const msgEl = h('ol', { class: 'sg-msgs' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    root.append(svcs, msgEl, logEl);

    function reset() {
      seq.cancel();
      runBtn.disabled = false;
      state = STEPS.map(() => 'idle');
      msgs = [];
      say(mode === 'orch' ? 'Оркестратор знает весь сценарий и по очереди вызывает сервисы.' : 'Центра нет: каждый сервис слушает события и публикует свои.');
      render();
    }
    function run() {
      reset();
      runBtn.disabled = true;
      const fns = [];
      const O = mode === 'orch';
      const last = failAt < 0 ? STEPS.length - 1 : failAt;
      for (let i = 0; i <= last; i++) {
        const s = STEPS[i];
        const fail = i === failAt;
        fns.push(() => {
          state[i] = fail ? 'fail' : 'done';
          if (O) msgs.push(`Оркестратор → ${s.svc}: выполнить`, fail ? `${s.svc} → оркестратор: ошибка (${s.fmsg})` : `${s.svc} → оркестратор: OK`);
          else msgs.push(i === 0 ? `Заказы публикуют <code>${s.ev}</code>` : fail ? `${s.svc} слышат <code>${STEPS[i - 1].ev}</code>, но ${s.fmsg} → <code>${s.fail}</code>` : `${s.svc} слышат <code>${STEPS[i - 1].ev}</code> → <code>${s.ev}</code>`);
          render();
        });
      }
      if (failAt >= 0) {
        for (let i = failAt - 1; i >= 0; i--) {
          const s = STEPS[i];
          fns.push(() => {
            state[i] = 'undo';
            if (O) msgs.push(`Оркестратор → ${s.svc}: компенсировать (${s.undo})`);
            else {
              const trigger = i === failAt - 1 ? STEPS[failAt].fail : STEPS[i + 1].uev;
              msgs.push(`${s.svc} слышат <code>${trigger}</code> → ${s.undo}${s.uev ? ` → <code>${s.uev}</code>` : ''}`);
            }
            render();
          });
        }
      } else fns.push(() => { msgs.push(O ? 'Оркестратор → Заказы: подтвердить' : 'Заказы слышат <code>CourierAssigned</code> → заказ CONFIRMED'); state[0] = 'final'; render(); });
      fns.push(() => {
        runBtn.disabled = false;
        seq.done();
        if (failAt < 0) say('Все шаги прошли, заказ CONFIRMED.', 'ok');
        else say(`Шаг «${STEPS[failAt].svc}» не удался — ${failAt} ${plural(failAt, ['предыдущий шаг отменён', 'предыдущих шага отменены', 'предыдущих шагов отменены'])} компенсациями в обратном порядке. ${failAt >= 2 ? 'Деньги вернулись, з' : 'З'}аказ CANCELLED.`, 'warn');
      });
      seq.run(fns, 700);
    }
    function render() {
      svcs.innerHTML = STEPS.map((s, i) => {
        const st = state[i];
        const txt = st === 'idle' ? '—' : st === 'done' ? s.do : st === 'final' ? 'заказ CONFIRMED' : st === 'fail' ? s.fmsg : s.undo;
        return `<div class="sg-svc ${st}"><b>${s.svc}</b><span>${txt}</span></div>`;
      }).join('');
      msgEl.innerHTML = msgs.slice(-7).map(m => `<li>${m}</li>`).join('') || '<li class="empty">сообщений пока нет</li>';
      msgEl.start = Math.max(1, msgs.length - 6);
    }
    reset();
    return { stop() { if (seq.busy) reset(); } };
  });

  // ---------------------------------------------------------------- wall clocks vs Lamport clocks
  Deck.demo('clocks', root => {
    const NODES = ['A', 'B', 'C'];
    // Real-time script (ms). A writes x=1 and replicates; B sees it, then writes x=2.
    const EVENTS = [
      { t: 20, node: 'A', kind: 'write', val: 1 },
      { t: 60, node: 'B', kind: 'recv', from: 0 },
      { t: 100, node: 'B', kind: 'write', val: 2 },
      { t: 140, node: 'C', kind: 'recv', from: 2 },
      { t: 170, node: 'A', kind: 'recv', from: 2 },
      { t: 210, node: 'C', kind: 'recv', from: 0 },
    ];
    let mode = 'wall', skew = 120, shown = EVENTS.length;
    choice(root, [['wall', 'Метка = время сервера'], ['lamport', 'Метка = часы Лэмпорта']], mode, v => { mode = v; update(); });
    const sIn = h('input', { type: 'range', min: 0, max: 200, step: 10, value: skew, 'aria-label': 'Отставание часов B' });
    const sOut = h('output');
    sIn.addEventListener('input', () => { skew = +sIn.value; update(); });
    const skewRow = h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Часы B отстают на'), sIn, sOut);
    root.append(skewRow, h('div', { class: 'controls' },
      h('button', { class: 'btn small', onclick: () => { shown = 0; update(); } }, 'Сначала'),
      h('button', { class: 'btn small primary', onclick: () => { shown = Math.min(EVENTS.length, shown + 1); update(); } }, 'Шаг'),
      h('button', { class: 'btn small', onclick: () => { shown = EVENTS.length; update(); } }, 'Всё сразу')));
    const svgWrap = h('div', { class: 'ck-svg' });
    const result = h('div', { class: 'ck-res' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    root.append(svgWrap, result, logEl);

    const W = 360, H = 190, X0 = 34, X1 = 350, LANE = { A: 38, B: 98, C: 158 };
    const xOf = t => X0 + (t / 230) * (X1 - X0);
    function simulate() {
      const reg = { A: null, B: null, C: null };
      const L = { A: 0, B: 0, C: 0 };
      const stamps = [];
      const notes = [];
      const greater = (a, b) => !b || a.ts > b.ts || (a.ts === b.ts && a.node > b.node);
      EVENTS.slice(0, shown).forEach((e, i) => {
        if (e.kind === 'write') {
          let ts;
          if (mode === 'wall') ts = e.t + (e.node === 'B' ? -skew : 0);
          else ts = ++L[e.node];
          const w = { val: e.val, ts, node: e.node };
          stamps[i] = w;
          const ok = greater(w, reg[e.node]);
          if (ok) reg[e.node] = w;
          notes[i] = ok ? `${e.node}: запись x=${e.val} с меткой ${fmtTs(ts)}.` :
            `${e.node}: клиент пишет x=${e.val}, но метка ${fmtTs(ts)} меньше, чем у уже лежащего x=${reg[e.node].val} (${fmtTs(reg[e.node].ts)}). Собственная запись B молча отброшена!`;
          stamps[i].lost = !ok;
        } else {
          const w = stamps[e.from];
          if (mode === 'lamport') L[e.node] = Math.max(L[e.node], w.ts) + 1;
          const ok = greater(w, reg[e.node]);
          if (ok) reg[e.node] = w;
          notes[i] = `${e.node} получил x=${w.val} (${fmtTs(w.ts)})` + (reg[e.node] === w ? ' и применил.' : `, но у него x=${reg[e.node].val} с большей меткой — пропускает.`) +
            (mode === 'lamport' ? ` Счётчик ${e.node} = max(…, ${w.ts}) + 1 = ${L[e.node]}.` : '');
          stamps[i] = { recv: true, l: L[e.node] };
        }
      });
      return { reg, stamps, notes };
    }
    const pad = (v, k = 2) => String(v).padStart(k, '0');
    const fmtTs = ts => {
      if (mode !== 'wall') return `L=${ts}`;
      const t = 10 * 3600000 + ts; // реальное время 10:00:00.000 + ts мс
      return `${pad(Math.floor(t / 3600000))}:${pad(Math.floor(t / 60000) % 60)}:${pad(Math.floor(t / 1000) % 60)}.${pad(t % 1000, 3)}`;
    };
    function update() {
      sOut.textContent = skew + ' мс';
      skewRow.style.opacity = mode === 'wall' ? 1 : 0.4;
      const { reg, stamps, notes } = simulate();
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Диаграмма событий на трёх узлах">`;
      NODES.forEach(n => {
        svg += `<line x1="${X0}" y1="${LANE[n]}" x2="${X1}" y2="${LANE[n]}" class="ck-lane"/><text x="6" y="${LANE[n] + 5}" class="ck-node">${n}</text>`;
      });
      svg += `<text x="${X1}" y="${H - 4}" class="ck-axis" text-anchor="end">реальное время →</text>`;
      EVENTS.forEach((e, i) => {
        if (e.kind !== 'recv') return;
        const src = EVENTS[e.from];
        const on = i < shown;
        svg += `<line x1="${xOf(src.t)}" y1="${LANE[src.node]}" x2="${xOf(e.t)}" y2="${LANE[e.node]}" class="ck-msg ${on ? '' : 'off'}" marker-end="url(#ckarr)"/>`;
      });
      svg += '<defs><marker id="ckarr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="ck-arrhead"/></marker></defs>';
      EVENTS.forEach((e, i) => {
        if (i >= shown) return;
        const x = xOf(e.t), y = LANE[e.node];
        const s = stamps[i];
        if (e.kind === 'write') {
          svg += `<circle cx="${x}" cy="${y}" r="8" class="ck-w ${s.lost ? 'lost' : ''}"/>`;
          svg += `<text x="${x}" y="${y - 13}" class="ck-lbl" text-anchor="middle">x=${e.val} · ${fmtTs(s.ts)}</text>`;
        } else {
          svg += `<circle cx="${x}" cy="${y}" r="5" class="ck-r"/>`;
          if (mode === 'lamport') svg += `<text x="${x}" y="${y + 18}" class="ck-lbl sm" text-anchor="middle">L=${s.l}</text>`;
        }
      });
      svg += '</svg>';
      svgWrap.innerHTML = svg;
      result.innerHTML = NODES.map(n => {
        const r = reg[n];
        const wrong = shown === EVENTS.length && r && r.val !== 2;
        return `<div class="ck-cell ${wrong ? 'bad' : shown === EVENTS.length && r ? 'good' : ''}"><span class="label">${n}</span><b>${r ? 'x=' + r.val : '—'}</b></div>`;
      }).join('');
      if (shown === 0) say('Шагайте по событиям или нажмите «Всё сразу».');
      else if (shown < EVENTS.length) say(notes[shown - 1], stamps[2] && stamps[2].lost ? 'bad' : '');
      else {
        const lost = NODES.some(n => reg[n].val !== 2);
        if (mode === 'wall' && lost) say(`B записал x=2 позже и зная про x=1, но его часы отстают на ${skew} мс: метка ${fmtTs(100 - skew)} меньше, чем ${fmtTs(20)} у x=1. «Побеждает последняя запись» сохранила x=1 — запись x=2 потеряна без единой ошибки.`, 'bad');
        else if (mode === 'wall') say(`Пока отставание меньше 80 мс (разница между записями), метки в правильном порядке. Увеличьте его — порядок перевернётся.`, 'warn');
        else say('Часы Лэмпорта: B получил x=1 с L=1 и поставил себе 2, его запись получила L=3 &gt; 1. Причина всегда меньше следствия, поэтому все реплики сходятся на x=2 — при любом расхождении физических часов.', 'ok');
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- Raft
  Deck.demo('raft', root => {
    const HB = 0.6, EL_MIN = 1.5, EL_MAX = 3, D_MIN = 0.25, D_MAX = 0.4;
    let n = 3, nodes, msgs, now, wn, rnd = Math.random;
    choice(root, [['3', '3 узла'], ['5', '5 узлов']], '3', v => { n = +v; reset(); });
    const writeBtn = h('button', { class: 'btn primary', onclick: write }, 'Записать');
    root.append(h('div', { class: 'controls' }, writeBtn,
      h('button', { class: 'btn danger', onclick: killLeader }, 'Уронить лидера'),
      h('button', { class: 'btn', onclick: reset }, 'Сброс')));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '46 0 208 200');
    svg.setAttribute('class', 'rf-svg');
    const info = h('div', { class: 'rf-info' });
    const logs = h('div', { class: 'rf-logs' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('div', { class: 'rf-top' }, svg, info), logs, logEl);
    svg.addEventListener('pointerdown', e => {
      const g = e.target.closest('[data-node]');
      if (g) toggle(+g.dataset.node);
    });

    const maj = () => Math.floor(n / 2) + 1;
    const rand = (a, b) => a + rnd() * (b - a);
    const pos = i => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [150 + 72 * Math.cos(a), 100 + 72 * Math.sin(a)];
    };
    function reset() {
      now = 0; wn = 0; msgs = [];
      nodes = Array.from({ length: n }, (_, i) => ({
        id: i, alive: true, state: 'follower', term: 0, voted: null, log: [], commit: -1,
        deadline: rand(0.8, 2.2), tmo: 0, votes: new Set(), next: [], match: [], hbAt: 0,
      }));
      nodes.forEach(x => { x.tmo = x.deadline; });
      say(`Все узлы — ведомые, лидера нет. У каждого свой случайный таймаут выборов (кольцо вокруг узла). Кворум — ${maj()} из ${n}.`);
      render();
    }
    function send(from, to, type, body) {
      const d = rand(D_MIN, D_MAX);
      msgs.push({ from, to, type, body, t0: now, t1: now + d });
    }
    function resetTimer(x) { x.tmo = rand(EL_MIN, EL_MAX); x.deadline = now + x.tmo; }
    function stepDown(x, term) {
      if (term > x.term) { x.term = term; x.voted = null; }
      if (x.state !== 'follower') { x.state = 'follower'; }
      resetTimer(x);
    }
    const lastTerm = x => x.log.length ? x.log[x.log.length - 1].term : 0;
    function startElection(x) {
      x.state = 'candidate'; x.term++; x.voted = x.id; x.votes = new Set([x.id]);
      resetTimer(x);
      say(`S${x.id + 1} не слышал лидера дольше таймаута: стал кандидатом, срок ${x.term}, голосует за себя и просит голоса у остальных.`, 'warn');
      nodes.forEach(p => { if (p !== x) send(x.id, p.id, 'rv', { term: x.term, li: x.log.length - 1, lt: lastTerm(x) }); });
    }
    function becomeLeader(x) {
      x.state = 'leader';
      x.next = nodes.map(() => x.log.length);
      x.match = nodes.map(() => -1);
      say(`S${x.id + 1} собрал ${x.votes.size} ${plural(x.votes.size, ['голос', 'голоса', 'голосов'])} из ${n} — лидер срока ${x.term}. Рассылает heartbeat, чтобы остальные не начинали выборы.`, 'ok');
      heartbeat(x);
    }
    function sendAE(x, p) {
      const prev = x.next[p.id] - 1;
      send(x.id, p.id, 'ae', { term: x.term, prev, pt: prev >= 0 ? x.log[prev].term : 0, entries: x.log.slice(prev + 1).map(e => ({ ...e })), commit: x.commit });
    }
    function heartbeat(x) {
      x.hbAt = now + HB;
      nodes.forEach(p => { if (p !== x) sendAE(x, p); });
    }
    function advanceCommit(x) {
      for (let N = x.log.length - 1; N > x.commit; N--) {
        if (x.log[N].term !== x.term) break;
        const cnt = 1 + nodes.filter(p => p !== x && x.match[p.id] >= N).length;
        if (cnt >= maj()) {
          const nNew = N - x.commit;
          x.commit = N;
          say(`Запись ${x.log[N].val} есть у ${cnt} из ${n} — это большинство. Лидер считает её подтверждённой и отвечает клиенту.`, 'ok');
          return nNew;
        }
      }
      return 0;
    }
    function deliver(m) {
      const x = nodes[m.to];
      if (!x.alive) return;
      const b = m.body;
      if (b.term > x.term) stepDown(x, b.term);
      if (m.type === 'rv') {
        const upToDate = b.lt > lastTerm(x) || (b.lt === lastTerm(x) && b.li >= x.log.length - 1);
        const grant = b.term === x.term && (x.voted == null || x.voted === m.from) && upToDate;
        if (grant) { x.voted = m.from; resetTimer(x); }
        send(x.id, m.from, 'rvr', { term: x.term, granted: grant });
      } else if (m.type === 'rvr') {
        if (x.state === 'candidate' && b.term === x.term && b.granted) {
          x.votes.add(m.from);
          if (x.votes.size >= maj()) becomeLeader(x);
        }
      } else if (m.type === 'ae') {
        if (b.term < x.term) { send(x.id, m.from, 'aer', { term: x.term, ok: false }); return; }
        if (x.state !== 'follower') x.state = 'follower';
        resetTimer(x);
        if (b.prev >= 0 && (x.log.length <= b.prev || x.log[b.prev].term !== b.pt)) {
          send(x.id, m.from, 'aer', { term: x.term, ok: false });
          return;
        }
        b.entries.forEach((e, k) => {
          const idx = b.prev + 1 + k;
          if (x.log[idx] && x.log[idx].term !== e.term) x.log.length = idx;
          if (!x.log[idx]) x.log[idx] = e;
        });
        const match = b.prev + b.entries.length;
        if (b.commit > x.commit) x.commit = Math.min(b.commit, match);
        send(x.id, m.from, 'aer', { term: x.term, ok: true, match });
      } else if (m.type === 'aer') {
        if (x.state !== 'leader' || b.term !== x.term) return;
        const p = m.from;
        if (b.ok) {
          x.match[p] = Math.max(x.match[p], b.match);
          x.next[p] = x.match[p] + 1;
          advanceCommit(x);
        } else {
          x.next[p] = Math.max(0, x.next[p] - 1);
          sendAE(x, nodes[p]);
        }
      }
    }
    const leader = () => nodes.filter(x => x.alive && x.state === 'leader').sort((a, b) => b.term - a.term)[0];
    function write() {
      const L = leader();
      if (!L) { say('Лидера сейчас нет — записывать некуда. Клиент подождёт и повторит.', 'warn'); return; }
      wn++;
      L.log.push({ term: L.term, val: 'x=' + wn });
      say(`Клиент → S${L.id + 1}: x=${wn}. Лидер добавил запись в свой журнал (срок ${L.term}) и рассылает её ведомым. Пока она не у большинства — не подтверждена.`);
      nodes.forEach(p => { if (p !== L) sendAE(L, p); });
      L.hbAt = now + HB;
    }
    function toggle(i) {
      const x = nodes[i];
      if (x.alive) {
        x.alive = false;
        const alive = nodes.filter(y => y.alive).length;
        say(`S${i + 1} упал${x.state === 'leader' ? ' — это был лидер. Ведомые перестанут получать heartbeat и через таймаут начнут выборы' : ''}. Живых ${alive} из ${n}${alive < maj() ? ' — меньше кворума: лидера не выбрать, записи не подтверждаются' : ''}.`, alive < maj() ? 'bad' : 'warn');
      } else {
        x.alive = true; x.state = 'follower'; x.commit = -1; resetTimer(x);
        say(`S${i + 1} вернулся с журналом и сроком ${x.term} с диска. Он ведомый; лидер догонит его журнал.`);
      }
    }
    function killLeader() {
      const L = leader();
      if (!L) { say('Лидера сейчас нет.', 'warn'); return; }
      toggle(L.id);
    }
    function tick(dt) {
      now += dt;
      const due = msgs.filter(m => m.t1 <= now);
      msgs = msgs.filter(m => m.t1 > now);
      due.forEach(deliver);
      nodes.forEach(x => {
        if (!x.alive) return;
        if (x.state === 'leader') { if (now >= x.hbAt) heartbeat(x); }
        else if (now >= x.deadline) startElection(x);
      });
    }
    const TERMC = ['#e03131', '#1c7ed6', '#2f9e44', '#f08c00', '#7048e8', '#0c8599'];
    const tc = t => TERMC[(t - 1 + TERMC.length) % TERMC.length];
    const ROLE = { leader: 'лидер', candidate: 'кандидат', follower: 'ведомый' };
    function render() {
      let s = '';
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const [a, b] = [pos(i), pos(j)];
        s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="rf-edge"/>`;
      }
      msgs.forEach(m => {
        const [a, b] = [pos(m.from), pos(m.to)];
        const k = Math.min(1, (now - m.t0) / (m.t1 - m.t0));
        s += `<circle cx="${a[0] + (b[0] - a[0]) * k}" cy="${a[1] + (b[1] - a[1]) * k}" r="${m.type === 'ae' && m.body.entries.length ? 5 : 3.5}" class="rf-m ${m.type}"/>`;
      });
      nodes.forEach((x, i) => {
        const [cx, cy] = pos(i);
        const C = 2 * Math.PI * 25;
        const left = x.alive && x.state !== 'leader' ? Math.max(0, (x.deadline - now) / x.tmo) : 0;
        s += `<g data-node="${i}" class="rf-n ${x.alive ? x.state : 'down'}" style="cursor:pointer">` +
          `<circle cx="${cx}" cy="${cy}" r="25" class="rf-ring-bg"/>` +
          `<circle cx="${cx}" cy="${cy}" r="25" class="rf-ring" stroke-dasharray="${C * left} ${C}" transform="rotate(-90 ${cx} ${cy})"/>` +
          `<circle cx="${cx}" cy="${cy}" r="20" class="rf-body"/>` +
          `<text x="${cx}" y="${cy - 1}" class="rf-id">S${i + 1}</text>` +
          `<text x="${cx}" y="${cy + 10}" class="rf-t">${x.alive ? 'срок ' + x.term : 'упал'}</text></g>`;
      });
      svg.innerHTML = s;
      const L = leader();
      const alive = nodes.filter(x => x.alive).length;
      info.innerHTML = `<div><span class="label">лидер</span><b>${L ? 'S' + (L.id + 1) : '—'}</b></div>` +
        `<div><span class="label">срок</span><b>${Math.max(...nodes.map(x => x.term))}</b></div>` +
        `<div><span class="label">кворум</span><b>${maj()} из ${n}</b></div>` +
        `<div class="${alive < maj() ? 'bad' : ''}"><span class="label">живы</span><b>${alive}</b></div>` +
        `<p class="rf-hint">Нажмите на узел, чтобы уронить или поднять его.</p>`;
      const maxLen = Math.max(1, ...nodes.map(x => x.log.length));
      const from = Math.max(0, maxLen - 8);
      logs.innerHTML = nodes.map((x, i) => `<div class="rf-row ${x.alive ? '' : 'down'}"><b>S${i + 1}</b>` +
        x.log.slice(from).map((e, k) => `<span class="rf-e ${from + k <= x.commit ? 'c' : ''}" style="--tc:${tc(e.term)}">${e.val}<sub>${e.term}</sub></span>`).join('') + '</div>').join('') +
        '<p class="rf-hint">Цвет и индекс — срок записи. Сплошная — подтверждена (commit), контур — ещё нет.</p>';
      writeBtn.disabled = !L;
    }
    reset();
    return rafLoop(dt => { tick(dt); render(); });
  });

  // ---------------------------------------------------------------- lease + fencing token
  Deck.demo('fencing', root => {
    let fence = false, step = 0;
    const STEPS = 5;
    const fIn = h('input', { type: 'checkbox' });
    fIn.addEventListener('change', () => { fence = fIn.checked; update(); });
    const nextBtn = h('button', { class: 'btn primary', onclick: () => { step = Math.min(STEPS, step + 1); update(); } }, 'Дальше');
    root.append(h('label', { class: 'toggle' }, fIn, h('span', null, 'Хранилище проверяет fencing-токен')),
      h('div', { class: 'controls' }, nextBtn, h('button', { class: 'btn', onclick: () => { step = 0; update(); } }, 'Сначала')));
    const tl = h('div', { class: 'fn-tl' });
    const store = h('div', { class: 'fn-store' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    root.append(tl, store, logEl);
    const T = 28, pct = t => (t / T * 100) + '%';
    function seg(a, b, cls, text) { return `<span class="fn-seg ${cls}" style="left:${pct(a)};width:${pct(b - a)}">${text}</span>`; }
    function mark(t, cls, text) { return `<span class="fn-mark ${cls}" style="left:${pct(t)}"><i></i><em>${text}</em></span>`; }
    function update() {
      let c1 = '', c2 = '', ls = '';
      if (step >= 1) { c1 += mark(0, '', 'токен 33'); ls += seg(0, 10, 'l1', 'аренда C1 · TTL 10 с'); }
      if (step >= 2) c1 += seg(5, 20, 'gc', 'пауза GC 15 с');
      if (step >= 3) { ls += seg(11, 28, 'l2', 'аренда C2'); c2 += mark(11, '', 'токен 34'); }
      if (step >= 4) c2 += mark(16, 'w ok', 'запись (34)');
      const rejected = fence;
      if (step >= 5) c1 += mark(20.5, 'w ' + (rejected ? 'no' : 'bad'), 'запись (33)');
      tl.innerHTML = `<div class="fn-row"><b>Клиент 1</b><div class="fn-track">${c1}</div></div>` +
        `<div class="fn-row"><b>Клиент 2</b><div class="fn-track">${c2}</div></div>` +
        `<div class="fn-row"><b>Сервис блокировок</b><div class="fn-track">${ls}</div></div>` +
        `<div class="fn-row axis"><b></b><div class="fn-track">${[0, 5, 10, 15, 20, 25].map(s => `<span style="left:${pct(s)}">${s} с</span>`).join('')}</div></div>`;
      const data = step >= 5 && !rejected ? 'данные C1 поверх C2' : step >= 4 ? 'данные C2' : 'исходные';
      const max = fence ? (step >= 4 ? 34 : '—') : 'не хранит';
      store.innerHTML = `<div class="${step >= 5 && !rejected ? 'bad' : ''}"><span class="label">файл в хранилище</span><b>${data}</b></div><div><span class="label">макс. токен</span><b>${max}</b></div>`;
      const texts = [
        'Клиенты 1 и 2 хотят по очереди обновлять один файл. Блокировка — аренда на 10 с в etcd или ZooKeeper. Нажимайте «Дальше».',
        'Клиент 1 получил аренду на 10 с и fencing-токен 33 — номер, который растёт с каждой выдачей.',
        'Клиент 1 замер: пауза GC на 15 с. Он не знает, что время идёт, и продлить аренду не может.',
        'Через 10 с аренда истекла. Сервис блокировок честно выдал её клиенту 2 с токеном 34.',
        `Клиент 2 записал файл${fence ? ' с токеном 34. Хранилище запомнило: максимальный токен — 34.' : '.'}`,
        fence ? 'Клиент 1 проснулся и пишет с токеном 33. Хранилище видит 33 &lt; 34 и отвергает запись. Клиент 1 узнаёт, что потерял блокировку.'
          : 'Клиент 1 проснулся, уверен, что держит блокировку, и пишет. Хранилище принимает: два владельца, данные клиента 2 затёрты. Проверка «аренда ещё моя?» перед записью не спасает — пауза может случиться между проверкой и записью.',
      ];
      say(texts[step], step === 5 ? (fence ? 'ok' : 'bad') : step === 3 ? 'warn' : '');
      nextBtn.disabled = step >= STEPS;
    }
    update();
    return {};
  });
})();

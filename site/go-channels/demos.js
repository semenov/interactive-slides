(() => {
  'use strict';
  const { h, highlight } = Deck;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const { plural, rafLoop } = Deck;
  const G_FORMS = ['горутина', 'горутины', 'горутин'];

  const chip = (text, cls = '') => `<span class="gchip ${cls}">${text}</span>`;
  const val = v => `<span class="val">${v}</span>`;

  // ---------------------------------------------------------------- go + WaitGroup
  Deck.demo('waitgroup', root => {
    const MAX = 6;
    let workers, mainState, nextId;
    const lanes = h('div', { class: 'lanes' });
    const status = h('p', { class: 'log' });
    const wg = h('input', { type: 'checkbox', checked: true });
    const spawnBtn = h('button', { class: 'btn primary', onclick: spawn }, h('code', null, 'go worker()'));
    const exitBtn = h('button', { class: 'btn', onclick: exit }, 'main завершается');
    const resetBtn = h('button', { class: 'btn', onclick: reset }, 'Заново');
    const mainLane = lane('main', 'main');

    root.append(
      h('div', { class: 'controls' }, spawnBtn, exitBtn, resetBtn),
      h('label', { class: 'toggle' }, wg, h('span', null, 'перед выходом вызвать ', h('code', null, 'wg.Wait()'))),
      lanes,
      status,
    );

    function lane(label, cls) {
      const fill = h('div', { class: 'fill' });
      const state = h('span', { class: 'lane-state' });
      const el = h('div', { class: 'lane ' + cls }, h('span', { class: 'gchip' }, label), h('div', { class: 'track' }, fill), state);
      return { el, fill, state };
    }

    function reset() {
      workers = [];
      mainState = 'running';
      nextId = 1;
      lanes.replaceChildren(mainLane.el);
      say('Запустите несколько горутин, а затем завершите main — с wg.Wait() и без.');
      sync();
    }

    function spawn() {
      if (mainState !== 'running' || workers.length >= MAX) return;
      const id = nextId++;
      const l = lane('G' + id, 'is-running');
      const w = { id, dur: 2 + Math.random() * 3, p: 0, state: 'running', el: l.el, fill: l.fill, stateEl: l.state };
      workers.push(w);
      lanes.append(w.el);
      say(`Запущена G${w.id}. main не ждёт и сразу идёт дальше.`);
      sync();
    }

    function exit() {
      if (mainState !== 'running') return;
      const running = workers.filter(w => w.state === 'running');
      if (wg.checked && running.length) {
        mainState = 'waiting';
        say(`main ждёт в wg.Wait(): ещё ${running.length} ${plural(running.length, G_FORMS)} не вызвали Done().`);
      } else {
        running.forEach(w => { w.state = 'killed'; });
        mainState = 'exited';
        say(running.length
          ? `main вернулась — процесс завершён. ${running.length} ${plural(running.length, G_FORMS)} убиты, не доделав работу.`
          : 'main вернулась. Все горутины к этому моменту уже закончили — повезло.');
      }
      sync();
    }

    function say(text, cls = '') { status.textContent = text; status.className = 'log ' + cls; }

    const STATE_TEXT = { running: 'работает', done: 'Done()', killed: 'убита' };
    function sync() {
      for (const w of workers) {
        w.el.className = 'lane is-' + w.state;
        w.fill.style.width = w.p * 100 + '%';
        w.stateEl.textContent = STATE_TEXT[w.state];
      }
      mainLane.el.className = 'lane main is-' + mainState;
      mainLane.state.textContent = { running: 'выполняется', waiting: 'wg.Wait()', exited: 'return' }[mainState];
      spawnBtn.disabled = mainState !== 'running' || workers.length >= MAX;
      exitBtn.disabled = mainState !== 'running';
    }

    const loop = rafLoop(dt => {
      let changed = false;
      for (const w of workers) {
        if (w.state !== 'running') continue;
        w.p = Math.min(1, w.p + dt / w.dur);
        w.fill.style.width = w.p * 100 + '%';
        if (w.p >= 1) { w.state = 'done'; changed = true; }
      }
      if (mainState === 'waiting' && !workers.some(w => w.state === 'running')) {
        mainState = 'exited';
        say('Все горутины вызвали Done() — wg.Wait() вернулся, программа завершилась корректно.', 'ok');
        changed = true;
      }
      if (changed) sync();
    });

    reset();
    return loop;
  });

  // ---------------------------------------------------------------- memory cost
  Deck.demo('cost', root => {
    const RAM = 16 * 2 ** 30;
    const slider = h('input', { type: 'range', min: 0, max: 600, value: 400, 'aria-label': 'Количество' });
    const big = h('div', { class: 'cost-n' });
    const rows = [
      { label: 'Горутины, стек от 2 КБ', per: 2 * 1024, cls: 'go' },
      { label: 'Потоки ОС, стек ~1 МБ', per: 1024 * 1024, cls: 'thread' },
    ].map(r => {
      r.bar = h('div', { class: 'cost-fill ' + r.cls });
      r.text = h('div', { class: 'cost-val' });
      r.el = h('div', { class: 'cost-row' }, h('div', { class: 'label' }, r.label), h('div', { class: 'cost-track' }, r.bar), r.text);
      return r;
    });

    root.append(
      big,
      h('label', { class: 'slider' }, h('span', { class: 'label' }, 'Сколько запустить'), slider),
      ...rows.map(r => r.el),
      h('p', { class: 'note' }, 'Шкала — 16 ГБ оперативной памяти, как у обычного ноутбука.'),
    );

    function nice(x) {
      if (x < 10) return Math.round(x);
      const p = 10 ** (Math.floor(Math.log10(x)) - 1);
      return Math.round(x / p) * p;
    }
    function bytes(b) {
      const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
      let i = 0;
      while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
      return (b < 10 && i ? b.toFixed(1).replace('.', ',') : Math.round(b)) + ' ' + u[i];
    }
    function update() {
      const n = nice(10 ** (slider.value / 100));
      big.innerHTML = `<b>${n.toLocaleString('ru-RU')}</b> ${plural(n, ['задача', 'задачи', 'задач'])} одновременно`;
      for (const r of rows) {
        const total = n * r.per;
        r.bar.style.width = Math.min(100, (total / RAM) * 100) + '%';
        r.bar.classList.toggle('over', total > RAM);
        r.text.textContent = total > RAM
          ? `${bytes(total)} — в ${Math.round(total / RAM).toLocaleString('ru-RU')} раз больше, чем есть`
          : bytes(total);
      }
    }
    slider.addEventListener('input', update);
    update();
    return {};
  });

  // ---------------------------------------------------------------- GMP scheduler
  Deck.demo('gmp', root => {
    let ps, global, sys, idleM, mCount, gCount, done, log, procs = 3, playing = true, timer = 0, active = false;

    const body = h('div', { class: 'gmp-body' });
    const logEl = h('div', { class: 'log gmp-log', 'aria-live': 'polite' });
    const procOut = h('output', null, procs);
    const procIn = h('input', { type: 'range', min: 1, max: 4, value: procs, 'aria-label': 'GOMAXPROCS' });
    const playBtn = h('button', { class: 'btn', onclick: togglePlay });
    const stepBtn = h('button', { class: 'btn', onclick: () => { tick(); render(); } }, 'Шаг');

    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => spawn(1) }, h('code', null, 'go f()')),
        h('button', { class: 'btn', onclick: () => spawn(8) }, '+8'),
        h('button', { class: 'btn', onclick: syscall }, 'Системный вызов'),
      ),
      h('div', { class: 'controls' },
        playBtn, stepBtn,
        h('button', { class: 'btn', onclick: reset }, 'Сброс'),
        h('label', { class: 'slider inline' }, h('code', null, 'GOMAXPROCS'), procIn, procOut),
      ),
      body,
      logEl,
    );

    procIn.addEventListener('input', () => {
      const n = +procIn.value;
      procOut.textContent = n;
      while (ps.length > n) {
        const p = ps.pop();
        if (p.run) global.push(p.run);
        global.push(...p.q);
        idleM.push(p.m);
      }
      while (ps.length < n) ps.push({ id: ps.length, m: idleM.length ? idleM.shift() : ++mCount, run: null, q: [] });
      procs = n;
      say(`GOMAXPROCS = ${n}: ${n} ${plural(n, ['P', 'P', 'P'])}, столько горутин выполняется одновременно.`);
      render();
    });

    const newG = () => { const work = 3 + Math.floor(Math.random() * 5); return { id: ++gCount, work, left: work }; };
    const say = msg => { log.unshift(msg); log.length = Math.min(log.length, 3); };

    function reset() {
      gCount = 0; mCount = 0; done = 0;
      global = []; sys = []; idleM = []; log = [];
      ps = [];
      for (let i = 0; i < procs; i++) ps.push({ id: i, m: ++mCount, run: null, q: [] });
      for (let i = 0; i < 6; i++) ps[0].q.push(newG());
      say('Код на P0 создал 6 горутин — все они попали в локальную очередь P0.');
      render();
    }

    function spawn(n) {
      for (let i = 0; i < n; i++) ps[0].q.push(newG());
      say(n === 1 ? `go f(): G${gCount} встала в очередь P0 — того P, где выполнялся вызов.` : `${n} новых горутин в очереди P0.`);
      render();
    }

    function pick(p) {
      if (p.q.length) { p.run = p.q.shift(); return; }
      if (global.length) {
        p.run = global.shift();
        say(`P${p.id}: своя очередь пуста — взял G${p.run.id} из глобальной.`);
        return;
      }
      const victim = ps.filter(o => o !== p && o.q.length).sort((a, b) => b.q.length - a.q.length)[0];
      if (victim) {
        const n = Math.ceil(victim.q.length / 2);
        const stolen = victim.q.splice(0, n);
        say(`P${p.id} без работы — украл у P${victim.id} половину очереди: ${stolen.map(g => 'G' + g.id).join(', ')}.`);
        p.q.push(...stolen);
        p.run = p.q.shift();
      }
    }

    function tick() {
      for (const s of sys) s.left--;
      for (const s of sys.filter(s => s.left <= 0)) {
        global.push(s.g);
        idleM.push(s.m);
        say(`G${s.g.id} вернулась из системного вызова и встала в глобальную очередь. M${s.m} засыпает до следующего раза.`);
      }
      sys = sys.filter(s => s.left > 0);
      for (const p of ps) {
        if (p.run && --p.run.left <= 0) { done++; p.run = null; }
        if (!p.run) pick(p);
      }
    }

    function syscall() {
      const busy = ps.filter(p => p.run);
      if (!busy.length) { say('Сейчас ни одна горутина не выполняется — некому делать системный вызов.'); render(); return; }
      const p = busy[Math.floor(Math.random() * busy.length)];
      const g = p.run, oldM = p.m;
      sys.push({ g, m: oldM, left: 5 });
      p.run = null;
      p.m = idleM.length ? idleM.shift() : ++mCount;
      say(`G${g.id} ушла в системный вызов вместе с потоком M${oldM}. P${p.id} не простаивает: его забрал M${p.m}.`);
      pick(p);
      render();
    }

    function queue(gs, cls = '') {
      if (!gs.length) return '<span class="empty">пусто</span>';
      const shown = gs.slice(0, 10).map(g => chip('G' + g.id, cls)).join('');
      return shown + (gs.length > 10 ? `<span class="more">+${gs.length - 10}</span>` : '');
    }

    function render() {
      body.innerHTML = `
        <div class="gmp-row"><span class="label">Глобальная очередь</span><div class="queue">${queue(global)}</div></div>
        <div class="gmp-ps">${ps.map(p => `
          <div class="pcard">
            <div class="phead"><span class="pchip">P${p.id}</span><span class="mchip">M${p.m}</span></div>
            <div class="prun">${p.run
              ? `${chip('G' + p.run.id)}<div class="track"><div class="fill" style="width:${(1 - p.run.left / p.run.work) * 100}%"></div></div>`
              : '<span class="empty">простаивает</span>'}</div>
            <div class="queue small">${queue(p.q, 'queued')}</div>
          </div>`).join('')}
        </div>
        <div class="gmp-row"><span class="label">В системном вызове</span><div class="queue">${
          sys.length ? sys.map(s => `<span class="pair">${chip('G' + s.g.id, 'blocked')}<span class="mchip">M${s.m}</span></span>`).join('') : '<span class="empty">никого</span>'
        }</div></div>
        <div class="gmp-row"><span class="label">Спящие потоки</span><div class="queue">${
          idleM.length ? idleM.map(m => `<span class="mchip idle">M${m}</span>`).join('') : '<span class="empty">нет</span>'
        }</div><span class="done-count">Выполнено: <b>${done}</b></span></div>`;
      logEl.innerHTML = log.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      playBtn.textContent = playing ? 'Пауза' : 'Пуск';
      stepBtn.disabled = playing;
    }

    function schedule() {
      clearInterval(timer);
      timer = active && playing ? setInterval(() => { tick(); render(); }, 900) : 0;
    }
    function togglePlay() { playing = !playing; schedule(); render(); }

    reset();
    return {
      start() { active = true; schedule(); },
      stop() { active = false; schedule(); },
    };
  });

  // ---------------------------------------------------------------- unbuffered rendezvous
  Deck.demo('unbuffered', root => {
    let waitingSend = null, waitingRecv = false, next = 1, busy = false;

    const sendState = h('div', { class: 'rv-state' });
    const recvState = h('div', { class: 'rv-state' });
    const got = h('div', { class: 'rv-got' });
    const sendOp = h('code', { class: 'rv-op' });
    const tube = h('div', { class: 'rv-tube' });
    const token = h('span', { class: 'val rv-token' });
    tube.append(token);
    const sendBtn = h('button', { class: 'btn primary', onclick: send }, 'Отправить');
    const recvBtn = h('button', { class: 'btn primary', onclick: recv }, 'Получить');
    const log = h('p', { class: 'log', 'aria-live': 'polite' });

    root.append(
      h('div', { class: 'rv' },
        h('div', { class: 'rv-g send' }, h('div', { class: 'rv-head' }, h('span', { class: 'gchip' }, 'G1'), 'отправитель'), sendOp, sendState, sendBtn),
        h('div', { class: 'rv-pipe' }, h('span', { class: 'label' }, 'ch'), tube, h('span', { class: 'label' }, 'буфера нет')),
        h('div', { class: 'rv-g recv' }, h('div', { class: 'rv-head' }, h('span', { class: 'gchip' }, 'G2'), 'получатель'), h('code', { class: 'rv-op' }, 'v := <-ch'), recvState, got, recvBtn),
      ),
      h('div', { class: 'controls' }, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      log,
    );

    function reset() {
      waitingSend = null; waitingRecv = false; next = 1; busy = false;
      token.style.transform = ''; token.hidden = true;
      got.textContent = '';
      log.textContent = 'Начните с любой стороны.';
      render();
    }

    function render() {
      sendOp.textContent = `ch <- ${waitingSend ?? next}`;
      setState(sendState, root.querySelector('.rv-g.send'), waitingSend != null ? 'blocked' : 'run', waitingSend != null ? 'ждёт получателя' : 'работает');
      setState(recvState, root.querySelector('.rv-g.recv'), waitingRecv ? 'blocked' : 'run', waitingRecv ? 'ждёт отправителя' : 'работает');
      sendBtn.disabled = busy || waitingSend != null;
      recvBtn.disabled = busy || waitingRecv;
    }
    function setState(el, box, cls, text) {
      el.textContent = text;
      box.classList.toggle('is-blocked', cls === 'blocked');
      box.querySelector('.gchip').classList.toggle('blocked', cls === 'blocked');
    }

    function send() {
      if (busy || waitingSend != null) return;
      const v = next++;
      if (waitingRecv) { waitingRecv = false; transfer(v, 'Получатель уже ждал'); return; }
      waitingSend = v;
      token.textContent = v; token.hidden = false; token.style.transform = '';
      token.classList.add('waiting');
      log.textContent = `G1 выполнила ch <- ${v} и заблокировалась: никто не читает.`;
      render();
    }

    function recv() {
      if (busy || waitingRecv) return;
      if (waitingSend != null) { const v = waitingSend; waitingSend = null; transfer(v, 'Отправитель уже ждал'); return; }
      waitingRecv = true;
      log.textContent = 'G2 выполнила <-ch и заблокировалась: никто не пишет.';
      render();
    }

    function transfer(v, who) {
      busy = true;
      render();
      token.textContent = v; token.hidden = false;
      token.classList.remove('waiting');
      const dist = tube.clientWidth - token.offsetWidth - 8;
      const finish = () => {
        busy = false;
        token.hidden = true;
        got.innerHTML = `v = ${val(v)}`;
        log.textContent = `${who} — встреча! Значение ${v} передано из рук в руки, обе горутины продолжают работу.`;
        render();
      };
      if (reducedMotion.matches) return finish();
      token.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dist}px)` }], { duration: 600, easing: 'cubic-bezier(.5,0,.3,1)' }).onfinish = finish;
    }

    reset();
    return {};
  });

  // ---------------------------------------------------------------- buffered channel / hchan
  Deck.demo('buffered', root => {
    let cap = 3, buf, qcount, sendx, recvx, closed, recvq, sendq, nextG, nextV, prev = {};

    const capIn = h('input', { type: 'range', min: 0, max: 6, value: cap, 'aria-label': 'Размер буфера' });
    const codeEl = h('pre', { class: 'code mini' }, h('code'));
    const slots = h('div', { class: 'ring' });
    const fields = h('div', { class: 'fields' });
    const log = h('div', { class: 'log', 'aria-live': 'polite' });
    const sendBtn = h('button', { class: 'btn primary', onclick: send }, h('code', null, 'ch <- v'));
    const recvBtn = h('button', { class: 'btn primary', onclick: recv }, h('code', null, '<-ch'));
    const closeBtn = h('button', { class: 'btn', onclick: close }, h('code', null, 'close(ch)'));

    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Размер буфера'), capIn),
      codeEl,
      h('div', { class: 'controls' }, sendBtn, recvBtn, closeBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      slots,
      fields,
      log,
    );
    capIn.addEventListener('input', () => { cap = +capIn.value; reset(); });

    function reset() {
      buf = Array(cap).fill(null);
      qcount = sendx = recvx = 0;
      closed = false;
      recvq = []; sendq = [];
      nextG = 1; nextV = 1;
      prev = {};
      say(cap ? 'Каждое нажатие — новая горутина, выполняющая операцию.' : 'cap = 0: буфера нет, работает только прямая передача.');
      render(true);
    }
    const say = (html, cls = '') => { log.innerHTML = html; log.className = 'log ' + cls; };

    function put(v) { buf[sendx] = v; sendx = (sendx + 1) % cap; qcount++; }
    function take() { const v = buf[recvx]; buf[recvx] = null; recvx = (recvx + 1) % cap; qcount--; return v; }

    function send() {
      const g = 'G' + nextG++, v = nextV++;
      if (closed) { say(`${g}: ch &lt;- ${v} — <b>panic: send on closed channel</b>`, 'bad'); return render(); }
      if (recvq.length) {
        const r = recvq.shift();
        say(`${g}: ch &lt;- ${v}. В recvq ждала ${r} — значение скопировано ей напрямую, минуя буфер. ${r} проснулась.`, 'ok');
      } else if (qcount < cap) {
        const at = sendx;
        put(v);
        say(`${g}: ch &lt;- ${v} — положила в buf[${at}] и пошла дальше, не блокируясь.`);
      } else {
        sendq.push({ g, v });
        say(`${g}: ${cap ? 'буфер полон' : 'получателя нет'} — ${g} уснула в sendq со значением ${v}.`, 'warn');
      }
      render();
    }

    function recv() {
      const g = 'G' + nextG++;
      if (qcount > 0) {
        const at = recvx, v = take();
        let msg = `${g}: &lt;-ch получила ${v} из buf[${at}].`;
        if (sendq.length) {
          const s = sendq.shift();
          put(s.v);
          msg += ` Место освободилось: ${s.g} из sendq положила ${s.v} в буфер и проснулась.`;
        } else if (closed) msg += ' Канал закрыт, но буфер ещё отдаёт данные.';
        say(msg, 'ok');
      } else if (sendq.length) {
        const s = sendq.shift();
        say(`${g}: &lt;-ch получила ${s.v} прямо от ${s.g} из sendq. ${s.g} проснулась.`, 'ok');
      } else if (closed) {
        say(`${g}: канал закрыт и пуст — сразу вернулось 0, ok = false.`);
      } else {
        recvq.push(g);
        say(`${g}: данных нет — ${g} уснула в recvq.`, 'warn');
      }
      render();
    }

    function close() {
      if (closed) { say('close(ch) — <b>panic: close of closed channel</b>', 'bad'); return; }
      closed = true;
      let msg = 'close(ch): closed = 1.';
      if (recvq.length) msg += ` ${recvq.join(', ')} из recvq проснулись с 0, ok = false.`;
      if (sendq.length) msg += ` ${sendq.map(s => s.g).join(', ')} из sendq проснулись и упали: <b>panic: send on closed channel</b>.`;
      const panicked = sendq.length > 0;
      recvq = []; sendq = [];
      say(msg, panicked ? 'bad' : '');
      render();
    }

    function render() {
      codeEl.firstChild.innerHTML = highlight(`ch := make(chan int${cap ? ', ' + cap : ''})`);
      if (!cap) {
        slots.innerHTML = '<div class="nobuf">Буфера нет: <code>dataqsiz = 0</code></div>';
      } else {
        slots.innerHTML = buf.map((v, i) => `
          <div class="slot ${v != null ? 'full' : ''}">
            <div class="cell">${v != null ? val(v) : ''}</div>
            <div class="idx">${i}</div>
            <div class="ptrs">${i === sendx ? '<span class="ptr s">sendx</span>' : ''}${i === recvx ? '<span class="ptr r">recvx</span>' : ''}</div>
          </div>`).join('');
      }
      const now = {
        qcount, dataqsiz: cap, sendx, recvx, closed: closed ? 1 : 0,
        recvq: recvq.length ? recvq.map(g => chip(g, 'blocked')).join('') : '<span class="empty">пусто</span>',
        sendq: sendq.length ? sendq.map(s => `<span class="pair">${chip(s.g, 'blocked')}${val(s.v)}</span>`).join('') : '<span class="empty">пусто</span>',
      };
      fields.innerHTML = Object.entries(now).map(([k, v]) =>
        `<div class="field ${k.endsWith('q') ? 'wide' : ''} ${prev[k] !== undefined && prev[k] !== v ? 'flash' : ''}"><span>${k}</span><b>${v}</b></div>`).join('');
      prev = now;
    }

    reset();
    return {};
  });

  // ---------------------------------------------------------------- nil / open / closed matrix
  Deck.demo('matrix', root => {
    const ops = ['ch <- v', '<-ch', 'close(ch)'];
    const states = ['nil', 'открыт', 'закрыт'];
    const cells = [
      [
        ['block', 'блок навсегда', 'Отправка в nil-канал блокирует горутину навсегда. Если так застряли все горутины — <code>fatal error: all goroutines are asleep - deadlock!</code>'],
        ['block', 'блок навсегда', 'Получение из nil-канала тоже блокирует навсегда. Это полезно: присвойте каналу nil внутри <code>select</code>, чтобы выключить его case.'],
        ['panic', 'panic', '<code>panic: close of nil channel</code>'],
      ],
      [
        ['ok', 'отправит или подождёт', 'Если ждёт получатель — значение уходит ему напрямую. Если в буфере есть место — ложится в буфер. Иначе горутина засыпает в <code>sendq</code>.'],
        ['ok', 'получит или подождёт', 'Берёт значение из буфера или напрямую у ждущего отправителя. Если данных нет — засыпает в <code>recvq</code>.'],
        ['ok', 'закроет', 'Канал помечается закрытым. Ждущие получатели просыпаются с нулевым значением и <code>ok = false</code>. Ждущие отправители — паникуют.'],
      ],
      [
        ['panic', 'panic', '<code>panic: send on closed channel</code>. Поэтому закрывает канал отправитель: только он знает, что отправлять больше нечего.'],
        ['ok', 'остаток, потом 0, false', 'Сначала отдаёт всё, что осталось в буфере. Потом сразу, без ожидания, возвращает нулевое значение и <code>ok = false</code>. На этом завершается <code>for range</code>.'],
        ['panic', 'panic', '<code>panic: close of closed channel</code>'],
      ],
    ];
    const KIND = { ok: 'работает', block: 'блокирует', panic: 'паника' };
    const detail = h('div', { class: 'mx-detail', 'aria-live': 'polite' });
    const grid = h('div', { class: 'mx', role: 'grid' });
    grid.append(h('div', { class: 'mx-corner' }));
    ops.forEach(o => grid.append(h('div', { class: 'mx-op' }, h('code', null, o))));
    const buttons = [];
    states.forEach((s, r) => {
      grid.append(h('div', { class: 'mx-state' }, s));
      ops.forEach((o, c) => {
        const [kind, short, long] = cells[r][c];
        const b = h('button', { class: 'mx-cell ' + kind, onclick: () => show(b, s, o, kind, long) }, short);
        buttons.push(b);
        grid.append(b);
      });
    });
    function show(b, s, o, kind, long) {
      buttons.forEach(x => x.classList.toggle('sel', x === b));
      detail.className = 'mx-detail ' + kind;
      detail.innerHTML = `<div class="mx-title"><code>${o.replace('<', '&lt;')}</code> на ${s === 'nil' ? 'nil-канале' : s === 'открыт' ? 'открытом канале' : 'закрытом канале'}: <b>${KIND[kind]}</b></div><p>${long}</p>`;
    }
    root.append(grid, detail);
    buttons[6].click();
    return {};
  });

  // ---------------------------------------------------------------- select
  Deck.demo('select', root => {
    const ready = { ch1: false, ch2: true };
    const present = { timeout: true, default: false };
    let waiting = false, timer = 0, t0 = 0, raf = 0;
    const TIMEOUT = 1.5;

    const lines = {
      ch1: 'case v := <-ch1:',
      ch2: 'case v := <-ch2:',
      timeout: 'case <-time.After(1500 * time.Millisecond):',
      default: 'default:',
    };
    const rows = {};
    const codeBox = h('div', { class: 'sel-code' });
    codeBox.append(h('div', { class: 'sel-line', html: highlight('select {') }));
    for (const key of Object.keys(lines)) {
      const isCh = key.startsWith('ch');
      const input = h('input', { type: 'checkbox', checked: isCh ? ready[key] : present[key] });
      input.addEventListener('change', () => toggle(key, input.checked));
      const row = h('label', { class: 'sel-line case' },
        h('code', { html: highlight(lines[key]) }),
        h('span', { class: 'sel-toggle' }, input, h('span', null, isCh ? 'есть данные' : 'в коде')));
      rows[key] = row;
      codeBox.append(row);
    }
    codeBox.append(h('div', { class: 'sel-line', html: highlight('}') }));

    const result = h('div', { class: 'log', 'aria-live': 'polite' });
    const stats = h('div', { class: 'sel-stats' });
    const runBtn = h('button', { class: 'btn primary', onclick: run }, 'Выполнить select');
    const manyBtn = h('button', { class: 'btn', onclick: runMany }, '1000 раз');
    root.append(codeBox, h('div', { class: 'controls' }, runBtn, manyBtn), result, stats);

    function paint() {
      for (const k of ['ch1', 'ch2']) rows[k].classList.toggle('ready', ready[k]);
      for (const k of ['timeout', 'default']) rows[k].classList.toggle('absent', !present[k]);
      runBtn.disabled = manyBtn.disabled = waiting;
    }

    function fire(key, text, cls = 'ok') {
      waiting = false;
      clearTimeout(timer); cancelAnimationFrame(raf);
      Object.values(rows).forEach(r => r.classList.remove('chosen', 'waiting'));
      if (key) {
        const r = rows[key];
        void r.offsetWidth;
        r.classList.add('chosen');
      }
      result.innerHTML = text;
      result.className = 'log ' + cls;
      paint();
    }

    function toggle(key, on) {
      if (key in ready) ready[key] = on; else present[key] = on;
      paint();
      if (waiting && key in ready && on) fire(key, `В ${key} появились данные — select проснулся и выполнил этот case.`);
    }

    function run() {
      if (waiting) return;
      stats.innerHTML = '';
      const r = ['ch1', 'ch2'].filter(k => ready[k]);
      if (r.length) {
        const k = r[Math.floor(Math.random() * r.length)];
        return fire(k, r.length > 1 ? `Готовы оба канала — случайно выбран ${k}. Запустите ещё раз.` : `Готов только ${k} — выполнен его case.`);
      }
      if (present.default) return fire('default', 'Ни один канал не готов — сработал default, select не ждал.');
      waiting = true;
      Object.values(rows).forEach(x => x.classList.remove('chosen'));
      rows.ch1.classList.add('waiting'); rows.ch2.classList.add('waiting');
      paint();
      if (present.timeout) {
        t0 = performance.now();
        const step = () => {
          const left = Math.max(0, TIMEOUT - (performance.now() - t0) / 1000);
          result.innerHTML = `Ни один канал не готов — select ждёт. До таймаута ${left.toFixed(1).replace('.', ',')} с.`;
          result.className = 'log warn';
          if (waiting) raf = requestAnimationFrame(step);
        };
        step();
        timer = setTimeout(() => fire('timeout', 'Время вышло — сработал case с time.After.', 'warn'), TIMEOUT * 1000);
      } else {
        result.innerHTML = 'Ни один case не готов, default и таймаута нет — горутина заблокирована. Включите данные в ch1 или ch2.';
        result.className = 'log bad';
      }
    }

    function runMany() {
      const r = ['ch1', 'ch2'].filter(k => ready[k]);
      const counts = {};
      let label;
      if (r.length) {
        for (const k of r) counts[k] = 0;
        for (let i = 0; i < 1000; i++) counts[r[Math.floor(Math.random() * r.length)]]++;
        label = r.length > 1 ? 'Выбор между готовыми case — равномерный.' : 'Готов один канал — выбирается всегда он.';
      } else if (present.default) {
        counts.default = 1000;
        label = 'Ничего не готово — каждый раз default.';
      } else {
        stats.innerHTML = '<p class="note">Ни один case не готов: все 1000 запусков заблокировались бы на первом же.</p>';
        return;
      }
      stats.innerHTML = Object.entries(counts).map(([k, n]) =>
        `<div class="bar-row"><code>${k}</code><div class="cost-track"><div class="cost-fill go" style="width:${n / 10}%"></div></div><b>${n}</b></div>`).join('') + `<p class="note">${label}</p>`;
    }

    paint();
    result.textContent = 'Нажмите «Выполнить select».';
    return { stop() { if (waiting) fire(null, 'Нажмите «Выполнить select».', ''); } };
  });

  // ---------------------------------------------------------------- worker pool
  Deck.demo('pool', root => {
    let n = 3, queue, workers, results, time, nextJob, running;
    const nIn = h('input', { type: 'range', min: 1, max: 6, value: n, 'aria-label': 'Число воркеров' });
    const nOut = h('output', null, n);
    const addBtn = h('button', { class: 'btn primary', onclick: add }, 'Отправить 12 задач');
    const qEl = h('div', { class: 'queue jobs' });
    const wEl = h('div', { class: 'workers' });
    const rEl = h('div', { class: 'queue results' });
    const status = h('div', { class: 'log', 'aria-live': 'polite' });
    const clock = h('span', { class: 'clock' });

    root.append(
      h('div', { class: 'controls' }, addBtn, h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Воркеров'), nIn, nOut), clock),
      h('div', { class: 'label' }, 'jobs'), qEl,
      wEl,
      h('div', { class: 'label' }, 'results'), rEl,
      status,
    );
    nIn.addEventListener('input', () => { n = +nIn.value; nOut.textContent = n; reset(); });

    // Deterministic job durations so different worker counts are comparable.
    const dur = id => 0.6 + ((id * 7) % 13) / 10;

    function reset() {
      queue = []; results = []; time = 0; nextJob = 1; running = false;
      workers = Array.from({ length: n }, (_, i) => {
        const fill = h('div', { class: 'fill' });
        const job = h('span', { class: 'wjob' });
        const el = h('div', { class: 'worker' }, h('span', { class: 'gchip' }, 'W' + (i + 1)), job, h('div', { class: 'track' }, fill));
        return { el, fill, jobEl: job, job: null, t: 0 };
      });
      wEl.replaceChildren(...workers.map(w => w.el));
      status.textContent = `${n} ${plural(n, ['воркер ждёт', 'воркера ждут', 'воркеров ждут'])} задачи в for range jobs.`;
      draw();
    }

    function add() {
      for (let i = 0; i < 12; i++) queue.push(nextJob++);
      running = true;
      status.textContent = 'Задачи в канале jobs. Свободные воркеры разбирают их по одной.';
      draw();
    }

    function draw() {
      qEl.innerHTML = queue.length ? queue.map(val).join('') : '<span class="empty">пусто</span>';
      rEl.innerHTML = results.length ? results.map(j => `<span class="val done">${j}</span>`).join('') : '<span class="empty">пусто</span>';
      for (const w of workers) {
        w.jobEl.innerHTML = w.job ? val(w.job) : '<span class="empty">ждёт</span>';
        w.el.classList.toggle('busy', !!w.job);
      }
      clock.textContent = `${time.toFixed(1).replace('.', ',')} с`;
    }

    const loop = rafLoop(dt => {
      if (!running) return;
      time += dt;
      let changed = false;
      for (const w of workers) {
        if (w.job) {
          w.t += dt;
          if (w.t >= dur(w.job)) { results.push(w.job); w.job = null; changed = true; }
        }
        if (!w.job && queue.length) { w.job = queue.shift(); w.t = 0; changed = true; }
        w.fill.style.width = w.job ? Math.min(100, (w.t / dur(w.job)) * 100) + '%' : '0%';
      }
      if (!queue.length && workers.every(w => !w.job)) {
        running = false;
        const total = results.length;
        status.textContent = `${total} ${plural(total, ['задача', 'задачи', 'задач'])} за ${time.toFixed(1).replace('.', ',')} с при ${n} ${plural(n, ['воркере', 'воркерах', 'воркерах'])}. Попробуйте другое число воркеров.`;
        changed = true;
      }
      if (changed) draw();
      else clock.textContent = `${time.toFixed(1).replace('.', ',')} с`;
    });

    reset();
    return loop;
  });
})();

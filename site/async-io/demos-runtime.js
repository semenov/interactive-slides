// Demos for slides 14 and 16: Python asyncio pitfalls, M:N scheduling (Go, Java virtual threads, Erlang).
(() => {
  'use strict';
  const { h, highlight, plural, rafLoop } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');

  function modeButtons(list, cur, onPick) {
    const btns = list.map(([key, text]) => h('button', { class: 'btn small' + (key === cur ? ' sel' : ''), onclick: () => pick(key) }, text));
    function pick(key) {
      btns.forEach((b, i) => b.classList.toggle('sel', list[i][0] === key));
      onPick(key);
    }
    return { el: h('div', { class: 'controls' }, btns), btns };
  }

  // ---------------------------------------------------------------- asyncio variants
  Deck.demo('pyasync', root => {
    const T = 3.5;
    const seq = [[0, 1], [1, 2], [2, 3]], par = [[0, 1], [0, 1], [0, 1]];
    const V = {
      seq: {
        title: 'await по очереди',
        code: 'for i in range(3):\n    await fetch(i)\n# внутри fetch: await asyncio.sleep(1)',
        fetch: seq.map(s => ['wait', ...s]), loop: [], pool: null, total: 3, blockedTill: 0,
        log: 'Каждый await ждёт свой ответ, прежде чем начать следующий. Цикл свободен, тикер работает, но ждём 3 секунды — корутины не запускаются параллельно сами.', cls: 'warn',
      },
      gather: {
        title: 'gather',
        code: 'await asyncio.gather(*(fetch(i) for i in range(3)))\n# внутри fetch: await asyncio.sleep(1)',
        fetch: par.map(s => ['wait', ...s]), loop: [], pool: null, total: 1, blockedTill: 0,
        log: 'Три корутины ждут одновременно: каждая на своём await отдала управление циклу. Итого 1 секунда, тикер не прерывался.', cls: 'ok',
      },
      sleep: {
        title: 'time.sleep внутри',
        code: 'await asyncio.gather(*(fetch(i) for i in range(3)))\n# внутри fetch: time.sleep(1) или requests.get(...)',
        fetch: seq.map(s => ['block', ...s]), loop: [['block', 0, 3]], pool: null, total: 3, blockedTill: 3,
        log: 'gather есть, а параллельности нет: <code>time.sleep</code> блокирует единственный поток цикла. Корутины идут строго по очереди, тикер молчит 3 секунды — так же замирают все запросы сервера.', cls: 'bad',
      },
      noawait: {
        title: 'забыт await',
        code: 'for i in range(3):\n    fetch(i)   # RuntimeWarning: coroutine\n               # \'fetch\' was never awaited',
        fetch: [], loop: [], pool: null, total: 0, blockedTill: 0,
        log: 'Вызов async-функции без await только создаёт объект корутины. Ни строчки её кода не выполнено. В логах — RuntimeWarning, а линтер (ruff, mypy) ловит это заранее.', cls: 'bad',
      },
      thread: {
        title: 'to_thread',
        code: 'await asyncio.gather(*(fetch(i) for i in range(3)))\n# внутри fetch: await asyncio.to_thread(requests.get, url)',
        fetch: par.map(s => ['wait', ...s]), loop: [], pool: par.map(s => ['block', ...s]), total: 1, blockedTill: 0,
        log: 'Блокирующий вызов ушёл в пул потоков (по умолчанию min(32, ядер + 4)). Корутина ждёт его результат как обычный await, цикл свободен. Для сетевых и файловых вызовов GIL отпускается, так что потоки реально ждут параллельно.', cls: 'ok',
      },
    };
    let v = 'seq', t = 0, playing = false;
    const codeEl = h('pre', { class: 'code py-code' });
    const lanes = h('div', { class: 'tl' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const runBtn = h('button', { class: 'btn primary', onclick: () => { t = 0; playing = true; render(); } }, 'Запустить');
    root.append(modeButtons(Object.entries(V).map(([k, x]) => [k, x.title]), v, k => { v = k; t = 0; playing = false; render(); }).el,
      codeEl, lanes, h('div', { class: 'controls' }, runBtn), stats, logEl);
    const pct = x => (x / T) * 100 + '%';
    function ticks(x) {
      // A ticker task: `while True: await asyncio.sleep(0.1)`; it cannot run while the loop is blocked.
      const out = [];
      let at = 0;
      while (at <= T) {
        if (at < x.blockedTill) at = x.blockedTill;
        out.push(at);
        at += 0.1;
      }
      return out;
    }
    function render() {
      const x = V[v];
      codeEl.innerHTML = '<code>' + highlight(x.code, 'py') + '</code>';
      const mask = `<i class="tl-mask" style="left:${pct(t)}"></i>`;
      const row = (name, segs, cls = '') => `<div class="tl-row"><span class="tl-name">${name}</span><div class="tl-lane ${cls}">` +
        segs.map(([k, a, b]) => `<i class="seg ${k}" style="left:${pct(a)};width:${pct(b - a)}"></i>`).join('') + mask + '</div></div>';
      let html = '<div class="tl-axis abs">' + [0, 1, 2, 3].map(x => `<span style="left:${pct(x)}">${x ? x + ' с' : '0'}</span>`).join('') + '</div>';
      html += row('цикл', x.loop);
      if (x.fetch.length) x.fetch.forEach((f, i) => { html += row('fetch ' + i, [f], 'thin'); });
      else html += '<div class="tl-row"><span class="tl-name">fetch</span><div class="tl-lane thin empty-lane">не выполнялись</div></div>';
      if (x.pool) html += row('пул потоков', x.pool.map(s => ['block', s[1], s[2]]), 'thin');
      html += `<div class="tl-row"><span class="tl-name">тикер</span><div class="tl-lane thin">` +
        ticks(x).map(a => `<i class="tick" style="left:${pct(a)}"></i>`).join('') + mask + '</div></div>';
      lanes.innerHTML = html;
      const done = !playing && t > 0;
      const gap = x.blockedTill ? x.blockedTill * 1000 : 100;
      stats.innerHTML = done
        ? `<div class="stat ${x.total > 1 ? 'warn' : ''}"><b>${dec(x.total, 0)} с</b><span>всего</span></div>` +
          `<div class="stat ${gap > 100 ? 'warn' : ''}"><b>${gap} мс</b><span>самая длинная пауза тикера</span></div>` +
          `<div class="stat ${x.fetch.length ? '' : 'warn'}"><b>${x.fetch.length} из 3</b><span>fetch выполнены</span></div>`
        : '<div class="stat"><b>—</b><span>всего</span></div><div class="stat"><b>—</b><span>самая длинная пауза тикера</span></div><div class="stat"><b>—</b><span>fetch выполнены</span></div>';
      if (done) { logEl.innerHTML = x.log; logEl.className = 'log ' + x.cls; }
      else if (!playing) { logEl.innerHTML = 'Нажмите «Запустить». Синие полосы — корутина ждёт на await, красные — поток заблокирован. Риски внизу — тикер.'; logEl.className = 'log'; }
      runBtn.disabled = playing;
    }
    render();
    return rafLoop(dt => {
      if (!playing) return;
      t = Math.min(T, t + dt * 1.2);
      if (t >= T || (V[v].total === 0 && t > 0.6)) { t = T; playing = false; }
      render();
    });
  });

  // ---------------------------------------------------------------- M:N scheduler
  Deck.demo('mn', root => {
    const RT = {
      go: { letter: 'G', carrier: i => `M${i + 1}`, extra: 'новый M', name: 'Go' },
      java: { letter: 'V', carrier: i => `носитель ${i + 1}`, extra: 'компенсация', name: 'Java' },
      erlang: { letter: 'P', carrier: i => `планировщик ${i + 1}`, extra: '', name: 'Erlang' },
    };
    let rt = 'go', carriers, runQ, parked, dirty, seq;
    const carEl = h('div', { class: 'mn-cars' });
    const qEl = h('div', { class: 'queue' });
    const pkEl = h('div', { class: 'queue' });
    const dirtyBox = h('div', { class: 'el-box' }, h('span', { class: 'label' }, 'грязный IO-планировщик'), (() => { const d = h('div', { class: 'queue mn-dirty' }); return d; })());
    const dirtyEl = dirtyBox.querySelector('.mn-dirty');
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const pinBtn = h('button', { class: 'btn small', onclick: () => act('pin') }, 'IO внутри synchronized');
    const mb = modeButtons([['go', 'Go'], ['java', 'Java 21'], ['erlang', 'Erlang']], rt, k => { rt = k; reset(); });
    root.append(
      mb.el,
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: () => act('net') }, 'ждать сеть'),
        h('button', { class: 'btn small', onclick: () => act('file') }, 'читать файл'),
        h('button', { class: 'btn small', onclick: () => act('cpu') }, 'долгий цикл CPU'),
        pinBtn,
        h('button', { class: 'btn small primary', onclick: () => act('done') }, 'IO завершён')),
      h('div', { class: 'el-box' }, h('span', { class: 'label' }, 'потоки ОС (ядер — 3)'), carEl),
      h('div', { class: 'mn-qs' },
        h('div', { class: 'el-box' }, h('span', { class: 'label' }, 'очередь готовых'), qEl),
        h('div', { class: 'el-box' }, h('span', { class: 'label' }, 'ждут сеть'), pkEl)),
      dirtyBox,
      logEl,
    );
    function reset() {
      const L = RT[rt].letter;
      seq = 0;
      carriers = [0, 1, 2].map(i => ({ name: RT[rt].carrier(i), g: L + (i + 1), st: 'run', extra: false }));
      runQ = [4, 5, 6, 7, 8, 9].map(i => L + i);
      parked = []; dirty = [];
      pinBtn.hidden = rt !== 'java';
      dirtyBox.hidden = rt !== 'erlang';
      const intro = {
        go: 'Три потока ОС (M), у каждого процессор P со своей очередью горутин. Здесь очередь общая для простоты.',
        java: 'Виртуальные потоки выполняются на потоках-носителях ForkJoinPool — по одному на ядро.',
        erlang: 'По одному планировщику на ядро, у каждого очередь лёгких процессов.',
      }[rt];
      say(intro);
      render();
    }
    function say(text, cls = '') { logEl.innerHTML = text; logEl.className = 'log ' + cls; }
    function fill() {
      for (const c of carriers) if (c.st === 'idle' && runQ.length) { c.g = runQ.shift(); c.st = 'run'; }
    }
    function act(a) {
      if (a === 'done') {
        let n = parked.length + dirty.length;
        runQ.push(...parked, ...dirty);
        parked = []; dirty = [];
        for (const c of carriers) if (c.st === 'sys' || c.st === 'pin' || c.st === 'hog') { runQ.push(c.g); c.g = null; c.st = 'idle'; n++; }
        const extras = carriers.filter(c => c.extra);
        // Extra threads are retired; whatever they were running goes back to the front of the queue.
        runQ.unshift(...extras.filter(c => c.g).map(c => c.g));
        carriers = carriers.filter(c => !c.extra);
        fill();
        say(n ? `Ожидание закончилось: ${n} ${plural(n, ['задача', 'задачи', 'задач'])} снова в очереди готовых.` + (extras.length ? (rt === 'go' ? ' Лишний M вернулся в пул спящих потоков.' : ' Компенсирующий носитель больше не нужен.') : '') : 'Никто не ждал.', 'ok');
        render();
        return;
      }
      const c = carriers.find(x => x.st === 'run');
      if (!c) { say('Все потоки заняты или заблокированы — некому выполнять задачи. Нажмите «IO завершён».', 'bad'); return; }
      const g = c.g;
      const free = () => { c.g = null; c.st = 'idle'; fill(); };
      if (a === 'net') {
        parked.push(g); free();
        say({
          go: `${g} читает из сокета. Данных нет — горутина припаркована в netpoller (внутри тот же epoll), а ${c.name} сразу берёт следующую. Поток ОС не блокировался.`,
          java: `${g} читает из сокета: виртуальный поток размонтирован, его кадры стека скопированы в кучу, сокет зарегистрирован в epoll. Носитель свободен.`,
          erlang: `${g} ждёт сообщение в <code>receive</code>: процесс снят с очереди. Сетевые данные придут ему сообщением от порта.`,
        }[rt], 'ok');
      } else if (a === 'file') {
        if (rt === 'erlang') {
          dirty.push(g); free();
          say(`Файловая операция ${g} выполняется на грязном IO-планировщике (OTP 21+). Обычный планировщик продолжает работу.`, 'ok');
        } else {
          c.st = 'sys';
          const extra = { name: rt === 'go' ? `M${carriers.length + 1}` : `носитель ${carriers.length + 1}`, g: null, st: 'idle', extra: true };
          carriers.push(extra); fill();
          say(rt === 'go'
            ? `${g} делает блокирующий системный вызов, и ${c.name} заблокирован в ядре. sysmon через ~20 мкс отбирает у него P и отдаёт новому потоку ${extra.name}: остальные горутины не стоят. Отсюда тысячи потоков у Go-программы, которая много читает с медленного диска.`
            : `Чтение файла блокирует носитель вместе с ${g}. ForkJoinPool временно добавляет ещё один носитель, чтобы остальные виртуальные потоки не стояли.`, 'warn');
        }
      } else if (a === 'cpu') {
        if (rt === 'java') {
          c.st = 'hog';
          say(`${g} считает в цикле. Виртуальные потоки не вытесняются по времени: пока счёт не закончится, ${c.name} занят. Займут так все носители — встанут все виртуальные потоки.`, 'warn');
        } else {
          runQ.push(g); free();
          say(rt === 'go'
            ? `${g} крутит цикл без вызовов. Через 10 мс sysmon посылает потоку сигнал, и горутину вытесняют в конец очереди (асинхронное вытеснение, Go 1.14+). Раньше такой цикл мог занять поток навсегда.`
            : `${g} считает, но каждый вызов функции тратит редукции. Через ~4000 редукций (около миллисекунды) планировщик ставит процесс в конец очереди. Поэтому у Erlang стабильные задержки под нагрузкой.`, 'ok');
        }
      } else if (a === 'pin') {
        c.st = 'pin';
        say(`${g} делает IO внутри <code>synchronized</code>: в Java 21–23 он закреплён за носителем — не размонтируется, и компенсации нет. Пул из N носителей теряет поток. Исправлено в Java 24 (JEP 491); до этого — <code>ReentrantLock</code>.`, 'bad');
      }
      render();
    }
    const ST = { run: 'выполняет', sys: 'заблокирован в syscall', hog: 'занят счётом', pin: 'закреплён, заблокирован', idle: 'простаивает' };
    function render() {
      carEl.innerHTML = carriers.map(c => `<div class="mn-car ${c.st}${c.extra ? ' extra' : ''}"><span class="mn-name">${c.name}${c.extra ? ` <small>${RT[rt].extra}</small>` : ''}</span>` +
        (c.g ? `<span class="task g ${c.st}">${c.g}</span>` : '') + `<span class="mn-st">${ST[c.st]}</span></div>`).join('');
      const chips = (list, cls) => list.length ? list.map(x => `<span class="task g ${cls}">${x}</span>`).join('') : '<span class="empty">пусто</span>';
      qEl.innerHTML = chips(runQ, '');
      pkEl.innerHTML = chips(parked, 'pk');
      dirtyEl.innerHTML = chips(dirty, 'sys');
    }
    reset();
    return {};
  });
})();

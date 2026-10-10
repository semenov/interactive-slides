// Demos for slides 2–12: descriptors, write path, dirty pages, safe replace, inodes, page cache, read buffers.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  const secs = s => s < 0.001 ? dec(s * 1e6, 0) + ' мкс' : s < 1 ? dec(s * 1000, s < 0.01 ? 1 : 0) + ' мс'
    : s < 120 ? dec(s, s < 10 ? 1 : 0) + ' с' : dec(s / 60, 0) + ' мин';

  // ---------------------------------------------------------------- fd table → open file → inode
  Deck.demo('fdtable', root => {
    const COLORS = ['#9c5b12', '#00a29c', '#7a5ea8', '#ce3262', '#336791', '#5a6e80'];
    const CHUNK = 100, MAXCH = 10;
    let procs, ofds, data, sel, nextOfd, appendNext = false;
    const procEl = h('div', { class: 'fd-procs' });
    const ofdEl = h('div', { class: 'fd-ofds' });
    const inoEl = h('div', { class: 'fd-inode' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const appendIn = h('input', { type: 'checkbox' });
    appendIn.addEventListener('change', () => { appendNext = appendIn.checked; });
    const bOpen = h('button', { class: 'btn small', onclick: doOpen }, h('code', null, 'open("log")'));
    const bDup = h('button', { class: 'btn small', onclick: doDup }, h('code', null, 'dup(fd)'));
    const bFork = h('button', { class: 'btn small', onclick: doFork }, h('code', null, 'fork()'));
    const bWrite = h('button', { class: 'btn small primary', onclick: doWrite }, h('code', null, 'write(fd, 100 Б)'));
    const bClose = h('button', { class: 'btn small', onclick: doClose }, h('code', null, 'close(fd)'));
    root.append(
      h('div', { class: 'controls' }, bOpen, bDup, bFork, bWrite, bClose,
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, appendIn, h('span', null, 'следующий open с ', h('code', null, 'O_APPEND'))),
      h('div', { class: 'label' }, 'Таблицы дескрипторов процессов (нажмите на номер, чтобы выбрать)'), procEl,
      h('div', { class: 'label' }, 'Открытые файлы в ядре'), ofdEl,
      h('div', { class: 'label' }, 'inode файла log'), inoEl,
      logEl,
    );

    function reset() {
      procs = [{ name: 'A', pid: 100, fds: new Map() }];
      ofds = new Map(); data = []; nextOfd = 1; sel = null;
      doOpen(true);
      say('Процесс A открыл файл: получил fd 3. Нажмите «write», затем «fork()».');
    }
    const curProc = () => sel ? procs.find(p => p.name === sel.p) : procs[0];
    const lowestFd = p => { let fd = 3; while (p.fds.has(fd)) fd++; return fd; };
    function doOpen(quiet) {
      const p = curProc();
      const fd = lowestFd(p);
      const id = nextOfd++;
      ofds.set(id, { id, offset: 0, append: appendNext, color: COLORS[(id - 1) % COLORS.length] });
      p.fds.set(fd, id);
      sel = { p: p.name, fd };
      if (quiet !== true) {
        say(`Процесс ${p.name}: open() вернул fd ${fd} и создал новый открытый файл #${id} со своим смещением 0${appendNext ? ' и флагом O_APPEND' : ''}.` +
          (ofds.size > 1 && !appendNext ? ' Запись через него начнётся с начала файла.' : ''), ofds.size > 1 && !appendNext ? 'warn' : '');
      }
      render();
    }
    function doDup() {
      if (!sel) return;
      const p = curProc();
      const id = p.fds.get(sel.fd);
      const fd = lowestFd(p);
      p.fds.set(fd, id);
      say(`dup(${sel.fd}) → fd ${fd}. Новый номер указывает на тот же открытый файл #${id}: смещение у них общее.`);
      sel = { p: p.name, fd };
      render();
    }
    function doFork() {
      if (procs.length > 1) return;
      procs.push({ name: 'B', pid: 101, fds: new Map(procs[0].fds) });
      say('fork(): процесс B получил копию таблицы дескрипторов. Номера те же и указывают на те же открытые файлы — смещение общее с A.');
      render();
    }
    function doWrite() {
      if (!sel) return;
      const p = curProc();
      const o = ofds.get(p.fds.get(sel.fd));
      if (o.append) o.offset = data.length * CHUNK;
      const at = o.offset / CHUNK;
      if (at >= MAXCH) { say('Для схемы хватит: файл уже 1000 байт. Нажмите «Сброс».'); return; }
      const over = at < data.length && data[at] !== o.id;
      data[at] = o.id;
      o.offset += CHUNK;
      const end = o.offset;
      if (over) {
        say(`${p.name} пишет через fd ${sel.fd} по смещению ${at * CHUNK} — и затирает данные, записанные через другой открытый файл. У каждого open() своё смещение.`, 'bad');
      } else {
        say(`${p.name} пишет 100 байт через fd ${sel.fd} по смещению ${at * CHUNK}${o.append ? ' (O_APPEND: всегда в конец файла)' : ''}. Смещение открытого файла #${o.id} теперь ${end}.`);
      }
      render(at);
    }
    function doClose() {
      if (!sel) return;
      const p = curProc();
      const id = p.fds.get(sel.fd);
      p.fds.delete(sel.fd);
      const still = procs.some(q => [...q.fds.values()].includes(id));
      if (!still) ofds.delete(id);
      say(`close(${sel.fd}) в процессе ${p.name}. ` + (still
        ? `Открытый файл #${id} остался: на него ссылаются другие дескрипторы.`
        : `На открытый файл #${id} больше никто не ссылается — ядро его освободило.`));
      sel = null;
      for (const q of procs) { const f = [...q.fds.keys()][0]; if (f != null) { sel = { p: q.name, fd: f }; break; } }
      render();
    }
    function render(flash) {
      procEl.replaceChildren(...procs.map(p => h('div', { class: 'fd-proc' },
        h('span', { class: 'fd-pname' }, `процесс ${p.name}`, h('small', null, `pid ${p.pid}`)),
        h('div', { class: 'fd-list' },
          h('span', { class: 'fd std' }, '0 1 2'),
          [...p.fds].sort((a, b) => a[0] - b[0]).map(([fd, id]) => h('button', {
            class: 'fd' + (sel && sel.p === p.name && sel.fd === fd ? ' sel' : ''),
            style: `--c:${ofds.get(id).color}`,
            'aria-label': `процесс ${p.name}, fd ${fd}`,
            onclick: () => { sel = { p: p.name, fd }; render(); },
          }, String(fd))),
          p.fds.size ? null : h('span', { class: 'empty' }, 'нет открытых файлов')))));
      const refs = id => procs.reduce((n, p) => n + [...p.fds.values()].filter(v => v === id).length, 0);
      ofdEl.replaceChildren(...[...ofds.values()].map(o => h('div', { class: 'fd-ofd', style: `--c:${o.color}` },
        h('b', null, `#${o.id}`),
        h('span', null, 'смещение ', h('code', null, String(o.offset))),
        h('span', { class: 'label' }, `${refs(o.id)} ${plural(refs(o.id), ['дескриптор', 'дескриптора', 'дескрипторов'])}${o.append ? ' · O_APPEND' : ''}`))));
      if (!ofds.size) ofdEl.append(h('span', { class: 'empty' }, 'нет'));
      inoEl.replaceChildren(
        h('span', { class: 'fd-ino-h' }, `inode 1337 · размер ${data.length * CHUNK} Б`),
        h('div', { class: 'fd-data' }, Array.from({ length: MAXCH }, (_, i) => {
          const id = data[i];
          const c = id == null ? null : COLORS[(id - 1) % COLORS.length];
          return h('i', { class: (id == null ? 'free' : '') + (i === flash ? ' flash' : ''), style: c ? `background:${c}` : null }, id == null ? '' : '#' + id);
        })));
      const ok = !!sel;
      bDup.disabled = bWrite.disabled = bClose.disabled = !ok;
      bFork.disabled = procs.length > 1;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- the path of a write
  Deck.demo('writepath', root => {
    const LAYERS = [
      ['app', 'Буфер приложения', 'память процесса · BufferedWriter, bufio'],
      ['pc', 'Page cache', 'память ядра · грязные страницы'],
      ['dc', 'Кэш диска', 'DRAM контроллера'],
      ['media', 'Носитель', 'NAND / пластины — переживёт всё'],
    ];
    const BUF = 4;
    let recs, n, plp = false;
    const rows = {};
    const box = h('div', { class: 'wp-layers' });
    for (const [k, title, note] of LAYERS) {
      rows[k] = h('div', { class: 'wp-chips' });
      box.append(h('div', { class: 'wp-layer ' + k }, h('div', { class: 'wp-h' }, h('b', null, title), h('span', null, note)), rows[k]));
    }
    const lostEl = h('div', { class: 'wp-lost' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const plpIn = h('input', { type: 'checkbox' });
    plpIn.addEventListener('change', () => { plp = plpIn.checked; say(plp ? 'Серверный SSD с конденсаторами: при пропаже питания он успевает сбросить свой кэш в NAND.' : 'Обычный диск: содержимое его кэша при пропаже питания теряется.'); });
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn small primary', onclick: write }, h('code', null, 'f.write()')),
        h('button', { class: 'btn small', onclick: flush }, h('code', null, 'f.flush()')),
        h('button', { class: 'btn small', onclick: fsync }, h('code', null, 'os.fsync()')),
        h('button', { class: 'btn small', onclick: wait }, 'Прошло 30 с')),
      h('div', { class: 'controls' },
        h('button', { class: 'btn small danger', onclick: kill }, h('code', null, 'kill -9')),
        h('button', { class: 'btn small danger', onclick: power }, 'Отключить питание'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, plpIn, h('span', null, 'диск с защитой от потери питания (PLP)')),
      box, lostEl, logEl,
    );
    const at = k => recs.filter(r => r.loc === k);
    const move = (from, to) => { const m = at(from); m.forEach(r => { r.loc = to; }); return m.length; };
    const names = list => [...list].sort((a, b) => a.n - b.n).map(r => '№' + r.n).join(', ');

    function reset() {
      recs = []; n = 0;
      say('Нажимайте «f.write()»: записи копятся в буфере библиотеки внутри процесса. Буфер — на 4 записи.');
      render();
    }
    function write() {
      let auto = '';
      if (at('app').length >= BUF) {
        move('app', 'pc');
        auto = 'Буфер заполнился — библиотека сама вызвала write(), и прежние записи ушли в ядро. ';
      }
      recs.push({ n: ++n, loc: 'app' });
      say(auto + `Запись №${n} в буфере приложения. Системного вызова не было.`);
      render();
    }
    function flush() {
      const k = move('app', 'pc');
      say(k ? `flush() = write(): ${k} ${plural(k, ['запись', 'записи', 'записей'])} скопированы в page cache. Процесс может умереть — ядро их запишет. Но пока это только RAM.` : 'Буфер приложения пуст.');
      render();
    }
    function fsync() {
      const left = at('app').length;
      const k = move('pc', 'media') + move('dc', 'media');
      say(`fsync(): ядро отправило грязные страницы на диск и командой FLUSH заставило его сбросить свой кэш. ${k ? 'Теперь записи на носителе.' : ''}` +
        (left ? ` Но ${left} ${plural(left, ['запись', 'записи', 'записей'])} в буфере приложения fsync не видит: сначала flush().` : ''), left ? 'warn' : 'ok');
      render();
    }
    function wait() {
      const d = move('dc', 'media');
      const p = move('pc', 'dc');
      say((p ? `Фоновая запись ядра: страницы старше 30 с (dirty_expire) отправлены на диск. Диск ответил «готово», как только положил их в свой кэш. ` : 'Ядру нечего записывать. ') +
        (d ? 'Прежнее содержимое кэша диск уже перенёс на носитель.' : '') +
        (at('app').length ? ' Буфер приложения ядро не трогает — он живёт в процессе.' : ''));
      render();
    }
    function lose(list, why) {
      list.forEach(r => { r.loc = 'lost'; r.why = why; });
    }
    function kill() {
      const a = at('app');
      lose(a, 'kill');
      say(a.length
        ? `kill -9: процесс умер, и его память вместе с буфером пропала — ${plural(a.length, ['потеряна запись', 'потеряны записи', 'потеряны записи'])} ${names(a)}. Всё, что уже в ядре, цело и будет записано.`
        : 'kill -9: процесс умер, но всё уже было в ядре — ничего не потеряно. Процесс перезапущен.', a.length ? 'bad' : 'ok');
      render();
    }
    function power() {
      const lost = [...at('app'), ...at('pc'), ...(plp ? [] : at('dc'))];
      lose(lost, 'power');
      if (plp) move('dc', 'media');
      const kept = at('media').length;
      say(lost.length
        ? `Питание пропало. Потеряны ${names(lost)}: всё, что было в RAM процесса и ядра${plp ? '' : ' и в кэше диска'}. Уцелело ${kept} ${plural(kept, ['запись', 'записи', 'записей'])} на носителе.`
        : 'Питание пропало, но все записи уже на носителе — ничего не потеряно.', lost.length ? 'bad' : 'ok');
      render();
    }
    function render() {
      for (const [k] of LAYERS) {
        const list = at(k);
        rows[k].replaceChildren(...(list.length ? list.map(r => h('span', { class: 'wp-chip ' + k }, '№' + r.n)) : [h('span', { class: 'empty' }, 'пусто')]));
      }
      const lost = recs.filter(r => r.loc === 'lost');
      lostEl.replaceChildren(...(lost.length ? [h('span', { class: 'label' }, 'Потеряно:'), ...lost.map(r => h('span', { class: 'wp-chip lost', title: r.why }, '№' + r.n))] : []));
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- dirty pages and throttling
  Deck.demo('dirty', root => {
    const RAM = 16, BG = 0.10 * RAM, LIM = 0.20 * RAM, FREE = (BG + LIM) / 2; // GB
    const DISKS = [['HDD', 0.15], ['SATA SSD', 0.45], ['NVMe', 2]];
    const RATES = [0.1, 0.3, 0.5, 1, 2, 3];
    const TOTAL = 8, SPEED = 4, WIN = 60;
    let disk = 0, rate = 4, t, written, onDisk, segs, writing, hist, phase, appDoneAt;
    const diskBtns = DISKS.map(([name, s], i) => h('button', { class: 'btn small', onclick: () => { disk = i; render(); } }, `${name} · ${s >= 1 ? dec(s, 0) + ' ГБ/с' : Math.round(s * 1000) + ' МБ/с'}`));
    const rateOut = h('output');
    const rateIn = h('input', { type: 'range', min: 0, max: RATES.length - 1, value: rate, 'aria-label': 'Скорость записи приложения' });
    rateIn.addEventListener('input', () => { rate = +rateIn.value; render(); });
    const goBtn = h('button', { class: 'btn primary', onclick: start }, `Записать файл ${TOTAL} ГБ`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 300 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'dy-chart');
    const stats = h('div', { class: 'stats dy-stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Диск:'), diskBtns),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Приложение пишет'), rateIn, rateOut),
      h('div', { class: 'controls' }, goBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('div', { class: 'dy-chart-wrap' }, svg,
        h('span', { class: 'dy-mark lim', style: `bottom:${(LIM / 4) * 100}%` }, 'dirty_ratio 20%'),
        h('span', { class: 'dy-mark bg', style: `bottom:${(BG / 4) * 100}%` }, 'background 10%')),
      stats, logEl,
    );
    const dirty = () => segs.reduce((s, x) => s + x.gb, 0);

    function reset() {
      t = 0; written = 0; onDisk = 0; segs = []; writing = false; hist = []; phase = 0; appDoneAt = null;
      say(`ОЗУ ${RAM} ГБ: фоновая запись начинается с ${dec(BG)} ГБ грязных страниц, торможение — с ${dec(FREE)} ГБ, предел — ${dec(LIM)} ГБ. Нажмите «Записать».`);
      render();
    }
    function start() {
      if (writing) return;
      reset();
      writing = true;
      say(`Приложение пишет ${TOTAL} ГБ со скоростью до ${RATES[rate] >= 1 ? RATES[rate] + ' ГБ/с' : RATES[rate] * 1000 + ' МБ/с'}. Пока грязных мало, write() — просто копирование в память.`);
      render();
    }
    function step(dt) {
      t += dt;
      const ds = DISKS[disk][1], want = RATES[rate];
      let d = dirty();
      let appRate = 0;
      if (writing) {
        appRate = want;
        if (d > FREE) {
          const f = Math.min(1, (d - FREE) / (LIM - FREE));
          appRate = Math.min(want, want * (1 - f) + ds * f);
        }
        const add = Math.min(appRate * dt, TOTAL - written);
        written += add;
        if (add > 0) segs.push({ t, gb: add });
        if (written >= TOTAL - 1e-9) { writing = false; appDoneAt = t; }
      }
      d = dirty();
      // Writeback: when above the background threshold, or for pages older than 30 s.
      let budget = ds * dt;
      while (budget > 0 && segs.length && (d > BG || t - segs[0].t > 30)) {
        const s = segs[0], take = Math.min(s.gb, budget);
        s.gb -= take; budget -= take; onDisk += take; d -= take;
        if (s.gb <= 1e-9) segs.shift();
      }
      hist.push([t, d]);
      while (hist.length && hist[0][0] < t - WIN) hist.shift();
      // Narrate threshold crossings once.
      if (phase === 0 && d > BG) { phase = 1; say('Грязных больше 10% памяти — проснулись потоки фоновой записи. Приложение этого не замечает.'); }
      if (phase === 1 && d > FREE && writing) { phase = 2; say('Грязных больше 15% — ядро притормаживает writer прямо внутри write() (balance_dirty_pages). Скорость приложения падает до скорости диска.', 'warn'); }
      if (appDoneAt === t) {
        phase = 3;
        say(`Приложение записало ${TOTAL} ГБ за ${dec(t, 0)} с и считает, что всё готово. Но в памяти ещё ${dec(d)} ГБ грязных страниц: ядро допишет их в фоне — до порога сразу, остальное по истечении 30 с. Отключат питание — пропадут.`, d > 0.1 ? 'warn' : 'ok');
      }
      if (phase === 3 && d < 1e-6) { phase = 4; say(`Через ${dec(t, 0)} с всё на диске.`, 'ok'); }
      return appRate;
    }
    let lastRate = 0;
    function render() {
      diskBtns.forEach((b, i) => b.classList.toggle('sel', i === disk));
      rateOut.textContent = RATES[rate] >= 1 ? RATES[rate] + ' ГБ/с' : RATES[rate] * 1000 + ' МБ/с';
      goBtn.disabled = writing;
      const d = segs ? dirty() : 0;
      const t0 = Math.max(0, t - WIN);
      const pts = hist.map(([x, y]) => `${((x - t0) / WIN) * 300},${100 - (y / 4) * 100}`).join(' ');
      svg.innerHTML = `<line x1="0" x2="300" y1="${100 - (LIM / 4) * 100}" y2="${100 - (LIM / 4) * 100}" class="lim"/>` +
        `<line x1="0" x2="300" y1="${100 - (BG / 4) * 100}" y2="${100 - (BG / 4) * 100}" class="bg"/>` +
        (hist.length ? `<polygon points="0,100 ${pts} ${((hist[hist.length - 1][0] - t0) / WIN) * 300},100" class="area"/><polyline points="${pts}" class="ln"/>` : '');
      const thr = writing && lastRate < RATES[rate] * 0.9;
      stats.innerHTML =
        `<div class="stat"><b>${dec(written)} ГБ</b><span>записало приложение</span></div>` +
        `<div class="stat ${d > FREE ? 'warn' : ''}"><b>${dec(d)} ГБ</b><span>грязных в памяти</span></div>` +
        `<div class="stat"><b>${dec(onDisk)} ГБ</b><span>на диске · t = ${dec(t, 0)} с</span></div>` +
        `<div class="stat ${thr ? 'warn' : ''}"><b>${writing ? (lastRate >= 1 ? dec(lastRate) + ' ГБ/с' : Math.round(lastRate * 1000) + ' МБ/с') : '—'}</b><span>${thr ? 'write() тормозит ядро' : 'скорость приложения'}</span></div>`;
    }
    reset();
    return rafLoop(dt => {
      if (!writing && (!segs.length)) return;
      const n = 4;
      for (let i = 0; i < n; i++) lastRate = step((dt * SPEED) / n);
      render();
    });
  });

  // ---------------------------------------------------------------- safe file replacement
  Deck.demo('atomicsave', root => {
    const F = (name, ino, data) => ({ name, ino, data });
    const V1 = [F('config.json', 12, 'v1')];
    const STRATS = [
      ['На месте', [
        { op: 'начало', mem: V1, disk: V1, crash: ['На диске старая версия.', 'ok'] },
        { op: 'open("config.json", "w")  # O_TRUNC', mem: [F('config.json', 12, 'empty')], disk: V1, crash: ['Старая версия или пустой файл — смотря успел ли журнал зафиксировать обрезку. Упади здесь сама программа — файл точно пустой.', 'bad'] },
        { op: 'write(первая половина)', mem: [F('config.json', 12, 'half')], disk: [F('config.json', 12, 'empty')], crash: ['Обрезка уже в журнале, а данные — только в page cache: после перезагрузки файл пустой.', 'bad'] },
        { op: 'write(вторая половина); close()', mem: [F('config.json', 12, 'v2')], disk: [F('config.json', 12, 'empty')], crash: ['Программа закрыла файл и считает, что сохранила. Но данные ещё в памяти: после сбоя файл пустой или обрезанный.', 'bad'] },
        { op: '… через ~30 с ядро запишет данные', mem: [F('config.json', 12, 'v2')], disk: [F('config.json', 12, 'v2')], crash: ['Новая версия на диске. Повезло: окно потери было около 30 секунд.', 'warn'] },
      ]],
      ['tmp + rename', [
        { op: 'начало', mem: V1, disk: V1, crash: ['На диске старая версия.', 'ok'] },
        { op: 'write("config.json.tmp"); close()', mem: [...V1, F('config.json.tmp', 13, 'v2')], disk: V1, crash: ['Старая версия цела. Временный файл пустой или его нет — это мусор, его удалят при старте.', 'ok'] },
        { op: 'rename(tmp → config.json)', mem: [F('config.json', 13, 'v2')], disk: [F('config.json', 13, 'empty')], crash: ['Переименование уже в журнале, а данные нового inode ещё не записаны (отложенное выделение блоков): config.json окажется пустым. ext4 подстраховывает этот шаблон (auto_da_alloc), XFS и другие ФС — не обязаны.', 'bad'] },
        { op: '… через ~30 с ядро запишет данные', mem: [F('config.json', 13, 'v2')], disk: [F('config.json', 13, 'v2')], crash: ['Новая версия на диске — если сбой не случился в предыдущие 30 секунд.', 'warn'] },
      ]],
      ['+ fsync файла', [
        { op: 'начало', mem: V1, disk: V1, crash: ['На диске старая версия.', 'ok'] },
        { op: 'write("config.json.tmp")', mem: [...V1, F('config.json.tmp', 13, 'v2')], disk: V1, crash: ['Старая версия цела.', 'ok'] },
        { op: 'fsync(tmp); close()', mem: [...V1, F('config.json.tmp', 13, 'v2')], disk: [...V1, F('config.json.tmp', 13, 'v2')], crash: ['Старая версия цела, новая целиком лежит во временном файле.', 'ok'] },
        { op: 'rename(tmp → config.json)', mem: [F('config.json', 13, 'v2')], disk: [...V1, F('config.json.tmp', 13, 'v2')], crash: ['Файл целый, но старый: запись в каталоге ещё не дошла до диска, а пользователю уже сказали «сохранено».', 'warn'] },
        { op: '… через ~5 с журнал зафиксирует каталог', mem: [F('config.json', 13, 'v2')], disk: [F('config.json', 13, 'v2')], crash: ['Новая версия на диске.', 'ok'] },
      ]],
      ['+ fsync каталога', [
        { op: 'начало', mem: V1, disk: V1, crash: ['На диске старая версия.', 'ok'] },
        { op: 'write("config.json.tmp")', mem: [...V1, F('config.json.tmp', 13, 'v2')], disk: V1, crash: ['Старая версия цела.', 'ok'] },
        { op: 'fsync(tmp); close()', mem: [...V1, F('config.json.tmp', 13, 'v2')], disk: [...V1, F('config.json.tmp', 13, 'v2')], crash: ['Старая версия цела, новая целиком во временном файле.', 'ok'] },
        { op: 'rename(tmp → config.json)', mem: [F('config.json', 13, 'v2')], disk: [...V1, F('config.json.tmp', 13, 'v2')], crash: ['Старая или новая версия — обе целые. Rename атомарен: третьего не дано.', 'ok'] },
        { op: 'fsync(dir); — теперь «сохранено»', mem: [F('config.json', 13, 'v2')], disk: [F('config.json', 13, 'v2')], crash: ['Новая версия гарантированно на диске. Только теперь можно отвечать «сохранено».', 'ok'] },
      ]],
    ];
    let s = 0, i = 0, crashed = false;
    const sBtns = STRATS.map(([name], k) => h('button', { class: 'btn small', onclick: () => { s = k; i = 0; crashed = false; render(); } }, name));
    const ops = h('ol', { class: 'as-ops' });
    const memEl = h('div', { class: 'as-dir' });
    const diskEl = h('div', { class: 'as-dir disk' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const nextBtn = h('button', { class: 'btn small primary', onclick: () => { if (i < STRATS[s][1].length - 1) { i++; crashed = false; render(); } } }, 'Следующий шаг');
    const crashBtn = h('button', { class: 'btn small danger', onclick: () => { crashed = true; render(); } }, 'Сбой питания здесь');
    root.append(
      h('div', { class: 'controls' }, sBtns),
      ops,
      h('div', { class: 'controls' }, nextBtn, crashBtn, h('button', { class: 'btn small', onclick: () => { i = 0; crashed = false; render(); } }, 'Сначала')),
      h('div', { class: 'as-cols' },
        h('div', null, h('div', { class: 'label' }, 'Видят программы'), memEl),
        h('div', null, h('div', { class: 'label' }, 'На диске (после сбоя)'), diskEl)),
      logEl,
    );
    const DATA = { v1: ['старая', 'full'], v2: ['новая', 'full new'], half: ['половина', 'half new'], empty: ['пусто', 'empty'] };
    const files = list => list.map(f => h('div', { class: 'as-file' },
      h('code', null, f.name), h('span', { class: 'as-ino' }, '→ #' + f.ino),
      h('span', { class: 'as-data ' + DATA[f.data][1] }, h('i'), DATA[f.data][0])));
    function render() {
      const steps = STRATS[s][1];
      sBtns.forEach((b, k) => b.classList.toggle('sel', k === s));
      ops.replaceChildren(...steps.slice(1).map((st, k) => h('li', { class: k + 1 < i ? 'done' : k + 1 === i ? 'cur' : '' }, h('code', null, st.op))));
      const st = steps[i];
      memEl.replaceChildren(...files(st.mem));
      diskEl.replaceChildren(...files(st.disk));
      diskEl.classList.toggle('crashed', crashed);
      nextBtn.disabled = i >= steps.length - 1;
      crashBtn.disabled = crashed;
      if (crashed) {
        logEl.className = 'log ' + st.crash[1];
        logEl.innerHTML = '<b>После перезагрузки:</b> ' + st.crash[0];
      } else {
        logEl.className = 'log';
        logEl.textContent = i === 0 ? 'Нажимайте «Следующий шаг» и в любой момент — «Сбой питания здесь».' : `Шаг ${i}: ${st.op.replace(/\s+#.*/, '')}. Нажмите «Сбой питания здесь», чтобы увидеть, что останется.`;
      }
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- inodes, links, deleting an open file
  Deck.demo('inodes', root => {
    let dir, inodes, nextIno, proc, freed;
    const dirEl = h('div', { class: 'in-dir' });
    const inoEl = h('div', { class: 'in-inodes' });
    const usage = h('div', { class: 'in-usage' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const B = (label, fn) => h('button', { class: 'btn small', onclick: () => { freed = []; fn(); render(); } }, h('code', null, label));
    const bLn = B('ln a b', () => link('b'));
    const bSym = B('ln -s a c', symlink);
    const bRmA = B('rm a', () => rm('a'));
    const bRmB = B('rm b', () => rm('b'));
    const bOpen = B('tail -f b', open);
    const bKill = B('kill tail', kill);
    const bCat = B('cat c', cat);
    const bNew = B('echo new > a', create);
    root.append(
      h('div', { class: 'controls' }, bLn, bSym, bRmA, bRmB, bNew),
      h('div', { class: 'controls' }, bOpen, bKill, bCat, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('div', { class: 'in-cols' },
        h('div', null, h('div', { class: 'label' }, 'Каталог /data'), dirEl),
        h('div', null, h('div', { class: 'label' }, 'Inode'), inoEl)),
      usage, logEl,
    );
    const find = name => dir.find(e => e.name === name);
    const links = ino => dir.filter(e => e.ino === ino).length;
    function reset() {
      dir = [{ name: 'a', ino: 12 }];
      inodes = new Map([[12, { ino: 12, kind: 'file', size: 2, text: 'old' }]]);
      nextIno = 13; proc = null; freed = [];
      say('В каталоге одно имя «a» → inode 12 (файл на 2 ГБ). Сделайте жёсткую и символическую ссылки.');
      render();
    }
    function maybeFree(ino) {
      const node = inodes.get(ino);
      if (!node || links(ino) > 0 || proc === ino) return false;
      inodes.delete(ino);
      freed.push(node);
      return true;
    }
    function link(name) {
      const a = find('a');
      dir.push({ name, ino: a.ino });
      say(`ln a ${name}: в каталоге второе имя для того же inode ${a.ino}. Счётчик ссылок — 2. «Главного» имени нет: оба равноправны.`);
    }
    function symlink() {
      const ino = nextIno++;
      inodes.set(ino, { ino, kind: 'sym', size: 0, target: 'a' });
      dir.push({ name: 'c', ino });
      say(`ln -s a c: новый inode ${ino}, внутри которого строка «a». Ядро будет искать это имя при каждом обращении.`);
    }
    function rm(name) {
      const e = find(name);
      dir = dir.filter(x => x !== e);
      const node = inodes.get(e.ino);
      const left = links(e.ino);
      if (maybeFree(e.ino)) {
        say(`rm ${name}: имя удалено. Ссылок на inode ${e.ino} не осталось, и файл никто не держит открытым — ${node.kind === 'file' ? `${node.size} ГБ` : 'место'} освобождено.`, 'ok');
      } else if (left) {
        say(`rm ${name}: удалено одно имя. У inode ${e.ino} ещё ${left} ${plural(left, ['имя', 'имени', 'имён'])} — данные на месте.`);
      } else {
        say(`rm ${name}: имени больше нет, du считает место свободным. Но процесс tail держит inode ${e.ino} открытым — df место не вернул. Так «пропадает» диск.`, 'bad');
      }
    }
    function open() {
      const e = find('b') || find('a');
      proc = e.ino;
      say(`tail -f ${e.name}: процесс открыл inode ${e.ino}. Теперь дескриптор — ещё одна ссылка на файл, хотя и не в каталоге.`);
    }
    function kill() {
      const ino = proc;
      proc = null;
      const node = inodes.get(ino);
      if (maybeFree(ino)) say(`tail завершился и закрыл дескриптор. На inode ${ino} больше ничего не ссылается — ${node.size} ГБ освобождены, df и du снова сходятся.`, 'ok');
      else say('tail завершился. У файла остались имена — он на месте.');
    }
    function cat() {
      const c = find('c');
      const a = find('a');
      if (!a) say('cat c: символическая ссылка указывает на имя «a», а его нет — «No such file or directory». Жёсткая ссылка b при этом работает.', 'warn');
      else {
        const node = inodes.get(a.ino);
        say(`cat c → путь «a» → inode ${a.ino}: ${node.text === 'new' ? 'это уже новый файл, не тот, на который ссылается b' : 'содержимое файла'}.`);
      }
      return c;
    }
    function create() {
      const ino = nextIno++;
      inodes.set(ino, { ino, kind: 'file', size: 1, text: 'new' });
      dir.push({ name: 'a', ino });
      say(`echo new > a: новое имя «a» → новый inode ${ino}. Симлинк c теперь ведёт сюда, а b — по-прежнему к старому файлу.`);
    }
    function render() {
      dirEl.replaceChildren(...dir.map(e => {
        const node = inodes.get(e.ino);
        return h('div', { class: 'in-entry' }, h('code', null, e.name), h('span', null, '→ ' + e.ino),
          node.kind === 'sym' ? h('span', { class: 'label' }, `симлинк на «${node.target}»`) : null);
      }), ...(dir.length ? [] : [h('span', { class: 'empty' }, 'пусто')]));
      const all = [...inodes.values(), ...freed];
      inoEl.replaceChildren(...all.map(n => {
        const gone = freed.includes(n);
        const l = gone ? 0 : links(n.ino);
        return h('div', { class: 'in-node' + (gone ? ' freed' : '') + (n.kind === 'sym' ? ' sym' : '') + (!gone && !l ? ' orphan' : '') },
          h('b', null, '#' + n.ino),
          h('span', null, n.kind === 'sym' ? 'путь «a»' : `${n.size} ГБ`),
          h('span', { class: 'label' }, gone ? 'освобождён' : `ссылок: ${l}${proc === n.ino ? ' · открыт tail' : ''}`));
      }));
      const files = [...inodes.values()].filter(n => n.kind === 'file');
      const df = files.reduce((s, n) => s + n.size, 0);
      const du = files.filter(n => links(n.ino) > 0).reduce((s, n) => s + n.size, 0);
      usage.innerHTML = `<span><code>df</code> занято <b>${df} ГБ</b></span><span><code>du</code> насчитал <b>${du} ГБ</b></span>` +
        (df !== du ? '<span class="in-diff">расходятся: ищите <code>lsof +L1</code></span>' : '');
      const a = find('a'), b = find('b'), c = find('c');
      bLn.disabled = !a || !!b;
      bSym.disabled = !!c;
      bRmA.disabled = !a;
      bRmB.disabled = !b;
      bNew.disabled = !!a;
      bOpen.disabled = proc != null || !(b || a);
      bOpen.firstChild.textContent = 'tail -f ' + (b ? 'b' : 'a');
      bKill.disabled = proc == null;
      bCat.disabled = !c;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- page cache on reads
  Deck.demo('pagecache', root => {
    const RAM = 16, DISK = 0.5, MEMBW = 10; // GB, GB/s
    const FILES = [['orders.csv', 4, '#9c5b12'], ['backup.tar', 10, '#7a5ea8']];
    let apps, cache, reading;
    const bar = h('div', { class: 'pc-bar' });
    const freeOut = h('pre', { class: 'code pc-free' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const readBtns = FILES.map(([name, size], f) => h('button', { class: 'btn small primary', onclick: () => read(f) }, h('code', null, `cat ${name}`), ` (${size} ГБ)`));
    const appBtn = h('button', { class: 'btn small', onclick: toggleApp }, 'Запустить JVM на 6 ГБ');
    const dropBtn = h('button', { class: 'btn small', onclick: () => { cache = []; say('echo 3 > /proc/sys/vm/drop_caches: ядро выбросило чистые страницы кэша. Следующее чтение снова пойдёт с диска.'); render(); } }, h('code', null, 'drop_caches'));
    root.append(
      h('div', { class: 'controls' }, readBtns),
      h('div', { class: 'controls' }, appBtn, dropBtn),
      h('div', null, h('div', { class: 'pc-legend' }, h('span', null, `RAM ${RAM} ГБ, по 1 ГБ на клетку`), h('span', null, 'кэш: старые ← → свежие')), bar,
        h('div', { class: 'pc-legend keys' },
          h('span', null, h('i', { class: 'sw', style: 'background:#9fb0c0' }), 'программы'),
          FILES.map(([name, , c]) => h('span', null, h('i', { class: 'sw', style: `background:${c}` }), name)),
          h('span', null, h('i', { class: 'sw free' }), 'свободно'))),
      freeOut, logEl,
    );
    function reset() {
      apps = 4; cache = []; reading = null;
      say(`Программы занимают ${apps} ГБ. Диск читает 500 МБ/с, память — около 10 ГБ/с. Прочитайте orders.csv два раза.`);
      render();
    }
    function toggleApp() {
      if (apps === 4) {
        apps = 10;
        const cap = RAM - apps;
        const drop = Math.max(0, cache.length - cap);
        cache.splice(0, drop);
        say(drop ? `JVM попросила 6 ГБ. Свободной памяти не хватило — ядро без записи на диск выбросило ${drop} ГБ самых старых страниц кэша. Они чистые, их можно перечитать.` : 'JVM взяла 6 ГБ из свободной памяти.');
      } else {
        apps = 4;
        say('JVM завершилась, 6 ГБ свободны — кэш снова может расти.');
      }
      render();
    }
    function read(f) {
      if (reading) return;
      reading = { f, i: 0, t: 0, hits: 0, last: false };
      render();
    }
    function stepChunk() {
      const r = reading;
      const k = cache.findIndex(c => c.f === r.f && c.i === r.i);
      if (k >= 0) {
        cache.push(cache.splice(k, 1)[0]);
        r.t += 1 / MEMBW; r.hits++;
      } else {
        if (cache.length >= RAM - apps) cache.shift();
        cache.push({ f: r.f, i: r.i });
        r.t += 1 / DISK;
      }
      r.last = k >= 0;
      r.i++;
      if (r.i >= FILES[r.f][1]) {
        const [name, size] = FILES[r.f];
        const all = r.hits === size, none = r.hits === 0;
        say(`cat ${name}: ${size} ГБ за ${dec(r.t)} с — ${all ? 'всё из page cache' : none ? 'всё с диска' : `${r.hits} ГБ из кэша, остальное с диска`}.` +
          (none && size > RAM - apps ? ` Файл больше, чем помещается в кэш (${RAM - apps} ГБ): при чтении подряд новые страницы вытесняют начало файла, и следующее чтение снова пойдёт с диска.` : ''),
          all ? 'ok' : none ? '' : 'warn');
        reading = null;
      }
      render();
    }
    function render() {
      const cells = [];
      for (let i = 0; i < apps; i++) cells.push(h('i', { class: 'app' }));
      cache.forEach(c => cells.push(h('i', { class: 'cache' + (reading && c.f === reading.f && c.i === reading.i - 1 ? ' hot' : ''), style: `background:${FILES[c.f][2]}` }, String(c.i + 1))));
      while (cells.length < RAM) cells.push(h('i', { class: 'free' }));
      bar.replaceChildren(...cells);
      const used = apps, bc = cache.length, free = RAM - used - bc;
      freeOut.innerHTML = `$ free -g\n      total  used  free  buff/cache  available\nMem:     ${RAM}   ${String(used).padStart(3)}   ${String(free).padStart(3)}         ${String(bc).padStart(3)}        ${String(free + bc).padStart(3)}`;
      readBtns.forEach(b => { b.disabled = !!reading; });
      appBtn.disabled = dropBtn.disabled = !!reading;
      appBtn.textContent = apps === 4 ? 'Запустить JVM на 6 ГБ' : 'Остановить JVM';
    }
    reset();
    let last = 0;
    return rafLoop(() => {
      if (!reading) { last = 0; return; }
      const now = performance.now();
      if (!last) last = now;
      // A chunk from the cache appears 3× faster than one from the disk.
      const need = reading.last ? 120 : 360;
      if (now - last >= need) { last = now; stepChunk(); }
    });
  });

  // ---------------------------------------------------------------- read buffer size vs mmap
  Deck.demo('readbuf', root => {
    const FILE = 2 ** 30, SYSCALL = 0.5e-6, COPY = 0.1, FAULT = 1e-6, DISK = 0.5;
    const OPTS = [
      ['1 Б', 1, 'FileInputStream.read(), os.read(fd, 1)'],
      ['64 Б', 64, 'ручной цикл с маленьким буфером'],
      ['4 КБ', 4096, 'bufio.Reader по умолчанию'],
      ['64 КБ', 65536, 'хороший размер для потоков'],
      ['1 МБ', 2 ** 20, 'дальше выигрыша почти нет'],
      ['mmap', 0, 'без копирования, page faults'],
    ];
    let cur = 3, cold = false;
    const rows = h('div', { class: 'rb-rows' });
    const coldIn = h('input', { type: 'checkbox' });
    coldIn.addEventListener('change', () => { cold = coldIn.checked; render(); });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'label' }, 'Прочитать файл 1 ГБ целиком. Нажмите на строку.'),
      rows,
      h('label', { class: 'toggle' }, coldIn, h('span', null, 'файла нет в page cache (диск 2 ГБ/с)')),
      logEl,
    );
    function model([, size]) {
      const diskT = cold ? DISK : 0;
      if (!size) {
        const faults = FILE / 65536; // fault-around maps 16 pages per fault
        return { calls: 0, faults, t: faults * FAULT + diskT, copy: 0, sys: faults * FAULT, diskT };
      }
      const calls = FILE / size;
      return { calls, t: calls * SYSCALL + COPY + diskT, copy: COPY, sys: calls * SYSCALL, diskT };
    }
    const big = n => n >= 1e9 ? dec(n / 1e9, 1) + ' млрд' : n >= 1e6 ? dec(n / 1e6, 1) + ' млн' : n >= 1e4 ? Math.round(n / 1e3) + ' тыс.' : String(Math.round(n));
    const pos = t => Math.max(2, Math.min(100, ((Math.log10(t) + 2) / 5) * 100)); // 0,01 с … 1000 с
    function render() {
      rows.replaceChildren(...OPTS.map((o, i) => {
        const m = model(o);
        return h('button', { class: 'rb-row' + (i === cur ? ' sel' : ''), onclick: () => { cur = i; render(); } },
          h('b', null, o[0]),
          h('span', { class: 'cost-track' }, h('span', { class: 'cost-fill', style: `width:${pos(m.t)}%` })),
          h('code', null, secs(m.t)));
      }));
      const o = OPTS[cur], m = model(o);
      logEl.className = 'log' + (m.t > 10 ? ' bad' : '');
      logEl.innerHTML = o[1]
        ? `<b>${o[0]}</b> (${o[2]}): ${big(m.calls)} вызовов read() × ~0,5 мкс = ${secs(m.sys)}, копирование в буфер ${secs(m.copy)}` + (cold ? `, диск ${secs(m.diskT)}` : '') + '.' +
          (m.t > 10 ? ' Время уходит на переходы в ядро, а не на данные.' : cold ? ' С диска ядро всё равно читает крупно (readahead), поэтому размер буфера уже почти не важен.' : '')
        : `<b>mmap</b>: системных вызовов нет, копирования нет. ${big(m.faults)} page faults (ядро отображает по 16 страниц за раз) ≈ ${secs(m.sys)}` + (cold ? `, диск ${secs(m.diskT)}` : '') +
          '. Но ошибка ввода-вывода прилетит сигналом SIGBUS, а ожидание диска внутри page fault заблокирует поток — в Go и Node это незаметная блокировка.';
    }
    render();
    return {};
  });
})();

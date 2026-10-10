// Demos for slides 14–18: device speed calculator, SSD internals, group commit, log rotation.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const ms = s => s >= 1 ? dec(s, s < 10 ? 1 : 0) + ' с' : s >= 1e-3 ? dec(s * 1e3, s < 1e-2 ? 1 : 0) + ' мс' : dec(s * 1e6, 0) + ' мкс';
  const dur = s => s >= 3600 ? dec(s / 3600, 1) + ' ч' : s >= 60 ? dec(s / 60, s < 600 ? 1 : 0) + ' мин' : ms(s);

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }

  // ---------------------------------------------------------------- HDD / SSD / NVMe calculator
  Deck.demo('iocalc', root => {
    // lat: one random 4 KB read at queue depth 1; max: IOPS ceiling; seq: MB/s; seqLat: per-request overhead for 1 MB reads.
    const DEV = [
      { name: 'HDD 7200', lat: 8.5e-3, max: 200, seq: 200, seqLat: 2e-4 },
      { name: 'Облачный диск', note: 'gp3, базовый', lat: 6e-4, max: 3000, seq: 125, seqLat: 6e-4 },
      { name: 'SATA SSD', lat: 9e-5, max: 95000, seq: 550, seqLat: 5e-5 },
      { name: 'NVMe SSD', lat: 7e-5, max: 1000000, seq: 7000, seqLat: 2e-5 },
    ];
    const QD = [1, 2, 4, 8, 16, 32, 64, 128];
    let rnd = true, qi = 0;
    const pBtns = [['Вразброс по 4 КБ', true], ['Подряд по 1 МБ', false]].map(([l, v]) => h('button', { class: 'btn small', onclick: () => { rnd = v; render(); } }, l));
    const qOut = h('output');
    const qIn = h('input', { type: 'range', min: 0, max: QD.length - 1, value: qi, 'aria-label': 'Глубина очереди' });
    qIn.addEventListener('input', () => { qi = +qIn.value; render(); });
    const rows = h('div', { class: 'io-rows' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' }, pBtns),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Глубина очереди'), qIn, qOut),
      rows, h('p', { class: 'note' }, 'Шкала логарифмическая: каждое деление — в 10 раз.'), logEl,
    );
    function calc(d) {
      const q = QD[qi];
      if (rnd) {
        const iops = Math.min(d.max, q / d.lat);
        return { iops, mbs: iops * 4096 / 1e6, lat: q / iops, task: 1e6 / iops };
      }
      const t = d.seqLat + 1 / d.seq; // seconds per 1 MB request
      const iops = Math.min(d.seq, q / t);
      return { iops, mbs: iops, lat: q / iops, task: 10000 / iops };
    }
    const pos = mbs => Math.max(2, Math.min(100, ((Math.log10(mbs) + 1) / 5) * 100)); // 0,1 … 10 000 МБ/с
    function render() {
      pBtns.forEach((b, i) => b.classList.toggle('sel', (i === 0) === rnd));
      qOut.textContent = QD[qi];
      const res = DEV.map(calc);
      rows.replaceChildren(...DEV.map((d, i) => {
        const r = res[i];
        return h('div', { class: 'io-row' },
          h('b', null, d.name, d.note ? h('small', null, d.note) : null),
          h('span', { class: 'cost-track' }, h('span', { class: 'cost-fill', style: `width:${pos(r.mbs)}%` })),
          h('span', { class: 'io-nums' },
            h('span', null, h('b', null, r.mbs >= 100 ? fmt(r.mbs) : dec(r.mbs, r.mbs < 10 ? 1 : 0)), ' МБ/с'),
            h('span', null, h('b', null, fmt(r.iops)), ' IOPS'),
            h('span', null, h('b', null, ms(r.lat)), ' задержка'),
            h('span', null, h('b', null, dur(r.task)), rnd ? ' на 1 млн чтений' : ' на 10 ГБ')));
      }));
      const [hdd, , sata, nvme] = res;
      const q = QD[qi];
      if (rnd) {
        logEl.className = 'log';
        logEl.innerHTML = `Случайное чтение, ${q} ${plural(q, ['запрос', 'запроса', 'запросов'])} в очереди: NVMe быстрее HDD в ${fmt(nvme.iops / hdd.iops)} раз.` +
          (q === 1 ? ' При глубине 1 скорость SSD упирается в задержку одного запроса — он почти простаивает. Увеличьте глубину.'
            : nvme.iops >= DEV[3].max ? ' NVMe вышел на свой потолок по IOPS — дальше растёт только задержка.' : ` Задержка почти не растёт: запросы выполняются параллельно.`) +
          (q >= 4 && hdd.iops >= DEV[0].max ? ' HDD дальше не ускоряется: головка одна, очередь лишь даёт ему выбрать порядок, и задержка растёт.' : '');
      } else {
        logEl.className = 'log ok';
        logEl.innerHTML = `Подряд разница меньше: HDD ${fmt(hdd.mbs)} МБ/с против ${fmt(nvme.mbs)} МБ/с у NVMe — в ${fmt(nvme.mbs / hdd.mbs)} раз, а не в тысячи. SATA SSD упирается в интерфейс: ${fmt(sata.mbs)} МБ/с.`;
      }
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- SSD: FTL, garbage collection, write amplification, TRIM
  Deck.demo('ssd', root => {
    const NB = 10, NP = 8, FILE = 16, MAXF = 4; // 80 physical pages, 64 logical pages
    let pages, map, active, freeBlocks, files, host, nand, erases, hist, trim = true, auto = false, acc = 0, lastGc = null;
    const grid = h('div', { class: 'ssd-grid' });
    const stats = h('div', { class: 'stats ssd-stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const trimIn = h('input', { type: 'checkbox', checked: true });
    trimIn.addEventListener('change', () => { trim = trimIn.checked; say(trim ? 'TRIM включён: при удалении файла ФС сообщит диску, какие страницы больше не нужны.' : 'TRIM выключен: диск узнает об удалении, только когда ФС запишет что-то новое по тем же адресам.'); });
    const bCreate = h('button', { class: 'btn small', onclick: () => { createFile(); render(); } }, 'Создать файл');
    const bRand = h('button', { class: 'btn small primary', onclick: () => { for (let i = 0; i < 16; i++) randomWrite(); report(); render(); } }, 'Перезаписать 16 стр.');
    const bDel = h('button', { class: 'btn small', onclick: () => { deleteFile(); render(); } }, 'Удалить файл');
    const bAuto = h('button', { class: 'btn small', onclick: () => { auto = !auto; render(); } }, 'Авто');
    root.append(
      h('div', { class: 'controls' }, bCreate, bRand, bDel, bAuto, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, trimIn, h('span', null, 'TRIM (discard)')),
      grid,
      h('div', { class: 'ssd-legend' },
        h('span', null, h('i', { class: 'pg valid' }), 'данные'),
        h('span', null, h('i', { class: 'pg stale' }), 'удалены, но диск не знает'),
        h('span', null, h('i', { class: 'pg invalid' }), 'мусор'),
        h('span', null, h('i', { class: 'pg' }), 'стёрта')),
      stats, logEl,
    );

    function reset() {
      pages = Array.from({ length: NB }, () => Array.from({ length: NP }, () => ({ s: 'free', lba: -1 })));
      map = new Map(); active = null; freeBlocks = [...Array(NB).keys()];
      files = Array(MAXF).fill(false); host = 0; nand = 0; erases = 0; hist = []; auto = false; lastGc = null;
      for (let i = 0; i < 3; i++) createFile(true);
      host = 0; nand = 0; hist = [];
      say('Диск: 10 блоков по 8 страниц, ФС видит 64 страницы — 20% запаса. Три файла уже записаны. Перезаписывайте страницы и следите за WAF.');
      render();
    }
    function place(lba) {
      if (active == null || pages[active].every(p => p.s !== 'free')) active = freeBlocks.shift();
      const pi = pages[active].findIndex(p => p.s === 'free');
      pages[active][pi] = { s: 'valid', lba };
      map.set(lba, [active, pi]);
      nand++;
    }
    function gc() {
      let victim = -1, best = 0;
      pages.forEach((blk, b) => {
        if (b === active || freeBlocks.includes(b)) return;
        const inv = blk.filter(p => p.s === 'invalid').length;
        if (inv > best) { best = inv; victim = b; }
      });
      if (victim < 0) return false;
      const moved = pages[victim].filter(p => p.s === 'valid').map(p => p.lba);
      pages[victim] = pages[victim].map(() => ({ s: 'free', lba: -1 }));
      for (const lba of moved) { map.delete(lba); place(lba); }
      erases++;
      freeBlocks.push(victim);
      lastGc = { victim, moved: moved.length, stale: moved.filter(l => !live(l)).length };
      return true;
    }
    const live = lba => files[Math.floor(lba / FILE)];
    // Free pages left for new data: erased blocks plus the rest of the open block. GC keeps at least one block's worth.
    const freePages = () => freeBlocks.length * NP + (active == null ? 0 : pages[active].filter(p => p.s === 'free').length);
    function write(lba) {
      const old = map.get(lba);
      if (old) pages[old[0]][old[1]] = { s: 'invalid', lba: -1 };
      place(lba);
      host++;
      while (freePages() < NP && gc());
      hist.push([host, nand]);
      if (hist.length > 65) hist.shift();
    }
    function createFile(quiet) {
      const f = files.indexOf(false);
      if (f < 0) return;
      files[f] = true;
      for (let i = 0; i < FILE; i++) write(f * FILE + i);
      if (!quiet) say(`Файл записан: 16 страниц. ${trim ? '' : 'Без TRIM старые копии этих адресов стали мусором только сейчас — при перезаписи.'}`);
    }
    function randomWrite() {
      const lbas = [];
      files.forEach((on, f) => { if (on) for (let i = 0; i < FILE; i++) lbas.push(f * FILE + i); });
      if (!lbas.length) return;
      write(lbas[Math.floor(Math.random() * lbas.length)]);
    }
    function deleteFile() {
      const f = files.indexOf(true);
      if (f < 0) return;
      files[f] = false;
      if (trim) {
        for (let i = 0; i < FILE; i++) {
          const lba = f * FILE + i, at = map.get(lba);
          if (at) { pages[at[0]][at[1]] = { s: 'invalid', lba: -1 }; map.delete(lba); }
        }
        say('Файл удалён, TRIM пометил его 16 страниц мусором. У диска стало больше свободного места для манёвра — WAF упадёт.', 'ok');
      } else {
        say('Файл удалён в ФС, но диск об этом не знает: для него эти 16 страниц — живые данные, и сборщик мусора будет их переносить.', 'warn');
      }
    }
    const recentWaf = () => {
      if (hist.length < 2) return null;
      const [h0, n0] = hist[0], [h1, n1] = hist[hist.length - 1];
      return h1 > h0 ? (n1 - n0) / (h1 - h0) : null;
    };
    function report() {
      const w = recentWaf();
      if (lastGc) {
        const g = lastGc;
        say(`Сборщик мусора стёр блок ${g.victim + 1}, перенеся ${g.moved} ${plural(g.moved, ['живую страницу', 'живые страницы', 'живых страниц'])}` +
          (g.stale ? `, из них ${g.stale} — данные удалённых файлов (нет TRIM)` : '') + `. WAF ≈ ${w ? dec(w, 2) : '1'}: на каждую страницу от ОС диск пишет ${w ? dec(w, 1) : '1'}.`, g.stale ? 'warn' : '');
        lastGc = null;
      }
    }
    function render() {
      grid.replaceChildren(...pages.map((blk, b) => h('div', { class: 'ssd-blk' + (b === active ? ' act' : '') },
        h('span', { class: 'ssd-bn' }, String(b + 1)),
        h('div', { class: 'ssd-pages' }, blk.map(p => h('i', { class: 'pg ' + (p.s === 'valid' && !live(p.lba) ? 'stale' : p.s === 'free' ? '' : p.s) }))))));
      const w = recentWaf();
      stats.innerHTML =
        `<div class="stat"><b>${host}</b><span>записей от ОС</span></div>` +
        `<div class="stat"><b>${nand}</b><span>записей в NAND</span></div>` +
        `<div class="stat ${w > 2 ? 'warn' : ''}"><b>${w ? dec(w, 2) : '—'}</b><span>WAF (последние 64)</span></div>` +
        `<div class="stat"><b>${erases}</b><span>${plural(erases, ['стирание', 'стирания', 'стираний'])}</span></div>`;
      bCreate.disabled = !files.includes(false);
      bDel.disabled = !files.includes(true);
      bRand.disabled = !files.includes(true);
      bAuto.classList.toggle('sel', auto);
      bAuto.textContent = auto ? 'Стоп' : 'Авто';
    }
    reset();
    const loop = rafLoop(dt => {
      if (!auto) return;
      acc += dt;
      if (acc < 0.12) return;
      acc = 0;
      randomWrite();
      report();
      render();
    });
    return { start: loop.start, stop() { loop.stop(); auto = false; render(); } };
  });

  // ---------------------------------------------------------------- group commit
  Deck.demo('groupcommit', root => {
    const DEV = [['HDD', 8e-3], ['SATA SSD', 2e-3], ['NVMe с PLP', 5e-5]];
    const NS = [1, 2, 4, 8, 16, 32, 64];
    const UNIT = 0.6; // real seconds per fsync on screen
    let dev = 0, ni = 3, group = false, clients, queue, batch, prog, done, fsyncs, hist;
    const devBtns = DEV.map(([n, l], i) => h('button', { class: 'btn small', onclick: () => { dev = i; render(); } }, `${n} · ${ms(l)}`));
    const nOut = h('output');
    const nIn = h('input', { type: 'range', min: 0, max: NS.length - 1, value: ni, 'aria-label': 'Клиенты' });
    nIn.addEventListener('input', () => { ni = +nIn.value; setup(); });
    const gIn = h('input', { type: 'checkbox' });
    gIn.addEventListener('change', () => { group = gIn.checked; hist = []; render(); });
    const dots = h('div', { class: 'gc-dots' });
    const fs = h('div', { class: 'gc-fsync' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'fsync:'), devBtns),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Клиентов'), nIn, nOut),
      h('label', { class: 'toggle' }, gIn, h('span', null, 'group commit')),
      h('div', { class: 'label' }, 'Клиенты: серые работают, светлые ждут fsync, тёмные — внутри текущего fsync'),
      dots, fs, stats, logEl,
    );
    function setup() {
      const n = NS[ni];
      clients = Array.from({ length: n }, () => ({ s: 'work', t: Math.random() * 0.3, since: 0 }));
      queue = []; batch = []; prog = 0; done = 0; fsyncs = 0; hist = [];
      render();
    }
    let now = 0;
    function step(dt) {
      now += dt;
      clients.forEach((c, i) => {
        if (c.s === 'work' && (c.t -= dt) <= 0) { c.s = 'wait'; c.since = now; queue.push(i); }
      });
      if (batch.length) {
        prog += dt;
        if (prog >= 1) {
          for (const i of batch) { clients[i].s = 'work'; clients[i].t = 0.05 + Math.random() * 0.25; }
          hist.push([now, batch.length]);
          while (hist.length && hist[0][0] < now - 8) hist.shift();
          batch = []; prog = 0; fsyncs++;
        }
      }
      if (!batch.length && queue.length) {
        batch = group ? queue.splice(0) : queue.splice(0, 1);
        batch.forEach(i => { clients[i].s = 'sync'; });
      }
    }
    function render() {
      devBtns.forEach((b, i) => b.classList.toggle('sel', i === dev));
      nOut.textContent = NS[ni];
      dots.replaceChildren(...clients.map(c => h('i', { class: c.s })));
      fs.innerHTML = `<span class="gc-bar"><span style="width:${prog * 100}%"></span></span><span>fsync ${batch.length ? `· ${batch.length} ${plural(batch.length, ['коммит', 'коммита', 'коммитов'])}` : '· ждёт'}</span>`;
      const L = DEV[dev][1];
      const span = hist.length > 1 ? hist[hist.length - 1][0] - hist[0][0] : 0;
      const per = hist.length > 1 ? hist.slice(1).reduce((s, x) => s + x[1], 0) / (hist.length - 1) : 1;
      const tps = hist.length > 1 ? (hist.slice(1).reduce((s, x) => s + x[1], 0) / span) / L : null;
      const n = NS[ni];
      const lat = tps ? n / tps : null;
      stats.innerHTML =
        `<div class="stat"><b>${fmt(1 / L)}</b><span>fsync в секунду — предел диска</span></div>` +
        `<div class="stat"><b>${tps ? fmt(tps) : '…'}</b><span>коммитов в секунду</span></div>` +
        `<div class="stat ${lat && lat > 10 * L ? 'warn' : ''}"><b>${lat ? ms(lat) : '…'}</b><span>на коммит (в среднем)</span></div>`;
      logEl.className = 'log' + (!group && n > 1 ? ' warn' : group && n > 1 ? ' ok' : '');
      logEl.innerHTML = !group
        ? `Без group commit каждый fsync подтверждает один коммит: не больше ${fmt(1 / L)} коммитов в секунду при любом числе клиентов.` + (n > 1 ? ` ${n} клиентов просто стоят в очереди, задержка растёт в ${n} раз.` : '')
        : `Один fsync подтверждает всех, кто успел встать в очередь: в среднем ${dec(per, 1)} ${plural(Math.round(per), ['коммит', 'коммита', 'коммитов'])}. Пропускная способность растёт с числом клиентов, а цена одного fsync делится на всех.`;
    }
    setup();
    let acc = 0;
    return rafLoop(dt => {
      step(dt / UNIT);
      acc += dt;
      if (acc > 0.05) { acc = 0; render(); }
    });
  });

  // ---------------------------------------------------------------- log rotation
  Deck.demo('logrotate', root => {
    const MODES = [['rename + SIGHUP', 'reopen'], ['rename без сигнала', 'nosig'], ['copytruncate', 'copy']];
    const CH = 10, TICK = 0.45, COPY_TICKS = 2;
    let mode = 'reopen', append = true, inodes, dir, fd, offset, copying, nextIno, acc = 0, lostTotal;
    const mBtns = MODES.map(([l, m]) => h('button', { class: 'btn small', onclick: () => { mode = m; reset(); } }, l));
    const appIn = h('input', { type: 'checkbox', checked: true });
    appIn.addEventListener('change', () => { append = appIn.checked; reset(); });
    const appLabel = h('label', { class: 'toggle' }, appIn, h('span', null, 'приложение открыло лог с ', h('code', null, 'O_APPEND')));
    const rotBtn = h('button', { class: 'btn small primary', onclick: rotate }, 'Ротация');
    const delBtn = h('button', { class: 'btn small', onclick: del }, h('code', null, 'rm app.log.1'));
    const table = h('div', { class: 'lr-table' });
    const procEl = h('div', { class: 'lr-proc' });
    const usage = h('div', { class: 'in-usage' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' }, mBtns),
      appLabel,
      h('div', { class: 'controls' }, rotBtn, delBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      procEl, table, usage, logEl,
    );
    function reset() {
      inodes = new Map([[1, { ino: 1, size: 60, alloc: 60 }]]);
      dir = [{ name: 'app.log', ino: 1 }];
      fd = 1; offset = 60; copying = null; nextIno = 2; lostTotal = 0;
      say('Процесс пишет в app.log по 10 МБ. Нажмите «Ротация».');
      render();
    }
    const find = name => dir.find(e => e.name === name);
    const named = ino => dir.some(e => e.ino === ino);
    function gcInodes() {
      for (const ino of [...inodes.keys()]) if (!named(ino) && fd !== ino) inodes.delete(ino);
    }
    function tick() {
      const node = inodes.get(fd);
      const at = append ? node.size : offset;
      node.size = Math.max(node.size, at + CH);
      node.alloc += CH;
      offset = at + CH;
      if (copying) {
        copying.during += CH;
        if (--copying.left <= 0) finishCopy();
      }
      render();
    }
    function rotate() {
      if (copying) return;
      const old = find('app.log.1');
      if (old) { dir = dir.filter(e => e !== old); }
      const cur = find('app.log');
      if (mode === 'copy') {
        const ino = nextIno++;
        inodes.set(ino, { ino, size: inodes.get(cur.ino).size, alloc: inodes.get(cur.ino).size });
        dir.push({ name: 'app.log.1', ino });
        copying = { left: COPY_TICKS, during: 0, src: cur.ino };
        say('copytruncate: logrotate копирует app.log в app.log.1. Приложение тем временем продолжает писать…');
        gcInodes();
        render();
        return;
      }
      const heldOld = old && old.ino === fd;
      cur.name = 'app.log.1';
      const ino = nextIno++;
      inodes.set(ino, { ino, size: 0, alloc: 0 });
      dir.push({ name: 'app.log', ino });
      if (mode === 'reopen') {
        fd = ino; offset = 0;
        say(`app.log переименован в app.log.1 (inode ${cur.ino} тот же), создан новый app.log. Процесс получил SIGHUP и открыл его заново — теперь пишет в inode ${ino}. Ничего не потеряно.`, 'ok');
      } else {
        say(heldOld
          ? `logrotate удалил старый app.log.1 — тот самый inode ${fd}, в который до сих пор пишет процесс. Имя исчезло, место — нет: df растёт, du его не видит.`
          : `app.log переименован в app.log.1, создан новый пустой app.log. Но процесс ничего не знает и пишет в свой дескриптор — в inode ${fd}, который теперь называется app.log.1.`, heldOld ? 'bad' : 'warn');
      }
      gcInodes();
      render();
    }
    function finishCopy() {
      const src = inodes.get(copying.src);
      const lost = copying.during;
      lostTotal += lost;
      src.size = 0; src.alloc = 0;
      copying = null;
      if (append) {
        offset = 0;
        say(`Копия готова, app.log обрезан до нуля. Но ${lost} МБ, записанные во время копирования, в копию не попали и обрезаны — потеряны. С O_APPEND процесс продолжит писать с начала файла.`, 'warn');
      } else {
        say(`app.log обрезан, ${lost} МБ потеряны. А без O_APPEND процесс пишет по старому смещению ${offset} МБ: ls покажет файл снова большим, но в начале — дыра из нулей (du её не считает).`, 'bad');
      }
    }
    function del() {
      const e = find('app.log.1');
      if (!e) return;
      dir = dir.filter(x => x !== e);
      const held = fd === e.ino;
      gcInodes();
      say(held
        ? `rm app.log.1: имя удалено, но процесс держит inode ${e.ino} открытым и пишет в него дальше. du место не видит, df — видит. Диск продолжает заполняться «невидимым» файлом.`
        : `rm app.log.1: никто его не держит — место освобождено.`, held ? 'bad' : 'ok');
      render();
    }
    function render() {
      mBtns.forEach((b, i) => b.classList.toggle('sel', MODES[i][1] === mode));
      appLabel.hidden = mode !== 'copy';
      rotBtn.disabled = !!copying;
      delBtn.disabled = !find('app.log.1');
      const rows = [h('div', { class: 'lr-row head' }, h('span', null, 'имя'), h('span', null, 'inode'), h('span', null, 'размер (ls)'), h('span', null, 'на диске (du)'))];
      const shown = new Set();
      for (const e of [...dir].sort((a, b) => a.name.localeCompare(b.name))) {
        const n = inodes.get(e.ino);
        shown.add(e.ino);
        rows.push(h('div', { class: 'lr-row' + (e.ino === fd ? ' w' : '') }, h('code', null, e.name), h('span', null, '#' + e.ino), h('span', null, n.size + ' МБ'), h('span', null, n.alloc + ' МБ')));
      }
      if (!shown.has(fd)) {
        const n = inodes.get(fd);
        rows.push(h('div', { class: 'lr-row w ghost' }, h('code', null, '(удалён)'), h('span', null, '#' + fd), h('span', null, n.size + ' МБ'), h('span', null, n.alloc + ' МБ')));
      }
      table.replaceChildren(...rows);
      const name = dir.find(e => e.ino === fd);
      procEl.innerHTML = `Процесс → fd 3 → inode <b>#${fd}</b> — ${name ? `<code>${name.name}</code>` : '<b class="lr-lost">имени нет</b>'}, пишет со смещения ${append || mode !== 'copy' ? inodes.get(fd).size : offset} МБ` +
        (copying ? ' · <span class="lr-copy">идёт копирование…</span>' : '') + (lostTotal ? ` · <span class="lr-lost">потеряно ${lostTotal} МБ</span>` : '');
      const df = [...inodes.values()].reduce((s, n) => s + n.alloc, 0);
      const du = [...inodes.values()].filter(n => named(n.ino)).reduce((s, n) => s + n.alloc, 0);
      usage.innerHTML = `<span><code>df</code> занято <b>${df} МБ</b></span><span><code>du</code> насчитал <b>${du} МБ</b></span>` +
        (df !== du ? '<span class="in-diff">расходятся</span>' : '');
    }
    reset();
    return rafLoop(dt => {
      acc += dt;
      if (acc < TICK) return;
      acc = 0;
      tick();
    });
  });
})();

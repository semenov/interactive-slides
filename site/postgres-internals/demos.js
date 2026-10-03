// Demos for slides 2–13: architecture, memory, MVCC, VACUUM, wraparound, buffers, WAL, indexes, planner.
(() => {
  'use strict';
  const { h, highlight, plural, rafLoop } = Deck;
  const fmt = n => n.toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const gb = mb => mb >= 1024 ? dec(mb / 1024, mb < 10240 ? 1 : 0) + ' ГБ' : Math.round(mb) + ' МБ';

  function logger(el, keep = 3) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }

  // ---------------------------------------------------------------- architecture
  Deck.demo('arch', root => {
    const GROUPS = [
      ['Процессы', 'proc', [
        ['postmaster', 'Главный процесс. Принимает подключения и на каждое запускает (fork) отдельный backend-процесс. Следит за остальными и перезапускает их при сбое.'],
        ['backend', 'Обслуживает одно соединение: разбирает SQL, строит план и выполняет запрос. 100 соединений — 100 процессов ОС.'],
        ['checkpointer', 'Периодически сбрасывает все грязные страницы из shared_buffers на диск и отмечает контрольную точку в WAL.'],
        ['background writer', 'Понемногу пишет грязные страницы заранее, чтобы backend-процессам не приходилось делать это самим при вытеснении.'],
        ['WAL writer', 'Сбрасывает WAL-буферы на диск, в том числе для асинхронных коммитов.'],
        ['autovacuum', 'Запускает рабочие процессы, которые чистят мёртвые версии строк, обновляют статистику и замораживают старые транзакции.'],
        ['walsender', 'По одному на реплику: отправляет ей поток WAL.'],
        ['archiver', 'Копирует заполненные сегменты WAL в архив для бэкапов (archive_command).'],
      ]],
      ['Общая память', 'shared', [
        ['shared_buffers', 'Кэш страниц таблиц и индексов, общий для всех процессов. Все чтения и записи идут через него. Обычно около 25% RAM.'],
        ['WAL buffers', 'Записи журнала до сброса на диск. Небольшой: по умолчанию до 16 МБ.'],
        ['блокировки', 'Таблица блокировок: кто какой объект держит и кто ждёт.'],
        ['статусы транзакций', 'Кэш pg_xact: транзакция закоммичена, откатилась или ещё идёт. Нужен на каждой проверке видимости строки.'],
      ]],
      ['Память процесса', 'local', [
        ['work_mem', 'На одну операцию сортировки или хеширования. Не на запрос и не на соединение: сложный запрос может взять её несколько раз. Не хватило — данные уходят во временные файлы на диске.'],
        ['maintenance_work_mem', 'Память для VACUUM, CREATE INDEX и других служебных операций.'],
        ['кэши каталога', 'Каждый процесс кэширует описания таблиц и функций. При тысячах таблиц это десятки мегабайт на соединение.'],
      ]],
      ['Кэш ОС', 'os', [
        ['page cache', 'Postgres читает файлы через ядро, поэтому страница может лежать и в shared_buffers, и в кэше ОС. Свободная память сервера работает как второй уровень кэша — её размер сообщают планировщику через effective_cache_size.'],
      ]],
      ['Диск', 'disk', [
        ['base/', 'Файлы таблиц и индексов: каждая таблица — файл из страниц по 8 КБ (сегментами по 1 ГБ). Рядом — карта свободного места и карта видимости.'],
        ['pg_wal/', 'Журнал предзаписи сегментами по 16 МБ. Пишется последовательно, при каждом коммите — fsync.'],
        ['pg_xact/', 'Статусы транзакций на диске.'],
        ['временные файлы', 'Сортировки и хеши, которым не хватило work_mem. Их много — пора смотреть на запросы или work_mem.'],
      ]],
    ];
    const detail = h('div', { class: 'arch-detail', 'aria-live': 'polite' });
    const buttons = [];
    for (const [title, cls, items] of GROUPS) {
      root.append(h('div', { class: 'arch-group ' + cls },
        h('span', { class: 'arch-title' }, title),
        h('div', { class: 'arch-items' }, items.map(([name, text]) => {
          const b = h('button', { class: 'arch-item', onclick: () => select(b, title, name, text, cls) }, name);
          buttons.push(b);
          return b;
        }))));
    }
    root.append(detail);
    function select(b, group, name, text, cls) {
      buttons.forEach(x => x.classList.toggle('sel', x === b));
      detail.className = 'arch-detail ' + cls;
      detail.innerHTML = `<b>${name}</b> <span class="label">${group}</span><p>${text}</p>`;
    }
    buttons[8].click();
    return {};
  });

  // ---------------------------------------------------------------- memory calculator
  Deck.demo('memcalc', root => {
    const RAM = [4, 8, 16, 32, 64, 128, 256];
    const CONNS = [20, 50, 100, 200, 300, 500, 1000, 2000];
    const WM = [4, 16, 32, 64, 128, 256];
    const PER_CONN = 10; // MB, a process with its caches
    const mk = (label, list, idx, unit) => {
      const out = h('output');
      const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
      const set = () => { out.textContent = list[+input.value] + unit; };
      set();
      input.addEventListener('input', () => { set(); update(); });
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label mc-l' }, label), input, out));
      return () => list[+input.value];
    };
    const ram = mk('RAM сервера', RAM, 3, ' ГБ');
    const conns = mk('max_connections', CONNS, 3, '');
    const wm = mk('work_mem', WM, 2, ' МБ');
    const bar = h('div', { class: 'mc-bar' });
    const legend = h('div', { class: 'mc-legend' });
    const verdict = h('p', { class: 'log' });
    root.append(bar, legend, verdict);

    function update() {
      const r = ram() * 1024, c = conns(), w = wm();
      const parts = [
        ['sb', 'shared_buffers', r * 0.25],
        ['cn', `соединения (${c} × ~${PER_CONN} МБ)`, c * PER_CONN],
        ['wm', `work_mem в худшем случае (${c} × ${w} МБ × 2)`, c * w * 2],
      ];
      const used = parts.reduce((s, p) => s + p[2], 0);
      const scale = Math.max(r, used);
      const free = r - used;
      bar.innerHTML = parts.map(([cls, , v]) => `<span class="${cls}" style="width:${(v / scale) * 100}%"></span>`).join('') +
        (free > 0 ? `<span class="os" style="width:${(free / scale) * 100}%"></span>` : '') +
        `<i class="mc-ram" style="left:${(r / scale) * 100}%"></i>`;
      legend.innerHTML = parts.map(([cls, label, v]) => `<div><span class="sw ${cls}"></span>${label}<b>${gb(v)}</b></div>`).join('') +
        `<div><span class="sw os"></span>остаётся кэшу ОС<b>${free > 0 ? gb(free) : '0'}</b></div>`;
      if (free < 0) {
        verdict.innerHTML = `В худшем случае не хватит ${gb(-free)}. Придёт OOM killer, убьёт процесс, и Postgres перезапустит все соединения. Уменьшите work_mem или число соединений — поставьте пулер.`;
        verdict.className = 'log bad';
      } else if (free < r * 0.25) {
        verdict.innerHTML = `Влезает, но кэшу ОС остаётся мало: ${gb(free)}. Чтения чаще пойдут на диск.`;
        verdict.className = 'log warn';
      } else {
        verdict.innerHTML = `Запас есть: ${gb(free)} достанется кэшу ОС — это тоже кэш для базы.`;
        verdict.className = 'log ok';
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- MVCC on one page
  Deck.demo('mvcc', root => {
    const SLOTS = 8;
    let slots, xid, snap, balance;
    const page = h('div', { class: 'pg-page' });
    const views = h('div', { class: 'mv-views' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const sayL = logger(logEl, 2);
    const snapBtn = h('button', { class: 'btn', onclick: toggleSnap }, 'Открыть долгую транзакцию');
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: update }, h('code', null, 'UPDATE id = 1')),
        snapBtn,
        h('button', { class: 'btn', onclick: vacuum }, h('code', null, 'VACUUM')),
        h('button', { class: 'btn', onclick: reset }, 'Сброс'),
      ),
      page, views, logEl,
    );

    function reset() {
      xid = 100;
      snap = null;
      balance = 100;
      slots = Array(SLOTS).fill(null);
      slots[0] = { id: 1, v: 100, xmin: 100, xmax: null };
      slots[1] = { id: 2, v: 50, xmin: 100, xmax: null };
      xid = 101;
      snapBtn.textContent = 'Открыть долгую транзакцию';
      sayL('На странице две строки. Обе созданы транзакцией 100.');
      render();
    }
    // A version is visible to a snapshot taken when `next` was the next xid to be assigned.
    const visible = (t, next) => t.xmin < next && (t.xmax == null || t.xmax >= next);
    const horizon = () => (snap != null ? snap : xid);

    function update() {
      const cur = slots.find(t => t && t.id === 1 && t.xmax == null);
      const free = slots.indexOf(null);
      if (free < 0) {
        sayL('На странице нет места: новая версия ушла бы на другую страницу, и пришлось бы обновлять все индексы. Запустите VACUUM.', 'warn');
        return;
      }
      const x = xid++;
      cur.xmax = x;
      balance += 10;
      slots[free] = { id: 1, v: balance, xmin: x, xmax: null };
      sayL(`Транзакция ${x}: новая версия id=1 с balance=${balance}. Старой версии поставлен xmax=${x} — для новых транзакций она мертва.`);
      render();
    }
    function toggleSnap() {
      if (snap == null) {
        snap = xid;
        snapBtn.textContent = 'Завершить долгую транзакцию';
        sayL(`Открыта транзакция со снимком: она видит всё, что закоммичено до транзакции ${xid}, и ничего после.`);
      } else {
        snap = null;
        snapBtn.textContent = 'Открыть долгую транзакцию';
        sayL('Долгая транзакция завершилась. Теперь старые версии никому не нужны.', 'ok');
      }
      render();
    }
    function vacuum() {
      const hz = horizon();
      let removed = 0, kept = 0;
      slots = slots.map(t => {
        if (!t || t.xmax == null) return t;
        if (t.xmax < hz) { removed++; return null; }
        kept++;
        return t;
      });
      if (!removed && !kept) sayL('VACUUM: мёртвых версий нет.');
      else sayL(`VACUUM освободил ${removed} ${plural(removed, ['место', 'места', 'мест'])}` +
        (kept ? `, а ${kept} ${plural(kept, ['версию', 'версии', 'версий'])} оставил: их ещё может читать долгая транзакция.` : '.'), kept ? 'warn' : 'ok');
      render();
    }
    function render() {
      const hz = horizon();
      page.innerHTML = '<div class="pg-head">заголовок страницы · 8 КБ</div><div class="pg-slots">' + slots.map((t, i) => {
        if (!t) return `<div class="tup free"><span class="lp">${i + 1}</span>свободно</div>`;
        const dead = t.xmax != null;
        const held = dead && t.xmax >= hz;
        const cls = !dead ? 'live' : held ? 'held' : 'dead';
        const tag = !dead ? 'живая' : held ? 'нужна долгой транзакции' : 'мёртвая';
        return `<div class="tup ${cls}"><span class="lp">${i + 1}</span><b>id=${t.id} balance=${t.v}</b>` +
          `<span class="x">xmin ${t.xmin} · xmax ${t.xmax ?? '—'}</span><span class="tag">${tag}</span></div>`;
      }).join('') + '</div>';
      const seen = next => slots.filter(t => t && t.id === 1 && visible(t, next)).map(t => t.v)[0];
      views.innerHTML = `<div><span class="label">Новый запрос видит</span><b>balance = ${seen(xid)}</b></div>` +
        (snap != null ? `<div class="snap"><span class="label">Долгая транзакция видит</span><b>balance = ${seen(snap)}</b></div>` : '');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- bloat
  Deck.demo('bloat', root => {
    const PER = 10, LIVE = 160, MAXP = 96;
    let pages, t, acc, vacs, playing = true, longTx = null, avOn = true, vacuumAt = null, lastFull = '';
    const grid = h('div', { class: 'bl-grid' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const avIn = h('input', { type: 'checkbox', checked: true });
    const ltIn = h('input', { type: 'checkbox' });
    const playBtn = h('button', { class: 'btn', onclick: () => { playing = !playing; playBtn.textContent = playing ? 'Пауза' : 'Пуск'; } }, 'Пауза');
    avIn.addEventListener('change', () => { avOn = avIn.checked; say(avOn ? 'Autovacuum включён.' : 'Autovacuum выключен. Не делайте так в проде.', avOn ? 'ok' : 'warn'); });
    ltIn.addEventListener('change', () => {
      longTx = ltIn.checked ? t : null;
      say(ltIn.checked ? 'Открыта долгая транзакция: всё, что умрёт после этого момента, VACUUM трогать не будет.' : 'Долгая транзакция закрыта — следующий VACUUM всё вычистит.', ltIn.checked ? 'warn' : 'ok');
    });
    root.append(
      h('div', { class: 'controls' }, playBtn, h('button', { class: 'btn', onclick: full }, h('code', null, 'VACUUM FULL')), h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, avIn, h('span', null, 'autovacuum')),
      h('label', { class: 'toggle' }, ltIn, h('span', null, 'долгая транзакция открыта')),
      grid,
      h('div', { class: 'bl-legend' }, h('span', { class: 'sw live' }), 'живые', h('span', { class: 'sw dead' }), 'мёртвые', h('span', { class: 'sw free' }), 'свободно'),
      stats,
      logEl,
    );

    function reset() {
      pages = Array.from({ length: LIVE / PER }, () => ({ live: PER, dead: [] }));
      t = 0; acc = 0; vacs = 0; vacuumAt = null;
      say('UPDATE идут непрерывно: каждый оставляет мёртвую версию и пишет новую туда, где есть место.');
      render();
    }
    const deadCount = () => pages.reduce((s, p) => s + p.dead.length, 0);
    function updateRow() {
      let r = Math.floor(Math.random() * LIVE);
      let src = pages[0];
      for (const p of pages) { if (r < p.live) { src = p; break; } r -= p.live; }
      src.live--;
      src.dead.push(t);
      // The new version prefers the same page (HOT), then any page with free space, then a new page.
      const free = p => PER - p.live - p.dead.length;
      let dst = free(src) > 0 ? src : pages.find(p => free(p) > 0);
      if (!dst) {
        if (pages.length >= MAXP) { src.live++; src.dead.pop(); return; }
        dst = { live: 0, dead: [] };
        pages.push(dst);
      }
      dst.live++;
    }
    function vacuum(manual) {
      let freed = 0, held = 0;
      for (const p of pages) {
        const keep = p.dead.filter(d => longTx != null && d >= longTx);
        freed += p.dead.length - keep.length;
        held += keep.length;
        p.dead = keep;
      }
      while (pages.length > 1 && pages[pages.length - 1].live === 0 && !pages[pages.length - 1].dead.length) pages.pop();
      vacs++;
      say(`${manual ? 'VACUUM' : 'autovacuum'}: освобождено ${freed} мест` + (held ? `, ${held} мёртвых версий держит долгая транзакция.` : '. Свободное место пойдёт под новые версии.'), held ? 'warn' : 'ok');
    }
    function full() {
      if (longTx != null) { say('VACUUM FULL ждёт эксклюзивную блокировку, а долгая транзакция держит таблицу. Закройте её сначала.', 'warn'); return; }
      const before = pages.length;
      pages = Array.from({ length: LIVE / PER }, () => ({ live: PER, dead: [] }));
      lastFull = `VACUUM FULL переписал таблицу: ${before} → ${pages.length} страниц. Всё это время таблица была заблокирована целиком.`;
      say(lastFull, 'ok');
      render();
    }
    function render() {
      grid.innerHTML = pages.map(p => {
        const d = p.dead.length;
        return `<span class="bl-page"><i class="live" style="height:${(p.live / PER) * 100}%"></i><i class="dead" style="height:${(d / PER) * 100}%"></i></span>`;
      }).join('');
      const dead = deadCount();
      stats.innerHTML = `<div class="stat ${pages.length > 24 ? 'warn' : ''}"><b>${pages.length}</b><span>страниц (было 16)</span></div>` +
        `<div class="stat"><b>${dead}</b><span>мёртвых версий</span></div>` +
        `<div class="stat"><b>${vacs}</b><span>запусков VACUUM</span></div>`;
    }
    reset();
    return rafLoop(dt => {
      if (!playing) return;
      acc += dt;
      let changed = false;
      while (acc >= 0.08) {
        acc -= 0.08; t++;
        updateRow();
        changed = true;
        if (avOn && vacuumAt == null && deadCount() > 8 + 0.2 * LIVE) vacuumAt = t + 6;
        if (vacuumAt != null && t >= vacuumAt) { vacuumAt = null; if (avOn) vacuum(false); }
      }
      if (changed) render();
    });
  });

  // ---------------------------------------------------------------- xid wraparound
  Deck.demo('wraparound', root => {
    const LIMIT = 2 ** 31;
    const slider = h('input', { type: 'range', min: 0, max: 1000, value: 60, 'aria-label': 'Возраст старейшей транзакции' });
    const big = h('div', { class: 'cost-n' });
    const bar = h('div', { class: 'wr-bar' },
      h('span', { class: 'z1', style: `width:${(200e6 / LIMIT) * 100}%` }),
      h('span', { class: 'z2', style: `width:${((LIMIT - 40e6 - 200e6) / LIMIT) * 100}%` }),
      h('span', { class: 'z3', style: `width:${(37e6 / LIMIT) * 100 + 0.6}%` }),
      h('span', { class: 'z4' }));
    const marker = h('i', { class: 'wr-mark' });
    bar.append(marker);
    const verdict = h('p', { class: 'log' });
    root.append(big, h('label', { class: 'slider' }, h('span', { class: 'label' }, 'age(datfrozenxid) — возраст самой старой незамороженной транзакции'), slider), bar, verdict);

    function update() {
      // Non-linear slider so the dangerous end is reachable precisely.
      const x = slider.value / 1000;
      const age = Math.round(LIMIT * (1 - Math.pow(1 - x, 1.6)));
      big.innerHTML = `<b>${dec(age / 1e6, age < 1e7 ? 1 : 0)} млн</b> транзакций назад`;
      marker.style.left = Math.min(100, (age / LIMIT) * 100) + '%';
      const left = LIMIT - age;
      if (age < 200e6) {
        verdict.textContent = 'Норма. Autovacuum замораживает старые строки по ходу обычной чистки.';
        verdict.className = 'log ok';
      } else if (left > 40e6) {
        verdict.textContent = 'Больше autovacuum_freeze_max_age (200 млн): запускается принудительная заморозка «to prevent wraparound» — даже если autovacuum выключен. Она читает всю таблицу и не уступает блокировку.';
        verdict.className = 'log warn';
      } else if (left > 3e6) {
        verdict.textContent = `В логах предупреждения: database must be vacuumed within ${fmt(left)} transactions. Нужно срочно найти, что мешает заморозке.`;
        verdict.className = 'log bad';
      } else {
        verdict.textContent = 'Postgres перестаёт выдавать новые номера транзакций: запись невозможна, пока VACUUM не заморозит старые строки. Для большой базы это часы простоя.';
        verdict.className = 'log bad';
      }
    }
    slider.addEventListener('input', update);
    update();
    return {};
  });

  // ---------------------------------------------------------------- buffer cache, clock sweep
  Deck.demo('buffers', root => {
    const N = 16;
    let bufs, hand, hist, ws = 12, scan = 0, ringOn = true, ring = [], playing = true, acc = 0, last = -1, reads = 0, scanPage = 1000;
    const wsOut = h('output', null, ws);
    const wsIn = h('input', { type: 'range', min: 6, max: 60, value: ws, 'aria-label': 'Рабочий набор' });
    wsIn.addEventListener('input', () => { ws = +wsIn.value; wsOut.textContent = ws; });
    const ringIn = h('input', { type: 'checkbox', checked: true });
    ringIn.addEventListener('change', () => { ringOn = ringIn.checked; });
    const grid = h('div', { class: 'bf-grid' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const playBtn = h('button', { class: 'btn', onclick: () => { playing = !playing; playBtn.textContent = playing ? 'Пауза' : 'Пуск'; } }, 'Пауза');
    root.append(
      h('div', { class: 'controls' }, playBtn,
        h('button', { class: 'btn primary', onclick: () => { scan = 40; say('Запущен Seq Scan большой таблицы: 40 страниц подряд, каждая нужна один раз.'); } }, 'Прочитать большую таблицу'),
        h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Горячих страниц'), wsIn, wsOut),
      h('label', { class: 'toggle' }, ringIn, h('span', null, 'кольцевой буфер для больших чтений')),
      grid, stats, logEl,
    );

    function reset() {
      bufs = Array.from({ length: N }, () => ({ page: null, usage: 0 }));
      hand = 0; hist = []; reads = 0; scan = 0; ring = [];
      say(`shared_buffers на ${N} страниц. Запросы читают горячие страницы: одни популярнее других.`);
      render();
    }
    function victim() {
      for (;;) {
        const b = bufs[hand];
        const i = hand;
        hand = (hand + 1) % N;
        if (b.page == null || b.usage === 0) return i;
        b.usage--;
      }
    }
    function access(page, isScan) {
      const at = bufs.findIndex(b => b.page === page);
      if (at >= 0) {
        bufs[at].usage = Math.min(5, bufs[at].usage + 1);
        hist.push(1);
        last = at;
      } else {
        let i;
        if (isScan && ringOn && ring.length >= 2) { i = ring[0]; ring.push(ring.shift()); }
        else { i = victim(); if (isScan && ringOn) ring.push(i); }
        bufs[i] = { page, usage: 1 };
        hist.push(0);
        reads++;
        last = i;
      }
      if (hist.length > 200) hist.shift();
    }
    function step() {
      if (scan > 0) { access('s' + scanPage++, true); if (--scan === 0) { ring = []; say('Seq Scan закончился. ' + (ringOn ? 'Горячие страницы почти не пострадали.' : 'Он вытеснил горячие страницы — посмотрите, как упали попадания.'), ringOn ? 'ok' : 'warn'); } return; }
      // Skewed popularity: low page numbers are hotter.
      const p = Math.floor(ws * Math.pow(Math.random(), 1.8));
      access(p, false);
    }
    function render() {
      grid.innerHTML = bufs.map((b, i) => `<div class="bf ${i === last ? 'last' : ''} ${b.page != null && String(b.page)[0] === 's' ? 'scan' : ''}">` +
        `${i === hand ? '<span class="hand" title="стрелка часов">▼</span>' : ''}<b>${b.page == null ? '—' : String(b.page)[0] === 's' ? 'scan' : 'p' + b.page}</b>` +
        `<span class="usage">${'<i></i>'.repeat(b.usage)}${'<i class="off"></i>'.repeat(5 - b.usage)}</span></div>`).join('');
      const hit = hist.length ? Math.round((hist.reduce((a, b) => a + b, 0) / hist.length) * 100) : 0;
      stats.innerHTML = `<div class="stat ${hit < 80 ? 'warn' : ''}"><b>${hit}%</b><span>попаданий в кэш</span></div>` +
        `<div class="stat"><b>${reads}</b><span>чтений с диска</span></div>` +
        `<div class="stat"><b>${ws > N ? ws - N : 0}</b><span>горячих не влезает</span></div>`;
    }
    reset();
    return rafLoop(dt => {
      if (!playing) return;
      acc += dt;
      let ch = false;
      while (acc >= 0.12) { acc -= 0.12; step(); ch = true; }
      if (ch) render();
    });
  });

  // ---------------------------------------------------------------- WAL, checkpoint, crash recovery
  Deck.demo('wal', root => {
    let mem, disk, walBuf, walDisk, lsn, xid, openTx, crashed, acked, flushIn, syncOn = true;
    const memEl = h('div', { class: 'wl-col mem' });
    const diskEl = h('div', { class: 'wl-col disk' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const syncIn = h('input', { type: 'checkbox', checked: true });
    syncIn.addEventListener('change', () => { syncOn = syncIn.checked; });
    const upd = ['A', 'B', 'C'].map(p => h('button', { class: 'btn small', onclick: () => update(p) }, h('code', null, 'UPDATE ' + p)));
    const commitBtn = h('button', { class: 'btn primary', onclick: commit }, h('code', null, 'COMMIT'));
    const ckptBtn = h('button', { class: 'btn', onclick: checkpoint }, h('code', null, 'CHECKPOINT'));
    const crashBtn = h('button', { class: 'btn danger', onclick: crash }, 'Выключить питание');
    const recBtn = h('button', { class: 'btn primary', onclick: recover }, 'Запустить сервер');
    root.append(
      h('div', { class: 'controls' }, upd, commitBtn),
      h('div', { class: 'controls' }, ckptBtn, crashBtn, recBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, syncIn, h('span', null, h('code', null, 'synchronous_commit = on'))),
      h('div', { class: 'wl-cols' }, memEl, diskEl),
      logEl,
    );

    function reset() {
      mem = { A: { v: 1, dirty: false }, B: { v: 1, dirty: false }, C: { v: 1, dirty: false } };
      disk = { A: 1, B: 1, C: 1 };
      walBuf = []; walDisk = [{ k: 'ckpt', lsn: 0 }];
      lsn = 1; xid = 100; openTx = null; crashed = false; acked = {}; flushIn = null;
      say('Страницы A, B, C загружены в память. Сделайте несколько UPDATE и COMMIT.');
      render();
    }
    function update(p) {
      if (crashed) return;
      if (openTx == null) openTx = xid++;
      mem[p].v++;
      mem[p].dirty = true;
      walBuf.push({ k: 'upd', lsn: lsn++, p, v: mem[p].v, x: openTx });
      say(`Транзакция ${openTx}: страница ${p} изменена в памяти (грязная), запись о ней — в WAL-буфер. На диск пока ничего не ушло.`);
      render();
    }
    function flush() {
      walDisk.push(...walBuf);
      walBuf = [];
      flushIn = null;
    }
    function commit() {
      if (crashed || openTx == null) return;
      walBuf.push({ k: 'commit', lsn: lsn++, x: openTx });
      for (const r of walBuf) if (r.k === 'upd' && r.x === openTx) acked[r.p] = r.v;
      if (syncOn) {
        flush();
        say(`COMMIT ${openTx}: WAL сброшен на диск (fsync), только после этого клиент получил «OK». Файлы данных не тронуты.`, 'ok');
      } else {
        flushIn = 3;
        say(`COMMIT ${openTx}: клиент сразу получил «OK», а WAL writer сбросит журнал на диск через пару секунд.`, 'warn');
      }
      openTx = null;
      render();
    }
    function checkpoint() {
      if (crashed) return;
      flush();
      for (const p of Object.keys(mem)) { disk[p] = mem[p].v; mem[p].dirty = false; }
      walDisk.push({ k: 'ckpt', lsn: lsn++ });
      say('CHECKPOINT: все грязные страницы записаны в файлы данных. Журнал до этой точки для восстановления больше не нужен.', 'ok');
      render();
    }
    function crash() {
      if (crashed) return;
      const lost = walBuf.filter(r => r.k === 'commit').map(r => r.x);
      crashed = true;
      mem = null; walBuf = []; openTx = null; flushIn = null;
      say(lost.length
        ? `Питание пропало. Память пуста. Транзакция ${lost.join(', ')} уже подтверждена клиенту, но её журнал не успел на диск — она потеряна.`
        : 'Питание пропало. Всё, что было в памяти, исчезло. Файлы данных устарели, но журнал на диске цел.', lost.length ? 'bad' : 'warn');
      render();
    }
    function recover() {
      if (!crashed) return;
      let from = 0;
      walDisk.forEach((r, i) => { if (r.k === 'ckpt') from = i; });
      const committed = new Set(walDisk.filter(r => r.k === 'commit').map(r => r.x));
      let n = 0;
      for (const r of walDisk.slice(from + 1)) if (r.k === 'upd' && committed.has(r.x)) { disk[r.p] = r.v; n++; }
      mem = { A: { v: disk.A, dirty: false }, B: { v: disk.B, dirty: false }, C: { v: disk.C, dirty: false } };
      crashed = false;
      const ok = Object.entries(acked).every(([p, v]) => disk[p] >= v);
      say(`Восстановление: от последней контрольной точки проиграно ${n} ${plural(n, ['запись', 'записи', 'записей'])} журнала. ` +
        (ok ? 'Все подтверждённые транзакции на месте.' : 'Часть подтверждённых транзакций потеряна — это цена synchronous_commit = off.'), ok ? 'ok' : 'bad');
      render();
    }
    const rec = r => r.k === 'ckpt' ? '<span class="wr ck">CHECKPOINT</span>'
      : r.k === 'commit' ? `<span class="wr cm">COMMIT ${r.x}</span>` : `<span class="wr">${r.p}=${r.v} <small>${r.x}</small></span>`;
    function render() {
      memEl.innerHTML = '<div class="wl-h">Память <span>пропадёт при сбое</span></div>' + (crashed
        ? '<div class="wl-empty">пусто — питание пропало</div>'
        : '<div class="label">shared_buffers</div><div class="wl-pages">' +
          Object.entries(mem).map(([p, s]) => `<span class="wpg ${s.dirty ? 'dirty' : ''}">${p}<b>${s.v}</b>${s.dirty ? '<small>грязная</small>' : ''}</span>`).join('') +
          '</div><div class="label">WAL-буфер</div><div class="wl-recs">' + (walBuf.length ? walBuf.map(rec).join('') : '<span class="empty">пусто</span>') + '</div>');
      diskEl.innerHTML = '<div class="wl-h">Диск <span>переживёт сбой</span></div><div class="label">файлы данных</div><div class="wl-pages">' +
        Object.entries(disk).map(([p, v]) => `<span class="wpg">${p}<b>${v}</b></span>`).join('') +
        '</div><div class="label">pg_wal</div><div class="wl-recs">' + walDisk.slice(-12).map(rec).join('') + '</div>';
      upd.forEach(b => { b.disabled = crashed; });
      commitBtn.disabled = crashed || openTx == null;
      ckptBtn.disabled = crashBtn.disabled = crashed;
      recBtn.disabled = !crashed;
    }
    reset();
    let acc = 0;
    return rafLoop(dt => {
      if (flushIn == null) return;
      acc += dt;
      if (acc < 1) return;
      acc = 0;
      if (--flushIn <= 0) { flush(); say('WAL writer сбросил журнал на диск: асинхронные коммиты теперь в безопасности.'); render(); }
    });
  });

  // ---------------------------------------------------------------- B+tree
  Deck.demo('btree', root => {
    const MAX = 3;
    let rootNode, lastKey = null, path = new Set(), msg = '';
    const input = h('input', { type: 'number', class: 'num-in', min: 1, max: 999, value: 42, 'aria-label': 'Ключ' });
    const treeEl = h('div', { class: 'bt no-swipe' });
    const info = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' }, input,
        h('button', { class: 'btn primary', onclick: () => add(+input.value) }, 'Вставить'),
        h('button', { class: 'btn', onclick: () => find(+input.value) }, 'Найти'),
        h('button', { class: 'btn', onclick: () => { for (let i = 0; i < 5; i++) add(1 + Math.floor(Math.random() * 99), true); render(); } }, '+5 случайных'),
        h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      treeEl, info,
    );

    function ins(node, k, ev) {
      if (node.leaf) {
        node.keys.push(k);
        node.keys.sort((a, b) => a - b);
        if (node.keys.length <= MAX) return null;
        const m = Math.ceil(node.keys.length / 2);
        const right = { leaf: true, keys: node.keys.slice(m) };
        node.keys = node.keys.slice(0, m);
        ev.splits++;
        return { sep: right.keys[0], right };
      }
      let i = 0;
      while (i < node.keys.length && k >= node.keys[i]) i++;
      const r = ins(node.children[i], k, ev);
      if (!r) return null;
      node.keys.splice(i, 0, r.sep);
      node.children.splice(i + 1, 0, r.right);
      if (node.keys.length <= MAX) return null;
      const m = Math.floor(node.keys.length / 2);
      const sep = node.keys[m];
      const right = { leaf: false, keys: node.keys.slice(m + 1), children: node.children.slice(m + 1) };
      node.keys = node.keys.slice(0, m);
      node.children = node.children.slice(0, m + 1);
      ev.splits++;
      return { sep, right };
    }
    function search(k) {
      const p = [];
      let n = rootNode;
      while (n) {
        p.push(n);
        if (n.leaf) return { p, found: n.keys.includes(k) };
        let i = 0;
        while (i < n.keys.length && k >= n.keys[i]) i++;
        n = n.children[i];
      }
      return { p, found: false };
    }
    function count() { let c = 0; const walk = n => { if (n.leaf) c += n.keys.length; else n.children.forEach(walk); }; walk(rootNode); return c; }
    function add(k, quiet) {
      if (!(k >= 1 && k <= 999)) return;
      if (search(k).found) { if (!quiet) { msg = `Ключ ${k} уже есть — индекс уникальный.`; find(k); } return; }
      if (count() >= 40) { msg = 'Хватит ключей: сбросьте дерево.'; render(); return; }
      const ev = { splits: 0 };
      const r = ins(rootNode, k, ev);
      let grew = false;
      if (r) { rootNode = { leaf: false, keys: [r.sep], children: [rootNode, r.right] }; grew = true; }
      lastKey = k;
      path = new Set(search(k).p);
      msg = `Вставлен ${k}.` + (ev.splits ? ` Узел переполнился и разделился пополам${ev.splits > 1 ? ` (${ev.splits} раза по цепочке вверх)` : ''}.` : ' Место в листе было.') + (grew ? ' Корень разделился — дерево выросло на уровень.' : '');
      if (!quiet) render();
    }
    function find(k) {
      const r = search(k);
      path = new Set(r.p);
      lastKey = r.found ? k : null;
      msg = (msg && msg.startsWith('Ключ') ? msg + ' ' : '') + `Поиск ${k}: прочитано ${r.p.length} ${plural(r.p.length, ['страница', 'страницы', 'страниц'])} индекса — ${r.found ? 'найден, дальше по ctid в таблицу' : 'такого ключа нет'}.`;
      render();
      msg = '';
    }
    function reset() {
      rootNode = { leaf: true, keys: [] };
      [50, 20, 80, 10, 30, 60, 90, 25, 70, 40].forEach(k => add(k, true));
      lastKey = null; path = new Set();
      msg = 'Дерево из 10 ключей. Вставьте свой или найдите существующий.';
      render();
    }
    function render() {
      const levels = [];
      let cur = [rootNode];
      while (cur.length) { levels.push(cur); cur = cur.flatMap(n => (n.leaf ? [] : n.children)); }
      treeEl.innerHTML = levels.map((lvl, d) => `<div class="bt-level">${lvl.map(n =>
        `<span class="bt-node ${n.leaf ? 'leaf' : ''} ${path.has(n) ? 'path' : ''}">${n.keys.map(k => `<span class="${k === lastKey && n.leaf ? 'hit' : ''}">${k}</span>`).join('')}</span>`)
        .join(d === levels.length - 1 ? '<span class="bt-link">→</span>' : '')}</div>`).join('');
      info.textContent = `${msg} Глубина: ${levels.length}.`;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- composite index
  Deck.demo('composite', root => {
    const ROWS = [[7, '01.10'], [7, '02.10'], [7, '04.10'], [42, '01.10'], [42, '02.10'], [42, '03.10'], [42, '04.10'], [42, '05.10'], [99, '02.10'], [99, '03.10'], [99, '04.10'], [99, '05.10']];
    const day = d => +d.slice(0, 2);
    const Q = [
      { sql: 'WHERE user_id = 42', read: r => r[0] === 42, ok: 'yes', why: 'Условие на первую колонку: все записи user_id = 42 лежат рядом, читается один непрерывный кусок.' },
      { sql: "WHERE user_id = 42 AND created_at > '03.10'", read: r => r[0] === 42 && day(r[1]) > 3, ok: 'yes', why: 'Обе колонки по порядку: равенство по первой, диапазон по второй. Самый узкий кусок индекса.' },
      { sql: 'WHERE user_id = 42 ORDER BY created_at DESC LIMIT 2', read: r => r[0] === 42 && day(r[1]) >= 4, ok: 'yes', why: 'Индекс уже отсортирован по created_at внутри пользователя: Postgres читает его с конца и останавливается после двух строк. Без сортировки.' },
      { sql: "WHERE created_at > '03.10'", read: () => true, match: r => day(r[1]) > 3, ok: 'no', why: 'Нет условия на первую колонку: нужные записи разбросаны по всему индексу, придётся читать его целиком. С PostgreSQL 18 есть skip scan — он помогает, если разных user_id немного. Обычно нужен отдельный индекс по created_at.' },
      { sql: "WHERE user_id::text = '42'", read: () => true, match: r => r[0] === 42, ok: 'no', why: 'Выражение над колонкой: индекс хранит значения user_id, а не user_id::text. Нужно сравнивать с числом или делать индекс по выражению.' },
    ];
    const qEl = h('div', { class: 'cq-list' });
    const ixEl = h('div', { class: 'cx-index' });
    const verdict = h('div', { class: 'log', 'aria-live': 'polite' });
    const btns = Q.map((q, i) => h('button', { class: 'cq-btn', onclick: () => select(i) }, h('code', { html: highlight(q.sql, 'sql') })));
    qEl.append(...btns);
    root.append(qEl, h('div', { class: 'label' }, 'Индекс (user_id, created_at) — записи по порядку'), ixEl, verdict);
    function select(i) {
      const q = Q[i];
      btns.forEach((b, j) => b.classList.toggle('sel', i === j));
      const read = ROWS.map(q.read), match = ROWS.map(q.match || q.read);
      ixEl.innerHTML = ROWS.map((r, j) => `<span class="cx ${read[j] ? 'read' : ''} ${match[j] ? 'match' : ''}"><b>${r[0]}</b>${r[1]}</span>`).join('');
      const n = read.filter(Boolean).length;
      verdict.innerHTML = `<b>${q.ok === 'yes' ? 'Индекс помогает' : 'Индекс почти не помогает'}.</b> Прочитано ${n} из ${ROWS.length}. ${q.why}`;
      verdict.className = 'log ' + (q.ok === 'yes' ? 'ok' : 'bad');
    }
    select(0);
    return {};
  });

  // ---------------------------------------------------------------- planner cost model
  Deck.demo('planner', root => {
    const ROWS = 1e6, PAGES = 1e4;
    const sel = h('input', { type: 'range', min: 0, max: 1000, value: 300, 'aria-label': 'Доля строк' });
    const ssdIn = h('input', { type: 'checkbox' });
    const corrIn = h('input', { type: 'checkbox' });
    const head = h('div', { class: 'cost-n' });
    const bars = h('div', { class: 'pl-bars' });
    const verdict = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'label' }, 'Таблица: 1 млн строк, 10 тыс. страниц. Запрос: WHERE x < ?'),
      head,
      h('label', { class: 'slider' }, h('span', { class: 'label' }, 'Какую долю строк выбирает условие'), sel),
      h('label', { class: 'toggle' }, ssdIn, h('span', null, h('code', null, 'random_page_cost = 1.1'), ' (SSD) вместо 4')),
      h('label', { class: 'toggle' }, corrIn, h('span', null, 'строки лежат на диске в порядке x (корреляция)')),
      bars, verdict,
    );
    [sel, ssdIn, corrIn].forEach(el => el.addEventListener('input', update));

    function update() {
      const frac = Math.pow(10, -4 + (sel.value / 1000) * 4); // 0.01% … 100%
      const rows = Math.max(1, Math.round(ROWS * frac));
      const rpc = ssdIn.checked ? 1.1 : 4;
      const fetched = corrIn.checked ? Math.ceil((rows / ROWS) * PAGES) : PAGES * (1 - Math.exp(-rows / PAGES));
      const idx = Math.ceil(rows / 300) * rpc + rows * 0.005;
      const plans = [
        ['Seq Scan', PAGES * 1 + ROWS * 0.0125],
        ['Index Scan', idx + (corrIn.checked ? fetched : fetched * rpc) + rows * 0.01],
        ['Bitmap Heap Scan', idx + fetched * (rpc - (rpc - 1) * Math.sqrt(fetched / PAGES)) + rows * 0.01 + 0.1 * fetched],
      ];
      const best = plans.reduce((a, b) => (b[1] < a[1] ? b : a));
      const max = Math.max(...plans.map(p => p[1]));
      head.innerHTML = `<b>${frac < 0.01 ? dec(frac * 100, 2) : frac < 0.1 ? dec(frac * 100, 1) : Math.round(frac * 100)}%</b> строк — ${fmt(rows)}`;
      bars.innerHTML = plans.map(([name, cost]) => `<div class="pl-row ${name === best[0] ? 'best' : ''}"><span>${name}</span>` +
        `<span class="cost-track"><span class="cost-fill" style="width:${Math.max(0.5, (cost / max) * 100)}%"></span></span><b>${fmt(Math.round(cost))}</b></div>`).join('');
      verdict.innerHTML = `Планировщик выберет <b>${best[0]}</b>. ` + ({
        'Seq Scan': 'Строк так много, что дешевле прочитать всю таблицу подряд, чем прыгать по индексу.',
        'Index Scan': 'Строк мало: несколько случайных чтений дешевле, чем вся таблица.',
        'Bitmap Heap Scan': 'Промежуточный вариант: сначала собрать из индекса список страниц, потом прочитать их по порядку.',
      })[best[0]];
      verdict.className = 'log';
    }
    update();
    return {};
  });
})();

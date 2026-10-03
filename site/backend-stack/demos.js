(() => {
  'use strict';
  const { h, highlight, plural, rafLoop } = Deck;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmt = n => n.toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');

  // ---------------------------------------------------------------- architecture map
  Deck.demo('map', root => {
    const nodes = {
      user: { name: 'Пользователь', text: 'Браузер или мобильное приложение. Ходит в API, а файлы скачивает напрямую из S3 или CDN.' },
      api: { name: 'Приложение', text: 'Ваш код: принимает запросы, проверяет права, читает и пишет данные. Само ничего не хранит, поэтому его легко перезапускать и запускать в нескольких копиях.' },
      pg: { name: 'PostgreSQL', tech: 'pg', slide: 3, text: 'Источник правды: пользователи, заказы, платежи. Всё, что нельзя потерять и что должно быть согласовано.' },
      redis: { name: 'Redis', tech: 'redis', slide: 6, text: 'Кэш и быстрые счётчики. Приложение сначала смотрит сюда; если данных нет — идёт в Postgres и кладёт ответ в Redis.' },
      es: { name: 'Elasticsearch', tech: 'es', slide: 13, text: 'Поисковый индекс: копия данных из Postgres, устроенная для полнотекстового поиска.' },
      s3: { name: 'S3', tech: 's3', slide: 17, text: 'Файлы: фото, документы, бэкапы. В базе хранится только ключ файла.' },
      rabbit: { name: 'RabbitMQ', tech: 'rabbit', slide: 8, text: 'Очередь фоновых задач. API кладёт задачу «отправить письмо» и сразу отвечает пользователю, а воркер выполнит её чуть позже.' },
      workers: { name: 'Воркеры', text: 'Отдельные процессы, которые разбирают очередь: отправляют письма, собирают PDF, обрабатывают картинки.' },
      kafka: { name: 'Kafka', tech: 'kafka', slide: 10, text: 'Журнал событий: «заказ создан», «товар просмотрен». Его независимо читают аналитика, рекомендации и антифрод.' },
      ch: { name: 'ClickHouse', tech: 'ch', slide: 15, text: 'Аналитическая база. Получает события из Kafka и строит отчёты по миллиардам строк.' },
    };
    const rows = [['user'], ['api'], ['pg', 'redis', 'es', 's3'], ['rabbit', 'kafka'], ['workers', 'ch']];
    const detail = h('div', { class: 'map-detail', 'aria-live': 'polite' });
    const buttons = {};
    const grid = h('div', { class: 'map' });
    rows.forEach((row, i) => {
      if (i) grid.append(h('div', { class: 'map-arrow', 'aria-hidden': 'true' }, i === 4 ? [h('span', null, '↓'), h('span', null, '↓')] : '↓'));
      grid.append(h('div', { class: 'map-row n' + row.length }, row.map(key => {
        const n = nodes[key];
        const b = h('button', { class: 'map-node' + (n.tech ? ' t-' + n.tech : ' plain'), onclick: () => select(key) }, n.name);
        buttons[key] = b;
        return b;
      })));
    });
    function select(key) {
      const n = nodes[key];
      Object.entries(buttons).forEach(([k, b]) => b.classList.toggle('sel', k === key));
      detail.className = 'map-detail' + (n.tech ? ' t-' + n.tech : '');
      detail.replaceChildren(
        h('b', null, n.name),
        h('p', null, n.text),
        n.slide ? h('a', { href: '#' + n.slide }, 'Перейти к слайду ' + n.slide) : '',
      );
    }
    root.append(grid, detail);
    select('api');
    return {};
  });

  // ---------------------------------------------------------------- PostgreSQL transaction
  Deck.demo('tx', root => {
    const START = { a: 100, b: 50 };
    let acc = { ...START }, busy = false;
    const txIn = h('input', { type: 'checkbox', checked: true });
    const bal = { a: h('div', { class: 'acc-bal' }), b: h('div', { class: 'acc-bal' }) };
    const total = h('div', { class: 'acc-total' });
    const sqlEl = h('ol', { class: 'sql-steps' });
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    const okBtn = h('button', { class: 'btn primary', onclick: () => run(false) }, 'Перевести 30 ₽');
    const crashBtn = h('button', { class: 'btn', onclick: () => run(true) }, 'Перевести и уронить сервер');
    const resetBtn = h('button', { class: 'btn', onclick: reset }, 'Сброс');
    const box = (name, k) => h('div', { class: 'acc' }, h('span', { class: 'label' }, name), bal[k]);

    root.append(
      h('label', { class: 'toggle' }, txIn, h('span', null, 'Обернуть в ', h('code', null, 'BEGIN … COMMIT'))),
      h('div', { class: 'accounts' }, box('Алиса', 'a'), box('Боб', 'b')),
      total,
      sqlEl,
      h('div', { class: 'controls' }, okBtn, crashBtn, resetBtn),
      log,
    );
    txIn.addEventListener('change', () => showSql());

    const stmts = () => {
      const s = [
        "UPDATE accounts SET balance = balance - 30 WHERE name = 'Алиса';",
        "UPDATE accounts SET balance = balance + 30 WHERE name = 'Боб';",
      ];
      return txIn.checked ? ['BEGIN;', ...s, 'COMMIT;'] : s;
    };
    function showSql(active = -1, states = {}) {
      sqlEl.innerHTML = stmts().map((s, i) =>
        `<li class="${i === active ? 'cur' : ''} ${states[i] || ''}"><code>${highlight(s, 'sql')}</code></li>`).join('');
    }
    function paint(pending) {
      for (const k of ['a', 'b']) {
        const p = pending && pending[k] !== acc[k];
        bal[k].innerHTML = p ? `${fmt(pending[k])} ₽ <small>не зафиксировано, другие видят ${fmt(acc[k])} ₽</small>` : `${fmt(acc[k])} ₽`;
        bal[k].classList.toggle('pending', p);
      }
      const sum = acc.a + acc.b;
      total.innerHTML = `Всего денег в базе: <b>${fmt(sum)} ₽</b>` + (sum !== 150 ? ' — должно быть 150 ₽' : '');
      total.classList.toggle('bad', sum !== 150);
    }
    function say(text, cls = '') { log.textContent = text; log.className = 'log ' + cls; }
    function lock(on) { busy = on; okBtn.disabled = crashBtn.disabled = resetBtn.disabled = txIn.disabled = on; }

    async function run(crash) {
      if (busy) return;
      lock(true);
      const tx = txIn.checked, list = stmts(), states = {};
      const pending = { ...acc };
      say(tx ? 'Транзакция началась.' : 'Каждый запрос фиксируется сам по себе (autocommit).');
      for (let i = 0; i < list.length; i++) {
        showSql(i, states);
        await sleep(600);
        const s = list[i];
        if (!s.startsWith('UPDATE')) { states[i] = 'done'; continue; }
        const debit = s.includes('- 30');
        if (debit && pending.a < 30) {
          states[i] = 'err';
          for (let j = i + 1; j < list.length; j++) states[j] = 'skip';
          showSql(-1, states);
          say(`ERROR: new row violates check constraint "balance_nonnegative". У Алисы ${pending.a} ₽ — списать 30 нельзя. ${tx ? 'Транзакция откатилась целиком.' : 'Строка не изменилась.'}`, 'bad');
          paint();
          return lock(false);
        }
        if (debit) pending.a -= 30; else pending.b += 30;
        if (!tx) acc = { ...pending };
        states[i] = 'done';
        paint(tx ? pending : null);
        if (crash && debit) {
          for (let j = i + 1; j < list.length; j++) states[j] = 'skip';
          showSql(-1, states);
          await sleep(500);
          paint();
          say(tx
            ? 'Сервер упал после первого UPDATE. Транзакция не дошла до COMMIT, и после перезапуска её изменений нет. Деньги на месте.'
            : 'Сервер упал после первого UPDATE. Без транзакции списание уже зафиксировано, а зачисления не было: 30 ₽ исчезли.', tx ? 'ok' : 'bad');
          return lock(false);
        }
      }
      acc = { ...pending };
      showSql(-1, states);
      paint();
      say(tx ? 'COMMIT: оба изменения зафиксированы одновременно.' : 'Оба UPDATE выполнились. Повезло: между ними ничего не сломалось.', 'ok');
      lock(false);
    }

    function reset() {
      acc = { ...START };
      showSql();
      paint();
      say('Нажмите «Перевести 30 ₽».');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- PostgreSQL index
  Deck.demo('index', root => {
    const slider = h('input', { type: 'range', min: 300, max: 1000, value: 700, 'aria-label': 'Строк в таблице' });
    const head = h('div', { class: 'cost-n' });
    const seq = h('div', { class: 'ix-row' });
    const idx = h('div', { class: 'ix-row' });
    const tree = h('div', { class: 'tree', 'aria-hidden': 'true' });
    root.append(
      head,
      h('label', { class: 'slider' }, h('span', { class: 'label' }, 'Строк в таблице'), slider),
      seq, idx, tree,
      h('p', { class: 'note' }, 'Оценки порядка величины: последовательное чтение около 20 млн строк в секунду, страницы индекса обычно уже в памяти.'),
    );

    function nice(x) {
      const p = 10 ** (Math.floor(Math.log10(x)) - 1);
      return Math.round(x / p) * p;
    }
    function time(s) {
      if (s < 1e-3) return dec(s * 1e6, 0) + ' мкс';
      if (s < 1) return dec(s * 1e3, s < 0.01 ? 1 : 0) + ' мс';
      if (s < 120) return dec(s, s < 10 ? 1 : 0) + ' с';
      return dec(s / 60, 0) + ' мин';
    }
    function short(n) {
      if (n >= 1e9) return dec(n / 1e9, n < 1e10 ? 1 : 0) + ' млрд';
      if (n >= 1e6) return dec(n / 1e6, n < 1e7 ? 1 : 0) + ' млн';
      if (n >= 1e3) return dec(n / 1e3, 0) + ' тыс.';
      return String(n);
    }
    function update() {
      const n = nice(10 ** (slider.value / 100));
      const depth = Math.max(1, Math.ceil(Math.log(n) / Math.log(300)));
      head.innerHTML = `<b>${short(n)}</b> ${plural(n, ['строка', 'строки', 'строк'])}`;
      seq.innerHTML = `<span class="label">Без индекса: Seq Scan</span><b>${short(n)} ${plural(n, ['строка', 'строки', 'строк'])}</b><span>≈ ${time(n / 2e7)}</span>`;
      idx.innerHTML = `<span class="label">С индексом: Index Scan</span><b>${depth + 1} ${plural(depth + 1, ['чтение', 'чтения', 'чтений'])}</b><span>≈ ${time((depth + 1) * 2e-5)}</span>`;
      tree.innerHTML = Array.from({ length: depth }, (_, lvl) => {
        const count = lvl === 0 ? 1 : 5;
        const hit = lvl === 0 ? 0 : (lvl * 2 + 1) % 5;
        return `<div class="tree-level"><span class="label">${lvl === 0 ? 'корень' : lvl === depth - 1 ? 'листья' : 'уровень ' + (lvl + 1)}</span><div class="tree-nodes">${
          Array.from({ length: count }, (_, i) => `<span class="tnode ${i === hit ? 'hit' : ''}"></span>`).join('')}${lvl ? '<span class="more">…</span>' : ''}</div></div>`;
      }).join('') + '<div class="tree-level"><span class="label">таблица</span><div class="tree-nodes"><span class="tnode row hit">строка</span></div></div>';
    }
    slider.addEventListener('input', update);
    update();
    return {};
  });

  // ---------------------------------------------------------------- Redis cache-aside
  Deck.demo('cache', root => {
    const items = [['Кофе', 300, 30], ['Чай', 250, 20], ['Сыр', 900, 15], ['Хлеб', 80, 15], ['Мёд', 650, 10], ['Рис', 120, 10]]
      .map(([name, db, w], i) => ({ id: i + 1, name, db, w, cache: null, exp: 0, flash: '', flashAt: -1 }));
    const totalW = items.reduce((s, it) => s + it.w, 0);
    let ttl = 8, now = 0, acc = 0, playing = true, stats, lines;

    const rowsEl = h('div', { class: 'crows' });
    const statsEl = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const ttlOut = h('output', null, ttl + ' с');
    const ttlIn = h('input', { type: 'range', min: 2, max: 30, value: ttl, 'aria-label': 'TTL' });
    const invIn = h('input', { type: 'checkbox' });
    const playBtn = h('button', { class: 'btn', onclick: () => { playing = !playing; playBtn.textContent = playing ? 'Пауза' : 'Пуск'; } }, 'Пауза');
    ttlIn.addEventListener('input', () => { ttl = +ttlIn.value; ttlOut.textContent = ttl + ' с'; });

    root.append(
      h('div', { class: 'controls' },
        playBtn,
        h('button', { class: 'btn primary', onclick: raise }, 'Кофе подорожал на 50 ₽'),
        h('button', { class: 'btn', onclick: flush }, 'Перезапустить Redis'),
      ),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'TTL ключей'), ttlIn, ttlOut),
      h('label', { class: 'toggle' }, invIn, h('span', null, 'При изменении цены удалять ключ из кэша (', h('code', null, 'DEL'), ')')),
      h('div', { class: 'crow chead' }, h('span', null, 'Товар'), h('span', null, 'Postgres'), h('span', null, 'Redis'), h('span', null, 'TTL')),
      rowsEl,
      statsEl,
      logEl,
    );

    function say(text, cls = '') {
      lines.unshift({ text, cls });
      lines.length = Math.min(lines.length, 3);
      logEl.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''} ${l.cls}">${l.text}</div>`).join('');
    }
    function request() {
      let r = Math.random() * totalW, it = items[0];
      for (const x of items) { if ((r -= x.w) < 0) { it = x; break; } }
      stats.req++;
      let lat;
      if (it.cache != null) {
        lat = 0.3 + Math.random() * 0.4;
        stats.hit++;
        it.flash = 'hit';
        if (it.cache !== it.db) {
          stats.stale++;
          it.flash = 'stale';
          say(`GET product:${it.id} → ${it.cache} ₽ из кэша, а в базе уже ${it.db} ₽. Пользователь видит устаревшую цену.`, 'warn');
        } else say(`GET product:${it.id} → попадание, ${dec(lat)} мс`);
      } else {
        lat = 20 + Math.random() * 20;
        it.cache = it.db;
        it.exp = now + ttl;
        it.flash = 'miss';
        say(`GET product:${it.id} → промах. Запрос в Postgres за ${dec(lat, 0)} мс, затем SET product:${it.id} EX ${ttl}`);
      }
      it.flashAt = now;
      stats.lat.push(lat);
      if (stats.lat.length > 60) stats.lat.shift();
    }
    function raise() {
      const it = items[0];
      it.db += 50;
      if (invIn.checked && it.cache != null) {
        it.cache = null;
        say(`UPDATE products SET price = ${it.db} и DEL product:1 — следующий запрос возьмёт свежую цену из базы.`, 'ok');
      } else if (it.cache != null) {
        say(`UPDATE products SET price = ${it.db}. В кэше осталось ${it.cache} ₽ — будет отдаваться, пока не истечёт TTL.`, 'warn');
      } else say(`UPDATE products SET price = ${it.db}. Ключа в кэше нет, проблем не будет.`);
      render();
    }
    function flush() {
      items.forEach(it => { it.cache = null; });
      say('Redis перезапущен, кэш пуст: все запросы пошли в Postgres. Так выглядит «холодный старт» — база должна его пережить.', 'warn');
      render();
    }
    function render() {
      rowsEl.innerHTML = items.map(it => {
        const left = it.cache != null ? Math.max(0, it.exp - now) : 0;
        const fl = now - it.flashAt < 0.35 ? it.flash : '';
        const stale = it.cache != null && it.cache !== it.db;
        return `<div class="crow ${fl}"><span>${it.name}</span><span class="num">${it.db} ₽</span>` +
          `<span class="num ${stale ? 'stale' : ''}">${it.cache != null ? it.cache + ' ₽' : '—'}</span>` +
          `<span class="track"><span class="fill" style="width:${(left / ttl) * 100}%"></span></span></div>`;
      }).join('');
      const avg = stats.lat.length ? stats.lat.reduce((a, b) => a + b, 0) / stats.lat.length : 0;
      const rate = stats.req ? Math.round((stats.hit / stats.req) * 100) : 0;
      statsEl.innerHTML = `<div class="stat"><b>${rate}%</b><span>попаданий</span></div>` +
        `<div class="stat"><b>${dec(avg)} мс</b><span>средний ответ</span></div>` +
        `<div class="stat ${stats.stale ? 'warn' : ''}"><b>${stats.stale}</b><span>устаревших ответов</span></div>`;
    }

    stats = { req: 0, hit: 0, lat: [], stale: 0 };
    lines = [];
    say('Запросы к товарам идут потоком: популярные запрашивают чаще.');
    render();
    return rafLoop(dt => {
      if (!playing) return;
      now += dt;
      acc += dt;
      for (const it of items) if (it.cache != null && it.exp <= now) it.cache = null;
      while (acc >= 0.5) { acc -= 0.5; request(); }
      render();
    });
  });

  // ---------------------------------------------------------------- RabbitMQ
  Deck.demo('rabbit', root => {
    const PROC = 1.6;
    const TYPES = { 'order.created': 'k1', 'order.paid': 'k2', 'user.signup': 'k3' };
    let n = 0, lines = [];
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const queues = [
      { name: 'склад', binds: ['order.*'] },
      { name: 'письма', binds: ['order.paid', 'user.signup'] },
    ].map(q => {
      Object.assign(q, { items: [], on: true, msg: null, t: 0, done: 0, itemsEl: h('div', { class: 'queue rq' }), workerEl: h('div', { class: 'rworker' }) });
      q.btn = h('button', { class: 'btn small', onclick: () => toggle(q) }, 'Выключить воркер');
      q.el = h('div', { class: 'rqueue' },
        h('div', { class: 'rq-head' }, h('b', null, q.name), h('code', null, q.binds.join(', '))),
        q.itemsEl, q.workerEl, q.btn);
      return q;
    });

    root.append(
      h('div', { class: 'label' }, 'Опубликовать событие в exchange'),
      h('div', { class: 'controls' }, Object.entries(TYPES).map(([type, cls]) =>
        h('button', { class: 'btn pub ' + cls, onclick: () => publish(type) }, h('code', null, type)))),
      h('div', { class: 'rqueues' }, queues.map(q => q.el)),
      logEl,
    );

    const match = (b, key) => b.endsWith('.*') ? key.startsWith(b.slice(0, -1)) && !key.slice(b.length - 1).includes('.') : b === key;
    function say(text, cls = '') {
      lines.unshift({ text, cls });
      lines.length = Math.min(lines.length, 3);
      logEl.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l.text}</div>`).join('');
      logEl.className = 'log ' + lines[0].cls;
    }
    function publish(type) {
      const id = ++n;
      const targets = queues.filter(q => q.binds.some(b => match(b, type)));
      targets.forEach(q => q.items.push({ id, type, again: false }));
      say(`#${id} ${type} → ${targets.map(q => `«${q.name}»`).join(' и ')}${targets.length > 1 ? ': каждая очередь получила свою копию' : ''}.`);
      render();
    }
    function toggle(q) {
      q.on = !q.on;
      if (!q.on && q.msg) {
        q.items.unshift({ ...q.msg, again: true });
        say(`Воркер «${q.name}» упал, не отправив ack: #${q.msg.id} вернулось в начало очереди и будет доставлено снова.`, 'warn');
        q.msg = null;
      } else if (!q.on) say(`Воркер «${q.name}» выключен. Сообщения копятся в очереди — брокер их хранит.`);
      else say(`Воркер «${q.name}» снова работает и разбирает накопившееся.`, 'ok');
      q.btn.textContent = q.on ? 'Выключить воркер' : 'Включить воркер';
      render();
    }
    const chip = m => `<span class="msg ${TYPES[m.type]} ${m.again ? 'again' : ''}" title="${m.type}">#${m.id}${m.again ? ' ↻' : ''}</span>`;
    function render() {
      for (const q of queues) {
        q.itemsEl.innerHTML = q.items.length ? q.items.map(chip).join('') : '<span class="empty">очередь пуста</span>';
        q.workerEl.className = 'rworker' + (q.on ? '' : ' off');
        q.workerEl.innerHTML = !q.on
          ? '<span class="label">воркер выключен</span>'
          : q.msg
            ? `<span class="label">обрабатывает</span>${chip(q.msg)}<span class="track"><span class="fill" style="width:${(q.t / PROC) * 100}%"></span></span>`
            : '<span class="label">воркер ждёт сообщений</span>';
        q.workerEl.insertAdjacentHTML('beforeend', `<span class="rdone">ack: ${q.done}</span>`);
      }
    }
    say('Нажмите на событие, чтобы опубликовать его.');
    render();
    return rafLoop(dt => {
      let changed = false;
      for (const q of queues) {
        if (!q.on) continue;
        if (!q.msg && q.items.length) { q.msg = q.items.shift(); q.t = 0; changed = true; }
        if (q.msg) {
          q.t += dt;
          changed = true;
          if (q.t >= PROC) {
            q.done++;
            say(`Воркер «${q.name}» обработал #${q.msg.id} и отправил ack — брокер удалил сообщение.`, 'ok');
            q.msg = null;
          }
        }
      }
      if (changed) render();
    });
  });

  // ---------------------------------------------------------------- Kafka
  Deck.demo('kafka', root => {
    const TYPES = [['заказ', 'k1'], ['оплата', 'k2'], ['просмотр', 'k3']];
    const MAX = 40;
    let log = [], start = 0, next = 0, lines = [];
    const groups = [
      { name: 'биллинг', cls: 'g1', speed: 0.5 },
      { name: 'аналитика', cls: 'g2', speed: 1.4 },
    ];
    const extra = { name: 'рекомендации', cls: 'g3', speed: 0.35 };
    const logView = h('div', { class: 'klog' });
    const groupsEl = h('div', { class: 'kgroups' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const addBtn = h('button', { class: 'btn', onclick: addGroup }, 'Новая группа');

    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => produce(1) }, 'Записать событие'),
        h('button', { class: 'btn', onclick: () => produce(10) }, '+10'),
        h('button', { class: 'btn', onclick: retention }, 'Удалить старые'),
        addBtn,
      ),
      h('div', { class: 'label' }, 'Топик orders, партиция 0'),
      logView,
      groupsEl,
      logEl,
    );

    function say(text, cls = '') {
      lines.unshift(text);
      lines.length = Math.min(lines.length, 2);
      logEl.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      logEl.className = 'log ' + cls;
    }
    function setupGroup(g, offset) {
      Object.assign(g, { offset, t: 0, paused: false, info: h('div', { class: 'kinfo' }) });
      g.pauseBtn = h('button', { class: 'btn small', onclick: () => { g.paused = !g.paused; g.pauseBtn.textContent = g.paused ? 'Продолжить' : 'Пауза'; } }, 'Пауза');
      g.el = h('div', { class: 'kgroup ' + g.cls },
        h('span', { class: 'kdot' }), h('b', null, g.name), g.info,
        h('div', { class: 'kbtns' }, g.pauseBtn, h('button', { class: 'btn small', onclick: () => rewind(g) }, 'С начала')));
      groupsEl.append(g.el);
    }
    function produce(k) {
      for (let i = 0; i < k; i++) log.push({ off: next++, type: TYPES[Math.floor(Math.random() * 3)] });
      if (next - start > MAX) trim(next - MAX, 'Журнал разросся — сработал retention, старые события удалены.');
      render();
    }
    function trim(to, text) {
      const lost = groups.filter(g => g.offset < to);
      start = to;
      log = log.filter(e => e.off >= start);
      lost.forEach(g => { g.offset = start; });
      say(text + (lost.length ? ` Группа «${lost.map(g => g.name).join('», «')}» не успела их прочитать и пропустила.` : ''), lost.length ? 'warn' : '');
    }
    function retention() {
      if (next === start) return;
      trim(Math.min(next, start + Math.max(1, Math.ceil((next - start) / 2))), `Retention: удалены события до offset ${Math.min(next, start + Math.max(1, Math.ceil((next - start) / 2)))}.`);
      render();
    }
    function rewind(g) {
      g.offset = start;
      say(`«${g.name}» перемотала offset на ${start} и перечитает всё, что ещё хранится. В RabbitMQ так нельзя.`, 'ok');
      render();
    }
    function addGroup() {
      groups.push(extra);
      setupGroup(extra, start);
      addBtn.disabled = true;
      say(`Новый сервис «${extra.name}» подключился и читает журнал с начала: события никуда не делись.`, 'ok');
      render();
    }
    function render() {
      const cells = log.map(e => {
        const dots = groups.filter(g => g.offset === e.off).map(g => `<i class="${g.cls}"></i>`).join('');
        return `<span class="kcell ${e.type[1]}" title="${e.type[0]}">${e.off}<span class="kdots">${dots}</span></span>`;
      });
      const endDots = groups.filter(g => g.offset >= next).map(g => `<i class="${g.cls}"></i>`).join('');
      cells.push(`<span class="kcell end">конец<span class="kdots">${endDots}</span></span>`);
      logView.innerHTML = (start ? `<span class="kcut">0–${start - 1} удалены</span>` : '') + cells.join('');
      for (const g of groups) {
        const lag = next - g.offset;
        g.info.innerHTML = `offset <b>${g.offset}</b>, отставание <b class="${lag > 5 ? 'lag' : ''}">${lag}</b>`;
      }
    }

    groups.forEach(g => setupGroup(g, 0));
    produce(8);
    say('Точка — следующее событие, которое прочитает группа. Чтение ничего не удаляет из журнала.');
    return rafLoop(dt => {
      let changed = false;
      for (const g of groups) {
        if (g.paused || g.offset >= next) continue;
        g.t += dt;
        if (g.t >= g.speed) { g.t = 0; g.offset++; changed = true; }
      }
      if (changed) render();
    });
  });

  // ---------------------------------------------------------------- Elasticsearch inverted index
  Deck.demo('search', root => {
    const DOCS = ['Кроссовки беговые красные', 'Красная куртка для бега', 'Беговая дорожка складная', 'Кроссовки для баскетбола', 'Куртка зимняя, красная'];
    const STOP = new Set(['для', 'и', 'в', 'на', 'с', 'по']);
    const ENDINGS = ['ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ые', 'ие', 'ая', 'яя', 'ое', 'ее', 'ой', 'ей', 'ий', 'ый', 'ом', 'ем', 'ах', 'ях', 'ов', 'ев', 'ам', 'ям', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о'];
    const stem = w => { for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length); return w; };
    const words = text => (text.toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]+/g) || []);
    const terms = text => words(text).filter(w => !STOP.has(w)).map(stem);

    const index = new Map();
    DOCS.forEach((d, i) => terms(d).forEach(t => { if (!index.has(t)) index.set(t, new Set()); index.get(t).add(i + 1); }));
    const sorted = [...index.keys()].sort((a, b) => a.localeCompare(b, 'ru'));

    const input = h('input', { type: 'search', class: 'search-in', value: 'красные кроссовки', 'aria-label': 'Поисковый запрос', autocomplete: 'off' });
    const tokensEl = h('div', { class: 'queue' });
    const esEl = h('div', { class: 'sres' });
    const likeEl = h('div', { class: 'sres' });
    const indexEl = h('div', { class: 'sindex' });
    const presets = ['красные кроссовки', 'беговая', 'куртку', 'кроссовки беговые красные'];

    root.append(
      input,
      h('div', { class: 'controls' }, presets.map(p => h('button', { class: 'btn small', onclick: () => { input.value = p; update(); } }, p))),
      h('div', { class: 'srow' }, h('span', { class: 'label' }, 'Термы запроса'), tokensEl),
      h('div', { class: 'scols' },
        h('div', null, h('div', { class: 'label' }, 'Elasticsearch'), esEl),
        h('div', null, h('div', { class: 'label' }, h('code', null, "LIKE '%запрос%'")), likeEl)),
      h('details', { class: 'sdetails' }, h('summary', null, 'Обратный индекс'), indexEl),
    );
    input.addEventListener('input', update);

    const mark = (doc, q) => doc.replace(/[A-Za-zА-Яа-яЁё0-9]+/g, w => q.has(stem(w.toLowerCase().replace(/ё/g, 'е'))) && !STOP.has(w.toLowerCase()) ? `<mark>${w}</mark>` : w);

    function update() {
      const q = new Set(terms(input.value));
      tokensEl.innerHTML = q.size ? [...q].map(t => `<span class="term">${t}</span>`).join('') : '<span class="empty">нет</span>';
      const scored = DOCS.map((d, i) => ({ d, i, score: [...q].filter(t => index.get(t)?.has(i + 1)).length }))
        .filter(r => r.score).sort((a, b) => b.score - a.score || a.i - b.i);
      esEl.innerHTML = scored.length
        ? scored.map(r => `<div class="hit"><span>${mark(r.d, q)}</span><span class="score">${r.score}/${q.size}</span></div>`).join('')
        : '<span class="empty">ничего не найдено</span>';
      const needle = input.value.trim().toLowerCase();
      const like = needle ? DOCS.filter(d => d.toLowerCase().includes(needle)) : [];
      likeEl.innerHTML = like.length ? like.map(d => `<div class="hit"><span>${d}</span></div>`).join('') : '<span class="empty">ничего не найдено</span>';
      indexEl.innerHTML = sorted.map(t => `<div class="irow ${q.has(t) ? 'on' : ''}"><code>${t}</code><span>${[...index.get(t)].map(i => `<span class="docid">${i}</span>`).join('')}</span></div>`).join('');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- row vs column storage
  Deck.demo('columns', root => {
    const COLS = ['id', 'date', 'city', 'product', 'amount'];
    const ROWS = [
      [1, '01.10', 'Москва', 'Кофе', 300], [2, '01.10', 'Казань', 'Чай', 250], [3, '02.10', 'Москва', 'Сыр', 900], [4, '02.10', 'Пермь', 'Хлеб', 80],
      [5, '03.10', 'Казань', 'Мёд', 650], [6, '03.10', 'Москва', 'Рис', 120], [7, '04.10', 'Пермь', 'Кофе', 300], [8, '04.10', 'Москва', 'Чай', 250],
    ];
    const Q = {
      sum: {
        label: 'Выручка', sql: 'SELECT sum(amount) FROM orders', cols: [4], result: 'sum = 2850',
        row: '≈ 68 ГБ', col: '≈ 8 ГБ, а после сжатия ещё в разы меньше',
      },
      group: {
        label: 'По городам', sql: 'SELECT city, sum(amount) FROM orders GROUP BY city', cols: [2, 4], result: 'Москва 1570, Казань 900, Пермь 380',
        row: '≈ 68 ГБ', col: '≈ 24 ГБ до сжатия; повторяющиеся города сжимаются очень хорошо',
      },
      point: {
        label: 'Один заказ', sql: 'SELECT * FROM orders WHERE id = 5', point: 4, result: '5, 03.10, Казань, Мёд, 650',
        row: 'пара страниц по 8 КБ через индекс', col: 'кусок по 8192 строки из каждой из пяти колонок — в сотни раз больше',
      },
    };
    let cur = 'sum';
    const btns = {};
    const sqlEl = h('pre', { class: 'code mini' }, h('code'));
    const rowStore = h('div', { class: 'store' });
    const colStore = h('div', { class: 'store' });
    const resEl = h('p', { class: 'note' });
    root.append(
      h('div', { class: 'controls' }, Object.entries(Q).map(([k, q]) => (btns[k] = h('button', { class: 'btn small', onclick: () => { cur = k; render(); } }, q.label)))),
      sqlEl,
      h('div', { class: 'stores' }, rowStore, colStore),
      resEl,
    );

    function readSets(q) {
      const rowRead = new Set(), colRead = new Set();
      ROWS.forEach((r, i) => COLS.forEach((c, j) => {
        const key = i + ':' + j;
        if (q.point == null || i === q.point) rowRead.add(key);
        if (q.point == null ? q.cols.includes(j) : j === 0 || i === q.point) colRead.add(key);
      }));
      return { rowRead, colRead };
    }
    const cell = (v, on, j) => `<span class="sc ${on ? 'on' : ''} c${j}">${v}</span>`;
    function render() {
      const q = Q[cur];
      Object.entries(btns).forEach(([k, b]) => b.classList.toggle('sel', k === cur));
      sqlEl.firstChild.innerHTML = highlight(q.sql, 'sql');
      const { rowRead, colRead } = readSets(q);
      const total = ROWS.length * COLS.length;
      rowStore.innerHTML = `<div class="store-head"><b>Построчно</b><span>PostgreSQL</span></div>
        <div class="disk rows">${ROWS.map((r, i) => `<div class="line">${r.map((v, j) => cell(v, rowRead.has(i + ':' + j), j)).join('')}</div>`).join('')}</div>
        <div class="store-foot">прочитано <b>${rowRead.size}</b> из ${total} ячеек<br>на миллиарде строк: ${q.row}</div>`;
      colStore.innerHTML = `<div class="store-head"><b>По колонкам</b><span>ClickHouse</span></div>
        <div class="disk cols">${COLS.map((c, j) => `<div class="line"><span class="cname">${c}</span>${ROWS.map((r, i) => cell(r[j], colRead.has(i + ':' + j), j)).join('')}</div>`).join('')}</div>
        <div class="store-foot">прочитано <b>${colRead.size}</b> из ${total} ячеек<br>на миллиарде строк: ${q.col}</div>`;
      resEl.innerHTML = `Результат: <code>${q.result}</code>`;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- task → technology game
  Deck.demo('chooser', root => {
    const TECH = { PostgreSQL: 'pg', Redis: 'redis', RabbitMQ: 'rabbit', Kafka: 'kafka', Elasticsearch: 'es', ClickHouse: 'ch', S3: 's3' };
    const TASKS = [
      { q: 'Хранить пользователей, заказы и платежи', a: 'PostgreSQL', why: 'Связанные данные, где важны целостность и транзакции, — основная работа реляционной базы.' },
      { q: 'Ограничить API: не больше 100 запросов в минуту на пользователя', a: 'Redis', ok: ['PostgreSQL'], why: 'INCR и EXPIRE в Redis дают атомарный счётчик с автоматическим сбросом за доли миллисекунды. Postgres тоже справится, но это лишняя запись в базу на каждый запрос.' },
      { q: 'После оплаты отправить чек на почту, не заставляя пользователя ждать', a: 'RabbitMQ', ok: ['PostgreSQL', 'Redis'], why: 'Классическая фоновая задача: положить в очередь, а воркер отправит письмо и подтвердит. В небольшом проекте подойдёт и таблица-очередь в Postgres.' },
      { q: '200 тысяч событий о кликах в секунду; их читают аналитика, антифрод и рекомендации', a: 'Kafka', why: 'Огромный поток и несколько независимых читателей со своей скоростью — ровно то, для чего создан журнал Kafka.' },
      { q: 'Поиск по каталогу из миллиона товаров с морфологией, опечатками и фильтрами', a: 'Elasticsearch', ok: ['PostgreSQL'], why: 'Релевантность, нечёткий поиск и фасеты — сильная сторона поискового движка. Для простых случаев хватит tsvector и pg_trgm в Postgres.' },
      { q: 'Дашборд: выручка по дням и городам за три года, миллиарды строк', a: 'ClickHouse', why: 'Агрегации по огромным таблицам — задача колоночной базы. Postgres будет считать такой отчёт минутами и нагружать рабочую базу.' },
      { q: 'Пользователи загружают фото и видео', a: 'S3', why: 'Файлы — в объектное хранилище, в базе только ключ. База остаётся компактной, а файлы раздаются через CDN.' },
      { q: 'Каталог на 3000 товаров с поиском по названию', a: 'PostgreSQL', ok: ['Elasticsearch'], why: 'На таком объёме встроенного поиска Postgres более чем достаточно. Отдельный Elasticsearch — лишняя система, которую надо держать в синхроне с базой.' },
      { q: 'Сессии пользователей, которые истекают через 30 минут бездействия', a: 'Redis', ok: ['PostgreSQL'], why: 'Ключ с TTL удалится сам, а чтение сессии на каждом запросе быстрое. В Postgres тоже можно, но придётся самим чистить старые записи.' },
    ];
    let i = 0, score = 0, answered = false;
    const progress = h('div', { class: 'label' });
    const question = h('p', { class: 'cq' });
    const options = h('div', { class: 'copts' });
    const verdict = h('div', { class: 'cverdict', 'aria-live': 'polite' });
    const nextBtn = h('button', { class: 'btn primary', onclick: next }, 'Следующая задача');
    root.append(progress, question, options, verdict, h('div', { class: 'controls' }, nextBtn));

    const buttons = Object.entries(TECH).map(([name, cls]) => {
      const b = h('button', { class: 'copt t-' + cls, onclick: () => answer(name, b) }, name);
      options.append(b);
      return b;
    });

    function show() {
      const t = TASKS[i];
      answered = false;
      progress.textContent = `Задача ${i + 1} из ${TASKS.length}, верно: ${score}`;
      question.textContent = t.q;
      buttons.forEach(b => { b.disabled = false; b.className = b.className.replace(/ (right|okay|wrong)/g, ''); });
      verdict.hidden = true;
      nextBtn.hidden = true;
    }
    function answer(name, b) {
      if (answered) return;
      answered = true;
      const t = TASKS[i];
      const right = name === t.a, okay = (t.ok || []).includes(name);
      if (right) score++;
      buttons.forEach(x => {
        x.disabled = true;
        if (x.textContent === t.a) x.classList.add('right');
      });
      if (!right) b.classList.add(okay ? 'okay' : 'wrong');
      verdict.hidden = false;
      verdict.className = 'cverdict ' + (right ? 'right' : okay ? 'okay' : 'wrong');
      verdict.innerHTML = `<b>${right ? 'Верно.' : okay ? `Тоже рабочий вариант, но обычно берут ${t.a}.` : `Не лучший выбор. Здесь подойдёт ${t.a}.`}</b> ${t.why}`;
      progress.textContent = `Задача ${i + 1} из ${TASKS.length}, верно: ${score}`;
      nextBtn.hidden = false;
      nextBtn.textContent = i === TASKS.length - 1 ? 'Показать итог' : 'Следующая задача';
    }
    function next() {
      if (i < TASKS.length - 1) { i++; return show(); }
      if (i === TASKS.length - 1 && answered) {
        i = TASKS.length;
        progress.textContent = 'Итог';
        question.textContent = `${score} из ${TASKS.length} ${plural(TASKS.length, ['задачи', 'задач', 'задач'])} решены так же, как решил бы опытный бэкенд-разработчик.`;
        buttons.forEach(b => { b.disabled = true; });
        verdict.hidden = true;
        nextBtn.textContent = 'Пройти заново';
        return;
      }
      i = 0; score = 0;
      show();
    }
    show();
    return {};
  });
})();

// Demos for slides 2–9: storage choice, sync/async replication, read-your-writes,
// split brain, quorums, write conflicts, CAP/PACELC.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const ms = v => (v < 10 ? dec(v, 1) : Math.round(v)) + ' мс';

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  const logBox = () => h('div', { class: 'log', 'aria-live': 'polite' });
  const seg = (items, onPick, initial) => {
    const wrap = h('div', { class: 'seg' });
    const btns = items.map(([key, label]) => {
      const b = h('button', { class: 'btn small', onclick: () => pick(key) }, label);
      b.dataset.key = key;
      wrap.append(b);
      return b;
    });
    function pick(key, silent) {
      btns.forEach(b => b.classList.toggle('sel', b.dataset.key === key));
      if (!silent) onPick(key);
    }
    pick(initial, true);
    wrap.pick = pick;
    return wrap;
  };

  // ---------------------------------------------------------------- storage by access pattern
  Deck.demo('storepick', root => {
    const P = [
      ['Заказы, деньги, связи между сущностями', 'Реляционная', 'PostgreSQL, MySQL',
        'Транзакции, join, ограничения целостности, произвольные запросы по индексам.',
        'Один узел на NVMe: 10–50 тыс. записей/с, сотни тысяч чтений по индексу, данные до нескольких ТБ.',
        'Шардировать больно: Citus, Vitess или своя маршрутизация. Сначала — реплики и кэш.'],
      ['Get/put по ключу: сессии, кэш, счётчики', 'Ключ — значение', 'Redis, DynamoDB, Memcached',
        'Доступ только по ключу, ответ за доли миллисекунды, легко шардируется по хешу.',
        'Redis: 100–200 тыс. операций/с на ядро, &lt; 1 мс. DynamoDB: единицы мс при любом масштабе.',
        'Нет запросов «найти по полю». Redis хранит всё в RAM — дорого на терабайтах.'],
      ['Объект целиком, гибкая структура', 'Документная', 'MongoDB, Couchbase, jsonb в Postgres',
        'Профиль, карточка товара, настройки: читаются и пишутся одним куском.',
        'Шардинг встроен; атомарность — в пределах документа.',
        'Связи между документами — join в приложении или денормализация.'],
      ['Огромный поток записей, чтение по ключу партиции', 'Wide-column', 'Cassandra, ScyllaDB, HBase, Bigtable',
        'Ленты, сообщения, события IoT: «последние N записей по ключу». LSM-дерево: запись — дописывание в память и журнал.',
        'Десятки тысяч записей/с на узел, линейно растёт с числом узлов; Discord держит в ScyllaDB триллионы сообщений.',
        'Запросы только по ключу партиции. Модель строят от запросов, данные дублируют под каждый.'],
      ['Полнотекстовый поиск, фасеты, опечатки', 'Поисковый движок', 'Elasticsearch, OpenSearch',
        'Инвертированный индекс, ранжирование, агрегации по фильтрам.',
        'Новые документы видны через refresh, по умолчанию ~1 с.',
        'Не источник истины: индекс наполняют из основной базы через CDC и умеют пересобирать.'],
      ['Агрегаты по миллиардам строк, дашборды', 'Колоночная аналитика', 'ClickHouse, BigQuery, Snowflake',
        'Читает только нужные колонки, сжатие в разы, векторное выполнение.',
        'Сотни миллионов — миллиарды строк в секунду на скан одного сервера.',
        'Точечные UPDATE и транзакции — слабое место. Вставлять пачками, а не по строке.'],
      ['Файлы, картинки, бэкапы, логи', 'Объектное хранилище', 'S3, GCS, MinIO',
        'Неограниченный объём, 11 девяток надёжности, ~$0,02 за ГБ в месяц.',
        'Первый байт — 10–100 мс; пропускная способность масштабируется параллельными запросами.',
        'В базе храните только ключ объекта и метаданные. Отдавайте через CDN или presigned URL.'],
    ];
    const list = h('div', { class: 'sp-list' });
    const card = h('div', { class: 'sp-card', 'aria-live': 'polite' });
    const btns = P.map((p, i) => {
      const b = h('button', { class: 'sp-btn', onclick: () => pick(i) }, p[0]);
      list.append(b);
      return b;
    });
    root.append(list, card);
    function pick(i) {
      const [, kind, tech, why, nums, catch_] = P[i];
      btns.forEach((b, j) => b.classList.toggle('sel', i === j));
      card.innerHTML = `<div class="sp-head"><b>${kind}</b><span>${tech}</span></div>` +
        `<p>${why}</p><p class="sp-num">${nums}</p><p class="sp-catch">${catch_}</p>`;
    }
    pick(0);
    return {};
  });

  // ---------------------------------------------------------------- sync vs async replication
  Deck.demo('syncmode', root => {
    const FSYNC = 0.2;
    const LOC = { az: ['та же зона', 0.3], zone: ['соседняя зона', 1.5], region: ['другой регион', 75] };
    let mode = 'async', loc = 'zone', crashed = null;
    const view = h('div', { class: 'sm-nodes' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl);
    const modeSeg = seg([['async', 'асинхронно'], ['any1', 'ANY 1 из 2'], ['all', 'ждать обе']], k => { mode = k; crashed = null; explain(); render(); }, mode);
    const locSeg = seg(Object.entries(LOC).map(([k, v]) => [k, v[0]]), k => { loc = k; crashed = null; explain(); render(); }, loc);
    root.append(
      h('div', { class: 'sm-row' }, h('span', { class: 'label' }, 'Коммит'), modeSeg),
      h('div', { class: 'sm-row' }, h('span', { class: 'label' }, 'Реплика r2'), locSeg),
      view, stats,
      h('div', { class: 'controls' },
        h('button', { class: 'btn danger', onclick: () => crash('primary') }, 'Уронить лидера'),
        h('button', { class: 'btn', onclick: () => crash('r2') }, 'Уронить r2'),
        h('button', { class: 'btn small', onclick: () => { crashed = null; explain(); render(); } }, 'Сброс')),
      logEl,
    );
    const rtts = () => [LOC.zone[1], LOC[loc][1]];
    function latency() {
      const [a, b] = rtts();
      if (mode === 'async') return FSYNC;
      return Math.max(FSYNC, (mode === 'any1' ? Math.min(a, b) : Math.max(a, b)) + FSYNC);
    }
    function render() {
      const [a, b] = rtts();
      const node = (name, sub, cls) => `<div class="sm-node ${cls}"><b>${name}</b><span>${sub}</span></div>`;
      const wait = r => mode === 'all' || (mode === 'any1' && r === Math.min(a, b)) ? ' sm-wait' : '';
      view.innerHTML =
        node('лидер', 'принимает запись', 'ldr' + (crashed === 'primary' ? ' down' : '')) +
        node('r1', `соседняя зона · RTT ${ms(a)}`, wait(a)) +
        node('r2', `${LOC[loc][0]} · RTT ${ms(b)}`, wait(b) + (crashed === 'r2' ? ' down' : ''));
      const lat = latency();
      const loss = mode === 'async' ? (loc === 'region' ? '≈ 100 мс – с' : 'мс – с') : '0';
      const r2down = mode === 'all' ? 'стоит' : 'идёт';
      stats.innerHTML =
        `<div class="stat ${lat > 10 ? 'warn' : ''}"><b>${ms(lat)}</b><span>задержка коммита · ${Math.round(1000 / lat).toLocaleString('ru-RU')} коммитов/с на соединение</span></div>` +
        `<div class="stat ${mode === 'async' ? 'warn' : ''}"><b>${loss}</b><span>записей теряется при падении лидера</span></div>` +
        `<div class="stat ${mode === 'all' ? 'warn' : ''}"><b>${r2down}</b><span>запись, если упала r2</span></div>`;
    }
    function explain() {
      const lat = latency();
      if (mode === 'async') say(`Коммит = локальный fsync, ${ms(lat)}. Реплики получают журнал следом и отстают на время доставки и применения.`);
      else if (mode === 'any1') say(`Коммит ждёт быстрейшую из реплик: ${ms(lat)}. Вторая может отставать — но одна копия на другом сервере есть всегда.`);
      else say(`Коммит ждёт самую медленную реплику: ${ms(lat)}.${loc === 'region' ? ' Межрегиональный RTT достаётся каждой записи.' : ''}`);
    }
    function crash(what) {
      crashed = what;
      if (what === 'primary') {
        if (mode === 'async') say('Лидер умер. Повышаем самую свежую реплику — но коммиты, которые клиент уже получил, а реплики ещё нет, потеряны. При 5 000 транзакций/с и лаге 50 мс это ~250 записей.', 'bad');
        else say('Лидер умер. Каждый подтверждённый коммит есть хотя бы на одной реплике — повышаем её без потерь (Patroni выберет ту, что впереди).', 'ok');
      } else {
        if (mode === 'all') say('r2 недоступна — все коммиты повисли: подтверждать некому. Синхронно ко всем репликам почти никто не делает.', 'bad');
        else if (mode === 'any1') say('r2 недоступна — коммиты ждут r1 и продолжаются. Но запаса больше нет: упадёт и r1 — запись встанет.', 'warn');
        else say('r2 недоступна — лидер и не заметил. Когда r2 вернётся, догонит по журналу, если тот ещё не удалён.', 'ok');
      }
      render();
    }
    explain();
    render();
    return {};
  });

  // ---------------------------------------------------------------- read-your-writes
  Deck.demo('ryw', root => {
    const NAMES = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дина', 'Егор', 'Жанна', 'Зоя'];
    const R1_LAG = 0.3, LEADER_WINDOW = 5, LSN_TIMEOUT = 1.5;
    let now, log, nextName, strategy = 'any', r2lag = 2, lastWrite, myLsn, lastSeen, pending, st, flash;
    const nodesEl = h('div', { class: 'rw-nodes' });
    const screen = h('div', { class: 'rw-screen' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl);
    const lagOut = h('output');
    const lagIn = h('input', { type: 'range', min: 0, max: 5, step: 0.5, value: r2lag, 'aria-label': 'Лаг r2' });
    lagIn.addEventListener('input', () => { r2lag = +lagIn.value; lagOut.textContent = dec(r2lag) + ' с'; });
    lagOut.textContent = dec(r2lag) + ' с';
    const stratSeg = seg([['any', 'любая реплика'], ['sticky', 'липкая'], ['leader', 'лидер 5 с'], ['lsn', 'ждать LSN']], k => {
      strategy = k;
      const t = {
        any: 'Каждое чтение — на случайную реплику. Можно не увидеть свою запись и даже «откатиться» назад.',
        sticky: 'Ваш пользователь закреплён за r2 (хеш от user_id). Назад во времени не уходит, но свою свежую запись не видит, пока r2 не догонит.',
        leader: `После своей записи ${LEADER_WINDOW} с читаем с лидера, потом — с реплик. Цена: лишняя нагрузка на лидер; окно надо выбрать больше типичного лага.`,
        lsn: 'Клиент хранит LSN своей последней записи (в cookie или токене). Реплика отвечает, только догнав его; не дождались за 1,5 с — идём на лидер.',
      }[k];
      say(t);
    }, strategy);
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: write }, 'Сохранить имя'),
        h('button', { class: 'btn', onclick: read }, 'Открыть профиль'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      stratSeg,
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Лаг r2'), lagIn, lagOut),
      nodesEl, screen, stats, logEl,
    );

    function reset() {
      now = 0; log = [{ lsn: 100, name: NAMES[0], t: -100 }]; nextName = 1; lastWrite = -100; myLsn = 100; lastSeen = 100; pending = null;
      st = { reads: 0, stale: 0, back: 0, leader: 0 }; flash = null;
      screen.innerHTML = '<span class="label">Профиль ещё не открывали</span>';
      say('Лидер принимает запись, r1 отстаёт на 0,3 с, r2 — на сколько выставите.');
      render();
    }
    const applied = lag => { let v = log[0]; for (const e of log) if (e.t <= now - lag) v = e; return v; };
    const nodeState = name => name === 'лидер' ? log[log.length - 1] : applied(name === 'r1' ? R1_LAG : r2lag);
    function write() {
      const e = { lsn: log[log.length - 1].lsn + 1, name: NAMES[nextName++ % NAMES.length], t: now };
      log.push(e);
      lastWrite = now; myLsn = e.lsn;
      flash = 'лидер';
      say(`Записали «${e.name}» в лидер, LSN ${e.lsn}. Реплики получат её через 0,3 и ${dec(r2lag)} с.`);
      render();
    }
    function read() {
      if (pending) return;
      let node;
      if (strategy === 'any') node = Math.random() < 0.5 ? 'r1' : 'r2';
      else if (strategy === 'sticky') node = 'r2';
      else if (strategy === 'leader') node = now - lastWrite < LEADER_WINDOW ? 'лидер' : (Math.random() < 0.5 ? 'r1' : 'r2');
      else node = Math.random() < 0.5 ? 'r1' : 'r2';
      if (strategy === 'lsn' && nodeState(node).lsn < myLsn) {
        pending = { node, since: now };
        screen.innerHTML = `<span class="label">${node} ещё на LSN ${nodeState(node).lsn} &lt; ${myLsn} — ждём…</span>`;
        flash = node;
        render();
        return;
      }
      finish(node, 0);
    }
    const from = n => n === 'лидер' ? 'лидера' : n;
    function finish(node, waited) {
      const e = nodeState(node);
      st.reads++;
      if (node === 'лидер') st.leader++;
      const stale = e.lsn < myLsn, back = e.lsn < lastSeen;
      if (stale) st.stale++;
      if (back) st.back++;
      lastSeen = Math.max(lastSeen, e.lsn);
      flash = node;
      screen.innerHTML = `<span class="rw-name">Имя: <b>${e.name}</b></span><span class="rw-tag ${stale ? 'bad' : 'ok'}">${stale ? 'старое!' : 'актуально'}</span><span class="label">прочитано с ${from(node)}, LSN ${e.lsn}</span>`;
      const w = waited ? ` (подождали ${dec(waited)} с)` : '';
      if (back) say(`Прочитали с ${from(node)} «${e.name}» — раньше уже видели более новое. Профиль «откатился» назад во времени.`, 'bad');
      else if (stale) say(`Прочитали с ${from(node)} «${e.name}», а вы только что сохранили «${log[log.length - 1].name}». Нарушено чтение своих записей.`, 'bad');
      else say(`Прочитали с ${from(node)}${w}: «${e.name}» — ваша последняя запись видна.`, 'ok');
      render();
    }
    function render() {
      const top = log[log.length - 1].lsn;
      nodesEl.innerHTML = ['лидер', 'r1', 'r2'].map(n => {
        const e = nodeState(n);
        const lag = n === 'лидер' ? 'запись сюда' : n === 'r1' ? 'лаг 0,3 с' : `лаг ${dec(r2lag)} с`;
        return `<div class="rw-node ${n === 'лидер' ? 'ldr' : ''} ${flash === n ? 'flash' : ''} ${e.lsn < top ? 'behind' : ''}">` +
          `<b>${n}</b><span class="rw-v">${e.name}</span><span class="label">LSN ${e.lsn} · ${lag}</span></div>`;
      }).join('');
      stats.innerHTML =
        `<div class="stat ${st.stale ? 'warn' : ''}"><b>${st.stale} / ${st.reads}</b><span>чтений не увидели свою запись</span></div>` +
        `<div class="stat ${st.back ? 'warn' : ''}"><b>${st.back}</b><span>откатов назад</span></div>` +
        `<div class="stat"><b>${st.leader}</b><span>чтений с лидера</span></div>`;
    }
    reset();
    let acc = 0;
    return rafLoop(dt => {
      now += dt;
      if (pending) {
        const e = nodeState(pending.node);
        if (e.lsn >= myLsn) { const p = pending; pending = null; finish(p.node, now - p.since); }
        else if (now - pending.since > LSN_TIMEOUT) { const p = pending; pending = null; say(`${p.node} не догнала за 1,5 с — читаем с лидера.`, 'warn'); finish('лидер', now - p.since); return; }
      }
      acc += dt;
      if (acc > 0.1) { acc = 0; render(); }
    });
  });

  // ---------------------------------------------------------------- split brain
  Deck.demo('splitbrain', root => {
    let safe = false, split, nodes, seq, lost;
    const view = h('div', { class: 'sb' });
    const logEl = logBox();
    const say = logger(logEl);
    const modeSeg = seg([['naive', 'без защиты'], ['safe', 'кворум + эпохи']], k => { safe = k === 'safe'; reset(); }, 'naive');
    const splitBtn = h('button', { class: 'btn danger', onclick: toggleSplit }, 'Разрезать сеть');
    root.append(
      modeSeg,
      view,
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => write('X') }, 'Клиент X пишет'),
        h('button', { class: 'btn primary', onclick: () => write('Y') }, 'Клиент Y пишет'),
        splitBtn,
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      logEl,
    );
    function reset() {
      split = false; seq = 0; lost = 0;
      nodes = { A: { role: 'leader', term: 1, log: [] }, B: { role: 'follower', term: 1, log: [] }, C: { role: 'follower', term: 1, log: [] } };
      splitBtn.textContent = 'Разрезать сеть';
      say(safe ? 'Лидер A держит аренду, пока его слышит большинство: он сам и хотя бы один из B, C.'
        : 'Наивная схема: сторож пингует лидера и, если тот пропал, повышает реплику.');
      render();
    }
    const side = n => !split ? ['A', 'B', 'C'] : n === 'A' ? ['A'] : ['B', 'C'];
    function toggleSplit() {
      if (!split) {
        split = true;
        splitBtn.textContent = 'Восстановить сеть';
        if (nodes.A.role !== 'leader') {
          say('A — реплика, её изоляция лидерство не меняет. Клиенту X просто некуда писать.', 'warn');
        } else {
          const t = nodes.A.term + 1;
          nodes.B.role = 'leader'; nodes.B.term = t; nodes.C.term = t;
          if (safe) {
            nodes.A.role = 'stepped';
            say(`B и C — большинство: выбрали B лидером эпохи ${t}. A не продлил аренду (большинства не слышно) и сам перестал быть лидером.`, 'ok');
          } else {
            say('Сторож на стороне B не видит A и повышает B. Но A жив и всё ещё считает себя лидером. Лидеров два.', 'bad');
          }
        }
      } else {
        split = false;
        splitBtn.textContent = 'Разрезать сеть';
        // A rejoins: the newer term wins; entries A accepted alone are thrown away.
        const mine = nodes.A.log.filter(e => e.div && !e.lost);
        mine.forEach(e => { e.lost = true; });
        lost += mine.length;
        nodes.A.role = 'follower'; nodes.A.term = nodes.B.term;
        const known = new Set(nodes.A.log.map(e => e.id));
        nodes.A.log = nodes.A.log.filter(e => !e.lost).concat(mine, nodes.B.log.filter(e => !known.has(e.id)).map(e => ({ ...e })));
        if (mine.length) say(`Связь вернулась. У B эпоха новее, A становится репликой и отбрасывает расходящийся хвост: ${mine.length} ${plural(mine.length, ['запись', 'записи', 'записей'])}, которые клиент X считал сохранёнными, потеряны.`, 'bad');
        else say(`Связь вернулась. A видит эпоху ${nodes.B.term}, становится репликой B и догоняет журнал. Подтверждённого ничего не потеряно.`, 'ok');
      }
      render();
    }
    function write(client) {
      const target = client === 'X' ? 'A' : (split ? 'B' : leader());
      const n = nodes[target];
      if (n.role !== 'leader') {
        say(`Клиент ${client} → ${target}: отказ, «я не лидер и не вижу большинства». Клиенту X ошибка — зато ничего не разъедется.`, 'warn');
        return;
      }
      const e = { id: ++seq, by: client, term: n.term, div: split && target === 'A' };
      side(target).forEach(k => nodes[k].log.push({ ...e }));
      say(`Клиент ${client} → ${target} (эпоха ${n.term}): запись №${e.id} подтверждена${split ? ` на ${side(target).join(', ')}` : ' на всех узлах'}.`, split && !safe && client === 'X' ? 'warn' : '');
      render();
    }
    function leader() { return ['A', 'B', 'C'].find(k => nodes[k].role === 'leader'); }
    function render() {
      const roleTxt = { leader: 'лидер', follower: 'реплика', stepped: 'не лидер: нет кворума' };
      const card = k => {
        const n = nodes[k];
        return `<div class="sb-node ${n.role}"><div class="sb-h"><b>${k}</b><span>${roleTxt[n.role]}</span><span class="label">эпоха ${n.term}</span></div>` +
          `<div class="sb-log">${n.log.length ? n.log.map(e => `<i class="${e.by}${e.lost ? ' lost' : ''}">${e.id}</i>`).join('') : '<span class="label">журнал пуст</span>'}</div></div>`;
      };
      view.innerHTML = `<div class="sb-side">${card('A')}<span class="sb-cl">клиент X</span></div>` +
        `<div class="sb-cut ${split ? 'on' : ''}"><span>${split ? 'разрыв' : ''}</span></div>` +
        `<div class="sb-side">${card('B')}${card('C')}<span class="sb-cl">клиент Y</span></div>`;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- quorums
  Deck.demo('quorum', root => {
    let N = 3, W = 2, R = 2, nodes, latest, mark;
    const sl = (label, min, max, val, on) => {
      const out = h('output', null, val);
      const input = h('input', { type: 'range', min, max, value: val, 'aria-label': label });
      input.addEventListener('input', () => { out.textContent = input.value; on(+input.value); });
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label q-l' }, label), input, out));
      return { input, out };
    };
    const sN = sl('N реплик', 3, 7, N, v => { N = v; clamp(); reset(); });
    const sW = sl('W запись', 1, N, W, v => { W = v; info(); });
    const sR = sl('R чтение', 1, N, R, v => { R = v; info(); });
    const ring = h('div', { class: 'q-nodes' });
    const rule = h('div', { class: 'q-rule' });
    const logEl = logBox();
    const say = logger(logEl);
    root.append(
      ring, rule,
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: write }, 'Записать'),
        h('button', { class: 'btn primary', onclick: read }, 'Прочитать'),
        h('button', { class: 'btn', onclick: repair }, 'Фоновая сверка'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      logEl,
    );
    function clamp() {
      for (const s of [sW, sR]) { s.input.max = N; if (+s.input.value > N) s.input.value = N; s.out.textContent = s.input.value; }
      W = +sW.input.value; R = +sR.input.value;
    }
    function reset() {
      nodes = Array.from({ length: N }, () => ({ v: 1, down: false }));
      latest = 1; mark = {};
      say('Все реплики хранят v1. Нажмите на узел, чтобы уронить его или поднять.');
      render();
    }
    const alive = () => nodes.map((n, i) => i).filter(i => !nodes[i].down);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    function write() {
      const a = alive();
      if (a.length < W) { mark = {}; say(`Живых реплик ${a.length}, а нужно W = ${W}: координатор сразу отказывает (Unavailable).`, 'bad'); render(); return; }
      latest++;
      const got = shuffle(a).slice(0, W);
      got.forEach(i => { nodes[i].v = latest; });
      mark = { w: new Set(got) };
      const rest = a.length - W;
      say(`v${latest} подтвердили ${W} из ${N}.` + (rest ? ` Ещё ${rest} ${plural(rest, ['живой реплике', 'живым репликам', 'живым репликам'])} запись в пути — считаем, что пока не дошла.` : '') +
        (a.length < N ? ' Упавшие получат её позже (hinted handoff, сверка).' : ''));
      render();
    }
    function read() {
      const a = alive();
      if (a.length < R) { mark = {}; say(`Живых реплик ${a.length}, а нужно R = ${R}: чтение отказано.`, 'bad'); render(); return; }
      const got = shuffle(a).slice(0, R);
      const best = Math.max(...got.map(i => nodes[i].v));
      const fixed = got.filter(i => nodes[i].v < best);
      fixed.forEach(i => { nodes[i].v = best; });
      mark = { r: new Set(got) };
      const rr = fixed.length ? ` Read repair обновил ${fixed.length} ${plural(fixed.length, ['реплику', 'реплики', 'реплик'])}.` : '';
      if (best < latest) say(`Опросили ${R}: самая свежая — v${best}, а подтверждена уже v${latest}. Устаревшее чтение: множества не пересеклись.${rr}`, 'bad');
      else say(`Опросили ${R}, нашли v${best} — последнюю запись.${rr}`, 'ok');
      render();
    }
    function repair() {
      alive().forEach(i => { nodes[i].v = latest; });
      mark = {};
      say('Anti-entropy: живые реплики сравнили деревья Меркла и догнались до последней версии.');
      render();
    }
    function comb(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
    function info() {
      const a = alive(), fresh = a.filter(i => nodes[i].v === latest).length, stale = a.length - fresh;
      const ok = W + R > N;
      const p = a.length >= R ? comb(stale, R) / comb(a.length, R) : null;
      rule.className = 'q-rule ' + (ok ? 'ok' : 'bad');
      rule.innerHTML = `<div><b>W + R = ${W + R} ${ok ? '&gt;' : '≤'} N = ${N}</b> — ${ok ? 'чтение всегда пересечётся с последней записью' : 'чтение может не застать последнюю запись'}</div>` +
        `<span>Запись переживёт ${N - W} ${plural(N - W, ['отказ', 'отказа', 'отказов'])}, чтение — ${N - R}. ` +
        (p == null ? 'Сейчас чтение невозможно.' : `Шанс прочитать старое прямо сейчас: ${Math.round(p * 100)}%.`) + '</span>';
    }
    function render() {
      ring.innerHTML = '';
      nodes.forEach((n, i) => {
        const cls = ['q-node', n.down ? 'down' : n.v === latest ? 'fresh' : 'stale',
          mark.w && mark.w.has(i) ? 'w' : '', mark.r && mark.r.has(i) ? 'r' : ''].join(' ');
        ring.append(h('button', {
          class: cls, 'aria-label': `Узел ${i + 1}`,
          onclick: () => { n.down = !n.down; mark = {}; say(n.down ? `Узел ${i + 1} упал.` : `Узел ${i + 1} поднялся — с той версией, что была.`); render(); },
        }, h('b', null, 'n' + (i + 1)), h('span', null, n.down ? '×' : 'v' + n.v)));
      });
      info();
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- conflicts: LWW, version vectors, CRDT
  Deck.demo('conflict', root => {
    let strat = 'lww', skew = 0, eu, us, order, merged;
    const view = h('div', { class: 'cf' });
    const logEl = logBox();
    const say = logger(logEl, 2);
    const stratSeg = seg([['lww', 'LWW'], ['vv', 'векторы версий'], ['crdt', 'CRDT: OR-Set']], k => { strat = k; reset(); }, strat);
    const skewOut = h('output');
    const skewIn = h('input', { type: 'range', min: -100, max: 100, step: 10, value: 0, 'aria-label': 'Сдвиг часов США' });
    const setSkew = () => { skew = +skewIn.value; skewOut.textContent = (skew > 0 ? '+' : '') + skew + ' мс'; };
    skewIn.addEventListener('input', () => { setSkew(); render(); });
    setSkew();
    const skewRow = h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Часы США'), skewIn, skewOut);
    const euBtn = h('button', { class: 'btn', onclick: () => op('eu') }, 'Европа: −молоко +книга');
    const usBtn = h('button', { class: 'btn', onclick: () => op('us') }, 'США: +чайник');
    const syncBtn = h('button', { class: 'btn primary', onclick: sync }, 'Синхронизировать');
    root.append(stratSeg, skewRow, h('div', { class: 'controls' }, euBtn, usBtn, syncBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')), view, logEl);

    const tag = (item, t) => ({ item, t });
    function reset() {
      const base = () => ({ items: [tag('молоко', 'a')], removed: [], ts: 0, vv: { EU: 0, US: 0 }, touched: false });
      eu = base(); us = base(); order = []; merged = null;
      euBtn.disabled = usBtn.disabled = false;
      skewRow.hidden = strat !== 'lww';
      say({
        lww: 'Каждая запись — вся корзина с меткой времени узла. При слиянии остаётся версия с большей меткой.',
        vv: 'У каждой версии вектор счётчиков {EU, US}. Если ни один вектор не больше другого — записи параллельны, сохраняем обе.',
        crdt: 'Каждое добавление получает уникальную метку; удаление удаляет только те метки, что видело. Слияние — объединение.',
      }[strat]);
      render();
    }
    function op(who) {
      const r = who === 'eu' ? eu : us;
      const realT = order.length ? 40 : 0; // the second operation really happens 40 ms later
      order.push(who);
      r.touched = true;
      r.ts = 1000 + realT + (who === 'us' ? skew : 0);
      r.vv[who === 'eu' ? 'EU' : 'US']++;
      if (who === 'eu') {
        r.removed.push(...r.items.filter(x => x.item === 'молоко').map(x => x.t));
        r.items = r.items.filter(x => x.item !== 'молоко');
        r.items.push(tag('книга', 'b'));
      } else r.items.push(tag('чайник', 'c'));
      (who === 'eu' ? euBtn : usBtn).disabled = true;
      merged = null;
      say(`${who === 'eu' ? 'Европа' : 'США'} записали локально${order.length === 2 ? ', на 40 мс позже первой записи' : ''}. Реплики ещё не обменялись изменениями.`);
      render();
    }
    function sync() {
      if (!order.length) { say('Пока нечего синхронизировать — сделайте хотя бы одно изменение.'); return; }
      const names = r => r.items.map(x => x.item);
      if (order.length === 1) {
        const src = order[0] === 'eu' ? eu : us;
        merged = { list: [names(src)], note: 'одна версия новее другой' };
        say('Изменение было только с одной стороны: её версия строго новее, конфликта нет.', 'ok');
      } else if (strat === 'lww') {
        const win = eu.ts >= us.ts ? 'eu' : 'us';
        const later = order[1];
        merged = { list: [names(win === 'eu' ? eu : us)] };
        const lostTxt = win === 'eu' ? 'чайник пропал' : 'молоко вернулось, книга пропала';
        say(`Метки: Европа ${eu.ts}, США ${us.ts}. Победила ${win === 'eu' ? 'Европа' : 'США'} — ${lostTxt}.` +
          (win !== later ? ' Причём реально позже писали другие: часы США отстают.' : ' Изменение второй стороны молча потеряно.'), 'bad');
      } else if (strat === 'vv') {
        const sib = [names(eu), names(us)];
        const union = [...new Set(sib.flat())];
        merged = { list: sib, union };
        say(`Векторы {EU:1, US:0} и {EU:0, US:1} несравнимы — записи параллельны, клиент получает обе версии. Наивное объединение даёт {${union.join(', ')}}: удалённое молоко воскресло (как в корзине Amazon из статьи про Dynamo).`, 'warn');
      } else {
        const removed = new Set([...eu.removed, ...us.removed]);
        const all = [...eu.items, ...us.items].filter(x => !removed.has(x.t));
        const list = [...new Map(all.map(x => [x.t, x.item])).values()];
        merged = { list: [list] };
        say(`Слияние: добавления {книга#b, чайник#c, молоко#a} минус удалённые метки {#a} = ${list.join(', ')}. Ничего не потеряно и не воскресло.`, 'ok');
      }
      render();
    }
    function render() {
      const meta = (r, who) => strat === 'lww' ? `метка ${r.ts || 0}` : strat === 'vv' ? `{EU:${r.vv.EU}, US:${r.vv.US}}` :
        `метки: ${r.items.map(x => x.item + '#' + x.t).join(', ')}${r.removed.length ? '; удалены #' + r.removed.join(', #') : ''}`;
      const box = (r, who, title) => `<div class="cf-rep ${r.touched ? 'touched' : ''}"><b>${title}</b>` +
        `<div class="cf-items">${r.items.map(x => `<span class="cf-it">${x.item}</span>`).join('') || '<span class="label">пусто</span>'}</div>` +
        `<span class="label">${meta(r, who)}</span></div>`;
      let out = '';
      if (merged) {
        out = `<div class="cf-merged"><b>После синхронизации</b>` + merged.list.map((l, i) =>
          `<div class="cf-items">${merged.list.length > 1 ? `<span class="label">версия ${i + 1}:</span>` : ''}${l.map(x => `<span class="cf-it">${x}</span>`).join('')}</div>`).join('') +
          (merged.union ? `<div class="cf-items"><span class="label">приложение слило:</span>${merged.union.map(x => `<span class="cf-it ${x === 'молоко' ? 'zombie' : ''}">${x}</span>`).join('')}</div>` : '') + '</div>';
      }
      view.innerHTML = `<div class="cf-reps">${box(eu, 'eu', 'Европа')}${box(us, 'us', 'США')}</div>${out}`;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- CAP / PACELC
  Deck.demo('cap', root => {
    const RTTS = [1, 10, 40, 80, 150];
    const LOCAL = 0.5;
    let cp = true, part = false, rtt = 80, vals, ver;
    const view = h('div', { class: 'cp' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl);
    const modeSeg = seg([['cp', 'CP: кворум'], ['ap', 'AP: локальная реплика']], k => { cp = k === 'cp'; reset(); }, 'cp');
    const rttOut = h('output');
    const rttIn = h('input', { type: 'range', min: 0, max: RTTS.length - 1, value: 3, 'aria-label': 'RTT между ДЦ' });
    const setRtt = () => { rtt = RTTS[+rttIn.value]; rttOut.textContent = rtt + ' мс'; };
    rttIn.addEventListener('input', () => { setRtt(); render(); });
    setRtt();
    const partBtn = h('button', { class: 'btn danger', onclick: togglePart }, 'Разрыв между ДЦ');
    root.append(
      modeSeg,
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'RTT A ↔ B'), rttIn, rttOut),
      view, stats,
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => write('A') }, 'Клиент в A пишет'),
        h('button', { class: 'btn primary', onclick: () => write('B') }, 'Клиент в B пишет'),
        h('button', { class: 'btn', onclick: () => read('B') }, 'Клиент в B читает'),
        partBtn),
      logEl,
    );
    function reset() {
      vals = { n1: 1, n2: 1, n3: 1 }; ver = 1; part = false;
      partBtn.textContent = 'Разрыв между ДЦ';
      say(cp ? 'CP: запись и чтение подтверждает большинство (2 из 3). Большинство живёт в ДЦ A.'
        : 'AP: каждый пишет и читает в ближайшую реплику, остальные получают изменения асинхронно.');
      render();
    }
    function togglePart() {
      part = !part;
      partBtn.textContent = part ? 'Восстановить связь' : 'Разрыв между ДЦ';
      if (!part) {
        const diverged = vals.n3 !== vals.n1;
        if (cp) { vals.n3 = vals.n1; say('Связь есть. n3 догнала большинство — расходиться было нечему.', 'ok'); }
        else if (diverged) {
          const win = Math.max(vals.n1, vals.n3);
          say(`Связь есть, а значения разные: A — x=${vals.n1}, B — x=${vals.n3}. Нужна стратегия слияния; с LWW останется x=${win}, вторая запись пропадёт.`, 'warn');
          vals.n1 = vals.n2 = vals.n3 = win;
        } else { vals.n3 = vals.n1; say('Связь есть, реплики обменялись изменениями.', 'ok'); }
      } else say('ДЦ B отрезан. n3 видит только себя.', 'warn');
      render();
    }
    function write(dc) {
      if (cp) {
        if (dc === 'B' && part) { say('Клиент в B: до большинства не достучаться — запись отклонена по таймауту. Это и есть «C, а не A».', 'bad'); return; }
        ver++;
        vals.n1 = vals.n2 = ver;
        if (!part) vals.n3 = ver;
        say(`x=${ver} подтверждено большинством за ${ms(dc === 'A' ? LOCAL : rtt + LOCAL)}${dc === 'B' ? ' — клиенту в B пришлось сходить в другой ДЦ' : ''}.`, 'ok');
      } else {
        ver++;
        if (dc === 'A') { vals.n1 = vals.n2 = ver; if (!part) vals.n3 = ver; }
        else { vals.n3 = ver; if (!part) vals.n1 = vals.n2 = ver; }
        say(`x=${ver} принято локальной репликой за ${ms(LOCAL)}.` + (part ? ' Другой ДЦ об этом не знает — реплики разошлись.' : ` Остальные узнают через ~${ms(rtt / 2)}.`), part ? 'warn' : 'ok');
      }
      render();
    }
    function read(dc) {
      if (cp) {
        if (part) { say('Клиент в B: кворумное чтение невозможно — отказ. Зато не будет устаревших данных.', 'bad'); return; }
        say(`Прочитано x=${vals.n1} кворумом за ${ms(rtt + LOCAL)} — гарантированно последнее значение.`, 'ok');
      } else {
        const stale = vals.n3 !== Math.max(vals.n1, vals.n3);
        say(`Прочитано x=${vals.n3} с n3 за ${ms(LOCAL)}.` + (stale ? ` В ДЦ A уже x=${vals.n1} — данные устарели.` : ''), stale ? 'warn' : 'ok');
      }
    }
    function render() {
      const node = n => `<span class="cp-node ${vals[n] !== ver ? 'old' : ''}"><b>${n}</b>x=${vals[n]}</span>`;
      view.innerHTML = `<div class="cp-dc"><span class="label">ДЦ A</span>${node('n1')}${node('n2')}</div>` +
        `<div class="cp-link ${part ? 'cut' : ''}"><span>${part ? '✕' : rtt + ' мс'}</span></div>` +
        `<div class="cp-dc"><span class="label">ДЦ B</span>${node('n3')}</div>`;
      const wB = cp ? (part ? 'отказ' : ms(rtt + LOCAL)) : ms(LOCAL);
      stats.innerHTML =
        `<div class="stat"><b>${ms(LOCAL)}</b><span>запись из A</span></div>` +
        `<div class="stat ${cp && (part || rtt > 20) ? 'warn' : ''}"><b>${wB}</b><span>запись из B</span></div>` +
        `<div class="stat ${!cp && vals.n1 !== vals.n3 ? 'warn' : ''}"><b>${!cp && vals.n1 !== vals.n3 ? 'расходятся' : 'совпадают'}</b><span>реплики</span></div>`;
    }
    reset();
    return {};
  });
})();

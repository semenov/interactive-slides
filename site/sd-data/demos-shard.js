// Demos for slides 11–19: range vs hash partitioning and hot keys, resharding, 2PC, Snowflake IDs,
// sequential vs random keys in a B-tree.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
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
    return wrap;
  };
  // 32-bit FNV-1a with a murmur3 finaliser: cheap and well mixed.
  function hash32(str) {
    let x = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193); }
    x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
    return x >>> 0;
  }
  const COLORS = ['#5f3dc4', '#00a29c', '#e8590c', '#1c7ed6', '#c2255c', '#5c940d', '#f59f00', '#495057', '#9c36b5', '#0b7285'];

  // ---------------------------------------------------------------- range vs hash, hot keys
  Deck.demo('partition', root => {
    const S = 4, TOTAL = 32000, CAP = 12000, MAXID = 1000000, CELEB = 777737;
    let wl = 'users', strat = 'range', load = new Array(S).fill(TOTAL / S), acc = 0;
    const bars = h('div', { class: 'pt-bars' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl);
    const WL = {
      users: ['Профили по user_id', 'запрос user_id 1000–2000'],
      time: ['События по времени', 'запрос «за последний час»'],
      celeb: ['Знаменитость: 50% запросов к одному ключу', 'все посты знаменитости'],
    };
    root.append(
      seg(Object.entries(WL).map(([k, v]) => [k, v[0]]), k => { wl = k; explain(); }, wl),
      seg([['range', 'по диапазону'], ['hash', 'по хешу'], ['salt', 'хеш + соль']], k => { strat = k; explain(); }, strat),
      bars, stats,
      h('div', { class: 'controls' }, h('button', { class: 'btn', onclick: rangeQuery }, 'Выполнить запрос по диапазону')),
      logEl,
    );
    const rangeShard = id => Math.min(S - 1, Math.floor(id / (MAXID / S)));
    // Time-range shards: Q1..Q4 of the year; "now" is in Q4.
    function shardOf(req) {
      if (wl === 'time') return strat === 'range' ? S - 1 : hash32('ev:' + req.id) % S;
      if (wl === 'celeb' && req.id === CELEB && strat === 'salt') return hash32('user:' + CELEB + '#' + req.salt) % S;
      return strat === 'range' ? rangeShard(req.id) : hash32('user:' + req.id) % S;
    }
    function sample() {
      const c = new Array(S).fill(0), n = 400;
      for (let i = 0; i < n; i++) {
        const celeb = wl === 'celeb' && Math.random() < 0.5;
        const req = { id: celeb ? CELEB : Math.floor(Math.random() * MAXID), salt: Math.floor(Math.random() * 8) };
        if (wl === 'time') req.id = Date.now() * 1000 + i;
        c[shardOf(req)]++;
      }
      return c.map(x => (x / n) * TOTAL);
    }
    function explain() {
      const t = {
        'users:range': 'id распределены равномерно — диапазоны нагружены ровно.',
        'users:hash': 'Хеш перемешал ключи — нагрузка ровная.',
        'users:salt': 'Горячих ключей нет — соль ничего не меняет, кроме усложнения.',
        'time:range': 'Все новые события попадают в последний диапазон — шард 4 перегружен, остальные простаивают.',
        'time:hash': 'Хеш от id события раскидывает запись ровно — но «за последний час» придётся спрашивать все шарды.',
        'time:salt': 'Соль нужна только горячим ключам; для потока событий хватает хеша.',
        'celeb:range': 'Ключ знаменитости живёт в одном шарде — половина всего трафика туда.',
        'celeb:hash': 'Хеш не помогает: один ключ — один шард, как его ни хешируй.',
        'celeb:salt': 'Запись знаменитости разложена на 8 подключей user:777737#0..7 — нагрузка разошлась. Чтение её постов теперь собирает 8 кусков.',
      }[wl + ':' + strat];
      const warn = (wl === 'time' && strat === 'range') || (wl === 'celeb' && strat !== 'salt');
      say(t, warn ? 'bad' : '');
    }
    function rangeQuery() {
      let n, why;
      if (wl === 'users') { n = strat === 'range' ? 1 : S; why = strat === 'range' ? 'диапазон целиком в шарде 1' : 'соседние id разбросаны хешем'; }
      else if (wl === 'time') { n = strat === 'range' ? 1 : S; why = strat === 'range' ? 'последний час — в последнем диапазоне' : 'события часа разбросаны хешем'; }
      else { n = strat === 'salt' ? S : 1; why = strat === 'salt' ? 'нужно собрать все 8 подключей' : 'всё лежит под одним ключом'; }
      say(`${WL[wl][1]}: ${n} ${plural(n, ['шард', 'шарда', 'шардов'])} — ${why}.${n > 1 ? ' Ответ ждёт самый медленный шард.' : ''}`, n > 1 ? 'warn' : 'ok');
    }
    function render() {
      const max = Math.max(...load);
      const capPct = (CAP / (TOTAL * 0.75)) * 100;
      bars.innerHTML = load.map((v, i) =>
        `<div class="pt-col"><span class="pt-n">${fmt(v / 1000)} тыс./с</span><div class="pt-track"><i class="pt-cap" style="bottom:${capPct}%"></i>` +
        `<div class="pt-bar ${v > CAP ? 'over' : ''}" style="height:${Math.min(100, (v / (TOTAL * 0.75)) * 100)}%"></div></div>` +
        `<span class="label">шард ${i + 1}</span></div>`).join('');
      const avg = TOTAL / S;
      stats.innerHTML = `<div class="stat ${max > CAP ? 'warn' : ''}"><b>${fmt(max)}</b><span>запросов/с на самом горячем шарде</span></div>` +
        `<div class="stat ${max / avg > 1.5 ? 'warn' : ''}"><b>×${dec(max / avg)}</b><span>перекос от среднего</span></div>` +
        `<div class="stat"><b>${fmt(TOTAL)}</b><span>запросов/с всего</span></div>`;
    }
    explain();
    render();
    return rafLoop(dt => {
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      const s = sample();
      load = load.map((v, i) => v * 0.5 + s[i] * 0.5);
      render();
    });
  });

  // ---------------------------------------------------------------- resharding: mod N vs consistent hashing
  Deck.demo('rehash', root => {
    const K = 3000, SHOW = 160, VN = 64;
    const keys = Array.from({ length: K }, (_, i) => hash32('key:' + i));
    let mode = 'mod', ids, owner, moved = null;
    const ringEl = h('div', { class: 'rh-ring' });
    const grid = h('div', { class: 'rh-grid' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl);
    const addBtn = h('button', { class: 'btn primary', onclick: () => change(+1) }, 'Добавить шард');
    const delBtn = h('button', { class: 'btn', onclick: () => change(-1) }, 'Убрать шард');
    root.append(
      seg([['mod', 'hash % N'], ['ring', 'кольцо'], ['vnodes', `кольцо + ${VN} вирт. узла`]], k => { mode = k; reset(); }, mode),
      h('div', { class: 'rh-view' }, ringEl, grid),
      stats,
      h('div', { class: 'controls' }, addBtn, delBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      logEl,
    );
    function points(list) {
      const pts = [];
      for (const id of list) {
        const n = mode === 'vnodes' ? VN : 1;
        for (let v = 0; v < n; v++) pts.push([hash32(`shard-${id}#${v}`), id]);
      }
      return pts.sort((a, b) => a[0] - b[0]);
    }
    function assign(list) {
      if (mode === 'mod') return keys.map(k => list[k % list.length]);
      const pts = points(list);
      return keys.map(k => {
        let lo = 0, hi = pts.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] < k) lo = m + 1; else hi = m; }
        return pts[lo === pts.length ? 0 : lo][1];
      });
    }
    function reset() {
      ids = [0, 1, 2, 3];
      owner = assign(ids);
      moved = null;
      say(mode === 'mod' ? 'Шард = hash(key) % N. Пока N не меняется — всё прекрасно.'
        : mode === 'ring' ? 'Каждый шард — одна точка на кольце; ключ принадлежит ближайшему шарду по часовой.'
          : `Каждый шард — ${VN} точек на кольце: дуги мельче, нагрузка ровнее, а при добавлении шард забирает понемногу у всех.`);
      render();
    }
    function change(d) {
      const next = d > 0 ? [...ids, Math.max(...ids) + 1] : ids.slice(0, -1);
      if (next.length < 2 || next.length > 10) return;
      const o2 = assign(next);
      moved = o2.map((s, i) => s !== owner[i]);
      const m = moved.filter(Boolean).length;
      const ideal = d > 0 ? 1 / next.length : 1 / ids.length;
      ids = next; owner = o2;
      say(`${d > 0 ? 'Добавили' : 'Убрали'} шард, теперь их ${ids.length}. Переехало ${dec((m / K) * 100, 0)}% ключей; необходимый минимум — ${dec(ideal * 100, 0)}%.`,
        m / K > ideal * 1.6 ? 'bad' : 'ok');
      render();
    }
    function render() {
      addBtn.disabled = ids.length >= 10; delBtn.disabled = ids.length <= 2;
      grid.innerHTML = owner.slice(0, SHOW).map((s, i) =>
        `<i class="${moved && moved[i] ? 'mv' : ''}" style="background:${COLORS[s % COLORS.length]}"></i>`).join('');
      const cnt = new Map(ids.map(id => [id, 0]));
      owner.forEach(s => cnt.set(s, cnt.get(s) + 1));
      const vals = [...cnt.values()], avg = K / ids.length;
      const mv = moved ? moved.filter(Boolean).length : 0;
      stats.innerHTML = `<div class="stat"><b>${ids.length}</b><span>шардов</span></div>` +
        `<div class="stat ${moved && mv / K > 0.5 ? 'warn' : ''}"><b>${moved ? dec((mv / K) * 100, 0) + '%' : '—'}</b><span>ключей переехало</span></div>` +
        `<div class="stat ${Math.max(...vals) / avg > 1.5 ? 'warn' : ''}"><b>×${dec(Math.max(...vals) / avg)}</b><span>самый нагруженный от среднего</span></div>`;
      ringEl.hidden = mode === 'mod';
      if (mode === 'mod') { ringEl.innerHTML = ''; return; }
      const R = 46, C = 60, pos = v => { const a = (v / 2 ** 32) * 2 * Math.PI - Math.PI / 2; return [C + R * Math.cos(a), C + R * Math.sin(a)]; };
      let svg = `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--line)" stroke-width="2"/>`;
      for (let i = 0; i < SHOW; i++) {
        const [x, y] = pos(keys[i]);
        const rr = R - 7, a = (keys[i] / 2 ** 32) * 2 * Math.PI - Math.PI / 2;
        svg += `<circle cx="${C + rr * Math.cos(a)}" cy="${C + rr * Math.sin(a)}" r="1.4" fill="${COLORS[owner[i] % COLORS.length]}" ${moved && moved[i] ? 'stroke="var(--ink)" stroke-width="0.8"' : ''}/>`;
        void x; void y;
      }
      for (const [v, id] of points(ids)) {
        const [x, y] = pos(v);
        svg += mode === 'vnodes' ? `<circle cx="${x}" cy="${y}" r="1.8" fill="${COLORS[id % COLORS.length]}"/>`
          : `<circle cx="${x}" cy="${y}" r="4.5" fill="${COLORS[id % COLORS.length]}" stroke="#fff" stroke-width="1.2"/>`;
      }
      ringEl.innerHTML = svg + '</svg>';
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- two-phase commit
  Deck.demo('twopc', root => {
    let sc = 'ok', step, held, timer, running;
    const view = h('div', { class: 'tp' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl, 2);
    const nextBtn = h('button', { class: 'btn primary', onclick: next }, 'Следующий шаг');
    root.append(
      seg([['ok', 'без сбоев'], ['no', 'платежи говорят «нет»'], ['crash', 'координатор падает']], k => { sc = k; reset(); }, sc),
      view, stats,
      h('div', { class: 'controls' }, nextBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      logEl,
    );
    // Node state per step: [coordinator, orders, payments]
    function states() {
      const s = [['готовит', 'изменения сделаны', 'изменения сделаны']];
      s.push(['PREPARE →', 'prepared, fsync · «да»', sc === 'no' ? 'нет денег · «нет»' : 'prepared, fsync · «да»']);
      if (sc === 'crash') {
        s.push(['упал', 'в сомнении', 'в сомнении']);
        s.push(['поднялся, читает журнал: COMMIT →', 'commit', 'commit']);
      } else if (sc === 'no') {
        s.push(['решение ABORT → в журнал', 'ждёт решения', 'откатилась']);
        s.push(['ABORT →', 'откатилась', 'откатилась']);
      } else {
        s.push(['решение COMMIT → в журнал, fsync', 'ждёт решения', 'ждёт решения']);
        s.push(['COMMIT →', 'commit', 'commit']);
      }
      return s;
    }
    const TEXT = {
      ok: [
        'Шаг 0. Транзакция идёт в двух шардах: строки заказа и платежа изменены и заблокированы.',
        'PREPARE: каждый участник сбрасывает изменения на диск и обещает: «смогу закоммитить, даже если упаду». Обещание забрать нельзя.',
        'Все сказали «да». Координатор записывает решение COMMIT в свой журнал — это точка невозврата.',
        'COMMIT разослан, участники фиксируют и отпускают блокировки. Цена: 2 круга по сети и 3 последовательных fsync.',
      ],
      no: [
        'Шаг 0. Транзакция идёт в двух шардах, строки заблокированы.',
        'PREPARE: шард заказов готов, шард платежей отвечает «нет» — например, не прошла проверка.',
        'Хватает одного «нет»: координатор записывает ABORT.',
        'ABORT разослан, оба участника откатились. Атомарность соблюдена.',
      ],
      crash: [
        'Шаг 0. Транзакция идёт в двух шардах, строки заблокированы.',
        'PREPARE: оба участника пообещали закоммитить и ждут решения.',
        'Координатор упал до рассылки решения. Участники в сомнении: откатиться нельзя — вдруг решили COMMIT, закоммитить тоже нельзя. Они держат блокировки, и все, кто ждёт эти строки, стоят.',
        'Координатор поднялся, прочитал решение из журнала и разослал его. Блокировки отпущены — спустя всё время простоя.',
      ],
    };
    function reset() {
      step = 0; held = 0; running = false;
      say(TEXT[sc][0]);
      render();
    }
    function next() {
      if (step >= 3) return;
      step++;
      running = sc === 'crash' && step === 2;
      say(TEXT[sc][step], sc === 'crash' && step === 2 ? 'bad' : step === 3 ? 'ok' : '');
      render();
    }
    function render() {
      const s = states()[step];
      const locked = [step < 3, step < 3 && !(sc === 'no' && step >= 2)];
      const node = (name, st, lk, cls) => `<div class="tp-node ${cls}"><b>${name}</b><span>${st}</span>${lk === undefined ? '' : `<span class="tp-lock ${lk ? 'on' : ''}">${lk ? 'блокировки держит' : 'блокировок нет'}</span>`}</div>`;
      view.innerHTML = node('координатор', s[0], undefined, sc === 'crash' && step === 2 ? 'down' : 'coord') +
        `<div class="tp-parts">${node('шард заказов', s[1], locked[0], '')}${node('шард платежей', s[2], locked[1], sc === 'no' && step >= 1 ? 'no' : '')}</div>`;
      const rounds = Math.min(step, 3) >= 3 ? 2 : step >= 1 ? 1 : 0;
      stats.innerHTML = `<div class="stat"><b>${rounds}</b><span>кругов по сети</span></div>` +
        `<div class="stat ${held > 2 ? 'warn' : ''}"><b>${sc === 'crash' && step >= 2 ? dec(held) + ' с' : '≈ ' + dec([1, 2.5, 3, 4][step]) + ' мс'}</b><span>${sc === 'crash' && step === 2 ? 'блокировки держатся в сомнении' : 'блокировки держатся'}</span></div>` +
        `<div class="stat"><b>${step === 0 ? 0 : step === 1 ? 2 : 3}</b><span>fsync на критическом пути</span></div>`;
      nextBtn.textContent = sc === 'crash' && step === 2 ? 'Поднять координатор' : 'Следующий шаг';
      nextBtn.disabled = step >= 3;
    }
    reset();
    timer = rafLoop(dt => {
      if (!running) return;
      held += dt;
      render();
    });
    return timer;
  });

  // ---------------------------------------------------------------- Snowflake IDs
  Deck.demo('snowflake', root => {
    const EPOCH = 1288834974657n; // Twitter epoch, 2010-11-04
    let worker = 37, lastTs = -1n, seq = 0n, skew = 0;
    const idEl = h('div', { class: 'sf-id' });
    const bitsEl = h('div', { class: 'sf-bits' });
    const fields = h('div', { class: 'sf-fields' });
    const uu = h('div', { class: 'sf-uu' });
    const logEl = logBox();
    const say = logger(logEl);
    const wOut = h('output', null, worker);
    const wIn = h('input', { type: 'range', min: 0, max: 1023, value: worker, 'aria-label': 'Номер узла' });
    wIn.addEventListener('input', () => { worker = +wIn.value; wOut.textContent = worker; });
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => gen(1) }, 'Сгенерировать'),
        h('button', { class: 'btn', onclick: () => gen(10000) }, '10 000 запросов в одну мс'),
        h('button', { class: 'btn danger', onclick: back }, 'Часы назад на 5 с')),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Узел'), wIn, wOut),
      idEl, bitsEl, fields, uu, logEl,
    );
    const nowMs = () => BigInt(Date.now() + skew);
    function make(ts) { return ((ts - EPOCH) << 22n) | (BigInt(worker) << 12n) | seq; }
    function gen(n) {
      let ts = nowMs();
      if (ts < lastTs) {
        say(`Часы показывают на ${fmt(Number(lastTs - ts))} мс меньше, чем при прошлом ID. Генератор отказывается выдавать ID, пока время не догонит: иначе возможны дубликаты. NTP обычно двигает часы плавно, но скачки бывают.`, 'bad');
        return;
      }
      let id, ms = 0;
      for (let i = 0; i < n; i++) {
        if (ts === lastTs) {
          seq = (seq + 1n) & 4095n;
          if (seq === 0n) { ts = lastTs + 1n; ms++; } // sequence exhausted: wait for the next millisecond
        } else seq = 0n;
        lastTs = ts;
        id = make(ts);
      }
      show(id);
      if (n > 1) say(`${fmt(n)} ID в одну миллисекунду: номер в мс 12-битный (до 4096), поэтому генератор ${ms} ${plural(ms, ['раз', 'раза', 'раз'])} дождался следующей миллисекунды. Потолок — ~4 млн ID в секунду на узел.`, 'warn');
      else say('Старшие биты — время, поэтому ID растут: новые строки ложатся в конец индекса, а сортировка по id — это сортировка по времени.', 'ok');
    }
    function back() {
      skew -= 5000;
      say('Часы узла прыгнули на 5 с назад (NTP сделал шаг, ВМ восстановили из снапшота). Сгенерируйте ID в ближайшие 5 секунд.', 'warn');
    }
    function show(id) {
      const b = id.toString(2).padStart(64, '0');
      idEl.innerHTML = `<span class="label">bigint</span><b>${id.toString()}</b>`;
      bitsEl.innerHTML = `<span class="b0">${b[0]}</span><span class="bt">${b.slice(1, 42)}</span><span class="bw">${b.slice(42, 52)}</span><span class="bs">${b.slice(52)}</span>`;
      const ts = (id >> 22n) + EPOCH;
      const d = new Date(Number(ts));
      fields.innerHTML = `<div><span class="sw bt"></span>41 бит · время: <b>${d.toISOString().replace('T', ' ').replace('Z', '')}</b> <span class="label">(мс от 2010 г., хватит на 69 лет)</span></div>` +
        `<div><span class="sw bw"></span>10 бит · узел: <b>${Number((id >> 12n) & 1023n)}</b> <span class="label">(до 1024)</span></div>` +
        `<div><span class="sw bs"></span>12 бит · номер в мс: <b>${Number(id & 4095n)}</b></div>`;
      const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => x.toString(16).padStart(2, '0')).join('');
      const v4 = rnd(16).split('');
      v4[12] = '4'; v4[16] = '89ab'[parseInt(v4[16], 16) & 3];
      const s4 = v4.join('');
      const t = Number(ts).toString(16).padStart(12, '0');
      const r = rnd(10);
      const s7 = t + '7' + r.slice(0, 3) + '89ab'[parseInt(r[3], 16) & 3] + r.slice(4, 19);
      const fmtU = s => `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
      const u7 = fmtU(s7);
      uu.innerHTML = `<div><span class="label">UUIDv7</span><code><mark>${u7.slice(0, 13)}</mark>${u7.slice(13)}</code></div>` +
        `<div><span class="label">UUIDv4</span><code>${fmtU(s4)}</code></div>`;
    }
    gen(1);
    return {};
  });

  // ---------------------------------------------------------------- sequential vs random keys in a B-tree
  Deck.demo('idinsert', root => {
    const CAP = 16, CACHE = 12;
    let mode = 'seq', pages, nextId, cache, counter, total, misses, splits, recent, todo, recentMiss;
    const view = h('div', { class: 'ii-pages' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl);
    root.append(
      seg([['seq', 'растущие: UUIDv7, Snowflake'], ['rnd', 'случайные: UUIDv4']], k => { mode = k; reset(); }, mode),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => { todo += 200; } }, 'Вставить 200'),
        h('button', { class: 'btn', onclick: () => { todo += 1000; } }, 'Вставить 1000'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      view, stats, logEl,
    );
    function reset() {
      pages = []; nextId = 0; cache = []; counter = 0; total = 0; misses = 0; splits = 0; recent = new Set(); todo = 0; recentMiss = [];
      say(mode === 'seq' ? 'Каждый новый ключ больше предыдущего — он всегда идёт в правую страницу.' : 'Каждый новый ключ случаен — он попадает в любую страницу индекса.');
      render();
    }
    function touch(p) {
      const i = cache.indexOf(p.id);
      const hit = i >= 0;
      if (hit) cache.splice(i, 1);
      cache.push(p.id);
      if (cache.length > CACHE) cache.shift();
      recent.add(p.id);
      return hit;
    }
    function insert() {
      const k = mode === 'seq' ? counter++ : Math.random();
      total++;
      if (!pages.length) { pages.push({ id: nextId++, keys: [k] }); touch(pages[0]); recentMiss.push(0); return; }
      let lo = 0, hi = pages.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pages[m].keys[0] <= k) lo = m; else hi = m - 1; }
      const p = pages[lo];
      const hit = touch(p);
      if (!hit) misses++;
      recentMiss.push(hit ? 0 : 1);
      if (recentMiss.length > 100) recentMiss.shift();
      let j = p.keys.findIndex(x => x > k);
      if (j < 0) j = p.keys.length;
      p.keys.splice(j, 0, k);
      if (p.keys.length > CAP) {
        splits++;
        // Rightmost page with an ascending key: keep the left page ~90% full (like Postgres' leaf fillfactor).
        const rightmost = lo === pages.length - 1 && j === p.keys.length - 1;
        const cut = rightmost ? Math.round(CAP * 0.9) + 1 : Math.ceil(p.keys.length / 2);
        const np = { id: nextId++, keys: p.keys.splice(cut) };
        pages.splice(lo + 1, 0, np);
        touch(np);
      }
    }
    function render() {
      const fill = pages.length ? pages.reduce((s, p) => s + p.keys.length, 0) / (pages.length * CAP) : 0;
      const shown = pages.length > 120 ? pages.slice(-120) : pages;
      view.innerHTML = (pages.length > 120 ? `<span class="label">… ещё ${pages.length - 120}</span>` : '') +
        (pages.length ? shown.map(p => `<i class="${recent.has(p.id) ? 'hot' : ''} ${cache.includes(p.id) ? 'mem' : ''}"><b style="height:${(p.keys.length / CAP) * 100}%"></b></i>`).join('')
          : '<span class="label">индекс пуст</span>');
      const rm = recentMiss.length ? recentMiss.reduce((a, b) => a + b, 0) / recentMiss.length : 0;
      stats.innerHTML = `<div class="stat"><b>${fmt(pages.length)}</b><span>страниц · заполнены на ${dec(fill * 100, 0)}%</span></div>` +
        `<div class="stat ${rm > 0.3 ? 'warn' : ''}"><b>${dec(rm * 100, 0)}%</b><span>промахов кэша за последние 100 вставок</span></div>` +
        `<div class="stat"><b>${fmt(splits)}</b><span>делений страниц</span></div>`;
      recent = new Set();
    }
    function summary() {
      if (!pages.length) return;
      const rm = recentMiss.reduce((a, b) => a + b, 0) / Math.max(1, recentMiss.length);
      if (pages.length <= CACHE) say(`Индекс — ${pages.length} ${plural(pages.length, ['страница', 'страницы', 'страниц'])}, весь в кэше. Пока разницы нет.`);
      else if (mode === 'seq') say(`Индекс уже ${pages.length} страниц, а промахов ${dec(rm * 100, 0)}%: пишем только в правый край, он всегда в памяти. Страницы почти полные.`, 'ok');
      else say(`Индекс ${pages.length} страниц при кэше в ${CACHE}: ${dec(rm * 100, 0)}% вставок читают страницу с диска. Деления пополам оставляют страницы заполненными на ~70%.`, 'bad');
    }
    reset();
    let busy = false;
    return rafLoop(() => {
      if (!todo) { if (busy) { busy = false; summary(); } return; }
      busy = true;
      const n = Math.min(todo, 40);
      for (let i = 0; i < n; i++) insert();
      todo -= n;
      render();
    });
  });
})();

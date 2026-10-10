// Demos for the URL shortener, the rate limiter and the news feed.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  // 1234567 → «1,2 млн»
  function human(n) {
    const u = [[1e12, 'трлн'], [1e9, 'млрд'], [1e6, 'млн'], [1e3, 'тыс']];
    for (const [v, s] of u) if (n >= v) { const x = n / v; return dec(x, x < 10 ? 1 : 0).replace(',0', '') + ' ' + s; }
    return n < 10 && n % 1 ? dec(n, 1) : fmt(n);
  }
  function bytes(b) {
    const u = [[1e15, 'ПБ'], [1e12, 'ТБ'], [1e9, 'ГБ'], [1e6, 'МБ'], [1e3, 'КБ']];
    for (const [v, s] of u) if (b >= v) { const x = b / v; return dec(x, x < 10 ? 1 : 0).replace(',0', '') + ' ' + s; }
    return fmt(b) + ' Б';
  }
  const pct = (x, d = 0) => { const v = x * 100; return (v > 0 && v < 0.5 * 10 ** -d ? '<' + dec(10 ** -d, d) : dec(v, d)) + '%'; };

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  // Discrete slider over a list of values.
  function listSlider(parent, label, list, idx, show, onChange) {
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
    const set = () => { out.textContent = show(list[+input.value]); };
    set();
    input.addEventListener('input', () => { set(); onChange(); });
    parent.append(h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, label), input, out));
    return () => list[+input.value];
  }
  // A row of mutually exclusive buttons.
  function choice(parent, items, cur, onPick, label) {
    const btns = items.map(([v, text]) => h('button', { class: 'btn small' + (v === cur ? ' sel' : ''), onclick: () => pick(v) }, text));
    function pick(v) {
      btns.forEach((b, i) => b.classList.toggle('sel', items[i][0] === v));
      onPick(v);
    }
    parent.append(h('div', { class: 'controls' }, label ? h('span', { class: 'label' }, label) : null, btns));
    return pick;
  }

  const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function base62(n) {
    if (n === 0) return '0';
    let s = '';
    while (n > 0) { s = B62[n % 62] + s; n = Math.floor(n / 62); }
    return s;
  }
  // 53-bit string hash (cyrb53) — stands in for xxhash/MD5.
  function hash53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  // ---------------------------------------------------------------- shortener estimates
  Deck.demo('shortcalc', root => {
    const newPerDay = listSlider(root, 'новых ссылок в день', [1e6, 1e7, 3e7, 1e8, 3e8, 1e9], 3, v => human(v), update);
    const ratio = listSlider(root, 'чтений на запись', [10, 30, 100, 300, 1000], 2, v => v + ':1', update);
    const years = listSlider(root, 'хранить, лет', [1, 3, 5, 10], 3, v => v, update);
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log' });
    root.append(stats, logEl, h('p', { class: 'note' }, 'Запись ~500 Б: ключ, URL, владелец, даты. Пик — ×3 от среднего. В сутках ~10⁵ секунд.'));
    function update() {
      const d = newPerDay(), r = ratio(), y = years();
      const w = d / 86400, rd = w * r, total = d * 365 * y, store = total * 500;
      let L = 1;
      while (62 ** L < total) L++;
      const cache = d * r * 0.2 * 500;
      stats.innerHTML =
        `<div class="stat"><b>${human(w)}/с</b><span>запись, пик ${human(w * 3)}/с</span></div>` +
        `<div class="stat ${rd * 3 > 5e4 ? 'warn' : ''}"><b>${human(rd)}/с</b><span>редиректов, пик ${human(rd * 3)}/с</span></div>` +
        `<div class="stat"><b>${human(total)}</b><span>ссылок за ${y} ${plural(y, ['год', 'года', 'лет'])}</span></div>` +
        `<div class="stat ${store > 1e13 ? 'warn' : ''}"><b>${bytes(store)}</b><span>данных, ×3 с репликами</span></div>` +
        `<div class="stat"><b>${L} симв.</b><span>минимум base62 для счётчика</span></div>` +
        `<div class="stat"><b>${bytes(cache)}</b><span>кэш на 20% дневных чтений, без учёта повторов</span></div>`;
      const out = [];
      out.push(w * 3 < 5000 ? `Запись — ${human(w * 3)}/с в пике: справится одна база.` : `Запись — ${human(w * 3)}/с в пике: одной базе уже тяжело, нужен шардинг.`);
      out.push(rd * 3 > 5e4 ? `Чтение ${human(rd * 3)}/с — без кэша не обойтись.` : `Чтение ${human(rd * 3)}/с — кэш желателен, но не критичен.`);
      out.push(store > 1e13 ? `${bytes(store)} не влезут в один сервер: шардируем по ключу.` : `${bytes(store)} помещаются на один сервер с репликами.`);
      logEl.innerHTML = out.join(' ');
      logEl.className = 'log' + (store > 1e13 || rd * 3 > 5e4 ? ' warn' : ' ok');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- key generation
  Deck.demo('keygen', root => {
    const OFFSET = 62 ** 6; // start the counter here so every key has exactly 7 characters
    const BLOCK = 1000;
    let mode = 'range', servers, counter, nextBlock, coord, dbChecks, made, lost, urlN, lastUrl;
    const srvEl = h('div', { class: 'kg-servers' });
    const centerEl = h('div', { class: 'kg-center' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    choice(root, [['hash', 'хеш URL'], ['counter', 'счётчик'], ['range', 'диапазоны']], mode, v => { mode = v; reset(); });
    const crashBtn = h('button', { class: 'btn small danger', onclick: crash }, 'Уронить B');
    root.append(
      h('div', { class: 'controls' },
        ['A', 'B', 'C'].map(n => h('button', { class: 'btn small primary', onclick: () => create(n) }, 'Ссылка на ' + n)),
        h('button', { class: 'btn small', onclick: bulk }, '+100'),
        h('button', { class: 'btn small', onclick: same }, 'Тот же URL'),
        crashBtn),
      srvEl, centerEl, stats, logEl,
    );

    function reset() {
      servers = { A: { up: true, lo: 0, hi: 0, next: 0, last: '—' }, B: { up: true, lo: 0, hi: 0, next: 0, last: '—' }, C: { up: true, lo: 0, hi: 0, next: 0, last: '—' } };
      counter = OFFSET; nextBlock = OFFSET; coord = 0; dbChecks = 0; made = 0; lost = 0; urlN = 0; lastUrl = null;
      this_db.clear();
      crashBtn.textContent = 'Уронить B';
      say({
        hash: 'Ключ — первые 7 символов base62 от хеша URL. Серверам не нужно договариваться, но каждая вставка — «вставить, если такого ключа нет».',
        counter: `Общий счётчик (Redis <code>INCR</code> или последовательность в базе). Начинаем с 62⁶ = ${human(OFFSET)}, чтобы все ключи были ровно из 7 символов.`,
        range: `Координатор (ZooKeeper/etcd или строка в базе) выдаёт блоки по ${BLOCK} номеров. Сервер раздаёт их сам, без сети.`,
      }[mode]);
      render();
    }
    const this_db = new Map(); // key → url
    function newUrl() { urlN++; return `https://shop.example/item/${(urlN * 7919) % 100000}?utm=${urlN}`; }
    function make(name, url, quiet) {
      const s = servers[name];
      if (!s.up) { if (!quiet) say(`Сервер ${name} лежит — балансировщик отправит запрос на другой.`, 'warn'); return; }
      let key, msg, cls = '';
      if (mode === 'hash') {
        let salt = 0;
        for (;;) {
          key = base62(hash53(url + (salt ? '#' + salt : ''))).padStart(7, '0').slice(0, 7);
          dbChecks++;
          const had = this_db.get(key);
          if (!had) break;
          if (had === url) { msg = `Такой URL уже есть: хеш тот же, ключ <code>${key}</code> тот же. Два владельца поделят одну ссылку и её статистику — или добавьте владельца во входные данные хеша.`; cls = 'warn'; break; }
          salt++; // collision with a different URL: retry with salt
        }
        if (!msg) msg = `${name}: хеш → <code>${key}</code>. Одна проверка в базе на вставку; при коллизии добавили бы соль и повторили.`;
      } else if (mode === 'counter') {
        coord++;
        const n = counter++;
        key = base62(n);
        msg = `${name}: <code>INCR</code> → ${fmt(n)} → <code>${key}</code>. Поход к счётчику на каждую ссылку; соседние ключи отличаются последним символом.`;
      } else {
        if (s.next >= s.hi) {
          coord++;
          s.lo = nextBlock; s.hi = nextBlock + BLOCK; s.next = s.lo; nextBlock += BLOCK;
          if (!quiet) msg = `${name}: блок кончился — взял у координатора новый ${fmt(s.lo)}…${fmt(s.hi - 1)}. `;
        }
        const n = s.next++;
        key = base62(n);
        msg = (msg || '') + `${name}: номер ${fmt(n)} → <code>${key}</code> локально, без сети.`;
      }
      if (!this_db.has(key)) { this_db.set(key, url); made++; }
      s.last = key;
      lastUrl = url;
      if (!quiet) say(msg, cls);
    }
    function create(name) { make(name, newUrl()); render(); }
    function same() {
      if (!lastUrl) { create('A'); return; }
      const name = ['A', 'C', 'B'].find(n => servers[n].up);
      make(name, lastUrl);
      if (mode !== 'hash') say(`Тот же URL снова → новый ключ <code>${servers[name].last}</code>. Без хеша одинаковые ссылки не склеиваются — у каждого владельца своя.`);
      render();
    }
    function bulk() {
      const up = Object.keys(servers).filter(n => servers[n].up);
      for (let i = 0; i < 100; i++) make(up[i % up.length], newUrl(), true);
      say(`Создали ещё 100 ссылок на серверах ${up.join(', ')}. ` + {
        hash: 'Каждая — с проверкой в базе. Коллизий не было: при 7 символах их не будет ещё пару миллионов ссылок.',
        counter: 'Каждая — с походом к счётчику: при 10 тыс. записей в секунду счётчик становится узким местом и единой точкой отказа.',
        range: 'Обращений к координатору почти нет: один на 1000 ссылок.',
      }[mode]);
      render();
    }
    function crash() {
      const s = servers.B;
      if (s.up) {
        s.up = false;
        if (mode === 'range' && s.hi > s.next) { lost += s.hi - s.next; say(`B упал, неиспользованные ${fmt(s.hi - s.next)} номеров его блока потеряны. Это не страшно: 62⁷ хватит на триллионы, а уникальность не нарушена.`, 'warn'); }
        else say('B упал. ' + (mode === 'counter' ? 'Другим серверам всё равно — но упади сам счётчик, встали бы все.' : 'Остальные работают дальше: общего состояния у серверов нет.'), 'warn');
        s.lo = s.hi = s.next = 0;
        crashBtn.textContent = 'Поднять B';
      } else {
        s.up = true;
        crashBtn.textContent = 'Уронить B';
        say('B вернулся. ' + (mode === 'range' ? 'Старый блок он не помнит и на первой ссылке возьмёт новый.' : ''));
      }
      render();
    }
    function render() {
      srvEl.innerHTML = Object.entries(servers).map(([n, s]) =>
        `<div class="kg-srv ${s.up ? '' : 'down'}"><b>${n}</b>` +
        (mode === 'range' ? `<span class="kg-r">${s.hi ? `${fmt(s.next - s.lo)}/${BLOCK} блока` : 'нет блока'}</span>` : '') +
        `<code>${s.up ? s.last : 'лежит'}</code></div>`).join('');
      centerEl.innerHTML = {
        hash: `<span class="label">база</span> <b>${fmt(this_db.size)}</b> ключей · проверок перед вставкой: <b>${fmt(dbChecks)}</b>`,
        counter: `<span class="label">счётчик</span> <b>${fmt(counter)}</b> → следующий ключ <code>${base62(counter)}</code>`,
        range: `<span class="label">координатор</span> следующий блок с <b>${fmt(nextBlock)}</b>`,
      }[mode];
      const per = made ? coord / made : 0;
      stats.innerHTML =
        `<div class="stat"><b>${fmt(made)}</b><span>ссылок создано</span></div>` +
        `<div class="stat ${per > 0.5 ? 'warn' : ''}"><b>${mode === 'hash' ? fmt(dbChecks) : fmt(coord)}</b><span>${mode === 'hash' ? 'проверок коллизий' : 'походов к счётчику/координатору'}</span></div>` +
        `<div class="stat ${mode === 'hash' ? '' : 'warn'}"><b>${mode === 'hash' ? 'нет' : 'да'}</b><span>соседние ключи угадываются${mode === 'range' && lost ? `; потеряно ${fmt(lost)} номеров` : ''}</span></div>`;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- base62 + birthday paradox
  Deck.demo('birthday', root => {
    const numIn = h('input', { class: 'num-in', type: 'number', min: 0, max: 1e15, value: 56800235584, 'aria-label': 'Номер ссылки' });
    const encEl = h('div', { class: 'bd-enc' });
    root.append(h('div', { class: 'controls' }, h('span', { class: 'label' }, 'base62(номер)'), numIn), encEl);
    numIn.addEventListener('input', encode);
    function encode() {
      let n = Math.floor(Math.abs(+numIn.value || 0));
      if (n > 1e15) n = 1e15;
      const steps = [];
      let x = n;
      do { steps.unshift(B62[x % 62]); x = Math.floor(x / 62); } while (x > 0);
      encEl.innerHTML = `<code class="bd-key">${steps.join('')}</code><span class="note">${steps.length} ${plural(steps.length, ['символ', 'символа', 'символов'])}: ` +
        `остатки от деления на 62, старший разряд слева. ${steps.length < 7 ? 'Маленькие номера дают короткие ключи — счётчик начинают с 62⁶.' : ''}</span>`;
    }
    encode();

    const lenOut = h('output'), nOut = h('output');
    const lenIn = h('input', { type: 'range', min: 4, max: 10, value: 7, 'aria-label': 'Длина ключа' });
    const nIn = h('input', { type: 'range', min: 3, max: 12, step: 0.25, value: 6, 'aria-label': 'Число ссылок' });
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, 'длина ключа'), lenIn, lenOut),
      h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, 'случайных ключей'), nIn, nOut),
    );
    const rows = h('div', { class: 'bd-rows' });
    const logEl = h('div', { class: 'log' });
    root.append(rows, logEl);
    lenIn.addEventListener('input', update);
    nIn.addEventListener('input', update);
    function bar(label, p, val) {
      return `<div class="bd-row"><span>${label}</span><span class="cost-track"><span class="cost-fill" style="width:${Math.max(p > 0 ? 0.6 : 0, p * 100)}%"></span></span><b>${val}</b></div>`;
    }
    function update() {
      const L = +lenIn.value, n = 10 ** +nIn.value, M = 62 ** L;
      lenOut.textContent = L;
      nOut.textContent = human(n);
      const pAny = -Math.expm1(-n * (n - 1) / (2 * M));
      const pNext = Math.min(1, n / M);
      const expected = n - M * -Math.expm1(-n / M); // n minus expected number of distinct keys
      const n50 = Math.sqrt(2 * M * Math.LN2);
      rows.innerHTML =
        `<div class="bd-space">ключей всего: <b>62<sup>${L}</sup> ≈ ${human(M)}</b>, 50% шанс первой коллизии после <b>${human(n50)}</b></div>` +
        bar('хотя бы одна коллизия', pAny, pct(pAny, pAny < 0.1 ? 2 : 0)) +
        bar('новая ссылка попадёт в занятый ключ', pNext, pct(pNext, 3)) +
        `<div class="bd-row"><span>ожидаемое число коллизий</span><span></span><b>${expected < 1 ? dec(expected, 3) : human(expected)}</b></div>`;
      if (n > M) { logEl.innerHTML = 'Ссылок больше, чем ключей: коллизии неизбежны, а повторы с солью будут крутиться бесконечно. Нужен ключ длиннее.'; logEl.className = 'log bad'; }
      else if (pAny < 0.01) { logEl.innerHTML = 'Коллизий почти наверняка не будет. Но система работает годами — проверку всё равно оставьте.'; logEl.className = 'log ok'; }
      else if (pNext < 0.001) { logEl.innerHTML = (expected < 1 ? `Шанс коллизии уже ${pct(pAny)} — без проверки однажды две ссылки получат один ключ.` : `Коллизии будут: ~${human(expected)}.`) + ` Срабатывать проверка «вставить, если нет» будет редко — раз в ${human(1 / pNext)} вставок. Цена — одно чтение на запись.`; logEl.className = 'log warn'; }
      else { logEl.innerHTML = `Каждая ${human(Math.max(1, 1 / pNext))}-я вставка натыкается на занятый ключ. Пространство заполнено — удлините ключ.`; logEl.className = 'log bad'; }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- 301 vs 302
  Deck.demo('redirect', root => {
    let code, target, cache, users, cur, real, seen, lat, stale;
    const pathEl = h('div', { class: 'rd-path' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const pickCode = choice(root, [[301, '301 Moved Permanently'], [302, '302 Found']], 301, v => { code = v; reset(true); });
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn small primary', onclick: () => click(false) }, 'Клик тем же пользователем'),
        h('button', { class: 'btn small', onclick: () => click(true) }, 'Клик новым'),
        h('button', { class: 'btn small', onclick: retarget }, 'Сменить цель ссылки')),
      pathEl, stats, logEl,
    );
    function reset(keepCode) {
      if (!keepCode) code = 301;
      target = '/spring-sale'; cache = [new Map()]; users = 1; cur = 0; real = 0; seen = 0; lat = []; stale = 0;
      say(code === 301 ? '301: браузер запомнит ответ и дальше пойдёт на цель сам, мимо нашего сервера.' : '302: временный редирект. Браузер его не кэширует (без явного Cache-Control) и каждый раз спрашивает нас.');
      render('');
    }
    function click(fresh) {
      if (fresh) { cache.push(new Map()); users++; cur = cache.length - 1; }
      real++;
      const c = cache[cur];
      if (c.has('aZ3kP9q')) {
        const t = c.get('aZ3kP9q');
        lat.push(0);
        if (t !== target) { stale++; say(`Браузер пользователя ${cur + 1} взял 301 из своего кэша и ушёл на <b>${t}</b> — старую цель. Сервер не узнал ни о клике, ни о том, что ссылку поменяли.`, 'bad'); }
        else say(`Браузер пользователя ${cur + 1} взял 301 из кэша: 0 мс, а сервер и аналитика клика не увидели.`, 'warn');
        render('cached');
        return;
      }
      seen++;
      lat.push(40);
      if (code === 301) c.set('aZ3kP9q', target);
      say(`Пользователь ${cur + 1}: запрос дошёл до сервера (~40 мс), событие клика ушло в Kafka, ответ ${code} → <b>${target}</b>.` + (code === 301 ? ' Браузер запомнил редирект.' : ''), 'ok');
      render('server');
    }
    function retarget() {
      target = target === '/spring-sale' ? '/autumn-sale' : '/spring-sale';
      say(`Владелец поменял цель на <b>${target}</b>. ` + (code === 301 ? 'Кто уже переходил, этого не узнает: 301 у них в кэше, часто навсегда.' : 'Следующий же клик пойдёт на новую цель.'), code === 301 ? 'warn' : 'ok');
      render('');
    }
    function render(how) {
      pathEl.innerHTML =
        `<div class="rd-node ${how ? 'on' : ''}"><b>браузер ${cur + 1}</b><small>${cache[cur].has('aZ3kP9q') ? '301 в кэше → ' + cache[cur].get('aZ3kP9q') : 'кэш пуст'}</small></div>` +
        `<span class="rd-arrow ${how === 'server' ? 'on' : how === 'cached' ? 'skip' : ''}">→</span>` +
        `<div class="rd-node ${how === 'server' ? 'on' : how === 'cached' ? 'dim' : ''}"><b>sho.rt</b><small>цель: ${target}</small></div>` +
        `<span class="rd-arrow ${how ? 'on' : ''}">→</span>` +
        `<div class="rd-node ${how ? 'on' : ''}"><b>цель</b><small>shop.example</small></div>`;
      const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
      stats.innerHTML =
        `<div class="stat"><b>${real}</b><span>настоящих кликов</span></div>` +
        `<div class="stat ${seen < real ? 'warn' : ''}"><b>${seen}</b><span>видит аналитика</span></div>` +
        `<div class="stat ${stale ? 'warn' : ''}"><b>${Math.round(avg)} мс</b><span>средний редирект${stale ? `, ${stale} на старую цель` : ''}</span></div>`;
    }
    pickCode(301);
    return {};
  });

  // ---------------------------------------------------------------- hot links cache (Zipf)
  Deck.demo('zipfcache', root => {
    const N = 1e9, READS = 116000, ENTRY = 300;
    // Generalized harmonic number: exact head + integral tail.
    function H(n, s) {
      const head = Math.min(n, 2000);
      let sum = 0;
      for (let k = 1; k <= head; k++) sum += k ** -s;
      if (n > head) {
        const a = head + 0.5, b = n + 0.5;
        sum += Math.abs(s - 1) < 1e-9 ? Math.log(b / a) : (b ** (1 - s) - a ** (1 - s)) / (1 - s);
      }
      return sum;
    }
    const kOut = h('output'), sOut = h('output');
    const kIn = h('input', { type: 'range', min: 4, max: 9, step: 0.25, value: 7, 'aria-label': 'Размер кэша' });
    const sIn = h('input', { type: 'range', min: 0.7, max: 1.2, step: 0.05, value: 1, 'aria-label': 'Показатель Ципфа' });
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, 'ссылок в кэше'), kIn, kOut),
      h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, 'перекос (Ципф s)'), sIn, sOut),
    );
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 320 130');
    svg.setAttribute('class', 'zc-chart');
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log' });
    root.append(svg, stats, logEl);
    kIn.addEventListener('input', update);
    sIn.addEventListener('input', update);
    const X = e => 34 + (e - 4) / 5 * 276, Y = p => 112 - p * 100;
    function update() {
      const k = 10 ** +kIn.value, s = +sIn.value, HN = H(N, s);
      const hit = H(k, s) / HN;
      kOut.textContent = human(k);
      sOut.textContent = dec(s, 2);
      let pts = '';
      for (let e = 4; e <= 9.001; e += 0.125) pts += `${X(e).toFixed(1)},${Y(H(10 ** e, s) / HN).toFixed(1)} `;
      const grid = [0, 0.5, 1].map(p => `<line x1="34" x2="310" y1="${Y(p)}" y2="${Y(p)}" class="zc-grid"/><text x="28" y="${Y(p) + 4}" text-anchor="end">${p * 100}%</text>`).join('');
      const ticks = [4, 5, 6, 7, 8, 9].map(e => `<text x="${X(e)}" y="127" text-anchor="middle">${human(10 ** e)}</text>`).join('');
      svg.innerHTML = grid + ticks + `<polyline points="${pts}" class="zc-line"/>` +
        `<line x1="${X(+kIn.value)}" x2="${X(+kIn.value)}" y1="12" y2="112" class="zc-mark"/><circle cx="${X(+kIn.value)}" cy="${Y(hit)}" r="5" class="zc-dot"/>`;
      const db = READS * 3 * (1 - hit);
      stats.innerHTML =
        `<div class="stat"><b>${pct(hit)}</b><span>попаданий в кэш</span></div>` +
        `<div class="stat"><b>${bytes(k * ENTRY)}</b><span>памяти (~${ENTRY} Б на ссылку)</span></div>` +
        `<div class="stat ${db > 1e5 ? 'warn' : ''}"><b>${human(db)}/с</b><span>до базы в пике (из ${human(READS * 3)}/с)</span></div>`;
      logEl.innerHTML = `${pct(k / N, 2)} самых популярных из ${human(N)} ссылок, по которым кликают, забирают ${pct(hit)} переходов. ` +
        (hit > 0.8 ? 'Остаток — длинный хвост, его кэшировать бесполезно: он и так размазан по шардам.' : 'Хвост тяжёлый: чтобы снять больше, кэш придётся растить на порядки.');
      logEl.className = 'log' + (hit > 0.8 ? ' ok' : '');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- rate limiting algorithms
  Deck.demo('rlalgos', root => {
    const W = 10, LIMIT = 10, T = 30;
    let algo = 'fixed', pattern = 'boundary';
    const PATTERNS = {
      boundary: () => [...Array(10)].map((_, i) => 9 + i * 0.1).concat([...Array(10)].map((_, i) => 10 + i * 0.1), [...Array(9)].map((_, i) => 12 + i * 2)),
      even: () => [...Array(42)].map((_, i) => 0.3 + i * 0.7),
      burst: () => [...Array(25)].map((_, i) => i * 0.08).concat([...Array(18)].map((_, i) => 3 + i * 1.5)),
      random: () => { let x = 7, t = 0; const out = []; for (;;) { x = (x * 48271) % 2147483647; t += -Math.log(x / 2147483647) / 1.3; if (t >= T) return out; out.push(t); } },
    };
    choice(root, [['boundary', 'всплеск на границе'], ['burst', 'всплеск в начале'], ['even', 'ровно 1,4/с'], ['random', 'случайно']], pattern, v => { pattern = v; run(); }, 'поток');
    choice(root, [['fixed', 'фикс. окно'], ['log', 'скользящий лог'], ['counter', 'скольз. счётчик'], ['bucket', 'token bucket']], algo, v => { algo = v; run(); }, 'алгоритм');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 600 150');
    svg.setAttribute('class', 'rl-chart');
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log' });
    root.append(svg, stats, logEl);

    function simulate(times) {
      const res = [];
      const level = []; // token level or sliding estimate, for the chart
      if (algo === 'fixed') {
        const cnt = {};
        for (const t of times) { const w = Math.floor(t / W); cnt[w] = cnt[w] || 0; const ok = cnt[w] < LIMIT; if (ok) cnt[w]++; res.push(ok); }
      } else if (algo === 'log') {
        const log = [];
        for (const t of times) { while (log.length && log[0] <= t - W) log.shift(); const ok = log.length < LIMIT; if (ok) log.push(t); res.push(ok); }
      } else if (algo === 'counter') {
        const cnt = {};
        for (const t of times) {
          const w = Math.floor(t / W), frac = (t - w * W) / W;
          const est = (cnt[w - 1] || 0) * (1 - frac) + (cnt[w] || 0);
          const ok = est < LIMIT;
          if (ok) cnt[w] = (cnt[w] || 0) + 1;
          res.push(ok);
        }
      } else {
        let tokens = LIMIT, last = 0;
        for (const t of times) { tokens = Math.min(LIMIT, tokens + (t - last) * LIMIT / W); last = t; const ok = tokens >= 1; if (ok) tokens -= 1; res.push(ok); }
        // token level curve
        let tk = LIMIT, lt = 0, i = 0;
        for (let x = 0; x <= T; x += 0.05) {
          while (i < times.length && times[i] <= x) { tk = Math.min(LIMIT, tk + (times[i] - lt) * LIMIT / W); lt = times[i]; if (res[i]) tk -= 1; i++; }
          level.push([x, Math.min(LIMIT, tk + (x - lt) * LIMIT / W)]);
        }
      }
      return { res, level };
    }
    const MEM = { fixed: '1 счётчик', log: 'до 10 меток', counter: '2 счётчика', bucket: '2 числа' };
    const NOTE = {
      fixed: 'Фиксированное окно: <code>INCR</code> + <code>EXPIRE</code>, проще некуда. Но на стыке окон пропускает вдвое больше лимита.',
      log: 'Скользящий лог хранит время каждого пропущенного запроса (sorted set в Redis) — точно, но память растёт с лимитом: при 10 000/час это 10 000 меток на пользователя.',
      counter: 'Скользящий счётчик: прошлое окно × доля, которая ещё попадает в последние 10 с, + текущее окно. Два числа вместо лога. Он считает прошлое окно равномерным, поэтому на резком всплеске у границы ошибается, но на реальном трафике ошибка — доли процента (замер Cloudflare).',
      bucket: 'Token bucket: ведро на 10 жетонов, пополняется 1 жетоном в секунду. Разрешает короткий всплеск размером с ведро, а в среднем держит скорость. Линия — уровень жетонов.',
    };
    function run() {
      const times = PATTERNS[pattern]();
      const { res, level } = simulate(times);
      // Draw in CSS pixels so dots keep their size on a narrow phone screen.
      const vw = Math.max(300, Math.min(600, Math.round(svg.getBoundingClientRect().width) || 600));
      svg.setAttribute('viewBox', `0 0 ${vw} 150`);
      const r = vw < 450 ? 2.8 : 3.8, dy = r * 2 + 1.5;
      const x = t => 20 + t / T * (vw - 45);
      let out = '';
      for (let w = 0; w <= T; w += W) out += `<line x1="${x(w)}" x2="${x(w)}" y1="8" y2="128" class="rl-win"/><text x="${x(w)}" y="144" text-anchor="middle">${w} с</text>`;
      if (level.length) out += `<polyline class="rl-level" points="${level.map(([t, v]) => `${x(t).toFixed(1)},${(118 - v * 10).toFixed(1)}`).join(' ')}"/>`;
      // Requests are stacked in half-second columns so bursts read as tall columns.
      const stackAt = {};
      times.forEach((t, i) => {
        const col = Math.floor(t * 2);
        const k = stackAt[col] = (stackAt[col] || 0) + 1;
        out += `<circle cx="${x(col / 2 + 0.25).toFixed(1)}" cy="${(122 - (k - 1) * dy).toFixed(1)}" r="${r}" class="${res[i] ? 'rl-ok' : 'rl-no'}"/>`;
      });
      svg.innerHTML = out;
      const allowed = times.filter((_, i) => res[i]);
      let worst = 0;
      allowed.forEach(t0 => { worst = Math.max(worst, allowed.filter(t => t >= t0 && t < t0 + W).length); });
      stats.innerHTML =
        `<div class="stat"><b>${allowed.length} / ${times.length}</b><span>пропущено</span></div>` +
        `<div class="stat ${worst > LIMIT ? 'warn' : ''}"><b>${worst}</b><span>максимум за любые 10 с (лимит ${LIMIT})</span></div>` +
        `<div class="stat"><b>${MEM[algo]}</b><span>памяти на ключ</span></div>`;
      logEl.innerHTML = NOTE[algo] + (worst > LIMIT ? ` Здесь за 10 секунд прошло ${worst}.` : '');
      logEl.className = 'log' + (worst > LIMIT ? ' warn' : '');
    }
    run();
    return {};
  });

  // ---------------------------------------------------------------- race in a non-atomic limiter
  Deck.demo('race', root => {
    let mode = 'naive', step, redisTokens, a, b, passed, hist;
    choice(root, [['naive', 'GET, потом SET'], ['lua', 'Lua-скрипт (атомарно)']], mode, v => { mode = v; reset(); });
    const stepBtn = h('button', { class: 'btn small primary', onclick: next }, 'Шаг');
    root.append(h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn small', onclick: reset }, 'Сброс')));
    const board = h('div', { class: 'rc-board' });
    const histEl = h('ol', { class: 'rc-hist' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(board, histEl, logEl);

    const SCRIPTS = {
      naive: [
        ['A', 'GET tokens → 1', s => { s.a.seen = s.redis; }],
        ['B', 'GET tokens → 1', s => { s.b.seen = s.redis; }],
        ['A', '1 ≥ 1 → пропустить; SET tokens 0', s => { s.a.verdict = 'пропущен'; s.redis = s.a.seen - 1; s.passed++; }],
        ['B', '1 ≥ 1 → пропустить; SET tokens 0', s => { s.b.verdict = 'пропущен'; s.redis = s.b.seen - 1; s.passed++; }],
      ],
      lua: [
        ['A', 'EVALSHA bucket → скрипт: 1 ≥ 1, tokens = 0, вернуть 1', s => { s.a.seen = s.redis; s.redis = 0; s.a.verdict = 'пропущен'; s.passed++; }],
        ['B', 'EVALSHA bucket → скрипт: 0 < 1, вернуть 0', s => { s.b.seen = s.redis; s.b.verdict = '429'; }],
      ],
    };
    const NOTES = {
      naive: [
        'Шлюз A прочитал счётчик: остался один жетон.',
        'Шлюз B прочитал тот же счётчик раньше, чем A успел записать. Он тоже видит 1.',
        'A решил пропустить запрос и записал 0.',
        'B тоже решил пропустить и тоже записал 0. Два запроса прошли по одному жетону. Под нагрузкой с 50 шлюзов такой «лимит» течёт в разы.',
      ],
      lua: [
        'Скрипт A выполнился в Redis целиком: прочитал, проверил и записал без перерыва.',
        'Скрипт B начался только после A и увидел 0. Отказ 429 — лимит соблюдён. Тот же эффект дают атомарные команды (INCR для окна) или MULTI с WATCH, но тот повторяет транзакцию при каждом конфликте.',
      ],
    };
    function reset() {
      step = 0; redisTokens = 1; passed = 0; hist = [];
      a = { seen: null, verdict: '' }; b = { seen: null, verdict: '' };
      stepBtn.disabled = false;
      say('В ведре пользователя остался 1 жетон. Два запроса пришли одновременно на разные шлюзы.');
      render(null);
    }
    function next() {
      const sc = SCRIPTS[mode];
      if (step >= sc.length) return;
      const [who, op, fn] = sc[step];
      const s = { a, b, redis: redisTokens, passed };
      fn(s);
      redisTokens = s.redis; passed = s.passed;
      hist.push(`<b>${who}</b> <code>${op}</code>`);
      say(NOTES[mode][step], step === sc.length - 1 ? (passed > 1 ? 'bad' : 'ok') : '');
      step++;
      if (step >= sc.length) stepBtn.disabled = true;
      render(who);
    }
    function render(active) {
      const gw = (n, g) => `<div class="rc-gw ${active === n ? 'on' : ''} ${g.verdict === '429' ? 'no' : g.verdict ? 'ok' : ''}"><b>шлюз ${n}</b><small>прочитал: ${g.seen == null ? '—' : g.seen}</small><span>${g.verdict || 'ждёт'}</span></div>`;
      board.innerHTML = gw('A', a) + `<div class="rc-redis"><b>Redis</b><small>tokens</small><span>${redisTokens}</span><small>пропущено: ${passed}</small></div>` + gw('B', b);
      histEl.innerHTML = hist.map(x => `<li>${x}</li>`).join('');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- local vs global limits, failure modes
  Deck.demo('rlfail', root => {
    const LIMIT = 100;
    let mode = 'global', lb = 'even', redisUp = true, onFail = 'local';
    const nodes = listSlider(root, 'шлюзов', [2, 3, 4, 6, 8], 2, v => v, update);
    const rate = listSlider(root, 'клиент шлёт, запр/с', [40, 60, 80, 100, 150, 200, 300], 4, v => v, update);
    choice(root, [['global', 'глобальный (Redis)'], ['local', 'локальный: лимит/N']], mode, v => { mode = v; update(); });
    choice(root, [['even', 'ровно'], ['skew', 'перекос: 50% на первый']], lb, v => { lb = v; update(); }, 'балансировка');
    const redisBtn = h('button', { class: 'btn small danger', onclick: () => { redisUp = !redisUp; update(); } }, 'Уронить Redis');
    const failPick = choice(root, [['open', 'fail open'], ['closed', 'fail closed'], ['local', 'откат на локальный']], onFail, v => { onFail = v; update(); }, 'если Redis лежит');
    root.lastChild.prepend(redisBtn);
    const bars = h('div', { class: 'rf-bars' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log' });
    root.append(bars, stats, logEl);
    void failPick;

    function update() {
      const N = nodes(), R = rate();
      redisBtn.textContent = redisUp ? 'Уронить Redis' : 'Поднять Redis';
      const share = lb === 'even' ? Array(N).fill(1 / N) : [0.5, ...Array(N - 1).fill(0.5 / (N - 1))];
      const inc = share.map(s => R * s);
      let allowed, extra = 0, ops = 0, how;
      const local = () => inc.map(x => Math.min(x, LIMIT / N));
      if (mode === 'local') { allowed = local(); how = 'local'; }
      else if (redisUp) { const tot = Math.min(R, LIMIT); allowed = inc.map(x => x / R * tot); extra = 0.5; ops = R; how = 'global'; }
      else if (onFail === 'open') { allowed = inc.slice(); how = 'open'; }
      else if (onFail === 'closed') { allowed = inc.map(() => 0); how = 'closed'; }
      else { allowed = local(); how = 'fallback'; }
      const max = Math.max(...inc, LIMIT / N);
      bars.innerHTML = inc.map((x, i) => `<div class="rf-node"><span class="label">шлюз ${i + 1}</span>` +
        `<span class="rf-track"><span class="rf-in" style="width:${x / max * 100}%"></span><span class="rf-ok" style="width:${allowed[i] / max * 100}%"></span>` +
        (mode === 'local' || how === 'fallback' ? `<i class="rf-cap" style="left:${LIMIT / N / max * 100}%"></i>` : '') +
        `</span><b>${fmt(allowed[i])}/${fmt(x)}</b></div>`).join('');
      const tot = allowed.reduce((a, b) => a + b, 0), want = Math.min(R, LIMIT);
      const err = (tot - want) / want;
      stats.innerHTML =
        `<div class="stat ${Math.abs(err) > 0.05 ? 'warn' : ''}"><b>${fmt(tot)}/с</b><span>пропущено, должно быть ${want}</span></div>` +
        `<div class="stat"><b>+${dec(extra)} мс</b><span>к каждому запросу</span></div>` +
        `<div class="stat"><b>${fmt(ops)}/с</b><span>операций в Redis</span></div>`;
      const msg = {
        global: 'Все шлюзы спрашивают один счётчик: лимит точен при любой балансировке. Цена — поход в Redis на каждый запрос (в одном дата-центре это ~0,5 мс).',
        local: lb === 'skew'
          ? `Каждый шлюз пропускает не больше ${dec(LIMIT / N).replace(',0', '')}/с. Но первому достаётся половина трафика, и он режет честного клиента, пока остальные простаивают.`
          : `При ровной балансировке лимит/N работает и обходится без сети. Но добавьте шлюз — и лимит на каждом придётся пересчитать.`,
        open: 'Fail open: Redis лежит, лимитов нет вовсе. Для защиты от случайной перегрузки иногда приемлемо, для платного API или логина — нет.',
        closed: 'Fail closed: Redis лежит — всем 429. Лимитер, который должен был защищать сервис, сам его положил.',
        fallback: 'Redis недоступен — шлюзы перешли на локальные лимиты. Точность хуже, но сервис работает и защищён. Таймаут на поход в Redis — единицы миллисекунд, и автоматический выключатель.',
      }[how];
      logEl.innerHTML = msg;
      logEl.className = 'log' + (how === 'closed' || how === 'open' ? ' bad' : Math.abs(err) > 0.05 ? ' warn' : ' ok');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- fan-out strategies
  Deck.demo('fanout', root => {
    const POSTS = 1200, READS = 46000, FOLLOWS = 200, CAP = 2e6;
    // Followers per author bucket, share of posts by such authors, share of a typical reader's follows.
    const F = [10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8];
    const P = [0.6334, 0.30, 0.06, 0.006, 0.0005, 0.00006, 0.000007, 0.000001];
    const Q = [0.05, 0.20, 0.30, 0.20, 0.13, 0.07, 0.04, 0.01];
    let strat = 'hybrid', thr = 5; // first bucket index served by pull
    const thrRow = h('div');
    choice(root, [['push', 'при записи'], ['pull', 'при чтении'], ['hybrid', 'гибрид']], strat, v => { strat = v; update(); });
    const thrIn = h('input', { type: 'range', min: 3, max: 7, value: thr, 'aria-label': 'Порог знаменитости' });
    const thrOut = h('output');
    thrIn.addEventListener('input', () => { thr = +thrIn.value; update(); });
    thrRow.append(h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, 'pull от, подписчиков'), thrIn, thrOut));
    const chart = h('div', { class: 'fo-chart' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log' });
    root.append(thrRow, chart, stats, logEl);

    function update() {
      const cut = strat === 'push' ? F.length : strat === 'pull' ? 0 : thr;
      thrRow.hidden = strat !== 'hybrid';
      thrOut.textContent = human(F[thr]) + '+';
      const contrib = F.map((f, i) => POSTS * P[i] * f);
      const maxC = Math.max(...contrib);
      chart.innerHTML = F.map((f, i) => {
        const push = i < cut;
        const per = POSTS * P[i];
        return `<div class="fo-col ${push ? 'push' : 'pull'}"><span class="fo-v">${human(contrib[i])}</span>` +
          `<span class="fo-bar" style="height:${Math.max(3, contrib[i] / maxC * 100)}%"></span>` +
          `<span class="fo-f">${human(f)}</span><span class="fo-p">${per >= 1 ? human(per) : per >= 0.01 ? dec(per, 2) : '1 за ' + Math.round(1 / per / 60) + ' мин'}${per >= 0.01 ? '/с' : ''}</span></div>`;
      }).join('');
      const writes = contrib.reduce((s, c, i) => s + (i < cut ? c : 0), 0);
      const pullSrc = FOLLOWS * Q.reduce((s, q, i) => s + (i >= cut ? q : 0), 0);
      const perRead = (cut > 0 ? 1 : 0) + pullSrc;
      const tail = 1 - 0.99 ** perRead;
      const celeb = cut === F.length ? 1e8 / CAP : 0;
      stats.innerHTML =
        `<div class="stat ${writes > 2e5 ? 'warn' : ''}"><b>${human(writes)}/с</b><span>записей в ленты</span></div>` +
        `<div class="stat ${perRead > 30 ? 'warn' : ''}"><b>${human(perRead)} ${plural(Math.round(perRead), ['запрос', 'запроса', 'запросов'])}</b><span>на открытие ленты, ${human(READS * perRead)}/с всего</span></div>` +
        `<div class="stat ${tail > 0.2 ? 'warn' : ''}"><b>${pct(tail)}</b><span>открытий ждут чей-то p99</span></div>`;
      let msg;
      if (strat === 'push') msg = `Чтение — один запрос к готовой ленте. Зато ${pct(contrib.slice(5).reduce((a, b) => a + b, 0) / writes)} всех записей порождают ${pct(P.slice(5).reduce((a, b) => a + b, 0), 3)} постов — от авторов с миллионом+ подписчиков, а пост аккаунта со 100 млн подписчиков раскладывается ~${Math.round(celeb)} с, если весь кластер (${human(CAP)} записей/с) занят только им.`;
      else if (strat === 'pull') msg = `Записей нет, но каждое открытие — ${human(perRead)} параллельных запросов и слияние. Если у каждого шарда p99 — 1% медленных ответов, ${pct(tail)} открытий ленты ждут хотя бы один медленный. Плюс ${human(READS * perRead)} чтений в секунду.`;
      else msg = `Авторы от ${human(F[thr])} подписчиков (${pct(P.slice(thr).reduce((a, b) => a + b, 0), 3)} постов) идут через pull. Записей в ${dec(contrib.reduce((a, b) => a + b, 0) / Math.max(1, writes), 1)} раза меньше, чем при чистом push, а при чтении к готовой ленте добавляются ~${human(pullSrc)} лент знаменитостей — их посты горячие и лежат в кэше.`;
      logEl.innerHTML = msg;
      logEl.className = 'log' + (strat === 'hybrid' ? ' ok' : ' warn');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- offset vs cursor pagination
  Deck.demo('cursor', root => {
    const PAGE = 4;
    let mode = 'offset', feed, shown, offset, cursor, nextId, lastPage;
    choice(root, [['offset', 'OFFSET'], ['cursor', 'курсор']], mode, v => { mode = v; reset(); });
    root.append(h('div', { class: 'controls' },
      h('button', { class: 'btn small primary', onclick: page }, 'Следующая страница'),
      h('button', { class: 'btn small', onclick: addNew }, '+2 новых поста'),
      h('button', { class: 'btn small', onclick: reset }, 'Сброс')));
    const qEl = h('code', { class: 'cu-q' });
    const cols = h('div', { class: 'cu-cols' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(qEl, cols, logEl);
    function reset() {
      nextId = 113; feed = []; for (let i = 112; i >= 101; i--) feed.push(i);
      shown = []; offset = 0; cursor = null; lastPage = [];
      say(mode === 'offset' ? 'Страница = OFFSET n LIMIT 4. Просто, но смещение считается от текущего начала ленты.' : 'Страница = «4 поста старше последнего показанного». Курсор — ID последнего поста.');
      page();
    }
    function page() {
      let got;
      if (mode === 'offset') { got = feed.slice(offset, offset + PAGE); qEl.textContent = `… ORDER BY id DESC LIMIT ${PAGE} OFFSET ${offset}`; offset += PAGE; }
      else { got = feed.filter(id => cursor == null || id < cursor).slice(0, PAGE); qEl.textContent = `… WHERE id < ${cursor == null ? '∞' : cursor} ORDER BY id DESC LIMIT ${PAGE}`; if (got.length) cursor = got[got.length - 1]; }
      const dup = got.filter(id => shown.includes(id));
      shown.push(...got);
      lastPage = got;
      if (!got.length) say('Лента кончилась.');
      else if (dup.length) say(`Пришли посты ${dup.join(', ')}, которые пользователь уже видел: новые посты сверху сдвинули всё вниз. Клиент покажет дубли — или потратит силы на их фильтрацию. А <code>OFFSET 10000</code> к тому же заставляет базу прочитать и выбросить 10 000 строк.`, 'bad');
      else if (shown.length > PAGE) say(mode === 'cursor' ? 'Курсор указывает на конкретный пост, а не на позицию: новые посты сверху ничего не сдвигают. И запрос — поиск по индексу, на любой глубине одинаково быстрый.' : 'Страница без дублей — потому что новых постов не было.', mode === 'cursor' ? 'ok' : '');
      render();
    }
    function addNew() {
      feed.unshift(nextId + 1, nextId);
      nextId += 2;
      say(`Пока пользователь читает, вышли посты ${nextId - 1} и ${nextId - 2}. Они сверху ленты. Листайте дальше.`);
      render();
    }
    function render() {
      cols.innerHTML =
        `<div><span class="label">лента на сервере</span><div class="cu-list">${feed.map(id => `<span class="cu-p ${lastPage.includes(id) ? 'pg' : ''} ${id > 112 ? 'new' : ''}">${id}</span>`).join('')}</div></div>` +
        `<div><span class="label">видит пользователь</span><div class="cu-list">${shown.map((id, i) => `<span class="cu-p ${shown.indexOf(id) < i ? 'dup' : ''}">${id}</span>`).join('')}</div></div>`;
    }
    reset();
    return {};
  });
})();

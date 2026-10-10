// Demos for slides 2–10: interview timeline, requirements, estimation, availability, error budget.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  // Two significant digits, Russian decimal comma: 1,2 / 12 / 120.
  const sig = n => (n < 10 ? dec(n, 1).replace(/,0$/, '') : String(Math.round(n)));
  function num(n) {
    if (n >= 1e12) return sig(n / 1e12) + ' трлн';
    if (n >= 1e9) return sig(n / 1e9) + ' млрд';
    if (n >= 1e6) return sig(n / 1e6) + ' млн';
    if (n >= 1e4) return sig(n / 1e3) + ' тыс.';
    if (n >= 1000) return Math.round(n).toLocaleString('ru-RU');
    return sig(n);
  }
  function bytes(b) {
    const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ', 'ЭБ'];
    let i = 0;
    while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
    return sig(b) + ' ' + u[i];
  }
  function dur(sec) {
    if (sec >= 86400 * 2) return dec(sec / 86400, 1).replace(/,0$/, '') + ' дн.';
    if (sec >= 3600) { const hh = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return hh + ' ч' + (m ? ' ' + m + ' мин' : ''); }
    if (sec >= 60) { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return m + ' мин' + (s ? ' ' + s + ' с' : ''); }
    if (sec >= 1) return Math.round(sec) + ' с';
    return Math.round(sec * 1000) + ' мс';
  }
  const pct = (a, d) => dec(a * 100, d) + '%';

  function logger(el, keep = 1) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  // Range slider over a list of values.
  function listSlider(parent, label, list, idx, show, onChange) {
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
    const set = () => { out.textContent = show(list[+input.value]); };
    set();
    input.addEventListener('input', () => { set(); onChange(); });
    parent.append(h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, label), input, out));
    return { get: () => list[+input.value], set: v => { input.value = Math.max(0, list.indexOf(v)); set(); } };
  }
  window.SD = { dec, sig, num, bytes, dur, pct, logger, listSlider };

  // ---------------------------------------------------------------- interview timeline
  Deck.demo('timeline', root => {
    const ST = [
      ['Требования', 0, 5,
        ['3–4 главных сценария, остальное — явно за рамками', 'масштаб, задержка, доступность, согласованность', 'записать всё в углу доски'],
        '«Фиксирую: создаём ссылки и переходим по ним, 100 млн DAU, редирект быстрее 50 мс, свежесть статистики — минуты. Правильно?»',
        ['сразу рисовать схему', 'спрашивать 15 минут подряд', 'не записать ответы и забыть о них']],
      ['Оценки', 5, 10,
        ['QPS записи и чтения, пик', 'объём данных за годы', 'только то, что влияет на решения'],
        '«Около 35 тысяч чтений в секунду в пике и 18 ТБ за 10 лет — значит, нужен кэш, а базу со временем придётся шардировать».',
        ['считать до третьего знака', 'посчитать и не сделать вывода', 'забыть про пик']],
      ['API и данные', 10, 15,
        ['3–5 эндпоинтов с параметрами', 'сущности и ключи', 'главные шаблоны доступа'],
        '«POST /links, GET /{code}. Таблица links с ключом code, читаем только по нему».',
        ['двадцать эндпоинтов', 'выбрать базу до того, как ясны запросы']],
      ['Схема', 15, 25,
        ['простейшая рабочая схема', 'путь записи и путь чтения по стрелкам', 'каждый компонент — ради требования'],
        '«Запрос на запись идёт так… чтение так… Кэш ставлю, потому что чтений в сто раз больше».',
        ['кубики без потоков данных', 'микросервисы и Kafka «на всякий случай»']],
      ['Углубление', 25, 40,
        ['1–2 самых сложных места: горячие ключи, шардирование, согласованность', 'что будет при отказе каждого компонента', 'альтернативы и почему не они'],
        '«Самое интересное здесь — генерация кодов без координации. Есть три варианта…»',
        ['углубляться в простое', 'ждать, пока интервьюер выберет тему', 'не реагировать на подсказки']],
      ['Итоги', 40, 45,
        ['узкие места при ×10', 'мониторинг: что и по каким SLO', 'принятые компромиссы'],
        '«При росте в 10 раз первым упрётся Redis на горячих ссылках. Мы выбрали доступность вместо строгой согласованности статистики».',
        ['«система идеальна»', 'закончить на полуслове, не успев подвести итог']],
    ];
    const bar = h('div', { class: 'tl-bar' });
    const segs = ST.map(([name, a, b], i) => {
      const seg = h('button', { class: 'tl-seg', style: `flex-grow:${b - a}`, onclick: () => setMin(a), 'aria-label': name },
        h('b', null, String(i + 1)), h('span', null, `${a}–${b}`));
      bar.append(seg);
      return seg;
    });
    const cursor = h('i', { class: 'tl-cursor' });
    bar.append(cursor);
    const input = h('input', { type: 'range', min: 0, max: 44, value: 0, 'aria-label': 'Минута интервью' });
    const out = h('output');
    input.addEventListener('input', () => setMin(+input.value));
    const detail = h('div', { class: 'tl-detail' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(bar, h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Минута'), input, out), detail, logEl);

    function setMin(m) {
      input.value = m;
      out.textContent = m;
      const i = ST.findIndex(s => m >= s[1] && m < s[2]);
      const [name, a, b, todo, say, bad] = ST[i];
      segs.forEach((s, j) => { s.classList.toggle('sel', j === i); s.classList.toggle('past', j < i); });
      cursor.style.left = (m + 0.5) / 45 * 100 + '%';
      detail.innerHTML = `<h3>${i + 1}. ${name} <span>${a}–${b} мин</span></h3>
        <div class="tl-cols">
          <div><span class="label">Что сделать</span><ul>${todo.map(t => `<li>${t}</li>`).join('')}</ul></div>
          <div class="bad"><span class="label">Частые ошибки</span><ul>${bad.map(t => `<li>${t}</li>`).join('')}</ul></div>
        </div>
        <p class="tl-say">${say}</p>`;
      const left = b - m;
      logEl.innerHTML = `Минута ${m}: этап ${i + 1} из 6. До его конца ${left} ${plural(left, ['минута', 'минуты', 'минут'])}` +
        (i === 4 ? ' — это самая длинная часть, здесь видно уровень.' : i === 0 ? '. Сколько бы ни хотелось рисовать — сначала требования.' : '.');
    }
    setMin(0);
    return {};
  });

  // ---------------------------------------------------------------- requirements -> design
  Deck.demo('nfr', root => {
    const COMP = [
      ['client', 'клиент'], ['cdn', 'CDN'], ['lb', 'балансировщик'], ['app', 'сервис'],
      ['redis', 'Redis'], ['pg', 'PostgreSQL'], ['rep', 'реплики'], ['shard', 'шарды'], ['kafka', 'Kafka'], ['ch', 'ClickHouse'],
    ];
    const REQ = [
      ['Ф', 'Создать ссылку и перейти по ней', ['client', 'app', 'pg'], 'Базовая схема: сервис пишет пару код → URL в базу и отвечает редиректом.', true],
      ['Ф', 'Статистика переходов', ['kafka', 'ch'], 'Клик — событие в Kafka, считает ClickHouse. Делать UPDATE счётчика в основной базе на каждый переход — тысячи записей в секунду в одну строку популярной ссылки.'],
      ['НФ', 'Чтений в 100 раз больше записей', ['redis', 'rep'], 'Кэш перед базой: популярные ссылки отдаются из памяти за доли миллисекунды. Реплики забирают остальные чтения.'],
      ['НФ', 'Редирект быстрее 20 мс по всему миру', ['cdn'], 'Один круг через океан — 80 мс и больше. Отвечать нужно из ближайшей точки: CDN или edge-кэш.'],
      ['НФ', 'Доступность 99,99%', ['lb', 'rep'], 'Это 4 минуты простоя в месяц. Ни одной единой точки отказа: по несколько копий сервиса в разных зонах, автоматический фейловер базы.'],
      ['НФ', 'Ссылка работает сразу после создания', [], 'Read-your-writes: новую ссылку сразу кладём в кэш, а при промахе читаем с primary — асинхронная реплика может отставать на секунды.'],
      ['НФ', 'Код нельзя угадать перебором', [], 'Не автоинкремент, а случайные 7 символов base62: 62⁷ ≈ 3,5·10¹² вариантов. Коллизию ловит уникальный ключ — тогда генерируем заново.'],
      ['НФ', '10 млн новых ссылок в сутки, хранить 10 лет', ['shard'], '36 млрд ссылок × 500 Б ≈ 18 ТБ — больше, чем удобно держать на одном узле Postgres. Шардирование по коду или архив старых ссылок.'],
    ];
    const on = new Set([0]);
    const chips = {};
    const diagram = h('div', { class: 'nf-comp' }, COMP.map(([id, name]) => (chips[id] = h('span', { class: 'nf-chip' }, name))));
    const list = h('div', { class: 'nf-list' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    REQ.forEach(([kind, text, , , fixed], i) => {
      const cb = h('input', { type: 'checkbox', checked: on.has(i), disabled: fixed });
      cb.addEventListener('change', () => { cb.checked ? on.add(i) : on.delete(i); render(i, cb.checked); });
      list.append(h('label', { class: 'toggle nf-req' }, cb, h('span', { class: 'nf-kind' + (kind === 'Ф' ? ' f' : '') }, kind), h('span', null, text)));
    });
    root.append(list, h('span', { class: 'label' }, 'Компоненты'), diagram, logEl);

    function render(changed, added) {
      const need = new Set();
      on.forEach(i => REQ[i][2].forEach(c => need.add(c)));
      if (on.has(4)) need.add('lb');
      const fresh = changed != null && added ? new Set(REQ[changed][2]) : new Set();
      COMP.forEach(([id, name]) => {
        chips[id].classList.toggle('on', need.has(id));
        chips[id].classList.toggle('new', fresh.has(id));
        if (id === 'app') chips[id].textContent = on.has(4) || on.has(2) ? 'сервис ×N' : name;
      });
      if (changed == null) logEl.innerHTML = REQ[0][3];
      else if (added) { logEl.innerHTML = `<b>${REQ[changed][1]}</b> → ${REQ[changed][3]}`; logEl.className = 'log'; }
      else { logEl.innerHTML = `Требование «${REQ[changed][1]}» снято — и вместе с ним часть сложности. Лишние компоненты стоят денег и создают новые точки отказа.`; logEl.className = 'log warn'; }
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- back-of-the-envelope calculator
  Deck.demo('estimate', root => {
    const APP_RPS = 2000, SHARD_WPS = 5000, SHARD_BYTES = 2e12, REDIS_OPS = 50000, BLOB = 1e5;
    const PRESETS = [
      ['Сокращатель', [1e8, 0.1, 100, 500, 10, 3]],
      ['Мессенджер', [3e8, 50, 1, 100, 5, 3]],
      ['Лента', [3e8, 0.5, 100, 1000, 5, 3]],
      ['Фотохостинг', [1e8, 0.1, 100, 1e6, 10, 3]],
    ];
    const pre = h('div', { class: 'controls' });
    const btns = PRESETS.map(([name, v]) => {
      const b = h('button', { class: 'btn small', onclick: () => apply(b, v) }, name);
      pre.append(b);
      return b;
    });
    const sl = h('div', { class: 'est-sl' });
    root.append(pre, sl);
    const changed = () => { btns.forEach(b => b.classList.remove('sel')); update(); };
    const S = [
      listSlider(sl, 'DAU', [1e6, 1e7, 5e7, 1e8, 3e8, 1e9], 3, num, changed),
      listSlider(sl, 'Записей на польз. в сутки', [0.1, 0.5, 1, 2, 5, 10, 50], 0, v => dec(v, v < 1 ? 1 : 0), changed),
      listSlider(sl, 'Чтений на запись', [1, 10, 100, 1000], 2, v => v + ':1', changed),
      listSlider(sl, 'Размер объекта', [100, 500, 1e3, 1e4, 1e5, 1e6, 5e6], 1, bytes, changed),
      listSlider(sl, 'Хранить, лет', [1, 3, 5, 10], 3, String, changed),
      listSlider(sl, 'Пик / среднее', [2, 3, 5, 10], 1, v => '×' + v, changed),
    ];
    const stats = h('div', { class: 'stats est-stats' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(stats, logEl, h('p', { class: 'note est-note' },
      `Допущения: сервис — ${num(APP_RPS)} rps на сервер, шард Postgres — ${num(SHARD_WPS)} записей/с и ${bytes(SHARD_BYTES)}, Redis — ${num(REDIS_OPS)} операций/с на узел с запасом, 3 копии данных.`));

    function apply(b, v) {
      S.forEach((s, i) => s.set(v[i]));
      btns.forEach(x => x.classList.toggle('sel', x === b));
      update();
    }
    const stat = (v, label, warn) => `<div class="stat${warn ? ' warn' : ''}"><b>${v}</b><span>${label}</span></div>`;
    function update() {
      const [dau, wpu, ratio, size, years, peak] = S.map(s => s.get());
      const perDay = dau * wpu;
      const wps = perDay / 86400, rps = wps * ratio;
      const blob = size >= BLOB;
      const row = blob ? 1000 : size;
      const yearBytes = perDay * size * 365;
      const total = yearBytes * years * 3;
      const dbBytes = perDay * row * 365 * years;
      const outBps = rps * peak * size * 8;
      const apps = Math.max(2, Math.ceil((wps + rps) * peak / APP_RPS) + 1);
      const byW = Math.ceil(wps * peak / SHARD_WPS), byS = Math.ceil(dbBytes / SHARD_BYTES);
      const shards = Math.max(1, byW, byS);
      const redis = rps * peak > 20000 ? Math.ceil(rps * peak / REDIS_OPS) : 0;
      stats.innerHTML =
        stat(num(wps) + '/с', `запись, пик ${num(wps * peak)}/с`) +
        stat(num(rps) + '/с', `чтение, пик ${num(rps * peak)}/с`) +
        stat(bytes(perDay * size), 'новых данных в сутки') +
        stat(bytes(yearBytes), 'за год, одна копия') +
        stat(bytes(total), `за ${years} ${plural(years, ['год', 'года', 'лет'])} × 3 копии`, total > 1e15) +
        stat(outBps >= 1e9 ? sig(outBps / 1e9) + ' Гбит/с' : sig(outBps / 1e6) + ' Мбит/с', 'исходящий трафик в пик', outBps > 100e9) +
        stat(apps, 'серверов приложения') +
        stat(shards, plural(shards, ['шард', 'шарда', 'шардов']) + ' базы' + (byW >= byS && shards > 1 ? ' (по записи)' : shards > 1 ? ' (по объёму)' : ''), shards > 1) +
        stat(redis ? redis : '—', redis ? 'узлов Redis на чтения' : 'кэш не обязателен');
      const calc = `${num(dau)} × ${dec(wpu, wpu < 1 ? 1 : 0)} ÷ 86 400 с ≈ ${num(wps)} записей/с.`;
      let verdict, cls = 'ok';
      if (blob) { verdict = `Объекты по ${bytes(size)} — в объектное хранилище (S3) и CDN, в базе только метаданные. Трафик ${outBps >= 1e9 ? sig(outBps / 1e9) + ' Гбит/с' : 'небольшой'} — главная статья расходов.`; cls = 'warn'; }
      else if (shards > 1) { verdict = `Одна база не справится ${byW >= byS ? 'с записью' : 'с объёмом'}: нужен шардинг на ~${shards}. Выбор ключа шардирования станет главной темой углубления.`; cls = 'warn'; }
      else if (rps * peak > 20000) verdict = 'Запись помещается в один primary. Чтения — в кэш и реплики. Шардировать пока рано.';
      else verdict = 'Всё помещается в одну базу с репликой. Сказать это вслух — сильный сигнал: не усложняйте.';
      logEl.innerHTML = `${calc} ${verdict}`;
      logEl.className = 'log ' + cls;
    }
    btns[0].click();
    return {};
  });

  // ---------------------------------------------------------------- nines
  Deck.demo('nines', root => {
    const LV = [
      [0.9, 'Простой больше месяца в год. Так работает внутренний инструмент, который никто не мониторит.'],
      [0.99, 'Больше 7 часов в месяц. Можно чинить вручную в рабочее время, деплоить с перезапуском.'],
      [0.995, 'Типичный SLA недорогого облачного сервиса на одной машине.'],
      [0.999, '43 минуты в месяц: один ручной разбор инцидента ночью съедает весь бюджет. Нужны дежурства, алерты и откат релизов за минуты.'],
      [0.9995, 'Около 22 минут в месяц. Типичный SLA управляемой базы данных в одной зоне.'],
      [0.9999, '4 минуты в месяц — человек не успеет даже открыть ноутбук. Только автоматика: фейловер, несколько зон, деплой без простоя, постепенная выкатка.'],
      [0.99999, '26 секунд в месяц. Несколько регионов, автоматическое переключение трафика, и всё равно один плохой конфиг всё испортит. Стоит очень дорого.'],
    ];
    const EV = [['ручной разбор инцидента дежурным', 1800], ['откат плохого релиза', 600], ['перезапуск при деплое', 60], ['автофейловер базы (Patroni)', 30]];
    const YEAR = 365 * 86400, MONTH = 30 * 86400;
    const input = h('input', { type: 'range', min: 0, max: LV.length - 1, value: 3, 'aria-label': 'Доступность' });
    const out = h('output', { class: 'nn-out' });
    input.addEventListener('input', update);
    const stats = h('div', { class: 'stats nn-stats' });
    const ev = h('div', { class: 'nn-ev' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Доступность'), input, out), stats,
      h('span', { class: 'label' }, 'Сколько раз в месяц можно себе позволить'), ev, logEl);
    function update() {
      const [a, text] = LV[+input.value];
      const u = 1 - a;
      out.textContent = (a * 100).toLocaleString('ru-RU', { maximumFractionDigits: 3 }) + '%';
      stats.innerHTML = [['в год', YEAR], ['в месяц', MONTH], ['в неделю', 7 * 86400], ['в сутки', 86400]]
        .map(([l, t]) => `<div class="stat"><b>${dur(u * t)}</b><span>простоя ${l}</span></div>`).join('');
      const budget = u * MONTH;
      ev.innerHTML = EV.map(([name, t]) => {
        const n = Math.floor(budget / t);
        return `<div class="nn-row${n ? '' : ' no'}"><span>${name}, ~${dur(t)}</span><b>${n ? (n > 99 ? '99+' : '×' + n) : 'не влезает'}</b></div>`;
      }).join('');
      logEl.textContent = text;
      logEl.className = 'log' + (a >= 0.9999 ? ' warn' : '');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- serial / parallel availability
  Deck.demo('avail', root => {
    const C = [
      { name: 'балансировщик', a: 0.9999, n: 1, rep: true, soft: null },
      { name: 'сервис', a: 0.999, n: 1, rep: true, soft: null },
      { name: 'Redis', a: 0.999, n: 1, rep: true, soft: false, softText: 'промах → в базу' },
      { name: 'PostgreSQL', a: 0.9995, n: 1, rep: true, soft: null },
      { name: 'платёжный API', a: 0.999, n: 1, rep: false, soft: false, softText: 'через очередь' },
    ];
    const chain = h('div', { class: 'av-chain' });
    const rows = h('div', { class: 'av-rows' });
    const total = h('div', { class: 'av-total' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(chain, rows, total, logEl);
    const eff = c => 1 - Math.pow(1 - c.a, c.n);
    const fmtA = a => {
      const u = (1 - a) * 100;
      if (u < 1e-6) return '≈100%';
      const d = Math.max(1, Math.min(7, Math.ceil(-Math.log10(u)) + 1));
      return (a * 100).toFixed(d).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',') + '%';
    };
    C.forEach((c, i) => {
      const seg = h('div', { class: 'av-seg' }, [1, 2, 3].map(n => h('button', {
        class: 'btn small' + (n === 1 ? ' sel' : ''), disabled: !c.rep && n > 1, 'aria-label': `${c.name}: ${n} копии`,
        onclick: e => { c.n = n; [...seg.children].forEach(b => b.classList.toggle('sel', b === e.currentTarget)); update(i, 'n'); },
      }, '×' + n)));
      let soft = null;
      if (c.soft !== null) {
        const cb = h('input', { type: 'checkbox' });
        cb.addEventListener('change', () => { c.soft = cb.checked; update(i, 'soft'); });
        soft = h('label', { class: 'toggle av-soft' }, cb, h('span', null, c.softText));
      }
      c.out = h('b', { class: 'av-a' });
      rows.append(h('div', { class: 'av-row' }, h('span', { class: 'av-name' }, c.name, h('small', null, fmtA(c.a))), seg, c.out, soft || h('span')));
    });
    function update(i, what) {
      let a = 1;
      chain.innerHTML = '';
      C.forEach((c, j) => {
        const e = eff(c);
        if (!c.soft) a *= e;
        c.out.textContent = c.soft ? 'мягкая' : fmtA(e);
        c.out.classList.toggle('soft', !!c.soft);
        if (j) chain.append(h('span', { class: 'av-arrow' }, '→'));
        chain.append(h('span', { class: 'av-node' + (c.soft ? ' soft' : '') }, Array.from({ length: c.n }, () => h('i')), c.name));
      });
      const down = (1 - a) * 365 * 86400;
      total.innerHTML = `<span class="label">Вся цепочка</span><b>${fmtA(a)}</b><span>${dur(down)} простоя в год</span>`;
      if (i == null) logEl.innerHTML = 'Пять компонентов по одной копии: доступность ниже, чем у самого слабого из них.';
      else {
        const c = C[i];
        if (what === 'n') logEl.innerHTML = c.n === 1 ? `${c.name}: одна копия — единая точка отказа.` :
          `${c.name} ×${c.n}: недоступен, только если упали все копии сразу — 1 − ${dec((1 - c.a) * 100, 2)}%${c.n === 2 ? '²' : '³'} ${fmtA(eff(c)).startsWith('≈') ? '' : '= '}${fmtA(eff(c))}. Если, конечно, копии падают независимо.`;
        else logEl.innerHTML = c.soft ? `${c.name} — мягкая зависимость (${c.softText}): его отказ не роняет запрос, а замедляет или откладывает работу. Нужен таймаут — иначе мягкая зависимость зависнет и станет жёсткой.` :
          `${c.name} снова в цепочке: его отказ — отказ всего запроса.`;
      }
      logEl.className = 'log' + (a >= 0.9999 ? ' ok' : '');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- error budget
  Deck.demo('budget', root => {
    const RPS = 1000, MONTH = 30 * 86400, TOTAL = RPS * MONTH;
    const SLOS = [0.99, 0.995, 0.999, 0.9995, 0.9999];
    const INC = [
      ['Плохой релиз', 'плохой релиз: 5% ошибок 30 минут до отката', 0.05 * 1800 * RPS],
      ['Фейловер базы', 'фейловер базы: все запросы падают 40 секунд', 40 * RPS],
      ['Отказ зоны', 'отказ одной зоны из трёх на 15 минут, пока трафик не ушёл', 900 * RPS / 3],
      ['Медленная зависимость', 'медленная зависимость: 2% ответов дольше 300 мс в течение 2 часов (SLI по задержке)', 0.02 * 7200 * RPS],
    ];
    let slo = 0.999, spent = 0, hist = [];
    const sloBtns = h('div', { class: 'controls' }, h('span', { class: 'label' }, 'SLO'));
    const sb = SLOS.map(s => {
      const b = h('button', { class: 'btn small' + (s === slo ? ' sel' : ''), onclick: () => { slo = s; sb.forEach(x => x.classList.toggle('sel', x === b)); render('slo'); } },
        (s * 100).toLocaleString('ru-RU') + '%');
      sloBtns.append(b);
      return b;
    });
    const incBtns = h('div', { class: 'controls' }, INC.map(([short, , cost], i) => h('button', { class: 'btn small', onclick: () => { spent += cost; hist.push(i); render(i); } }, short)),
      h('button', { class: 'btn small', onclick: () => { spent = 0; hist = []; render('reset'); } }, 'Новый месяц'));
    const meter = h('div', { class: 'bd-meter' });
    const info = h('div', { class: 'bd-info' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(sloBtns, h('span', { class: 'label' }, 'Инциденты'), incBtns, meter, info, logEl);

    function render(ev) {
      const budget = (1 - slo) * TOTAL;
      const used = spent / budget;
      meter.innerHTML = hist.map(i => `<span class="bd-inc c${i}" style="width:${Math.min(100, INC[i][2] / budget * 100)}%" title="${INC[i][0]}"></span>`).join('') +
        `<em>${pct(Math.min(used, 9.99), 0)}</em>`;
      meter.classList.toggle('over', used >= 1);
      info.innerHTML = `<div class="stat"><b>${num(budget)}</b><span>плохих запросов можно за 30 дней</span></div>` +
        `<div class="stat"><b>${dur(budget / RPS)}</b><span>это полного простоя</span></div>` +
        `<div class="stat${used >= 1 ? ' warn' : ''}"><b>${used >= 1 ? '−' + num(spent - budget) : num(budget - spent)}</b><span>${used >= 1 ? 'перерасход' : 'осталось'}</span></div>`;
      if (ev === 'slo') { logEl.innerHTML = `SLO ${(slo * 100).toLocaleString('ru-RU')}% при ${num(TOTAL)} запросах в месяц — бюджет ${num(budget)} ошибок. Каждая девятка уменьшает его в 10 раз.`; }
      else if (ev === 'reset' || ev == null) logEl.innerHTML = 'Новое окно в 30 дней: бюджет снова полный. Выберите SLO и устраивайте инциденты.';
      else logEl.innerHTML = `${INC[ev][1][0].toUpperCase() + INC[ev][1].slice(1)} — ${num(INC[ev][2])} плохих запросов, ${pct(INC[ev][2] / budget, 0)} бюджета.`;
      if (used >= 1) { logEl.innerHTML += ' <b>Бюджет исчерпан:</b> до конца окна — заморозка фич, только работа над надёжностью.'; logEl.className = 'log bad'; }
      else logEl.className = 'log' + (used > 0.5 ? ' warn' : '');
    }
    render();
    return {};
  });
})();

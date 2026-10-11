// Demos for slides 2–10: agent loop, prompt stuffing, progressive disclosure, context calculator,
// skill selection by description, message trace. Shared helpers are exported as window.AS.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const tok = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' млн'
    : n >= 1e4 ? fmt(n / 1000) + ' тыс.' : fmt(n);
  const pct = (a, b) => (a / b * 100).toFixed(a / b < 0.1 ? 1 : 0).replace('.', ',') + '%';

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  function choice(root, items, val, onChange) {
    const box = h('div', { class: 'controls seg', role: 'group' });
    const btns = items.map(([v, label]) => {
      const b = h('button', { class: 'btn small' + (v === val ? ' sel' : ''), onclick: () => { set(v); onChange(v); } }, label);
      b.dataset.v = v;
      box.append(b);
      return b;
    });
    function set(v) { btns.forEach(b => b.classList.toggle('sel', b.dataset.v === String(v))); }
    root.append(box);
    return { el: box, set };
  }
  function slider(label, min, max, step, val, show, onInput) {
    const out = h('output');
    const inp = h('input', { type: 'range', min, max, step, value: val });
    const upd = () => { out.textContent = show(+inp.value); onInput(+inp.value); };
    inp.addEventListener('input', upd);
    const el = h('label', { class: 'slider' }, h('span', { class: 'label' }, label, ': ', out), inp);
    return { el, input: inp, init: upd };
  }
  const stat = (b, s, cls = '') => `<div class="stat ${cls}"><b>${b}</b><span>${s}</span></div>`;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  window.AS = { fmt, tok, pct, logger, choice, slider, stat, esc };

  const ROLE = { system: 'system', user: 'user', assistant: 'assistant', tool: 'tool_result' };

  // ---------------------------------------------------------------- agent loop
  Deck.demo('loop', root => {
    const WINDOW = 200000;
    const BASE = [
      { role: 'system', text: 'Системный промпт: кто ты, правила, окружение', tok: 3200 },
      { role: 'system', text: 'Описания инструментов: Read, Edit, Bash, Grep…', tok: 11800 },
    ];
    const EVENTS = [
      { who: 'user', role: 'user', text: '«Тест test_login падает, почини»', tok: 40 },
      { who: 'model', role: 'assistant', text: 'tool_use: Read("auth/login.py")', tok: 60 },
      { who: 'tool', role: 'tool', text: 'содержимое login.py, 310 строк', tok: 3100 },
      { who: 'model', role: 'assistant', text: 'tool_use: Bash("pytest tests/test_login.py")', tok: 50 },
      { who: 'tool', role: 'tool', text: 'FAILED: KeyError \'exp\' + трейсбек', tok: 1400 },
      { who: 'model', role: 'assistant', text: 'tool_use: Edit(login.py: проверка exp)', tok: 350 },
      { who: 'tool', role: 'tool', text: 'файл изменён', tok: 20 },
      { who: 'model', role: 'assistant', text: 'tool_use: Bash("pytest tests/test_login.py")', tok: 50 },
      { who: 'tool', role: 'tool', text: '1 passed in 0.41s', tok: 60 },
      { who: 'model', role: 'assistant', text: 'Текст: «Починил: токен без exp…» — инструмента нет, цикл окончен', tok: 120 },
    ];
    let n = 0, calls = 0, readTotal = 0;
    const cyc = h('div', { class: 'lp-cycle' });
    const nodes = {
      model: h('div', { class: 'lp-node' }, h('b', null, 'Модель'), h('small', null, 'читает весь контекст')),
      tool: h('div', { class: 'lp-node' }, h('b', null, 'Агент'), h('small', null, 'выполняет инструмент')),
    };
    cyc.append(nodes.model, h('div', { class: 'lp-arrows' }, h('span', null, 'tool_use →'), h('span', null, '← tool_result')), nodes.tool);
    const msgs = h('div', { class: 'lp-msgs' });
    const fill = h('span', { class: 'fill' });
    const ctxLabel = h('span', { class: 'lp-ctx-n' });
    const stats = h('div', { class: 'stats' });
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(cyc, msgs,
      h('div', { class: 'lp-ctx' }, h('span', { class: 'label' }, 'Контекст'), h('span', { class: 'track' }, fill), ctxLabel),
      stats, h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала')), logEl);

    const ctx = () => BASE.concat(EVENTS.slice(0, n)).reduce((s, m) => s + m.tok, 0);
    function reset() {
      n = 0; calls = 0; readTotal = 0;
      say('В контексте пока только системный промпт и описания инструментов. Нажмите «Шаг».');
      render();
    }
    function step() {
      if (n >= EVENTS.length) return;
      const e = EVENTS[n];
      if (e.who === 'model') {
        calls++;
        readTotal += ctx();
        say(`Вызов модели №${calls}: она заново прочитала все ${fmt(ctx())} токенов контекста и ответила ${e.text.startsWith('tool_use') ? 'вызовом инструмента' : 'текстом'}. ${n === EVENTS.length - 1 ? 'Вызова инструмента нет — агент останавливается.' : 'Агент выполнит инструмент.'}`, n === EVENTS.length - 1 ? 'ok' : '');
      } else if (e.who === 'tool') {
        say(`Агент (обычная программа) выполнил инструмент и дописал результат в разговор: +${fmt(e.tok)} токенов. Модель ничего не «помнит» — она увидит это только в следующем вызове.`);
      } else {
        say('Сообщение пользователя дописано в конец разговора.');
      }
      n++;
      render();
    }
    function render() {
      msgs.innerHTML = '';
      const all = BASE.concat(EVENTS.slice(0, n));
      all.forEach((m, i) => msgs.append(h('div', { class: 'lp-msg r-' + m.role + (i === all.length - 1 && n ? ' new' : '') },
        h('span', { class: 'role' }, ROLE[m.role]), h('span', { class: 'txt' }, m.text), h('span', { class: 'tk' }, '+' + fmt(m.tok)))));
      msgs.scrollTop = msgs.scrollHeight;
      const c = ctx();
      fill.style.width = Math.max(0.5, c / WINDOW * 100) + '%';
      ctxLabel.textContent = `${fmt(c)} из 200 тыс.`;
      const next = EVENTS[n];
      nodes.model.classList.toggle('on', !!next && next.who === 'model');
      nodes.tool.classList.toggle('on', !!next && next.who === 'tool');
      stats.innerHTML = stat(fmt(c), 'токенов в контексте') + stat(calls, plural(calls, ['вызов модели', 'вызова модели', 'вызовов модели']))
        + stat(tok(readTotal), 'входных токенов прочитано всего');
      stepBtn.disabled = n >= EVENTS.length;
      stepBtn.textContent = !next ? 'Готово' : next.who === 'model' ? 'Шаг: вызвать модель' : next.who === 'tool' ? 'Шаг: выполнить инструмент' : 'Шаг: сообщение';
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- prompt stuffing
  Deck.demo('stuff', root => {
    const WINDOW = 200000, BASE = 15000, BOOK = 2500, PER_TURN = 1200, PRICE = 3; // $ за 1 млн входных токенов
    let books = 20, turns = 40, cache = false;
    const bar = h('div', { class: 'st-bar' });
    const legend = h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'sw base' }), 'система и инструменты'),
      h('span', null, h('i', { class: 'sw rel' }), 'нужный регламент'),
      h('span', null, h('i', { class: 'sw irr' }), 'ненужные регламенты'));
    const s1 = slider('Регламентов в системном промпте (по 2 500 токенов)', 0, 60, 1, books, v => v, v => { books = v; render(); });
    const s2 = slider('Вызовов модели за сессию', 5, 100, 5, turns, v => v, v => { turns = v; render(); });
    const cb = h('input', { type: 'checkbox' });
    cb.addEventListener('change', () => { cache = cb.checked; render(); });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(h('span', { class: 'label' }, 'Контекст перед первым шагом (из 200 тыс.)'), bar, legend, s1.el, s2.el,
      h('label', { class: 'toggle' }, cb, 'Кэширование промпта (чтение из кэша — 10% цены, запись — 125%)'), stats, logEl);

    function session(p) {
      let total = 0, cost = 0, prev = 0, overflow = 0;
      for (let i = 0; i < turns; i++) {
        const c = BASE + p * BOOK + i * PER_TURN;
        if (c > WINDOW && !overflow) overflow = i + 1;
        total += c;
        cost += cache ? (prev * 0.1 + (c - prev) * 1.25) : c;
        prev = c;
      }
      return { total, cost: cost / 1e6 * PRICE, overflow };
    }
    function render() {
      const first = BASE + books * BOOK;
      const rel = books ? BOOK : 0, irr = Math.max(0, books - 1) * BOOK;
      bar.innerHTML = '';
      [['base', BASE], ['rel', rel], ['irr', irr]].forEach(([c, v]) => { if (v) bar.append(h('i', { class: c, style: `width:${v / WINDOW * 100}%` })); });
      const a = session(books), b = session(books ? 1 : 0);
      stats.innerHTML = stat(pct(first, WINDOW), 'окна занято до начала работы')
        + stat(tok(a.total), 'входных токенов за сессию')
        + stat('$' + a.cost.toFixed(2).replace('.', ','), 'за сессию при $3/млн', books > 4 ? 'warn' : '');
      const share = books ? (irr / first) : 0;
      let msg = books
        ? `Задаче нужен один регламент из ${books}. Ненужные — ${pct(irr, first)} контекста на каждом из ${turns} шагов. С одним нужным регламентом сессия стоила бы $${b.cost.toFixed(2).replace('.', ',')}.`
        : 'Регламентов нет: модель должна сама догадываться о правилах команды.';
      if (cache && books) msg += ' Кэш снижает цену, но не освобождает окно и не убирает лишний текст из внимания модели.';
      if (a.overflow) msg += ` Окно переполнится на ${a.overflow}-м вызове.`;
      share > 0.5 || a.overflow ? (logEl.className = 'log bad') : (logEl.className = 'log');
      logEl.innerHTML = msg;
    }
    s1.init(); s2.init();
    return {};
  });

  // ---------------------------------------------------------------- progressive disclosure
  Deck.demo('disclosure', root => {
    const FILES = [
      { id: 'meta', name: 'name + description', tok: 90, kind: 'meta' },
      { id: 'body', name: 'SKILL.md (тело)', tok: 1900, kind: 'md' },
      { id: 'forms', name: 'forms.md', tok: 2400, kind: 'md' },
      { id: 'ref', name: 'reference.md', tok: 6500, kind: 'md' },
      { id: 'analyze', name: 'scripts/analyze_form.py', tok: 1300, kind: 'py' },
      { id: 'fill', name: 'scripts/fill_form.py', tok: 1600, kind: 'py' },
    ];
    const SC = {
      form: {
        label: 'Заполни w9.pdf',
        steps: [
          { log: 'Старт сессии. Из всего скила в контексте только описание: 90 токенов. Остальное лежит на диске.' },
          { user: '«Заполни w9.pdf данными из clients.csv»', log: 'Модель видит в списке описание «Заполняет PDF-формы… анкету, бланк или форму» — подходит.' },
          { load: 'body', log: 'Скил выбран: тело SKILL.md читается в контекст (+1 900). В нём раздел «Заполнить форму» и ссылка на forms.md.' },
          { load: 'forms', log: 'Задача — форма, поэтому модель открывает forms.md (+2 400). reference.md про pdfplumber не нужен — не читается.' },
          { run: 'analyze', out: 280, log: 'Запуск analyze_form.py: код скрипта (1 300 токенов) в контекст не попадает, только его вывод — JSON с полями формы (+280).' },
          { run: 'fill', out: 40, log: 'Запуск fill_form.py: в контекст попадает одна строка «OK: 14 полей, w9-filled.pdf» (+40). Готово.' },
        ],
      },
      text: {
        label: 'Извлеки текст',
        steps: [
          { log: 'Старт сессии. Из всего скила в контексте только описание: 90 токенов.' },
          { user: '«Извлеки текст из report.pdf и перескажи»', log: 'Описание говорит «извлекает из PDF текст» — подходит.' },
          { load: 'body', log: 'Тело SKILL.md в контексте (+1 900). Раздел «Извлечь текст» содержит готовый фрагмент с pdfplumber.' },
          { done: true, log: 'Модель запускает фрагмент из SKILL.md. Ни forms.md, ни reference.md, ни скрипты для форм ей не понадобились — они так и остались на диске.' },
        ],
      },
      none: {
        label: 'Переведи README',
        steps: [
          { log: 'Старт сессии. Из всего скила в контексте только описание: 90 токенов.' },
          { user: '«Переведи README на английский»', log: 'Ни одно слово запроса не связано с PDF и формами — модель не загружает скил.' },
          { done: true, log: 'Скил стоил 90 токенов описания на каждом шаге. Тело и файлы — ноль.' },
        ],
      },
    };
    let sc = 'form', i = 0;
    choice(root, Object.entries(SC).map(([k, v]) => [k, v.label]), sc, v => { sc = v; i = 0; render(); });
    const user = h('div', { class: 'ds-user' });
    const list = h('div', { class: 'ds-files' });
    const bar = h('div', { class: 'ds-bar' });
    const sum = h('div', { class: 'ds-sum' });
    const next = h('button', { class: 'btn primary', onclick: () => { i++; render(); } }, 'Следующий шаг');
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(user, list, h('span', { class: 'label' }, 'Скил в контексте и на диске'), bar, sum,
      h('div', { class: 'controls' }, next, h('button', { class: 'btn', onclick: () => { i = 0; render(); } }, 'Сначала')), logEl);

    function render() {
      const steps = SC[sc].steps;
      const st = { meta: 'ctx' }, outs = {};
      let u = '';
      steps.slice(0, i + 1).forEach(s => {
        if (s.user) u = s.user;
        if (s.load) st[s.load] = 'ctx';
        if (s.run) { st[s.run] = 'ran'; outs[s.run] = s.out; }
      });
      user.innerHTML = u ? `<span class="role">user</span> ${u}` : '<span class="role">user</span> <i>ещё ничего не спросил</i>';
      list.innerHTML = '';
      bar.innerHTML = '';
      const total = FILES.reduce((s, f) => s + f.tok, 0);
      let inCtx = 0;
      FILES.forEach(f => {
        const s = st[f.id] || 'disk';
        const chip = s === 'ctx' ? 'в контексте' : s === 'ran' ? `запущен → +${outs[f.id]}` : 'на диске';
        list.append(h('div', { class: `ds-file ${s} k-${f.kind}` },
          h('span', { class: 'nm' }, f.name), h('span', { class: 'tk' }, fmt(f.tok)), h('span', { class: 'st' }, chip)));
        if (s === 'ctx') inCtx += f.tok;
        if (s === 'ran') inCtx += outs[f.id];
        bar.append(h('i', { class: s, style: `flex:${f.tok}`, title: f.name }));
      });
      sum.innerHTML = `В контексте: <b>${fmt(inCtx)}</b> токенов из ${fmt(total)}, что есть в скиле`;
      const s = steps[Math.min(i, steps.length - 1)];
      logEl.innerHTML = s.log;
      logEl.className = 'log' + (i >= steps.length - 1 ? ' ok' : '');
      next.disabled = i >= steps.length - 1;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- context calculator
  Deck.demo('calc', root => {
    let n = 40, body = 2000, res = 6000, used = 2, win = 200000;
    choice(root, [[200000, 'Окно 200 тыс.'], [1000000, 'Окно 1 млн']], win, v => { win = +v; render(); });
    const sl = [
      slider('Скилов установлено', 5, 200, 5, n, v => v, v => { n = v; render(); }),
      slider('Тело SKILL.md, токенов', 500, 5000, 100, body, fmt, v => { body = v; render(); }),
      slider('Справочники и скрипты, токенов на скил', 0, 20000, 500, res, fmt, v => { res = v; render(); }),
      slider('Скилов используется за сессию', 0, 5, 1, used, v => v, v => { used = v; render(); }),
    ];
    const grid = h('div', { class: 'cc-sliders' }, sl.map(s => s.el));
    const rows = h('div', { class: 'cc-rows' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(grid, rows, logEl);

    function row(label, v, cls) {
      const over = v > win;
      return h('div', { class: 'cc-row ' + cls + (over ? ' over' : '') },
        h('span', { class: 'cc-l' }, label),
        h('span', { class: 'cc-track' }, h('i', { style: `width:${Math.min(100, Math.max(0.4, v / win * 100))}%` })),
        h('span', { class: 'cc-v' }, over ? `${tok(v)} > окна` : `${tok(v)} · ${pct(v, win)}`));
    }
    function render() {
      if (!sl.every(s => s.input)) return;
      const all = n * (100 + body + res);
      const k = Math.min(used, n);
      const meta = n * 100;
      const prog = meta + k * (body + 0.3 * res);
      rows.innerHTML = '';
      rows.append(row('Всё в системный промпт', all, 'all'), row('Прогрессивное раскрытие', prog, 'prog'), row('из них описания', meta, 'meta'));
      const budget = win * 0.01;
      let msg = `Выигрыш в ${fmt(all / Math.max(1, prog))} раз. При раскрытии платим за ${n} ${plural(n, ['описание', 'описания', 'описаний'])} всегда и за ${k} ${plural(k, ['скил', 'скила', 'скилов'])} — только когда нужны (считаем, что из справочников читается треть).`;
      if (meta > budget) msg += ` Список описаний (${tok(meta)}) больше бюджета Claude Code ≈ 1% окна (${tok(budget)}): у редко вызываемых скилов описания будут выброшены, и модель перестанет их находить.`;
      logEl.innerHTML = msg;
      logEl.className = 'log' + (meta > budget ? ' warn' : ' ok');
    }
    sl.forEach(s => s.init());
    return {};
  });

  // ---------------------------------------------------------------- skill selection
  Deck.demo('pick', root => {
    const SK = [
      { id: 'pdf-forms', good: 'Заполняет PDF-формы и извлекает из PDF текст и таблицы. Используй, когда пользователь упоминает PDF, анкету, бланк или форму.', bad: 'Работа с документами.' },
      { id: 'db-migrations', good: 'Создаёт миграции PostgreSQL (alembic) для этого репозитория. Используй при изменении схемы БД: новые таблицы, колонки, индексы.', bad: 'Помогает с базой.' },
      { id: 'release-notes', good: 'Пишет release notes по git log между тегами. Используй, когда просят changelog, описание версии или «что нового».', bad: 'Пишет тексты.' },
      { id: 'incident', good: 'Разбирает инцидент: логи из Loki, графики Grafana, хронология. Используй при алертах, ошибках 5xx, «прод лежит».', bad: 'Утилиты для продакшена.' },
    ];
    const Q = [
      { q: 'Заполни анкету w9 из clients.csv',
        good: { pick: 'pdf-forms', marks: { 'pdf-forms': ['анкету', 'Заполняет PDF-формы'] }, text: 'Слово «анкета» прямо есть в описании. Модель вызывает pdf-forms.', cls: 'ok' },
        bad: { pick: '?pdf-forms', marks: { 'pdf-forms': ['документами'] }, text: '«Работа с документами» — анкета, наверное, документ? Модель может загрузить скил, а может решить, что справится сама. Результат нестабилен.', cls: 'warn' } },
      { q: 'Добавь колонку email_verified в users',
        good: { pick: 'db-migrations', marks: { 'db-migrations': ['колонки', 'изменении схемы БД'] }, text: '«Колонка» и «изменение схемы» — прямое совпадение. Будет миграция alembic, а не правка модели ORM без миграции.', cls: 'ok' },
        bad: { pick: null, marks: { 'db-migrations': ['базой'] }, text: '«Помогает с базой» — непонятно с чем. Скорее всего модель просто поправит класс модели в коде и забудет про миграцию.', cls: 'bad' } },
      { q: 'Что нового с версии 2.3?',
        good: { pick: 'release-notes', marks: { 'release-notes': ['«что нового»', 'между тегами'] }, text: 'Пользователь сказал «что нового» — эти слова есть в описании. Скил пройдёт git log между v2.3 и HEAD.', cls: 'ok' },
        bad: { pick: null, marks: {}, text: '«Пишет тексты» не говорит ни о версиях, ни о git. Модель ответит по памяти или полезет в git log без вашего формата.', cls: 'bad' } },
      { q: 'Прод отдаёт 502, глянь',
        good: { pick: 'incident', marks: { 'incident': ['5xx', '«прод лежит»'] }, text: '502 — это 5xx, «прод» — из описания. Скил подскажет, где логи и как собрать хронологию.', cls: 'ok' },
        bad: { pick: '?incident', marks: { 'incident': ['продакшена'] }, text: '«Утилиты для продакшена» — слово «прод» совпало, но что внутри, модель не знает. Может загрузить, может нет.', cls: 'warn' } },
      { q: 'Переведи README на английский',
        good: { pick: null, marks: {}, text: 'Ни одно описание не подходит — и правильно: скилы не загружаются, контекст не тратится.', cls: 'ok' },
        bad: { pick: 'release-notes', marks: { 'release-notes': ['Пишет тексты'] }, text: 'Ложное срабатывание: перевод — тоже «текст». Модель грузит release-notes, и его правила про формат changelog мешают задаче.', cls: 'bad' } },
    ];
    let mode = 'good', qi = 0;
    choice(root, [['good', 'Хорошие описания'], ['bad', 'Плохие описания']], mode, v => { mode = v; render(); });
    const qbox = h('div', { class: 'pk-qs' });
    Q.forEach((q, i) => qbox.append(h('button', { class: 'btn small', onclick: () => { qi = i; render(); } }, '«' + q.q + '»')));
    const list = h('div', { class: 'pk-list' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(qbox, h('span', { class: 'label' }, 'Список скилов в контексте модели'), list, logEl);

    function mark(text, phrases) {
      let html = esc(text);
      phrases.forEach(p => { html = html.replace(esc(p), `<mark>${esc(p)}</mark>`); });
      return html;
    }
    function render() {
      [...qbox.children].forEach((b, i) => b.classList.toggle('sel', i === qi));
      const c = Q[qi][mode];
      const pick = c.pick && c.pick.replace('?', '');
      const maybe = c.pick && c.pick.startsWith('?');
      list.innerHTML = '';
      SK.forEach(s => {
        const on = s.id === pick;
        list.append(h('div', { class: 'pk-sk' + (on ? (maybe ? ' maybe' : ' chosen') : '') },
          h('code', null, s.id), h('span', { html: mark(s[mode], c.marks[s.id] || []) }),
          on ? h('em', null, maybe ? 'может быть' : 'Skill(…)') : null));
      });
      logEl.innerHTML = c.text;
      logEl.className = 'log ' + c.cls;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- message trace
  Deck.demo('trace', root => {
    const LIST = 'The following skills are available for use with the Skill tool:\n- pdf-forms: Заполняет PDF-формы… Используй, когда…\n- db-migrations: Создаёт миграции…   (ещё 38)';
    const BODY = '# PDF: формы и извлечение\n## Заполнить форму\n1. python scripts/analyze_form.py in.pdf > fields.json …';
    const MODES = {
      auto: { label: 'Claude Code: сам', steps: [
        { role: 'system', text: LIST, tok: 3800, log: 'Список скилов — имя и описание каждого — Claude Code кладёт в контекст в начале сессии.' },
        { role: 'user', text: 'Заполни w9.pdf данными из clients.csv', tok: 20, log: 'Пользователь не упоминал скил. Модель сама сопоставит запрос с описаниями.' },
        { role: 'assistant', text: 'tool_use Skill {"skill": "pdf-forms"}', tok: 30, log: 'Модель решила, что pdf-forms подходит, и вызвала инструмент Skill — обычный tool_use.' },
        { role: 'tool', text: 'Launching skill: pdf-forms', tok: 10, log: 'Результат инструмента короткий: сам текст скила приходит следующим сообщением.' },
        { role: 'meta', text: 'Base directory for this skill: ~/.claude/skills/pdf-forms\n\n' + BODY, tok: 1900, log: 'Отрендеренный SKILL.md добавлен в разговор одним сообщением. Пользователь его в интерфейсе не видит, а модель — да, до конца сессии. Путь к папке нужен, чтобы запускать скрипты.' },
        { role: 'assistant', text: 'tool_use Bash "python ~/.claude/skills/pdf-forms/scripts/analyze_form.py w9.pdf"', tok: 40, log: 'Дальше — обычный агентный цикл по инструкции из скила.' },
        { role: 'tool', text: '{"f1_01": {"type": "text"}, "c1_1": {"type": "checkbox"}, …}', tok: 280, log: 'В контекст попал вывод скрипта, код скрипта — нет.' },
        { role: 'assistant', text: 'Заполнил 14 полей, файл w9-filled.pdf', tok: 60, log: 'Итого скил стоил: описание (в списке) + 1 900 токенов тела + вывод скриптов.' },
      ] },
      slash: { label: 'Claude Code: /pdf-forms', steps: [
        { role: 'system', text: LIST, tok: 3800, log: 'Тот же список в контексте.' },
        { role: 'user', text: '/pdf-forms w9.pdf', tok: 10, log: 'Пользователь вызвал скил явно. Решать модели нечего: Claude Code сам развернёт команду.' },
        { role: 'meta', text: '<command-name>/pdf-forms</command-name>\n' + BODY.replace('in.pdf', 'w9.pdf') + '\nARGUMENTS: w9.pdf', tok: 1900, log: 'Текст скила с подставленными аргументами вставлен прямо в ход пользователя, без вызова инструмента Skill. Нет плейсхолдера $ARGUMENTS — аргументы дописаны строкой ARGUMENTS:.' },
        { role: 'assistant', text: 'tool_use Bash "python …/scripts/analyze_form.py w9.pdf"', tok: 40, log: 'Модель сразу начинает работу по инструкции.' },
        { role: 'tool', text: '{"f1_01": {"type": "text"}, …}', tok: 280, log: 'Явный вызов работает и при disable-model-invocation: true — тогда описания нет в списке, и модель сама скил не вызовет.' },
      ] },
      api: { label: 'API: через bash', steps: [
        { role: 'system', text: 'pdf-forms - Заполняет PDF-формы… Используй, когда…', tok: 100, log: 'В API метаданные скилов из container.skills тоже добавляются в системный промпт.' },
        { role: 'user', text: 'Заполни w9.pdf', tok: 10, log: 'Запрос пользователя.' },
        { role: 'assistant', text: 'tool_use bash "cat pdf-forms/SKILL.md"', tok: 30, log: 'Отдельного инструмента нет: модель читает файл командой в контейнере code execution — как документация и описывает.' },
        { role: 'tool', text: '---\nname: pdf-forms\n…\n' + BODY, tok: 1950, log: 'SKILL.md пришёл обычным результатом инструмента, вместе с фронтматтером.' },
        { role: 'assistant', text: 'tool_use bash "python pdf-forms/scripts/analyze_form.py w9.pdf"', tok: 40, log: 'Скрипты работают так же. Сети в контейнере нет, ставить пакеты нельзя.' },
      ] },
    };
    let mode = 'auto', i = 0;
    choice(root, Object.entries(MODES).map(([k, v]) => [k, v.label]), mode, v => { mode = v; i = 0; render(); });
    const list = h('div', { class: 'tr-list' });
    const total = h('div', { class: 'tr-total' });
    const next = h('button', { class: 'btn primary', onclick: () => { i++; render(); } }, 'Следующее сообщение');
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(list, total, h('div', { class: 'controls' }, next, h('button', { class: 'btn', onclick: () => { i = 0; render(); } }, 'Сначала')), logEl);
    const RL = { system: 'system', user: 'user', assistant: 'assistant', tool: 'tool_result', meta: 'user · meta' };
    function render() {
      const steps = MODES[mode].steps;
      list.innerHTML = '';
      let sum = 0;
      steps.slice(0, i + 1).forEach((s, k) => {
        sum += s.tok;
        list.append(h('div', { class: `tr-msg r-${s.role}` + (k === i ? ' new' : '') },
          h('div', { class: 'tr-head' }, h('span', { class: 'role' }, RL[s.role]), h('span', { class: 'tk' }, '+' + fmt(s.tok))),
          h('pre', null, s.text)));
      });
      list.scrollTop = list.scrollHeight;
      total.innerHTML = `Контекст разговора: <b>${fmt(sum)}</b> токенов (без системного промпта и инструментов)`;
      logEl.innerHTML = steps[i].log;
      logEl.className = 'log' + (i === steps.length - 1 ? ' ok' : '');
      next.disabled = i >= steps.length - 1;
    }
    render();
    return {};
  });
})();

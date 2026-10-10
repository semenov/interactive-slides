// Demos for slides 2–10: pipeline, lexer/parser/codegen, optimisations, CPython VM, cost of a + b, specialisation.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      if (lines[0] !== text) lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  window.CR = { logger, esc };

  // ---------------------------------------------------------------- pipeline
  Deck.demo('pipeline', root => {
    const STAGES = [
      ['lex', 'Лексер', 'Текст → поток токенов: имена, числа, строки, операторы. Пробелы и комментарии отбрасываются. Посмотреть в Python: <code>python -m tokenize file.py</code>.'],
      ['parse', 'Парсер', 'Токены → дерево разбора (AST) по грамматике языка. Здесь ловятся синтаксические ошибки. В Python: <code>python -m ast file.py</code>, в Go — пакет <code>go/ast</code>.'],
      ['check', 'Типы и смысл', 'Разрешение имён, проверка и вывод типов, константы. В статических языках здесь появляется большинство ошибок компиляции. В динамических этого этапа почти нет — проверки переезжают в рантайм.'],
      ['ir', 'IR', 'Промежуточное представление, удобное для анализа: SSA в Go и LLVM, байткод в JVM, CPython и V8. Байткод — тоже IR, только его не компилируют дальше, а исполняют.'],
      ['opt', 'Оптимизации', 'Встраивание, свёртка констант, удаление мёртвого кода, вынос из циклов, удаление проверок границ, анализ убегания в кучу. Чем больше известно о типах и значениях, тем больше можно сделать.'],
      ['codegen', 'Машинный код', 'Выбор инструкций под конкретный процессор, распределение регистров, расстановка инструкций. Результат — объектный файл или код в памяти процесса (у JIT).'],
      ['link', 'Линковка', 'Сборка кусков в одну программу: подстановка адресов функций и данных из других файлов и библиотек. Статически — при сборке, динамически — загрузчиком при запуске.'],
    ];
    const KIND = { build: 'при сборке', run: 'при запуске', jit: 'JIT, в работе', none: 'нет' };
    const LANGS = {
      'Go': {
        lex: 'build', parse: 'build', check: 'build', ir: 'build', opt: 'build', codegen: 'build', link: 'build',
        note: 'Всё делается заранее, результат — один статический бинарник с рантаймом внутри. Оптимизатор Go быстрый, но скромный: сборка за секунды важнее последних процентов скорости.',
      },
      'C, Rust': {
        lex: 'build', parse: 'build', check: 'build', ir: 'build', opt: 'build', codegen: 'build', link: 'build',
        note: 'Всё заранее, оптимизатор LLVM или GCC работает долго и тщательно (<code>-O2</code>, <code>-O3</code>, LTO). Библиотеки обычно подключаются динамически — часть линковки достаётся загрузчику.',
        linkNote: 'При сборке, а <code>.so</code> подключает загрузчик при запуске.',
      },
      'Java': {
        lex: 'build', parse: 'build', check: 'build', ir: 'build', opt: 'jit', codegen: 'jit', link: 'run',
        note: '<code>javac</code> останавливается на байткоде — переносимом IR. Оптимизации и машинный код делает JIT внутри JVM по живому профилю. Классы загружаются и связываются лениво, при первом обращении.',
      },
      'JavaScript (V8)': {
        lex: 'run', parse: 'run', check: 'none', ir: 'run', opt: 'jit', codegen: 'jit', link: 'run',
        note: 'Всё во время работы. Тела функций парсятся лениво — при первом вызове. Байткод Ignition сразу исполняется, горячие функции компилирует JIT. Типы TypeScript стираются ещё до V8.',
      },
      'Python (CPython)': {
        lex: 'run', parse: 'run', check: 'none', ir: 'run', opt: 'run', codegen: 'none', link: 'run',
        note: 'Исходник компилируется в байткод при импорте (кэш — в <code>__pycache__/*.pyc</code>), байткод исполняет интерпретатор. Оптимизаций почти нет: только свёртка констант и простые замены. Экспериментальный JIT в 3.13+ по умолчанию выключен.',
        optNote: 'Только свёртка констант и peephole-замены при компиляции в байткод.',
      },
    };
    let lang = 'Go', stage = 'opt';
    const langBar = h('div', { class: 'controls' });
    const list = h('div', { class: 'pp-list' });
    const detail = h('div', { class: 'pp-detail', 'aria-live': 'polite' });
    const legend = h('div', { class: 'pp-legend' }, ...Object.entries(KIND).map(([k, v]) => h('span', null, h('i', { class: 'pp-dot ' + k }), v)));
    for (const name of Object.keys(LANGS)) {
      langBar.append(h('button', { class: 'btn small', 'data-l': name, onclick: () => { lang = name; render(); } }, name));
    }
    const btns = STAGES.map(([id, name]) => {
      const b = h('button', { class: 'pp-stage', onclick: () => { stage = id; render(); } },
        h('b', null, name), h('span', { class: 'pp-kind' }));
      b.dataset.id = id;
      list.append(b);
      return b;
    });
    root.append(langBar, list, legend, detail);

    function render() {
      const L = LANGS[lang];
      langBar.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.l === lang));
      btns.forEach(b => {
        const k = L[b.dataset.id];
        b.className = 'pp-stage ' + k + (b.dataset.id === stage ? ' cur' : '');
        b.querySelector('.pp-kind').textContent = KIND[k];
      });
      const [, name, text] = STAGES.find(s => s[0] === stage);
      const k = L[stage];
      const extra = L[stage + 'Note'] ? `<p class="pp-extra"><b>${lang}:</b> ${L[stage + 'Note']}</p>` : '';
      detail.innerHTML = `<p><b>${name}.</b> ${text}</p>${extra}<p class="pp-lang"><b>${lang}</b> — ${L.note}</p>`;
      detail.dataset.kind = k;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- lexer → parser → codegen
  Deck.demo('compile', root => {
    const PRESETS = ['a * (b + 2) - c / 4', '2 * 3 + x', 'x + 2 + 3', '(x + 1) * (x - 1)', '-a * 4096'];
    const input = h('input', { class: 'cc-in', type: 'text', value: PRESETS[0], spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Выражение', maxlength: 48 });
    const fold = h('input', { type: 'checkbox' });
    const presets = h('div', { class: 'controls' }, PRESETS.map(p => h('button', { class: 'btn small', onclick: () => { input.value = p; run(); } }, h('code', null, p))));
    const toks = h('div', { class: 'cc-toks' });
    const tree = h('div', { class: 'cc-tree' });
    let mode = 'bc';
    const tabBc = h('button', { class: 'btn small sel', onclick: () => { mode = 'bc'; run(); } }, 'Байткод');
    const tabArm = h('button', { class: 'btn small', onclick: () => { mode = 'arm'; run(); } }, 'ARM64');
    const code = h('pre', { class: 'cc-code' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      input, presets,
      h('label', { class: 'toggle' }, fold, h('span', null, 'Свёртка констант')),
      h('div', { class: 'cc-sec' }, h('span', { class: 'label' }, 'Токены'), toks),
      h('div', { class: 'cc-cols' },
        h('div', { class: 'cc-sec' }, h('span', { class: 'label' }, 'Дерево (AST)'), tree),
        h('div', { class: 'cc-sec' }, h('div', { class: 'controls' }, tabBc, tabArm), code)),
      logEl,
    );
    input.addEventListener('input', run);
    fold.addEventListener('change', run);

    function lex(src) {
      const out = [];
      const re = /(\d+)|([A-Za-z_]\w*)|([-+*/()])/y;
      let pos = 0;
      while (pos < src.length) {
        if (/\s/.test(src[pos])) { pos++; continue; }
        re.lastIndex = pos;
        const m = re.exec(src);
        if (!m) throw new Error(`непонятный символ «${esc(src[pos])}» на позиции ${pos + 1}`);
        if (m[1]) out.push({ t: 'NUM', v: m[1] });
        else if (m[2]) out.push({ t: 'NAME', v: m[2] });
        else out.push({ t: '()'.includes(m[3]) ? 'PAREN' : 'OP', v: m[3] });
        pos = re.lastIndex;
      }
      return out;
    }
    function parse(tokens) {
      let i = 0;
      const peek = () => tokens[i];
      const what = t => t ? `«${esc(t.v)}»` : 'конец строки';
      function expr() {
        let n = term();
        while (peek() && (peek().v === '+' || peek().v === '-')) { const op = tokens[i++].v; n = { t: 'bin', op, l: n, r: term() }; }
        return n;
      }
      function term() {
        let n = unary();
        while (peek() && (peek().v === '*' || peek().v === '/')) { const op = tokens[i++].v; n = { t: 'bin', op, l: n, r: unary() }; }
        return n;
      }
      function unary() {
        if (peek() && peek().v === '-') { i++; return { t: 'neg', e: unary() }; }
        return primary();
      }
      function primary() {
        const tk = tokens[i++];
        if (!tk) throw new Error('выражение оборвалось: ожидалось число, имя или «(»');
        if (tk.t === 'NUM') return { t: 'num', v: Number(tk.v) | 0 };
        if (tk.t === 'NAME') return { t: 'var', v: tk.v };
        if (tk.v === '(') {
          const n = expr();
          if (!peek() || peek().v !== ')') throw new Error(`ожидалась «)», а встретилась ${what(peek())}`);
          i++;
          return n;
        }
        throw new Error(`ожидалось число, имя или «(», а встретилась ${what(tk)}`);
      }
      if (!tokens.length) throw new Error('пустое выражение');
      const n = expr();
      if (i < tokens.length) throw new Error(`лишний токен ${what(tokens[i])}`);
      return n;
    }
    const OPS = { '+': (a, b) => (a + b) | 0, '-': (a, b) => (a - b) | 0, '*': (a, b) => Math.imul(a, b), '/': (a, b) => (a / b) | 0 };
    let folded = 0;
    function doFold(n) {
      if (n.t === 'bin') {
        const l = doFold(n.l), r = doFold(n.r);
        if (l.t === 'num' && r.t === 'num' && !(n.op === '/' && r.v === 0)) { folded++; return { t: 'num', v: OPS[n.op](l.v, r.v), folded: true }; }
        return { ...n, l, r };
      }
      if (n.t === 'neg') {
        const e = doFold(n.e);
        if (e.t === 'num') { folded++; return { t: 'num', v: (-e.v) | 0, folded: true }; }
        return { ...n, e };
      }
      return n;
    }
    const label = n => n.t === 'bin' ? n.op : n.t === 'neg' ? '−' : String(n.v);

    function drawTree(ast) {
      let leaf = 0, maxD = 0;
      const nodes = [], edges = [];
      (function walk(n, d) {
        maxD = Math.max(maxD, d);
        const kids = n.t === 'bin' ? [n.l, n.r] : n.t === 'neg' ? [n.e] : [];
        const ks = kids.map(k => walk(k, d + 1));
        const x = ks.length ? ks.reduce((s, k) => s + k.x, 0) / ks.length : leaf++;
        const me = { x, d, n };
        ks.forEach(k => edges.push([me, k]));
        nodes.push(me);
        return me;
      })(ast, 0);
      const W = 46, H = 46;
      const pad = Math.max(24, ...nodes.map(({ n }) => label(n).length * 4.6 + 10));
      const w = Math.max(1, leaf) * W, hgt = maxD * H + pad * 2;
      const X = x => pad + x * W, Y = d => pad + d * H;
      let svg = `<svg viewBox="0 0 ${w + pad * 2 - W} ${hgt}" style="max-width:${Math.max(120, (w + pad * 2 - W) * 1.1)}px" role="img" aria-label="Дерево разбора">`;
      for (const [a, b] of edges) svg += `<line x1="${X(a.x)}" y1="${Y(a.d)}" x2="${X(b.x)}" y2="${Y(b.d)}"/>`;
      for (const { x, d, n } of nodes) {
        const t = label(n), rw = Math.max(15, t.length * 4.6 + 8);
        const cls = n.t === 'num' ? (n.folded ? 'num folded' : 'num') : n.t === 'var' ? 'var' : 'op';
        svg += `<g class="${cls}"><rect x="${X(x) - rw}" y="${Y(d) - 14}" width="${rw * 2}" height="28" rx="${n.t === 'bin' || n.t === 'neg' ? 14 : 6}"/><text x="${X(x)}" y="${Y(d) + 5}">${esc(t)}</text></g>`;
      }
      tree.innerHTML = svg + '</svg>';
    }

    function genBytecode(ast) {
      const out = [];
      let depth = 0, maxDepth = 0;
      const push = () => { depth++; maxDepth = Math.max(maxDepth, depth); };
      const NB = { '+': '0 (+)', '-': '10 (-)', '*': '5 (*)', '/': '2 (//)' };
      (function g(n) {
        if (n.t === 'num') { out.push(['LOAD_CONST', String(n.v)]); push(); }
        else if (n.t === 'var') { out.push(['LOAD_FAST', n.v]); push(); }
        else if (n.t === 'neg') { g(n.e); out.push(['UNARY_NEGATIVE', '']); }
        else { g(n.l); g(n.r); out.push(['BINARY_OP', NB[n.op]]); depth--; }
      })(ast);
      out.push(['RETURN_VALUE', '']);
      return { lines: out.map(([op, a]) => `<span class="k">${op.padEnd(15)}</span>${esc(a)}`), n: out.length, note: `глубина стека — ${maxDepth}` };
    }

    function genArm(ast) {
      const vars = [];
      (function v(n) { if (n.t === 'var' && !vars.includes(n.v)) vars.push(n.v); if (n.l) v(n.l); if (n.r) v(n.r); if (n.e) v(n.e); })(ast);
      if (vars.length > 8) throw new Error('больше 8 переменных — в регистрах аргументов им не хватит места');
      const out = [];
      const free = [8, 9, 10, 11, 12, 13, 14, 15];
      let used = 0;
      const alloc = () => {
        if (!free.length) throw new Error('выражение слишком глубокое: временных регистров не хватило, нужно сохранять значения в стек');
        const r = free.shift();
        used = Math.max(used, 8 - free.length);
        return { reg: r, tmp: true };
      };
      const release = o => { if (o.tmp) { free.push(o.reg); free.sort((a, b) => a - b); } };
      const R = o => 'w' + o.reg;
      const emit = (op, args) => out.push([op, args]);
      const mat = (v, into) => {
        const d = into || alloc();
        const u = v >>> 0;
        if (v >= -65536 && v < 65536) emit('mov', `${R(d)}, #${v}`);
        else { emit('mov', `${R(d)}, #${u & 0xffff}`); emit('movk', `${R(d)}, #${u >>> 16}, lsl #16`); }
        return d;
      };
      const reg = o => o.imm != null ? mat(o.imm) : o;
      // Sethi–Ullman: how many registers a subtree needs; evaluate the hungrier side first.
      const need = n => n.t === 'bin' ? (a => a[0] === a[1] ? a[0] + 1 : Math.max(...a))([need(n.l), need(n.r)]) : n.t === 'neg' ? Math.max(1, need(n.e)) : n.t === 'var' ? 0 : 1;
      function g(n) {
        if (n.t === 'num') return { imm: n.v };
        if (n.t === 'var') return { reg: vars.indexOf(n.v), name: n.v };
        if (n.t === 'neg') {
          const e = g(n.e);
          if (e.imm != null) return { imm: (-e.imm) | 0 };
          release(e);
          const d = alloc();
          emit('neg', `${R(d)}, ${R(e)}`);
          return d;
        }
        let l, r;
        if (need(n.r) > need(n.l)) { r = g(n.r); l = g(n.l); } else { l = g(n.l); r = g(n.r); }
        const name = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'sdiv' }[n.op];
        if ((n.op === '+' || n.op === '*') && l.imm != null && r.imm == null) [l, r] = [r, l];
        if ((n.op === '+' || n.op === '-') && r.imm != null && r.imm >= 0 && r.imm < 4096) {
          if (l.imm != null) l = mat(l.imm);
          release(l);
          const d = alloc();
          emit(name, `${R(d)}, ${R(l)}, #${r.imm}`);
          return d;
        }
        if ((n.op === '+' || n.op === '-') && r.imm != null && r.imm < 0 && r.imm > -4096) {
          if (l.imm != null) l = mat(l.imm);
          release(l);
          const d = alloc();
          emit(n.op === '+' ? 'sub' : 'add', `${R(d)}, ${R(l)}, #${-r.imm}`);
          return d;
        }
        l = reg(l); r = reg(r);
        release(l); release(r);
        const d = alloc();
        emit(name, `${R(d)}, ${R(l)}, ${R(r)}`);
        return d;
      }
      const res = g(ast);
      if (res.imm != null) mat(res.imm, { reg: 0 });
      else if (res.reg !== 0) emit('mov', `w0, ${R(res)}`);
      emit('ret', '');
      const head = vars.length ? `<span class="c">// ${vars.map((v, i) => `${v} → w${i}`).join(', ')}</span>` : '<span class="c">// без аргументов</span>';
      return {
        lines: [head, ...out.map(([op, a]) => `<span class="k">${op.padEnd(5)}</span>${esc(a)}`)],
        n: out.length,
        note: used ? `временных регистров — ${used}` : 'временные регистры не понадобились',
      };
    }

    const say = logger(logEl, 1);
    function run() {
      tabBc.classList.toggle('sel', mode === 'bc');
      tabArm.classList.toggle('sel', mode === 'arm');
      let tokens;
      try {
        tokens = lex(input.value);
        toks.innerHTML = tokens.map(t => `<span class="tok ${t.t.toLowerCase()}"><b>${esc(t.v)}</b><small>${t.t}</small></span>`).join('') || '<span class="empty">—</span>';
        let ast = parse(tokens);
        folded = 0;
        if (fold.checked) ast = doFold(ast);
        drawTree(ast);
        const g = mode === 'bc' ? genBytecode(ast) : genArm(ast);
        code.innerHTML = g.lines.join('\n');
        root.classList.remove('err');
        const foldMsg = fold.checked ? (folded ? ` Свёрнуто ${folded} ${plural(folded, ['операция', 'операции', 'операций'])} с константами — их посчитал компилятор.` : ' Свернуть нечего: у каждой операции есть переменный операнд.') : '';
        say(`${tokens.length} ${plural(tokens.length, ['токен', 'токена', 'токенов'])} → ${g.n} ${plural(g.n, ['команда', 'команды', 'команд'])}, ${g.note}.${foldMsg}` +
          (mode === 'bc' ? ' Каждая команда байткода — отдельный проход цикла интерпретатора.' : ''), 'ok');
      } catch (e) {
        root.classList.add('err');
        say('Ошибка: ' + e.message + '.', 'bad');
      }
    }
    run();
    return {};
  });

  // ---------------------------------------------------------------- optimisation passes
  Deck.demo('opt', root => {
    const PASSES = [
      ['C', 'Свёртка констант'],
      ['I', 'Встраивание area()'],
      ['D', 'Удаление мёртвого кода'],
      ['L', 'Вынос из цикла'],
      ['S', 'Умножение → сдвиг'],
    ];
    const on = { C: false, I: false, D: false, L: false, S: false };
    const boxes = {};
    const grid = h('div', { class: 'op-passes' }, PASSES.map(([k, name]) => {
      const cb = h('input', { type: 'checkbox' });
      cb.addEventListener('change', () => { on[k] = cb.checked; render(); explain(k); });
      boxes[k] = cb;
      return h('label', { class: 'toggle' }, cb, h('span', null, name));
    }));
    const list = h('pre', { class: 'op-ir' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    root.append(grid, list, stats, logEl);

    // Each line: [text, state, note]. state: '' | 'chg' | 'dead' | 'gone' | 'new'
    function lines() {
      const { C, I, D, L, S } = on;
      const out = [];
      const add = (t, st = '', note = '', ind = 0) => out.push({ t: '  '.repeat(ind) + t, st, note });
      const deadVar = C && !D ? 'dead' : '';
      if (C && D) add('k = 4', 'gone'); else add('k = 4', deadVar, deadVar && 'никто не читает');
      if (C && D) add('scale = k * 1024', 'gone'); else if (C) add('scale = 4096', 'dead', 'никто не читает'); else add('scale = k * 1024');
      if (C && D) add('debug = false', 'gone'); else add('debug = false', deadVar, deadVar && 'никто не читает');
      add('sum = 0');
      add('i = 0');
      const limExpr = S ? 'n << 1' : 'n * 2';
      if (L && I) add('lim = ' + limExpr, 'new', 'вынесено из цикла');
      add('loop:');
      add('if i >= n goto done', '', '', 1);
      if (L && I) add('lim = ' + limExpr, 'gone', '', 1);
      else if (I) add('lim = ' + limExpr, 'chg', 'тело area()', 1);
      else add('lim = call area(n, 2)', '', '', 1);
      if (C && D) add('if !debug goto skip', 'gone', '', 1);
      else if (C) add('goto skip', 'chg', 'debug = false', 1);
      else add('if !debug goto skip', '', '', 1);
      if (C && D) add('call log(i)', 'gone', '', 1);
      else add('call log(i)', C ? 'dead' : '', C ? 'недостижимо' : '', 1);
      add('skip:', C && D ? 'gone' : '');
      add('t1 = load xs[i]', '', '', 1);
      if (C && S) add('t2 = t1 << 12', 'chg', '× 4096 = сдвиг', 1);
      else if (C) add('t2 = t1 * 4096', 'chg', '', 1);
      else add('t2 = t1 * scale', '', '', 1);
      add('t3 = t2 + lim', '', '', 1);
      add('sum = sum + t3', '', '', 1);
      add('i = i + 1', '', '', 1);
      add('goto loop', '', '', 1);
      add('done:');
      add('return sum', '', '', 1);
      return out;
    }
    function cost() {
      const { C, I, D, L } = on;
      // operations executed per loop iteration (debug is false at run time)
      let ops = 1 /* i >= n */ + 5 /* load, mul, add, add, i++ */ + 1 /* goto loop */;
      let calls = 0;
      if (!(L && I)) { if (I) ops += 1; else { ops += 5; calls = 1; } } // call: args, call, mul, ret, result
      if (!(C && D)) ops += C ? 1 : 2; // load debug + branch, or unconditional jump
      return { ops, calls };
    }
    const base = { lines: lines().filter(l => !l.t.trim().endsWith(':')).length, ops: cost().ops };
    function render() {
      const ls = lines();
      list.innerHTML = ls.map(l => `<span class="op-l ${l.st}">${esc(l.t)}${l.note ? `<i>${esc(l.note)}</i>` : ''}</span>`).join('');
      const live = ls.filter(l => l.st !== 'gone' && !l.t.trim().endsWith(':')).length;
      const { ops, calls } = cost();
      stats.innerHTML = `<div class="stat"><b>${live}</b><span>строк кода (было ${base.lines})</span></div>` +
        `<div class="stat ${ops > 10 ? 'warn' : ''}"><b>${ops}</b><span>операций на итерацию (было ${base.ops})</span></div>` +
        `<div class="stat ${calls ? 'warn' : ''}"><b>${calls}</b><span>вызовов на итерацию</span></div>`;
    }
    function explain(k) {
      const { C, I, D, L, S } = on;
      if (!on[k]) { say('Проход выключен — код вернулся к прежнему виду.'); return; }
      const msg = {
        C: () => ['Константы подставлены: <code>scale = 4 * 1024 = 4096</code>, условие <code>!debug</code> известно заранее — ветка с <code>log()</code> недостижима. ' + (D ? 'Удаление мёртвого кода сразу её выбросило.' : 'Но убирать код — не задача этого прохода: включите удаление мёртвого кода.'), 'ok'],
        I: () => ['Вместо вызова — тело функции: <code>lim = n * 2</code>. Ушли передача аргументов, переход, пролог и возврат. ' + (L ? 'Теперь видно, что <code>lim</code> не зависит от <code>i</code>, и вынос из цикла сработал.' : 'Теперь видно, что <code>lim</code> не зависит от <code>i</code> — включите вынос из цикла.'), 'ok'],
        D: () => C ? ['Удалены недостижимая ветка и переменные, которые больше никто не читает: <code>k</code>, <code>scale</code>, <code>debug</code>.', 'ok']
          : ['Удалять нечего: пока константы не подставлены, компилятор не знает, что <code>debug</code> всегда <code>false</code>, и все переменные кем-то читаются. Включите свёртку констант.', 'warn'],
        L: () => I ? ['<code>lim = n * 2</code> не меняется между итерациями — считается один раз перед циклом.', 'ok']
          : ['Вынести нечего: <code>area(n, 2)</code> — вызов функции, а компилятор не видит её тела и не знает, нет ли у неё побочных эффектов. Включите встраивание.', 'warn'],
        S: () => (C || I) ? [`Умножение на степень двойки заменено сдвигом: ${C ? '<code>t1 * 4096 → t1 &lt;&lt; 12</code>' : ''}${C && I ? ', ' : ''}${I ? '<code>n * 2 → n &lt;&lt; 1</code>' : ''}. Сдвиг — 1 такт, умножение — 3.${!C ? ' Множитель <code>scale</code> пока неизвестен — нужна свёртка констант.' : ''}`, 'ok']
          : ['Упрощать нечего: множитель <code>scale</code> неизвестен, а вызов <code>area</code> не раскрыт. Включите свёртку констант или встраивание.', 'warn'],
      }[k]();
      say(...msg);
    }
    render();
    say('Исходная функция: <code>k := 4</code>, <code>scale := k * 1024</code>, <code>debug := false</code>, в цикле — <code>lim := area(n, 2)</code>, <code>if debug { log(i) }</code> и <code>sum += xs[i]*scale + lim</code>. Включайте проходы.');
    return {};
  });

  // ---------------------------------------------------------------- CPython stack VM
  Deck.demo('vm', root => {
    const PROGS = {
      f: {
        title: 'f(3, 4)',
        src: 'def f(a, b):\n    c = a + b * 2\n    return c - 1',
        names: ['a', 'b', 'c'],
        init: () => [3, 4, undefined],
        code: [
          [0, 'RESUME', '0', 2], [2, 'LOAD_FAST', '0 (a)', 3], [4, 'LOAD_FAST', '1 (b)', 3], [6, 'LOAD_CONST', '1 (2)', 3],
          [8, 'BINARY_OP', '5 (*)', 3], [12, 'BINARY_OP', '0 (+)', 3], [16, 'STORE_FAST', '2 (c)', 3],
          [18, 'LOAD_FAST', '2 (c)', 4], [20, 'LOAD_CONST', '2 (1)', 4], [22, 'BINARY_OP', '10 (-)', 4], [26, 'RETURN_VALUE', '', 4],
        ],
      },
      total: {
        title: 'total([3, 5, 7])',
        src: 'def total(xs):\n    s = 0\n    for x in xs:\n        s += x\n    return s',
        names: ['xs', 's', 'x'],
        init: () => [[3, 5, 7], undefined, undefined],
        code: [
          [0, 'RESUME', '0', 5], [2, 'LOAD_CONST', '1 (0)', 6], [4, 'STORE_FAST', '1 (s)', 6], [6, 'LOAD_FAST', '0 (xs)', 7],
          [8, 'GET_ITER', '', 7], [10, 'FOR_ITER', '7 (to 28)', 7], [14, 'STORE_FAST', '2 (x)', 7], [16, 'LOAD_FAST', '1 (s)', 8],
          [18, 'LOAD_FAST', '2 (x)', 8], [20, 'BINARY_OP', '13 (+=)', 8], [24, 'STORE_FAST', '1 (s)', 8],
          [26, 'JUMP_BACKWARD', '9 (to 10)', 8], [28, 'END_FOR', '', 7], [30, 'LOAD_FAST', '1 (s)', 9], [32, 'RETURN_VALUE', '', 9],
        ],
      },
    };
    let prog = 'f', P, pc, stack, locals, done, count, playing = false, acc = 0;
    const tabs = h('div', { class: 'controls' });
    for (const k of Object.keys(PROGS)) tabs.append(h('button', { class: 'btn small', 'data-p': k, onclick: () => { prog = k; reset(); } }, h('code', null, PROGS[k].title)));
    const srcEl = h('pre', { class: 'vm-src' });
    const codeEl = h('div', { class: 'vm-code' });
    const stackEl = h('div', { class: 'vm-stack' });
    const localsEl = h('div', { class: 'vm-locals' });
    const countEl = h('span', { class: 'vm-count' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { playing = false; playBtn.textContent = 'Пуск'; step(); } }, 'Шаг');
    const playBtn = h('button', { class: 'btn', onclick: () => { if (done) reset(); playing = !playing; playBtn.textContent = playing ? 'Пауза' : 'Пуск'; } }, 'Пуск');
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    root.append(
      tabs,
      h('div', { class: 'vm-grid' },
        h('div', { class: 'vm-left' }, srcEl, codeEl),
        h('div', { class: 'vm-right' },
          h('span', { class: 'label' }, 'Стек значений'), stackEl,
          h('span', { class: 'label' }, 'Локальные переменные'), localsEl, countEl)),
      h('div', { class: 'controls' }, stepBtn, playBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      logEl,
    );
    const show = v => v === undefined ? '—' : Array.isArray(v) ? `[${v.join(', ')}]` : v && v.iter ? `iter@${v.i}` : String(v);
    function reset() {
      P = PROGS[prog];
      pc = 0; stack = []; locals = P.init(); done = false; count = 0;
      playing = false; playBtn.textContent = 'Пуск';
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.p === prog));
      srcEl.innerHTML = Deck.highlight(P.src, 'py');
      say('Нажмите «Шаг»: интерпретатор выполнит одну команду.');
      render();
    }
    function step() {
      if (done) return;
      const [off, op, arg] = P.code[pc];
      const idx = parseInt(arg, 10);
      let next = pc + 1, msg = '';
      count++;
      switch (op) {
        case 'RESUME': msg = 'RESUME: служебная проверка при входе — не пора ли обработать сигнал, отдать GIL или запустить трассировку.'; break;
        case 'LOAD_FAST': stack.push(locals[idx]); msg = `LOAD_FAST: кладём на стек ссылку на ${P.names[idx]} = ${show(locals[idx])} из слота ${idx}. Не поиск по имени, а индекс в массиве.`; break;
        case 'LOAD_CONST': { const v = Number(arg.match(/\((-?\d+)\)/)[1]); stack.push(v); msg = `LOAD_CONST: кладём на стек константу ${v} из таблицы констант функции.`; break; }
        case 'STORE_FAST': { const v = stack.pop(); locals[idx] = v; msg = `STORE_FAST: снимаем ${show(v)} с вершины стека и кладём в слот ${idx} (${P.names[idx]}).`; break; }
        case 'BINARY_OP': {
          const r = stack.pop(), l = stack.pop();
          const sym = arg.match(/\((.+)\)/)[1];
          const res = sym === '*' ? l * r : sym === '-' ? l - r : l + r;
          stack.push(res);
          msg = `BINARY_OP ${sym}: снимаем ${l} и ${r}, по их типу (int) находим нужную функцию, вызываем её и кладём на стек новый объект ${res}.`;
          break;
        }
        case 'GET_ITER': { const v = stack.pop(); stack.push({ iter: true, list: v, i: 0 }); msg = 'GET_ITER: заменяем список на его итератор — iter(xs).'; break; }
        case 'FOR_ITER': {
          const it = stack[stack.length - 1];
          if (it.i < it.list.length) { const v = it.list[it.i++]; stack.push(v); msg = `FOR_ITER: next(итератор) = ${v}, кладём на стек поверх итератора.`; }
          else { stack.pop(); next = P.code.findIndex(c => c[0] === 30); msg = 'FOR_ITER: итератор исчерпан — снимаем его со стека и прыгаем за конец цикла.'; }
          break;
        }
        case 'JUMP_BACKWARD': next = P.code.findIndex(c => c[0] === 10); msg = 'JUMP_BACKWARD: назад к FOR_ITER. Заодно проверка, не пора ли переключить поток.'; break;
        case 'RETURN_VALUE': { const v = stack.pop(); done = true; msg = `RETURN_VALUE: снимаем ${v} и возвращаем вызывающему. Выполнено ${count} ${plural(count, ['команда', 'команды', 'команд'])}` + (prog === 'total' ? ' — по 7 на каждый элемент списка.' : '.'); break; }
      }
      void off;
      pc = next;
      say(msg, done ? 'ok' : '');
      render();
    }
    function render() {
      codeEl.innerHTML = P.code.map(([off, op, arg], i) =>
        `<div class="vm-row${i === pc && !done ? ' cur' : ''}"><span class="vm-off">${off}</span><b>${op}</b><span class="vm-arg">${esc(arg)}</span></div>`).join('');
      stackEl.innerHTML = stack.length ? stack.map(v => `<span class="vm-cell${v && v.iter ? ' it' : ''}">${esc(show(v))}</span>`).join('') : '<span class="empty">пусто</span>';
      localsEl.innerHTML = P.names.map((n, i) => `<span><code>${n}</code> ${esc(show(locals[i]))}</span>`).join('');
      countEl.textContent = `выполнено команд: ${count}`;
      stepBtn.disabled = done;
    }
    reset();
    const loop = rafLoop(dt => {
      if (!playing) return;
      acc += dt;
      if (acc > 0.7) { acc = 0; step(); if (done) { playing = false; playBtn.textContent = 'Пуск'; } }
    });
    return { start: loop.start, stop: () => { loop.stop(); playing = false; playBtn.textContent = 'Пуск'; } };
  });

  // ---------------------------------------------------------------- cost of a + b
  Deck.demo('cost', root => {
    const ENVS = {
      c: {
        name: 'C / Go', mem: '8 Б', ns: '≈ 0,3 нс',
        steps: [['add rax, rcx — операнды уже в регистрах, типы известны при компиляции', 1]],
        note: 'Одна инструкция, и процессор выполняет несколько таких за такт. В C и Rust цикл ещё и векторизуется: 4–8 сложений одной SIMD-инструкцией.',
      },
      jit: {
        name: 'JS после TurboFan', mem: '4–8 Б', ns: '≈ 0,5 нс',
        steps: [['охранники: a и b — Smi? (test + jnz)', 2], ['add — тегированные Smi складываются напрямую', 1], ['jo — переполнение → деоптимизация', 1]],
        note: 'Типы угаданы по профилю, проверка — пара предсказуемых переходов. Java здесь ещё проще: типы известны статически, остаётся один add.',
      },
      py310: {
        name: 'CPython 3.10', mem: '28 Б + 8 Б указатель', ns: '≈ 10 нс',
        steps: [
          ['диспетчеризация: опкод, аргумент, косвенный переход', 6],
          ['снять два указателя со стека', 2],
          ['PyNumber_Add: найти nb_add у типов a и b, проверить подклассы', 16],
          ['long_add: оба числа «короткие»? сложить', 10],
          ['создать результат: новый PyLongObject в куче', 28],
          ['счётчики ссылок: уменьшить у a и b, проверить на ноль', 6],
          ['положить результат на стек', 2],
        ],
        note: 'Около 70 инструкций, из них полезная — одна. Новый объект на каждое сложение (кроме кэша чисел −5…256), и он же — нагрузка на аллокатор.',
      },
      py312: {
        name: 'CPython 3.12', mem: '28 Б + 8 Б указатель', ns: '≈ 5 нс',
        steps: [
          ['диспетчеризация: опкод, аргумент, косвенный переход', 6],
          ['BINARY_OP_ADD_INT: оба — точно int? два сравнения', 4],
          ['_PyLong_Add: быстрый путь для «компактных» чисел', 8],
          ['создать результат: новый PyLongObject в куче', 24],
          ['счётчики ссылок: уменьшить у a и b', 6],
          ['положить результат на стек', 2],
        ],
        note: 'Специализация убрала поиск операции по типам, но упаковка и диспетчеризация остались. Дальше двигаются JIT (экспериментальный в 3.13+) и PyPy, где цикл компилируется в машинный код.',
      },
    };
    let env = 'py310';
    const bar = h('div', { class: 'controls' }, Object.entries(ENVS).map(([k, e]) => h('button', { class: 'btn small', 'data-e': k, onclick: () => { env = k; render(); } }, e.name)));
    const steps = h('div', { class: 'co-steps' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'co-head' }, h('code', null, 's = a + b'), h('span', { class: 'label' }, 'одно сложение в цикле')), bar, steps, stats, logEl);
    function render() {
      const E = ENVS[env];
      bar.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.e === env));
      const max = 72;
      steps.innerHTML = E.steps.map(([t, n]) => `<div class="co-step"><span>${esc(t)}</span><div class="co-bar"><i style="width:${Math.max(1.2, (n / max) * 100)}%"></i><b>${n}</b></div></div>`).join('');
      const total = E.steps.reduce((s, x) => s + x[1], 0);
      stats.innerHTML = `<div class="stat ${total > 10 ? 'warn' : ''}"><b>≈ ${total}</b><span>машинных инструкций</span></div>` +
        `<div class="stat"><b>${E.ns}</b><span>на сложение</span></div>` +
        `<div class="stat"><b>${E.mem}</b><span>на число</span></div>`;
      logEl.className = 'log';
      logEl.innerHTML = E.note;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- CPython 3.12 specialisation
  Deck.demo('spec', root => {
    const COOLDOWN = 52, MAX_BACKOFF = 12;
    const SPEC = {
      '*': { int: 'BINARY_OP_MULTIPLY_INT', float: 'BINARY_OP_MULTIPLY_FLOAT' },
      '+': { int: 'BINARY_OP_ADD_INT', float: 'BINARY_OP_ADD_FLOAT' },
      '-': { int: 'BINARY_OP_SUBTRACT_INT', float: 'BINARY_OP_SUBTRACT_FLOAT' },
    };
    const ROWS = [
      [2, 'LOAD_FAST', '0 (a)'], [4, 'LOAD_FAST', '1 (b)'], [6, 'LOAD_CONST', '1 (2)'],
      [8, null, '5 (*)', '*'], [12, null, '0 (+)', '+'], [16, 'STORE_FAST', '2 (c)'],
      [18, 'LOAD_FAST', '2 (c)'], [20, 'LOAD_CONST', '2 (1)'], [22, null, '10 (-)', '-'], [26, 'RETURN_VALUE', ''],
    ];
    let ops, calls, reps = 1;
    const CALLS = [['f(3, 4)', 'int', 'int'], ['f(2.5, 4.0)', 'float', 'float'], ['f(3, 4.0)', 'int', 'float']];
    const callBar = h('div', { class: 'controls' }, CALLS.map(([label, a, b]) => h('button', { class: 'btn primary small', onclick: () => call(label, a, b) }, h('code', null, label))));
    const repBar = h('div', { class: 'controls' }, h('span', { class: 'label' }, 'повторить:'), [1, 10, 60].map(n => h('button', { class: 'btn small', 'data-n': n, onclick: () => { reps = n; renderReps(); } }, '×' + n)),
      h('button', { class: 'btn small', onclick: reset }, 'Сброс'));
    const codeEl = h('div', { class: 'sp-code' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(h('pre', { class: 'vm-src', html: Deck.highlight('def f(a, b):\n    c = a + b * 2\n    return c - 1', 'py') }), callBar, repBar, codeEl, logEl);
    function renderReps() { repBar.querySelectorAll('[data-n]').forEach(b => b.classList.toggle('sel', +b.dataset.n === reps)); }

    function reset() {
      ops = {};
      for (const sym of ['*', '+', '-']) ops[sym] = { name: 'BINARY_OP', value: 1, backoff: 1, hits: 0, misses: 0, generic: 0 };
      calls = 0;
      say('Свежий код: все BINARY_OP общие, счётчик прогрева — 1. Вызывайте функцию.');
      render();
    }
    // One execution of a BINARY_OP site with operand types tl, tr. Returns an event string or ''.
    function exec(sym, tl, tr) {
      const o = ops[sym];
      if (o.name !== 'BINARY_OP') {
        const want = o.name.endsWith('_INT') ? 'int' : 'float';
        if (tl === want && tr === want) { o.hits++; return ''; }
        o.misses++;
        // DEOPT_IF → falls into the generic BINARY_OP body, which owns the counter.
      }
      if (o.value === 0) {
        const name = tl === tr && SPEC[sym][tl];
        if (name) {
          const was = o.name;
          o.name = name; o.value = COOLDOWN; o.backoff = 0; o.hits++;
          return was === 'BINARY_OP' ? `${sym}: специализация → ${name}` : `${sym}: ${COOLDOWN} промахов, переспециализация ${was} → ${name}`;
        }
        const was = o.name;
        o.name = 'BINARY_OP';
        o.backoff = Math.min(o.backoff + 1, MAX_BACKOFF);
        o.value = 2 ** o.backoff - 1;
        o.generic++;
        return `${sym}: для ${tl} ${sym} ${tr} специализации нет${was !== 'BINARY_OP' ? `, ${was} сброшена` : ''} — следующая попытка через ${o.value}`;
      }
      o.value--;
      o.generic++;
      return '';
    }
    function call(label, ta, tb) {
      const events = [];
      for (let k = 0; k < reps; k++) {
        calls++;
        const prod = tb === 'int' ? 'int' : 'float'; // b * 2
        const e1 = exec('*', tb, 'int');
        const tc = ta === 'int' && prod === 'int' ? 'int' : 'float';
        const e2 = exec('+', ta, prod);
        const e3 = exec('-', tc, 'int');
        [e1, e2, e3].forEach(e => e && events.push(e));
      }
      const tail = events.length ? events.slice(-3).join('; ') + '.' : 'Ничего не поменялось: команды выполняются в текущем виде.';
      const missy = Object.values(ops).some(o => o.name !== 'BINARY_OP' && o.misses && o.value < COOLDOWN);
      say(`${label}${reps > 1 ? ' ×' + reps : ''} (всего вызовов: ${calls}). ${tail}`, missy ? 'warn' : events.length ? 'ok' : '');
      render();
    }
    function render() {
      codeEl.innerHTML = ROWS.map(([off, name, arg, sym]) => {
        if (!sym) return `<div class="sp-row plain"><span class="vm-off">${off}</span><b>${name}</b><span class="vm-arg">${esc(arg)}</span><span></span></div>`;
        const o = ops[sym];
        const spec = o.name !== 'BINARY_OP';
        const meta = spec ? `попаданий ${o.hits}, промахов ${o.misses}${o.misses ? ` · до переспециализации ${o.value + 1}` : ''}`
          : `счётчик ${o.value}${o.generic ? ` · медленных ${o.generic}` : ''}`;
        return `<div class="sp-row ${spec ? 'spec' : 'gen'}"><span class="vm-off">${off}</span><b>${o.name}</b><span class="vm-arg">${esc(arg)}</span><small>${meta}</small></div>`;
      }).join('');
    }
    reset();
    renderReps();
    return {};
  });
})();

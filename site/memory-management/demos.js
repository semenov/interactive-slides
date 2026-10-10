// Demos for slides 3–10: manual memory, ownership, refcounting, cycle collector,
// mark & sweep, tri-colour marking with write barriers, compaction, generations.
(() => {
  'use strict';
  const { h, highlight, plural, rafLoop } = Deck;
  const NS = 'http://www.w3.org/2000/svg';

  function logger(el, keep = 2) {
    const lines = [];
    const say = (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
    say.reset = () => { lines.length = 0; };
    return say;
  }

  // Code listing with a highlighted current line.
  function codeView(src, lang) {
    const lines = src.replace(/^\n+|\s+$/g, '').split('\n');
    const code = h('code');
    const els = lines.map(l => h('span', { class: 'ln', html: highlight(l, lang) || ' ' }));
    code.append(...els);
    const el = h('pre', { class: 'code cv' }, code);
    return {
      el,
      set(cur) { els.forEach((e, i) => { e.classList.toggle('cur', i === cur); }); },
    };
  }

  // Object graph in SVG. Nodes: {id, x, y, label, root, w, cls, badge, badgeCls}; edges: {a, b, cls, bend}.
  let uid = 0;
  const MARK = { n: '#13293d', hot: '#a61e4d', bad: '#ce3262', dim: '#a9b4bf', new: '#00a29c' };
  function graphView(w, hgt) {
    const id = 'gv' + (++uid);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    svg.setAttribute('class', 'gv');
    svg.setAttribute('role', 'img');
    const defs = Object.entries(MARK).map(([k, c]) =>
      `<marker id="${id}-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${c}"/></marker>`).join('');

    function clip(n, tx, ty) {
      const dx = tx - n.x, dy = ty - n.y, L = Math.hypot(dx, dy) || 1;
      if (n.root) {
        const hw = (n.w || 52) / 2 + 2, hh = 15;
        const t = Math.min(hw / Math.max(Math.abs(dx), 1e-6), hh / Math.max(Math.abs(dy), 1e-6));
        return [n.x + dx * t, n.y + dy * t];
      }
      const r = 20;
      return [n.x + (dx / L) * r, n.y + (dy / L) * r];
    }
    const f = v => v.toFixed(1);

    function draw(nodes, edges, extra = '') {
      const map = Object.fromEntries(nodes.map(n => [n.id, n]));
      const has = new Set(edges.map(e => e.a + '>' + e.b));
      let out = `<defs>${defs}</defs>${extra}`;
      for (const e of edges) {
        const a = map[e.a], b = map[e.b];
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L, ny = dx / L;
        const cls = e.cls || '';
        const mk = `url(#${id}-${cls && MARK[cls] ? cls : 'n'})`;
        if (e.bend) {
          const cx = (a.x + b.x) / 2 + nx * e.bend, cy = (a.y + b.y) / 2 + ny * e.bend;
          const p1 = clip(a, cx, cy), p2 = clip(b, cx, cy);
          out += `<path class="edge ${cls}" d="M${f(p1[0])} ${f(p1[1])} Q${f(cx)} ${f(cy)} ${f(p2[0])} ${f(p2[1])}" marker-end="${mk}"/>`;
        } else {
          const off = has.has(e.b + '>' + e.a) ? 5 : 0;
          const ax = { ...a, x: a.x + nx * off, y: a.y + ny * off }, bx = { ...b, x: b.x + nx * off, y: b.y + ny * off };
          const p1 = clip(ax, bx.x, bx.y), p2 = clip(bx, ax.x, ax.y);
          out += `<path class="edge ${cls}" d="M${f(p1[0])} ${f(p1[1])} L${f(p2[0])} ${f(p2[1])}" marker-end="${mk}"/>`;
        }
      }
      for (const n of nodes) {
        const cls = 'nd ' + (n.root ? 'root ' : '') + (n.cls || '');
        if (n.root) {
          const w2 = n.w || 52;
          out += `<g class="${cls}"><rect class="box" x="${n.x - w2 / 2}" y="${n.y - 13}" width="${w2}" height="26" rx="5"/><text x="${n.x}" y="${n.y}">${n.label}</text></g>`;
        } else {
          out += `<g class="${cls}"><circle cx="${n.x}" cy="${n.y}" r="18"/><text x="${n.x}" y="${n.y}">${n.label}</text>`;
          if (n.badge != null) {
            out += `<g class="badge ${n.badgeCls || ''}"><circle cx="${n.x + 15}" cy="${n.y - 15}" r="9"/><text x="${n.x + 15}" y="${n.y - 15}">${n.badge}</text></g>`;
          }
          out += '</g>';
        }
      }
      svg.innerHTML = out;
    }
    return { el: svg, draw };
  }

  // Step-through runner: auto-play with an interval, paused in stop().
  function autoplay(stepFn, canStep, ms = 550) {
    let timer = 0;
    const stop = () => { clearInterval(timer); timer = 0; };
    return {
      play() {
        stop();
        timer = setInterval(() => { if (canStep()) stepFn(); else stop(); }, ms);
      },
      stop,
      get on() { return !!timer; },
    };
  }

  window.MM = { logger, codeView, graphView };

  // ---------------------------------------------------------------- manual memory
  Deck.demo('manual', root => {
    const ADDR = ['0x4052a0', '0x4052e0', '0x405320', '0x405360'];
    const SC = {
      leak: {
        name: 'Утечка',
        code: `
void handle(Request *r) {
    char *buf = malloc(64);
    if (parse(r, buf) < 0)
        return;          // забыли free(buf)
    process(buf);
    free(buf);
}`,
        steps: [
          { line: 1, run: s => { s.vars = { buf: s.malloc('запрос #1') }; }, say: 'handle(запрос #1): <code>malloc</code> берёт новый блок у ОС.' },
          { line: 5, run: s => { s.free(s.vars.buf); s.vars = {}; }, say: 'Запрос корректный: <code>process</code>, потом <code>free(buf)</code>. Блок вернулся в tcache — список свободных блоков этого размера.', cls: 'ok' },
          { line: 1, run: s => { s.vars = { buf: s.malloc('запрос #2') }; }, say: 'handle(запрос #2): <code>malloc</code> отдаёт тот же блок из tcache — это быстрее, чем идти к ОС.' },
          { line: 3, run: s => { s.vars = {}; }, say: '<code>parse</code> вернул ошибку, функция вышла. Переменная <code>buf</code> исчезла вместе с кадром стека, а блок остался занятым — на него больше никто не указывает.', cls: 'warn' },
          { line: 1, run: s => { s.vars = { buf: s.malloc('запрос #3') }; }, say: 'Запрос #3: tcache пуст, <code>malloc</code> берёт ещё один новый блок.' },
          { line: 3, run: s => { s.vars = {}; }, say: 'Ещё одна утечка. 1000 ошибочных запросов в секунду по 64 байта — 5,5 ГБ за сутки. RSS растёт, пока процесс не убьёт OOM killer.', cls: 'bad' },
          { line: 3, run: () => {}, say: 'Исправление: <code>free(buf)</code> перед <code>return</code> или единый выход через <code>goto cleanup</code>. В C++ и Rust буфер освободит деструктор при любом выходе из функции.', cls: 'ok' },
        ],
      },
      uaf: {
        name: 'Use-after-free',
        code: `
User *u = malloc(sizeof(User));   // {name[8], is_admin}
strcpy(u->name, "alice");
User *cached = u;                 // второй указатель
free(u);
Order *o = malloc(sizeof(Order)); // {id, total}
o->total = 500;
cached->is_admin = 1;             // запись в чужой объект
printf("%d", o->total);`,
        steps: [
          { line: 0, run: s => { s.vars = { u: s.malloc('User{name="", is_admin=0}') }; }, say: '<code>malloc</code> отдал блок под User: 8 байт имени и флаг <code>is_admin</code> со смещением 8.' },
          { line: 1, run: s => { s.text(s.vars.u, 'User{name="alice", is_admin=0}'); }, say: 'Заполнили имя.' },
          { line: 2, run: s => { s.vars.cached = s.vars.u; }, say: 'Сохранили второй указатель — например, в кэше. Теперь на блок смотрят двое.' },
          { line: 3, run: s => { s.free(s.vars.u); s.dangle('u', 'cached'); }, say: '<code>free(u)</code> вернул блок в tcache. Но <code>u</code> и <code>cached</code> по-прежнему хранят его адрес: <code>free</code> не знает о них и не может их обнулить.', cls: 'warn' },
          { line: 4, run: s => { s.vars.o = s.malloc('Order{id=0, total=0}'); }, say: 'Следующий <code>malloc</code> того же размера получает этот же блок. Теперь в нём Order, а <code>cached</code> указывает туда же.' },
          { line: 5, run: s => { s.text(s.vars.o, 'Order{id=0, total=500}'); }, say: 'Записали сумму заказа: поле <code>total</code> тоже лежит со смещением 8.' },
          { line: 6, run: s => { s.text(s.vars.o, 'Order{id=0, total=1}', true); }, say: '<code>cached->is_admin = 1</code> пишет по смещению 8 — прямо в <code>o->total</code>. Ни ошибки, ни падения.', cls: 'bad' },
          { line: 7, run: () => {}, say: 'Печатается 1 вместо 500. Если на месте Order окажется объект с указателем на функцию, атакующий подменит его — так эксплуатируют use-after-free.', cls: 'bad' },
        ],
      },
      df: {
        name: 'Double free',
        code: `
char *a = malloc(32);
free(a);
free(a);                 // второй раз!
char *b = malloc(32);
char *c = malloc(32);
strcpy(b, "token=42");
strcpy(c, "hello");`,
        steps: [
          { line: 0, run: s => { s.vars = { a: s.malloc('""') }; }, say: 'Выделили блок.' },
          { line: 1, run: s => { s.free(s.vars.a); s.dangle('a'); }, say: 'Освободили: блок в tcache, <code>a</code> висит.' },
          { line: 2, run: s => { s.free(s.vars.a); }, say: 'Освободили ещё раз — блок дважды в списке свободных. Свежий glibc этот случай ловит: <code>free(): double free detected in tcache 2</code> и abort. Это лучший исход. Без проверки дальше будет так:', cls: 'warn' },
          { line: 3, run: s => { s.vars.b = s.malloc('""'); }, say: '<code>b</code> получил блок из головы списка.' },
          { line: 4, run: s => { s.vars.c = s.malloc('""'); }, say: '<code>c</code> получил его же: он был в списке второй раз. Два «разных» объекта в одной памяти.', cls: 'warn' },
          { line: 5, run: s => { s.text(s.vars.b, '"token=42"'); }, say: 'Записали токен через <code>b</code>.' },
          { line: 6, run: s => { s.text(s.vars.c, '"hello"', true); }, say: 'Запись через <code>c</code> затёрла данные <code>b</code>: теперь <code>b</code> читает "hello". Порча памяти без единой ошибки.', cls: 'bad' },
        ],
      },
    };

    let sc = 'leak', i, st;
    const scBtns = Object.entries(SC).map(([k, v]) => h('button', { class: 'btn small', onclick: () => { sc = k; reset(); } }, v.name));
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    const stepN = h('span', { class: 'step-n' });
    const codeBox = h('div');
    const vars = h('div', { class: 'mm-vars' });
    const heap = h('div', { class: 'mm-heap' });
    const tc = h('div', { class: 'mm-free' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    let cv;
    root.append(
      h('div', { class: 'controls' }, scBtns),
      codeBox,
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала'), stepN),
      h('span', { class: 'label' }, 'Указатели'), vars,
      h('span', { class: 'label' }, 'Куча: блоки одного размера'), heap, tc,
      logEl,
    );

    function state() {
      const s = {
        blocks: ADDR.map(() => ({ st: 'top', text: '', bad: false })),
        vars: {}, dangling: new Set(), tcache: [],
        malloc(text) {
          const k = s.tcache.length ? s.tcache.shift() : s.blocks.findIndex(b => b.st === 'top');
          Object.assign(s.blocks[k], { st: 'used', text, bad: false });
          return k;
        },
        free(k) { s.blocks[k].st = 'free'; s.blocks[k].text = ''; s.tcache.unshift(k); },
        text(k, t, bad = false) { s.blocks[k].text = t; s.blocks[k].bad = bad; },
        dangle(...names) { names.forEach(n => s.dangling.add(n)); },
      };
      return s;
    }
    function reset() {
      i = 0;
      st = state();
      scBtns.forEach((b, k) => b.classList.toggle('sel', Object.keys(SC)[k] === sc));
      cv = codeView(SC[sc].code, 'c');
      codeBox.replaceChildren(cv.el);
      say.reset();
      say('Нажмите «Шаг».');
      render(-1);
    }
    function step() {
      const steps = SC[sc].steps;
      if (i >= steps.length) return;
      const s = steps[i++];
      s.run(st);
      say(s.say, s.cls || '');
      render(s.line);
    }
    function render(line) {
      const steps = SC[sc].steps;
      cv.set(line);
      stepBtn.disabled = i >= steps.length;
      stepN.textContent = `${i} / ${steps.length}`;
      const held = new Set(Object.values(st.vars));
      const names = Object.keys(st.vars);
      vars.innerHTML = names.length
        ? names.map(n => `<span class="mm-var ${st.dangling.has(n) ? 'dangling' : ''}">${n} = ${ADDR[st.vars[n]]}${st.dangling.has(n) ? ' (висячий)' : ''}</span>`).join('')
        : '<span class="empty">нет — кадр стека пуст</span>';
      heap.innerHTML = st.blocks.map((b, k) => {
        let cls = b.st, label = { top: 'не выделялся', used: 'занят', free: 'свободен' }[b.st];
        if (b.st === 'used' && !held.has(k)) { cls = 'leak'; label = 'утечка: ничей'; }
        if (b.bad) cls = 'bad';
        return `<div class="mm-blk ${cls}"><span class="ad">${ADDR[k]}</span><span class="st">${label}</span><span class="ct">${b.text}</span></div>`;
      }).join('');
      tc.innerHTML = 'tcache: ' + (st.tcache.length ? st.tcache.map(k => `<b>${ADDR[k]}</b>`).join(' → ') : 'пусто');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- ownership (Rust)
  Deck.demo('ownership', root => {
    const code = `
fn main() {
    let a = String::from("hello");
    let b = a;              // владение переехало
    {
        let r = &b;         // заимствование
        println!("{r}");
    }
    let v = vec![b];        // b переехала в вектор
    println!("{}", v.len());
}                           // drop(v)`;
    const A = (b, s, cls = '') => ({ b, s, cls });
    const STEPS = [
      { line: 1, stack: [A('a', 'ptr → #1, len 5, cap 5', 'new')], heap: [A('#1 "hello"', '5 байт · владелец a', 'new')],
        say: '<code>String::from</code> выделяет 5 байт в куче. В стеке у <code>a</code> — указатель, длина и ёмкость: 24 байта.' },
      { line: 2, stack: [A('a', 'перемещена', 'moved'), A('b', 'ptr → #1, len 5, cap 5', 'new')], heap: [A('#1 "hello"', '5 байт · владелец b')],
        say: '<code>let b = a</code> копирует 24 байта заголовка, строка в куче остаётся на месте. <code>a</code> больше использовать нельзя — значит, освобождение будет ровно одно.' },
      { line: 4, stack: [A('a', 'перемещена', 'moved'), A('b', 'ptr → #1 · заимствована'), A('r', '&b — ссылка на b', 'borrow new')], heap: [A('#1 "hello"', '5 байт · владелец b')],
        say: '<code>r</code> заимствует <code>b</code>. Пока <code>r</code> жива, <code>b</code> нельзя изменить или переместить — это проверит компилятор.' },
      { line: 6, stack: [A('a', 'перемещена', 'moved'), A('b', 'ptr → #1, len 5, cap 5')], heap: [A('#1 "hello"', '5 байт · владелец b')],
        say: '<code>r</code> вышла из области видимости. Ссылка ничем не владеет, освобождать нечего.' },
      { line: 7, stack: [A('a', 'перемещена', 'moved'), A('b', 'перемещена', 'moved'), A('v', 'ptr → #2, len 1, cap 1', 'new')],
        heap: [A('#1 "hello"', 'владелец — элемент #2'), A('#2 [String]', '24 байта · владелец v', 'new')],
        say: '<code>vec!</code> выделяет буфер под один <code>String</code> и перемещает туда <code>b</code>. Строкой владеет вектор, вектором — <code>v</code>.' },
      { line: 9, stack: [], heap: [A('#1 "hello"', 'освобождена', 'freed'), A('#2 [String]', 'освобождён', 'freed')],
        say: 'Конец <code>main</code>: компилятор вставил <code>drop(v)</code>. Вектор сначала освобождает элементы, потом свой буфер. Ни сборщика, ни счётчиков — освобождение записано прямо в машинный код.', cls: 'ok' },
    ];
    let i;
    const cv = codeView(code, 'c');
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    const stepN = h('span', { class: 'step-n' });
    const stackCol = h('div', { class: 'ow-col stack' });
    const heapCol = h('div', { class: 'ow-col heap' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(
      cv.el,
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала'),
        h('button', { class: 'btn small', onclick: misuse }, h('code', null, 'println!("{a}")'), ' после move'), stepN),
      h('div', { class: 'ow' }, stackCol, heapCol),
      logEl,
    );
    function reset() { i = 0; say.reset(); say('Нажимайте «Шаг» и следите за стеком и кучей.'); render(); }
    function step() {
      if (i >= STEPS.length) return;
      const s = STEPS[i++];
      say(s.say, s.cls || '');
      render();
    }
    function misuse() {
      say('<code>error[E0382]: borrow of moved value: `a`</code> — value borrowed here after move. Программа с use-after-free просто не соберётся.', 'bad');
    }
    function render() {
      const s = STEPS[i - 1] || { line: 0, stack: [], heap: [] };
      cv.set(s.line);
      stepBtn.disabled = i >= STEPS.length;
      stepN.textContent = `${i} / ${STEPS.length}`;
      const items = list => list.length ? list.map(x => `<div class="ow-item ${x.cls}"><b>${x.b}</b><span>${x.s}</span></div>`).join('') : '<span class="ow-empty">пусто</span>';
      stackCol.innerHTML = '<span class="ow-h">Стек main</span>' + items(s.stack);
      heapCol.innerHTML = '<span class="ow-h">Куча</span>' + items(s.heap);
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- reference counting
  Deck.demo('refcount', root => {
    const code = `
a = Node("A")
a.next = Node("B")
b = a.next
a = None
b.next = Node("C")
c = b.next
c.next = b  # цикл
b = None
c = None`;
    const POS = { a: [30, 34], b: [30, 120], c: [30, 206], A: [135, 34], B: [250, 90], C: [250, 206] };
    // Each step mutates refs: vars[name] = obj|null, next[obj] = obj|null.
    const STEPS = [
      s => { s.make('A'); s.vars.a = 'A'; },
      s => { s.make('B'); s.next.A = 'B'; },
      s => { s.vars.b = 'B'; },
      s => { s.vars.a = null; },
      s => { s.make('C'); s.next.B = 'C'; },
      s => { s.vars.c = 'C'; },
      s => { s.next.C = 'B'; },
      s => { s.vars.b = null; },
      s => { s.vars.c = null; },
    ];
    const SAY = [
      'Создан A, на него ссылается <code>a</code>: счётчик 1.',
      'Создан B, на него ссылается A.',
      'Ещё одна ссылка на B: счётчик 2. Это запись в заголовок B.',
      null, // generated
      'Создан C, на него ссылается B.',
      'Ссылка из <code>c</code>: у C счётчик 2.',
      'C ссылается обратно на B — образовался цикл.',
      'Убрали <code>b</code>: у B остаётся 1 — ссылка из C.',
      null,
    ];
    let i, s, ops;
    const cv = codeView(code, 'py');
    const g = graphView(290, 232);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    const stepN = h('span', { class: 'step-n' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(
      h('div', { class: 'rc-split' }, cv.el, g.el),
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала'), stepN),
      h('div', { class: 'legend' }, h('span', null, h('i', { class: 'black' }), 'переменная'), h('span', null, h('i'), 'объект, число — счётчик'),
        h('span', null, h('i', { class: 'leak' }), 'недостижим, но счётчик > 0'), h('span', null, h('i', { class: 'freed' }), 'освобождён')),
      stats, logEl,
    );

    const edgesOf = st => {
      const e = [];
      for (const [k, v] of Object.entries(st.vars)) if (v) e.push([k, v]);
      for (const [k, v] of Object.entries(st.next)) if (v && !st.freed.has(k)) e.push([k, v]);
      return e;
    };
    const rcOf = st => {
      const rc = {};
      for (const o of st.objs) rc[o] = 0;
      for (const [, b] of edgesOf(st)) rc[b]++;
      return rc;
    };
    function fresh() {
      const st = { objs: [], vars: { a: null, b: null, c: null }, next: {}, freed: new Set() };
      st.make = o => { st.objs.push(o); st.next[o] = null; };
      return st;
    }
    function reset() {
      i = 0; s = fresh(); ops = 0;
      say.reset();
      say('Нажимайте «Шаг». Числа у объектов — счётчики ссылок.');
      render(new Set());
    }
    function step() {
      if (i >= STEPS.length) return;
      const before = new Set(edgesOf(s).map(e => e.join('>')));
      const rc0 = rcOf(s);
      STEPS[i](s);
      // Free everything whose count dropped to zero, cascading.
      const freedNow = [];
      for (;;) {
        const rc = rcOf(s);
        const z = s.objs.find(o => !s.freed.has(o) && rc[o] === 0);
        if (!z) break;
        s.freed.add(z);
        freedNow.push(z);
      }
      const after = new Set(edgesOf(s).map(e => e.join('>')));
      const added = new Set([...after].filter(e => !before.has(e)));
      ops += added.size + [...before].filter(e => !after.has(e)).length;
      const line = i;
      i++;
      let text = SAY[line];
      const rc = rcOf(s);
      if (line === 3) text = 'Убрали <code>a</code>: у A счётчик 0 — он освобождается сразу. При этом уменьшается счётчик того, на что A ссылался: у B теперь 1.';
      if (line === 8) {
        text = 'Убрали <code>c</code>. B и C больше недостижимы из программы, но ссылаются друг на друга: счётчики 1 и 1. Они не освободятся никогда — это утечка. Чинит её сборщик циклов (следующий слайд).';
      }
      const cls = line === 8 ? 'bad' : freedNow.length ? 'ok' : '';
      const changes = s.objs.filter(o => rc0[o] !== undefined && rc0[o] !== rc[o] && !freedNow.includes(o)).map(o => `${o}: ${rc0[o]} → ${rc[o]}`);
      say(text + (changes.length && line !== 3 ? ` <span class="label">(${changes.join(', ')})</span>` : ''), cls);
      render(added);
      cv.set(line);
    }
    function reachable() {
      const seen = new Set();
      const q = Object.values(s.vars).filter(Boolean);
      while (q.length) {
        const o = q.pop();
        if (seen.has(o)) continue;
        seen.add(o);
        if (s.next[o]) q.push(s.next[o]);
      }
      return seen;
    }
    function render(added) {
      cv.set(i - 1);
      stepBtn.disabled = i >= STEPS.length;
      stepN.textContent = `${i} / ${STEPS.length}`;
      const rc = rcOf(s), reach = reachable();
      const nodes = ['a', 'b', 'c'].map(v => ({ id: v, x: POS[v][0], y: POS[v][1], label: v, root: true, w: 38, cls: s.vars[v] ? '' : 'off' }));
      for (const o of s.objs) {
        const freed = s.freed.has(o);
        nodes.push({ id: o, x: POS[o][0], y: POS[o][1], label: o, cls: freed ? 'freed' : !reach.has(o) ? 'leak' : '', badge: freed ? null : rc[o], badgeCls: rc[o] ? '' : 'zero' });
      }
      const edges = edgesOf(s).map(([a, b]) => ({ a, b, cls: added.has(a + '>' + b) ? 'new' : '' }));
      g.draw(nodes, edges);
      const live = s.objs.filter(o => !s.freed.has(o));
      const leaked = live.filter(o => !reach.has(o)).length;
      stats.innerHTML = `<div class="stat"><b>${ops}</b><span>изменений счётчиков</span></div>` +
        `<div class="stat"><b>${s.freed.size}</b><span>освобождено</span></div>` +
        `<div class="stat ${leaked ? 'warn' : ''}"><b>${leaked}</b><span>утекло</span></div>`;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- CPython cycle collector
  Deck.demo('cyclegc', root => {
    const POS = { cache: [44, 46], L: [150, 46], A: [250, 46], B: [345, 46], C: [150, 176], D: [250, 176], E: [345, 176] };
    const LABEL = { L: 'L', A: 'A', B: 'B', C: 'C', D: 'D', E: 'E' };
    const OBJS = ['L', 'A', 'B', 'C', 'D', 'E'];
    const EDGES0 = [['cache', 'L'], ['L', 'A'], ['A', 'B'], ['B', 'A'], ['C', 'D'], ['D', 'E'], ['E', 'C'], ['D', 'A']];
    const PHASES = [
      'Скопировать refcount в gc_refs',
      'Вычесть ссылки изнутри группы',
      'gc_refs > 0 — на объект ссылаются снаружи',
      'Обойти всё, что достижимо от них',
      'Остальное — мусор: разорвать и освободить',
    ];
    let ph, edges, gcRefs, cls, badgeTitle;
    const g = graphView(380, 246);
    const title = h('span', { class: 'label' });
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    const stepN = h('span', { class: 'step-n' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(
      title, g.el,
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала'), stepN),
      h('div', { class: 'legend' }, h('span', null, h('i', { class: 'ext' }), 'ссылка снаружи'), h('span', null, h('i', { class: 'live' }), 'достижим'), h('span', null, h('i', { class: 'freed' }), 'освобождён')),
      logEl,
    );
    const refcount = () => {
      const rc = Object.fromEntries(OBJS.map(o => [o, 0]));
      for (const [, b] of edges) if (b in rc) rc[b]++;
      return rc;
    };
    let edgeCls = {};
    function reset() {
      ph = 0;
      edges = EDGES0.map(e => [...e]);
      gcRefs = refcount();
      cls = {};
      edgeCls = {};
      say.reset();
      badgeTitle = 'Числа — счётчики ссылок (refcount). Переменная <code>cache</code> живёт вне проверяемой группы.';
      say('Список L держит A, A и B ссылаются друг на друга. C → D → E → C — цикл, на который никто снаружи не ссылается, но D ссылается на A.');
      render();
    }
    function step() {
      if (ph >= PHASES.length) return;
      ph++;
      edgeCls = {};
      if (ph === 1) {
        gcRefs = refcount();
        badgeTitle = 'Числа — gc_refs, рабочая копия счётчика.';
        say('Шаг 1. Для каждого контейнера в поколении заводится gc_refs = refcount. Сами счётчики не трогаем — программа может продолжить работу.');
      } else if (ph === 2) {
        for (const [a, b] of edges) if (OBJS.includes(a) && OBJS.includes(b)) { gcRefs[b]--; edgeCls[a + '>' + b] = 'hot'; }
        say('Шаг 2. Обходим каждый контейнер и для каждой его ссылки уменьшаем gc_refs цели. Остаток — ссылки извне группы: из стека, глобальных переменных, старших поколений.');
      } else if (ph === 3) {
        for (const o of OBJS) if (gcRefs[o] > 0) cls[o] = 'ext';
        say(`Шаг 3. Ненулевой остаток только у списка L: на него ссылается <code>cache</code>. У A ноль, хотя ссылок на него три, — все они изнутри группы.`);
      } else if (ph === 4) {
        const q = OBJS.filter(o => cls[o] === 'ext');
        const seen = new Set();
        while (q.length) {
          const o = q.shift();
          if (seen.has(o)) continue;
          seen.add(o);
          for (const [a, b] of edges) if (a === o) { edgeCls[a + '>' + b] = 'hot'; q.push(b); }
        }
        for (const o of seen) cls[o] = cls[o] === 'ext' ? 'ext' : 'live';
        say('Шаг 4. От объектов с внешними ссылками обходим граф: L → A → B. Они живы, хотя у A и B было gc_refs = 0.', 'ok');
      } else {
        const dead = OBJS.filter(o => !cls[o]);
        dead.forEach(o => { cls[o] = 'freed'; });
        edges = edges.filter(([a]) => !dead.includes(a));
        gcRefs = refcount();
        badgeTitle = 'Числа — снова refcount.';
        say(`Шаг 5. ${dead.join(', ')} недостижимы. Сборщик разрывает их ссылки (<code>tp_clear</code>), счётчики падают до нуля, и обычный механизм освобождает объекты. У A счётчик уменьшился: ссылка из D пропала.`, 'ok');
      }
      render();
    }
    function render() {
      title.innerHTML = badgeTitle;
      stepBtn.disabled = ph >= PHASES.length;
      stepN.textContent = ph ? `${ph} / ${PHASES.length}: ${PHASES[ph - 1]}` : `0 / ${PHASES.length}`;
      const nodes = [{ id: 'cache', x: POS.cache[0], y: POS.cache[1], label: 'cache', root: true, w: 60 }];
      for (const o of OBJS) {
        const c = cls[o] || '';
        nodes.push({ id: o, x: POS[o][0], y: POS[o][1], label: LABEL[o], cls: c, badge: c === 'freed' ? null : gcRefs[o], badgeCls: gcRefs[o] ? '' : 'zero' });
      }
      const es = edges.map(([a, b]) => ({ a, b, cls: edgeCls[a + '>' + b] || '', bend: a === 'E' && b === 'C' ? -48 : 0 }));
      g.draw(nodes, es, '<rect class="area" x="108" y="8" width="268" height="234" rx="12"/><text class="lbl" x="118" y="232">проверяемое поколение</text>');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- mark & sweep
  Deck.demo('marksweep', root => {
    const X = [148, 228, 308, 382], Y = [40, 125, 210];
    const POS = {};
    'ABCDEFGHIJKL'.split('').forEach((c, k) => { POS[c] = [X[k % 4], Y[Math.floor(k / 4)]]; });
    const ROOTS = { req: [38, 40], user: [38, 125], config: [38, 210] };
    const ROOT_EDGES = [['req', 'A'], ['user', 'E'], ['config', 'I']];
    const EDGES = [['A', 'B'], ['B', 'C'], ['E', 'F'], ['F', 'B'], ['I', 'J'], ['J', 'F'], ['G', 'D'], ['G', 'H'], ['H', 'G'], ['K', 'H'], ['L', 'K']];
    const OBJS = Object.keys(POS);
    let color, wl, phase, userNil = false, scanned, lastHot;
    const g = graphView(404, 250);
    const stepBtn = h('button', { class: 'btn primary', onclick: () => step() }, 'Шаг');
    const runBtn = h('button', { class: 'btn', onclick: () => (auto.on ? auto.stop() : auto.play(), sync()) }, 'До конца');
    const nilBtn = h('button', { class: 'btn small', onclick: toggleNil });
    const wlEl = h('div', { class: 'worklist' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const auto = autoplay(() => { step(); }, () => phase !== 'done', 600);
    root.append(
      g.el,
      h('div', { class: 'legend' }, h('span', null, h('i'), 'белый: не найден'), h('span', null, h('i', { class: 'grey' }), 'серый: в очереди'), h('span', null, h('i', { class: 'black' }), 'чёрный: просмотрен'), h('span', null, h('i', { class: 'freed' }), 'освобождён')),
      wlEl,
      h('div', { class: 'controls' }, stepBtn, runBtn, nilBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      logEl,
    );
    const rootEdges = () => ROOT_EDGES.filter(([r]) => !(userNil && r === 'user'));
    function reset() {
      auto.stop();
      color = Object.fromEntries(OBJS.map(o => [o, 'white']));
      wl = []; phase = 'idle'; scanned = 0; lastHot = null;
      say.reset();
      say('Куча до сборки: 12 объектов. Какие из них мусор, пока никто не знает. Нажмите «Шаг».');
      render();
    }
    function toggleNil() {
      userNil = !userNil;
      reset();
      say(userNil ? '<code>user = nil</code>: E больше не достижим из корней. А F?' : 'Вернули <code>user</code>.');
    }
    const name = list => list.join(', ');
    function step() {
      lastHot = null;
      if (phase === 'idle') {
        const found = rootEdges().map(([, o]) => o);
        found.forEach(o => { color[o] = 'grey'; wl.push(o); });
        phase = 'mark';
        say(`Сканируем корни: ${name(found)} — серые, в очереди на просмотр. Это единственный момент, когда сборщику нужны стеки потоков.`);
      } else if (phase === 'mark') {
        const o = wl.shift();
        const kids = EDGES.filter(([a]) => a === o).map(([, b]) => b);
        const white = kids.filter(k => color[k] === 'white');
        white.forEach(k => { color[k] = 'grey'; wl.push(k); });
        color[o] = 'black';
        scanned++;
        lastHot = o;
        let t = `Просматриваем ${o}: ` + (white.length ? `${name(white)} — ${white.length > 1 ? 'серые' : 'серый'}` : kids.length ? `${name(kids)} уже ${kids.length > 1 ? 'найдены' : 'найден'}` : 'указателей нет') + `. ${o} — чёрный.`;
        if (!wl.length) { phase = 'sweep'; t += ' Серых не осталось — разметка закончена.'; }
        say(t);
      } else if (phase === 'sweep') {
        const dead = OBJS.filter(o => color[o] === 'white');
        dead.forEach(o => { color[o] = 'freed'; });
        phase = 'done';
        say(`Очистка: освобождены ${name(dead)} — ${dead.length} ${plural(dead.length, ['объект', 'объекта', 'объектов'])}. Цикл G ⇄ H не спас: до него не дойти от корней. Разметка просмотрела ${scanned} живых, мусор она не трогала.`, 'ok');
      }
      render();
    }
    function sync() { runBtn.textContent = auto.on ? 'Пауза' : 'До конца'; }
    function render() {
      stepBtn.disabled = phase === 'done';
      runBtn.disabled = phase === 'done';
      if (phase === 'done') auto.stop();
      sync();
      nilBtn.innerHTML = userNil ? 'вернуть <code>user</code>' : '<code>user = nil</code>';
      nilBtn.disabled = phase !== 'idle' && phase !== 'done';
      const nodes = Object.entries(ROOTS).map(([r, [x, y]]) => ({ id: r, x, y, label: r, root: true, w: 58, cls: userNil && r === 'user' ? 'off' : '' }));
      for (const o of OBJS) {
        const c = color[o];
        nodes.push({ id: o, x: POS[o][0], y: POS[o][1], label: o, cls: (c === 'white' ? '' : c) + (o === lastHot ? ' flash' : '') });
      }
      const edges = [
        ...ROOT_EDGES.map(([a, b]) => ({ a, b, cls: userNil && a === 'user' ? 'dim' : '' })),
        ...EDGES.map(([a, b]) => ({ a, b, cls: color[a] === 'freed' ? 'dim' : a === lastHot ? 'hot' : '' })),
      ];
      g.draw(nodes, edges, '<text class="lbl" x="6" y="250">корни</text><text class="lbl" x="120" y="250">куча</text>');
      wlEl.innerHTML = '<span class="label">Очередь серых:</span> ' + (wl.length ? wl.map(o => `<span class="val">${o}</span>`).join('') : '<span class="empty">пусто</span>') +
        `<span class="step-n">${{ idle: 'до сборки', mark: 'разметка', sweep: 'разметка закончена', done: 'сборка завершена' }[phase]}</span>`;
    }
    reset();
    return { stop: () => { auto.stop(); sync(); } };
  });

  // ---------------------------------------------------------------- tri-colour + write barrier
  Deck.demo('tricolor', root => {
    const POS = { stack: [40, 34], A: [150, 34], B: [290, 34], C: [290, 116] };
    const MODES = { none: 'Без барьера', dijkstra: 'Барьер Дейкстры', yuasa: 'Барьер Юасы' };
    const SCRIPT = [
      ['gc', 'Сборщик', 'сканирует корни: A — серый'],
      ['gc', 'Сборщик', 'просматривает A: B — серый, A — чёрный'],
      ['mut', 'Программа', '<code>A.next = B.next</code> — A указывает на C'],
      ['mut', 'Программа', '<code>B.next = nil</code> — B больше не указывает на C'],
      ['gc', 'Сборщик', 'просматривает B'],
      ['gc', 'Сборщик', 'берёт следующий серый объект'],
      ['gc', 'Сборщик', 'очистка: белые освобождаются'],
    ];
    let mode = 'none', i, col, edges, wl, dangling;
    const modeBtns = Object.entries(MODES).map(([k, v]) => h('button', { class: 'btn small', onclick: () => { mode = k; reset(); } }, v));
    const g = graphView(340, 140);
    const list = h('ol', { class: 'tc-script' });
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(
      h('div', { class: 'tc-modes' }, modeBtns),
      g.el, list,
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала')),
      logEl,
    );
    const shade = o => { if (col[o] === 'white') { col[o] = 'grey'; wl.push(o); return true; } return false; };
    function reset() {
      i = 0;
      col = { A: 'white', B: 'white', C: 'white' };
      edges = [['stack', 'A'], ['A', 'B'], ['B', 'C']];
      wl = []; dangling = false;
      modeBtns.forEach((b, k) => b.classList.toggle('sel', Object.keys(MODES)[k] === mode));
      say.reset();
      say({
        none: 'Барьера нет. Нажимайте «Шаг»: сборщик и программа работают по очереди.',
        dijkstra: 'Барьер Дейкстры: при записи указателя новое значение красится в серый.',
        yuasa: 'Барьер Юасы: при перезаписи указателя старое значение красится в серый — как будто разметка видит снимок графа на начало цикла.',
      }[mode]);
      render();
    }
    function step() {
      if (i >= SCRIPT.length) return;
      const k = i++;
      if (k === 0) { shade('A'); say('Корни просканированы: A в очереди.'); }
      if (k === 1) { wl.shift(); shade('B'); col.A = 'black'; say('A просмотрен и стал чёрным: к нему сборщик больше не вернётся.'); }
      if (k === 2) {
        edges.push(['A', 'C']);
        if (mode === 'dijkstra' && shade('C')) say('Барьер: в чёрный A пишется указатель на белый C — C красится в серый и попадает в очередь.', 'ok');
        else if (mode === 'yuasa') say('Барьер Юасы смотрит на старое значение <code>A.next</code> — там было пусто, красить нечего. Чёрный A указывает на белый C.', 'warn');
        else say('Чёрный A теперь указывает на белый C. Инвариант «чёрный не указывает на белый» нарушен, но C пока ещё виден через серый B.', 'warn');
      }
      if (k === 3) {
        edges = edges.filter(([a, b]) => !(a === 'B' && b === 'C'));
        if (mode === 'yuasa' && shade('C')) say('Барьер: перезаписывается указатель на белый C — старое значение красится в серый.', 'ok');
        else if (mode === 'dijkstra') say('C уже серый, удаление ссылки ничего не меняет.', 'ok');
        else say('Теперь C достижим только через чёрный A. Серых путей к нему не осталось.', 'bad');
      }
      if (k === 4) {
        wl.shift(); col.B = 'black';
        say('B просмотрен — у него нет указателей. ' + (wl.length ? 'В очереди ещё C.' : 'Очередь пуста.'));
      }
      if (k === 5) {
        if (wl.length) { wl.shift(); col.C = 'black'; say('C просмотрен — он жив.', 'ok'); }
        else say('Серых нет — разметка закончена. C остался белым, хотя на него указывает A.', 'bad');
      }
      if (k === 6) {
        if (col.C === 'white') {
          col.C = 'dangle'; dangling = true;
          say('C освобождён, а <code>A.next</code> всё ещё указывает на эту память. Следующее выделение займёт её, и A прочитает чужие данные. Поэтому без барьера конкурентный сборщик невозможен.', 'bad');
        } else say('Белых нет — ничего живого не освобождено. Цена — несколько инструкций на каждую запись указателя, пока идёт разметка.', 'ok');
      }
      render();
    }
    function render() {
      stepBtn.disabled = i >= SCRIPT.length;
      list.innerHTML = SCRIPT.map(([kind, who, what], k) =>
        `<li class="${kind} ${k === i - 1 ? 'cur' : k < i ? 'done' : ''}"><span class="who">${k + 1}. ${who}</span><span>${what}</span></li>`).join('');
      const nodes = [{ id: 'stack', x: POS.stack[0], y: POS.stack[1], label: 'стек', root: true, w: 58 }];
      for (const o of ['A', 'B', 'C']) nodes.push({ id: o, x: POS[o][0], y: POS[o][1], label: o, cls: col[o] === 'white' ? '' : col[o] });
      g.draw(nodes, edges.map(([a, b]) => ({ a, b, cls: a === 'A' && b === 'C' ? (dangling ? 'bad' : 'new') : '' })));
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- compaction
  Deck.demo('compact', root => {
    const N = 32;
    const FIRST = [2, 3, 1, 2, 2, 3, 1, 2, 2, 3, 1, 3, 2, 2, 1, 2]; // odd ones die first
    let objs, mode, top, letter, first;
    const strip = h('div', { class: 'hs' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn', onclick: die }, 'Часть объектов умерла'),
        h('button', { class: 'btn', onclick: () => alloc(4) }, h('code', null, 'new'), ' 4 КБ'),
        h('button', { class: 'btn', onclick: () => alloc(1) }, h('code', null, 'new'), ' 1 КБ')),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: sweep }, 'Mark-sweep'),
        h('button', { class: 'btn primary', onclick: compact }, 'Mark-compact'),
        h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('div', { class: 'hs-wrap' }, strip),
      h('div', { class: 'legend' }, h('span', null, h('i', { class: 'ext' }), 'живой объект'), h('span', null, h('i', { class: 'grey' }), 'мусор, ещё не собран'), h('span', null, h('i', { class: 'freed' }), 'свободно'), h('span', null, '▲ top — граница bump-аллокации')),
      stats, logEl,
    );
    const nextLetter = () => String.fromCharCode(65 + (letter++ % 26));
    function reset() {
      objs = []; letter = 0; first = true;
      let at = 0;
      for (const sz of FIRST) { objs.push({ id: nextLetter(), size: sz, start: at, dead: false }); at += sz; }
      mode = 'bump'; top = N;
      say.reset();
      say('Куча (32 КБ) заполнена. Нажмите «Часть объектов умерла», затем соберите мусор одним из способов.');
      render();
    }
    function die() {
      const live = objs.filter(o => !o.dead);
      if (first) { objs.forEach((o, k) => { if (k % 2) o.dead = true; }); first = false; }
      else live.forEach(o => { if (Math.random() < 0.5) o.dead = true; });
      objs.forEach(o => { o.fresh = false; });
      say('Часть объектов стала мусором. Сборщик об этом пока не знает: память занята, пока он не пройдёт.');
      render();
    }
    function cells() {
      const c = Array(N).fill(null);
      for (const o of objs) for (let k = 0; k < o.size; k++) c[o.start + k] = o;
      return c;
    }
    function holes() {
      const c = cells(), out = [];
      let s = -1;
      for (let k = 0; k <= N; k++) {
        const free = k < N && !c[k] && (mode === 'freelist' || k >= top);
        if (free && s < 0) s = k;
        if (!free && s >= 0) { out.push([s, k - s]); s = -1; }
      }
      return out;
    }
    function sweep() {
      const n = objs.filter(o => o.dead).length;
      objs = objs.filter(o => !o.dead);
      objs.forEach(o => { o.fresh = false; });
      mode = 'freelist';
      const hs = holes();
      const total = hs.reduce((s, x) => s + x[1], 0), big = Math.max(0, ...hs.map(x => x[1]));
      say(`Mark-sweep: ${n} ${plural(n, ['мёртвый объект стал', 'мёртвых объекта стали', 'мёртвых объектов стали'])} дырами. Свободно ${total} КБ, но самый большой кусок — ${big} КБ. Новые объекты ищут подходящую дыру по спискам свободных блоков.`, big < 4 ? 'warn' : '');
      render();
    }
    function compact() {
      objs = objs.filter(o => !o.dead).sort((a, b) => a.start - b.start);
      let at = 0;
      for (const o of objs) { o.start = at; at += o.size; o.fresh = false; }
      mode = 'bump'; top = at;
      say(`Mark-compact: живые сдвинуты к началу, все указатели на них исправлены. Свободно ${N - at} КБ одним куском после top.`, 'ok');
      render();
    }
    function alloc(sz) {
      objs.forEach(o => { o.fresh = false; });
      const id = nextLetter();
      if (mode === 'bump') {
        if (top + sz > N) { say(`До конца кучи осталось ${N - top} КБ — <code>new</code> ${sz} КБ не помещается. Пора собирать мусор.`, 'warn'); letter--; render(); return; }
        objs.push({ id, size: sz, start: top, dead: false, fresh: true });
        top += sz;
        say(`<code>new</code> ${sz} КБ — это <code>top += ${sz}</code>: ни поиска дыры, ни списков. Несколько инструкций, поэтому выделение в JVM и V8 почти бесплатно.`, 'ok');
      } else {
        const hs = holes();
        const fit = hs.find(x => x[1] >= sz);
        if (!fit) {
          const total = hs.reduce((s, x) => s + x[1], 0), big = Math.max(0, ...hs.map(x => x[1]));
          say(`<code>new</code> ${sz} КБ не помещается: свободно ${total} КБ, но кусками не больше ${big} КБ. Это фрагментация. Без перемещения остаётся просить у ОС ещё памяти.`, 'bad');
          letter--; render(); return;
        }
        objs.push({ id, size: sz, start: fit[0], dead: false, fresh: true });
        say(`<code>new</code> ${sz} КБ лёг в первую подходящую дыру (first-fit). Аллокатор Go делает похоже: блоки одного класса размера в своих span'ах.`);
      }
      render();
    }
    function render() {
      const c = cells();
      strip.innerHTML = c.map((o, k) => {
        if (!o) return `<div class="hc free ${k > 0 && !c[k - 1] ? '' : 's'} ${k < N - 1 && !c[k + 1] ? '' : 'e'} ${mode === 'bump' && k === top ? 'top' : ''}"></div>`;
        const s = o.start === k, e = o.start + o.size - 1 === k;
        return `<div class="hc ${o.dead ? 'dead' : 'obj'} ${o.fresh ? 'fresh' : ''} ${s ? 's' : ''} ${e ? 'e' : ''}">${s ? o.id : ''}</div>`;
      }).join('');
      const hs = holes();
      const total = hs.reduce((s, x) => s + x[1], 0), big = Math.max(0, ...hs.map(x => x[1]));
      stats.innerHTML = `<div class="stat"><b>${total} КБ</b><span>свободно</span></div>` +
        `<div class="stat ${big < 4 && total >= 4 ? 'warn' : ''}"><b>${big} КБ</b><span>самый большой кусок</span></div>` +
        `<div class="stat"><b>${mode === 'bump' ? 'bump' : 'free list'}</b><span>как выделяем</span></div>`;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- generations
  Deck.demo('generations', root => {
    const EDEN = 24, SURV = 12, OLD = 48;
    let t, acc, eden, surv, old, minors, majors, promoted, promoRate, flash, rate = 15, thr = 3;
    const mkSlider = (label, min, max, val, fmt, on) => {
      const out = h('output', null, fmt(val));
      const input = h('input', { type: 'range', min, max, value: val, 'aria-label': label });
      input.addEventListener('input', () => { out.textContent = fmt(+input.value); on(+input.value); });
      return h('label', { class: 'slider inline' }, h('span', { class: 'label' }, label), input, out);
    };
    const areas = {};
    const area = (key, title) => {
      const head = h('span');
      const cells = h('div', { class: 'gen-cells' + (key === 'old' ? ' old' : '') });
      const el = h('div', { class: 'gen-area' }, h('div', { class: 'gen-h' }, title, head), cells);
      areas[key] = { el, head, cells };
      return el;
    };
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(
      mkSlider('Темп выделения', 5, 60, rate, v => v + '/с', v => { rate = v; }),
      mkSlider('Порог возраста', 1, 6, thr, v => v + '', v => { thr = v; }),
      h('div', { class: 'gen' }, area('eden', 'Eden — новые объекты'), area('surv', 'Survivor — пережили minor GC'), area('old', 'Старое поколение')),
      h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:#f2b9cb;border-color:#f2b9cb;border-radius:2px' }), 'новый'),
        h('span', null, h('i', { style: 'background:#7c1639;border-color:#7c1639;border-radius:2px' }), 'старше'),
        h('span', null, h('i', { class: 'grey', style: 'border-radius:2px' }), 'уже мёртв, но не собран')),
      stats, logEl,
    );
    function life() {
      const r = Math.random();
      if (r < 0.88) return 0.02 + Math.random() * 0.25;    // temporaries of one request
      if (r < 0.98) return 1.5 + Math.random() * 3.5;      // sessions, batches
      return 20 + Math.random() * 40;                      // caches, pools
    }
    function reset() {
      t = 0; acc = 0; eden = []; surv = []; old = []; minors = 0; majors = 0; promoted = 0; promoRate = 0; flash = {};
      say('Объекты создаются в eden. Большинство умирает, не дожив до первой сборки.');
    }
    const alive = o => o.die > t;
    function major() {
      const before = old.length;
      old = old.filter(alive);
      majors++;
      flash.old = 0.35;
      say(`Major GC: старое поколение почти заполнено. Просмотрено ${before}, освобождено ${before - old.length}. Это дорогая сборка — по всей старой куче.`, 'warn');
    }
    function minor() {
      const live = [...surv, ...eden].filter(alive);
      const deadN = eden.length + surv.length - live.length;
      live.forEach(o => { o.age++; });
      const up = live.filter(o => o.age >= thr);
      let keep = live.filter(o => o.age < thr);
      let early = 0;
      if (keep.length > SURV) {
        keep.sort((a, b) => b.age - a.age);
        const extra = keep.splice(0, keep.length - SURV);
        up.push(...extra);
        early = extra.length;
      }
      if (old.length + up.length > OLD) major();
      if (old.length + up.length > OLD) {
        say('Старое поколение заполнено живыми объектами: <code>OutOfMemoryError</code>. Начинаем заново.', 'bad');
        const r = rate;
        reset(); rate = r;
        return;
      }
      old.push(...up);
      promoted += up.length;
      promoRate += up.length;
      surv = keep; eden = [];
      minors++;
      flash.eden = 0.25; flash.surv = 0.25;
      const msg = `Minor GC #${minors}: из ${live.length + deadN} объектов живы ${live.length} — скопированы, ${deadN} мёртвых не потребовали работы. ` +
        (up.length ? `В старое поколение: ${up.length}${early ? ` (из них ${early} раньше срока — survivor переполнен)` : ''}.` : 'В старое никто не попал.');
      if (!flash.old || flash.old <= 0) say(msg, up.length > 3 ? 'warn' : '');
      if (old.length > OLD * 0.85) major();
    }
    function tick(dt) {
      t += dt;
      acc += rate * dt;
      while (acc >= 1) {
        acc--;
        if (eden.length >= EDEN) minor();
        eden.push({ die: t + life(), age: 0 });
      }
      promoRate *= Math.exp(-dt / 5);
      for (const k in flash) flash[k] -= dt;
      render();
    }
    const cell = o => !o ? '<i></i>' : !alive(o) ? '<i class="d"></i>' : `<i class="${o.age === 0 ? 'n' : o.age === 1 ? 'a1' : o.age === 2 ? 'a2' : 'a3'}"></i>`;
    function fill(list, n, oldStyle) {
      let s = '';
      for (let k = 0; k < n; k++) {
        const o = list[k];
        s += oldStyle && o && alive(o) ? '<i class="o"></i>' : cell(o);
      }
      return s;
    }
    function render() {
      areas.eden.cells.innerHTML = fill(eden, EDEN);
      areas.surv.cells.innerHTML = fill(surv, SURV);
      areas.old.cells.innerHTML = fill(old, OLD, true);
      areas.eden.head.textContent = `${eden.length}/${EDEN}`;
      areas.surv.head.textContent = `${surv.length}/${SURV}`;
      areas.old.head.textContent = `${old.length}/${OLD}`;
      for (const k of ['eden', 'surv', 'old']) areas[k].el.classList.toggle('flash', flash[k] > 0);
      stats.innerHTML = `<div class="stat"><b>${minors}</b><span>minor GC</span></div>` +
        `<div class="stat ${majors ? 'warn' : ''}"><b>${majors}</b><span>major GC</span></div>` +
        `<div class="stat"><b>${(promoRate / 5).toFixed(1).replace('.', ',')}/с</b><span>переходят в старое</span></div>`;
    }
    const loop = rafLoop(tick);
    reset();
    render();
    return { start: loop.start, stop: loop.stop };
  });
})();

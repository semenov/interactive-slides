// Demos for slides 2–10: address space, call stack, calling convention, stack overflow,
// thread stacks, dangling pointer, stack buffer overflow.
(() => {
  'use strict';
  const { h, highlight, plural } = Deck;
  const fmt = n => n.toLocaleString('ru-RU');
  const hex = n => '0x' + n.toString(16);
  const KB = 1024, MB = 1024 * KB, GB = 1024 * MB;
  const bytes = n => {
    if (n >= GB) return (n / GB).toFixed(n >= 10 * GB ? 0 : 1).replace('.', ',') + ' ГБ';
    if (n >= MB) return (n / MB).toFixed(n >= 10 * MB ? 0 : 1).replace('.', ',') + ' МБ';
    if (n >= KB) return Math.round(n / KB) + ' КБ';
    return n + ' Б';
  };

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  const codeLines = (src, lang) => highlight(src, lang).split('\n');

  // ---------------------------------------------------------------- address space map
  Deck.demo('layout', root => {
    const SEGS = [
      ['kernel', 'ядро', '0xffff800000000000…', '---', 'Верхняя половина адресов принадлежит ядру. Из пользовательского кода обращение туда — SIGSEGV. Между ней и стеком — огромная дыра неканонических адресов.'],
      ['stack', '[stack]', '0x7ffc3a8f2000', 'rw-p', 'Стек главного потока. Растёт вниз, до 8 МБ (ulimit -s). Тут кадры вызовов: адреса возврата, аргументы, не поместившиеся в регистры, и локальные переменные.'],
      ['mmap', 'mmap', '0x7f3a1be00000', 'r-xp / rw-p', 'Область отображений: разделяемые библиотеки (libc.so, libm.so), стеки других потоков и большие блоки malloc — от 128 КБ glibc берёт их прямо у ядра через mmap. Растёт сверху вниз.'],
      ['heap', '[heap]', '0x55d4c4b2a000', 'rw-p', 'Куча: её конец (program break) двигает системный вызов brk. Здесь malloc раздаёт небольшие блоки. Начинается со случайным отступом после .bss.'],
      ['bss', '.bss', '0x55d4c3a04020', 'rw-p', 'Глобальные и static-переменные без инициализатора. В файле не занимают места: ядро просто отображает обнулённые страницы.'],
      ['data', '.data', '0x55d4c3a04000', 'rw-p', 'Глобальные и static-переменные с начальным значением. Значения скопированы из исполняемого файла.'],
      ['rodata', '.rodata', '0x55d4c3a02000', 'r--p', 'Константы и строковые литералы. Только чтение: попытка записи — SIGSEGV.'],
      ['text', '.text', '0x55d4c3a01000', 'r-xp', 'Машинный код программы. Чтение и исполнение, записи нет. Страницы общие для всех процессов, запущенных из одного файла.'],
      ['null', 'не отображено', '0x0', '---', 'Нижние 64 КБ адресов не отображаются никогда (vm.mmap_min_addr), поэтому разыменование NULL гарантированно падает, а не читает мусор.'],
    ];
    const ITEMS = {
      counter: ['data', 0x55d4c3a04010, 'Глобальная с инициализатором: 4 байта в .data, 42 записано прямо в ELF-файле.'],
      table: ['bss', 0x55d4c3a04040, 'Глобальный массив без инициализатора: 4000 байт в .bss. В файле — ноль байт, только размер.'],
      greet: ['data', 0x55d4c3a04018, 'Сам указатель — глобальная переменная в .data (8 байт). А то, на что он указывает, лежит в .rodata.'],
      hello: ['rodata', 0x55d4c3a02004, 'Строковый литерал: 6 байт в .rodata, включая завершающий ноль. Менять нельзя.'],
      fmt: ['rodata', 0x55d4c3a0200a, 'Строка формата — тоже литерал в .rodata.'],
      square: ['text', 0x55d4c3a01149, 'Функция — это просто адрес её первой инструкции в .text. Указатель на функцию хранит именно его.'],
      x: ['stack', 0x7ffc3a911e3c, 'Аргумент приходит в регистре edi. Без оптимизаций компилятор сохраняет его в кадре square на стеке, с -O2 он так и живёт в регистре.'],
      calls: ['bss', 0x55d4c3a04fe0, 'static внутри функции — та же глобальная переменная, только с ограниченной видимостью. Без инициализатора — в .bss, сразу за table.'],
      n: ['stack', 0x7ffc3a911e5c, 'Локальная переменная: 4 байта в кадре main. Место под неё выделено вместе со всем кадром одной инструкцией sub rsp.'],
      buf: ['stack', 0x7ffc3a911e60, 'Переменная buf — 8-байтный указатель на стеке. Сами 64 байта, на которые он указывает, — в куче.'],
      m64: ['heap', 0x55d4c4b2a2a0, 'malloc(64) отрезал блок в [heap]. Первый блок в glibc начинается со смещения 0x2a0: в начале кучи лежат служебные структуры tcache.'],
      big: ['mmap', 0x7f3a1bf00010, 'Мегабайт больше порога в 128 КБ, поэтому glibc попросила у ядра отдельное отображение через mmap. free(big) сразу вернёт его ОС через munmap.'],
      printf: ['mmap', 0x7f3a1c2600f0, 'printf — код из libc.so.6, отображённой в область mmap. Страницы библиотеки общие для всех процессов в системе.'],
    };
    const SRC = [
      [['int ', 0], ['counter', 'counter'], [' = 42;', 0]],
      [['int ', 0], ['table', 'table'], ['[1000];', 0]],
      [['const char *', 0], ['greet', 'greet'], [' = ', 0], ['"hello"', 'hello'], [';', 0]],
      [['', 0]],
      [['int ', 0], ['square', 'square'], ['(int ', 0], ['x', 'x'], [') { return x * x; }', 0]],
      [['', 0]],
      [['int main(void) {', 0]],
      [['    static int ', 0], ['calls', 'calls'], [';', 0]],
      [['    int ', 0], ['n', 'n'], [' = 10;', 0]],
      [['    char *', 0], ['buf', 'buf'], [' = ', 0], ['malloc(64)', 'm64'], [';', 0]],
      [['    char *big = ', 0], ['malloc(1 << 20)', 'big'], [';', 0]],
      [['    calls++;', 0]],
      [['    ', 0], ['printf', 'printf'], ['(', 0], ['"%s %d\\n"', 'fmt'], [', greet, n);', 0]],
      [['}', 0]],
    ];
    const tokBtns = [];
    const code = h('div', { class: 'ly-code' }, SRC.map(line => h('div', { class: 'ly-line' }, line.map(([t, id]) => {
      if (!id) return h('span', { html: highlight(t, 'c') || '&nbsp;' });
      const b = h('button', { class: 'ly-tok', 'data-seg': ITEMS[id][0], onclick: () => pickItem(id, b) }, t);
      tokBtns.push(b);
      return b;
    }))));
    const segEls = {};
    const map = h('div', { class: 'ly-map' }, SEGS.map(([id, name, addr]) => {
      const el = h('button', { class: 'ly-seg s-' + id, onclick: () => pickSeg(id) }, h('b', null, name), h('span', null, addr));
      segEls[id] = el;
      return el;
    }));
    const detail = h('div', { class: 'ly-detail log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'ly-grid' }, code, map), detail);

    function mark(seg, tok) {
      Object.entries(segEls).forEach(([id, el]) => el.classList.toggle('sel', id === seg));
      tokBtns.forEach(b => b.classList.toggle('sel', b === tok || (!tok && b.dataset.seg === seg)));
    }
    function pickItem(id, btn) {
      const [seg, addr, text] = ITEMS[id];
      const s = SEGS.find(x => x[0] === seg);
      mark(seg, btn);
      detail.innerHTML = `<b><code>${btn.textContent}</code></b> → <b>${s[1]}</b> · <code>${hex(addr)}</code><div>${text}</div>`;
    }
    function pickSeg(id) {
      const s = SEGS.find(x => x[0] === id);
      mark(id, null);
      detail.innerHTML = `<b>${s[1]}</b> · права <code>${s[3]}</code><div>${s[4]}</div>`;
    }
    pickItem('n', tokBtns.find(b => b.textContent === 'n'));
    return {};
  });

  // ---------------------------------------------------------------- call stack step-through
  Deck.demo('callstack', root => {
    const SRC = `int sq(int x) { return x * x; }
int sum_sq(int a, int b) {
    int s = sq(a);
    s += sq(b);
    return s;
}
int fact(int n) {
    if (n <= 1) return 1;
    return n * fact(n - 1);
}
int main(void) {
    int r = sum_sq(3, 4);
    int f = fact(3);
    return r + f;
}`;
    const SIZE = { main: 32, sum_sq: 32, sq: 16, fact: 32 };
    const steps = [];
    const fr = [];
    const snap = (line, msg, reg = '') => steps.push({ line, msg, reg, frames: fr.map(f => ({ ...f, vars: f.vars.map(v => [...v]) })) });
    const top = () => fr[fr.length - 1];
    const setv = (f, k, v) => { f.vars.find(x => x[0] === k)[1] = v; };

    fr.push({ fn: 'main', ret: '__libc_start_call_main+122', vars: [['r', '?'], ['f', '?']] });
    snap(11, 'Работает <code>main</code>. Его кадр — локальные <code>r</code> и <code>f</code>, адрес возврата в libc и сохранённый <code>rbp</code>.');
    fr.push({ fn: 'sum_sq', ret: 'main+19', vars: [['a', 3], ['b', 4], ['s', '?']] });
    snap(2, '<code>call sum_sq</code>: 3 и 4 переданы в регистрах <code>edi</code> и <code>esi</code>, адрес возврата <code>main+19</code> лёг на стек. Ниже вырос новый кадр, <code>rsp</code> уменьшился.', 'edi = 3, esi = 4');
    fr.push({ fn: 'sq', ret: 'sum_sq+24', vars: [['x', 3]] });
    snap(0, 'Вызов <code>sq(3)</code>: ещё один кадр. <code>x</code> — копия значения <code>a</code>, а не ссылка на неё.', 'edi = 3');
    fr.pop(); setv(top(), 's', 9);
    snap(3, '<code>sq</code> вернул 9 в регистре <code>eax</code>. <code>ret</code> снял адрес возврата, кадр исчез: <code>rsp</code> снова выше. Байты кадра остались в памяти, но уже ничьи.', 'eax = 9');
    fr.push({ fn: 'sq', ret: 'sum_sq+36', vars: [['x', 4]] });
    snap(0, 'Второй вызов <code>sq</code> занимает те же адреса, что и первый: стек переиспользуется постоянно, поэтому вершина почти всегда в кэше L1.', 'edi = 4');
    fr.pop(); setv(top(), 's', 25);
    snap(4, '<code>sq</code> вернул 16, <code>s</code> = 25.', 'eax = 16');
    fr.pop(); setv(top(), 'r', 25);
    snap(12, '<code>sum_sq</code> вернул 25 и снял свой кадр. Всё «освобождение памяти» — это <code>leave</code> и <code>ret</code>.', 'eax = 25');
    fr.push({ fn: 'fact', ret: 'main+33', vars: [['n', 3]] });
    snap(8, '<code>fact(3)</code>. Рекурсия — это просто очередной кадр той же функции.', 'edi = 3');
    fr.push({ fn: 'fact', ret: 'fact+31', vars: [['n', 2]] });
    snap(8, '<code>fact(2)</code>: у каждого кадра своя копия <code>n</code>. Каждый уровень рекурсии стоит 32 байта стека.', 'edi = 2');
    fr.push({ fn: 'fact', ret: 'fact+31', vars: [['n', 1]] });
    snap(7, '<code>fact(1)</code> — база рекурсии. Без неё кадры добавлялись бы, пока стек не кончится.', 'edi = 1');
    fr.pop();
    snap(8, '<code>fact(1)</code> вернул 1. Управление вернулось по адресу <code>fact+31</code> — в середину <code>fact(2)</code>, которая умножает 2 × 1.', 'eax = 1');
    fr.pop();
    snap(8, '<code>fact(2)</code> вернул 2, <code>fact(3)</code> считает 3 × 2.', 'eax = 2');
    fr.pop(); setv(top(), 'f', 6);
    snap(13, 'Рекурсия свернулась, остался только кадр <code>main</code>: <code>r</code> = 25, <code>f</code> = 6.', 'eax = 6');

    const lines = codeLines(SRC, 'c');
    const code = h('pre', { class: 'cs-code' });
    const stack = h('div', { class: 'cs-stack' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    let k = 0;
    const back = h('button', { class: 'btn', onclick: () => go(k - 1) }, '← Назад');
    const fwd = h('button', { class: 'btn primary', onclick: () => go(k + 1) }, 'Шаг →');
    root.append(
      h('div', { class: 'controls' }, fwd, back, h('button', { class: 'btn', onclick: () => go(0) }, 'Сброс')),
      h('div', { class: 'cs-grid' }, code, stack),
      logEl,
    );
    const BASE = 0x7ffc3a911e80;
    function go(i) {
      k = Math.max(0, Math.min(steps.length - 1, i));
      const st = steps[k];
      code.innerHTML = lines.map((l, j) => `<span class="cl${j === st.line ? ' cur' : ''}">${l || ' '}</span>`).join('');
      let addr = BASE;
      stack.innerHTML = '<div class="cs-hi">старшие адреса ↑</div>' + st.frames.map((f, j) => {
        const hi = addr;
        addr -= 16 + SIZE[f.fn];
        const active = j === st.frames.length - 1;
        return `<div class="cs-frame${active ? ' act' : ''}"><div class="cs-fh"><b>${f.fn}</b><span>…${(hi - 1).toString(16).slice(-4)}–…${addr.toString(16).slice(-4)} · ${16 + SIZE[f.fn]} Б</span></div>` +
          `<div class="cs-cells"><span class="ret">возврат → ${f.ret}</span><span class="rbp">rbp</span>` +
          f.vars.map(([n, v]) => `<span class="var">${n} = ${v}</span>`).join('') + '</div></div>';
      }).join('') + `<div class="cs-rsp">rsp = ${hex(addr)} ↓ свободно</div>` +
        (st.reg ? `<div class="cs-reg">${st.reg}</div>` : '');
      logEl.innerHTML = `<div><span class="label">${k + 1}/${steps.length}</span> ${st.msg}</div>`;
      back.disabled = k === 0;
      fwd.disabled = k === steps.length - 1;
    }
    go(0);
    return {};
  });

  // ---------------------------------------------------------------- calling convention, instruction by instruction
  Deck.demo('prologue', root => {
    const RET = 'main+18';
    const P = [
      ['main:', null],
      ['  mov  edi, 3', s => { s.rdi = 3; }, 'Первый аргумент — в <code>rdi</code> (запись в <code>edi</code> обнуляет старшую половину). Стек не трогаем.'],
      ['  mov  esi, 4', s => { s.rsi = 4; }, 'Второй аргумент — в <code>rsi</code>. Аргументы 7, 8… пошли бы в стек.'],
      ['  call sum_sq', s => { push(s, RET, 'адрес возврата'); }, '<code>call</code> = положить адрес следующей инструкции на стек и прыгнуть. <code>rsp</code> уменьшился на 8.'],
      ['  mov  [rbp-8], rax', s => { s.mem[s.rbp - 8] = ['r = ' + s.rax, 'var']; }, 'Вернулись в <code>main</code>: результат забираем из <code>rax</code> в локальную <code>r</code>. Стек ровно такой же, как до вызова.'],
      ['sum_sq:', null],
      ['  push rbp', s => { push(s, '…' + s.rbp.toString(16).slice(-4), 'rbp вызывающего'); }, 'Пролог: сохраняем указатель кадра <code>main</code>, чтобы восстановить при выходе.'],
      ['  mov  rbp, rsp', s => { s.rbp = s.rsp; }, '<code>rbp</code> указывает на начало нового кадра. Локальные адресуются от него: <code>[rbp-8]</code>, <code>[rbp-16]</code>.'],
      ['  sub  rsp, 16', s => { s.rsp -= 16; s.mem[s.rsp + 8] = ['s = ?', 'var']; s.mem[s.rsp] = ['выравнивание', 'pad']; }, 'Место под все локальные — одна инструкция. Было бы их 10 или 100 — инструкция та же. Значения там — мусор от прошлых вызовов.'],
      ['  mov  rax, rdi', s => { s.rax = s.rdi; }, 'Аргумент <code>a</code> так и живёт в регистре — в память его класть не нужно.'],
      ['  imul rax, rdi', s => { s.rax *= s.rdi; }, '<code>a * a</code> = 9.'],
      ['  imul rsi, rsi', s => { s.rsi *= s.rsi; }, '<code>b * b</code> = 16. <code>rsi</code> можно портить: по соглашению это регистр вызывающего, он не ждёт, что значение сохранится.'],
      ['  add  rax, rsi', s => { s.rax += s.rsi; }, '9 + 16 = 25.'],
      ['  mov  [rbp-8], rax', s => { s.mem[s.rbp - 8] = ['s = ' + s.rax, 'var']; }, 'Записываем <code>s</code> в кадр (без оптимизаций; с <code>-O2</code> её вообще не было бы в памяти).'],
      ['  mov  rax, [rbp-8]', s => { s.rax = 25; }, 'Возвращаемое значение кладётся в <code>rax</code>.'],
      ['  leave', s => { s.rsp = s.rbp; s.rbp = 0x7ffc3a911e80; s.rsp += 8; }, 'Эпилог: <code>leave</code> = <code>mov rsp, rbp</code> + <code>pop rbp</code>. Кадр «освобождён» — ничего не стёрто, просто сдвинут указатель.'],
      ['  ret', s => { s.rsp += 8; s.rip = RET; }, '<code>ret</code> снимает адрес возврата со стека и прыгает туда — в <code>main</code>.'],
    ];
    const ORDER = [1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 4];
    function push(s, v, kind) { s.rsp -= 8; s.mem[s.rsp] = [v, kind === 'адрес возврата' ? 'ret' : 'rbp']; }
    function init() {
      return {
        rsp: 0x7ffc3a911e60, rbp: 0x7ffc3a911e80, rdi: '?', rsi: '?', rax: '?',
        mem: { [0x7ffc3a911e80]: ['rbp из libc', 'old'], [0x7ffc3a911e78]: ['r = ?', 'var'], [0x7ffc3a911e70]: ['f = ?', 'var'], [0x7ffc3a911e68]: ['…', 'old'], [0x7ffc3a911e60]: ['…', 'old'] },
      };
    }
    const asm = h('pre', { class: 'pr-asm' });
    const regs = h('div', { class: 'pr-regs' });
    const mem = h('div', { class: 'pr-mem' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    let k = 0;
    const back = h('button', { class: 'btn', onclick: () => go(k - 1) }, '← Назад');
    const fwd = h('button', { class: 'btn primary', onclick: () => go(k + 1) }, 'Шаг →');
    root.append(
      h('div', { class: 'controls' }, fwd, back, h('button', { class: 'btn', onclick: () => go(0) }, 'Сброс')),
      h('div', { class: 'pr-src', html: highlight('long sum_sq(long a, long b) { long s = a*a + b*b; return s; }\n// в main: r = sum_sq(3, 4);', 'c') }),
      h('div', { class: 'pr-grid' }, asm, h('div', { class: 'stack pr-right' }, regs, mem)),
      logEl,
    );
    function go(i) {
      k = Math.max(0, Math.min(ORDER.length, i));
      const s = init();
      let prev = null;
      for (let j = 0; j < k; j++) {
        prev = { rsp: s.rsp, rbp: s.rbp, rdi: s.rdi, rsi: s.rsi, rax: s.rax };
        P[ORDER[j]][1](s);
      }
      const cur = k ? ORDER[k - 1] : -1;
      const next = k < ORDER.length ? ORDER[k] : -1;
      asm.innerHTML = P.map(([l], j) => `<span class="cl${j === cur ? ' cur' : ''}${j === next ? ' nxt' : ''}${P[j][1] ? '' : ' lbl'}">${l}</span>`).join('');
      const R = ['rsp', 'rbp', 'rdi', 'rsi', 'rax'];
      regs.innerHTML = R.map(r => {
        const v = s[r];
        const shown = typeof v === 'number' && v > 0xffff ? '…' + v.toString(16).slice(-4) : v;
        const chg = prev && prev[r] !== v;
        return `<span class="pr-reg${chg ? ' chg' : ''}"><i>${r}</i><b>${shown}</b></span>`;
      }).join('');
      let rows = '';
      for (let a = 0x7ffc3a911e80; a >= 0x7ffc3a911e40; a -= 8) {
        const [v, kind] = a >= s.rsp ? (s.mem[a] || ['', 'free']) : ['', 'free'];
        const dead = a < s.rsp && s.mem[a];
        const tags = (a === s.rsp ? '<em class="t-rsp">rsp</em>' : '') + (a === s.rbp ? '<em class="t-rbp">rbp</em>' : '');
        rows += `<div class="pr-cell ${kind}${dead ? ' dead' : ''}"><code>…${a.toString(16).slice(-4)}</code><span>${dead ? s.mem[a][0] : v}</span>${tags}</div>`;
      }
      mem.innerHTML = rows;
      logEl.innerHTML = k ? `<div><code>${P[cur][0].trim()}</code> — ${P[cur][2]}</div>` : '<div>Перед вызовом. <code>rsp</code> — вершина стека, <code>rbp</code> — начало кадра <code>main</code>. Нажмите «Шаг».</div>';
      back.disabled = k === 0;
      fwd.disabled = k === ORDER.length;
    }
    go(0);
    return {};
  });

  // ---------------------------------------------------------------- stack overflow by runtime
  Deck.demo('overflow', root => {
    const RT = [
      { id: 'c', name: 'C', limit: 8 * MB, frame: 48, err: 'Segmentation fault (core dumped)', how: 'Стек главного потока — <code>ulimit -s</code>, 8 МБ. Ниже — защитная страница, обращение к ней убивает процесс сигналом SIGSEGV. Поймать нельзя.' },
      { id: 'java', name: 'Java', limit: 1 * MB, frame: 96, err: 'Exception in thread "main" java.lang.StackOverflowError', how: '<code>-Xss</code> = 1 МБ на 64-битном Linux. Ошибку можно поймать, но после неё состояние программы ненадёжно — лучше дать потоку упасть.' },
      { id: 'node', name: 'Node.js', limit: 984 * KB, frame: 88, err: 'RangeError: Maximum call stack size exceeded', how: 'V8 ограничивает стек примерно 984 КБ (<code>--stack-size</code>). Ловится <code>try/catch</code>.' },
      { id: 'py', name: 'Python', frames: 1000, err: 'RecursionError: maximum recursion depth exceeded', how: 'Лимит — число кадров, <code>sys.getrecursionlimit()</code> = 1000, размер кадра не важен. Поднять можно <code>sys.setrecursionlimit</code>, но глубокую рекурсию в Python лучше переписать циклом.' },
      { id: 'go', name: 'Go', limit: 1e9, label: '1 ГБ', frame: 64, err: 'runtime: goroutine stack exceeds 1000000000-byte limit\nfatal error: stack overflow', how: 'Стек горутины начинается с 2 КБ и удваивается копированием. Предел — 1 ГБ (<code>debug.SetMaxStack</code>). Переполнение — фатальная ошибка: <code>recover</code> не поможет, падает весь процесс.' },
    ];
    const FRAMES = [16, 32, 48, 64, 88, 96, 128, 256, 512, 1024, 4096];
    let rt = RT[0];
    const tabs = h('div', { class: 'controls' }, RT.map(r => h('button', { class: 'btn small', 'data-id': r.id, onclick: () => { rt = r; frameIn.value = FRAMES.indexOf(r.frame); update(); } }, r.name)));
    const depthIn = h('input', { type: 'range', min: 100, max: 700, value: 300, 'aria-label': 'Глубина рекурсии' });
    const depthOut = h('output');
    const frameIn = h('input', { type: 'range', min: 0, max: FRAMES.length - 1, value: 2, 'aria-label': 'Размер кадра' });
    const frameOut = h('output');
    const big = h('div', { class: 'ov-big' });
    const fill = h('div', { class: 'fill' });
    const err = h('pre', { class: 'ov-err' });
    const logEl = h('p', { class: 'log' });
    depthIn.addEventListener('input', update);
    frameIn.addEventListener('input', update);
    root.append(tabs,
      h('label', { class: 'slider inline' }, h('span', { class: 'label ov-l' }, 'глубина'), depthIn, depthOut),
      h('label', { class: 'slider inline' }, h('span', { class: 'label ov-l' }, 'кадр, байт'), frameIn, frameOut),
      big, h('div', { class: 'track ov-track' }, fill), err, logEl);

    function update() {
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.id === rt.id));
      const depth = Math.round(10 ** (depthIn.value / 100));
      const frame = FRAMES[+frameIn.value];
      depthOut.textContent = fmt(depth);
      frameOut.textContent = rt.frames ? '—' : frame;
      frameIn.disabled = !!rt.frames;
      let used, limit, over, extra = '';
      if (rt.frames) {
        used = depth; limit = rt.frames; over = depth > limit;
        big.innerHTML = `<b>${fmt(Math.min(depth, limit))}</b> из ${fmt(limit)} кадров`;
      } else {
        used = depth * frame; limit = rt.limit; over = used > limit;
        const maxDepth = Math.floor(limit / frame);
        big.innerHTML = `<b>${bytes(Math.min(used, limit))}</b> из ${rt.label || bytes(limit)} · хватит на ${fmt(maxDepth)} ${plural(maxDepth, ['вызов', 'вызова', 'вызовов'])}`;
        if (rt.id === 'go' && !over) {
          let st = 2 * KB, grows = 0;
          while (st < used) { st *= 2; grows++; }
          extra = ` Стек горутины сейчас ${bytes(st)}: ${grows ? `вырос ${grows} ${plural(grows, ['раз', 'раза', 'раз'])}, каждый раз с копированием` : 'начальный размер'}.`;
        }
      }
      fill.style.width = Math.min(100, (used / limit) * 100) + '%';
      fill.classList.toggle('bad', over);
      err.hidden = !over;
      err.textContent = rt.err;
      logEl.innerHTML = rt.how + extra;
      logEl.className = over ? 'log bad' : 'log';
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- thread stacks vs goroutine stacks
  Deck.demo('threads', root => {
    const COUNTS = [10, 100, 1000, 5000, 10000, 30000, 50000, 100000, 1000000];
    const USED = [4, 8, 16, 32, 64, 128, 256];
    const nIn = h('input', { type: 'range', min: 0, max: COUNTS.length - 1, value: 2, 'aria-label': 'Число потоков или горутин' });
    const uIn = h('input', { type: 'range', min: 0, max: USED.length - 1, value: 1, 'aria-label': 'Реально используемый стек' });
    const nOut = h('output'), uOut = h('output');
    const stats = h('div', { class: 'stats' });
    const bars = h('div', { class: 'th-bars' });
    const logEl = h('p', { class: 'log' });
    nIn.addEventListener('input', update);
    uIn.addEventListener('input', update);
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label th-l' }, 'потоков / горутин'), nIn, nOut),
      h('label', { class: 'slider inline' }, h('span', { class: 'label th-l' }, 'глубина стека'), uIn, uOut),
      stats, bars, logEl);
    function update() {
      const n = COUNTS[+nIn.value], used = USED[+uIn.value] * KB;
      nOut.textContent = fmt(n);
      uOut.textContent = bytes(used);
      const virt = n * 8 * MB;
      const touched = Math.ceil(used / 4096) * 4096;
      const thrRss = n * touched, kern = n * 16 * KB;
      let gs = 2 * KB;
      while (gs < used) gs *= 2;
      const goRss = n * gs;
      stats.innerHTML =
        `<div class="stat"><b>${bytes(virt)}</b><span>потоки: зарезервировано адресов</span></div>` +
        `<div class="stat"><b>${bytes(thrRss + kern)}</b><span>потоки: физически (+16 КБ стека в ядре)</span></div>` +
        `<div class="stat"><b>${bytes(goRss)}</b><span>горутины: стеки по ${bytes(gs)}</span></div>`;
      const mx = Math.max(thrRss + kern, goRss);
      bars.innerHTML = `<div><span class="label">потоки</span><i class="t" style="width:${((thrRss + kern) / mx) * 100}%"></i></div>` +
        `<div><span class="label">горутины</span><i class="g" style="width:${(goRss / mx) * 100}%"></i></div>`;
      if (n > 30000) {
        logEl.innerHTML = `${fmt(n)} потоков ОС не создать с настройками по умолчанию: каждый стек — два отображения (стек и защитная страница), а <code>vm.max_map_count</code> = 65 530. Дальше <code>pthread_create</code> вернёт EAGAIN, в Java — <code>OutOfMemoryError: unable to create native thread</code>. Плюс лимиты <code>ulimit -u</code> и <code>kernel.threads-max</code>. Горутинам это не грозит.`;
        logEl.className = 'log bad';
      } else {
        logEl.innerHTML = `Физически занято только то, чего стек коснулся. Но у каждого потока ещё и стек в ядре, и переключение через планировщик ОС — микросекунды против сотен наносекунд у горутин.`;
        logEl.className = 'log';
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- dangling pointer to a stack slot
  Deck.demo('dangling', root => {
    const SRC = {
      c: `int *make(void) {
    int x = 42;
    return &x;
}
void other(void) {
    int y = 7777;
}
int main(void) {
    int *p = make();
    printf("%d\\n", *p);
    other();
    printf("%d\\n", *p);
}`,
      go: `func make42() *int {
    x := 42
    return &x // moved to heap: x
}
func other() {
    y := 7777
    use(y)
}
func main() {
    p := make42()
    fmt.Println(*p)
    other()
    fmt.Println(*p)
}`,
    };
    const STEPS = {
      c: [
        { line: 1, slot: ['make', 'x', 42, true], p: null, out: [], msg: '<code>main</code> вызвала <code>make</code>. В её кадре по адресу <code>…1e3c</code> лежит <code>x = 42</code>.' },
        { line: 8, slot: ['свободно', '', 42, false], p: 'slot', out: [], msg: '<code>make</code> вернулась, её кадр «освобождён»: <code>rsp</code> поднялся выше. Но 42 всё ещё лежит по адресу <code>…1e3c</code>, и <code>p</code> указывает туда.', cls: 'warn' },
        { line: 9, slot: ['свободно', '', 42, false], p: 'slot', out: ['42'], msg: 'Чтение <code>*p</code> вернуло 42. Программа «работает» — это неопределённое поведение, которому пока везёт.', cls: 'warn' },
        { line: 5, slot: ['other', 'y', 7777, true], p: 'slot', out: ['42'], msg: '<code>other</code> получила кадр на тех же адресах. Её <code>y</code> легла ровно туда, куда указывает <code>p</code>.', cls: 'warn' },
        { line: 11, slot: ['свободно', '', 7777, false], p: 'slot', out: ['42', '7777'], msg: 'Значение «само» изменилось на 7777. В настоящей программе такая ошибка всплывает далеко от места, где её сделали. Найти её помогает <code>-fsanitize=address</code>.', cls: 'bad' },
      ],
      go: [
        { line: 1, slot: null, heap: 42, p: null, out: [], msg: 'Компилятор увидел, что адрес <code>x</code> возвращается из функции, и разместил <code>x</code> в куче: <code>moved to heap: x</code>.' },
        { line: 9, slot: null, heap: 42, p: 'heap', out: [], msg: '<code>make42</code> вернулась. Её кадр освобождён, но <code>x</code> в куче — <code>p</code> указывает на живой объект.' },
        { line: 10, slot: null, heap: 42, p: 'heap', out: ['42'], msg: 'Печатает 42.' },
        { line: 5, slot: ['other', 'y', 7777, true], heap: 42, p: 'heap', out: ['42'], msg: '<code>other</code> занимает тот же участок стека, но <code>x</code> там больше нет.' },
        { line: 12, slot: ['свободно', '', 7777, false], heap: 42, p: 'heap', out: ['42', '42'], msg: 'Снова 42. Объект проживёт, пока на него есть ссылка, а освободит его сборщик мусора.', cls: 'ok' },
      ],
    };
    let lang = 'c', k = 0;
    const tabs = h('div', { class: 'controls' },
      h('button', { class: 'btn small', 'data-l': 'c', onclick: () => { lang = 'c'; go(0); } }, 'C'),
      h('button', { class: 'btn small', 'data-l': 'go', onclick: () => { lang = 'go'; go(0); } }, 'Go'));
    const code = h('pre', { class: 'cs-code dg-code' });
    const mem = h('div', { class: 'dg-mem' });
    const out = h('pre', { class: 'dg-out' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const back = h('button', { class: 'btn', onclick: () => go(k - 1) }, '← Назад');
    const fwd = h('button', { class: 'btn primary', onclick: () => go(k + 1) }, 'Шаг →');
    root.append(h('div', { class: 'controls' }, fwd, back, h('span', { class: 'dg-sp' }), tabs), h('div', { class: 'cs-grid' }, code, h('div', { class: 'stack dg-right' }, mem, out)), logEl);
    function go(i) {
      const steps = STEPS[lang];
      k = Math.max(0, Math.min(steps.length - 1, i));
      const st = steps[k];
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.l === lang));
      code.innerHTML = codeLines(SRC[lang], lang).map((l, j) => `<span class="cl${j === st.line ? ' cur' : ''}">${l || ' '}</span>`).join('');
      const pv = st.p === 'slot' ? '…1e3c' : st.p === 'heap' ? '0xc000012080' : '—';
      let html = `<div class="dg-h">стек</div><div class="dg-row frame"><span>кадр main</span><b class="${st.p ? 'ptr' : ''}">p = ${pv}</b></div>`;
      if (st.slot) {
        const [owner, name, v, live] = st.slot;
        html += `<div class="dg-row ${live ? 'frame' : 'stale'} ${st.p === 'slot' ? 'target' : ''}"><span>${live ? 'кадр ' + owner : 'ниже rsp — ничьё'}</span><b>…1e3c: ${name ? name + ' = ' : ''}${v}</b></div>`;
      } else {
        html += '<div class="dg-row stale"><span>ниже rsp</span><b>…1e3c: —</b></div>';
      }
      if (lang === 'go') html += `<div class="dg-h">куча</div><div class="dg-row heap ${st.p === 'heap' ? 'target' : ''}"><span>объект int</span><b>0xc000012080: x = ${st.heap}</b></div>`;
      mem.innerHTML = html;
      out.textContent = '$ ./prog\n' + st.out.join('\n');
      logEl.innerHTML = `<div><span class="label">${k + 1}/${steps.length}</span> ${st.msg}</div>`;
      logEl.className = 'log ' + (st.cls || '');
      back.disabled = k === 0;
      fwd.disabled = k === steps.length - 1;
    }
    go(0);
    return {};
  });

  // ---------------------------------------------------------------- stack buffer overflow
  Deck.demo('smash', root => {
    const CANARY = [0x00, 0x7c, 0x3f, 0xa1, 0x9e, 0x52, 0xd8, 0x1b];
    const RBP = [0xf0, 0xe2, 0x91, 0x3a, 0xfc, 0x7f, 0x00, 0x00];
    const RETB = [0xc7, 0x11, 0xa0, 0xc3, 0xd4, 0x55, 0x00, 0x00];
    const NAME = [0x13, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x60, 0x1e, 0x91, 0x3a, 0xfc, 0x7f, 0x00, 0x00];
    const lenIn = h('input', { type: 'range', min: 0, max: 40, value: 10, 'aria-label': 'Длина ввода' });
    const lenOut = h('output');
    const canIn = h('input', { type: 'checkbox', checked: true });
    const input = h('div', { class: 'sm-input' });
    const grid = h('div', { class: 'sm-grid' });
    const logEl = h('p', { class: 'log' });
    lenIn.addEventListener('input', update);
    canIn.addEventListener('change', update);
    root.append(
      h('pre', { class: 'sm-src', html: highlight('void greet(void) {\n    char name[16];\n    gets(name);   // длина не проверяется\n    printf("Привет, %s\\n", name);\n}', 'c') }),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'длина ввода'), lenIn, lenOut),
      h('label', { class: 'toggle' }, canIn, h('span', null, 'канарейка (-fstack-protector)')),
      input, grid, logEl);
    const toHex = arr => '0x' + [...arr].reverse().map(b => b.toString(16).padStart(2, '0')).join('').replace(/^0+(?=.)/, '');
    function update() {
      const len = +lenIn.value, can = canIn.checked;
      lenOut.textContent = len;
      input.innerHTML = `ввод: <code>${'A'.repeat(len) || '(пусто)'}</code>`;
      const regions = [['name[0..7]', NAME.slice(0, 8), 'buf'], ['name[8..15]', NAME.slice(8), 'buf']];
      if (can) regions.push(['канарейка', CANARY, 'can']);
      regions.push(['сохранённый rbp', RBP, 'rbp'], ['адрес возврата', RETB, 'ret']);
      const mem = regions.flatMap(r => r[1]);
      const orig = [...mem];
      for (let i = 0; i <= len && i < mem.length; i++) mem[i] = i < len ? 0x41 : 0x00;
      const changed = (from, n) => mem.slice(from, from + n).some((b, i) => b !== orig[from + i]);
      let off = 0;
      const info = regions.map(([name, arr, cls]) => {
        const r = { name, cls, from: off, bytes: mem.slice(off, off + 8), changed: changed(off, 8) };
        off += 8;
        return r;
      });
      grid.innerHTML = '<div class="sm-cap">старшие адреса ↑ · запись идёт снизу вверх</div>' + info.slice().reverse().map(r =>
        `<div class="sm-row ${r.cls}${r.changed && r.cls !== 'buf' ? ' hit' : ''}"><span class="sm-name">${r.name}</span><span class="sm-bytes">${r.bytes.map((b, i) => {
          const pos = r.from + i;
          const w = pos < len ? ' w' : pos === len ? ' z' : '';
          return `<i class="${w}">${b.toString(16).padStart(2, '0')}</i>`;
        }).join('')}</span></div>`).join('');
      const R = Object.fromEntries(info.map(r => [r.cls === 'buf' ? r.name : r.cls, r]));
      let msg, cls = '';
      if (len <= 15) {
        msg = `Строка поместилась: ${len} ${plural(len, ['байт', 'байта', 'байт'])} и завершающий ноль. Функция вернётся как обычно.`;
        cls = 'ok';
      } else if (can && R.can.changed) {
        msg = '<code>*** stack smashing detected ***: terminated</code> — Aborted. Перед <code>ret</code> функция сравнила канарейку с эталоном, увидела порчу и остановила процесс до перехода по адресу возврата. Ошибка из уязвимости превратилась в аварийное завершение.';
        cls = 'bad';
      } else if (can) {
        msg = 'Завершающий ноль попал на младший байт канарейки — а он и так 0x00: glibc делает его нулевым, чтобы строковые функции на нём останавливались. Порча не обнаружена, но и ничего не испорчено.';
        cls = 'warn';
      } else if (R.ret.changed) {
        msg = `<code>ret</code> возьмёт со стека ${toHex(R.ret.bytes)} и прыгнет туда — Segmentation fault. Порча адреса возврата — источник уязвимостей, поэтому дистрибутивы собирают программы с канарейкой, а NX, ASLR и теневой стек добавляют ещё слои защиты.`;
        cls = 'bad';
      } else {
        msg = 'Испорчен сохранённый <code>rbp</code> вызывающей функции. <code>greet</code> вернётся нормально, но кадр <code>main</code> теперь указывает в мусор — программа упадёт позже и в другом месте. Самый неприятный вид бага.';
        cls = 'warn';
      }
      logEl.innerHTML = msg;
      logEl.className = 'log ' + cls;
    }
    update();
    return {};
  });
})();

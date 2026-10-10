// Demos for slides 2–8: user/kernel mode, strace, syscall cost, process anatomy, fork/exec, docker stop.
(() => {
  'use strict';
  const { h, highlight, plural, rafLoop } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const fmt = n => Math.round(n).toLocaleString('ru-RU');

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  // Legend: legend([['sys', 'вход в ядро'], …]) — swatch class and label.
  const legend = items => h('div', { class: 'bl-legend' }, items.map(([c, t]) => h('span', null, h('span', { class: 'sw ' + c }), t)));
  window.PT = { logger, dec, fmt, legend };

  // Human-readable duration from nanoseconds.
  function dur(ns) {
    if (ns >= 1e9) return dec(ns / 1e9, ns >= 1e10 ? 0 : 1) + ' с';
    if (ns >= 1e6) return dec(ns / 1e6, ns >= 1e7 ? 0 : 1) + ' мс';
    if (ns >= 1e3) return dec(ns / 1e3, ns >= 1e4 ? 0 : 1) + ' мкс';
    return Math.round(ns) + ' нс';
  }
  PT.dur = dur;

  // ---------------------------------------------------------------- user / kernel mode
  Deck.demo('modes', root => {
    const ACTIONS = [
      { b: 'a + b', steps: [['u', 'сложение в регистрах']], cls: 'ok',
        log: 'Обычные инструкции выполняются прямо на процессоре, ядро о них даже не знает. Около наносекунды.' },
      { b: 'time.time()', steps: [['u', 'clock_gettime в vDSO'], ['u', 'чтение общей страницы с часами']], cls: 'ok',
        log: 'Чтение часов не заходит в ядро: ядро отображает в каждый процесс страницу vDSO с кодом и данными часов. Поэтому <code>time.time()</code> и <code>time.Now()</code> дешёвые, а strace их не видит.' },
      { b: 'open("data.txt")', steps: [['u', 'openat(…): номер в rax'], ['k', 'syscall → проверка прав, поиск пути'], ['h', 'чтение каталога с диска, если не в кэше'], ['k', 'запись в таблицу файлов процесса'], ['u', 'вернулся fd = 3']],
        log: 'Системный вызов. Инструкция <code>syscall</code> переводит процессор в кольцо 0 на точку входа ядра. Ядро проверяет права, находит файл и возвращает номер дескриптора. К диску процесс сам не прикасается.' },
      { b: 'первая запись в новую память', steps: [['u', 'buf[0] = 1'], ['k', 'ошибка страницы: её ещё нет'], ['h', 'взять свободную физическую страницу'], ['k', 'обнулить, вписать в таблицу страниц'], ['u', 'инструкция повторяется']],
        log: '<code>malloc</code> только зарезервировал адреса. Первое обращение вызывает исключение — ошибку страницы. Ядро выделяет память и незаметно для программы повторяет инструкцию. Подробнее — в презентации <a href="/virtual-memory/">про виртуальную память</a>.' },
      { b: 'while True: pass', steps: [['u', 'бесконечный цикл'], ['h', 'прерывание таймера'], ['k', 'планировщик: квант истёк'], ['k', 'переключение на другую задачу'], ['u', '…позже цикл продолжается']],
        log: 'Захватить процессор навсегда нельзя: аппаратный таймер регулярно прерывает программу, и планировщик решает, кто работает дальше. Это вытесняющая многозадачность.' },
      { b: 'out 0x60 (порт)', steps: [['u', 'привилегированная инструкция'], ['k', 'исключение общей защиты'], ['k', 'послать SIGSEGV'], ['x', 'процесс убит']], cls: 'bad',
        log: 'Ввод-вывод в порты, запрет прерываний, смена таблицы страниц разрешены только в кольце 0. Попытка из кольца 3 — исключение, и ядро убивает процесс.' },
      { b: '*(int*)0 = 1', steps: [['u', 'запись по адресу 0'], ['k', 'ошибка страницы: адрес не отображён'], ['k', 'послать SIGSEGV'], ['x', 'Segmentation fault']], cls: 'bad',
        log: 'Тот же механизм ошибки страницы, но такого адреса у процесса нет. Ядро шлёт SIGSEGV. JVM и Go перехватывают его и превращают в <code>NullPointerException</code> и panic.' },
    ];
    const LANES = [['u', 'процесс · кольцо 3'], ['k', 'ядро · кольцо 0'], ['h', 'железо']];
    const list = h('div', { class: 'md-acts' });
    const grid = h('div', { class: 'md-grid' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const buttons = ACTIONS.map(a => h('button', { class: 'btn small', onclick: () => run(a) }, /[а-я]/.test(a.b) ? a.b : h('code', null, a.b)));
    list.append(...buttons);
    root.append(h('span', { class: 'label' }, 'Действие программы'), list, grid, logEl);
    let timers = [];

    function run(a) {
      timers.forEach(clearTimeout);
      timers = [];
      buttons.forEach((b, i) => b.classList.toggle('sel', ACTIONS[i] === a));
      grid.innerHTML = '';
      grid.append(...LANES.map(([k, t]) => h('div', { class: 'md-head md-' + k }, t)));
      a.steps.forEach(([lane, text], i) => {
        const col = lane === 'x' ? 0 : LANES.findIndex(l => l[0] === lane);
        const row = h('div', { class: 'md-row' });
        for (let c = 0; c < 3; c++) {
          row.append(c === col
            ? h('div', { class: `md-step md-${lane}` }, h('span', { class: 'md-n' }, i + 1), text)
            : h('div', { class: 'md-cell' }));
        }
        grid.append(row);
        timers.push(setTimeout(() => row.classList.add('on'), 60 + i * 320));
      });
      say(a.log, a.cls || '');
    }
    run(ACTIONS[2]);
    return { stop() { timers.forEach(clearTimeout); grid.querySelectorAll('.md-row').forEach(r => r.classList.add('on')); } };
  });

  // ---------------------------------------------------------------- strace
  Deck.demo('strace', root => {
    const PROGS = [
      { b: 'print', code: ['print("hi")'], steps: [
        [-1, 'execve("/usr/bin/python3", ["python3", "hi.py"], 0x7ffe… /* 24 vars */) = 0', 'Запуск. Shell сделал fork, ребёнок — execve. Дальше интерпретатор делает сотни вызовов: подгружает библиотеки через <code>openat</code> и <code>mmap</code>, читает модули стандартной библиотеки.'],
        [-1, '… сотни вызовов запуска: openat, mmap, newfstatat, read …', 'Посчитайте сами: <code>strace -c python3 -c pass</code>. Поэтому запуск интерпретатора на каждый запрос — дорого, а CLI на Python стартуют десятки миллисекунд.'],
        [0, 'write(1, "hi\\n", 3) = 3', 'fd 1 — stdout. Python сбросил буфер на переводе строки, потому что stdout — терминал. В канал или файл (как в Docker без TTY) буфер 8 КБ сбрасывается реже, и логи «запаздывают». Лечится <code>PYTHONUNBUFFERED=1</code> или <code>flush=True</code>.'],
        [-1, 'exit_group(0) = ?', '<code>exit_group</code> останавливает все потоки процесса. Ядро закрывает файлы, освобождает память и оставляет родителю только код возврата.'],
      ] },
      { b: 'open + read', code: ['with open("data.txt") as f:', '    s = f.read()', '# выход из with: f.close()'], steps: [
        [0, 'openat(AT_FDCWD, "data.txt", O_RDONLY|O_CLOEXEC) = 3', 'Ядро нашло файл, проверило права и вернуло дескриптор — номер в таблице открытых файлов процесса. 0, 1 и 2 заняты stdin, stdout и stderr, поэтому 3. <code>O_CLOEXEC</code> закроет его при exec, чтобы не утёк в дочерние программы.'],
        [0, 'newfstatat(3, "", {st_mode=S_IFREG|0644, st_size=12, …}, AT_EMPTY_PATH) = 0', 'Python проверяет, что это обычный файл, а не каталог, и узнаёт размер блока для буфера.'],
        [0, 'ioctl(3, TCGETS, 0x7ffd5e3c1a40) = -1 ENOTTY (Inappropriate ioctl for device)', 'Это <code>isatty()</code>: не терминал ли это? Ошибка — нормальный ответ «нет». В выводе strace много таких безобидных ошибок.'],
        [0, 'lseek(3, 0, SEEK_CUR) = 0', 'Текущая позиция в файле — её запоминает буферизованный объект.'],
        [1, 'newfstatat(3, "", {st_mode=S_IFREG|0644, st_size=12, …}, AT_EMPTY_PATH) = 0', '<code>read()</code> без аргумента сначала узнаёт размер файла, чтобы выделить буфер сразу нужной длины.'],
        [1, 'read(3, "hello world\\n", 13) = 12', 'Данные копируются из кэша страниц ядра в память процесса. Просили 13 байт, получили 12: файл кончился.'],
        [1, 'read(3, "", 1) = 0', 'Ноль байт — это конец файла. Только так программа и узнаёт, что читать больше нечего.'],
        [2, 'close(3) = 0', 'Дескриптор освобождён. Забытый <code>close</code> — утечка: у процесса лимит открытых файлов (<code>ulimit -n</code>, часто 1024), а за ним — «Too many open files».'],
      ] },
      { b: 'sleep', code: ['t0 = time.time()', 'time.sleep(0.1)', 'print(time.time() - t0)'], steps: [
        [0, null, '<code>time.time()</code> в strace не видно: <code>clock_gettime</code> работает через vDSO, без входа в ядро.'],
        [1, 'clock_nanosleep(CLOCK_MONOTONIC, 0, {tv_sec=0, tv_nsec=100000000}, NULL) = 0', 'Поток переходит в состояние S (спит) и уходит из очереди планировщика — процессор свободен для других. Через 100 мс таймер ядра его разбудит.'],
        [2, 'write(1, "0.10011\\n", 8) = 8', 'Чуть больше 100 мс: после пробуждения нужно ещё дождаться свободного ядра. Обычно это десятки микросекунд, под нагрузкой — миллисекунды.'],
      ] },
      { b: 'subprocess', code: ['import subprocess', 'subprocess.run(["ls"])'], steps: [
        [1, 'pipe2([3, 4], O_CLOEXEC) = 0', 'Служебный канал: если exec в ребёнке не удастся, ребёнок напишет туда ошибку.'],
        [1, 'vfork() = 4242', 'Python создаёт ребёнка через <code>vfork</code>: память не копируется, родитель стоит, пока ребёнок не вызовет exec. Для большого процесса это намного быстрее fork.'],
        [1, 'close(4) = 0', 'Родитель закрывает свой конец канала для записи.'],
        [1, 'read(3, "", 50000) = 0', 'Канал закрылся сам: при успешном execve дескриптор с <code>O_CLOEXEC</code> закрывается. Пусто — значит, ls запустился.'],
        [1, 'close(3) = 0', 'Канал больше не нужен.'],
        [1, 'wait4(4242, [{WIFEXITED(s) && WEXITSTATUS(s) == 0}], 0, NULL) = 4242', 'Родитель спит, пока ребёнок не завершится, и забирает его код возврата. Вызовов самого ls здесь нет — чтобы видеть детей, нужен <code>strace -f</code>.'],
      ] },
    ];
    let prog, pos;
    const pbtns = PROGS.map(p => h('button', { class: 'btn small', onclick: () => load(p) }, p.b));
    const codeEl = h('pre', { class: 'code st-code' });
    const outEl = h('div', { class: 'st-out', 'aria-live': 'polite' });
    const logEl = h('div', { class: 'log' });
    const say = logger(logEl, 1);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Программа:'), ...pbtns),
      codeEl,
      h('div', { class: 'st-term' }, h('div', { class: 'st-cmd' }, '$ strace python3 app.py'), outEl),
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: all }, 'Всё сразу'), h('button', { class: 'btn', onclick: () => load(prog) }, 'Сначала')),
      logEl,
    );
    function load(p) {
      prog = p; pos = 0;
      pbtns.forEach((b, i) => b.classList.toggle('sel', PROGS[i] === p));
      say('Нажмите «Шаг»: каждая строка strace — один системный вызов с аргументами и результатом.');
      render();
    }
    function step() {
      if (pos >= prog.steps.length) return;
      pos++;
      say(prog.steps[pos - 1][2]);
      render();
    }
    function all() { while (pos < prog.steps.length) step(); }
    function render() {
      const cur = pos ? prog.steps[pos - 1][0] : -2;
      codeEl.innerHTML = prog.code.map((l, i) => `<span class="st-line${i === cur ? ' cur' : ''}">${highlight(l, 'py') || ' '}</span>`).join('');
      outEl.innerHTML = '';
      prog.steps.slice(0, pos).forEach(([, call], i) => {
        const dim = !call || call.startsWith('…');
        outEl.append(h('div', { class: 'st-l' + (i === pos - 1 ? ' cur' : '') + (dim ? ' dim' : '') }, call || '(нет системного вызова)'));
      });
      if (!pos) outEl.append(h('div', { class: 'st-l dim' }, '…'));
      stepBtn.disabled = pos >= prog.steps.length;
    }
    load(PROGS[1]);
    return {};
  });

  // ---------------------------------------------------------------- syscall cost
  Deck.demo('syscost', root => {
    const SIZES = [1, 16, 128, 1024, 8192, 65536, 1048576];
    const NAMES = ['1 Б', '16 Б', '128 Б', '1 КБ', '8 КБ', '64 КБ', '1 МБ'];
    const TOTAL = 100 * 1048576;
    const PER_CALL = 400; // ns: entry/exit with mitigations + VFS and page cache bookkeeping
    const PER_BYTE = 0.25; // ns: copy into the page cache, ~4 GB/s
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: SIZES.length - 1, value: 1, 'aria-label': 'Размер буфера' });
    const bar = h('div', { class: 'sc-bar' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log' });
    input.addEventListener('input', update);
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Буфер'), input, out),
      stats, bar,
      legend([['sys', 'вход и выход из ядра'], ['cp', 'копирование данных']]),
      logEl,
    );
    function update() {
      const i = +input.value, b = SIZES[i];
      out.textContent = NAMES[i];
      const calls = Math.ceil(TOTAL / b);
      const sys = calls * PER_CALL, cp = TOTAL * PER_BYTE, all = sys + cp;
      stats.innerHTML = `<div class="stat"><b>${fmt(calls)}</b><span>вызовов write</span></div>` +
        `<div class="stat${sys > cp ? ' warn' : ''}"><b>${dur(sys)}</b><span>на переходы в ядро</span></div>` +
        `<div class="stat"><b>${dur(all)}</b><span>всего</span></div>`;
      bar.innerHTML = `<span class="sys" style="width:${(sys / all) * 100}%"></span><span class="cp" style="width:${(cp / all) * 100}%"></span>`;
      if (b <= 16) {
        logEl.innerHTML = `Так пишет программа без буфера: по символу или короткой строке за вызов. ${dur(all)} на 100 МБ — почти всё время уходит на переходы в ядро, а не на данные.`;
        logEl.className = 'log bad';
      } else if (b < 8192) {
        logEl.innerHTML = 'Лучше, но переходы в ядро всё ещё заметны. Так бывает, когда пишут построчно в сокет или файл без буфера.';
        logEl.className = 'log warn';
      } else if (b < 1048576) {
        logEl.innerHTML = 'Типичный буфер. Накладные расходы на системные вызовы — малая доля, время уходит на само копирование.';
        logEl.className = 'log ok';
      } else {
        logEl.innerHTML = 'Дальше увеличивать буфер почти бесполезно: время упирается в копирование, а память на буфер растёт.';
        logEl.className = 'log ok';
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- process anatomy
  Deck.demo('anatomy', root => {
    const P = '2210';
    const PARTS = {
      id: ['PID 2210 · PPID 1430', 'Номер процесса и номер родителя. У каждого потока свой ID (TID), а PID процесса — это ID его первого потока.', `grep -E 'Pid|PPid|Threads' /proc/${P}/status`],
      uid: ['UID 1000 · GID 1000', 'Чьими правами работает процесс: от них зависит, какие файлы он откроет и каким процессам может слать сигналы. Плюс capabilities — отдельные права root, например открыть порт ниже 1024.', `grep -E 'Uid|Gid|Cap' /proc/${P}/status`],
      stack: ['стеки потоков', 'У каждого потока свой стек: локальные переменные и адреса возврата. Главный растёт вниз от верха адресов (до 8 МБ по <code>ulimit -s</code>), стеки остальных потоков выделены через mmap.', `grep stack /proc/${P}/maps`],
      mmap: ['mmap: библиотеки и файлы', 'Разделяемые библиотеки (libc, libpython), отображённые в память файлы, большие выделения памяти. Код библиотек общий для всех процессов, которые их используют.', `cat /proc/${P}/maps`],
      heap: ['куча', 'Память, которую выделяет <code>malloc</code> или аллокатор рантайма. Растёт вверх через brk и mmap. Подробнее — в презентации <a href="/memory-management/">про управление памятью</a>.', `grep -E 'VmRSS|VmData' /proc/${P}/status`],
      data: ['данные', 'Глобальные и статические переменные программы.', `cat /proc/${P}/maps | head`],
      text: ['код', 'Машинный код программы, только для чтения и исполнения. Страницы общие у всех копий процесса — десять запущенных python делят один код интерпретатора.', `cat /proc/${P}/maps | head -3`],
      fd: ['дескрипторы файлов', 'Таблица открытых файлов: номер → файл, сокет, канал. 0, 1, 2 — stdin, stdout, stderr. Таблица наследуется при fork и сохраняется при exec — так ребёнок пишет туда же, куда родитель.', `ls -l /proc/${P}/fd`],
      env: ['аргументы и окружение', 'argv и переменные окружения лежат в начале стека. Ребёнок получает копию, а снаружи изменить окружение работающего процесса нельзя. Владелец процесса может прочитать его environ — включая секреты в переменных.', `tr '\\0' '\\n' < /proc/${P}/environ`],
      cwd: ['текущий каталог и корень', 'Относительно них разрешаются пути. Корень можно сменить через chroot или mount namespace — так у контейнера своя файловая система.', `ls -l /proc/${P}/cwd /proc/${P}/root`],
      sig: ['обработчики сигналов', 'Для каждого сигнала: действие по умолчанию, игнорировать или вызвать обработчик. Плюс маска заблокированных сигналов у каждого потока.', `grep -E 'Sig(Blk|Ign|Cgt)' /proc/${P}/status`],
      thr: ['потоки: 9', 'Каждый поток — отдельная задача ядра со своим TID, регистрами и стеком. Всё остальное на этой схеме у потоков общее.', `ls /proc/${P}/task`],
      lim: ['лимиты', 'Ограничения ресурсов (rlimit): число открытых файлов, размер стека, процессов на пользователя, размер core dump.', `cat /proc/${P}/limits`],
      ns: ['namespaces и cgroup', 'Какой мир процесс видит — PID, сеть, точки монтирования — и в какой группе учёта ресурсов состоит. Из этого и сделаны контейнеры.', `ls -l /proc/${P}/ns; cat /proc/${P}/cgroup`],
    };
    const detail = h('div', { class: 'an-detail', 'aria-live': 'polite' });
    const buttons = {};
    const btn = (k, cls = '') => (buttons[k] = h('button', { class: 'an-b ' + cls, onclick: () => select(k) }, PARTS[k][0]));
    root.append(
      h('div', { class: 'an-proc' },
        h('div', { class: 'an-head' }, h('b', null, 'python app.py'), h('span', null, 'PID 2210')),
        h('div', { class: 'an-body' },
          h('div', { class: 'an-mem' },
            h('span', { class: 'an-cap' }, 'адресное пространство'),
            h('span', { class: 'an-addr' }, '0x7fff…'),
            btn('stack', 'm'), btn('mmap', 'm'), h('div', { class: 'an-gap' }, '↓ свободно ↑'), btn('heap', 'm'), btn('data', 'm'), btn('text', 'm'),
            h('span', { class: 'an-addr' }, '0x0000…')),
          h('div', { class: 'an-side' }, btn('id'), btn('uid'), btn('thr'), btn('fd', 'f'), btn('env'), btn('cwd'), btn('sig'), btn('lim'), btn('ns')),
        ),
      ),
      detail,
    );
    function select(k) {
      Object.entries(buttons).forEach(([kk, b]) => b.classList.toggle('sel', kk === k));
      const [name, text, cmd] = PARTS[k];
      detail.innerHTML = `<b>${name}</b><p>${text}</p><code class="an-cmd">$ ${cmd.replace(/</g, '&lt;')}</code>`;
    }
    select('fd');
    return {};
  });

  // ---------------------------------------------------------------- fork / exec / wait
  Deck.demo('forkexec', root => {
    const TTY = { 0: 'tty', 1: 'tty', 2: 'tty' };
    const SHELL_CODE = [
      'pid = fork();',
      'if (pid == 0) {           // ребёнок',
      '    fd = open("out.txt", O_WRONLY);',
      '    dup2(fd, 1);          // stdout → файл',
      '    close(fd);',
      '    execve("/bin/ls", argv, envp);',
      '}',
      'waitpid(pid, &status, 0); // родитель',
    ];
    const SCEN = [
      { b: 'ls > out.txt', title: 'bash выполняет ls > out.txt', code: SHELL_CODE, steps: [
        [-1, [[1430, 1, 'bash', 'R', TTY]], 'Shell (PID 1430) прочитал команду <code>ls&nbsp;&gt;&nbsp;out.txt</code>. Нажмите «Шаг».'],
        [0, [[1430, 1, 'bash', 'R', TTY], [1431, 1430, 'bash', 'R', TTY]], '<code>fork()</code> вернулся дважды: родителю — PID ребёнка 1431, ребёнку — 0. Ребёнок — копия: та же программа, те же открытые файлы. Память общая, пока кто-то не начнёт писать.'],
        [7, [[1430, 1, 'bash', 'S', TTY], [1431, 1430, 'bash', 'R', TTY]], 'Родитель вызвал <code>waitpid</code> и уснул (S): ждёт ребёнка и процессор не тратит.'],
        [3, [[1430, 1, 'bash', 'S', TTY], [1431, 1430, 'bash', 'R', { 0: 'tty', 1: 'out.txt', 2: 'tty' }]], 'Ребёнок открыл out.txt (fd 3), скопировал его в fd 1 и закрыл 3. Это всё ещё код bash: перенаправление делает shell, а не ls.'],
        [5, [[1430, 1, 'bash', 'S', TTY], [1431, 1430, 'ls', 'R', { 0: 'tty', 1: 'out.txt', 2: 'tty' }]], '<code>execve</code> заменил программу: код, куча и стек bash выброшены, загружен /bin/ls. PID, родитель и открытые файлы остались — поэтому ls пишет в out.txt, ничего о нём не зная.'],
        [-1, [[1430, 1, 'bash', 'S', TTY], [1431, 1430, 'ls', 'Z', null]], 'ls вызвал <code>exit(0)</code>. Память и файлы освобождены, но запись в таблице процессов осталась: это зомби (Z) с кодом возврата. Родителю ушёл SIGCHLD.', 'warn'],
        [7, [[1430, 1, 'bash', 'R', TTY]], '<code>waitpid</code> вернул статус 0, и ядро удалило зомби. В shell это <code>$?</code>. Bash снова ждёт команду.', 'ok'],
      ] },
      { b: 'Родитель не ждёт', title: 'сервер запускает convert и не ждёт', code: [
        'pid = os.fork()',
        'if pid == 0:',
        '    os.execv("/usr/bin/convert", args)',
        '# родитель работает дальше',
        '# и никогда не вызывает os.waitpid()',
      ], steps: [
        [-1, [[2210, 1, 'python app.py', 'R', TTY]], 'Сервер на Python запускает внешнюю программу через <code>os.fork</code> и <code>os.execv</code>.'],
        [0, [[2210, 1, 'python app.py', 'R', TTY], [2211, 2210, 'python app.py', 'R', TTY]], 'fork: копия сервера. Если у сервера 2 ГБ памяти, копируются только таблицы страниц — но и это миллисекунды.'],
        [2, [[2210, 1, 'python app.py', 'R', TTY], [2211, 2210, 'convert', 'R', TTY]], 'exec: в ребёнке теперь convert.'],
        [3, [[2210, 1, 'python app.py', 'R', TTY], [2211, 2210, 'convert', 'Z', null]], 'convert завершился. Родитель не вызвал wait — зомби остаётся. В <code>ps</code> он виден как <code>[convert] &lt;defunct&gt;</code>.', 'warn'],
        [3, [[2210, 1, 'python app.py', 'R', TTY], [2211, 2210, 'convert', 'Z', null], [2214, 2210, 'convert', 'Z', null], [2219, 2210, 'convert', 'Z', null]], 'Каждый запуск оставляет зомби. Память они не занимают, но держат PID: упрётесь в <code>pids.max</code> — и fork начнёт падать с EAGAIN. <code>subprocess.run</code> и <code>Popen.wait()</code> вызывают wait сами.', 'bad'],
        [-1, [], 'Сервер перезапустили. Зомби усыновил PID 1 — systemd или tini — и сразу забрал их статусы. Но если PID 1 в контейнере — ваше приложение без wait, зомби будут копиться.', 'ok'],
      ] },
      { b: 'Родитель умер раньше', title: 'shell запустил фоновую задачу и вышел', code: [
        './worker &      # fork + exec, без wait',
        'exit            # shell завершается',
      ], steps: [
        [-1, [[1430, 1, 'bash', 'R', TTY]], 'Shell запускает долгую задачу в фоне.'],
        [0, [[1430, 1, 'bash', 'R', TTY], [1431, 1430, 'worker', 'S', TTY]], 'fork + exec, как раньше. Shell не ждёт фоновую задачу и сразу принимает следующую команду.'],
        [1, [[1431, 1, 'worker', 'S', TTY]], 'Shell завершился раньше ребёнка. Ребёнок стал сиротой, и ядро переназначило ему родителя — PID 1 (или ближайший subreaper, например <code>systemd --user</code>). Сирота работает дальше.', 'warn'],
        [-1, [[1431, 1, 'worker', 'Z', null]], 'worker завершился и на мгновение стал зомби. Родитель теперь PID 1, ему и пришёл SIGCHLD.'],
        [-1, [], 'Init вызвал wait и забрал статус. Поэтому init в контейнере — обязательно процесс, который умеет это делать: tini, dumb-init или <code>docker run --init</code>.', 'ok'],
      ] },
    ];
    let sc, pos;
    const sbtns = SCEN.map(s => h('button', { class: 'btn small', onclick: () => load(s) }, s.b));
    const codeEl = h('pre', { class: 'code fx-code' });
    const tree = h('div', { class: 'fx-tree', 'aria-live': 'polite' });
    const logEl = h('div', { class: 'log' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { if (pos < sc.steps.length - 1) { pos++; render(); } } }, 'Шаг');
    root.append(h('div', { class: 'controls' }, ...sbtns), codeEl, tree,
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: () => load(sc) }, 'Сначала')), logEl);

    function load(s) { sc = s; pos = 0; sbtns.forEach((b, i) => b.classList.toggle('sel', SCEN[i] === s)); render(); }
    function render() {
      const [line, procs, text, cls] = sc.steps[pos];
      codeEl.innerHTML = sc.code.map((l, i) => `<span class="st-line${i === line ? ' cur' : ''}">${highlight(l, sc.code === SHELL_CODE ? 'c' : 'py')}</span>`).join('');
      tree.innerHTML = '';
      const all = [[1, 0, 'systemd', 'S', null], ...procs];
      const depth = pid => { let d = 0, p = all.find(x => x[0] === pid); while (p && p[1]) { d++; p = all.find(x => x[0] === p[1]); } return d; };
      const order = [];
      const walk = pid => { order.push(all.find(x => x[0] === pid)); all.filter(x => x[1] === pid).forEach(x => walk(x[0])); };
      walk(1);
      const ST = { R: 'работает', S: 'спит', Z: 'зомби' };
      for (const [pid, ppid, name, st, fds] of order) {
        tree.append(h('div', { class: `fx-p st-${st}`, style: `margin-left:${depth(pid) * 18}px` },
          h('b', { class: 'fx-pid' }, pid),
          h('span', { class: 'fx-name' }, st === 'Z' ? `[${name}] <defunct>` : name),
          h('span', { class: 'fx-st' }, st + ' · ' + ST[st]),
          ppid ? h('span', { class: 'fx-pp' }, 'PPID ' + ppid) : null,
          fds ? h('span', { class: 'fx-fds' }, Object.entries(fds).map(([n, f]) => h('i', { class: f === 'tty' ? '' : 'file' }, `${n}→${f}`))) : null,
        ));
      }
      logEl.innerHTML = text;
      logEl.className = 'log ' + (cls || '');
      stepBtn.disabled = pos >= sc.steps.length - 1;
    }
    load(SCEN[0]);
    return {};
  });

  // ---------------------------------------------------------------- docker stop
  Deck.demo('dockerstop', root => {
    const MODES = [
      ['sh', 'entrypoint.sh без exec'],
      ['exec', 'exec python app.py'],
      ['init', 'docker run --init'],
    ];
    const GRACE = 10, SPEED = 3;
    // Requests are always flowing: when one finishes, the app accepts the next one unless it is draining.
    let mode = 'sh', handler = true, t, running, events, evI, outcome, reqs, nextId, draining, doneAt;
    const mbtns = MODES.map(([k, label]) => h('button', { class: 'btn small', onclick: () => { mode = k; reset(); } }, h('code', null, label)));
    const hIn = h('input', { type: 'checkbox', checked: true });
    hIn.addEventListener('change', () => { handler = hIn.checked; reset(); });
    const procs = h('div', { class: 'ds-procs' });
    const reqEl = h('div', { class: 'ds-reqs' });
    const fill = h('span', { class: 'ds-fill' });
    const stopBtn = h('button', { class: 'btn primary', onclick: go }, h('code', null, 'docker stop'));
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(
      h('div', { class: 'controls' }, ...mbtns),
      h('label', { class: 'toggle' }, hIn, h('span', null, 'приложение ловит SIGTERM')),
      h('div', { class: 'ds-box' }, h('span', { class: 'label' }, 'контейнер'), procs, reqEl),
      h('div', { class: 'ds-time' }, h('div', { class: 'ds-track' }, fill, h('i', { class: 'ds-kill' }, h('b', null, 'SIGKILL'))),
        h('div', { class: 'ds-ticks' }, h('span', null, '0 с'), h('span', null, '5 с'), h('span', null, '10 с'))),
      h('div', { class: 'controls' }, stopBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      stats, logEl,
    );
    const loop = rafLoop(dt => {
      if (!running) return;
      t += dt * SPEED;
      while (running && evI < events.length && events[evI][0] <= t) { events[evI][1](); evI++; }
      if (!running) return;
      reqs.forEach((r, i) => {
        if (r.st === 'run' && t - r.start >= r.need) {
          r.st = 'done';
          if (!draining) reqs[i] = newReq(t);
        }
      });
      if (draining && reqs.every(r => r.st === 'done')) {
        if (doneAt == null) { doneAt = t; say('Последний запрос доделан. Закрываем соединения с базой…', 'ok'); }
        if (t - doneAt > 0.2) finish(0, 'ok', `Всё доделано и закрыто, <code>exit(0)</code>. Остановка заняла ${dec(t)} с, ни один клиент не получил ошибку.`);
      }
      render();
    });
    const newReq = (start, need = 0.6 + ((nextId * 0.37) % 0.6)) => ({ id: nextId++, start, need, st: 'run' });
    const tree = () => mode === 'exec'
      ? [[1, 'python app.py', 'app']]
      : [[1, mode === 'sh' ? 'sh entrypoint.sh' : 'tini', 'init'], [7, 'python app.py', 'app']];

    function reset() {
      loop.stop();
      running = false; t = 0; evI = 0; events = []; outcome = null; nextId = 1; draining = false; doneAt = null;
      reqs = [newReq(-0.3, 0.7), newReq(-0.1, 1.0), newReq(0, 1.2)];
      mbtns.forEach((b, i) => b.classList.toggle('sel', MODES[i][0] === mode));
      stopBtn.disabled = false;
      say(`Приложение — PID ${mode === 'exec' ? 1 : 7}, непрерывно обслуживает запросы. Нажмите <code>docker stop</code>.`);
      render();
    }
    function finish(code, cls, text) {
      outcome = { code, at: t };
      running = false;
      reqs.forEach(r => { if (r.st === 'run') r.st = 'cut'; });
      say(text, cls);
      render();
    }
    const drain = () => { draining = true; };
    const kill = text => [GRACE, () => finish(137, 'bad', text)];
    function go() {
      if (outcome) reset();
      running = true;
      stopBtn.disabled = true;
      if (mode === 'sh') {
        say('SIGTERM → PID 1, это <code>sh</code>. Обработчика у него нет, а PID 1 сигналы без обработчика не получает — сигнал отброшен. Python о нём не узнал' + (handler ? ', и его обработчик не помог.' : '.') + ' Он продолжает принимать запросы.', 'warn');
        events = [kill('10 секунд прошли: SIGKILL. Со смертью PID 1 ядро убивает все процессы контейнера. Код 137, текущие запросы оборваны, а каждый деплой ждёт лишние 10 секунд. Нужен <code>exec python app.py</code> в конце скрипта.')];
      } else if (mode === 'exec' && !handler) {
        say('SIGTERM → PID 1, это python. Обработчика нет, а для PID 1 ядро такие сигналы игнорирует: действие «умереть» к init не применяется. Приложение работает дальше.', 'warn');
        events = [kill('10 секунд прошли: SIGKILL, код 137. Приложение не успело ничего закрыть, текущие запросы оборваны. Нужен обработчик SIGTERM или init перед приложением.')];
      } else if (mode === 'exec') {
        say('SIGTERM → PID 1, это python. Обработчик: перестать принимать новые запросы и доделать текущие.', 'ok');
        drain();
      } else if (!handler) {
        say('SIGTERM → tini (PID 1), tini переслал его python (PID 7).');
        events = [[0.06, () => finish(143, 'bad', 'У python нет обработчика: действие по умолчанию — смерть. Остановка мгновенная, но текущие запросы оборваны на середине. Код 143 = 128 + 15.')]];
      } else {
        say('SIGTERM → tini (PID 1), tini переслал его python (PID 7). Обработчик перестаёт принимать запросы и доделывает текущие.', 'ok');
        events = [[0.03, drain]];
      }
      evI = 0;
      loop.start();
    }
    function render() {
      procs.innerHTML = '';
      const dead = outcome && outcome.code !== 0;
      for (const [pid, name, role] of tree()) {
        procs.append(h('div', { class: 'ds-p ' + role + (outcome ? ' gone' : '') },
          h('b', null, 'PID ' + pid), h('span', null, name),
          h('small', null, outcome ? (dead ? 'убит' : 'завершился') : draining && role === 'app' ? 'доделывает' : role === 'init' ? 'init' : 'приложение')));
      }
      reqEl.innerHTML = '';
      reqs.forEach(r => {
        const p = r.st === 'done' ? 1 : Math.max(0.03, Math.min(1, (t - r.start) / r.need));
        reqEl.append(h('div', { class: 'ds-req ' + r.st },
          h('span', null, `запрос ${r.id}`),
          h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${p * 100}%` })),
          h('small', null, r.st === 'done' ? 'готово' : r.st === 'cut' ? 'оборван' : 'идёт')));
      });
      fill.style.width = Math.min(100, (t / (GRACE + 1)) * 100) + '%';
      fill.className = 'ds-fill' + (outcome && outcome.code === 137 ? ' bad' : '');
      const cut = reqs.filter(r => r.st === 'cut').length;
      stats.innerHTML = `<div class="stat${outcome && outcome.code ? ' warn' : ''}"><b>${outcome ? outcome.code : '—'}</b><span>код выхода</span></div>` +
        `<div class="stat"><b>${dec(outcome ? outcome.at : t, 1)} с</b><span>остановка</span></div>` +
        `<div class="stat${cut ? ' warn' : ''}"><b>${cut}</b><span>запросов оборвано</span></div>`;
    }
    reset();
    return { start: () => { if (running) loop.start(); }, stop: () => loop.stop() };
  });
})();

// Demos for slides 11–17: clocks, permissions, capabilities and sandboxes, eBPF, OS differences.
(() => {
  'use strict';
  const { h, rafLoop } = Deck;
  const { logger, choice, dec } = OS;

  // ---------------------------------------------------------------- clocks
  Deck.demo('clocks', root => {
    const EPOCH0 = Date.UTC(2026, 9, 10, 2, 59, 50) / 1000; // настенные часы в момент старта демо
    const UPTIME0 = 86400 * 3 + 5025.25;                       // CLOCK_MONOTONIC: три дня работы
    const SLEPT0 = 7 * 3600;                                   // ноутбук уже спал 7 часов
    let t = 0, wallOff = 0, slept = 0, mark = null;
    const now = () => ({ real: EPOCH0 + t + wallOff, mono: UPTIME0 + t - slept, boot: UPTIME0 + SLEPT0 + t, t });
    const CL = [
      ['real', 'CLOCK_REALTIME', 'time.time() · Date.now() · currentTimeMillis()'],
      ['mono', 'CLOCK_MONOTONIC', 'time.monotonic() · performance.now() · nanoTime()'],
      ['boot', 'CLOCK_BOOTTIME', 'монотонные + время сна'],
    ];
    const rows = CL.map(([k, name, langs]) => {
      const v = h('b', { class: 'ck-v' }), d = h('span', { class: 'ck-d' });
      return { k, v, d, el: h('div', { class: 'ck-row' }, h('div', { class: 'ck-name' }, h('code', null, name), h('span', null, langs)), v, d) };
    });
    const trueEl = h('span', { class: 'ck-true' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const markBtn = h('button', { class: 'btn small primary', onclick: () => { mark = now(); say('Замер начат: запомнили показания всех часов. Теперь устройте неприятность.'); paint(); } }, 'Начать замер');
    root.append(
      h('div', { class: 'controls' }, markBtn,
        h('button', { class: 'btn small', onclick: ntp }, 'NTP: шаг −2 с'),
        h('button', { class: 'btn small', onclick: admin }, 'date +1 ч'),
        h('button', { class: 'btn small', onclick: sleep }, 'Сон крышкой 10 мин')),
      h('div', { class: 'ck-table' }, h('div', { class: 'ck-row ck-head' }, h('span', null, 'часы'), h('span', null, 'показание'), h('span', null, 'Δ с начала замера')), rows.map(r => r.el)),
      trueEl, logEl);
    const hms = s => { const d = new Date(s * 1000); return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(x => String(x).padStart(2, '0')).join(':') + ',' + String(Math.floor((s % 1) * 10)); };
    const secs = s => Math.floor(s).toLocaleString('ru-RU') + ',' + String(Math.floor((s % 1) * 10)) + ' с';
    const delta = x => (x < 0 ? '−' : '+') + dec(Math.abs(x), 1) + ' с';
    function paint() {
      const n = now();
      rows.forEach(r => {
        r.v.textContent = r.k === 'real' ? hms(n.real) + ' UTC' : secs(n[r.k]);
        if (mark) {
          const dv = n[r.k] - mark[r.k], dt = n.t - mark.t;
          r.d.textContent = delta(dv);
          r.d.className = 'ck-d' + (Math.abs(dv - dt) <= 0.05 ? ' ok' : r.k === 'real' ? ' bad' : ' warn');
        } else { r.d.textContent = '—'; r.d.className = 'ck-d'; }
      });
      trueEl.textContent = mark ? `На самом деле прошло: ${delta(n.t - mark.t).slice(1)}` : 'Нажмите «Начать замер».';
    }
    function ntp() {
      wallOff -= 2;
      say('Часы ушли вперёд, и <code>chronyd</code> или <code>systemd-timesyncd</code> шагнул их назад. Настенное время уже показывало «будущее» — разность вышла отрицательной. Монотонные часы шаг не трогает: NTP подстраивает их только скоростью, до 0,05%.', 'bad');
      paint();
    }
    function admin() {
      wallOff += 3600;
      say('Кто-то перевёл системное время на час. Таймауты на настенных часах сработают раньше срока, кэш с TTL «протухнет» весь сразу. Летнее время так <b>не</b> делает: оно меняет только отображение в часовом поясе, а секунды с 1970 года идут ровно.', 'bad');
      paint();
    }
    function sleep() {
      t += 600; slept += 600;
      say('Ноутбук спал 10 минут. Настенные часы при пробуждении догнали реальность, <code>CLOCK_BOOTTIME</code> тоже, а <code>CLOCK_MONOTONIC</code> в Linux на время сна стоит. Для таймаута «5 секунд работы» это правильно, для «раз в сутки» — нет.', 'warn');
      paint();
    }
    const loop = rafLoop(dt => { t += dt; paint(); });
    paint();
    say('Часы идут. Нажмите «Начать замер».');
    return { start: loop.start, stop: loop.stop };
  });

  // ---------------------------------------------------------------- permission check
  Deck.demo('perms', root => {
    const USERS = [
      { n: 'alice', uid: 1000, groups: ['alice', 'dev'] },
      { n: 'bob', uid: 1001, groups: ['bob', 'dev'] },
      { n: 'eve', uid: 1002, groups: ['eve'] },
      { n: 'root', uid: 0, groups: ['root'] },
    ];
    const OPS = [['r', 'читать', 4], ['w', 'писать', 2], ['x', 'выполнить', 1]];
    const PRESETS = [[0o640, '0640'], [0o600, '0600 ключ SSH'], [0o4755, '4755 setuid'], [0o604, '0604 ловушка']];
    let mode = 0o640, user = 1, op = 0;
    const bitsEl = h('div', { class: 'pm-bits' });
    const lsEl = h('pre', { class: 'code pm-ls' });
    const users = choice(USERS.map(u => u.n), i => { user = i; render(); });
    const ops = choice(OPS.map(o => o[1]), i => { op = i; render(); });
    const presets = choice(PRESETS.map(p => p[1]), i => { mode = PRESETS[i][0]; render(); });
    const steps = h('ol', { class: 'pm-steps' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(lsEl, bitsEl,
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Кто:'), ...users.btns),
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Что:'), ...ops.btns),
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Режим:'), ...presets.btns),
      steps, logEl);
    const CLASSES = [['владелец', 6], ['группа', 3], ['остальные', 0]];
    function bitsButtons() {
      bitsEl.innerHTML = '';
      CLASSES.forEach(([name, sh], ci) => {
        const row = h('div', { class: 'pm-row', 'data-c': ci }, h('span', { class: 'pm-cl' }, name));
        OPS.forEach(([ch, , v]) => {
          const bit = v << sh;
          row.append(h('button', { class: 'pm-bit' + (mode & bit ? ' on' : ''), 'aria-pressed': String(!!(mode & bit)), onclick: () => { mode ^= bit; render(); } }, ch));
        });
        const sp = [[0o4000, 's', 'setuid'], [0o2000, 's', 'setgid'], [0o1000, 't', 'sticky']][ci];
        row.append(h('button', { class: 'pm-bit pm-sp' + (mode & sp[0] ? ' on' : ''), title: sp[2], onclick: () => { mode ^= sp[0]; render(); } }, sp[2]));
        bitsEl.append(row);
      });
    }
    function lsString() {
      let s = '-';
      CLASSES.forEach(([, sh], ci) => {
        const t = (mode >> sh) & 7;
        s += t & 4 ? 'r' : '-';
        s += t & 2 ? 'w' : '-';
        const spBit = [0o4000, 0o2000, 0o1000][ci], spCh = ci === 2 ? 't' : 's';
        s += mode & spBit ? (t & 1 ? spCh : spCh.toUpperCase()) : (t & 1 ? 'x' : '-');
      });
      return s;
    }
    function render() {
      users.set(user); ops.set(op); presets.set(PRESETS.findIndex(p => p[0] === mode));
      bitsButtons();
      lsEl.textContent = `$ ls -l app.bin            # режим ${mode.toString(8).padStart(4, '0')}\n${lsString()} 1 alice dev 4096 app.bin`;
      const u = USERS[user], [opk, opName, opv] = OPS[op];
      const st = [];
      let ok, cls = -1;
      if (u.uid === 0) {
        if (opk === 'x') {
          ok = !!(mode & 0o111);
          st.push('uid 0: у root есть <code>CAP_DAC_OVERRIDE</code> — биты владельца, группы и остальных не проверяются.');
          st.push(ok ? 'Для выполнения нужен хотя бы один бит <code>x</code> — он есть.' : 'Но выполнять можно, только если стоит хотя бы один бит <code>x</code>. Его нет — даже root получит <code>EACCES</code>.');
        } else {
          ok = true;
          st.push('uid 0: у root есть <code>CAP_DAC_OVERRIDE</code> — чтение и запись разрешены при любых битах.');
        }
      } else {
        if (u.n === 'alice') { cls = 0; st.push('uid alice = владелец файла → берём <b>только</b> тройку владельца.'); }
        else {
          st.push(`uid ${u.n} ≠ владелец alice.`);
          if (u.groups.includes('dev')) { cls = 1; st.push(`${u.n} состоит в группе dev = группа файла → берём <b>только</b> тройку группы.`); }
          else { cls = 2; st.push(`${u.n} не в группе dev → тройка остальных.`); }
        }
        const t = (mode >> CLASSES[cls][1]) & 7;
        ok = !!(t & opv);
        st.push(`Бит <code>${opk}</code> в этой тройке ${ok ? 'стоит → можно' : 'не стоит → <code>EACCES</code>'}.`);
      }
      [...bitsEl.children].forEach((r, i) => r.classList.toggle('act', i === cls));
      steps.innerHTML = '';
      st.forEach(s => steps.append(h('li', { html: s })));
      let msg = ok ? `${u.n}: ${opName} — <b>можно</b>.` : `${u.n}: ${opName} — <b>запрещено</b>.`;
      if (ok && opk === 'x' && mode & 0o4000) msg += ' Бит setuid: процесс запустится с euid = alice — с её правами, кто бы ни запускал.';
      if (ok && opk === 'x' && mode & 0o2000) msg += ' Бит setgid: egid процесса станет dev.';
      if (!ok && cls >= 0 && cls < 2 && ((mode >> 0) & opv)) msg += ' А «остальным» это разрешено! Ядро не объединяет тройки: нашлась своя — дальше не смотрит.';
      if (mode === 0o600 && u.n === 'alice') msg += ' Так и должен выглядеть приватный ключ: ssh откажется брать ключ, который могут читать другие.';
      if (mode & 0o1000 && !(mode & 0o4000) && op === 2) msg += ' Sticky bit на обычном файле Linux игнорирует — он имеет смысл на каталогах.';
      say(msg, ok ? 'ok' : 'bad');
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- capabilities and sandboxes
  Deck.demo('caps', root => {
    const WHO = [
      { b: 'пользователь', uid: 1000, caps: [], seccomp: false, lsm: false, desc: 'uid 1000, capabilities: нет' },
      { b: 'root', uid: 0, caps: 'all', seccomp: false, lsm: false, desc: 'uid 0, capabilities: все 41' },
      { b: 'root в Docker', uid: 0, caps: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'KILL', 'SETGID', 'SETUID', 'SETPCAP', 'NET_BIND_SERVICE', 'NET_RAW', 'SYS_CHROOT', 'MKNOD', 'AUDIT_WRITE', 'SETFCAP'], seccomp: true, lsm: true,
        desc: 'uid 0, 14 capabilities, seccomp-профиль, AppArmor docker-default' },
      { b: 'сервис systemd', uid: 998, caps: ['NET_BIND_SERVICE'], seccomp: false, lsm: false, desc: 'uid 998, AmbientCapabilities=CAP_NET_BIND_SERVICE' },
    ];
    const ACTS = [
      { b: 'слушать порт 443', call: 'bind(fd, :443)', cap: 'NET_BIND_SERVICE', why: 'порты ниже 1024' },
      { b: 'читать /etc/shadow', call: 'openat("/etc/shadow")', cap: 'DAC_OVERRIDE', dac: true, why: 'файл 0640 root:shadow' },
      { b: 'убить чужой процесс', call: 'kill(4242, SIGKILL)', cap: 'KILL', why: 'процесс другого uid' },
      { b: 'поменять время', call: 'clock_settime(…)', cap: 'SYS_TIME', sec: true, why: 'системные часы' },
      { b: 'загрузить модуль', call: 'finit_module(fd, …)', cap: 'SYS_MODULE', sec: true, why: 'код в ядро' },
      { b: 'смонтировать ФС', call: 'mount("/dev/sdb1", "/mnt", …)', cap: 'SYS_ADMIN', sec: true, lsmDeny: true, why: 'монтирование' },
      { b: 'ptrace чужого', call: 'ptrace(PTRACE_ATTACH, 4242)', cap: 'SYS_PTRACE', why: 'отладка процесса другого uid' },
    ];
    let w = 2, a = 3;
    const who = choice(WHO.map(x => x.b), i => { w = i; render(); });
    const acts = choice(ACTS.map(x => x.b), i => { a = i; render(); });
    const desc = h('div', { class: 'cp-desc' });
    const pipe = h('div', { class: 'cp-pipe' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('span', { class: 'label' }, 'Кто'), who.el, desc, h('span', { class: 'label' }, 'Что хочет'), acts.el, pipe, logEl);
    function has(x, cap) { return x.caps === 'all' || x.caps.includes(cap); }
    function render() {
      who.set(w); acts.set(a);
      const x = WHO[w], c = ACTS[a];
      desc.textContent = x.desc;
      // Stages: [title, state: pass|fail|skip, detail]
      const S = [['системный вызов', 'pass', c.call]];
      let msg, cls = 'ok', done = false;
      if (!x.seccomp) S.push(['seccomp', 'skip', 'фильтра нет']);
      else if (c.sec) { S.push(['seccomp', 'fail', 'вызов в чёрном списке → EPERM']); done = true; msg = `Профиль seccomp Docker не пропускает <code>${c.call.split('(')[0]}</code>: ядро даже не смотрит на uid и capabilities. Это второй рубеж: он сужает поверхность атаки на ядро — даже уязвимость в коде этого вызова из контейнера недостижима.`; cls = 'bad'; }
      else S.push(['seccomp', 'pass', 'вызов разрешён']);
      if (!done) {
        const capOk = has(x, c.cap);
        if (c.dac) S.push(['права и capabilities', capOk ? 'pass' : 'fail', capOk ? `биты не дают, но есть CAP_${c.cap}` : `${c.why}: биты не дают → EACCES`]);
        else S.push(['права и capabilities', capOk ? 'pass' : 'fail', capOk ? `есть CAP_${c.cap}` : `${c.why}: нужна CAP_${c.cap} → EPERM`]);
        if (!capOk) {
          done = true; cls = 'bad';
          if (c.dac) msg = 'Биты режима не пускают: файл <code>0640 root:shadow</code>, процесс не владелец и не в группе shadow → <code>EACCES</code>. Обойти биты может только <code>CAP_DAC_OVERRIDE</code> — и правильно, что её нет.';
          else msg = `Нет <code>CAP_${c.cap}</code> → <code>EPERM</code>.` + (x.uid === 0 ? ' uid 0 сам по себе ничего не решает: ядро проверяет capability, а Docker её убрал.' : ' Если процессу это действительно нужно, дайте ему ровно эту capability, а не root.');
        }
      }
      if (!done) {
        if (!x.lsm) S.push(['LSM', 'skip', 'профиля нет']);
        else if (c.lsmDeny) { S.push(['LSM', 'fail', 'AppArmor запрещает']); done = true; cls = 'bad'; msg = 'AppArmor docker-default запрещает mount.'; }
        else S.push(['LSM', 'pass', 'AppArmor разрешает']);
      }
      S.push(['результат', done ? 'fail' : 'pass', done ? 'ошибка' : 'выполнено']);
      pipe.innerHTML = '';
      S.forEach(([t, st, d], i) => {
        if (i) pipe.append(h('span', { class: 'cp-arrow', 'aria-hidden': 'true' }, '→'));
        pipe.append(h('div', { class: 'cp-st cp-' + st }, h('b', null, t), h('span', null, d)));
      });
      if (!done) {
        msg = x.caps === 'all' ? `root может всё: у него есть <code>CAP_${c.cap}</code> и все остальные.` : `Разрешено: есть <code>CAP_${c.cap}</code>.`;
        if (w === 2 && c.cap === 'KILL') msg += ' Но в своём пространстве PID контейнер видит только свои процессы — чужие на хосте ему не достать.';
        if (w === 2 && c.cap === 'DAC_OVERRIDE') msg += ' Только это <code>/etc/shadow</code> контейнера, а не хоста: у контейнера своя файловая система.';
        if (w === 2 && c.cap === 'NET_BIND_SERVICE') msg += ' А в сетевом пространстве контейнера Docker ещё и снимает ограничение на низкие порты для всех uid.';
        if (w === 3 && c.cap === 'NET_BIND_SERVICE') msg += ' Ровно столько прав, сколько нужно: nginx или ваш сервис слушает 443 без root.';
      }
      say(msg, cls);
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- eBPF
  Deck.demo('ebpf', root => {
    const Q = [
      { b: 'Кто открывает файлы?', probe: 'tracepoint',
        code: `bpftrace -e 'tracepoint:syscalls:sys_enter_openat {
  printf("%-6d %-8s %s\\n", pid, comm, str(args.filename)); }'`,
        out: ['2210   python3  /etc/ssl/certs/ca-certificates.crt', '3121   node     /app/node_modules/.cache/babel/4f1e.json', '3121   node     /app/node_modules/.cache/babel/9a07.json', '988    java     /proc/self/mountinfo', '3121   node     /app/node_modules/.cache/babel/c2d8.json', '1      systemd  /proc/3121/cgroup'],
        log: 'Tracepoint — стабильная точка, которую разработчики ядра расставили сами. Видно все процессы сразу, без перезапуска: например, Node на каждый запрос читает кэш babel с диска.' },
      { b: 'Что запускается?', probe: 'tracepoint',
        code: `bpftrace -e 'tracepoint:syscalls:sys_enter_execve {
  printf("%-6d %s\\n", pid, str(args.filename)); }'`,
        out: ['41022  /bin/sh', '41023  /usr/bin/curl', '41025  /bin/sh', '41026  /usr/bin/curl', '41028  /bin/sh', '41029  /usr/bin/curl'],
        log: 'Кто-то каждую секунду запускает shell и curl — health-check, написанный как <code>sh -c "curl …"</code>. Короткоживущие процессы в <code>top</code> не поймать, а здесь видно каждый (готовая утилита — <code>execsnoop</code>).' },
      { b: 'Сколько ждёт read()?', probe: 'kprobe',
        code: `bpftrace -e 'kprobe:vfs_read { @s[tid] = nsecs; }
  kretprobe:vfs_read /@s[tid]/ {
  @us = hist((nsecs - @s[tid]) / 1000); delete(@s[tid]); }'`,
        out: ['^C', '@us:', '[0]       8123 |@@@@@@@@@@@@@@@@@@@@|', '[1]       2210 |@@@@@               |', '[2, 4)     612 |@                   |', '[4, 8)     140 |                    |', '[256, 512)  97 |                    |', '[512, 1K)  188 |                    |', '[1K, 2K)    37 |                    |'],
        log: 'Kprobe цепляется к любой функции ядра — мощно, но имена функций меняются между версиями. Гистограмма с двумя горбами: микросекунды — данные из кэша страниц, сотни микросекунд — поход на диск. По одному среднему такого не увидеть.' },
      { b: 'Кто чаще ходит в ядро?', probe: 'tracepoint',
        code: `bpftrace -e 'tracepoint:raw_syscalls:sys_enter {
  @[comm] = count(); }'`,
        out: ['^C', '@[sshd]: 212', '@[postgres]: 48311', '@[node]: 96650', '@[java]: 1520332'],
        log: 'Счётчик живёт в карте (map) внутри ядра; в пространство пользователя уходит только итог при Ctrl+C. Поэтому накладные расходы малы даже на миллионах событий. Полтора миллиона вызовов у java — повод посмотреть, нет ли там небуферизованной записи.' },
      { b: 'Куда идут ретрансмиты?', probe: 'tracepoint',
        code: `bpftrace -e 'tracepoint:tcp:tcp_retransmit_skb {
  @[ntop(args.daddr)] = count(); }'`,
        out: ['^C', '@[10.0.3.17]: 4', '@[10.0.5.40]: 7', '@[10.0.7.2]: 913'],
        log: 'Почти все повторные отправки TCP — к одному адресу: проблема в сети до этого хоста, а не в приложении. Подробнее о ретрансмитах — в презентации <a href="/networking/">про сеть</a>.' },
      { b: 'Что вводят в bash?', probe: 'uprobe',
        code: `bpftrace -e 'uretprobe:/bin/bash:readline {
  printf("%-6d %s\\n", pid, str(retval)); }'`,
        out: ['5120   ls -la', '5120   cd /srv/app', '5377   export DB_PASSWORD=…', '5120   kubectl get pods'],
        log: 'Uprobe цепляется к функции в любом бинарнике или библиотеке — здесь к <code>readline</code> в bash, то есть к вводу во всех терминалах машины. Поэтому загружать eBPF может только root или <code>CAP_BPF</code>: это ещё и мощный инструмент слежки.' },
    ];
    const PIPE = ['байткод BPF', 'верификатор', 'JIT', 'точка крепления', 'карты и вывод'];
    const PIPE_LOG = [
      'bpftrace компилирует однострочник в байткод BPF — простую 64-битную машину с 11 регистрами.',
      'Верификатор ядра проверяет программу до загрузки: все пути конечны, память — только своя и проверенная, вызовы — только разрешённых функций. Иначе программа не загрузится.',
      'JIT переводит байткод в машинный код процессора — работает с родной скоростью.',
      'Программа прикрепляется к точке: tracepoint, kprobe, uprobe, сетевой хук. Код ядра не меняется и не перезагружается.',
      'На каждом событии программа пишет в карты и кольцевой буфер, bpftrace читает их и печатает.',
    ];
    let q = 0, timers = [];
    const pick = choice(Q.map(x => x.b), i => { q = i; reset(); });
    const codeEl = h('pre', { class: 'code eb-code' }, h('code'));
    const pipeEl = h('div', { class: 'eb-pipe' }, PIPE.map(t => h('span', null, t)));
    const outEl = h('pre', { class: 'code eb-out' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const runBtn = h('button', { class: 'btn primary', onclick: run }, 'Запустить');
    root.append(pick.el, codeEl, h('div', { class: 'controls' }, runBtn, h('span', { class: 'eb-probe' })), pipeEl, outEl, logEl);
    function clear() { timers.forEach(clearTimeout); timers = []; }
    function reset() {
      clear();
      pick.set(q);
      const x = Q[q];
      codeEl.firstChild.innerHTML = Deck.highlight(x.code, 'plain');
      root.querySelector('.eb-probe').textContent = 'тип точки: ' + x.probe;
      [...pipeEl.children].forEach(s => s.classList.remove('on'));
      outEl.textContent = '$ sudo ' + x.code.split('\n')[0].slice(0, 22) + '…';
      runBtn.disabled = false;
      say('Нажмите «Запустить».');
    }
    function run() {
      clear();
      runBtn.disabled = true;
      const x = Q[q];
      outEl.textContent = 'Attaching 1 probe...';
      [...pipeEl.children].forEach(s => s.classList.remove('on'));
      PIPE.forEach((_, i) => timers.push(setTimeout(() => { pipeEl.children[i].classList.add('on'); say(PIPE_LOG[i]); }, i * 700)));
      const t0 = PIPE.length * 700 + 400;
      x.out.forEach((line, i) => timers.push(setTimeout(() => { outEl.textContent += '\n' + line; }, t0 + i * 280)));
      timers.push(setTimeout(() => { say(x.log, 'ok'); runBtn.disabled = false; }, t0 + x.out.length * 280));
    }
    reset();
    return {
      stop() {
        if (!timers.length) return;
        clear();
        const x = Q[q];
        [...pipeEl.children].forEach(s => s.classList.add('on'));
        outEl.textContent = 'Attaching 1 probe...\n' + x.out.join('\n');
        say(x.log, 'ok');
        runBtn.disabled = false;
      },
    };
  });

  // ---------------------------------------------------------------- Linux / macOS / Windows
  Deck.demo('osdiff', root => {
    const T = [
      { b: 'Новый процесс', l: '<code>fork</code> + <code>exec</code>, в рантаймах — <code>vfork</code>/<code>posix_spawn</code>', m: '<code>fork</code> есть, но без <code>exec</code> небезопасен в многопоточных и Cocoa-программах; <code>posix_spawn</code>', w: '<code>fork</code> нет. <code>CreateProcess</code> — сразу новая программа',
        trap: 'Python <code>multiprocessing</code> на macOS (с 3.8) и Windows запускает детей через spawn: каждый ребёнок заново импортирует главный модуль. Без <code>if __name__ == "__main__":</code> программа бесконечно плодит процессы, а глобальное состояние родителя в детях не видно.' },
      { b: 'Асинхронный I/O', l: '<code>epoll</code> (готовность), <code>io_uring</code> (завершение)', m: '<code>kqueue</code> (готовность)', w: 'IOCP (завершение): операцию запускают, ядро сообщает о результате',
        trap: 'libuv, Go netpoller, Java NIO и Tokio прячут разницу, но не до конца: на Windows у libuv другие лимиты и поведение пайпов, а в Python <code>asyncio</code> на Windows по умолчанию — ProactorEventLoop с другим набором поддерживаемых функций. Подробнее — в презентации <a href="/async-io/">про асинхронный ввод-вывод</a>.' },
      { b: 'Блокировка файлов', l: 'Рекомендательная: <code>flock</code>, <code>fcntl</code> — кто не спрашивает, тот пишет', m: 'Тоже рекомендательная', w: 'Обязательная: открытый файл нельзя удалить или переименовать без <code>FILE_SHARE_DELETE</code>',
        trap: 'На Windows «The process cannot access the file because it is being used»: тесты не могут удалить временный файл, ротация логов не переименовывает открытый лог, обновление не заменяет запущенный .exe. На Linux, наоборот, удалённый, но открытый файл продолжает занимать диск.' },
      { b: 'Имена файлов', l: 'ext4: регистр важен, запрещены только <code>/</code> и <code>\\0</code>', m: 'APFS: регистр хранится, но при поиске не учитывается', w: 'NTFS: как macOS; плюс <code>CON</code>, <code>NUL</code>, <code>COM1</code> и символы <code>&lt;&gt;:"|?*</code> запрещены, путь до 260 символов',
        trap: '<code>import ./Config</code> вместо <code>./config</code> работает на Mac и падает в CI. Два файла <code>README.md</code> и <code>readme.md</code> в git на Mac превращаются в один. Файл <code>aux.js</code> из Linux-репозитория не создаётся на Windows.' },
      { b: 'Перевод строки', l: '<code>\\n</code> (LF)', m: '<code>\\n</code> (LF)', w: '<code>\\r\\n</code> (CRLF); Python и Java в текстовом режиме переводят сами',
        trap: 'Скрипт, сохранённый на Windows: <code>/bin/bash^M: bad interpreter</code> в Docker-образе. Лечится <code>.gitattributes</code> с <code>* text=auto eol=lf</code> и открытием файлов в нужном режиме.' },
      { b: 'Завершение', l: 'Сигналы: <code>SIGTERM</code>, потом <code>SIGKILL</code>', m: 'Те же сигналы', w: 'Сигналов нет: консольное событие Ctrl+C или <code>TerminateProcess</code> без шанса прибраться',
        trap: 'Graceful shutdown на <code>SIGTERM</code> работает в Docker и Kubernetes, но под Windows-службой нужен свой обработчик событий SCM. <code>os.kill(pid, signal.SIGTERM)</code> в Python на Windows просто убивает процесс.' },
      { b: 'Лимит файлов', l: 'Мягкий <code>ulimit -n</code> обычно 1024, жёсткий у сервисов systemd — 524288', m: 'Мягкий лимит в терминале — 256', w: 'Дескрипторов (handles) — до 16 млн на процесс',
        trap: 'Вотчер файлов, сборщик или тест с сотней параллельных соединений на Mac падает с <code>EMFILE: too many open files</code>, хотя на Linux-сервере всё в порядке. Поднимите лимит: <code>ulimit -n 10240</code>. Go с 1.19 и JVM сами поднимают мягкий лимит до жёсткого, Node и Python — нет.' },
    ];
    const pick = choice(T.map(x => x.b), i => show(i));
    const grid = h('div', { class: 'od-grid' });
    const logEl = h('div', { class: 'log warn', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(pick.el, grid, logEl);
    function show(i) {
      pick.set(i);
      const x = T[i];
      grid.replaceChildren(...[['Linux', x.l, 'l'], ['macOS', x.m, 'm'], ['Windows', x.w, 'w']].map(([n, t, c]) =>
        h('div', { class: 'od-col od-' + c }, h('b', null, n), h('span', { html: t }))));
      say('<b>Где ломается.</b> ' + x.trap, 'warn');
    }
    show(0);
    return {};
  });
})();

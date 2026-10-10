// Demos for slides 2–12: VM vs container, namespaces, PID namespace, cgroup limits,
// overlayfs, build cache, docker run step by step, container networking.
(() => {
  'use strict';
  const { h, plural } = Deck;
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
  const logBox = () => h('div', { class: 'log', 'aria-live': 'polite' });
  // A row of buttons where one is selected.
  function choice(items, onPick, cls = 'btn small') {
    const btns = items.map(([key, label]) => h('button', { class: cls, onclick: () => pick(key) }, label));
    function pick(key) {
      btns.forEach((b, i) => b.classList.toggle('sel', items[i][0] === key));
      onPick(key);
    }
    return { el: h('div', { class: 'controls' }, btns), pick };
  }

  // ---------------------------------------------------------------- VM vs container stack
  Deck.demo('stack', root => {
    const HOST_GB = 64, RESERVED_MB = 2048, APP_MB = 200;
    const MODES = {
      vm: {
        label: 'Виртуальные машины',
        own: [['app', 'приложение'], ['lib', 'рантайм и библиотеки'], ['os', 'гостевая ОС: systemd, sshd, агенты'], ['kern', 'гостевое ядро'], ['virt', 'виртуальное железо (QEMU)']],
        dup: ['os', 'kern', 'virt'],
        shared: [['hv', 'гипервизор: KVM в ядре хоста'], ['hw', 'железо']],
        start: '20–60 с', overhead: 400,
        text: 'У каждой ВМ своё ядро и своя ОС — эти слои повторяются в каждом экземпляре. Граница изоляции — гипервизор с узким интерфейсом: виртуальный процессор, память и несколько устройств.',
      },
      ct: {
        label: 'Контейнеры',
        own: [['app', 'приложение'], ['lib', 'рантайм и библиотеки (образ)']],
        dup: [],
        shared: [['ns', 'namespaces + cgroups'], ['host', 'ядро хоста'], ['hw', 'железо']],
        start: '0,1–1 с', overhead: 5,
        text: 'Повторяется только то, что в образе, — и то слои общих базовых образов лежат на диске и в page cache один раз. Ядро одно. Граница изоляции — все ~350 системных вызовов Linux.',
      },
      micro: {
        label: 'microVM',
        own: [['app', 'приложение'], ['lib', 'рантайм и библиотеки'], ['kern', 'минимальное гостевое ядро'], ['virt', 'Firecracker: только virtio']],
        dup: ['kern', 'virt'],
        shared: [['hv', 'KVM в ядре хоста'], ['hw', 'железо']],
        start: '~0,15 с', overhead: 40,
        text: 'Компромисс: своё ядро, как у ВМ, но без BIOS, без эмуляции старых устройств и без полноценной ОС. Firecracker стартует за ~125 мс и тратит ~5 МБ на себя — так работают AWS Lambda и Fargate.',
      },
    };
    let mode = 'vm';
    const sel = choice(Object.entries(MODES).map(([k, m]) => [k, m.label]), k => { mode = k; render(); });
    const pic = h('div', { class: 'sk' });
    const input = h('input', { type: 'range', min: 1, max: 320, value: 40, 'aria-label': 'Экземпляров приложения' });
    const out = h('output');
    input.addEventListener('input', render);
    const bar = h('div', { class: 'sk-bar' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    root.append(sel.el, pic,
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Экземпляров'), input, out),
      bar,
      h('div', { class: 'bl-legend' }, h('span', null, h('i', { class: 'sw', style: 'background:var(--accent)' }), 'приложения'), h('span', null, h('i', { class: 'sw', style: 'background:var(--dup)' }), 'накладные на экземпляр'), h('span', null, h('i', { class: 'sw', style: 'background:var(--paper);border:1px solid var(--line)' }), 'свободно из 62 ГБ')),
      stats, logEl);

    function render() {
      const m = MODES[mode], n = +input.value;
      out.textContent = n;
      const col = (i) => `<div class="sk-col">${m.own.map(([k, t]) => `<div class="sk-l ${k} ${m.dup.includes(k) ? 'dup' : ''}">${t}</div>`).join('')}</div>`;
      pic.innerHTML = `<div class="sk-cols">${col(1)}${col(2)}${col(3)}<div class="sk-more">… ×${n}</div></div>` +
        m.shared.map(([k, t]) => `<div class="sk-l ${k} wide">${t}</div>`).join('');
      const per = APP_MB + m.overhead;
      const cap = Math.floor((HOST_GB * 1024 - RESERVED_MB) / per);
      const used = n * per, total = HOST_GB * 1024 - RESERVED_MB;
      const over = used > total;
      const appPart = Math.min(n * APP_MB, total), ovPart = Math.min(n * m.overhead, total - appPart);
      bar.innerHTML = `<span class="ap" style="width:${appPart / total * 100}%"></span><span class="ov" style="width:${ovPart / total * 100}%"></span>`;
      stats.innerHTML = `<div class="stat"><b>${m.start}</b><span>старт</span></div>` +
        `<div class="stat"><b>~${m.overhead} МБ</b><span>накладные на экземпляр</span></div>` +
        `<div class="stat ${over ? 'warn' : ''}"><b>${cap}</b><span>влезет на 64 ГБ</span></div>`;
      logEl.className = 'log' + (over ? ' bad' : '');
      logEl.innerHTML = over
        ? `${n} экземпляров не влезут: нужно ${dec(used / 1024)} ГБ, а под приложения ~62 ГБ. ${m.dup.length ? `На повторяющиеся слои уходит ${dec(n * m.overhead / 1024)} ГБ.` : ''}`
        : `${m.text}${m.dup.length ? ` Сейчас накладные: ${dec(n * m.overhead / 1024)} ГБ.` : ''}`;
    }
    sel.pick('vm');
    return {};
  });

  // ---------------------------------------------------------------- namespaces toggles
  Deck.demo('ns', root => {
    const NS = [
      ['pid', 'ps -e', 'PID 1 gunicorn · 7 gunicorn: worker · 9 sh', '1 systemd · 812 containerd · … · 48213 gunicorn',
        '<code>--pid=host</code>: процесс видит все процессы хоста и может слать им сигналы, если хватает прав. Так запускают агенты мониторинга.',
        'Свой PID-namespace: только своё поддерево, первый процесс — PID 1.', true],
      ['mnt', 'ls /', 'app bin etc lib usr — корень из образа', 'boot home root srv var — корень хоста',
        'Без mount-namespace нельзя подменить корень: процесс видит файловую систему хоста. Docker такого режима не даёт вовсе — только bind-монтирование отдельных путей <code>-v</code>.',
        'Свой mount-namespace: корень — склейка слоёв образа, монтирования внутри не видны хосту.', true],
      ['net', 'ip -br addr', 'lo · eth0 172.17.0.2', 'lo · ens5 10.0.3.17 · docker0 · veth3a1f…',
        '<code>--network=host</code>: нет veth и NAT, порт приложения открывается прямо на хосте. Чуть быстрее, но порты общие со всем хостом.',
        'Свой сетевой стек: интерфейсы, маршруты, правила netfilter, таблица сокетов и порты.', true],
      ['uts', 'hostname', '3f9c2a1b7e44', 'prod-node-7',
        '<code>--uts=host</code>: имя хоста общее. <code>sethostname</code> изнутри поменял бы его всему серверу, будь у процесса CAP_SYS_ADMIN.',
        'Своё имя хоста — по умолчанию короткий ID контейнера.', true],
      ['ipc', 'ipcs -m', 'нет сегментов', 'сегменты shared memory Postgres и других',
        '<code>--ipc=host</code>: общие System V IPC и POSIX-очереди сообщений с хостом. Иногда так делают ради общей памяти между процессами.',
        'Свои System V IPC и POSIX-очереди сообщений.', true],
      ['user', 'id; cat /proc/self/uid_map', 'uid=0(root) · 0 → 100000, 65536 шт.', 'uid=0(root) · 0 → 0: это root хоста',
        'Как в Docker по умолчанию: UID 0 внутри — тот же UID 0 в ядре. От хоста защищают только capabilities, seccomp и AppArmor/SELinux.',
        'User namespace (rootless, <code>--userns-remap</code>, <code>hostUsers: false</code> в Kubernetes): UID 0 внутри — это UID 100000 снаружи, capabilities действуют только на объекты своего namespace.', false],
      ['cgroup', 'cat /proc/self/cgroup', '0::/', '0::/system.slice/docker-3f9c….scope',
        'Без cgroup-namespace процесс видит свой полный путь в иерархии. Лимиты при этом действуют так же — namespace меняет только вид.',
        'Свой cgroup-namespace: свой узел иерархии выглядит как корень.', true],
    ];
    const state = Object.fromEntries(NS.map(n => [n[0], n[6]]));
    const rows = h('div', { class: 'ns-rows' });
    const logEl = logBox();
    const say = logger(logEl, 1);
    root.append(h('div', { class: 'ns-head' }, h('span', { class: 'label' }, 'namespace'), h('span', { class: 'label' }, 'что видно изнутри контейнера')), rows, logEl);
    const cells = {};
    for (const [key, cmd] of NS) {
      const cb = h('input', { type: 'checkbox', 'aria-label': key + ' namespace' });
      cb.checked = state[key];
      cb.addEventListener('change', () => { state[key] = cb.checked; render(key); });
      const outEl = h('span', { class: 'ns-out' });
      const row = h('div', { class: 'ns-row' },
        h('label', { class: 'toggle ns-t' }, cb, h('b', null, key)),
        h('div', { class: 'ns-cmd' }, h('span', { class: 'ns-c' }, '$ ' + cmd), outEl));
      rows.append(row);
      cells[key] = { row, outEl };
    }
    function render(changed) {
      for (const [key, , inside, host, offText, onText] of NS) {
        const on = state[key];
        cells[key].outEl.textContent = on ? inside : host;
        cells[key].row.classList.toggle('host', !on);
        cells[key].row.classList.toggle('flash', key === changed);
        if (key === changed) say(`<b>${key}</b>: ${on ? onText : offText}`, on ? 'ok' : 'warn');
      }
    }
    render();
    say('Так выглядит обычный <code>docker run</code>: свои pid, mnt, net, uts, ipc и cgroup, но <b>без user namespace</b>. Восьмой тип, time, Docker не использует.');
    return {};
  });

  // ---------------------------------------------------------------- PID namespace
  Deck.demo('pidns', root => {
    let procs, nextHost, nextCt, alive;
    const hostEl = h('div', { class: 'pn-list' });
    const ctEl = h('div', { class: 'pn-list' });
    const logEl = logBox();
    const say = logger(logEl, 2);
    const btns = {
      fork: h('button', { class: 'btn small', onclick: fork }, 'Ещё воркер'),
      exec: h('button', { class: 'btn small', onclick: exec }, h('code', null, 'docker exec sh')),
      kin: h('button', { class: 'btn small', onclick: killInside }, h('code', null, 'kill -9 1'), ' изнутри'),
      khost: h('button', { class: 'btn small danger', onclick: killHost }, h('code', null, 'kill -9 48213'), ' с хоста'),
    };
    root.append(
      h('div', { class: 'controls' }, ...Object.values(btns), h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('div', { class: 'pn-cols' },
        h('div', { class: 'pn-col' }, h('span', { class: 'label' }, 'Хост: ps -e --forest'), hostEl),
        h('div', { class: 'pn-col ct' }, h('span', { class: 'label' }, 'Контейнер: ps -e'), ctEl)),
      logEl);

    function reset() {
      alive = true;
      nextHost = 48242; nextCt = 9;
      procs = [
        { host: 1, depth: 0, cmd: 'systemd' },
        { host: 812, depth: 1, cmd: 'containerd' },
        { host: 48190, depth: 2, cmd: 'containerd-shim-runc-v2' },
        { host: 48213, ct: 1, depth: 3, cmd: 'gunicorn app:api' },
        { host: 48240, ct: 7, depth: 4, cmd: 'gunicorn: worker' },
        { host: 48241, ct: 8, depth: 4, cmd: 'gunicorn: worker' },
        { host: 1033, depth: 1, cmd: 'sshd' },
      ];
      Object.values(btns).forEach(b => { b.disabled = false; });
      say('Один и тот же процесс: на хосте — 48213, в контейнере — 1. <code>grep NSpid /proc/48213/status</code> → <code>NSpid: 48213 1</code>.');
      render();
    }
    function insertAfter(pred, p) {
      let idx = -1;
      procs.forEach((x, i) => { if (pred(x)) idx = i; });
      procs.splice(idx + 1, 0, p);
      return p;
    }
    function fork() {
      const p = insertAfter(x => x.depth === 4 && x.cmd.includes('worker'), { host: nextHost++, ct: nextCt++, depth: 4, cmd: 'gunicorn: worker', fresh: true });
      say(`<code>fork()</code> в контейнере: ядро выдало процессу два номера сразу — ${p.host} на хосте и ${p.ct} внутри.`);
      render(p);
    }
    function exec() {
      const p = insertAfter(x => x.host === 48213 || (x.depth === 4) || x.cmd.startsWith('sh'), { host: nextHost++, ct: nextCt++, depth: 3, cmd: 'sh (docker exec)', fresh: true, exec: true });
      say(`<code>docker exec</code>: runc делает <code>setns()</code> во все namespaces контейнера и запускает sh. Внутри у него PID ${p.ct} и PPID 0 — его родитель (shim) снаружи namespace.`);
      render(p);
    }
    function killInside() {
      say('Ничего не произошло. Ядро защищает init namespace: сигналы от процессов своего namespace, на которые нет обработчика, ему не доставляются, а <code>SIGKILL</code> и <code>SIGSTOP</code> изнутри — никогда.', 'warn');
      render();
    }
    function killHost() {
      alive = false;
      Object.values(btns).forEach(b => { b.disabled = true; });
      say('Из родительского namespace <code>SIGKILL</code> доходит. PID 1 умер — ядро тут же убивает все остальные процессы namespace. Контейнер завершился с кодом 137 = 128 + 9, shim сообщил об этом containerd.', 'bad');
      render();
    }
    function render(fresh) {
      hostEl.innerHTML = procs.map(p => {
        const dead = !alive && p.ct;
        const pad = '&nbsp;'.repeat(p.depth * 2);
        return `<div class="pn-p ${p.ct ? 'in' : ''} ${dead ? 'dead' : ''} ${p === fresh ? 'fresh' : ''}"><b>${p.host}</b><span>${pad}${p.depth ? '└ ' : ''}${p.cmd}</span></div>`;
      }).join('');
      const inside = procs.filter(p => p.ct).sort((a, b) => a.ct - b.ct);
      ctEl.innerHTML = alive
        ? inside.map(p => `<div class="pn-p in ${p === fresh ? 'fresh' : ''}"><b>${p.ct}</b><span>${p.cmd}</span></div>`).join('')
        : '<div class="pn-empty">контейнер завершён, namespace уничтожен</div>';
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- cgroup limits
  Deck.demo('limits', root => {
    const panel = h('div', { class: 'lm-panel' });
    const logEl = logBox();
    const tabs = choice([['cpu', 'cpu'], ['mem', 'memory'], ['pids', 'pids'], ['io', 'io']], k => show(k));
    root.append(tabs.el, panel, logEl);

    const slider = (label, min, max, val, step, fmtOut, on) => {
      const input = h('input', { type: 'range', min, max, value: val, step, 'aria-label': label });
      const out = h('output');
      const upd = () => { out.textContent = fmtOut(+input.value); on(+input.value); };
      input.addEventListener('input', upd);
      return { el: h('label', { class: 'slider inline' }, h('span', { class: 'label lm-l' }, label), input, out), upd, get: () => +input.value };
    };

    function show(k) {
      panel.innerHTML = '';
      ({ cpu, mem, pids, io })[k]();
    }

    // --- CPU: cpu.max quota vs cpu.weight share on an 8-core host
    function cpu() {
      let mode = 'max', neighbour = true;
      const modeSel = choice([['max', h('code', null, 'cpu.max = 2 ядра')], ['weight', h('code', null, 'cpu.weight = 100')]], m => { mode = m; s.upd(); });
      const nb = h('input', { type: 'checkbox', checked: true });
      nb.addEventListener('change', () => { neighbour = nb.checked; s.upd(); });
      const tl = h('div', { class: 'lm-tl' });
      const stats = h('div', { class: 'stats' });
      const s = slider('Потоков занято', 1, 8, 6, 1, v => v, render);
      panel.append(modeSel.el, h('label', { class: 'toggle' }, nb, h('span', null, 'соседний контейнер (тоже вес 100) грузит все 8 ядер')), s.el,
        h('span', { class: 'label' }, 'Один период 100 мс, поток с запросом:'), tl, stats);
      modeSel.pick('max');
      function render(d) {
        let got, frac, throttled = false;
        if (mode === 'max') {
          got = Math.min(d, 2);
          throttled = d > 2;
          frac = Math.min(1, 2 / d);
        } else {
          const share = neighbour ? 4 : 8;
          got = Math.min(d, share);
          frac = Math.min(1, share / d);
        }
        // Wall time for a request needing 50 ms of CPU on one thread.
        let wall;
        if (mode === 'max') {
          const c = 100 * frac, n = Math.ceil(50 / c - 1e-9);
          wall = (n - 1) * 100 + (50 - (n - 1) * c);
        } else wall = 50 / frac;
        tl.innerHTML = mode === 'max'
          ? `<span class="run" style="width:${frac * 100}%">работает ${fmt(frac * 100)} мс</span>${throttled ? `<span class="thr" style="width:${(1 - frac) * 100}%">throttled</span>` : ''}`
          : `<span class="run share" style="width:100%">${frac < 1 ? `делит ядро с другими: ${fmt(frac * 100)}% времени` : 'работает весь период'}</span>`;
        stats.innerHTML = `<div class="stat"><b>${dec(got, got % 1 ? 1 : 0)} из 8</b><span>ядер получено</span></div>` +
          `<div class="stat ${throttled ? 'warn' : ''}"><b>${throttled ? 10 : 0}/с</b><span>nr_throttled</span></div>` +
          `<div class="stat ${wall > 60 ? 'warn' : ''}"><b>${fmt(wall)} мс</b><span>запрос на 50 мс CPU</span></div>`;
        if (mode === 'max') {
          logEl.className = 'log ' + (throttled ? 'warn' : 'ok');
          logEl.innerHTML = throttled
            ? `Квота 200 мс на период, ${d} ${plural(d, ['поток', 'потока', 'потоков'])} выжигают её за ${fmt(200 / d)} мс — и стоят до конца периода${neighbour ? '' : ', <b>хотя остальные ядра хоста простаивают</b>'}. Хвост задержек: ${fmt(wall)} мс вместо 50.`
            : 'Потоков не больше квоты — лимит не мешает.';
        } else {
          logEl.className = 'log ' + (frac < 1 ? 'warn' : 'ok');
          logEl.innerHTML = neighbour
            ? `Вес — не потолок, а доля при конкуренции: с соседом поровну, по 4 ядра. Троттлинга нет, потоки просто чередуются.`
            : `Сосед молчит — забираем хоть все 8 ядер. Kubernetes <code>requests.cpu</code> превращается именно в вес, а <code>limits.cpu</code> — в <code>cpu.max</code>. Поэтому многие ставят requests и не ставят CPU limits.`;
        }
      }
    }

    // --- Memory: memory.high and memory.max with reclaimable page cache
    function mem() {
      const HIGH = 900, MAX = 1024, CACHE = 400, SCALE = 1500;
      let group = false;
      const g = h('input', { type: 'checkbox' });
      g.addEventListener('change', () => { group = g.checked; s.upd(); });
      const bar = h('div', { class: 'lm-mem' });
      const procsEl = h('div', { class: 'lm-procs' });
      const stats = h('div', { class: 'stats' });
      const s = slider('Анонимная память', 200, 1300, 600, 50, v => v + ' МБ', render);
      panel.append(h('span', { class: 'label' }, h('code', null, 'memory.high = 900M'), ' · ', h('code', null, 'memory.max = 1G'), ' · приложение читает файлы на 400 МБ'),
        s.el, bar,
        h('div', { class: 'bl-legend' }, h('span', null, h('i', { class: 'sw anon' }), 'анонимная (куча)'), h('span', null, h('i', { class: 'sw cache' }), 'page cache')),
        h('label', { class: 'toggle' }, g, h('span', null, h('code', null, 'memory.oom.group = 1'), ' (Kubernetes 1.28+)')),
        procsEl, stats);
      s.upd();
      function render(anon) {
        const oom = anon >= MAX;
        const cache = oom ? 0 : anon >= HIGH ? 0 : Math.min(CACHE, HIGH - anon);
        const throttled = !oom && anon + CACHE > HIGH;
        const shown = Math.min(anon, MAX);
        bar.innerHTML = `<span class="anon" style="width:${shown / SCALE * 100}%"></span><span class="cache" style="width:${cache / SCALE * 100}%"></span>` +
          `<i class="lm-mark high" style="left:${HIGH / SCALE * 100}%"><em>high</em></i><i class="lm-mark max" style="left:${MAX / SCALE * 100}%"><em>max</em></i>`;
        const P = [['gunicorn (PID 1)', 0.1], ['воркер 1', 0.5], ['воркер 2', 0.4]];
        procsEl.innerHTML = P.map(([n, f], i) => {
          const killed = oom && (group || i === 1);
          return `<span class="lm-p ${killed ? 'dead' : ''}">${n}<b>${fmt(anon * f)} МБ</b>${killed ? '<em>убит</em>' : ''}</span>`;
        }).join('');
        stats.innerHTML = `<div class="stat"><b>${fmt(cache)} МБ</b><span>page cache</span></div>` +
          `<div class="stat ${anon + CACHE > HIGH ? 'warn' : ''}"><b>${anon + CACHE > HIGH ? 'растёт' : '0'}</b><span>memory.events high</span></div>` +
          `<div class="stat ${oom ? 'warn' : ''}"><b>${oom ? (group ? 3 : 1) : 0}</b><span>oom_kill</span></div>`;
        if (oom) {
          logEl.className = 'log bad';
          logEl.innerHTML = group
            ? 'Вытеснять больше нечего — OOM внутри cgroup. С <code>memory.oom.group</code> убиты все процессы группы разом: контейнер не останется полуживым. Код выхода 137, в Kubernetes — <code>OOMKilled</code>.'
            : 'OOM внутри cgroup: убит самый большой процесс — воркер 1, вместе с его запросами. PID 1 жив, gunicorn поднимет новый воркер, память снова вырастет. Контейнер не перезапускался, и в Kubernetes статуса <code>OOMKilled</code> не будет — только <code>oom_kill</code> в memory.events.';
        } else if (anon >= HIGH) {
          logEl.className = 'log warn';
          logEl.innerHTML = 'Выше <code>memory.high</code>: page cache выжат весь, а каждое выделение памяти заставляет процесс самого заниматься reclaim и спать. Не убивает, но задержки растут — смотрите <code>memory.pressure</code>.';
        } else if (throttled) {
          logEl.className = 'log warn';
          logEl.innerHTML = `Вместе с кэшем выходит за <code>memory.high</code> — ядро вытесняет page cache этой группы: осталось ${fmt(cache)} из 400 МБ. Чтения файлов чаще идут на диск.`;
        } else {
          logEl.className = 'log ok';
          logEl.innerHTML = 'Всё помещается: и куча, и файлы в кэше.';
        }
      }
    }

    // --- PIDs: pids.max limits processes and threads
    function pids() {
      const MAX = 128;
      const meter = h('div', { class: 'cost-track lm-pt' }, h('span', { class: 'cost-fill' }));
      const stats = h('div', { class: 'stats' });
      const s = slider('Потоков хочет приложение', 20, 300, 100, 10, v => v, render);
      panel.append(h('span', { class: 'label' }, h('code', null, 'pids.max = 128'), ' — считаются и процессы, и потоки'), s.el, meter, stats);
      s.upd();
      function render(want) {
        const got = Math.min(want, MAX), fail = want - got;
        meter.firstChild.style.width = (got / MAX * 100) + '%';
        meter.firstChild.style.background = fail ? 'var(--block)' : '';
        stats.innerHTML = `<div class="stat"><b>${got}</b><span>pids.current</span></div>` +
          `<div class="stat ${fail ? 'warn' : ''}"><b>${fail}</b><span>отказов (pids.events max)</span></div>` +
          `<div class="stat"><b>${fail ? 'EAGAIN' : '—'}</b><span>ошибка clone()</span></div>`;
        logEl.className = 'log ' + (fail ? 'bad' : 'ok');
        logEl.innerHTML = fail
          ? `<code>clone()</code> возвращает EAGAIN, и каждый рантайм падает по-своему. Java: <code>OutOfMemoryError: unable to create native thread</code>. Go: <code>runtime: failed to create new OS thread</code> и аварийный выход. Python: <code>RuntimeError: can't start new thread</code>. Bash: <code>fork: Resource temporarily unavailable</code>. Памяти при этом полно.`
          : 'Лимит не мешает. Он защищает хост от fork-бомбы и утечки потоков в одном контейнере — в Kubernetes это <code>podPidsLimit</code>.';
      }
    }

    // --- IO: io.max wiops on a fast NVMe
    function io() {
      const LIMIT = 1000, DEV_IOPS = 20000, DEV_LAT = 0.1; // ms
      const stats = h('div', { class: 'stats' });
      const cmp = h('div', { class: 'lm-io' });
      const s = slider('Потоков пишут с fsync', 1, 64, 8, 1, v => v, render);
      panel.append(h('span', { class: 'label' }, h('code', null, 'io.max = "259:0 wiops=1000"'), ' · NVMe держит 20 000 IOPS по 0,1 мс'), s.el, cmp, stats);
      s.upd();
      function render(qd) {
        const free = Math.min(qd / (DEV_LAT / 1000), DEV_IOPS);
        const lim = Math.min(free, LIMIT);
        const latFree = qd / free * 1000, latLim = qd / lim * 1000;
        cmp.innerHTML = `<div><span class="label">без лимита</span><span class="cost-track"><span class="cost-fill" style="width:${free / DEV_IOPS * 100}%"></span></span><b>${fmt(free)} IOPS · ${dec(latFree, latFree < 1 ? 2 : 1)} мс</b></div>` +
          `<div><span class="label">с io.max</span><span class="cost-track"><span class="cost-fill" style="width:${lim / DEV_IOPS * 100}%;background:var(--block)"></span></span><b>${fmt(lim)} IOPS · ${dec(latLim, latLim < 10 ? 1 : 0)} мс</b></div>`;
        stats.innerHTML = `<div class="stat ${latLim > 5 ? 'warn' : ''}"><b>${dec(latLim, latLim < 10 ? 1 : 0)} мс</b><span>на одну запись</span></div>` +
          `<div class="stat"><b>${qd}</b><span>процессов в состоянии D</span></div>` +
          `<div class="stat"><b>~0%</b><span>загрузка CPU</span></div>`;
        logEl.className = 'log warn';
        logEl.innerHTML = `Лимит не отказывает, а держит запросы в очереди ядра. Потоки спят в состоянии D: load average растёт на ${qd}, хотя процессор свободен. Видно в <code>io.stat</code> и <code>io.pressure</code>. Буферизованная запись тоже учитывается — при writeback грязных страниц этой группы.`;
      }
    }

    tabs.pick('cpu');
    return {};
  });

  // ---------------------------------------------------------------- overlayfs
  Deck.demo('overlay', root => {
    const LAYERS = [
      { id: 'L1', title: 'L1 · FROM debian:bookworm-slim', files: { '/etc/os-release': 0.3, '/etc/ssl/openssl.cnf': 12, '/usr/bin/python3': 6800 } },
      { id: 'L2', title: 'L2 · RUN apt-get install …', files: { '/etc/ssl/openssl.cnf': 12, '/opt/geo/cities.db': 61440 } },
      { id: 'L3', title: 'L3 · COPY . /app', files: { '/app/main.py': 4, '/app/config.yaml': 1 } },
    ];
    let upper, selected, upperKb;
    const kb = v => v >= 1024 ? dec(v / 1024, v >= 10240 ? 0 : 1) + ' МБ' : (v < 1 ? dec(v) : fmt(v)) + ' КБ';
    const merged = h('div', { class: 'ov-merged' });
    const layersEl = h('div', { class: 'ov-layers' });
    const logEl = logBox();
    const say = logger(logEl, 2);
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: read }, 'Читать'),
        h('button', { class: 'btn small', onclick: write }, 'Записать'),
        h('button', { class: 'btn small', onclick: del }, 'Удалить'),
        h('button', { class: 'btn small', onclick: create }, 'Создать /tmp/cache.db'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('div', { class: 'ov-grid' },
        h('div', { class: 'stack ov-m' }, h('span', { class: 'label' }, 'merged — что видит процесс'), merged),
        h('div', { class: 'stack ov-l' }, h('span', { class: 'label' }, 'слои'), layersEl)),
      logEl);

    const lowerOf = p => { for (let i = LAYERS.length - 1; i >= 0; i--) if (p in LAYERS[i].files) return LAYERS[i]; return null; };
    const visible = () => {
      const paths = new Set();
      LAYERS.forEach(l => Object.keys(l.files).forEach(p => paths.add(p)));
      Object.keys(upper).forEach(p => paths.add(p));
      return [...paths].filter(p => !(upper[p] && upper[p].wh)).sort();
    };
    const sizeOf = p => upper[p] && !upper[p].wh ? upper[p].size : lowerOf(p).files[p];
    const sourceOf = p => upper[p] ? 'upper' : lowerOf(p).id;

    function reset() {
      upper = {}; upperKb = 0; selected = '/app/config.yaml';
      say('Контейнер только запущен: upperdir пуст, всё читается из слоёв образа.');
      render();
    }
    function need() {
      if (!selected || !visible().includes(selected)) { say('Сначала выберите файл в merged.', 'warn'); return false; }
      return true;
    }
    function read() {
      if (!need()) return;
      const src = sourceOf(selected);
      const shadow = selected === '/etc/ssl/openssl.cnf' && src === 'L2' ? ' Версия из L1 перекрыта и не видна.' : '';
      say(`Чтение <code>${selected}</code> — из ${src === 'upper' ? 'upperdir контейнера' : 'слоя ' + src}: самого верхнего, где файл есть. Копирования нет, страницы файла в page cache общие для всех контейнеров этого образа.${shadow}`);
      render();
    }
    function write() {
      if (!need()) return;
      if (upper[selected]) {
        upper[selected].size += 0.1; upperKb += 0.1;
        say(`<code>${selected}</code> уже в upperdir — запись идёт на месте, как в обычной файловой системе.`, 'ok');
      } else {
        const size = lowerOf(selected).files[selected];
        upper[selected] = { size: size + 0.1, from: lowerOf(selected).id };
        upperKb += size + 0.1;
        const big = size > 10000;
        say(`Copy-up: чтобы изменить ${selected === '/opt/geo/cities.db' ? 'одну запись' : 'файл'}, overlayfs сначала скопировал <code>${selected}</code> целиком (${kb(size)}) из ${lowerOf(selected).id} в upperdir.` +
          (big ? ' Базы данных и всё, что часто пишется, держат в томах (<code>-v</code>), а не в слое контейнера.' : ''), big ? 'warn' : '');
      }
      render();
    }
    function del() {
      if (!need()) return;
      const low = lowerOf(selected);
      if (!low) {
        upperKb -= upper[selected].size;
        delete upper[selected];
        say(`<code>${selected}</code> был только в upperdir — просто удалён, место освобождено.`, 'ok');
      } else {
        if (upper[selected]) upperKb -= upper[selected].size;
        upper[selected] = { wh: true };
        say(`В upperdir появился whiteout — символьное устройство 0:0 с именем <code>${selected.split('/').pop()}</code>: «файла нет». Сам файл (${kb(low.files[selected])}) остался в ${low.id}, образ меньше не стал.`, 'warn');
      }
      selected = null;
      render();
    }
    function create() {
      const p = '/tmp/cache.db';
      if (upper[p] && !upper[p].wh) { selected = p; say('Файл уже есть — выберите его и запишите ещё.'); render(); return; }
      upper[p] = { size: 2048 };
      upperKb += 2048;
      selected = p;
      say('Новый файл создаётся сразу в upperdir. Он исчезнет вместе с контейнером при <code>docker rm</code>.');
      render();
    }
    function render() {
      merged.innerHTML = '';
      for (const p of visible()) {
        const src = sourceOf(p);
        merged.append(h('button', { class: 'ov-f' + (p === selected ? ' sel' : ''), onclick: () => { selected = p; render(); } },
          h('span', null, p), h('em', { class: 'src-' + src }, src)));
      }
      const upFiles = Object.entries(upper);
      const fileRow = (p, size, cls, note) => `<div class="ov-r ${cls}"><span>${p}</span><b>${note || kb(size)}</b></div>`;
      layersEl.innerHTML =
        `<div class="ov-layer up"><div class="ov-h">upperdir · контейнер (rw)<span>${kb(Math.max(0, upperKb))}</span></div>${upFiles.length ? upFiles.map(([p, f]) => fileRow(p, f.size, f.wh ? 'wh' : '', f.wh ? 'whiteout c 0:0' : '')).join('') : '<div class="ov-empty">пусто</div>'}</div>` +
        LAYERS.slice().reverse().map((l, ri) => {
          const above = LAYERS.slice(LAYERS.length - ri);
          return `<div class="ov-layer"><div class="ov-h">${l.title}<span>ro</span></div>` +
            Object.entries(l.files).map(([p, s]) => {
              const hidden = upper[p] || above.some(a => p in a.files);
              return fileRow(p, s, hidden ? 'hid' : '');
            }).join('') + '</div>';
        }).join('');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- build cache
  Deck.demo('cache', root => {
    const ORDERS = {
      bad: [
        ['FROM python:3.12-slim', 0, []],
        ['WORKDIR /app', 0.1, []],
        ['COPY . .', 0.4, ['main', 'req']],
        ['RUN pip install -r requirements.txt', 52, [], 210],
      ],
      good: [
        ['FROM python:3.12-slim', 0, []],
        ['WORKDIR /app', 0.1, []],
        ['COPY requirements.txt .', 0.2, ['req']],
        ['RUN pip install -r requirements.txt', 52, [], 210],
        ['COPY . .', 0.4, ['main', 'req']],
      ],
    };
    let order = 'bad', ver = { main: 1, req: 1 }, cache = new Set(), lastRun = null, changed = [];
    const sel = choice([['bad', 'Код, потом зависимости'], ['good', 'Зависимости, потом код']], k => { order = k; lastRun = null; render(); say(k === 'bad' ? 'Порядок «как проще»: весь контекст копируется до установки зависимостей.' : 'Сначала только requirements.txt, затем pip install, и лишь потом код.'); });
    const steps = h('div', { class: 'cb-steps' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl, 2);
    root.append(sel.el,
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: () => edit('main') }, 'Изменить main.py'),
        h('button', { class: 'btn small', onclick: () => edit('req') }, 'Изменить requirements.txt'),
        h('button', { class: 'btn small primary', onclick: build }, h('code', null, 'docker build'))),
      steps, stats, logEl);

    function keys(o) {
      let parent = '';
      return ORDERS[o].map(([ins, , deps]) => (parent = parent + '|' + ins + deps.map(d => d + ver[d]).join(',')));
    }
    function warm() { for (const o of Object.keys(ORDERS)) keys(o).forEach(k => cache.add(k)); }
    function edit(f) {
      ver[f]++;
      changed.push(f === 'main' ? 'main.py' : 'requirements.txt');
      lastRun = null;
      say(`Изменён ${f === 'main' ? '<code>main.py</code> — обычная правка кода' : '<code>requirements.txt</code> — добавили зависимость'}. Нажмите <code>docker build</code>.`);
      render();
    }
    function build() {
      let miss = false;
      lastRun = keys(order).map((k, i) => {
        const hit = !miss && cache.has(k);
        if (!hit) { miss = true; cache.add(k); }
        return hit;
      });
      const st = ORDERS[order];
      const t = st.reduce((s, x, i) => s + (lastRun[i] ? 0 : x[1]), 0);
      const push = st.reduce((s, x, i) => s + (lastRun[i] ? 0 : (x[3] || (x[2].length ? 0.1 : 0))), 0);
      const pipRebuilt = st.some((x, i) => x[3] && !lastRun[i]);
      const what = changed.length ? changed.join(' и ') : 'ничего';
      changed = [];
      if (pipRebuilt) say(`Изменилось: ${what}. ${order === 'bad' ? 'COPY . . промахнулся — и pip install поехал заново, хотя зависимости те же.' : 'Изменились зависимости — переустановка честная.'} Сборка ${dec(t)} с, в registry уйдёт ${fmt(push)} МБ.`, 'warn');
      else say(`Изменилось: ${what}. Всё до последнего COPY — из кэша: сборка ${dec(t)} с, в registry уйдёт ${dec(push)} МБ.`, 'ok');
      render(t, push);
    }
    function render(t, push) {
      const st = ORDERS[order];
      steps.innerHTML = st.map(([ins, sec], i) => {
        const s = lastRun ? (lastRun[i] ? 'hit' : 'miss') : '';
        const tag = lastRun ? (lastRun[i] ? 'CACHED' : (sec ? dec(sec) + ' с' : 'выполнен')) : '';
        return `<div class="cb-s ${s}"><code>${ins}</code><b>${tag}</b></div>`;
      }).join('');
      stats.innerHTML = lastRun
        ? `<div class="stat ${t > 10 ? 'warn' : ''}"><b>${dec(t)} с</b><span>сборка</span></div><div class="stat"><b>${lastRun.filter(Boolean).length} из ${st.length}</b><span>шагов из кэша</span></div><div class="stat ${push > 10 ? 'warn' : ''}"><b>${push > 1 ? fmt(push) : dec(push)} МБ</b><span>новых слоёв в registry</span></div>`
        : `<div class="stat"><b>—</b><span>сборка</span></div><div class="stat"><b>—</b><span>шагов из кэша</span></div><div class="stat"><b>—</b><span>новых слоёв</span></div>`;
    }
    warm();
    sel.pick('bad');
    say('Кэш прогрет прошлой сборкой. Поменяйте файл и соберите.');
    return {};
  });

  // ---------------------------------------------------------------- docker run step by step
  Deck.demo('run', root => {
    const ACTORS = [['cli', 'docker CLI'], ['dockerd', 'dockerd'], ['containerd', 'containerd'], ['shim', 'shim'], ['runc', 'runc'], ['app', 'ваш процесс']];
    const STEPS = [
      ['cli', 'Команда', '$ docker run -d -p 8080:80 nginx\nPOST /containers/create  → unix:///var/run/docker.sock\nPOST /containers/3f9c…/start',
        'CLI — просто HTTP-клиент к демону через Unix-сокет. Кто может писать в <code>docker.sock</code>, тот фактически root на хосте.'],
      ['dockerd', 'Скачать образ', 'GET /v2/library/nginx/manifests/latest\nGET /v2/library/nginx/blobs/sha256:a2318d…  (×7 слоёв)\nAlready exists: sha256:1f7ce2…',
        'Образа нет — pull: манифест со списком слоёв, затем сами слои по sha256, параллельно. Слои, которые уже есть от других образов, не качаются.'],
      ['containerd', 'Распаковать и подготовить бандл', 'snapshots/1..7/fs   ← слои, read-only\nsnapshots/8/fs      ← пустой upperdir контейнера\nbundle/config.json  ← OCI: namespaces, лимиты, capabilities, mounts',
        'Слои распакованы в снапшоты overlayfs. Всё, что нужно для запуска, описано в OCI-бандле — его поймёт любой совместимый рантайм: runc, crun, gVisor, Kata.'],
      ['shim', 'Запустить shim', 'containerd ─┬─ containerd-shim-runc-v2 -id 3f9c…',
        'По одному shim на контейнер. Он станет родителем контейнера, будет держать stdio и ждать код выхода — поэтому контейнеры переживают перезапуск dockerd и containerd.'],
      ['runc', 'Новые namespaces', 'clone(CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWNET |\n      CLONE_NEWUTS | CLONE_NEWIPC | CLONE_NEWCGROUP)\n→ runc init, PID 1 в новом PID-namespace',
        'runc init уже в новых namespaces, но файловая система пока хоста, а привилегии — полные.'],
      ['runc', 'cgroup и лимиты', 'mkdir /sys/fs/cgroup/system.slice/docker-3f9c….scope\necho "200000 100000" > cpu.max\necho 536870912     > memory.max\necho $PID           > cgroup.procs',
        'Процесс переносится в свою cgroup до запуска вашего кода — лимиты действуют с первой инструкции. С драйвером systemd scope создаётся через systemd.'],
      ['dockerd', 'Сеть', 'ip link add veth3a1f type veth peer name eth0\nip link set eth0 netns <контейнер>; ip link set veth3a1f master docker0\niptables -t nat -A DOCKER -p tcp --dport 8080 -j DNAT --to 172.17.0.2:80',
        'Сеть настраивает libnetwork (в Kubernetes — CNI-плагин): veth-пара, адрес 172.17.0.2, правило DNAT для опубликованного порта.'],
      ['runc', 'Корень и pivot_root', 'mount("overlay", rootfs, "overlay", "lowerdir=…,upperdir=…,workdir=…")\nmount proc, /dev (tmpfs), bind /etc/hosts, /etc/resolv.conf\npivot_root(".", ".");  umount2(".", MNT_DETACH)',
        'В новом mount-namespace монтируется склейка слоёв, затем <code>pivot_root</code> делает её корнем, а старый корень отмонтируется. Файлов хоста больше не видно.'],
      ['runc', 'Урезать права', 'sethostname("3f9c2a1b7e44")\ncapset(14 capabilities)   prctl(PR_SET_NO_NEW_PRIVS)\nseccomp(SECCOMP_SET_MODE_FILTER)   AppArmor: docker-default\nsetgid/setuid(USER из образа)',
        'Порядок важен: сначала всё, что требует привилегий, потом их сброс. После seccomp часть системных вызовов вернёт EPERM навсегда — снять фильтр нельзя.'],
      ['app', 'exec', 'execve("/docker-entrypoint.sh", ["nginx", "-g", "daemon off;"])\n\ncontainerd-shim-runc-v2 ─── nginx  (PID 1 внутри)',
        'runc init заменяется вашей программой через <code>execve</code> — это и есть PID 1 контейнера. runc завершается, родителем остаётся shim. Весь путь — порядка 300 мс, и большая часть — демоны, а не ядро.'],
    ];
    let i = 0;
    const actors = h('div', { class: 'rn-actors' }, ACTORS.map(([k, t]) => h('span', { class: 'rn-a', 'data-k': k }, t)));
    const title = h('div', { class: 'rn-title' });
    const code = h('pre', { class: 'code rn-code' }, h('code'));
    const logEl = logBox();
    const prog = h('div', { class: 'rn-prog' }, STEPS.map(() => h('i')));
    const nextBtn = h('button', { class: 'btn primary', onclick: () => go(i + 1) }, 'Дальше');
    const prevBtn = h('button', { class: 'btn', onclick: () => go(i - 1) }, 'Назад');
    root.append(h('div', { class: 'controls' }, prevBtn, nextBtn, h('button', { class: 'btn', onclick: () => go(0) }, 'Сначала')),
      actors, prog, title, code, logEl);
    function go(n) {
      i = Math.max(0, Math.min(STEPS.length - 1, n));
      const [actor, t, c, text] = STEPS[i];
      actors.querySelectorAll('.rn-a').forEach(a => a.classList.toggle('on', a.dataset.k === actor));
      [...prog.children].forEach((p, k) => p.className = k < i ? 'done' : k === i ? 'on' : '');
      title.innerHTML = `<b>${i + 1}/${STEPS.length}</b> ${t}`;
      code.firstChild.textContent = c;
      logEl.innerHTML = text;
      logEl.className = 'log' + (i === STEPS.length - 1 ? ' ok' : '');
      nextBtn.disabled = i === STEPS.length - 1;
      prevBtn.disabled = i === 0;
    }
    go(0);
    return {};
  });

  // ---------------------------------------------------------------- container networking
  Deck.demo('netpath', root => {
    const NODES = [
      ['net', [['client', 'клиент 198.51.100.7'], ['remote', 'api.github.com 140.82.121.4']], 'Интернет'],
      ['host', [['heth', 'eth0 хоста 203.0.113.10'], ['nf', 'netfilter + conntrack'], ['route', 'маршрутизация хоста'], ['br', 'мост docker0 172.17.0.1'], ['vh', 'veth3a1f · конец на хосте']], 'Хост (корневой сетевой namespace)'],
      ['ct', [['ce', 'eth0 172.17.0.2'], ['app', 'nginx, сокет :80']], 'Контейнер web'],
      ['ct2', [['ce2', 'eth0 172.17.0.3 · redis']], 'Контейнер redis'],
    ];
    const IN = 'src 198.51.100.7:51544 → dst 203.0.113.10:8080';
    const IN2 = 'src 198.51.100.7:51544 → dst 172.17.0.2:80';
    const SC = {
      in: ['Входящий на -p 8080:80', [
        ['client', IN, 'Клиент подключается к опубликованному порту хоста.'],
        ['heth', IN, 'Пакет пришёл на eth0 хоста.'],
        ['nf', IN2, 'PREROUTING, цепочка DOCKER: DNAT меняет адрес назначения на адрес контейнера. conntrack запоминает соединение — ответы будут переписаны обратно.', 'ch'],
        ['route', IN2, '172.17.0.2 — в сети 172.17.0.0/16 за docker0. Хост пересылает пакет (<code>ip_forward = 1</code>), цепочка FORWARD пропускает.'],
        ['br', IN2, 'Мост — программный коммутатор: по MAC-адресу из своей таблицы выбирает порт.'],
        ['vh', IN2, 'Порт моста — хостовый конец veth-пары. Что вошло в один конец, выходит из другого.'],
        ['ce', IN2, 'Второй конец — eth0 в namespace контейнера. Пакет теперь в другом сетевом стеке со своими сокетами.'],
        ['app', IN2, 'nginx слушает 0.0.0.0:80 — соединение принято. Ответ пойдёт тем же путём, и conntrack заменит src 172.17.0.2:80 на 203.0.113.10:8080.', 'ok'],
      ]],
      out: ['Исходящий наружу', [
        ['app', 'src 172.17.0.2:43122 → dst 140.82.121.4:443', 'Приложение открывает соединение. Маршрут по умолчанию в контейнере — через шлюз 172.17.0.1.'],
        ['ce', 'src 172.17.0.2:43122 → dst 140.82.121.4:443', 'Кадр уходит в eth0 — то есть в veth.'],
        ['vh', 'src 172.17.0.2:43122 → dst 140.82.121.4:443', 'Выходит из хостового конца veth в мост.'],
        ['br', 'src 172.17.0.2:43122 → dst 140.82.121.4:443', 'Адрес шлюза 172.17.0.1 висит на самом мосту — кадр отдаётся стеку хоста.'],
        ['route', 'src 172.17.0.2:43122 → dst 140.82.121.4:443', 'Хост маршрутизирует пакет наружу через eth0.'],
        ['nf', 'src 203.0.113.10:43122 → dst 140.82.121.4:443', 'POSTROUTING: MASQUERADE подменяет адрес источника адресом хоста — частные 172.17.x в интернете не маршрутизируются.', 'ch'],
        ['heth', 'src 203.0.113.10:43122 → dst 140.82.121.4:443', 'Пакет уходит с eth0 хоста.'],
        ['remote', 'src 203.0.113.10:43122 → dst 140.82.121.4:443', 'Сервер видит адрес хоста, а не контейнера. Ответ conntrack вернёт в контейнер.', 'ok'],
      ]],
      c2c: ['Контейнер → контейнер', [
        ['app', 'src 172.17.0.2:39410 → dst 172.17.0.3:6379', 'web подключается к redis. В своей сети (<code>docker network create</code>) имя <code>redis</code> разрешит встроенный DNS 127.0.0.11; в docker0 по умолчанию — только по IP.'],
        ['ce', 'src 172.17.0.2:39410 → dst 172.17.0.3:6379', 'Адрес в той же подсети — шлюз не нужен, кадр идёт прямо на MAC redis.'],
        ['vh', 'src 172.17.0.2:39410 → dst 172.17.0.3:6379', 'Через veth в мост.'],
        ['br', 'src 172.17.0.2:39410 → dst 172.17.0.3:6379', 'Мост коммутирует кадр в порт второго контейнера. Никакого NAT и маршрутизации.'],
        ['ce2', 'src 172.17.0.2:39410 → dst 172.17.0.3:6379', 'redis получил пакет с настоящим адресом web.', 'ok'],
      ]],
      lo: ['Приложение слушает 127.0.0.1', [
        ['client', IN, 'Тот же входящий запрос, но в контейнере сервер запущен с <code>--host 127.0.0.1</code> — так по умолчанию делают многие dev-серверы.'],
        ['nf', IN2, 'DNAT, как обычно.', 'ch'],
        ['br', IN2, 'Мост, veth…'],
        ['ce', IN2, 'Пакет дошёл до eth0 контейнера.'],
        ['app', IN2, 'На 172.17.0.2:80 никто не слушает: сокет привязан к 127.0.0.1 — а это собственный loopback контейнера, снаружи недоступный. Ядро отвечает RST, клиент видит <code>connection reset</code>. Слушайте 0.0.0.0.', 'bad'],
      ]],
      host: ['--network=host', [
        ['client', IN.replace('8080', '80'), 'Контейнер без своего сетевого namespace: nginx открыл :80 прямо в стеке хоста.'],
        ['heth', IN.replace('8080', '80'), 'Пакет пришёл на eth0 хоста.'],
        ['app', IN.replace('8080', '80'), 'Сразу сокет nginx: ни veth, ни моста, ни NAT. Минимум накладных, но порты общие со всем хостом, и <code>-p</code> не работает.', 'ok'],
      ]],
    };
    let sc = 'in', step = 0;
    const sel = choice(Object.entries(SC).map(([k, v]) => [k, v[0]]), k => { sc = k; step = 0; render(); });
    const diagram = h('div', { class: 'np' });
    const nodeEls = {};
    for (const [g, nodes, title] of NODES) {
      diagram.append(h('div', { class: 'np-g ' + g }, h('span', { class: 'np-gt' }, title),
        h('div', { class: 'np-ns' }, nodes.map(([k, t]) => (nodeEls[k] = h('span', { class: 'np-n' }, t))))));
    }
    const pk = h('div', { class: 'np-pk' });
    const logEl = logBox();
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { step++; render(); } }, 'Шаг');
    root.append(sel.el, h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: () => { step = 0; render(); } }, 'Сначала')), diagram, pk, logEl);
    function render() {
      const steps = SC[sc][1];
      step = Math.min(step, steps.length - 1);
      const [node, hdr, text, kind] = steps[step];
      const seen = new Set(steps.slice(0, step).map(s => s[0]));
      for (const [k, el] of Object.entries(nodeEls)) {
        el.className = 'np-n' + (k === node ? ' on' + (kind === 'bad' ? ' bad' : '') : seen.has(k) ? ' seen' : '');
      }
      diagram.classList.toggle('hostnet', sc === 'host');
      pk.innerHTML = `<span class="label">пакет</span><code class="${kind === 'ch' ? 'ch' : ''}">${hdr}</code>`;
      logEl.innerHTML = `<b>${step + 1}/${steps.length}.</b> ${text}`;
      logEl.className = 'log' + (kind === 'bad' ? ' bad' : kind === 'ok' ? ' ok' : '');
      stepBtn.disabled = step === steps.length - 1;
    }
    sel.pick('in');
    return {};
  });
})();

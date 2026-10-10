// Demos for slides 15–18: container security, trap-and-emulate, nested paging, steal time.
(() => {
  'use strict';
  const { h } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const logBox = () => h('div', { class: 'log', 'aria-live': 'polite' });
  function choice(items, onPick, cls = 'btn small') {
    const btns = items.map(([key, label]) => h('button', { class: cls, onclick: () => pick(key) }, label));
    function pick(key) {
      btns.forEach((b, i) => b.classList.toggle('sel', items[i][0] === key));
      onPick(key);
    }
    return { el: h('div', { class: 'controls' }, btns), pick };
  }

  // ---------------------------------------------------------------- security modes
  Deck.demo('sec', root => {
    // [action, default, cap-drop ALL, privileged, rootless]; each cell: [ok?, reason]. ok: 1 allowed, 0 denied, 2 allowed but dangerous.
    const ROWS = [
      ['chown чужого файла', [1, 'CAP_CHOWN есть'], [0, 'EPERM: нет CAP_CHOWN'], [1, 'можно всё'], [1, 'в пределах своих UID 100000–165535']],
      ['raw-сокет: подделать ARP/IP в сети моста', [2, 'CAP_NET_RAW есть — снимайте её'], [0, 'нет CAP_NET_RAW'], [2, 'да, в любой сети хоста'], [1, 'только в своей изолированной сети']],
      ['mount /dev/sdb1 /mnt', [0, 'нет CAP_SYS_ADMIN, seccomp, AppArmor'], [0, 'нет CAP_SYS_ADMIN'], [2, 'любые диски хоста'], [0, 'блочные ФС нельзя, tmpfs и FUSE — можно']],
      ['загрузить модуль ядра', [0, 'seccomp: init_module'], [0, 'seccomp: init_module'], [2, 'свой код в ядре хоста'], [0, 'CAP_SYS_MODULE в user ns не действует']],
      ['date -s: сменить часы', [0, 'нет CAP_SYS_TIME'], [0, 'нет CAP_SYS_TIME'], [2, 'часы всего сервера'], [0, 'часы не принадлежат namespace']],
      ['читать /dev/sda', [0, 'устройства нет, device cgroup'], [0, 'устройства нет'], [2, 'все устройства хоста видны'], [0, 'устройства нет']],
      ['эксплойт ядра → побег', [2, 'вы root хоста'], [2, 'вы всё ещё UID 0 хоста'], [2, 'эксплойт даже не нужен'], [1, 'вы UID 100000 — никто']],
    ];
    const MODES = [
      ['def', 'по умолчанию', 'Docker по умолчанию: 14 capabilities, seccomp-профиль, AppArmor. Неплохо, но UID 0 внутри — настоящий root, и любая уязвимость ядра делает его root хоста.'],
      ['drop', '--cap-drop=ALL', 'Без capabilities root внутри почти ничего не может сделать с системой. Добавляйте обратно только нужное: <code>--cap-add=NET_BIND_SERVICE</code>. В Kubernetes — <code>securityContext.capabilities.drop: [ALL]</code>.'],
      ['priv', '--privileged', 'Все capabilities, без seccomp и AppArmor, все устройства хоста. <code>mount /dev/sda1 /mnt && chroot /mnt</code> — и вы на хосте. Нужен разве что для Docker-in-Docker; для сборки образов есть BuildKit rootless, kaniko, buildah.'],
      ['root', 'rootless', 'Демон и контейнеры работают от обычного пользователя, UID 0 внутри отображён в UID 100000 снаружи. Capabilities действуют только на объекты своего user namespace. Цена: сеть через slirp4netns/pasta медленнее, порты ниже 1024 нужно разрешать отдельно.'],
    ];
    const table = h('div', { class: 'sc-t' });
    const logEl = logBox();
    const sel = choice(MODES.map(([k, l]) => [k, h('code', null, l)]), k => render(k));
    root.append(sel.el, table, logEl);
    function render(k) {
      const idx = MODES.findIndex(m => m[0] === k);
      table.innerHTML = ROWS.map(r => {
        const [ok, why] = r[idx + 1];
        const cls = ok === 0 ? 'no' : ok === 2 ? 'risk' : 'yes';
        const mark = ok === 0 ? '✕ нельзя' : ok === 2 ? '! можно' : '✓ можно';
        return `<div class="sc-r ${cls}"><span>${r[0]}</span><b>${mark}</b><em>${why}</em></div>`;
      }).join('');
      logEl.innerHTML = MODES[idx][2];
      logEl.className = 'log' + (k === 'priv' ? ' bad' : k === 'def' ? ' warn' : ' ok');
    }
    sel.pick('def');
    return {};
  });

  // ---------------------------------------------------------------- trap-and-emulate
  Deck.demo('trap', root => {
    let ept = true, exits = 0, hvUs = 0, ops = [];
    // [label, exits with EPT, exits without, µs per exit, where handled, text with EPT, text without]
    const OPS = [
      ['calc', '10⁶ инструкций', 0, 0, 0, '',
        'Обычные инструкции — сложение, переходы, обращения к памяти — исполняются процессором напрямую. Скорость как на железе.'],
      ['sys', 'syscall в госте', 0, 0, 0, '',
        'Системный вызов уходит в гостевое ядро — оно в своём кольце 0 режима «гость». Гипервизор не участвует.'],
      ['cpuid', 'cpuid', 1, 1, 1, 'KVM',
        '<code>cpuid</code> всегда вызывает выход: гипервизор решает, какой процессор показать гостю. ~1 мкс вместо ~0,1.'],
      ['cr3', 'смена процесса (CR3)', 0, 1, 1.5, 'KVM',
        'С EPT гость сам переключает свои таблицы страниц — выхода нет.',
        'Без EPT гипервизор ведёт теневые таблицы страниц, и каждая запись в CR3 — выход: надо подменить таблицы на теневые.'],
      ['pf', 'page fault в госте', 0, 1, 2, 'KVM',
        'С EPT гость обрабатывает свой page fault сам. Выход будет, только если хост ещё не выделил физическую страницу под эту память гостя (EPT violation).',
        'Без EPT каждый page fault и каждая правка таблиц гостя ловятся гипервизором, чтобы синхронизировать теневые таблицы. Так ВМ и жили до появления EPT/NPT в 2007–2008 годах — на нагрузках с частыми fork и page fault это стоило десятки процентов.'],
      ['e1000', '32 пакета, эмулируемая e1000', 64, 64, 10, 'QEMU',
        'Гость пишет в регистры «настоящей» сетевой карты — каждое обращение к MMIO выходит в гипервизор, а оттуда в процесс QEMU, который изображает железо. ~2 выхода на пакет по ~10 мкс.'],
      ['virtio', '32 пакета, virtio-net', 1, 1, 2, 'vhost',
        'virtio: гость кладёт описатели пакетов в общее кольцо в памяти и один раз «стучит». Пачку забирает vhost-поток в ядре хоста. 1 выход на 32 пакета.'],
      ['hlt', 'нечего делать (hlt)', 1, 1, 1, 'KVM',
        '<code>hlt</code> — выход, и поток vCPU на хосте засыпает до прерывания. Простаивающая ВМ процессор хоста не ест.'],
    ];
    const tg = h('input', { type: 'checkbox', checked: true });
    tg.addEventListener('change', () => { ept = tg.checked; log.innerHTML = ept ? 'EPT включён — так на всех современных серверах.' : 'EPT выключен: гипервизор ведёт теневые таблицы страниц.'; log.className = 'log' + (ept ? '' : ' warn'); });
    const lanes = h('div', { class: 'tr-lanes' });
    const stats = h('div', { class: 'stats' });
    const log = logBox();
    root.append(
      h('div', { class: 'controls tr-ops' }, OPS.map(o => h('button', { class: 'btn small', onclick: () => run(o) }, o[1]))),
      h('label', { class: 'toggle' }, tg, h('span', null, 'EPT/NPT (аппаратные вложенные таблицы)')),
      lanes, stats, log,
      h('div', { class: 'controls' }, h('button', { class: 'btn small', onclick: reset }, 'Сброс')));
    function run(o) {
      const [, label, ex1, ex0, us, where, t1, t0] = o;
      const n = ept ? ex1 : ex0;
      exits += n; hvUs += n * us;
      ops.push({ label, n, where });
      if (ops.length > 4) ops.shift();
      log.innerHTML = (!ept && t0) ? t0 : t1;
      log.className = 'log' + (n > 10 ? ' warn' : n ? '' : ' ok');
      render();
    }
    function reset() { exits = 0; hvUs = 0; ops = []; log.innerHTML = 'Нажимайте операции гостя.'; log.className = 'log'; render(); }
    function render() {
      lanes.innerHTML = `<div class="tr-row head"><span class="label">гость</span><span class="label">гипервизор</span></div>` +
        (ops.length ? ops.slice().reverse().map((o, i) => `<div class="tr-row ${i ? 'old' : ''}"><span class="tr-op">${o.label}</span>${o.n ? `<span class="tr-exit">${o.n > 1 ? o.n + ' × ' : ''}VM exit → ${o.where}</span>` : '<span class="tr-none">без выхода</span>'}</div>`).join('')
          : '<div class="tr-row"><span class="tr-none">пока ничего</span></div>');
      stats.innerHTML = `<div class="stat ${exits > 50 ? 'warn' : ''}"><b>${fmt(exits)}</b><span>VM exits</span></div>` +
        `<div class="stat"><b>${fmt(hvUs)} мкс</b><span>в гипервизоре</span></div>` +
        `<div class="stat"><b>${ept ? 'EPT' : 'теневые'}</b><span>таблицы страниц</span></div>`;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- 2D page walk
  Deck.demo('ept', root => {
    const SIZES = [['4k', '4 КБ', 4], ['2m', '2 МБ', 3], ['1g', '1 ГБ', 2]];
    const GNAMES = ['PML4', 'PDPT', 'PD', 'PT'];
    let g = 4, hl = 4, timer = 0, cur = -1;
    const gSel = choice(SIZES.map(s => [s[0], s[1]]), k => { g = SIZES.find(s => s[0] === k)[2]; build(); });
    const hSel = choice(SIZES.map(s => [s[0], s[1]]), k => { hl = SIZES.find(s => s[0] === k)[2]; build(); });
    const grid = h('div', { class: 'ep-grid' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const walkBtn = h('button', { class: 'btn primary', onclick: walk }, 'Пройти');
    root.append(
      h('div', { class: 'ep-sel' }, h('span', { class: 'label' }, 'страницы гостя'), gSel.el),
      h('div', { class: 'ep-sel' }, h('span', { class: 'label' }, 'страницы EPT на хосте'), hSel.el),
      h('div', { class: 'controls' }, walkBtn), grid, stats, logEl);
    let cells = [];
    function build() {
      stop();
      cells = [];
      grid.innerHTML = '';
      grid.style.setProperty('--cols', hl + 1);
      grid.append(h('span', { class: 'ep-c head' }), ...Array.from({ length: hl }, (_, j) => h('span', { class: 'ep-c head' }, 'EPT ' + (hl - j))), h('span', { class: 'ep-c head' }, 'чтение'));
      let n = 0;
      for (let r = 0; r <= g; r++) {
        const last = r === g;
        const name = last ? 'данные' : GNAMES[r] + (r === 0 ? ' (CR3)' : '');
        grid.append(h('span', { class: 'ep-c rowh' }, name));
        for (let j = 0; j < hl; j++) { const c = h('span', { class: 'ep-c host' }, ++n); cells.push(c); grid.append(c); }
        const read = h('span', { class: 'ep-c ' + (last ? 'data' : 'guest') }, last ? '✓' : ++n);
        cells.push(read);
        grid.append(read);
      }
      const total = (g + 1) * (hl + 1) - 1;
      stats.innerHTML = `<div class="stat"><b>${g}</b><span>обращений без ВМ</span></div>` +
        `<div class="stat ${total > 15 ? 'warn' : ''}"><b>${total}</b><span>обращений в ВМ</span></div>` +
        `<div class="stat"><b>×${dec(total / g, total % g ? 1 : 0)}</b><span>дороже промах TLB</span></div>`;
      logEl.className = 'log';
      logEl.innerHTML = `Каждая из ${g} гостевых таблиц лежит по гостевому физическому адресу — его переводит обход EPT (${hl} обращения), и только потом читается сама запись. В конце — ещё один обход EPT для адреса данных: (${g}+1)·(${hl}+1)−1 = ${total}.`;
    }
    function walk() {
      stop();
      cells.forEach(c => c.classList.remove('on', 'done'));
      cur = 0;
      timer = setInterval(() => {
        if (cur > 0) cells[cur - 1].classList.replace('on', 'done');
        if (cur >= cells.length) { stop(); finish(); return; }
        cells[cur].classList.add('on');
        cur++;
      }, 140);
    }
    function finish() {
      const total = (g + 1) * (hl + 1) - 1;
      logEl.className = 'log ' + (total > 15 ? 'warn' : 'ok');
      logEl.innerHTML = total > 15
        ? `${total} обращений к памяти на один промах TLB. На деле меньше: промежуточные уровни кэшируются (page walk caches), но базы данных и JVM с большой кучей в ВМ теряют заметно. Лечится большими страницами — и в госте, и на хосте.`
        : `Большие страницы с обеих сторон срезают обход до ${total}. Поэтому гипервизоры отдают память ВМ huge pages, а в госте включают THP или hugetlbfs для баз данных.`;
    }
    function stop() { clearInterval(timer); timer = 0; }
    gSel.pick('4k');
    hSel.pick('4k');
    return { stop };
  });

  // ---------------------------------------------------------------- steal time
  Deck.demo('steal', root => {
    const HOST = 16, VCPU = 4;
    let burst = false;
    const mk = (label, max, val) => {
      const input = h('input', { type: 'range', min: 0, max, value: val, 'aria-label': label });
      const out = h('output');
      input.addEventListener('input', render);
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label st-l' }, label), input, out));
      return { input, out };
    };
    const mine = mk('Ваших vCPU занято', VCPU, 3);
    const neigh = mk('vCPU соседей занято', 40, 8);
    const bt = h('input', { type: 'checkbox' });
    bt.addEventListener('change', () => { burst = bt.checked; render(); });
    root.append(h('label', { class: 'toggle' }, bt, h('span', null, 'burstable-инстанс, кредиты кончились (база 20% на vCPU)')));
    const demand = h('div', { class: 'st-bar' });
    const top = h('pre', { class: 'code st-top' }, h('code'));
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    root.append(demand, top, stats, logEl);
    function render() {
      const m = +mine.input.value, n = +neigh.input.value;
      mine.out.textContent = m; neigh.out.textContent = n;
      const D = m + n;
      let share = D > HOST ? HOST / D : 1;
      const contended = share < 1;
      if (burst) share = Math.min(share, 0.2);
      const busy = m * share / VCPU, st = m * (1 - share) / VCPU, idle = (VCPU - m) / VCPU;
      const scale = Math.max(D, HOST) * 1.05;
      demand.innerHTML = `<span class="me" style="width:${m / scale * 100}%"></span><span class="nb" style="width:${n / scale * 100}%"></span>` +
        `<i style="left:${HOST / scale * 100}%"><em>16 потоков</em></i>`;
      top.firstChild.textContent = `%Cpu(s): ${dec(busy * 90)} us, ${dec(busy * 10)} sy, 0,0 ni, ${dec(idle * 100)} id, 0,0 wa, ${dec(st * 100)} st`;
      const req = m ? 40 / share : 40;
      stats.innerHTML = `<div class="stat"><b>${fmt(share * 100)}%</b><span>времени получает vCPU</span></div>` +
        `<div class="stat ${st > 0.05 ? 'warn' : ''}"><b>${dec(st * 100)}%</b><span>steal (st)</span></div>` +
        `<div class="stat ${req > 60 ? 'warn' : ''}"><b>${fmt(req)} мс</b><span>запрос на 40 мс CPU</span></div>`;
      if (!m) { logEl.className = 'log'; logEl.innerHTML = 'Ваша ВМ простаивает — steal не копится: красть нечего.'; return; }
      if (burst) {
        logEl.className = 'log bad';
        logEl.innerHTML = 'Кредиты кончились: гипервизор отдаёт vCPU не больше 20% времени, остальное — steal. Приложение «вдруг» стало в 5 раз медленнее без единого изменения в коде. Смотрите <code>CPUCreditBalance</code>.';
      } else if (contended) {
        logEl.className = 'log warn';
        logEl.innerHTML = `Соседи и вы хотите ${D} vCPU на ${HOST} потоках хоста. Каждый готовый vCPU работает ${fmt(share * 100)}% времени, остальное ждёт в очереди планировщика хоста — это и есть ${dec(st * 100)}% st. Внутри ВМ это выглядит как «процессор медленный» и рост задержек без роста us.`;
      } else {
        logEl.className = 'log ok';
        logEl.innerHTML = 'Физических потоков хватает всем — steal около нуля. Шумный сосед может мешать и так — через общий кэш L3 и шину памяти, — но этого st не покажет.';
      }
    }
    render();
    return {};
  });
})();

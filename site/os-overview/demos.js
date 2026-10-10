// Demos for slides 2–9: OS jobs, layers, kernel architectures, boot, interrupts, NAPI, device files.
(() => {
  'use strict';
  const { h, rafLoop } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const fmt = n => Math.round(n).toLocaleString('ru-RU');

  function logger(el, keep = 1) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  const legend = items => h('div', { class: 'os-legend' }, items.map(([c, t]) => h('span', null, h('span', { class: 'sw ' + c }), t)));
  // Row of selectable buttons; returns { el, set(i) }.
  function choice(items, onPick, cls = 'btn small') {
    const btns = items.map((t, i) => h('button', { class: cls, onclick: () => onPick(i) }, t));
    return { el: h('div', { class: 'controls' }, btns), set: i => btns.forEach((b, j) => b.classList.toggle('sel', i === j)), btns };
  }
  const html = s => { const t = document.createElement('template'); t.innerHTML = s; return t.content; };
  window.OS = { logger, legend, choice, dec, fmt, html };

  // ---------------------------------------------------------------- three jobs of an OS
  Deck.demo('jobs', root => {
    const RES = [
      { b: 'Процессор',
        abs: 'Процесс и поток: каждому кажется, что у него свой процессор с регистрами и стеком.',
        mux: 'По времени: планировщик раздаёт кванты по несколько миллисекунд и переключает контекст.',
        prot: 'Таймер прерывает любую программу; привилегированные инструкции в кольце 3 запрещены.',
        see: '<code>top</code>, <code>vmstat 1</code>',
        bad: 'while True: pass',
        log: 'Цикл крутится, но таймер каждые несколько миллисекунд возвращает управление ядру, и остальные задачи работают. Машина медленнее, но не висит.' },
      { b: 'Память',
        abs: 'Виртуальное адресное пространство: у каждого процесса свои адреса, до 128 ТБ на x86-64.',
        mux: 'По пространству: физическая память режется на страницы по 4 КБ и раздаётся процессам; не хватило — swap или OOM killer.',
        prot: 'Таблица страниц процесса: чужих страниц в ней просто нет.',
        see: '<code>free -h</code>, <code>/proc/PID/smaps</code>',
        bad: '*(int*)0x7f00dead = 1',
        log: 'Адрес не отображён в таблице страниц процесса → ошибка страницы → ядро шлёт SIGSEGV. Память соседа процесс не видит в принципе.' },
      { b: 'Диск',
        abs: 'Файл и каталог вместо блоков на NVMe и команд контроллера.',
        mux: 'Очереди запросов к устройству и общий кэш страниц для всех процессов.',
        prot: 'Права на файлы и каталоги, ACL, SELinux или AppArmor.',
        see: '<code>iostat -x 1</code>, <code>df -h</code>',
        bad: 'open("/etc/shadow")',
        log: 'Права проверяются при открытии: файл <code>0640 root:shadow</code>, процесс не root и не в группе → <code>EACCES</code>. Читать диск в обход файловой системы тоже нельзя: <code>/dev/nvme0n1</code> доступен только root и группе disk.' },
      { b: 'Сеть',
        abs: 'Сокет: поток байтов (TCP) или датаграммы (UDP) вместо кадров Ethernet.',
        mux: 'Ядро раскладывает входящие пакеты по сокетам по адресам и портам, исходящие — в очереди карты.',
        prot: 'Чужой сокет не прочитать; порты ниже 1024 — только с <code>CAP_NET_BIND_SERVICE</code>.',
        see: '<code>ss -tunap</code>',
        bad: 'bind(("", 80))',
        log: '<code>EACCES</code>: порты ниже 1024 привилегированные. Дайте сервису capability или слушайте 8080 за прокси.' },
      { b: 'Устройства',
        abs: 'Узлы в <code>/dev</code> и драйверы: клавиатура, GPU, USB открываются как файлы.',
        mux: 'Драйвер упорядочивает доступ; экран делит композитор, звук — звуковой сервер.',
        prot: 'Права на узлы <code>/dev</code>; порты ввода-вывода и DMA — только у ядра, IOMMU ограничивает DMA устройств.',
        see: '<code>lspci</code>, <code>lsusb</code>, <code>ls -l /dev</code>',
        bad: 'outb(0x60, x)',
        log: 'Инструкция ввода-вывода в кольце 3 вызывает исключение общей защиты, ядро шлёт SIGSEGV. До железа программа достаёт только через драйвер.' },
    ];
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const cards = h('div', { class: 'jb-cards' });
    const badBtn = h('button', { class: 'btn small danger', onclick: () => say(cur.log, 'bad') });
    let cur;
    const pick = choice(RES.map(r => r.b), i => show(i));
    root.append(h('span', { class: 'label' }, 'Ресурс'), pick.el, cards, h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Плохая программа:'), badBtn), logEl);
    function show(i) {
      cur = RES[i];
      pick.set(i);
      cards.innerHTML = '';
      [['Абстракция', cur.abs, 'a'], ['Мультиплексирование', cur.mux, 'm'], ['Защита', cur.prot, 'p']].forEach(([t, x, c]) =>
        cards.append(h('div', { class: 'jb-card jb-' + c }, h('b', null, t), h('span', { html: x }))));
      badBtn.replaceChildren(h('code', null, cur.bad));
      say('Посмотреть у себя: ' + cur.see);
    }
    show(0);
    return {};
  });

  // ---------------------------------------------------------------- layers
  Deck.demo('layers', root => {
    const OSES = ['Linux', 'macOS', 'Windows'];
    const L = [
      { k: 'app', name: 'Приложения', ring: 'кольцо 3', os: [
        ['python3, node, java, ваш сервис', 'Каждое в своём адресном пространстве. О ядре знают только через библиотеки и системные вызовы.'],
        ['.app-бандлы, Terminal, ваш процесс', 'Каждое в своём адресном пространстве, многие — в песочнице: доступ к папкам и камере выдаёт TCC.'],
        ['.exe: ваш сервис, explorer.exe, python.exe', 'Каждое в своём адресном пространстве. Консольные программы живут в conhost.exe или Windows Terminal.']] },
      { k: 'svc', name: 'Системные сервисы', ring: 'кольцо 3', os: [
        ['systemd (PID 1), journald, udevd, NetworkManager, sshd, dockerd', 'Обычные процессы с особыми правами: запускают остальных, ведут журнал, создают узлы /dev, настраивают сеть. Упал сервис — его перезапустят, ядро живо.'],
        ['launchd (PID 1), WindowServer, mDNSResponder, configd', 'launchd совмещает init, cron и inetd: запускает демоны по plist-файлам из /Library/LaunchDaemons, в том числе по первому подключению.'],
        ['smss, csrss, wininit, services.exe → svchost.exe, lsass.exe', 'Службы управляются Service Control Manager (services.exe), многие живут пачками в svchost.exe. lsass проверяет пароли и выдаёт токены доступа.']] },
      { k: 'lib', name: 'Системные библиотеки', ring: 'кольцо 3', os: [
        ['glibc или musl, ld-linux.so', 'Стабилен сам системный вызов, libc можно обойти: Go собирает статические бинарники. Alpine с musl — не Debian с glibc: другие колёса Python (musllinux) и другой резолвер DNS.'],
        ['libSystem.dylib (libc, libdispatch, libsystem_kernel), dyld', 'Единственный поддерживаемый путь в ядро. Статические бинарники macOS не поддерживает, Go с версии 1.12 вызывает libSystem.'],
        ['kernel32.dll, kernelbase.dll (Win32) → ntdll.dll', 'Программы зовут Win32: CreateFileW → NtCreateFile в ntdll → системный вызов. Номера вызовов меняются от сборки к сборке, стабилен только Win32.']] },
      { k: 'kern', name: 'Ядро', ring: 'кольцо 0', os: [
        ['Linux: монолит + модули .ko', 'Планировщик, память, VFS, сеть, драйверы — один большой бинарник плюс сотни загружаемых модулей. <code>lsmod</code> покажет, какие загружены.'],
        ['XNU: Mach + BSD + IOKit', 'Mach — задачи, потоки, память и IPC; BSD — процессы, файлы, сокеты, права; IOKit — драйверы на C++. Новые драйверы Apple выносит в user space (DriverKit).'],
        ['ntoskrnl.exe + HAL + драйверы .sys', 'Исполнительная система NT: диспетчеры объектов, процессов, памяти и ввода-вывода. Графика и окна — в win32k.sys, тоже в ядре. Драйвер с ошибкой — синий экран.']] },
      { k: 'fw', name: 'Прошивка', ring: 'до ОС', os: [
        ['UEFI (или BIOS), ACPI, микрокод процессора', 'Инициализирует железо, грузит загрузчик с раздела EFI, отдаёт ядру таблицы ACPI: какие устройства есть и как управлять питанием. Микрокод чинит ошибки процессора, ядро обновляет его при загрузке.'],
        ['Boot ROM → iBoot (Apple Silicon) или UEFI (Intel)', 'Цепочка доверия: каждый этап проверяет подпись следующего, вплоть до ядра.'],
        ['UEFI + Secure Boot', 'Secure Boot пускает только подписанный загрузчик Windows Boot Manager; дальше подписи проверяет он сам.']] },
      { k: 'hw', name: 'Железо', ring: 'железо', os: [
        ['CPU, RAM, NVMe, сетевая карта, GPU, USB', 'Говорит регистрами, прерываниями и DMA. Защиту обеспечивает сам процессор: кольца, MMU, IOMMU.'],
        ['SoC Apple: CPU, GPU, Neural Engine, SSD-контроллер', 'Те же механизмы: исключения, MMU, IOMMU (DART у Apple) — ОС на них опирается.'],
        ['CPU, RAM, NVMe, сетевая карта, GPU, USB', 'Те же кольца, MMU и IOMMU. Hyper-V с VBS ставит ещё один уровень ниже ядра.']] },
    ];
    let os = 0, layer = 3;
    const tabs = choice(OSES, i => { os = i; render(); });
    const stackEl = h('div', { class: 'ly-stack' });
    const card = h('div', { class: 'ly-card' });
    root.append(tabs.el, stackEl, card);
    const rows = L.map((l, i) => {
      const b = h('button', { class: 'ly-row ly-' + l.k, onclick: () => { layer = i; render(); } },
        h('span', { class: 'ly-ring' }, l.ring), h('b', null, l.name), h('span', { class: 'ly-what' }));
      return b;
    });
    rows.forEach((r, i) => {
      stackEl.append(r);
      if (L[i].k === 'lib') stackEl.append(h('div', { class: 'ly-gate' }, h('span', null, 'граница: системный вызов')));
    });
    function render() {
      tabs.set(os);
      rows.forEach((r, i) => {
        r.classList.toggle('on', i === layer);
        r.querySelector('.ly-what').textContent = L[i].os[os][0];
      });
      const l = L[layer], [what, note] = l.os[os];
      card.replaceChildren(h('b', null, `${l.name} · ${OSES[os]}`), h('code', { class: 'ly-code' }, what), h('p', { html: note }));
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- kernel architectures
  Deck.demo('kernarch', root => {
    // Components: where they live (u = user space, k = kernel space).
    const ARCH = [
      { b: 'Монолит · Linux', user: [['app', 'приложение']],
        kern: [['sched', 'планировщик'], ['mm', 'память'], ['ipc', 'IPC'], ['fs', 'VFS + ext4'], ['net', 'TCP/IP'], ['drv', 'драйвер NVMe', 'mod']],
        read: ['app', 'fs', 'drv', 'fs', 'app'], sw: 2, msgs: 0,
        readLog: 'Один системный вызов: приложение → VFS → ext4 → блочный слой → драйвер NVMe и обратно. Внутри ядра это обычные вызовы функций: 2 перехода режима, никаких сообщений.',
        crash: 'Драйвер — это код ядра с полными правами. Ошибка в нём — oops или kernel panic: в лучшем случае ядро убьёт текущий процесс и пометит себя «tainted», в худшем — перезагрузка всей машины.',
        crashAll: true,
        upd: 'Модуль выгружается и загружается без перезагрузки: <code>modprobe -r nvme; modprobe nvme</code>, если устройство не занято. Но модуль собран под конкретную версию ядра — поэтому после обновления ядра DKMS пересобирает драйверы NVIDIA и VirtualBox.' },
      { b: 'Микроядро · seL4, QNX', user: [['app', 'приложение'], ['fs', 'сервер ФС'], ['net', 'сервер сети'], ['drv', 'драйвер NVMe']],
        kern: [['sched', 'планировщик'], ['mm', 'адр. пространства'], ['ipc', 'IPC']],
        read: ['app', 'ipc', 'fs', 'ipc', 'drv', 'ipc', 'fs', 'ipc', 'app'], sw: 8, msgs: 4,
        readLog: 'Приложение шлёт сообщение серверу ФС, тот — драйверу диска, ответы идут обратно: 4 сообщения, каждое — вход в ядро и смена адресного пространства. Быстрое IPC стоит сотни наносекунд, но на каждом запросе это лишние микросекунды.',
        crash: 'Упал процесс драйвера — и только он. Ядро и остальные серверы живы, менеджер перезапускает драйвер, запрос в худшем случае вернёт ошибку. Поэтому QNX стоит в автомобилях и медицинской технике.',
        crashAll: false,
        upd: 'Остановить процесс драйвера и запустить новую версию — как обновить обычную программу. Ядро не трогаем.' },
      { b: 'Гибрид · XNU', user: [['app', 'приложение'], ['dext', 'DriverKit', 'opt']],
        kern: [['sched', 'Mach: потоки'], ['mm', 'Mach: память'], ['ipc', 'Mach IPC'], ['fs', 'BSD: VFS + APFS'], ['net', 'BSD: сокеты'], ['drv', 'IOKit: NVMe', 'mod']],
        read: ['app', 'fs', 'drv', 'fs', 'app'], sw: 2, msgs: 0,
        readLog: 'Mach задумывался как микроядро, но в XNU слой BSD живёт с ним в одном адресном пространстве. <code>read()</code> идёт как в монолите: BSD → APFS → IOKit, 2 перехода режима. Mach-сообщения используются между процессами, например в XPC.',
        crash: 'Расширение ядра (kext) падает вместе с ядром — kernel panic и перезагрузка. Поэтому Apple с macOS 10.15 переводит драйверы в DriverKit: dext — процесс, его падение не трогает ядро.',
        crashAll: true,
        upd: 'kext требует разрешения в настройках безопасности и перезагрузки. dext ставится и обновляется вместе с приложением.' },
      { b: 'Гибрид · Windows NT', user: [['app', 'приложение'], ['csrss', 'csrss, службы']],
        kern: [['sched', 'планировщик'], ['mm', 'память'], ['ipc', 'ALPC'], ['fs', 'I/O manager + NTFS'], ['net', 'TCP/IP'], ['drv', 'stornvme.sys', 'mod'], ['gui', 'win32k.sys']],
        read: ['app', 'fs', 'drv', 'fs', 'app'], sw: 2, msgs: 0,
        readLog: '<code>ReadFile</code> → <code>NtReadFile</code> → диспетчер ввода-вывода создаёт IRP и проводит его по стеку драйверов: фильтры (антивирус), NTFS, драйвер диска. Всё в режиме ядра, 2 перехода режима.',
        crash: 'Драйвер .sys работает в режиме ядра: ошибка — синий экран. 19 июля 2024 года обновление драйвера CrowdStrike Falcon уронило так 8,5 млн машин. Графику Microsoft в NT 4.0 перенесла в ядро ради скорости — с тех пор и её ошибки дают BSOD.',
        crashAll: true,
        upd: 'Драйвер ставится через PnP-менеджер, часто с перезагрузкой. В ядро 64-битной Windows пускают только драйверы, подписанные Microsoft.' },
    ];
    let a = 0, timers = [];
    const pick = choice(ARCH.map(x => x.b), i => { a = i; draw(); say('Выберите действие.'); });
    const zoneU = h('div', { class: 'ka-zone ka-u' }, h('span', { class: 'ka-zl' }, 'режим пользователя'), h('div', { class: 'ka-chips' }));
    const zoneK = h('div', { class: 'ka-zone ka-k' }, h('span', { class: 'ka-zl' }, 'режим ядра'), h('div', { class: 'ka-chips' }));
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const acts = h('div', { class: 'controls' },
      h('button', { class: 'btn small primary', onclick: read }, 'Прочитать файл'),
      h('button', { class: 'btn small danger', onclick: crash }, 'Ошибка в драйвере'),
      h('button', { class: 'btn small', onclick: () => { reset(); say(ARCH[a].upd); } }, 'Обновить драйвер'));
    root.append(pick.el, h('div', { class: 'ka-diag' }, zoneU, zoneK), acts, stats, logEl);
    const chipEls = {};
    function draw() {
      timers.forEach(clearTimeout);
      pick.set(a);
      const x = ARCH[a];
      for (const k in chipEls) delete chipEls[k];
      for (const [zone, list] of [[zoneU, x.user], [zoneK, x.kern]]) {
        const box = zone.querySelector('.ka-chips');
        box.innerHTML = '';
        list.forEach(([id, t, f]) => { box.append(chipEls[id] = h('span', { class: 'ka-chip' + (f ? ' ka-' + f : '') }, t)); });
      }
      zoneK.classList.remove('dead');
      setStats('—', '—');
    }
    function setStats(sw, msgs) {
      stats.innerHTML = '';
      stats.append(h('div', { class: 'stat' }, h('b', null, sw), h('span', null, 'переходов в ядро и обратно')),
        h('div', { class: 'stat' }, h('b', null, msgs), h('span', null, 'IPC-сообщений')),
        h('div', { class: 'stat' }, h('b', null, String(ARCH[a].kern.length)), h('span', null, 'компонентов в ядре')));
    }
    function reset() {
      timers.forEach(clearTimeout); timers = [];
      Object.values(chipEls).forEach(c => c.classList.remove('hot', 'dead'));
      zoneK.classList.remove('dead');
    }
    function read() {
      reset();
      const x = ARCH[a];
      x.read.forEach((id, i) => timers.push(setTimeout(() => {
        Object.values(chipEls).forEach(c => c.classList.remove('hot'));
        chipEls[id] && chipEls[id].classList.add('hot');
      }, i * 380)));
      timers.push(setTimeout(() => Object.values(chipEls).forEach(c => c.classList.remove('hot')), x.read.length * 380 + 200));
      setStats(String(x.sw), String(x.msgs));
      say(x.readLog, x.msgs ? 'warn' : '');
    }
    function crash() {
      reset();
      const x = ARCH[a];
      chipEls.drv.classList.add('dead');
      setStats('—', '—');
      if (x.crashAll) zoneK.classList.add('dead');
      say(x.crash, x.crashAll ? 'bad' : 'ok');
    }
    draw();
    say('Выберите действие.');
    return { stop: reset };
  });

  // ---------------------------------------------------------------- boot
  Deck.demo('boot', root => {
    const STAGES = [
      ['fw', 'UEFI', 'firmware', 'Самотестирование (POST), инициализация памяти и шин, опрос устройств. Из NVRAM прошивка берёт порядок загрузки и запускает EFI-файл с раздела ESP (FAT32). Secure Boot проверяет его подпись.'],
      ['ld', 'Загрузчик', 'loader', 'GRUB или systemd-boot показывает меню, читает в память <code>vmlinuz</code> и <code>initramfs</code> и передаёт ядру командную строку: <code>root=…</code>, <code>quiet</code>. На Mac этот этап — iBoot, у Windows — <code>bootmgfw.efi</code> → <code>winload.efi</code>.'],
      ['kn', 'Ядро', 'kernel', 'Ядро распаковывается, строит таблицы страниц и прерываний, будит остальные ядра процессора, запускает встроенные драйверы. Затем монтирует initramfs как корень и запускает из него <code>/init</code>.'],
      ['ir', 'initramfs', 'initrd', 'Маленькая файловая система в памяти. Её задача — достать настоящий корень: загрузить модули NVMe, RAID или LVM, спросить пароль LUKS, смонтировать диск и сделать <code>switch_root</code>.'],
      ['sd', 'systemd (PID 1)', 'userspace', 'Первый процесс пользовательского пространства. Читает юниты, строит граф зависимостей и запускает всё, что можно, параллельно. Если PID 1 завершится, ядро паникует.'],
      ['sv', 'Сервисы', 'userspace', 'udevd создаёт узлы <code>/dev</code> и грузит модули под найденные устройства; дальше journald, сеть, sshd, docker, ваше приложение. Здесь же самые частые тормоза: ожидание сети, монтирование NFS.'],
      ['lg', 'Вход', 'userspace', 'Достигнута цель <code>multi-user.target</code> или <code>graphical.target</code>: getty, sshd, экран входа. До этого момента и считает <code>systemd-analyze</code>.'],
    ];
    const M = [
      { b: 'Ноутбук', t: [4.2, 1.1, 1.4, 2.1, 0.3, 4.6, 0.9], blame: [['NetworkManager-wait-online.service', 4.1], ['docker.service', 1.9], ['plymouth-quit-wait.service', 1.4], ['snapd.service', 1.2]],
        note: 'Ожидание сети — частый лидер <code>blame</code>, хотя графический вход его не ждёт. <code>blame</code> показывает длительность, но не то, что задержало загрузку: сервисы стартуют параллельно. Для этого — <code>critical-chain</code>.' },
      { b: 'Сервер', t: [52, 5.2, 2.8, 3.9, 0.4, 8.6, 0.6], blame: [['mdmonitor.service', 6.0], ['systemd-udev-settle.service', 5.1], ['network-online.target', 3.8], ['postgresql.service', 2.2]],
        note: 'На сервере половину минуты съедает прошивка: тренировка сотен гигабайт памяти, ROM RAID-контроллеров и сетевых карт. Перезагрузка железного сервера — минуты, планируйте это в окнах обслуживания.' },
      { b: 'Облачная ВМ', t: [0.4, 0.3, 0.9, 0.8, 0.2, 2.6, 0.3], blame: [['cloud-init.service', 1.9], ['cloud-config.service', 0.7], ['systemd-networkd-wait-online.service', 0.6], ['ssh.service', 0.2]],
        note: 'Виртуальной прошивке нечего тренировать. Основное время — cloud-init: ключи SSH, сеть, пользовательские скрипты. Firecracker в AWS Lambda пропускает прошивку и загрузчик совсем и стартует ядро за ~125 мс.' },
    ];
    let m = 0, pos = 0;
    const pick = choice(M.map(x => x.b), i => { m = i; pos = 0; render(); });
    const bar = h('div', { class: 'bt-bar' });
    const steps = h('ol', { class: 'bt-steps' });
    const term = h('pre', { class: 'code bt-term' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { if (pos < STAGES.length) { pos++; render(); } } }, 'Шаг');
    root.append(pick.el, bar, steps, h('div', { class: 'controls' }, stepBtn,
      h('button', { class: 'btn', onclick: () => { pos = STAGES.length; render(); } }, 'До конца'),
      h('button', { class: 'btn', onclick: () => { pos = 0; render(); } }, 'Сначала')), term, logEl);
    const s1 = n => n.toFixed(1) + 's';
    function render() {
      pick.set(m);
      const x = M[m], total = x.t.reduce((a, b) => a + b, 0);
      bar.innerHTML = ''; steps.innerHTML = '';
      STAGES.forEach(([k, name], i) => {
        const seg = h('span', { class: 'bt-seg bt-' + k + (i < pos ? ' on' : ''), style: `flex-grow:${x.t[i]}`, title: name });
        bar.append(seg);
        steps.append(h('li', { class: i < pos ? 'on' : '' }, h('span', { class: 'sw bt-' + k }), h('span', null, name), h('b', null, dec(x.t[i], x.t[i] >= 10 ? 0 : 1) + ' с')));
      });
      stepBtn.disabled = pos >= STAGES.length;
      const sum = key => x.t.filter((_, i) => STAGES[i][2] === key).reduce((a, b) => a + b, 0);
      if (pos === 0) {
        term.textContent = '$ systemd-analyze\n…машина выключена';
        say('Нажмите «Шаг»: кнопка питания.');
      } else if (pos < STAGES.length) {
        const done = x.t.slice(0, pos).reduce((a, b) => a + b, 0);
        term.textContent = `$ systemd-analyze\n…загрузка идёт: ${dec(done)} с от кнопки питания`;
        const st = STAGES[pos - 1];
        say(`<b>${st[1]}</b> — ${dec(x.t[pos - 1])} с. ${st[3]}`);
      } else {
        const parts = ['firmware', 'loader', 'kernel', 'initrd', 'userspace'].map(k => `${s1(sum(k))} (${k})`);
        term.textContent = `$ systemd-analyze\nStartup finished in ${parts[0]}\n  + ${parts.slice(1, 3).join(' + ')}\n  + ${parts.slice(3).join(' + ')}\n  = ${s1(total)}\n\n$ systemd-analyze blame | head -4\n` +
          x.blame.map(([n, t]) => `${s1(t).padStart(6)} ${n}`).join('\n');
        say(`Итого ${dec(total)} с. ${x.note}`);
      }
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- interrupt journey
  Deck.demo('irq', root => {
    const LANES = [['dev', 'устройство'], ['top', 'прерывание'], ['bh', 'softirq'], ['sch', 'планировщик'], ['proc', 'процесс']];
    const SC = [
      { b: 'Сетевой пакет', steps: [
        ['dev', '0 мкс', 'пакет записан DMA', 'Пакет пришёл в сетевую карту. Карта сама пишет его через DMA в кольцевой буфер в памяти, заранее подготовленный драйвером. Процессор пока ни при чём.'],
        ['dev', '+1 мкс', 'MSI-X → ядро 3', 'Карта поднимает прерывание MSI-X: запись по особому адресу, которую контроллер прерываний (APIC) доставляет выбранному ядру процессора.'],
        ['top', '+2 мкс', 'верхняя половина', 'Ядро процессора бросает текущий код — чей-то цикл на Python, — сохраняет регистры и по таблице прерываний прыгает в обработчик драйвера. Тот выключает прерывания этой очереди и планирует NAPI-опрос. Около микросекунды.'],
        ['bh', '+3 мкс', 'NET_RX: драйвер → IP → TCP', 'Нижняя половина, softirq NET_RX, — сразу на выходе из прерывания. Драйвер забирает из кольца до 64 пакетов, оборачивает в <code>sk_buff</code> и отдаёт стеку: IP → TCP → поиск сокета по адресам и портам.'],
        ['bh', '+8 мкс', 'в очередь сокета', 'Данные легли в очередь приёма сокета, TCP отправит подтверждение. Очередь полна — пакет отброшен, отправитель повторит. Пакеты кончились — NAPI снова включает прерывания.'],
        ['sch', '+10 мкс', 'разбудить процесс', 'Процесс спал в <code>epoll_wait</code> на этом сокете. Ядро помечает его готовым и ставит в очередь планировщика.'],
        ['proc', '+25 мкс', 'recv() копирует данные', 'Процесс получил процессор, <code>epoll_wait</code> вернулся, <code>recv()</code> копирует байты из буфера ядра в память процесса. От провода до вашего кода — десятки микросекунд.'],
      ] },
      { b: 'Нажатие клавиши', steps: [
        ['dev', '0 мс', 'клавиша нажата', 'Контроллер клавиатуры сканирует матрицу и ждёт: USB-устройства сами не говорят, хост опрашивает их раз в 1–8 мс.'],
        ['dev', '+4 мс', 'xHCI: DMA + прерывание', 'Контроллер USB (xHCI) забрал отчёт HID, записал его через DMA в память и поднял прерывание.'],
        ['top', '+4 мс', 'верхняя половина', 'Обработчик xHCI подтверждает событие и откладывает разбор.'],
        ['bh', '+4 мс', 'usbhid → input → evdev', 'Драйвер usbhid разбирает отчёт: «нажата клавиша 30». Подсистема input делает из него событие и кладёт в очередь файла <code>/dev/input/event3</code>.'],
        ['sch', '+4 мс', 'разбудить композитор', 'Композитор (Wayland) спал в <code>epoll_wait</code> на этом файле — ядро делает его готовым.'],
        ['proc', '+5 мс', 'композитор → окно', 'Композитор читает событие и пересылает окну в фокусе через Unix-сокет. Это ещё одно пробуждение — уже процесса терминала.'],
        ['proc', '+20 мс', 'буква на экране', 'Терминал рисует букву, композитор выводит кадр на ближайшем обновлении экрана. Всего 10–30 мс, и большую часть съели опрос USB и отрисовка, а не ядро.'],
      ] },
      { b: 'Тик таймера', steps: [
        ['proc', '0 мс', 'while True: pass', 'Процесс крутит бесконечный цикл и сам процессор не отдаст никогда.'],
        ['dev', '+4 мс', 'APIC-таймер', 'Локальный таймер этого ядра сработал: прошло 4 мс при HZ=250 — или наступил срок ближайшего таймера, если ядро tickless.'],
        ['top', '+4 мс', 'учёт времени', 'Обработчик таймера обновляет часы и засчитывает текущей задаче потраченное время.'],
        ['top', '+4 мс', 'флаг need_resched', 'Планировщик видит: задача выбрала свою долю, а другие ждут. Он ставит флаг «перепланировать» — пока только флаг.'],
        ['bh', '+4 мс', 'просроченные таймеры', 'Заодно срабатывают истёкшие таймеры: кто спал в <code>sleep()</code> или ждал таймаута, становится готовым.'],
        ['sch', '+4 мс', 'schedule()', 'На выходе из прерывания ядро видит флаг и вызывает <code>schedule()</code>: регистры цикла сохраняются, загружаются регистры другой задачи.'],
        ['proc', '+4 мс', 'работает другая задача', 'Цикл продолжится позже с той же инструкции и ничего не заметит. Без таймера процессор не отнять — так жили Windows 3.1 и Mac OS 9 с кооперативной многозадачностью.'],
      ] },
    ];
    let sc = 0, pos = 0;
    const pick = choice(SC.map(x => x.b), i => { sc = i; pos = 0; render(); });
    const lanes = h('div', { class: 'iq-lanes' }, LANES.map(([k, t]) => h('div', { class: 'iq-lane iq-' + k }, h('span', null, t))));
    const list = h('ol', { class: 'iq-list' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { if (pos < SC[sc].steps.length) { pos++; render(); } } }, 'Шаг');
    root.append(pick.el, lanes, list, h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: () => { pos = 0; render(); } }, 'Сначала')), logEl);
    function render() {
      pick.set(sc);
      const st = SC[sc].steps;
      stepBtn.disabled = pos >= st.length;
      const curLane = pos ? st[pos - 1][0] : null;
      [...lanes.children].forEach((el, i) => el.classList.toggle('on', LANES[i][0] === curLane));
      list.innerHTML = '';
      st.forEach(([lane, t, short], i) => {
        const laneName = LANES.find(l => l[0] === lane)[1];
        list.append(h('li', { class: (i < pos ? 'on' : '') + (i === pos - 1 ? ' cur' : '') },
          h('span', { class: 'iq-t' }, t), h('span', { class: 'iq-chip iq-' + lane }, laneName), h('span', null, i < pos ? short : '…')));
      });
      say(pos ? st[pos - 1][3] : 'Нажмите «Шаг».');
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- NAPI vs interrupt storm
  Deck.demo('napi', root => {
    // Per-core cost model (µs): interrupt entry/exit+handler, kernel stack per packet, app per packet.
    const C_IRQ = 1.0, C_STACK = 0.7, C_APP = 1.5, WINDOW = 30;
    const RATES = [1e3, 1e4, 5e4, 1e5, 2e5, 4e5, 6e5, 8e5, 1e6, 1.5e6, 2e6, 3e6];
    let ri = 4, napi = false, q = 1;
    const out = h('output');
    const slider = h('input', { type: 'range', min: 0, max: RATES.length - 1, step: 1, value: ri, 'aria-label': 'Пакетов в секунду', oninput: e => { ri = +e.target.value; render(); } });
    const napiT = h('input', { type: 'checkbox', onchange: e => { napi = e.target.checked; render(); } });
    const qs = choice(['1', '2', '4', '8'], i => { q = [1, 2, 4, 8][i]; render(); });
    const bars = h('div', { class: 'np-bars' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('label', { class: 'slider' }, h('span', { class: 'label' }, 'Входящий поток, пакетов в секунду: ', out), slider),
      h('div', { class: 'controls' }, h('label', { class: 'toggle' }, napiT, 'NAPI'), h('span', { class: 'label' }, 'очередей RSS:'), ...qs.btns),
      legend([['np-hi', 'hi — прерывания'], ['np-si', 'si — softirq'], ['np-us', 'приложение'], ['np-id', 'простой']]),
      bars, stats, logEl);
    function core(p) {
      const irqs = napi ? p / (1 + p * WINDOW * 1e-6) : p;
      const hi = irqs * C_IRQ * 1e-6;
      const si = p * C_STACK * (napi ? 0.85 : 1) * 1e-6;
      const dk = hi + si, da = p * C_APP * 1e-6;
      let k, ap, processed, livelock = false;
      if (dk + da <= 1) { k = dk; ap = da; processed = p; }
      else if (!napi) {
        // Interrupts preempt everything: the kernel takes what it needs, the app gets the rest.
        k = Math.min(1, dk); processed = p * k / dk; ap = Math.max(0, 1 - k); livelock = ap < 0.02;
      } else {
        // Softirq work moves to ksoftirqd and competes fairly with the app thread.
        k = Math.min(dk, Math.max(0.5, 1 - da)); processed = p * k / dk; ap = Math.min(da, 1 - k);
      }
      const delivered = Math.min(processed, ap / (C_APP * 1e-6));
      const f = dk ? k / dk : 0;
      return { irqs, hi: hi * f, si: si * f, ap, delivered, livelock };
    }
    function render() {
      const P = RATES[ri];
      out.textContent = fmt(P);
      qs.set([1, 2, 4, 8].indexOf(q));
      const c = core(P / q);
      bars.innerHTML = '';
      for (let i = 0; i < 8; i++) {
        const used = i < q;
        const seg = (cls, v) => h('span', { class: cls, style: `width:${(v * 100).toFixed(1)}%` });
        bars.append(h('div', { class: 'np-core' + (used ? '' : ' idle') }, h('span', { class: 'np-n' }, 'cpu' + i),
          h('div', { class: 'np-track' }, used ? [seg('np-hi', c.hi), seg('np-si', c.si), seg('np-us', c.ap)] : [])));
      }
      const del = c.delivered * q, lost = Math.max(0, P - del);
      stats.innerHTML = '';
      stats.append(h('div', { class: 'stat' }, h('b', null, fmt(c.irqs * q)), h('span', null, 'прерываний/с')),
        h('div', { class: 'stat' }, h('b', null, fmt(del)), h('span', null, 'дошло до приложения/с')),
        h('div', { class: 'stat' + (lost > P * 0.005 ? ' warn' : '') }, h('b', null, lost > P * 0.005 ? Math.round(lost / P * 100) + '%' : '0'), h('span', null, 'пакетов потеряно')));
      let msg;
      if (c.livelock) msg = ['<b>Livelock.</b> Ядро процессора целиком занято прерываниями и стеком, приложение не получает ни такта: пакеты принимаются и выбрасываются из переполненного буфера сокета. Машина «жива», но полезной работы ноль.', 'bad'];
      else if (lost > P * 0.005 && !napi) msg = ['Прерывания вытесняют приложение: чем больше пакетов, тем меньше процессора остаётся тем, кто их читает. Включите NAPI или добавьте очередей.', 'warn'];
      else if (lost > P * 0.005) msg = ['NAPI держит прерывания на минимуме, а избыток softirq уходит в поток <code>ksoftirqd</code>, который делит ядро с приложением честно. Потери есть, но приложение работает. Дальше — больше очередей RSS, то есть ядер.', 'warn'];
      else if (napi && P >= 1e5) msg = [`Под нагрузкой NAPI переходит на опрос: одно прерывание на пачку пакетов — ${fmt(c.irqs * q)} в секунду вместо ${fmt(P)}.`, 'ok'];
      else msg = ['На небольшом потоке по прерыванию на пакет — нормально: так меньше задержка. Двигайте поток вправо.', ''];
      say(...msg);
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- everything is a file
  Deck.demo('devfiles', root => {
    const F = [
      { p: '/dev/null', ls: 'crw-rw-rw- 1 root root 1, 3 /dev/null', kind: 'символьное устройство, драйвер mem',
        r: 'сразу 0 байт — конец файла', w: 'принимает всё и выбрасывает', ex: 'cmd > /dev/null 2>&1' },
      { p: '/dev/zero', ls: 'crw-rw-rw- 1 root root 1, 5 /dev/zero', kind: 'символьное устройство, драйвер mem',
        r: 'бесконечные нули', w: 'выбрасывает', ex: 'dd if=/dev/zero of=img bs=1M count=100', more: '<code>mmap</code> этого файла — старый способ получить обнулённую анонимную память.' },
      { p: '/dev/urandom', ls: 'crw-rw-rw- 1 root root 1, 9 /dev/urandom', kind: 'символьное устройство, драйвер random',
        r: 'выход криптостойкого генератора ядра', w: 'подмешивает байты в пул энтропии', ex: 'head -c 16 /dev/urandom | xxd', more: 'Python <code>os.urandom</code>, Go <code>crypto/rand</code> и Node <code>crypto.randomBytes</code> берут то же самое через вызов <code>getrandom()</code> — без файла и дескриптора.' },
      { p: '/dev/nvme0n1', ls: 'brw-rw---- 1 root disk 259, 0 /dev/nvme0n1', kind: 'блочное устройство, драйвер nvme',
        r: 'байты диска в обход файловой системы', w: 'пишет прямо в сектора — так и затирают разделы', ex: 'sudo dd if=/dev/nvme0n1 bs=512 count=1 | xxd', more: 'Доступ — только root и группа <code>disk</code>: кто читает блочное устройство, читает все файлы всех пользователей.' },
      { p: '/dev/tty', ls: 'crw-rw-rw- 1 root tty 5, 0 /dev/tty', kind: 'символьное устройство, драйвер tty',
        r: 'ввод с управляющего терминала процесса', w: 'вывод в этот терминал', ex: 'read -r pw < /dev/tty', more: 'Размер окна, эхо, режим построчного ввода — это уже <code>ioctl</code>: <code>isatty()</code> в Python и Node — вызов <code>ioctl(TCGETS)</code>.' },
      { p: '/proc/self/status', ls: '-r--r--r-- 1 me me 0 /proc/self/status', kind: 'procfs: файла нет ни на каком диске',
        r: 'текст, который ядро генерирует в момент чтения', w: 'запрещено', ex: 'grep -E "VmRSS|Threads" /proc/self/status', more: 'Размер 0 в <code>ls</code> — честный: содержимого нет, пока его не прочли.' },
      { p: '/sys/class/net/eth0/mtu', ls: '-rw-r--r-- 1 root root 4096 …/eth0/mtu', kind: 'sysfs: одно значение — один файл',
        r: '<code>1500</code> — текущий MTU интерфейса', w: 'root может записать новое значение — ядро вызовет драйвер карты', ex: 'echo 9000 | sudo tee /sys/class/net/eth0/mtu' },
      { p: 'socket:[48213]', ls: 'lrwx------ 1 me me 64 /proc/self/fd/3 -> socket:[48213]', kind: 'сокет: имени в файловой системе нет, но есть дескриптор',
        r: '<code>read</code> = <code>recv</code>: данные из очереди приёма', w: '<code>write</code> = <code>send</code>', ex: 'ls -l /proc/$(pgrep -n nginx)/fd', more: 'Поэтому сокеты, каналы, таймеры (<code>timerfd</code>) и события (<code>eventfd</code>) можно ждать одним <code>epoll</code>.' },
    ];
    const pick = choice(F.map(f => h('code', null, f.p)), i => show(i));
    const card = h('div', { class: 'df-card' });
    root.append(pick.el, card);
    function show(i) {
      pick.set(i);
      const f = F[i];
      card.replaceChildren(
        h('pre', { class: 'code df-ls' }, h('code', null, '$ ls -l\n' + f.ls)),
        h('div', { class: 'df-kind' }, f.kind),
        h('div', { class: 'df-ops' },
          h('span', { class: 'df-op' }, 'read()'), h('span', { html: f.r }),
          h('span', { class: 'df-op' }, 'write()'), h('span', { html: f.w })),
        f.more ? h('p', { class: 'note', html: f.more }) : '',
        h('pre', { class: 'code df-ex' }, h('code', null, '$ ' + f.ex)));
    }
    show(0);
    return {};
  });
})();

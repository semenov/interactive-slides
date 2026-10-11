# interactive-slides

Static site with interactive presentations, deployed to https://slides.semenov.ai with `homebase deploy` (nginx via `Dockerfile`, config in `homebase.toml`).
Content language: Russian.

## Layout

- `site/index.html` — home page, a hand-written list of presentations (`.talks`). Add an `<li>` for every new presentation.
- `site/assets/` — shared: `base.css` (tokens, buttons, code, home page), `deck.css` + `deck.js` (slide engine),
  `kit.css` (demo building blocks: `.demo`, `.controls`, `.log`, `.val`, `.track`, `.slider`, `.toggle`, quiz,
  `.btn.small`/`.btn.sel`, `.tech` chip, `.stats`, `.fit` yes/no columns, `.summary`/`.proverb`).
  Accent colour comes from `--accent`/`--accent-deep`/`--accent-soft` (default Go blue; a deck can override per slide).
- `site/<slug>/` — one presentation per folder → URL `/<slug>/`, slides deep-linked as `#N`.
  `index.html` (slides), `demos.js` (interactive parts), `style.css`.

## Slide engine (`deck.js`)

- Slides are `<section class="slide"><div class="slide-inner">…</div></section>` inside `.deck > .slides`.
  Layout helpers: `.split` (text | demo, collapses to one column ≤900px), `.split.even`, `.stack`.
- `pre.code > code` is auto-highlighted as Go; `lang-sql`, `lang-c`, `lang-js`, `lang-py`, or `lang-plain` for none.
- Helpers on `Deck`: `h` (DOM builder), `highlight(src, lang)`, `plural(n, forms)` (Russian), `rafLoop(fn)`.
- Built-in demo `quiz`: `.quiz[data-demo=quiz]` with `.opt` buttons (one `data-correct`) and an `.explain` block.
- Interactive element: `<div class="demo" data-demo="name"></div>` + `Deck.demo('name', el => ({ start, stop }))`.
  Factory runs on first visit; `start`/`stop` on slide enter/leave (pause animations there).
- Navigation: arrows/PageUp/PageDown/Space, bottom bar, and a swipe that drags the slide with the finger
  (neighbour slide gets `.is-peek` during the drag; commit at 25% width or a flick; not started on inputs/`pre`/`.no-swipe`).

## Presentations

Single decks:

- `agent-skills` — скилы в ИИ-агентах: агентный цикл и контекст, SKILL.md и фронтматтер, прогрессивное раскрытие, выбор скила по описанию, инструмент Skill и `/имя` в Claude Code, подстановки `$ARGUMENTS`/`` !`cmd` ``, скрипты, сравнение с CLAUDE.md/MCP/сабагентами/хуками, где живут скилы и открытый стандарт, безопасность, линтер описаний. Demos split into `demos.js` (slides 2–10, `window.AS` helpers) and `demos-2.js` (slides 11–18).
- `go-channels` — горутины и каналы в Go.
- `backend-stack` — PostgreSQL, Redis, RabbitMQ, Kafka, Elasticsearch, ClickHouse, S3: когда брать и когда нет. Tech colours via `.t-pg`, `.t-redis`, … classes.
- `postgres-internals` — память/диск, MVCC, VACUUM, WAL, индексы, планировщик, блокировки, пулер, репликация, фейловер, бэкапы. Demos split into `demos.js` (internals) and `demos-ops.js` (operations).

The home page groups decks into series (`.home-section`, numbered `.talk-step` in learning order);
single decks go under «Отдельные темы». Each deck's title slide/summary links to its neighbours.

### Series «Как работает компьютер»

- `data-in-memory` — биты и hex, память как массив байтов, дополнительный код и переполнения, IEEE 754, порядок байтов, выравнивание структур, массивы значений и указателей, int в CPython, Unicode/UTF-8/UTF-16. Demos split into `demos.js` (numbers) and `demos-layout.js` (layout and strings).
- `cpu` — инструкции, конвейер, предсказание переходов, OoO, иерархия памяти, кэш-линии, префетч, false sharing, SIMD, Python vs numpy, perf. Demos split into `demos.js` (CPU core) and `demos-mem.js` (memory).
- `compilers-runtimes` — конвейер компилятора, оптимизации, байткод CPython и специализация 3.11+, уровни JIT V8/JVM, деоптимизация, скрытые классы и inline cache, AOT vs JIT, линковка, ELF и загрузчик. Demos split into `demos.js` (compiler and CPython) and `demos-runtime.js` (JIT, linking, ELF; uses `window.CR` helpers).
- `stack-and-heap` — адресное пространство процесса, стек вызовов и соглашение о вызовах, переполнение стека и буфера, malloc и аллокаторы (классы размеров, tcache/mcache), значения и ссылки, escape-анализ. Demos split into `demos-stack.js` and `demos-heap.js`.
- `memory-management` — malloc/free и его ошибки, владение (Rust), подсчёт ссылок и сборщик циклов CPython, mark & sweep, трёхцветная разметка и барьер записи, уплотнение, поколения, паузы, GOGC/GOMEMLIMIT, сборщики Go/JVM/V8/CPython, утечки, слабые ссылки. Demos split into `demos.js` (mechanisms) and `demos-gc.js` (tuning and leaks).
- `os-overview` — карта ОС: слои и аналоги в Linux/macOS/Windows, архитектуры ядер, загрузка, прерывания/NAPI, драйверы и /dev, часы, права/capabilities/seccomp, eBPF, различия ОС для разработчика. Demos split into `demos.js` (slides 2–9) and `demos-sec.js` (11–17).
- `virtual-memory` — адресные пространства, таблицы страниц и TLB, huge pages, page faults, ленивое выделение, overcommit/OOM, CoW после fork, swap, page cache и free, RSS/PSS/USS, cgroups. Demos split into `demos.js` (translation, faults) and `demos-sys.js` (system-level memory).
- `processes-threads` — режим ядра и системные вызовы, процесс и /proc, fork/exec/wait и зомби, сигналы и PID 1, планировщик, переключение контекста, потоки и GIL, load average, cgroups. Demos split into `demos.js` (syscalls, processes, signals) and `demos-sched.js` (scheduling, threads, containers; uses `window.PT` helpers).
- `concurrency-sync` — гонки данных и условий, мьютекс/futex, дедлоки, атомики/CAS/ABA, модель памяти (store buffer, happens-before, DCL), RWMutex/семафор, закон Амдала, race detector. Demos split into `demos.js` (races, mutex, deadlock) and `demos-atomics.js` (CAS, ABA, litmus, DCL, primitives, Amdahl).
- `async-io` — C10K, блокирующий и неблокирующий ввод-вывод, select/poll/epoll, io_uring, event loop (микро- и макрозадачи), async/await как конечный автомат, блокировка цикла и пул libuv, asyncio, зелёные потоки M:N (Go, Java Loom, Erlang), раскраска функций. Demos split into `demos.js` and `demos-runtime.js`.
- `networking` — инкапсуляция и MTU, подсети, traceroute, NAT, DNS, UDP/TCP, жизнь TCP-соединения, окно получателя, cwnd, BDP и круги RTT (HTTP/1.1/2/3, TLS), HOL, Nagle, сокеты в ядре, очередь accept, порты и TIME_WAIT. Demos split into `demos.js` (shared `Net` helpers incl. SVG ladder diagrams), `demos-tcp.js`, `demos-sock.js`.
- `files-storage` — файловые дескрипторы и inode, путь записи (page cache, writeback, fsync), безопасная замена файла, журналирование, page cache при чтении, mmap, HDD/SSD/NVMe и FTL/TRIM, group commit, ротация логов. Demos split into `demos.js` (slides 2–12) and `demos-disk.js` (slides 14–18).
- `containers-virtualization` — ВМ против контейнера, namespaces, cgroups v2, слои образа и overlayfs, docker run по шагам, сеть контейнеров (veth/мост/NAT), безопасность, гипервизоры и EPT, steal time, microVM/gVisor, Docker на Mac. Demos split into `demos.js` (containers) and `demos-vm.js` (security and virtualization).

### Series «Алгоритмы и структуры данных»

- `complexity-patterns` — открывает серию алгоритмов: O-нотация и что она скрывает, ограничения → сложность, амортизация, цена встроенных операций Python, паттерны (два указателя, окно, префиксы, бинпоиск по ответу, монотонный стек), ход решения на собеседовании, случайный O(n²) в проде. Demos split into `demos.js` (complexity) and `demos-patterns.js` (patterns).
- `arrays-hashing` — динамические массивы, связные списки, стек/очередь/кольцевой буфер, хеш-функции и хеш-таблицы (пробирование, надгробия, рехеш, hash flooding), dict/Go map/HashMap изнутри, LRU, паттерны задач на хеш-таблицу. Demos split into `demos.js`, `demos-hash.js`, `demos-tasks.js`.
- `sorting-searching` — сортировки (introsort/pdqsort, стабильность, Timsort, нижняя граница, radix, quickselect, внешняя сортировка), бинарный поиск (lower/upper_bound, по ответу, повёрнутый массив), интервалы и sweep line. Demos split into `demos.js` (sorting) and `demos-search.js`.
- `trees-heaps` — обходы, BST и повороты, АВЛ/красно-чёрные, B+деревья, кучи (top-K, медиана, слияние), trie и longest prefix match. Demos split into `demos-trees.js` and `demos-more.js`, shared SVG tree view in `common.js`.
- `graphs` — представления, BFS/DFS, компоненты, циклы, топосортировка (Кан), Дейкстра, Беллман–Форд, A*, union-find, MST, двудольность, неявные графы, PageRank. Demos split into `demos.js` (traversals, topo sort; shared SVG graph helper `GK`) and `demos-paths.js` (shortest paths, DSU, Kruskal, bipartite).
- `dp-greedy` — рекурсия и перебор с возвратом, мемоизация и таблица, Левенштейн, LCS/diff, рюкзак, размен монет, LIS, жадные алгоритмы (интервалы, Хаффман), ДП в индустрии. Demos split into `demos.js` (recursion/DP) and `demos-greedy.js`.
- `probabilistic-structures` — фильтр Блума, HyperLogLog, Count-Min, reservoir sampling, skip list, LSM против B-дерева, консистентное хеширование, geohash, деревья Меркла, token bucket. Demos split into `demos.js` and `demos-sys.js` (uses `window.PS` helpers).

### Series «Системный дизайн»

- `sd-approach` — системный дизайн, часть 1: структура интервью, требования, оценки на салфетке, задержки, доступность и SLO/бюджет ошибок, перцентили и fan-out, закон Литтла и очереди M/M/1, идемпотентность, модель данных. Demos split into `demos.js` and `demos-2.js`.
- `sd-scaling` — масштабирование: stateless, DNS/L4/L7 и алгоритмы балансировки, консистентное хеширование, health checks и draining, эволюция архитектуры, кэши (паттерны, hit ratio, stampede, горячие ключи), CDN, rate limiting, сброс нагрузки, автоскейлинг. Demos split into `demos.js` (scaling and balancing) and `demos-load.js` (caches and overload).
- `sd-data` — системный дизайн, ч. 3: выбор хранилища, репликация и лаг, фейловер и split brain, кворумы, конфликты/CRDT, модели консистентности, CAP/PACELC, шардирование, консистентное хеширование, 2PC, CQRS, генерация ID. Demos split into `demos.js` (replication/consistency) and `demos-shard.js` (sharding, 2PC, IDs).
- `sd-distributed` — частичные отказы, таймауты, ретраи с джиттером и бюджетом, идемпотентность, circuit breaker и переборки, семантика доставки, outbox/CDC, саги, часы Лэмпорта, Raft, аренды и fencing-токены. Demos split into `demos.js` (slides 3–11) and `demos-2.js` (slides 13–19).
- `sd-cases-1` — разбор задач: сокращатель ссылок, распределённый rate limiter, лента новостей, мессенджер (по шагам интервью). Demos split into `demos.js` (ссылки, лимиты, лента) and `demos-chat.js` (чат).
- `sd-cases-2` — разбор задач: хранилище файлов (чанки, CDC, синхронизация), такси (геоиндекс, назначение, горячие районы), поисковый робот (frontier, simhash), счётчики и топ-K (Count-Min, окна, лямбда/каппа). Demos split into `demos-files.js`, `demos-geo.js`, `demos-stream.js`.

## Rules

- Must work on a phone in portrait and on desktop — check both (e.g. 390×844 and 1440×900).
- No build step, no frameworks. Plain HTML/CSS/JS.

## Deploy

`homebase deploy` from the repo root (app `slides`, server `root@thor.semenov.ai`).

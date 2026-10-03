# interactive-slides

Static site with interactive presentations, deployed to https://slides.semenov.ai with `ship` (nginx via `Dockerfile`, config in `ship.toml`).
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
- `pre.code > code` is auto-highlighted as Go; `<code class="lang-sql">` for SQL, `lang-plain` for none.
- Helpers on `Deck`: `h` (DOM builder), `highlight(src, lang)`, `plural(n, forms)` (Russian), `rafLoop(fn)`.
- Built-in demo `quiz`: `.quiz[data-demo=quiz]` with `.opt` buttons (one `data-correct`) and an `.explain` block.
- Interactive element: `<div class="demo" data-demo="name"></div>` + `Deck.demo('name', el => ({ start, stop }))`.
  Factory runs on first visit; `start`/`stop` on slide enter/leave (pause animations there).
- Navigation: arrows/PageUp/PageDown/Space, bottom bar, and a swipe that drags the slide with the finger
  (neighbour slide gets `.is-peek` during the drag; commit at 25% width or a flick; not started on inputs/`pre`/`.no-swipe`).

## Presentations

- `go-channels` — горутины и каналы в Go.
- `backend-stack` — PostgreSQL, Redis, RabbitMQ, Kafka, Elasticsearch, ClickHouse, S3: когда брать и когда нет. Tech colours via `.t-pg`, `.t-redis`, … classes.
- `postgres-internals` — память/диск, MVCC, VACUUM, WAL, индексы, планировщик, блокировки, пулер, репликация, фейловер, бэкапы. Demos split into `demos.js` (internals) and `demos-ops.js` (operations).

## Rules

- Must work on a phone in portrait and on desktop — check both (e.g. 390×844 and 1440×900).
- No build step, no frameworks. Plain HTML/CSS/JS.

## Deploy

`ship` from the repo root (app `slides`, server `root@thor.semenov.ai`).

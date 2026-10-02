# interactive-slides

Static site with interactive presentations, deployed to https://slides.semenov.ai with `ship` (nginx via `Dockerfile`, config in `ship.toml`).
Content language: Russian.

## Layout

- `site/index.html` — home page, a hand-written list of presentations (`.talks`). Add an `<li>` for every new presentation.
- `site/assets/` — shared: `base.css` (tokens, buttons, code, home page), `deck.css` + `deck.js` (slide engine).
- `site/<slug>/` — one presentation per folder → URL `/<slug>/`, slides deep-linked as `#N`.
  `index.html` (slides), `demos.js` (interactive parts), `style.css`.

## Slide engine (`deck.js`)

- Slides are `<section class="slide"><div class="slide-inner">…</div></section>` inside `.deck > .slides`.
  Layout helpers: `.split` (text | demo, collapses to one column ≤900px), `.split.even`, `.stack`.
- `pre.code > code` is auto-highlighted as Go.
- Interactive element: `<div class="demo" data-demo="name"></div>` + `Deck.demo('name', el => ({ start, stop }))`.
  Factory runs on first visit; `start`/`stop` on slide enter/leave (pause animations there).
- Navigation: arrows/PageUp/PageDown/Space, horizontal swipe (not on buttons/inputs/`pre`/`.no-swipe`), bottom bar.

## Rules

- Must work on a phone in portrait and on desktop — check both (e.g. 390×844 and 1440×900).
- No build step, no frameworks. Plain HTML/CSS/JS.

## Deploy

`ship` from the repo root (app `slides`, server `root@thor.semenov.ai`).

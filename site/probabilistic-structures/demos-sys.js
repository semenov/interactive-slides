// Demos for slides 12–19: skip list, LSM tree, consistent hashing, geohash, Merkle tree, token bucket.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const { hashStr, hashInt, rng, logger, fmt, dec } = window.PS;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (vb, cls) => { const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', vb); s.setAttribute('class', cls); return s; };

  // ---------------------------------------------------------------- skip list
  Deck.demo('skiplist', root => {
    const MAXL = 4, CAP = 16;
    const INIT = [[3, 1], [7, 2], [12, 1], [19, 3], [23, 1], [31, 1], [38, 2], [42, 1], [50, 4], [57, 1], [64, 2], [71, 1], [80, 1], [88, 3]];
    let nodes; // sorted [{key, lvl}]
    const grid = h('div', { class: 'sk-grid' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary small', onclick: () => search(57) }, 'Найти 57'),
        h('button', { class: 'btn small', onclick: () => search(23) }, 'Найти 23'),
        h('button', { class: 'btn small', onclick: () => search(60) }, 'Найти 60'),
        h('button', { class: 'btn small', onclick: insert }, 'Вставить'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс'),
      ),
      grid, stats, logEl,
    );

    // Classic search: from the top level go right while the next key is smaller, then down.
    // Returns visited cells [{i, l}] (i = -1 is the head) and the predecessor at every level.
    function walk(target) {
      const path = [], update = [];
      let i = -1, cmps = 0;
      for (let l = MAXL; l >= 1; l--) {
        path.push({ i, l });
        for (;;) {
          let nx = i + 1;
          while (nx < nodes.length && nodes[nx].lvl < l) nx++;
          if (nx >= nodes.length) break;
          cmps++;
          if (nodes[nx].key < target) { i = nx; path.push({ i, l }); } else break;
        }
        update[l] = i;
      }
      return { path, update, last: i, cmps };
    }
    function render(path = [], hit = null, fresh = null) {
      grid.style.gridTemplateColumns = `2.2em repeat(${nodes.length}, minmax(0, 1fr))`;
      const on = new Set(path.map(p => p.i + ':' + p.l));
      let html = '';
      for (let l = MAXL; l >= 1; l--) {
        html += `<span class="sk-head${on.has('-1:' + l) ? ' path' : ''}">L${l}</span>`;
        nodes.forEach((n, i) => {
          if (n.lvl >= l) {
            const cls = ['sk-node', on.has(i + ':' + l) ? 'path' : '', hit === i ? 'hit' : '', fresh === i ? 'fresh' : ''].join(' ');
            html += `<span class="${cls}">${n.key}</span>`;
          } else html += '<span class="sk-wire"></span>';
        });
      }
      grid.innerHTML = html;
    }
    function search(t) {
      const { path, last, cmps } = walk(t);
      const nx = last + 1 < nodes.length ? nodes[last + 1] : null;
      const found = nx && nx.key === t;
      render(path, found ? last + 1 : null);
      const linear = found ? last + 2 : nodes.filter(n => n.key < t).length + 1;
      setStats(cmps + 1, linear);
      say(found
        ? `${t} найден: ${cmps + 1} ${plural(cmps + 1, ['сравнение', 'сравнения', 'сравнений'])}. Верхние уровни перепрыгивают через целые участки списка.`
        : `${t} нет: дошли до ${last >= 0 ? nodes[last].key : 'головы'} на нижнем уровне, следующий — ${nx ? nx.key : 'конец'}.`, found ? 'ok' : '');
    }
    function setStats(c, lin) {
      stats.innerHTML = `<div class="stat"><b>${c}</b><span>сравнений со skip list</span></div>` +
        `<div class="stat"><b>${lin}</b><span>в обычном списке</span></div>` +
        `<div class="stat"><b>~${dec(Math.log2(1e6) * 1, 0)}</b><span>шагов на 1 млн ключей (~log₂ n)</span></div>`;
    }
    function insert() {
      if (nodes.length >= CAP) { say('Места на слайде больше нет — нажмите «Сброс».', 'warn'); return; }
      let key;
      do { key = 1 + Math.floor(Math.random() * 98); } while (nodes.some(n => n.key === key));
      let lvl = 1;
      const flips = [];
      while (lvl < MAXL && Math.random() < 0.5) { lvl++; flips.push('орёл'); }
      if (lvl < MAXL) flips.push('решка');
      const { path, last } = walk(key);
      nodes.splice(last + 1, 0, { key, lvl });
      const shifted = path.map(p => ({ i: p.i > last ? p.i + 1 : p.i, l: p.l }));
      render(shifted, null, last + 1);
      setStats(walk(key).cmps + 1, last + 2);
      say(`Вставка ${key}: монетка ${flips.join(', ')} → ${lvl} ${plural(lvl, ['уровень', 'уровня', 'уровней'])}. Перестроены только ${lvl} ${plural(lvl, ['указатель', 'указателя', 'указателей'])} слева — без поворотов и блокировки всего дерева.`);
    }
    function reset() {
      nodes = INIT.map(([key, lvl]) => ({ key, lvl }));
      render();
      stats.innerHTML = '';
      say('14 ключей. Каждый второй узел (в среднем) есть на уровне 2, каждый четвёртый — на уровне 3.');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- LSM tree
  Deck.demo('lsm', root => {
    const KEYS = ['бобр', 'волк', 'ёж', 'заяц', 'кит', 'лис', 'лось', 'орёл', 'рысь', 'сова', 'тигр', 'як'];
    const CAP = 4, L0MAX = 4;
    let mem, l0, l1, ver, sstId, userW, diskW, r;
    const memEl = h('div', { class: 'ls-box mem' });
    const l0El = h('div', { class: 'ls-l0' });
    const l1El = h('div', { class: 'ls-l1' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary small', onclick: () => put(1) }, 'PUT'),
        h('button', { class: 'btn small', onclick: () => put(4) }, 'PUT ×4'),
        h('button', { class: 'btn small', onclick: del }, 'DELETE'),
        h('button', { class: 'btn small', onclick: get }, 'GET'),
        h('button', { class: 'btn small', onclick: () => compact(false) }, 'Компакция'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс'),
      ),
      h('span', { class: 'label' }, 'Память'), memEl,
      h('span', { class: 'label' }, 'Диск: L0 — свежие файлы, L1 — после компакции'), l0El, l1El,
      stats, logEl,
    );

    const cmp = (a, b) => a.localeCompare(b, 'ru');
    function bloomOf(keys) {
      const m = Math.max(8, keys.length * 4), bits = new Uint8Array(m);
      const pos = (k, i) => (hashStr(k, 40 + i)) % m;
      keys.forEach(k => { for (let i = 0; i < 2; i++) bits[pos(k, i)] = 1; });
      return { m, bits, has: k => [0, 1].every(i => bits[pos(k, i)]) };
    }
    function makeSst(entries, level) {
      entries.sort((a, b) => cmp(a[0], b[0]));
      diskW += entries.length;
      return { id: ++sstId, level, entries, bloom: bloomOf(entries.map(e => e[0])) };
    }
    const entry = ([k, v]) => `<span class="ls-kv${v == null ? ' tomb' : ''}">${k}${v == null ? ' ✝' : '=' + v}</span>`;
    function sstHtml(s, mark) {
      const b = [...s.bloom.bits].map(x => `<i class="${x ? 'on' : ''}"></i>`).join('');
      return `<div class="ls-box sst ${mark || ''}"><div class="ls-h"><b>SST ${s.id}</b><span class="ls-bloom" title="фильтр Блума">${b}</span></div><div class="ls-kvs">${s.entries.map(entry).join('')}</div></div>`;
    }
    function render(marks = {}) {
      const me = [...mem.entries()].sort((a, b) => cmp(a[0], b[0]));
      memEl.className = 'ls-box mem ' + (marks.mem || '');
      memEl.innerHTML = `<div class="ls-h"><b>memtable</b><span>${mem.size}/${CAP}</span></div><div class="ls-kvs">${me.length ? me.map(entry).join('') : '<span class="empty">пусто</span>'}</div>`;
      l0El.innerHTML = l0.length ? l0.map(s => sstHtml(s, marks[s.id])).join('') : '<div class="ls-none">L0 пуст</div>';
      l1El.innerHTML = l1 ? sstHtml(l1, marks[l1.id]) : '<div class="ls-none">L1 пуст</div>';
      const wa = userW ? diskW / userW : 0;
      stats.innerHTML = `<div class="stat"><b>${userW}</b><span>записей от клиента</span></div>` +
        `<div class="stat"><b>${diskW}</b><span>записано на диск: WAL + SSTable</span></div>` +
        `<div class="stat${wa > 2 ? ' warn' : ''}"><b>×${dec(wa)}</b><span>усиление записи</span></div>`;
    }
    function flush() {
      const s = makeSst([...mem.entries()], 0);
      l0.unshift(s);
      mem = new Map();
      return s;
    }
    function write(k, v) {
      mem.set(k, v);
      userW++;
      diskW++; // the WAL record
      if (mem.size >= CAP) {
        const s = flush();
        let msg = `memtable заполнилась → сброшена на диск как SST ${s.id}: отсортированный неизменяемый файл со своим фильтром Блума.`;
        if (l0.length >= L0MAX) { compact(true); msg += ` В L0 стало ${L0MAX} файла — фоновая компакция слила их в L1.`; }
        return msg;
      }
      return '';
    }
    function put(n) {
      let last = '', what = [];
      for (let i = 0; i < n; i++) {
        const k = KEYS[Math.floor(r() * KEYS.length)];
        ver[k] = (ver[k] || 0) + 1;
        what.push(`${k}=v${ver[k]}`);
        last = write(k, 'v' + ver[k]) || last;
      }
      render();
      say(`PUT ${what.join(', ')} — в memtable и в журнал (WAL): на диск пока идёт только последовательная дозапись. ${last}`);
    }
    function lookup(k) {
      const marks = {}, steps = [];
      let reads = 0, res;
      if (mem.has(k)) { marks.mem = 'found'; res = mem.get(k); steps.push('memtable: есть'); }
      else {
        marks.mem = 'miss'; steps.push('memtable: нет');
        for (const s of [...l0, ...(l1 ? [l1] : [])]) {
          if (!s.bloom.has(k)) { marks[s.id] = 'skip'; steps.push(`SST ${s.id}: фильтр «нет»`); continue; }
          reads++;
          const e = s.entries.find(x => x[0] === k);
          if (e) { marks[s.id] = 'found'; res = e[1]; steps.push(`SST ${s.id}: прочитан, есть`); break; }
          marks[s.id] = 'fp'; steps.push(`SST ${s.id}: фильтр «может быть», прочитан зря`);
        }
      }
      return { marks, steps, reads, res };
    }
    function get() {
      const k = KEYS[Math.floor(r() * KEYS.length)];
      const { marks, steps, reads, res } = lookup(k);
      render(marks);
      const val = res === undefined ? 'не найден' : res === null ? 'удалён (надгробие)' : res;
      say(`GET ${k} → <b>${val}</b>. ${steps.join(' → ')}. Прочитано с диска: ${reads} ${plural(reads, ['файл', 'файла', 'файлов'])}.`, reads > 1 ? 'warn' : 'ok');
    }
    function del() {
      const live = KEYS.filter(k => { const x = lookup(k).res; return x != null; });
      if (!live.length) { say('Удалять нечего — сначала PUT.'); return; }
      const k = live[Math.floor(r() * live.length)];
      const msg = write(k, null);
      render();
      say(`DELETE ${k}: старые версии лежат в неизменяемых файлах, поэтому пишем надгробие ✝. Оно закроет старые значения при чтении, а исчезнет при компакции. ${msg}`);
    }
    function compact(auto) {
      if (!l0.length) { if (!auto) say('В L0 нет файлов — сливать нечего.'); return; }
      const merged = new Map();
      // newest wins: L0 is newest first, L1 is the oldest
      for (const s of [...l0, ...(l1 ? [l1] : [])]) for (const [k, v] of s.entries) if (!merged.has(k)) merged.set(k, v);
      const before = l0.reduce((s, x) => s + x.entries.length, 0) + (l1 ? l1.entries.length : 0);
      const live = [...merged.entries()].filter(e => e[1] != null); // bottom level: tombstones can go
      const n = l0.length;
      l0 = [];
      l1 = live.length ? makeSst(live, 1) : null;
      if (!auto) {
        render();
        say(`Компакция: ${n} ${plural(n, ['файл', 'файла', 'файлов'])} L0 + L1 слиты сортировкой слиянием. Было ${before} записей, осталось ${live.length}: старые версии и надгробия выброшены. Но все ${live.length} переписаны заново — это и есть усиление записи.`, 'ok');
      }
    }
    function reset() {
      mem = new Map(); l0 = []; l1 = null; ver = {}; sstId = 0; userW = 0; diskW = 0; r = rng(3);
      render();
      say(`memtable вмещает ${CAP} ключа (в RocksDB — 64 МБ). Нажимайте PUT.`);
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- consistent hashing
  Deck.demo('ring', root => {
    const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const COLORS = ['#e67700', '#1971c2', '#2b8a3e', '#ae3ec9', '#c92a2a', '#0b7285', '#5f3dc4', '#868e96'];
    const NK = 360, VN = [1, 10, 100];
    const keys = Array.from({ length: NK }, (_, i) => hashInt(i, 77));
    let servers = ['A', 'B', 'C', 'D'], vnodes = 10, mode = 'ring', owners = null, moved = new Set();
    const svg = svgEl('0 0 240 240', 'rg-svg');
    const bars = h('div', { class: 'rg-bars' });
    const vBtns = VN.map(v => h('button', { class: 'btn small', onclick: () => { vnodes = v; recompute(true); } }, v === 1 ? 'без вирт. узлов' : `${v} вирт.`));
    const mBtns = [['ring', 'кольцо'], ['mod', 'hash % N']].map(([m, t]) => h('button', { class: 'btn small', onclick: () => { mode = m; recompute(true); } }, t));
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' }, mBtns, h('span', { class: 'rg-sep' }), vBtns),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary small', onclick: add }, '+ сервер'),
        h('button', { class: 'btn small', onclick: remove }, '− сервер'),
      ),
      h('div', { class: 'rg-wrap' }, svg, bars),
      logEl,
    );
    const MAX = 2 ** 32;
    function points() {
      const p = [];
      for (const s of servers) for (let v = 0; v < vnodes; v++) p.push({ pos: hashStr(s + '#' + v, 1), s });
      return p.sort((a, b) => a.pos - b.pos);
    }
    function assign() {
      if (mode === 'mod') return keys.map(k => servers[k % servers.length]);
      const p = points();
      return keys.map(k => {
        let lo = 0, hi = p.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (p[mid].pos < k) lo = mid + 1; else hi = mid; }
        return p[lo % p.length].s;
      });
    }
    const col = s => COLORS[NAMES.indexOf(s)];
    function render() {
      const cx = 120, cy = 120, R = 104, r = 88;
      const at = (pos, rad) => { const a = (pos / MAX) * 2 * Math.PI - Math.PI / 2; return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; };
      let s = `<circle cx="${cx}" cy="${cy}" r="${R}" class="rg-ring"/>`;
      if (mode === 'ring') {
        for (const p of points()) {
          const [x1, y1] = at(p.pos, R - 6), [x2, y2] = at(p.pos, R + 7);
          s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col(p.s)}" stroke-width="${vnodes > 10 ? 1.2 : 3}"/>`;
        }
      }
      keys.forEach((k, i) => {
        const [x, y] = at(k, moved.has(i) ? r - 6 : r);
        s += `<circle cx="${x}" cy="${y}" r="${moved.has(i) ? 3.2 : 2.2}" fill="${col(owners[i])}"${moved.has(i) ? ' class="mv"' : ''}/>`;
      });
      s += `<text x="${cx}" y="${cy - 4}" class="rg-c">${mode === 'ring' ? 'кольцо' : 'hash % ' + servers.length}</text><text x="${cx}" y="${cy + 14}" class="rg-c2">${NK} ключей</text>`;
      svg.innerHTML = s;
      const cnt = {};
      owners.forEach(o => { cnt[o] = (cnt[o] || 0) + 1; });
      const avg = NK / servers.length, max = Math.max(...servers.map(x => cnt[x] || 0));
      bars.innerHTML = servers.map(x => `<div class="rg-bar"><b style="color:${col(x)}">${x}</b><span class="rg-track"><span style="width:${((cnt[x] || 0) / max) * 100}%;background:${col(x)}"></span></span><span>${cnt[x] || 0}</span></div>`).join('') +
        `<p class="rg-skew${max / avg > 1.5 ? ' bad' : ''}">самый загруженный: ×${dec(max / avg, 2)} от среднего</p>`;
      vBtns.forEach((b, i) => { b.classList.toggle('sel', VN[i] === vnodes); b.disabled = mode === 'mod'; });
      mBtns.forEach((b, i) => b.classList.toggle('sel', ['ring', 'mod'][i] === mode));
    }
    function recompute(clear) {
      owners = assign();
      if (clear) moved = new Set();
      render();
      if (clear) say(mode === 'ring'
        ? `Кольцо, ${vnodes} ${plural(vnodes, ['точка', 'точки', 'точек'])} на сервер. Ключ (точка внутри) принадлежит ближайшему серверу по часовой стрелке.`
        : 'hash % N: сервер — остаток от деления хеша на число серверов. Кольцо не участвует.');
    }
    function change(next, verb) {
      const before = owners;
      servers = next;
      owners = assign();
      moved = new Set();
      owners.forEach((o, i) => { if (o !== before[i]) moved.add(i); });
      render();
      const share = moved.size / NK, n = servers.length;
      say(`${verb}: переехало <b>${moved.size} из ${NK}</b> ключей (${dec(share * 100, 0)}%). ${mode === 'ring' ? `Ожидается ~1/${verb.startsWith('Добав') ? n : n + 1} = ${dec(100 / (verb.startsWith('Добав') ? n : n + 1), 0)}% — ровно доля сервера, который ${verb.startsWith('Добав') ? 'появился' : 'ушёл'}; остальные ключи на месте.` : `Кэш почти пуст: все эти ключи — промахи, нагрузка уходит в базу.`}`, share > 0.5 ? 'bad' : 'ok');
    }
    function add() {
      const free = NAMES.find(n => !servers.includes(n));
      if (!free) { say('Больше серверов не поместится.'); return; }
      change([...servers, free], `Добавлен ${free}`);
    }
    function remove() {
      if (servers.length <= 2) { say('Оставим хотя бы два сервера.'); return; }
      change(servers.slice(0, -1), `Убран ${servers[servers.length - 1]}`);
    }
    recompute(true);
    return {};
  });

  // ---------------------------------------------------------------- geohash
  Deck.demo('geo', root => {
    const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
    const W = 360, H = 180;
    let bits = 8, lon = 37.62, lat = 55.75;
    // points around a few "cities"
    const r = rng(42), pts = [];
    const CITIES = [[37.6, 55.7], [30.3, 59.9], [-0.1, 51.5], [2.35, 48.9], [-74, 40.7], [139.7, 35.7], [-46.6, -23.5], [77.2, 28.6], [116.4, 39.9], [151.2, -33.9], [-118.2, 34], [31.2, 30], [18.4, -33.9], [103.8, 1.35]];
    const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
    for (const [x, y] of CITIES) for (let i = 0; i < 14; i++) pts.push([x + gauss() * 4, Math.max(-89, Math.min(89, y + gauss() * 3))]);
    const svg = svgEl(`0 0 ${W} ${H}`, 'gh-svg');
    const out = h('output');
    const input = h('input', { type: 'range', min: 2, max: 16, value: bits, 'aria-label': 'Бит в geohash' });
    input.addEventListener('input', () => { bits = +input.value; render(); });
    const codeEl = h('div', { class: 'gh-code' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Точность, бит'), input, out), svg, codeEl, logEl);
    svg.addEventListener('click', e => {
      const b = svg.getBoundingClientRect();
      lon = ((e.clientX - b.left) / b.width) * 360 - 180;
      lat = 90 - ((e.clientY - b.top) / b.height) * 180;
      render();
    });

    function encode(lo, la, n) {
      let s = '', a = [-180, 180], b = [-90, 90];
      for (let i = 0; i < n; i++) {
        const iv = i % 2 === 0 ? a : b, v = i % 2 === 0 ? lo : la;
        const mid = (iv[0] + iv[1]) / 2;
        if (v >= mid) { s += '1'; iv[0] = mid; } else { s += '0'; iv[1] = mid; }
      }
      return { s, box: [a[0], b[0], a[1], b[1]] };
    }
    const b32 = s => { let o = ''; for (let i = 0; i + 5 <= s.length; i += 5) o += B32[parseInt(s.slice(i, i + 5), 2)]; return o; };
    const label = s => { const full = b32(s), rest = s.slice(full.length * 5); return (full || '') + (rest ? `<small>+${rest}</small>` : ''); };
    const X = x => x + 180, Y = y => 90 - y;
    function render() {
      out.textContent = bits;
      const { s, box } = encode(lon, lat, bits);
      const cw = box[2] - box[0], chh = box[3] - box[1];
      let html = '<rect x="0" y="0" width="360" height="180" class="gh-bg"/>';
      const nx = 2 ** Math.ceil(bits / 2), ny = 2 ** Math.floor(bits / 2);
      if (nx <= 64) for (let i = 1; i < nx; i++) html += `<line x1="${i * W / nx}" x2="${i * W / nx}" y1="0" y2="${H}" class="gh-grid"/>`;
      if (ny <= 64) for (let i = 1; i < ny; i++) html += `<line y1="${i * H / ny}" y2="${i * H / ny}" x1="0" x2="${W}" class="gh-grid"/>`;
      const cells = [];
      for (let dy = 1; dy >= -1; dy--) for (let dx = -1; dx <= 1; dx++) {
        let cx = box[0] + cw / 2 + dx * cw;
        const cy = box[1] + chh / 2 + dy * chh;
        if (cy > 90 || cy < -90) { cells.push(null); continue; }
        if (cx > 180) cx -= 360; if (cx < -180) cx += 360;
        const c = encode(cx, cy, bits);
        cells.push(c);
        const self = dx === 0 && dy === 0;
        html += `<rect x="${X(c.box[0])}" y="${Y(c.box[3])}" width="${cw}" height="${chh}" class="${self ? 'gh-self' : 'gh-nb'}"/>`;
      }
      const inBox = (p, bx) => p[0] >= bx[0] && p[0] < bx[2] && p[1] >= bx[1] && p[1] < bx[3];
      let own = 0, near = 0;
      for (const p of pts) {
        const o = inBox(p, box), nb = cells.some(c => c && inBox(p, c.box));
        if (o) own++;
        if (nb) near++;
        html += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="1.6" class="${o ? 'gh-p own' : nb ? 'gh-p nb' : 'gh-p'}"/>`;
      }
      html += `<circle cx="${X(lon)}" cy="${Y(lat)}" r="3.5" class="gh-me"/>`;
      svg.innerHTML = html;
      // common prefix with neighbours
      const pref = c => { let i = 0; while (i < bits && c.s[i] === s[i]) i++; return i; };
      const minPref = Math.min(...cells.filter(Boolean).map(pref));
      codeEl.innerHTML = `<div class="gh-bits">${s.match(/.{1,5}/g).map((g, i) => `<span class="${g.length === 5 ? '' : 'part'}"><b>${g.split('').map((c, j) => `<i class="${(i * 5 + j) % 2 ? 'la' : 'lo'}">${c}</i>`).join('')}</b><em>${g.length === 5 ? B32[parseInt(g, 2)] : '…'}</em></span>`).join('')}</div>` +
        `<div class="gh-nine">${cells.map((c, i) => `<span class="${i === 4 ? 'self' : ''}">${c ? label(c.s) : '—'}</span>`).join('')}</div>`;
      const kmW = (cw * 111 * Math.cos((lat * Math.PI) / 180)), kmH = chh * 111;
      const km = v => v >= 100 ? fmt(v) : dec(v);
      logEl.innerHTML = `Клетка ${km(kmW)} × ${km(kmH)} км: в ней ${own} ${plural(own, ['точка', 'точки', 'точек'])}, в 3×3 — ${near}. ` +
        (minPref < bits / 2 ? `У соседей общий префикс всего ${minPref} ${plural(minPref, ['бит', 'бита', 'бит'])} — точка у «шва», поиск по одному префиксу её соседей не найдёт.` : `Соседи совпадают с вами в первых ${minPref} битах.`) +
        ' Голубые биты — долгота, оранжевые — широта.';
      logEl.className = 'log' + (minPref < bits / 2 ? ' warn' : '');
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- Merkle tree
  Deck.demo('merkle', root => {
    const N = 8;
    let A, B, timers = [], r = rng(8);
    const treesEl = h('div', { class: 'mk-trees' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const cmpBtn = h('button', { class: 'btn primary small', onclick: compare }, 'Сверить');
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn small danger', onclick: corrupt }, 'Изменить блок на B'),
        cmpBtn,
        h('button', { class: 'btn small', onclick: sync }, 'Синхронизировать'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс'),
      ),
      treesEl, stats, logEl,
    );
    const hx = s => (hashStr(s, 3) >>> 16).toString(16).padStart(4, '0');
    function build(blocks) {
      const lv = [blocks.map(b => hx(b))];
      while (lv[0].length > 1) {
        const prev = lv[0], next = [];
        for (let i = 0; i < prev.length; i += 2) next.push(hx(prev[i] + prev[i + 1]));
        lv.unshift(next);
      }
      return lv; // lv[0] = [root]
    }
    let marks = {}, diffBlocks = [];
    function render() {
      const ta = build(A), tb = build(B);
      const tree = (name, t, blocks, side) => `<div class="mk-tree"><span class="label">Реплика ${name}</span>` +
        t.map((row, d) => `<div class="mk-row" style="--n:${row.length}">${row.map((x, i) => `<span class="mk-n ${marks[side + d + ':' + i] || ''}">${x}</span>`).join('')}</div>`).join('') +
        `<div class="mk-row blocks" style="--n:${N}">${blocks.map((b, i) => `<span class="mk-b ${diffBlocks.includes(i) && side === 'b' ? 'bad' : ''}">${b.split(':')[1]}</span>`).join('')}</div></div>`;
      treesEl.innerHTML = tree('A', ta, A, 'a') + tree('B', tb, B, 'b');
    }
    function corrupt() {
      stopAnim();
      const i = Math.floor(r() * N);
      const v = +B[i].split(':')[1].slice(1) + 1;
      B[i] = `${i}:v${v}`;
      marks = {}; diffBlocks = [];
      render();
      say(`На реплике B изменился блок ${i} (например, запись не дошла до A). Хеш блока поменялся — и вместе с ним все хеши на пути к корню.`);
    }
    function stopAnim() { timers.forEach(clearTimeout); timers = []; cmpBtn.disabled = false; }
    function compare() {
      stopAnim();
      const ta = build(A), tb = build(B);
      marks = {}; diffBlocks = [];
      let frontier = [0], cmps = 0, d = 0;
      const steps = [];
      while (frontier.length && d < ta.length) {
        const next = [], marksStep = [];
        for (const i of frontier) {
          cmps++;
          const same = ta[d][i] === tb[d][i];
          marksStep.push([d, i, same ? 'eq' : 'ne']);
          if (!same) { if (d === ta.length - 1) diffBlocks.push(i); else next.push(2 * i, 2 * i + 1); }
        }
        steps.push(marksStep);
        frontier = next; d++;
      }
      const found = [...diffBlocks];
      diffBlocks = [];
      render();
      cmpBtn.disabled = true;
      steps.forEach((st, k) => timers.push(setTimeout(() => {
        st.forEach(([dd, i, m]) => { marks['a' + dd + ':' + i] = m; marks['b' + dd + ':' + i] = m; });
        if (k === steps.length - 1) { diffBlocks = found; cmpBtn.disabled = false; }
        render();
        if (k === steps.length - 1) finish(found, cmps);
      }, 450 * (k + 1))));
    }
    function finish(found, cmps) {
      stats.innerHTML = `<div class="stat"><b>${cmps}</b><span>сравнено хешей</span></div>` +
        `<div class="stat"><b>${found.length}</b><span>${plural(found.length, ['блок отличается', 'блока отличаются', 'блоков отличаются'])}</span></div>` +
        `<div class="stat"><b>~${2 * 20 + 1}</b><span>сравнений на 1 расхождение среди 1 млн блоков</span></div>`;
      if (!found.length) say(`Корни совпали — реплики одинаковы. Одно сравнение вместо ${N}, а в жизни — вместо миллионов.`, 'ok');
      else say(`Корни разные → спускаемся только в отличающиеся ветки. Найдено: ${found.map(i => 'блок ' + i).join(', ')} за ${cmps} ${plural(cmps, ['сравнение', 'сравнения', 'сравнений'])}. Переслать нужно только ${plural(found.length, ['его', 'их', 'их'])}.`, 'warn');
    }
    function sync() {
      stopAnim();
      let n = 0;
      for (let i = 0; i < N; i++) if (A[i] !== B[i]) { const va = +A[i].split(':')[1].slice(1), vb = +B[i].split(':')[1].slice(1); const w = va > vb ? A[i] : B[i]; A[i] = B[i] = w; n++; }
      marks = {}; diffBlocks = [];
      render();
      say(n ? `Переслано ${n} ${plural(n, ['блок', 'блока', 'блоков'])}: победила более новая версия. Корни снова равны.` : 'Реплики уже одинаковы.', 'ok');
    }
    function reset() {
      stopAnim();
      A = Array.from({ length: N }, (_, i) => `${i}:v1`);
      B = [...A];
      marks = {}; diffBlocks = [];
      stats.innerHTML = '';
      render();
      say('Две реплики по 8 блоков. Хеши — 16 бит для наглядности; в жизни SHA-256 или MurmurHash.');
    }
    reset();
    return { stop: stopAnim };
  });

  // ---------------------------------------------------------------- token bucket
  Deck.demo('bucket', root => {
    let tokens = 10, ok = 0, rej = 0, flow = false, flowAcc = 0;
    const hist = [];
    const mk = (label, min, max, val, unit) => {
      const out = h('output');
      const input = h('input', { type: 'range', min, max, value: val, 'aria-label': label });
      const set = () => { out.textContent = input.value + unit; };
      set();
      input.addEventListener('input', () => { set(); tokens = Math.min(tokens, cap()); draw(); });
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label tb-l' }, label), input, out));
      return () => +input.value;
    };
    const cap = mk('ёмкость b', 1, 20, 10, '');
    const rate = mk('скорость r', 1, 10, 2, '/с');
    const flowBtn = h('button', { class: 'btn small', onclick: () => { flow = !flow; flowBtn.classList.toggle('sel', flow); say(flow ? 'Ровный поток 5 запросов в секунду. Если r меньше 5 — запас кончится, и часть запросов получит 429.' : 'Поток остановлен.'); } }, 'Поток 5/с');
    const bucket = h('div', { class: 'tb-bucket' });
    const histEl = h('div', { class: 'tb-hist' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary small', onclick: () => { const a = req(); say(a ? `Запрос прошёл, жетонов осталось ${Math.floor(tokens)}.` : 'Жетонов нет → 429 Too Many Requests. Клиенту — заголовок Retry-After.', a ? 'ok' : 'bad'); } }, 'Запрос'),
        h('button', { class: 'btn small', onclick: burst }, 'Пачка ×15'),
        flowBtn,
      ),
      h('div', { class: 'tb-row' }, bucket, h('div', { class: 'tb-side' }, stats, histEl)),
      logEl,
    );
    function req() {
      const a = tokens >= 1;
      if (a) { tokens -= 1; ok++; } else rej++;
      hist.push(a);
      if (hist.length > 40) hist.shift();
      draw();
      return a;
    }
    function burst() {
      let a = 0;
      for (let i = 0; i < 15; i++) if (req()) a++;
      say(`Пачка из 15: прошло ${a} — весь накопленный запас, ${15 - a} получили 429. Дальше — не быстрее ${rate()} в секунду.`, a < 15 ? 'warn' : 'ok');
    }
    function draw() {
      const b = cap();
      bucket.innerHTML = `<div class="tb-fill" style="height:${(tokens / b) * 100}%"></div><span>${dec(tokens, 1)} / ${b}</span>`;
      stats.innerHTML = `<div class="stat"><b>${ok}</b><span>прошло</span></div><div class="stat${rej ? ' warn' : ''}"><b>${rej}</b><span>отказ 429</span></div>`;
      histEl.innerHTML = hist.map(x => `<i class="${x ? 'ok' : 'no'}"></i>`).join('') || '<span class="empty">последние запросы</span>';
    }
    let t = 0;
    const loop = rafLoop(dt => {
      tokens = Math.min(cap(), tokens + dt * rate());
      if (flow) { flowAcc += dt * 5; while (flowAcc >= 1) { flowAcc -= 1; req(); } }
      t += dt;
      if (t > 0.1) { t = 0; draw(); }
    });
    draw();
    say('Ведро полное: 10 жетонов. Нажмите «Пачка ×15», затем посмотрите, как жетоны капают обратно.');
    return { start: loop.start, stop: loop.stop };
  });
})();

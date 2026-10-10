// Demos for slides 12–17: struct padding, boxed vs flat arrays, CPython int, UTF-8, string truncation.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const fmt = n => n.toLocaleString('ru-RU');
  const bytesWord = n => plural(n, ['байт', 'байта', 'байт']);

  // ---------------------------------------------------------------- struct alignment and padding (Go, amd64)
  Deck.demo('struct', root => {
    const ORIG = [
      { name: 'Paid', type: 'bool', size: 1, c: 0 },
      { name: 'ID', type: 'int64', size: 8, c: 1 },
      { name: 'Kind', type: 'uint8', size: 1, c: 2 },
      { name: 'Qty', type: 'int32', size: 4, c: 3 },
      { name: 'Flag', type: 'bool', size: 1, c: 4 },
      { name: 'Price', type: 'float64', size: 8, c: 5 },
    ];
    let fields = ORIG.slice();
    const list = h('div', { class: 'st-list' });
    const grid = h('div', { class: 'st-grid' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn small primary', onclick: sortFields }, 'По убыванию размера'),
        h('button', { class: 'btn small', onclick: () => { fields = ORIG.slice(); render('Исходный порядок: однобайтовые поля стоят между восьмибайтовыми, и после каждого — дыра.'); } }, 'Исходный порядок')),
      h('div', { class: 'st-cols' }, list, h('div', { class: 'st-mem' }, h('span', { class: 'label' }, 'Память, по 8 байт в строке'), grid)),
      stats, logEl,
    );

    function layout() {
      let off = 0, maxA = 1;
      const placed = fields.map(f => {
        const a = f.size; // for Go basic types alignment equals size on amd64
        maxA = Math.max(maxA, a);
        off = Math.ceil(off / a) * a;
        const p = { ...f, off };
        off += f.size;
        return p;
      });
      return { placed, size: Math.ceil(off / maxA) * maxA, align: maxA };
    }
    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= fields.length) return;
      [fields[i], fields[j]] = [fields[j], fields[i]];
      render(`${fields[j].name} передвинут ${d < 0 ? 'выше' : 'ниже'}.`);
    }
    function sortFields() {
      fields = fields.slice().sort((a, b) => b.size - a.size);
      render('Отсортировали по убыванию выравнивания: мелкие поля упаковались в хвост, дыр почти не осталось.');
    }
    function render(text) {
      const { placed, size, align } = layout();
      const useful = fields.reduce((s, f) => s + f.size, 0);
      list.innerHTML = '';
      placed.forEach((f, i) => {
        list.append(h('div', { class: 'st-f' },
          h('span', { class: 'sw f' + f.c }),
          h('code', null, h('b', null, f.name), ' ' + f.type),
          h('small', null, `+${f.off}`),
          h('button', { class: 'st-mv', 'aria-label': 'Выше', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'st-mv', 'aria-label': 'Ниже', disabled: i === placed.length - 1, onclick: () => move(i, 1) }, '↓')));
      });
      const owner = Array(size).fill(-1);
      placed.forEach(f => { for (let k = 0; k < f.size; k++) owner[f.off + k] = f.c; });
      grid.innerHTML = owner.map((c, i) => {
        const f = placed.find(p => p.c === c);
        const first = f && f.off === i;
        return `<span class="st-b ${c < 0 ? 'pad' : 'f' + c}">${first ? f.name : ''}</span>`;
      }).join('');
      const pad = size - useful;
      stats.innerHTML = `<div class="stat"><b>${size} ${bytesWord(size)}</b><span>unsafe.Sizeof</span></div>` +
        `<div class="stat ${pad > 8 ? 'warn' : ''}"><b>${pad} ${bytesWord(pad)}</b><span>паддинг, ${Math.round(pad / size * 100)}%</span></div>` +
        `<div class="stat"><b>${fmt(size)} МБ</b><span>миллион таких в []Order</span></div>`;
      logEl.innerHTML = `${text} Полезных данных ${useful} ${bytesWord(useful)}, выравнивание структуры ${align}, размер округлён до ${size}.`;
    }
    render('Порядок полей как в коде. Серые клетки — паддинг: компилятор пропускает байты, чтобы ID и Price начинались с адреса, кратного 8.');
    return {};
  });

  // ---------------------------------------------------------------- flat array vs array of pointers, cache lines
  Deck.demo('boxed', root => {
    const N = 8, LINES = 10, CELLS = 16; // a line is 64 bytes = 16 cells of 4 bytes
    const MODES = [
      { key: 'flat', label: 'Go []int64, long[], NumPy', ref: 8, obj: 0, mb: 8, per: '8 байт на число, без заголовков' },
      { key: 'java', label: 'Java Integer[]', ref: 4, obj: 16, mb: 20, per: 'ссылка 4 байта + объект Integer 16 байт (заголовок 12 + int 4)' },
      { key: 'py', label: 'Python list', ref: 8, obj: 32, mb: 40, per: 'указатель 8 байт + объект int 28 байт, в куче — блок 32' },
    ];
    let mi = 2, scattered = false, cells, slots, step, loaded, misses, running = false;
    const mBtns = h('div', { class: 'controls' });
    MODES.forEach((m, i) => mBtns.append(h('button', { class: 'btn small', onclick: () => { mi = i; build(); } }, m.label)));
    const scat = h('input', { type: 'checkbox' });
    scat.addEventListener('change', () => { scattered = scat.checked; build(); });
    const runBtn = h('button', { class: 'btn primary', onclick: run }, 'Пройти по массиву');
    const memEl = h('div', { class: 'bx-mem' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(
      mBtns,
      h('div', { class: 'controls' }, runBtn, h('label', { class: 'toggle' }, scat, h('span', null, 'объекты разбросаны по куче'))),
      memEl,
      h('div', { class: 'bx-legend' },
        h('span', { class: 'sw val' }), 'число', h('span', { class: 'sw ref' }), 'указатель',
        h('span', { class: 'sw hdr' }), 'заголовок', h('span', { class: 'sw oth' }), 'чужие данные', h('span', { class: 'sw ld' }), 'строка в кэше'),
      stats, logEl,
    );
    // A timer rather than rAF: steps are discrete, and the pace should not depend on frame rate.
    let timer = 0;
    const loop = {
      start() { if (!timer) timer = setInterval(() => { if (running) advance(); }, 380); },
      stop() { clearInterval(timer); timer = 0; },
    };

    function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    // Build the memory picture: cells[line*16 + k] = { t: 'val'|'ref'|'hdr'|'oth'|'free', e: element index }
    function build() {
      const m = MODES[mi];
      mBtns.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', i === mi));
      scat.disabled = m.key === 'flat';
      cells = Array.from({ length: LINES * CELLS }, () => ({ t: 'oth', e: -1 }));
      slots = []; // for each element: [array cell indexes, object cell indexes]
      const refCells = m.ref / 4, objCells = m.obj / 4;
      for (let e = 0; e < N; e++) {
        const a = [];
        for (let k = 0; k < refCells; k++) { const c = e * refCells + k; cells[c] = { t: m.key === 'flat' ? 'val' : 'ref', e }; a.push(c); }
        slots.push([a, []]);
      }
      if (objCells) {
        const arrEnd = N * refCells;
        let starts;
        if (!scattered) starts = Array.from({ length: N }, (_, e) => arrEnd + e * objCells);
        else {
          // one object per randomly chosen line, at a random aligned slot in it
          const perLine = CELLS / objCells;
          starts = shuffle(Array.from({ length: LINES - 1 }, (_, i) => i + 1)).slice(0, N)
            .map(line => line * CELLS + Math.floor(Math.random() * perLine) * objCells);
        }
        starts.forEach((s0, e) => {
          for (let k = 0; k < objCells; k++) {
            let t = 'hdr';
            if (m.key === 'java' && k === 3) t = 'val';
            if (m.key === 'py') t = k === 6 ? 'val' : k === 7 ? 'free' : 'hdr';
            cells[s0 + k] = { t, e };
            slots[e][1].push(s0 + k);
          }
        });
        if (!scattered) for (let c = arrEnd + N * objCells; c < LINES * CELLS && c < Math.ceil((arrEnd + N * objCells) / CELLS) * CELLS; c++) cells[c] = { t: 'free', e: -1 };
      } else {
        for (let c = N * refCells; c < CELLS; c++) cells[c] = { t: 'free', e: -1 };
      }
      reset();
      logEl.innerHTML = `${m.label}: ${m.per}. Нажмите «Пройти по массиву» — программа сложит все ${N} чисел.`;
      logEl.className = 'log';
    }
    function reset() {
      step = -1; loaded = new Set(); misses = 0; running = false;
      runBtn.textContent = 'Пройти по массиву';
      render(-1, []);
    }
    const lineOf = c => Math.floor(c / CELLS);
    function touch(cs) {
      for (const c of cs) { const l = lineOf(c); if (!loaded.has(l)) { loaded.add(l); misses++; } }
    }
    // Each element takes two phases for boxed modes: read the pointer, then follow it.
    function advance() {
      const m = MODES[mi];
      const phases = m.obj ? 2 : 1;
      step++;
      const e = Math.floor(step / phases), ph = step % phases;
      if (e >= N) { finish(); return; }
      const cs = slots[e][ph];
      touch(cs);
      render(e, cs);
    }
    function finish() {
      running = false;
      runBtn.textContent = 'Ещё раз';
      const m = MODES[mi];
      render(-1, []);
      const per = misses / N;
      let text = `Сумма готова: ${misses} ${plural(misses, ['строка', 'строки', 'строк'])} кэша на ${N} чисел — ${misses * 64} ${bytesWord(misses * 64)} из памяти ради ${m.key === 'java' ? 32 : 64} ${bytesWord(m.key === 'java' ? 32 : 64)} самих чисел.`;
      if (m.key === 'flat') text += ' Одна строка — все восемь чисел, а предвыборка процессора заранее тянет следующую.';
      else if (scattered) text += ` Почти каждое число — промах кэша, а адрес объекта известен только после чтения указателя, и предвыборка не помогает: процессор ждёт ~100 нс на каждом.`;
      else text += ' Объекты созданы подряд и лежат рядом — повезло. После сборок мусора, вставок и сортировок они разбегаются: включите «разбросаны».';
      logEl.innerHTML = text;
      logEl.className = 'log ' + (per > 1 ? 'bad' : per > 0.3 ? 'warn' : 'ok');
    }
    function run() {
      if (running) return;
      reset();
      running = true;
      runBtn.textContent = 'Идём…';
      advance();
    }
    function render(cur, active) {
      const m = MODES[mi];
      const act = new Set(active);
      let html = '';
      for (let l = 0; l < LINES; l++) {
        html += `<div class="bx-line${loaded.has(l) ? ' ld' : ''}"><span class="bx-addr">${l * 64}</span>`;
        for (let k = 0; k < CELLS; k++) {
          const c = l * CELLS + k, cell = cells[c];
          html += `<i class="${cell.t}${act.has(c) ? ' cur' : ''}${cell.e >= 0 && cell.e === cur ? ' el' : ''}"></i>`;
        }
        html += '</div>';
      }
      memEl.innerHTML = html;
      const fullLines = m.key === 'flat' ? 125000 : m.key === 'java' ? 62500 + (scattered ? 1e6 : 250000) : 125000 + (scattered ? 1e6 : 500000);
      stats.innerHTML = `<div class="stat"><b>${misses}</b><span>строк кэша загружено</span></div>` +
        `<div class="stat ${m.mb > 8 ? 'warn' : ''}"><b>${m.mb} МБ</b><span>на миллион чисел</span></div>` +
        `<div class="stat ${fullLines > 125000 ? 'warn' : ''}"><b>${fullLines >= 1e6 ? (fullLines / 1e6).toFixed(2).replace('.', ',') + ' млн' : fmt(fullLines / 1000) + ' тыс'}</b><span>строк на миллион</span></div>`;
    }
    build();
    return { start: loop.start, stop: loop.stop };
  });

  // ---------------------------------------------------------------- CPython int object
  Deck.demo('pyint', root => {
    const PRESETS = [['0', '0'], ['256', '256'], ['257', '257'], ['2**30', '2**30'], ['2**63 − 1', '2**63-1'], ['−2**64', '-2**64'], ['10**100', '10**100']];
    const input = h('input', { class: 'num-in wide', type: 'text', value: '2**64', 'aria-label': 'Целое число', spellcheck: 'false' });
    const obj = h('div', { class: 'py-obj' });
    const bar = h('div', { class: 'py-bar' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' }, input),
      h('div', { class: 'controls' }, PRESETS.map(([l, v]) => h('button', { class: 'btn small', onclick: () => { input.value = v; read(); } }, l))),
      obj, bar, stats, logEl,
    );
    input.addEventListener('change', read);

    function parse(t) {
      t = t.replace(/[\s_]/g, '').replace(/−/g, '-');
      const m = t.match(/^(-?)(\d+)\*\*(\d+)([-+]\d+)?$/);
      if (m) {
        if (+m[3] > 20000) return null;
        let v = BigInt(m[2]) ** BigInt(m[3]);
        if (m[4]) v += BigInt(m[4]);
        return m[1] ? -v : v;
      }
      return /^-?\d{1,6000}$/.test(t) ? BigInt(t) : null;
    }
    function read() {
      const v = parse(input.value);
      if (v == null) { logEl.textContent = 'Введите целое число, например 12345 или 2**100.'; return; }
      render(v);
    }
    const sup = n => String(n).replace(/./g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
    function render(v) {
      const neg = v < 0n;
      let a = neg ? -v : v;
      const digits = [];
      while (a > 0n) { digits.push(Number(a & 0x3FFFFFFFn)); a >>= 30n; }
      const nd = digits.length;
      const size = 24 + 4 * Math.max(1, nd);
      const alloc = Math.ceil(size / 16) * 16;
      const small = v >= -5n && v <= 256n;
      const SHOW = 4;
      const rows = [
        ['ob_refcnt', 8, small ? 'бессмертный' : 'счётчик ссылок'],
        ['ob_type', 8, '→ PyLong_Type'],
        ['lv_tag', 8, `${nd} ${plural(nd, ['цифра', 'цифры', 'цифр'])}, знак ${neg ? '−' : nd ? '+' : '0'}`],
      ];
      (nd ? digits : [0]).slice(0, SHOW).forEach((d, i) => rows.push([`ob_digit[${i}]`, 4, fmt(d)]));
      obj.innerHTML = rows.map(([n, s, val], i) => `<div class="py-row ${i < 3 ? 'hd' : 'dg'}"><code>${n}</code><small>${s} Б</small><b>${val}</b></div>`).join('') +
        (nd > SHOW ? `<div class="py-row more">… ещё ${nd - SHOW} ${plural(nd - SHOW, ['цифра', 'цифры', 'цифр'])} по 4 байта</div>` : '');
      const W = Math.max(alloc, 64);
      bar.innerHTML = `<span class="hd" style="width:${24 / W * 100}%">заголовок 24</span>` +
        `<span class="dg" style="width:${(size - 24) / W * 100}%">${size - 24}</span>` +
        (alloc > size ? `<span class="pd" style="width:${(alloc - size) / W * 100}%"></span>` : '');
      const bits = v === 0n ? 0 : (neg ? -v : v).toString(2).length;
      const goSize = bits <= 63 ? '8 Б' : 'не влезет';
      stats.innerHTML = `<div class="stat"><b>${size} Б</b><span>sys.getsizeof</span></div>` +
        `<div class="stat"><b>${alloc} Б</b><span>блок в куче (кратно 16)</span></div>` +
        `<div class="stat ${bits > 63 ? 'warn' : ''}"><b>${goSize}</b><span>Go int64</span></div>`;
      if (small) logEl.innerHTML = `Число из кэша от −5 до 256: объект создан при старте интерпретатора, <code>x = ${v}</code> ничего не выделяет. С 3.12 такие объекты «бессмертные» — их счётчик ссылок не меняется.`;
      else if (nd <= 1) logEl.innerHTML = `Одна 30-битная цифра. Даже такое число — отдельный объект в куче на ${alloc} байт против 8 байт в Go или Java <code>long</code>.`;
      else logEl.innerHTML = `${bits} ${plural(bits, ['бит', 'бита', 'бит'])} → ${nd} ${plural(nd, ['цифра', 'цифры', 'цифр'])} по 30 бит: значение = d₀ + d₁·2³⁰ + d₂·2⁶⁰ + … Сложение таких чисел — цикл по цифрам, как в столбик.`;
      logEl.className = 'log';
    }
    read();
    return {};
  });

  // ---------------------------------------------------------------- shared string helpers
  const enc = new TextEncoder();
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ru', { granularity: 'grapheme' }) : null;
  const graphemes = s => (seg ? Array.from(seg.segment(s), x => x.segment) : Array.from(s));
  const hexb = b => b.toString(16).padStart(2, '0').toUpperCase();
  const cpName = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  function glyph(ch) {
    const cp = ch.codePointAt(0);
    if (cp === 0x200D) return 'ZWJ';
    if (cp === 0xFE0F) return 'VS16';
    if (cp === 0x20) return '␠';
    if (cp >= 0x1F3FB && cp <= 0x1F3FF) return ch;
    if (/\p{M}/u.test(ch)) return '◌' + ch;
    return ch;
  }

  // ---------------------------------------------------------------- UTF-8 explorer
  Deck.demo('utf8', root => {
    const PRESETS = [['Hello', 'Hello'], ['Привет', 'Привет'], ['€', '€'], ['😀', '😀'], ['👍🏽', '👍🏽'], ['é и é', 'é и é'], ['👨‍👩‍👧', '👨‍👩‍👧']];
    const input = h('input', { class: 'num-in wide txt', type: 'text', value: 'Hi, Мир € 😀', 'aria-label': 'Текст', spellcheck: 'false' });
    const chars = h('div', { class: 'u8-chars' });
    const bitsEl = h('div', { class: 'u8-bits' });
    const stats = h('div', { class: 'stats four' });
    let sel = 0;
    root.append(
      h('div', { class: 'controls' }, input),
      h('div', { class: 'controls' }, PRESETS.map(([l, v]) => h('button', { class: 'btn small', onclick: () => { input.value = v; sel = 0; render(); } }, l))),
      stats, chars, bitsEl,
    );
    input.addEventListener('input', () => { sel = 0; render(); });

    function render() {
      const s = input.value.slice(0, 60);
      const cps = Array.from(s);
      if (sel >= cps.length) sel = 0;
      const u8 = enc.encode(s);
      stats.innerHTML = `<div class="stat"><b>${cps.length}</b><span>кодовых точек</span></div>` +
        `<div class="stat"><b>${u8.length}</b><span>байт UTF-8</span></div>` +
        `<div class="stat"><b>${s.length}</b><span>UTF-16, .length</span></div>` +
        `<div class="stat"><b>${graphemes(s).length}</b><span>графем</span></div>`;
      chars.innerHTML = '';
      cps.slice(0, 24).forEach((ch, i) => {
        const bs = enc.encode(ch);
        chars.append(h('button', { class: 'u8-c n' + bs.length + (i === sel ? ' sel' : ''), onclick: () => { sel = i; render(); } },
          h('span', { class: 'g' }, glyph(ch)),
          h('small', null, cpName(ch.codePointAt(0))),
          h('span', { class: 'bs' }, Array.from(bs, hexb).join(' '))));
      });
      if (!cps.length) { bitsEl.innerHTML = '<p class="empty">Пустая строка — ноль байт.</p>'; return; }
      const ch = cps[sel], cp = ch.codePointAt(0), bs = enc.encode(ch);
      const n = bs.length;
      const payload = [7, 11, 16, 21][n - 1];
      const pb = cp.toString(2).padStart(payload, '0');
      let pos = 0;
      const parts = Array.from(bs, (b, i) => {
        const pre = i === 0 ? ['0', '110', '1110', '11110'][n - 1] : '10';
        const take = 8 - pre.length;
        const body = pb.slice(pos, pos + take);
        pos += take;
        return `<span class="u8-byte"><i>${pre}</i><b>${body}</b><small>${hexb(b)}</small></span>`;
      }).join('');
      const u16 = ch.length === 2 ? ` В UTF-16 — суррогатная пара <code>${ch.charCodeAt(0).toString(16).toUpperCase()} ${ch.charCodeAt(1).toString(16).toUpperCase()}</code>, поэтому <code>.length</code> = 2.` : '';
      bitsEl.innerHTML = `<div class="u8-head"><b>${glyph(ch)}</b> ${cpName(cp)} = ${fmt(cp)} → ${payload} значащих бит → ${n} ${bytesWord(n)}</div><div class="u8-bytes">${parts}</div>` +
        `<p class="note">Серым — служебные биты, цветом — биты номера символа.${u16}</p>`;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- truncation in different units
  Deck.demo('truncate', root => {
    const S = 'Привет, 👋🏽 мир';
    const gr = graphemes(S);
    const grOf = []; // grapheme index for each code point
    gr.forEach((g, gi) => Array.from(g).forEach(() => grOf.push(gi)));
    const MODES = [
      { key: 'u8', label: 'байты UTF-8', who: 'Go <code>s[:n]</code>, C, лимиты в байтах' },
      { key: 'u16', label: 'UTF-16', who: 'JS <code>slice</code>, Java <code>substring</code>' },
      { key: 'cp', label: 'кодовые точки', who: 'Python <code>s[:n]</code>, Go <code>[]rune</code>' },
      { key: 'gr', label: 'графемы', who: '<code>Intl.Segmenter</code>, ICU, Swift' },
    ];
    // units for each mode: { label, g: grapheme index }
    const units = { u8: [], u16: [], cp: [], gr: [] };
    Array.from(S).forEach((ch, ci) => {
      const g = grOf[ci];
      units.cp.push({ t: glyph(ch), g });
      enc.encode(ch).forEach(b => units.u8.push({ t: hexb(b), g }));
      for (let k = 0; k < ch.length; k++) units.u16.push({ t: ch.charCodeAt(k).toString(16).toUpperCase(), g });
    });
    gr.forEach((g, gi) => units.gr.push({ t: g === ' ' ? '␠' : g, g: gi }));

    let mi = 0;
    const mBtns = h('div', { class: 'controls' });
    MODES.forEach((m, i) => mBtns.append(h('button', { class: 'btn small', onclick: () => { const frac = +slider.value / units[MODES[mi].key].length; mi = i; slider.max = units[m.key].length; slider.value = Math.round(frac * slider.max); render(); } }, m.label)));
    const slider = h('input', { type: 'range', min: 0, max: units.u8.length, value: 17, 'aria-label': 'Обрезать до' });
    const nOut = h('output');
    slider.addEventListener('input', render);
    const strip = h('div', { class: 'tr-strip' });
    const result = h('div', { class: 'tr-result' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(h('span', { class: 'label' }, 'Режем по'), mBtns, h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'оставить'), slider, nOut), strip, result, logEl);

    const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
    function cut(key, n) {
      if (key === 'u8') return new TextDecoder().decode(enc.encode(S).slice(0, n));
      if (key === 'u16') return S.slice(0, n).replace(LONE, '�');
      if (key === 'cp') return Array.from(S).slice(0, n).join('');
      return gr.slice(0, n).join('');
    }
    function render() {
      const m = MODES[mi], us = units[m.key], n = +slider.value;
      mBtns.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', i === mi));
      nOut.textContent = n;
      strip.className = 'tr-strip ' + m.key;
      strip.innerHTML = us.map((u, i) => `<span class="${u.g % 2 ? 'odd' : 'even'}${i >= n ? ' cut' : ''}${i === n - 1 ? ' last' : ''}">${u.t}</span>`).join('');
      const r = cut(m.key, n);
      const broken = r.includes('�');
      const splitG = !broken && n > 0 && n < us.length && us[n - 1].g === us[n].g;
      result.innerHTML = `<span class="label">${m.who}</span><b>«${r.replace(/�/g, '<span class="bad">�</span>')}»</b><small>${broken ? 'невалидная строка' : enc.encode(r).length + ' ' + bytesWord(enc.encode(r).length) + ' в UTF-8'}</small>`;
      if (broken) logEl.innerHTML = 'Разрезали символ посередине. Остаток — невалидная последовательность, декодер подставит �, а строгий парсер (JSON, protobuf, база с проверкой кодировки) выдаст ошибку.';
      else if (splitG) logEl.innerHTML = 'Кодировка цела, но графема разорвана: от 👋🏽 остался 👋 без цвета кожи, а «й» из «и» + U+0306 превратилось бы в «и». Пользователь увидит не тот символ.';
      else logEl.innerHTML = m.key === 'gr' ? 'По графемам резать всегда безопасно — так и делают поля ввода и счётчики символов.' : 'Здесь граница случайно пришлась между символами. Подвиньте ползунок.';
      logEl.className = 'log ' + (broken ? 'bad' : splitG ? 'warn' : 'ok');
    }
    render();
    return {};
  });
})();

// Demos for slides 2–11: bits and hex, memory as bytes, two's complement, overflow, IEEE 754, money, endianness.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const fmt = n => n.toLocaleString('ru-RU');
  const hex2 = b => b.toString(16).padStart(2, '0').toUpperCase();
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');

  // ---------------------------------------------------------------- 32-bit number: bits ↔ hex ↔ decimal
  Deck.demo('hex32', root => {
    let v = 0x7FFFFFFF >>> 0;
    const head = h('div', { class: 'hx-head' });
    const rows = h('div', { class: 'hx-rows' });
    const input = h('input', { class: 'num-in', type: 'text', inputmode: 'text', 'aria-label': 'Число', spellcheck: 'false' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    const PRESETS = [['255', 255], ['256', 256], ['65 535', 0xFFFF], ['1 000 000', 1e6], ['0xDEADBEEF', 0xDEADBEEF], ['2³¹ − 1', 0x7FFFFFFF]];
    const bitBtns = [];
    for (let byte = 3; byte >= 0; byte--) {
      const row = h('div', { class: 'hx-row' });
      row.append(h('span', { class: 'hx-bn' }, 'байт ' + byte));
      for (let nib = 1; nib >= 0; nib--) {
        const grp = h('span', { class: 'hx-nib' });
        for (let k = 3; k >= 0; k--) {
          const bit = byte * 8 + nib * 4 + k;
          const b = h('button', { class: 'bit', 'aria-label': 'бит ' + bit, onclick: () => flip(bit) });
          bitBtns[bit] = b;
          grp.append(b);
        }
        grp.append(h('b', { class: 'hx-digit', 'data-nib': byte * 2 + nib }));
        row.append(grp);
      }
      row.append(h('span', { class: 'hx-dec', 'data-byte': byte }));
      rows.append(row);
    }
    root.append(
      head, rows,
      h('div', { class: 'controls' }, input,
        PRESETS.map(([label, val]) => h('button', { class: 'btn small', onclick: () => set(val, `Пример: ${label}.`) }, label))),
      logEl,
    );
    input.addEventListener('change', () => {
      const t = input.value.trim().replace(/[\s_]/g, '');
      const n = /^0x[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : /^0b[01]+$/i.test(t) ? parseInt(t.slice(2), 2) : /^\d+$/.test(t) ? Number(t) : NaN;
      if (!Number.isFinite(n) || n > 0xFFFFFFFF) { say('Введите целое от 0 до 4 294 967 295, можно в виде 0x… или 0b….'); return; }
      set(n, `Ввели ${t}.`);
    });
    const say = t => { logEl.innerHTML = t; };

    function flip(bit) {
      const on = !((v >>> bit) & 1);
      v = (v ^ (1 << bit)) >>> 0;
      const w = 2 ** bit;
      say(`Бит ${bit} ${on ? 'включён' : 'выключен'}: ${on ? '+' : '−'}${fmt(w)} (2<sup>${bit}</sup>). Он в hex-цифре №${Math.floor(bit / 4)} справа и весит в ней ${1 << (bit % 4)}.`);
      render();
    }
    function set(n, why) {
      v = n >>> 0;
      const bytes = v === 0 ? 1 : Math.ceil(Math.log2(v + 1) / 8);
      say(`${why} Значащих битов: ${v ? Math.floor(Math.log2(v)) + 1 : 0} — ${plural(bytes, ['нужен', 'нужно', 'нужно'])} ${bytes} ${plural(bytes, ['байт', 'байта', 'байт'])}.`);
      render();
    }
    function render() {
      for (let i = 0; i < 32; i++) {
        const on = (v >>> i) & 1;
        bitBtns[i].textContent = on;
        bitBtns[i].classList.toggle('on', !!on);
      }
      rows.querySelectorAll('.hx-digit').forEach(d => { d.textContent = ((v >>> (d.dataset.nib * 4)) & 15).toString(16).toUpperCase(); });
      rows.querySelectorAll('.hx-dec').forEach(d => { d.textContent = (v >>> (d.dataset.byte * 8)) & 255; });
      const hx = v.toString(16).toUpperCase().padStart(8, '0');
      head.innerHTML = `<div><span class="label">десятичное</span><b>${fmt(v)}</b></div>` +
        `<div><span class="label">hex</span><b>0x${hx.slice(0, 4)}_${hx.slice(4)}</b></div>` +
        `<div><span class="label">как int32</span><b>${fmt(v | 0)}</b></div>`;
      input.value = '0x' + hx;
    }
    say('Сейчас 2³¹ − 1 — максимальный <code>int32</code>: старший бит 0, остальные единицы. Нажмите на старший бит.');
    render();
    return {};
  });

  // ---------------------------------------------------------------- memory as an array of bytes
  Deck.demo('memory', root => {
    const BASE = 0x1000, N = 32;
    const buf = new ArrayBuffer(N);
    const dv = new DataView(buf);
    dv.setInt32(0, 1000, true);
    dv.setUint8(4, 0x41);
    dv.setFloat64(8, Math.PI, true);
    [...'hello'].forEach((c, i) => dv.setUint8(16 + i, c.charCodeAt(0)));
    dv.setBigUint64(24, BigInt(BASE), true);
    const VARS = [
      { name: 'n', type: 'int32', off: 0, size: 4, cls: 'v1', text: 'n int32 = 1000. Little-endian: младший байт <code>e8</code> лежит первым — 0x03E8 = 1000.' },
      { name: 'c', type: 'byte', off: 4, size: 1, cls: 'v2', text: "c byte = 'A'. Символ — это просто число 0x41 = 65 по таблице ASCII. За ним 3 байта выравнивания." },
      { name: 'pi', type: 'float64', off: 8, size: 8, cls: 'v3', text: 'pi float64 = 3.14159… Восемь байтов в формате IEEE 754 — об этом через пару слайдов.' },
      { name: 's', type: '[6]byte', off: 16, size: 6, cls: 'v4', text: 's = "hello" и нулевой байт в конце — так строки хранит C.' },
      { name: 'p', type: '*int32', off: 24, size: 8, cls: 'v5', text: 'p *int32 = &amp;n. Значение указателя — 0x1000, адрес переменной n. Разыменовать — прочитать 4 байта по этому адресу.' },
    ];
    const TYPES = [
      ['uint8', 1, o => dv.getUint8(o)],
      ['int32', 4, o => dv.getInt32(o, true)],
      ['uint32', 4, o => dv.getUint32(o, true)],
      ['float32', 4, o => dv.getFloat32(o, true)],
      ['int64', 8, o => dv.getBigInt64(o, true)],
      ['float64', 8, o => dv.getFloat64(o, true)],
      ['ASCII', 4, o => '"' + [0, 1, 2, 3].map(i => { const c = dv.getUint8(o + i); return c >= 32 && c < 127 ? String.fromCharCode(c) : '·'; }).join('') + '"'],
    ];
    let off = 0, type = 1, varSel = 0;
    const chips = h('div', { class: 'controls' });
    const types = h('div', { class: 'controls' });
    const grid = h('div', { class: 'mem-grid' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    VARS.forEach((vr, i) => chips.append(h('button', { class: 'btn small mem-chip ' + vr.cls, onclick: () => pickVar(i) }, h('code', null, vr.name + ' ' + vr.type))));
    TYPES.forEach(([name], i) => types.append(h('button', { class: 'btn small', onclick: () => { type = i; varSel = -1; interpret(); } }, name)));
    const cells = [];
    for (let r = 0; r < N / 8; r++) {
      grid.append(h('span', { class: 'mem-addr' }, '0x' + (BASE + r * 8).toString(16)));
      for (let c = 0; c < 8; c++) {
        const i = r * 8 + c;
        const vr = VARS.find(x => i >= x.off && i < x.off + x.size);
        const cell = h('button', { class: 'mem-b ' + (vr ? vr.cls : 'pad'), 'aria-label': 'адрес 0x' + (BASE + i).toString(16), onclick: () => { off = i; varSel = -1; interpret(); } }, hex2(dv.getUint8(i)).toLowerCase());
        cells.push(cell);
        grid.append(cell);
      }
    }
    root.append(h('span', { class: 'label' }, 'Переменные'), chips, grid, h('span', { class: 'label' }, 'Прочитать с выбранного адреса как'), types, logEl);

    function pickVar(i) {
      varSel = i;
      const vr = VARS[i];
      off = vr.off;
      logEl.innerHTML = `<b>0x${(BASE + vr.off).toString(16)}</b>, ${vr.size} ${plural(vr.size, ['байт', 'байта', 'байт'])}: ${vr.text}`;
      render(vr.size);
    }
    function interpret() {
      const [name, size, read] = TYPES[type];
      if (off + size > N) {
        logEl.innerHTML = `${name} — это ${size} ${plural(size, ['байт', 'байта', 'байт'])}, а с адреса 0x${(BASE + off).toString(16)} до конца дампа меньше. Выберите байт левее.`;
        render(0);
        return;
      }
      let val = read(off);
      if (typeof val === 'number' && !Number.isInteger(val)) val = Math.abs(val) < 1e-6 && val !== 0 ? val.toExponential(4) : String(+val.toPrecision(8));
      const bytes = Array.from({ length: size }, (_, i) => hex2(dv.getUint8(off + i)).toLowerCase()).join(' ');
      logEl.innerHTML = `Байты <code>${bytes}</code> с адреса <b>0x${(BASE + off).toString(16)}</b> как <code>${name}</code> = <b>${typeof val === 'bigint' ? fmt(val) : val}</b>`;
      render(size);
    }
    function render(size) {
      cells.forEach((c, i) => c.classList.toggle('sel', i >= off && i < off + size));
      chips.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', i === varSel));
      types.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', varSel < 0 && i === type));
    }
    pickVar(0);
    return {};
  });

  // ---------------------------------------------------------------- 8-bit register with a wheel
  Deck.demo('register', root => {
    let u = 0b01111110;
    const NS = 'http://www.w3.org/2000/svg';
    const R = 64;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-100 -100 200 200');
    svg.setAttribute('class', 'rg-wheel');
    svg.setAttribute('aria-hidden', 'true');
    const pos = (val, r) => {
      const a = (val / 256) * Math.PI * 2 - Math.PI / 2;
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    let marks = `<circle r="${R}" class="rg-ring"/>`;
    // the upper half (0..127) is non-negative in both readings, the lower half differs
    marks += `<path class="rg-neg" d="M 0 ${R} A ${R} ${R} 0 0 1 0 ${-R}"/>`;
    for (const [val, a, b] of [[0, '0', ''], [64, '64', ''], [128, '128', '−128'], [192, '192', '−64']]) {
      const [x, y] = pos(val, R + 22);
      marks += `<text x="${x}" y="${y - (b ? 6 : -4)}" class="rg-t">${a}</text>` + (b ? `<text x="${x}" y="${y + 10}" class="rg-t s">${b}</text>` : '');
    }
    const [wx, wy] = pos(0, R), [sx, sy] = pos(128, R);
    marks += `<line x1="${wx}" y1="${wy - 9}" x2="${wx}" y2="${wy + 9}" class="rg-wrap"/>`;
    marks += `<line x1="${sx}" y1="${sy - 9}" x2="${sx}" y2="${sy + 9}" class="rg-wrap s"/>`;
    marks += '<line class="rg-hand" x1="0" y1="0" x2="0" y2="0"/><circle class="rg-dot" r="8"/>';
    marks += '<text class="rg-c" y="-4"></text><text class="rg-c s" y="14"></text>';
    svg.innerHTML = marks;
    const hand = svg.querySelector('.rg-hand'), dot = svg.querySelector('.rg-dot');
    const [cU, cS] = svg.querySelectorAll('.rg-c');

    const bits = h('div', { class: 'rg-bits' });
    const btns = [];
    for (let k = 7; k >= 0; k--) {
      const b = h('button', { class: 'bit', onclick: () => op(x => x ^ (1 << k), `Бит ${k} переключён.`) });
      btns[k] = b;
      bits.append(h('span', { class: 'rg-bit' }, b, h('small', null, k === 7 ? '±128' : String(1 << k))));
    }
    const vals = h('div', { class: 'rg-vals' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(
      bits,
      h('div', { class: 'rg-body' }, svg, vals),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => add(1) }, '+1'),
        h('button', { class: 'btn primary', onclick: () => add(-1) }, '−1'),
        h('button', { class: 'btn', onclick: () => op(x => ~x, 'Инверсия ~x: все биты наоборот. Для знакового это −x − 1.') }, h('code', null, '~x')),
        h('button', { class: 'btn', onclick: neg }, h('code', null, '−x')),
        h('button', { class: 'btn', onclick: () => op(() => 0, 'Сброс в ноль.') }, '0'),
      ),
      logEl,
    );
    const s8 = x => (x & 128 ? x - 256 : x);

    function op(f, text, cls = '') {
      u = f(u) & 255;
      logEl.innerHTML = text;
      logEl.className = 'log ' + cls;
      render();
    }
    function add(d) {
      const before = u, after = (u + d) & 255;
      const uWrap = before + d !== after;
      const sWrap = s8(before) + d !== s8(after);
      let t = `${before} ${d > 0 ? '+' : '−'} 1 = ${after}`;
      if (uWrap) t = `Беззнаково: ${before} ${d > 0 ? '+ 1 = 256' : '− 1 = −1'} не влезает в 8 бит — ${d > 0 ? 'перенос из старшего бита теряется' : 'заём'}, получаем ${after}. Как int8 всё честно: ${s8(before)} ${d > 0 ? '+' : '−'} 1 = ${s8(after)}.`;
      else if (sWrap) t = `Как uint8 всё честно: ${before} ${d > 0 ? '+' : '−'} 1 = ${after}. Как int8 — переполнение: ${s8(before)} ${d > 0 ? '+' : '−'} 1 = ${s8(after)}.`;
      else t = `${before} ${d > 0 ? '+' : '−'} 1 = ${after}; как int8: ${s8(after)}. Битовая операция одна и та же.`;
      op(() => after, t, uWrap || sWrap ? 'bad' : '');
    }
    function neg() {
      const s = s8(u);
      if (s === -128) op(x => -x, '−(−128) = −128: у −128 нет положительной пары, ~x + 1 даёт то же число. Это и есть ловушка <code>abs(MIN_VALUE)</code>.', 'bad');
      else op(x => -x, `−x = ~x + 1: ${s} → ${-s}. Поэтому вычитание — это сложение с инверсией.`);
    }
    function render() {
      btns.forEach((b, k) => { const on = (u >> k) & 1; b.textContent = on; b.classList.toggle('on', !!on); b.classList.toggle('sign', k === 7); });
      const [x, y] = pos(u, R);
      const [ix, iy] = pos(u, R - 22);
      hand.setAttribute('x1', ix);
      hand.setAttribute('y1', iy);
      hand.setAttribute('x2', x);
      hand.setAttribute('y2', y);
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      cU.textContent = u;
      cS.textContent = s8(u);
      vals.innerHTML = `<div><span class="label">uint8</span><b>${u}</b></div><div><span class="label">int8</span><b class="${u & 128 ? 'neg' : ''}">${s8(u)}</b></div>` +
        `<div><span class="label">hex</span><b>0x${hex2(u)}</b></div>`;
    }
    logEl.textContent = 'Сейчас 126. Нажмите +1 пару раз и посмотрите, что станет с int8.';
    render();
    return {};
  });

  // ---------------------------------------------------------------- how long until a counter overflows
  Deck.demo('counter', root => {
    const TYPES = [['int32', 2 ** 31], ['uint32', 2 ** 32], ['int64', 2 ** 63]];
    const RATES = [['1 в секунду', 1, 'секунды'], ['100 в секунду', 100, 'сотые'], ['1000 в секунду', 1e3, 'миллисекунды'], ['1 млн в секунду', 1e6, 'микросекунды'], ['1 млрд в секунду', 1e9, 'наносекунды']];
    const STORIES = {
      'int32 1': 'Unix-время в 32-битном <code>time_t</code> кончится 19 января 2038 года в 03:14:07 UTC — «проблема 2038». Встроенные системы и старые форматы файлов живут долго.',
      'int32 100': 'Boeing 787, 2015: счётчик сотых долей секунды в блоке управления генераторами переполнялся через 248 дней работы, и все генераторы отключались. Лекарство из директивы FAA — перезагружать самолёт.',
      'uint32 1000': 'Windows 95/98 зависала ровно через 49,7 дня непрерывной работы: 32-битный счётчик миллисекунд <code>GetTickCount</code> переполнялся. Заметили только через несколько лет — так долго их не держали включёнными.',
      'int32 1000': '<code>setTimeout</code> в браузере и Node хранит задержку в int32: таймер больше 24,8 дня сработает немедленно (Node предупредит и поставит 1 мс).',
      'int64 1000000000': 'Go <code>time.Duration</code> — int64 наносекунд: максимум около 292 лет. Хватит всем.',
      'int32 1000000': 'Счётчик микросекунд или запросов при миллионе в секунду — меньше часа. Автоинкремент <code>serial</code> (int4) в PostgreSQL кончается на 2,1 млрд строк — берите <code>bigint</code>.',
      'uint32 1000000000': 'Наносекундный 32-битный счётчик переполняется за 4 секунды — поэтому таймеры читают как 64-битные или считают разницу по модулю.',
    };
    let ti = 0, ri = 1;
    const tBtns = h('div', { class: 'controls' });
    const rBtns = h('div', { class: 'controls' });
    const out = h('div', { class: 'ct-out' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    TYPES.forEach(([n], i) => tBtns.append(h('button', { class: 'btn small', onclick: () => { ti = i; render(); } }, h('code', null, n))));
    RATES.forEach(([n], i) => rBtns.append(h('button', { class: 'btn small', onclick: () => { ri = i; render(); } }, n)));
    root.append(h('span', { class: 'label' }, 'Тип счётчика'), tBtns, h('span', { class: 'label' }, 'Растёт на'), rBtns, out, logEl);

    function human(s) {
      const Y = 365.25 * 86400;
      if (s >= Y) {
        const y = s / Y;
        if (y >= 1e9) return `${dec(y / 1e9, 0)} млрд лет`;
        if (y >= 1e6) return `${dec(y / 1e6, 0)} млн лет`;
        if (y < 10) return `${dec(y, 1)} года`;
        return `${fmt(Math.round(y))} ${plural(Math.round(y), ['год', 'года', 'лет'])}`;
      }
      if (s >= 86400) { const d = s / 86400; return `${dec(d, d < 100 ? 2 : 1)} дня`; }
      if (s >= 3600) return `${dec(s / 3600, 1)} ч`;
      if (s >= 60) return `${dec(s / 60, 1)} мин`;
      return `${dec(s, 1)} с`;
    }
    function render() {
      const [tn, lim] = TYPES[ti], [, rate] = RATES[ri];
      const secs = lim / rate;
      tBtns.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', i === ti));
      rBtns.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', i === ri));
      const max = tn === 'int64' ? '9 223 372 036 854 775 807' : fmt(lim - 1);
      const scale = Math.min(1, Math.log10(secs + 1) / Math.log10(3.2e10));
      out.innerHTML = `<div class="ct-row"><span class="label">максимум</span><b>${max}</b></div>` +
        `<div class="ct-row"><span class="label">переполнится через</span><b class="big">${human(secs)}</b></div>` +
        `<span class="cost-track"><span class="cost-fill" style="width:${scale * 100}%"></span></span>` +
        `<div class="ct-scale">${[['1 с', 1], ['день', 86400], ['год', 3.156e7], ['1000 лет', 3.156e10]].map(([l, t]) => `<span style="left:${Math.log10(t + 1) / Math.log10(3.2e10) * 100}%">${l}</span>`).join('')}</div>`;
      const story = STORIES[`${tn} ${rate}`];
      logEl.innerHTML = story || `Дальше счётчик ${tn.startsWith('u') ? 'вернётся к нулю' : 'станет отрицательным'}, и сравнения «новое больше старого» сломаются.`;
      logEl.className = 'log' + (story && secs < 3e9 ? ' warn' : '');
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- IEEE 754 decomposition
  Deck.demo('float', root => {
    let wide = true, x = 0.1, typed = '0.1';
    const PRESETS = [['0.1', '0.1'], ['0.1 + 0.2', '0.30000000000000004'], ['−2.5', '-2.5'], ['16777217', '16777217'], ['2⁵³ + 1', '9007199254740993'], ['1e-310', '1e-310'], ['−0', '-0'], ['∞', 'Infinity'], ['NaN', 'NaN']];
    const input = h('input', { class: 'num-in wide', type: 'text', inputmode: 'decimal', value: typed, 'aria-label': 'Число', spellcheck: 'false' });
    const w64 = h('button', { class: 'btn small sel', onclick: () => { wide = true; render(); } }, 'float64');
    const w32 = h('button', { class: 'btn small', onclick: () => { wide = false; render(); } }, 'float32');
    const bitsEl = h('div', { class: 'fl-bits' });
    const parts = h('div', { class: 'fl-parts' });
    const exact = h('div', { class: 'fl-exact' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' }, input, w64, w32),
      h('div', { class: 'controls' }, PRESETS.map(([l, v]) => h('button', { class: 'btn small', onclick: () => { input.value = v; read(); } }, l))),
      bitsEl, parts, exact, logEl,
    );
    input.addEventListener('change', read);
    function read() {
      typed = input.value.trim().replace(',', '.').replace(/^−/, '-');
      const n = /^[-+]?(infinity|inf|∞)$/i.test(typed) ? (typed.startsWith('-') ? -Infinity : Infinity) : Number(typed);
      x = n;
      render();
    }

    // Exact decimal value of a finite binary fraction m · 2^e (m ≥ 0 BigInt).
    function exactDec(m, e) {
      if (m === 0n) return '0';
      if (e >= 0) return (m << BigInt(e)).toString();
      const k = -e;
      const s = (m * 5n ** BigInt(k)).toString().padStart(k + 1, '0');
      const ip = s.slice(0, s.length - k), fp = s.slice(s.length - k).replace(/0+$/, '');
      return fp ? ip + '.' + fp : ip;
    }
    const grp = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const minus = n => String(n).replace('-', '−');
    const mantStr = t => { if (!t.includes('.')) t += '.0'; return t.length > 22 ? t.slice(0, 22) + '…' : t; };
    const short = s => {
      const [ip, fp] = s.split('.');
      const z = fp && /^[-−]?0$/.test(ip) ? fp.match(/^0*/)[0].length : 0;
      if (z > 8) {
        const d = fp.slice(z);
        return `${ip.startsWith('-') || ip.startsWith('−') ? '−' : ''}${d[0]},${d.slice(1, 40)}${d.length > 40 ? '…' : ''} × 10<sup>−${z + 1}</sup>`;
      }
      let out = grp(ip);
      if (fp) out += ',' + (fp.length > 60 ? fp.slice(0, 60) + `<span class="muted">… ещё ${fp.length - 60} цифр</span>` : fp);
      return out;
    };

    function render() {
      w64.classList.toggle('sel', wide);
      w32.classList.toggle('sel', !wide);
      const EB = wide ? 11 : 8, MB = wide ? 52 : 23, BIAS = wide ? 1023 : 127, W = 1 + EB + MB;
      let bits;
      if (wide) {
        const dv = new DataView(new ArrayBuffer(8));
        dv.setFloat64(0, x);
        bits = dv.getBigUint64(0);
      } else {
        const dv = new DataView(new ArrayBuffer(4));
        dv.setFloat32(0, x);
        bits = BigInt(dv.getUint32(0));
      }
      const bin = bits.toString(2).padStart(W, '0');
      const sb = bin[0], eb = bin.slice(1, 1 + EB), mb = bin.slice(1 + EB);
      const e = parseInt(eb, 2), s = sb === '1';
      const mant = BigInt('0b' + mb);
      const hexStr = '0x' + bits.toString(16).toUpperCase().padStart(W / 4, '0');
      bitsEl.innerHTML = `<span class="fs">${sb}</span><span class="fe">${eb}</span><span class="fm">${mb}</span>`;

      let kind, mVal, eVal, value = null;
      if (e === (1 << EB) - 1) kind = mant ? 'nan' : 'inf';
      else if (e === 0) { kind = mant ? 'sub' : 'zero'; mVal = mant; eVal = 1 - BIAS - MB; }
      else { kind = 'norm'; mVal = mant | (1n << BigInt(MB)); eVal = e - BIAS - MB; }

      const stored = wide ? x : Math.fround(x);
      let ePart;
      if (kind === 'norm') ePart = `${e} − ${BIAS} = <b>${minus(e - BIAS)}</b>`;
      else if (kind === 'sub' || kind === 'zero') ePart = `0 — особый случай: ${kind === 'zero' ? 'ноль' : 'субнормальное число, без скрытой единицы'}`;
      else ePart = 'все единицы — особое значение';
      const frac = kind === 'norm' ? '1.' : kind === 'sub' ? '0.' : '';
      parts.innerHTML =
        `<div><span class="sw fs"></span><span class="label">знак</span><b>${s ? '−' : '+'}</b></div>` +
        `<div><span class="sw fe"></span><span class="label">порядок, ${EB} бит</span><b>${ePart}</b></div>` +
        `<div><span class="sw fm"></span><span class="label">мантисса, ${MB} бит</span><b>${frac ? mantStr(exactDec(mVal, -MB)) + ' × 2<sup>' + minus(kind === 'norm' ? e - BIAS : 1 - BIAS) + '</sup>' : kind === 'inf' ? 'нули → бесконечность' : 'не ноль → NaN'}</b></div>`;

      if (kind === 'inf' || kind === 'nan') {
        exact.innerHTML = `<span class="label">в памяти ${hexStr}</span><b>${kind === 'inf' ? (s ? '−∞' : '+∞') : 'NaN'}</b>`;
        logEl.innerHTML = kind === 'inf' ? 'Бесконечность получается при переполнении (<code>1e308 * 10</code>) и делении на ноль.' : 'NaN — результат <code>0/0</code>, <code>∞ − ∞</code>, <code>sqrt(-1)</code>. NaN не равен ничему, даже себе: <code>x != x</code> — способ его поймать. Ключ NaN в словаре или Set ведёт себя странно.';
        logEl.className = 'log';
        return;
      }
      const exactStr = (s ? '−' : '') + exactDec(mVal, eVal);
      // the gap to the next representable number away from zero
      const gapE = kind === 'norm' ? e - BIAS - MB : 1 - BIAS - MB;
      const gap = 2 ** gapE;
      exact.innerHTML = `<span class="label">в памяти ${hexStr}, хранится ровно</span><b>${short(exactStr)}</b>` +
        `<span class="label">шаг до соседнего числа: ${gap >= 1e-4 && gap < 1e15 ? String(gap).replace('.', ',') : gap.toExponential(2).replace('.', ',')} (2<sup>${minus(gapE)}</sup>)</span>`;
      const printed = wide ? String(stored) : show32(stored);
      const norm = t => {
        if (/e/i.test(t)) return String(Number(t));
        return t.replace(/^\+/, '').replace(/^(-?)0+(?=\d)/, '$1').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
      };
      const want = norm(typed), abs = exactDec(mVal, eVal);
      if (kind === 'zero') {
        logEl.innerHTML = s ? 'Минус ноль: отличается только знаковым битом. <code>-0 === 0</code> — true, но <code>1/-0</code> = −∞, а <code>Object.is(-0, 0)</code> — false.' : 'Ноль — все биты нулевые.';
        logEl.className = 'log';
      } else if (kind === 'sub') {
        logEl.innerHTML = 'Субнормальное число: порядок минимальный, скрытой единицы нет, точность падает. Арифметика с такими числами на многих процессорах в десятки раз медленнее.';
        logEl.className = 'log warn';
      } else if ((s ? '-' : '') + abs === want) {
        logEl.innerHTML = 'Это число представимо точно: двоичная дробь конечная и влезает в мантиссу.';
        logEl.className = 'log ok';
      } else if (printed === want) {
        logEl.innerHTML = `Ввели ${want}, а хранится ближайшая двоичная дробь. При печати язык показывает кратчайшую запись, которая читается обратно в то же число, поэтому разница не видна — до первой арифметики.`;
        logEl.className = 'log warn';
      } else {
        logEl.innerHTML = `Ввели ${want}, но ${wide ? 'в float64' : 'в float32'} такого числа нет: ближайшее — <b>${printed}</b>. Мантиссы не хватает на все цифры.`;
        logEl.className = 'log bad';
      }
    }
    // Shortest decimal that reads back as the same float32.
    function show32(v) { for (let p = 1; p <= 9; p++) { const t = v.toPrecision(p); if (Math.fround(+t) === v) return String(+t); } return String(v); }
    render();
    return {};
  });

  // ---------------------------------------------------------------- money accumulation
  Deck.demo('money', root => {
    const NS = [3, 10, 100, 1000, 10000, 100000, 1000000, 10000000];
    const AMOUNTS = [['0,10', 10], ['0,01', 1], ['19,99', 1999]];
    let ai = 0;
    const slider = h('input', { type: 'range', min: 0, max: NS.length - 1, value: 1, 'aria-label': 'Сколько раз прибавить' });
    const nOut = h('output');
    const aBtns = h('div', { class: 'controls' });
    const table = h('div', { class: 'mn-table' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    AMOUNTS.forEach(([l], i) => aBtns.append(h('button', { class: 'btn small', onclick: () => { ai = i; render(); } }, l + ' ₽')));
    slider.addEventListener('input', render);
    root.append(h('span', { class: 'label' }, 'Прибавляем'), aBtns, h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'раз'), slider, nOut), table, logEl);

    const cache = {};
    function sums(n, cents) {
      const key = n + ':' + cents;
      if (cache[key]) return cache[key];
      const a = cents / 100, a32 = Math.fround(a);
      let f64 = 0, f32 = 0;
      for (let i = 0; i < n; i++) { f64 += a; f32 = Math.fround(f32 + a32); }
      return (cache[key] = { f64, f32 });
    }
    // Shortest decimal that reads back as the same float32.
    const show32 = v => { for (let p = 1; p <= 9; p++) { const s = v.toPrecision(p); if (Math.fround(+s) === v) return String(+s); } return String(v); };
    const money = c => { const s = (c / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); return s + ',' + (c % 100n).toString().padStart(2, '0'); };
    const num = s => { const [ip, fp] = s.split('.'); return ip.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fp ? ',' + fp : ''); };

    function render() {
      const n = NS[+slider.value], cents = AMOUNTS[ai][1];
      nOut.textContent = fmt(n);
      aBtns.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', i === ai));
      const exactC = BigInt(n) * BigInt(cents);
      const exactV = Number(exactC) / 100;
      const { f64, f32 } = sums(n, cents);
      const rows = [
        ['float64', num(String(f64)), f64 - exactV],
        ['float32', num(show32(f32)), f32 - exactV],
        ['int64, копейки', money(exactC) + ' ₽', 0],
        ['Decimal', money(exactC), 0],
      ];
      const errTxt = d => {
        if (d === 0) return '<span class="ok">точно</span>';
        const a = Math.abs(d);
        return `<span class="bad">${d > 0 ? '+' : '−'}${a >= 100 ? fmt(Math.round(a)) + '&nbsp;₽' : a >= 0.01 ? dec(a, 2) + '&nbsp;₽' : a.toExponential(1).replace('.', ',')}</span>`;
      };
      table.innerHTML = `<div class="mn-row head"><span>тип</span><span>сумма</span><span>ошибка</span></div>` +
        rows.map(([t, v, d]) => `<div class="mn-row"><code>${t}</code><b>${v}</b>${errTxt(d)}</div>`).join('');
      const e32 = Math.abs(f32 - exactV), e64 = Math.abs(f64 - exactV);
      if (e32 >= 1) logEl.innerHTML = `float32 разошёлся на ${e32 >= 100 ? fmt(Math.round(e32)) : dec(e32, 2)} ₽: в нём всего ~7 значащих цифр, и когда сумма растёт, каждое прибавление округляется всё грубее.`;
      else if (e64 > 0) logEl.innerHTML = `Ошибка float64 крошечная, но она есть: сравнение с ${money(exactC)} даст false, а при округлении «до копейки» на границе можно получить не ту копейку.`;
      else logEl.innerHTML = 'Пока совпало: ошибки округления иногда компенсируют друг друга. Прибавьте побольше раз.';
      logEl.className = 'log' + (e32 >= 1 ? ' bad' : e64 > 0 ? ' warn' : '');
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- endianness
  Deck.demo('endian', root => {
    const VALUES = [['0x12345678', 0x12345678], ['1', 1], ['1000', 1000], ['0xDEADBEEF', 0xDEADBEEF], ['−2', -2 >>> 0]];
    let v = 0x12345678, little = true;
    const vBtns = h('div', { class: 'controls' });
    const leB = h('button', { class: 'btn small', onclick: () => { little = true; render('Little-endian: по младшему адресу — младший байт. Так хранят x86 и ARM.'); } }, 'little-endian');
    const beB = h('button', { class: 'btn small', onclick: () => { little = false; render('Big-endian: старший байт первым — как число пишут на бумаге. Так байты идут в TCP/IP-заголовках.'); } }, 'big-endian');
    const mem = h('div', { class: 'en-mem' });
    const reads = h('div', { class: 'en-reads' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    VALUES.forEach(([l, val]) => vBtns.append(h('button', { class: 'btn small', onclick: () => { v = val; render(`Число ${l}.`); } }, l)));
    root.append(h('span', { class: 'label' }, 'Число uint32'), vBtns, h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Записать как'), leB, beB), mem, reads, logEl);
    const hx = n => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

    function render(text) {
      leB.classList.toggle('sel', little);
      beB.classList.toggle('sel', !little);
      vBtns.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', VALUES[i][1] === v));
      const dv = new DataView(new ArrayBuffer(4));
      dv.setUint32(0, v, little);
      const bytes = [0, 1, 2, 3].map(i => dv.getUint8(i));
      // significance: 3 = most significant byte
      const sig = [0, 1, 2, 3].map(i => (little ? i : 3 - i));
      mem.innerHTML = bytes.map((b, i) => `<div class="en-cell s${sig[i]}"><span class="label">0x100${i}</span><b>${hex2(b)}</b><small>${sig[i] === 3 ? 'старший' : sig[i] === 0 ? 'младший' : '&nbsp;'}</small></div>`).join('');
      const same = dv.getUint32(0, little), other = dv.getUint32(0, !little);
      reads.innerHTML = `<div class="ok"><span class="label">прочитали тем же порядком</span><b>${hx(same)}</b><small>${fmt(same)}</small></div>` +
        `<div class="${other === same ? 'ok' : 'bad'}"><span class="label">прочитали другим порядком</span><b>${hx(other)}</b><small>${fmt(other)}</small></div>`;
      logEl.innerHTML = text + (other === same ? ' Байты симметричны — порядок не важен.' :
        ` Прочитать «не тем» порядком — получить ${fmt(other)} вместо ${fmt(same)}.` + (v === 1 ? ' Так в бинарном протоколе поле длины 1 превращается в 16 мегабайт.' : ''));
    }
    render('Little-endian: по младшему адресу — младший байт. Так хранят x86 и ARM.');
    return {};
  });
})();

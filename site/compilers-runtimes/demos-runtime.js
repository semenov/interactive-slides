// Demos for slides 12–17: JIT tiers, deoptimisation, hidden classes, AOT/JIT trade-off, linking, ELF.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const { logger, esc } = window.CR;
  const fmt = n => n.toLocaleString('ru-RU');
  const hex = n => '0x' + n.toString(16);

  // ---------------------------------------------------------------- JIT tiers
  Deck.demo('tiers', root => {
    // cost: ns per call; at: invocation count that queues compilation; compile: µs of compile time in a background thread.
    const VMS = {
      jvm: {
        name: 'JVM (HotSpot)',
        tiers: [
          { id: 'int', name: 'интерпретатор', cost: 400, cls: 't0' },
          { id: 'c1', name: 'C1 + профиль', cost: 60, at: 200, compile: 300, cls: 't1', why: '200 вызовов (Tier3InvocationThreshold): в очередь C1 — быстрый компилятор, код с профилированием' },
          { id: 'c2', name: 'C2', cost: 8, at: 5000, compile: 8000, cls: 't3', why: '5000 вызовов (Tier4InvocationThreshold): профиль собран, в очередь C2 — медленный оптимизирующий компилятор' },
        ],
      },
      v8: {
        name: 'V8 (Node, Chrome)',
        tiers: [
          { id: 'ign', name: 'Ignition', cost: 300, cls: 't0' },
          { id: 'spk', name: 'Sparkplug', cost: 180, at: 30, compile: 20, cls: 't1', why: 'Sparkplug: байткод почти дословно переводится в машинный код, без оптимизаций — убирает диспетчеризацию' },
          { id: 'mag', name: 'Maglev', cost: 40, at: 500, compile: 400, cls: 't2', why: 'Maglev: быстрый оптимизирующий компилятор, использует собранную обратную связь о типах' },
          { id: 'tf', name: 'TurboFan', cost: 8, at: 4000, compile: 5000, cls: 't3', why: 'TurboFan: тяжёлые оптимизации со спекуляцией по типам, встраивание' },
        ],
      },
    };
    const N = 1e6;
    let vm = 'jvm', calls, cur, pending, t, segs, playing = false, elapsed, lastNow;
    const vmBar = h('div', { class: 'controls' }, Object.entries(VMS).map(([k, v]) => h('button', { class: 'btn small', 'data-v': k, onclick: () => { vm = k; reset(); } }, v.name)));
    const playBtn = h('button', { class: 'btn primary', onclick: () => { if (calls >= N) reset(); playing = !playing; lastNow = performance.now(); playBtn.textContent = playing ? 'Пауза' : 'Пуск'; } }, 'Пуск');
    const chart = h('div', { class: 'ti-chart' });
    const legend = h('div', { class: 'ti-legend' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(vmBar, h('div', { class: 'controls' }, playBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')), chart, legend, stats, logEl);
    const us = v => v >= 1000 ? (v / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' мс' : Math.round(v) + ' мкс';

    function reset() {
      const V = VMS[vm];
      calls = 0; cur = 0; pending = null; t = 0; elapsed = 0; segs = [];
      playing = false; playBtn.textContent = 'Пуск';
      vmBar.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.v === vm));
      legend.innerHTML = V.tiers.map(x => `<span><i class="ti-sw ${x.cls}"></i>${x.name} · ${x.cost} нс</span>`).join('');
      say('Функция ещё не вызывалась. Нажмите «Пуск».');
      render();
    }
    function callOnce() {
      const V = VMS[vm];
      calls++;
      const T = V.tiers[cur];
      t += T.cost / 1000; // µs
      const last = segs[segs.length - 1];
      if (last && last.cls === T.cls) last.to = calls; else segs.push({ from: calls, to: calls, cost: T.cost, cls: T.cls });
      if (pending && t >= pending.ready) {
        cur = pending.idx;
        say(`Вызов ${fmt(calls)}: ${V.tiers[cur].name} готов, дальше вызовы идут в новый код — ${V.tiers[cur].cost} нс вместо ${T.cost}.`, 'ok');
        pending = null;
      } else if (!pending && V.tiers[cur + 1] && calls >= V.tiers[cur + 1].at) {
        const nx = V.tiers[cur + 1];
        pending = { idx: cur + 1, ready: t + nx.compile };
        say(`Вызов ${fmt(calls)}: ${nx.why}. Компиляция ~${us(nx.compile)} в фоне, а пока работает ${T.name}.`);
      }
    }
    function render() {
      const V = VMS[vm];
      const W = 300, H = 120, lx = c => 4 + (Math.log10(c) / Math.log10(N)) * (W - 8);
      const maxC = V.tiers[0].cost, minC = 5;
      const ly = c => 8 + (1 - Math.log(c / minC) / Math.log(maxC * 1.3 / minC)) * (H - 22);
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Время вызова от номера вызова">`;
      for (const p of [1, 10, 100, 1e3, 1e4, 1e5, 1e6]) svg += `<line class="grid" x1="${lx(p)}" x2="${lx(p)}" y1="4" y2="${H - 14}"/><text x="${lx(p)}" y="${H - 3}"${p >= 1e6 ? ' class="end"' : ''}>${p >= 1e6 ? '1M' : p >= 1000 ? p / 1000 + 'K' : p}</text>`;
      segs.forEach((g, i) => {
        const y = ly(g.cost).toFixed(1), x1 = lx(g.from).toFixed(1), x2 = Math.max(lx(g.to), lx(g.from) + 0.8).toFixed(1);
        const prev = segs[i - 1];
        svg += `<path class="${g.cls}" d="M${prev ? x1 + ' ' + ly(prev.cost).toFixed(1) + ' L' + x1 + ' ' + y : x1 + ' ' + y} L${x2} ${y}"/>`;
        if (prev) svg += `<text class="ti-at" x="${x1}" y="${(+y + 11).toFixed(1)}">${fmt(g.from)}</text>`;
      });
      if (pending) svg += `<text class="ti-pend" x="${W - 4}" y="16">компилируется ${V.tiers[pending.idx].name}…</text>`;
      chart.innerHTML = svg + '</svg>';
      const avg = calls ? (t * 1000 / calls) : 0;
      stats.innerHTML = `<div class="stat"><b>${fmt(calls)}</b><span>вызовов</span></div>` +
        `<div class="stat"><b>${V.tiers[cur].name}</b><span>сейчас работает</span></div>` +
        `<div class="stat"><b>${calls ? Math.round(avg) + ' нс' : '—'}</b><span>в среднем на вызов</span></div>`;
    }
    reset();
    const loop = rafLoop(() => {
      if (!playing) return;
      const now = performance.now();
      elapsed += Math.min(0.5, (now - lastNow) / 1000);
      lastNow = now;
      const target = Math.min(N, Math.floor(10 ** (elapsed * 0.6)));
      while (calls < target) callOnce();
      if (calls >= N) {
        playing = false; playBtn.textContent = 'Заново';
        const V = VMS[vm], top = V.tiers.at(-1);
        say(`Миллион вызовов за ${us(t)}. Если бы с первого вызова работал ${top.name}, хватило бы ${us(N * top.cost / 1000)}. Прогрев — главная цена JIT, поэтому бенчмарки (JMH, benchmark.js) сначала разогревают код и только потом меряют.`, 'ok');
      }
      render();
    });
    return { start: loop.start, stop: () => { loop.stop(); if (playing) { playing = false; playBtn.textContent = 'Пуск'; } } };
  });

  // ---------------------------------------------------------------- speculation & deopt
  Deck.demo('deopt', root => {
    const HOT = 1000;
    const ORDER = { none: 0, smi: 1, number: 2, any: 3 };
    const FB_NAME = { none: 'нет данных', smi: 'SignedSmall (только Smi)', number: 'Number', string: 'String', any: 'Any' };
    const CALLS = {
      smi: { label: 'add(1, 2) ×500', n: 500, msg: 'целые Smi' },
      dbl: { label: 'add(1.5, 2)', n: 1, msg: 'дробное число — HeapNumber' },
      ovf: { label: 'add(2³⁰−1, 1)', n: 1, msg: 'Smi, но сумма не влезает в Smi' },
      str: { label: "add('a', 'b')", n: 1, msg: 'строки' },
    };
    let fb, tier, optFor, hot, deopts, total;
    const bar = h('div', { class: 'controls' }, Object.entries(CALLS).map(([k, c]) => h('button', { class: 'btn small' + (k === 'smi' ? ' primary' : ''), onclick: () => run(k) }, h('code', null, c.label))),
      h('button', { class: 'btn small', onclick: reset }, 'Сброс'));
    const state = h('div', { class: 'dp-state' });
    const code = h('pre', { class: 'dp-code' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(h('pre', { class: 'vm-src', html: Deck.highlight('function add(a, b) { return a + b; }', 'js') }), bar, state, code, logEl);

    const kindFb = k => k === 'smi' ? 'smi' : k === 'str' ? 'string' : 'number';
    const join = (a, b) => {
      if (a === 'none') return b;
      if (a === b) return a;
      if (a === 'string' || b === 'string' || a === 'any' || b === 'any') return 'any';
      return ORDER[a] > ORDER[b] ? a : b;
    };
    const accepts = (spec, k) => spec === 'any' || (spec === 'smi' && k === 'smi') || (spec === 'number' && k !== 'str') || (spec === 'string' && k === 'str');

    function reset() {
      fb = 'none'; tier = 'ign'; optFor = null; hot = 0; deopts = 0; total = 0;
      say('Функция работает в интерпретаторе Ignition и записывает, какие типы видит в <code>a + b</code>.');
      render();
    }
    function run(k) {
      const c = CALLS[k];
      let msg = '', cls = '';
      for (let i = 0; i < c.n; i++) {
        total++;
        if (tier === 'tf') {
          if (accepts(optFor, k)) continue;
          deopts++;
          tier = 'ign'; hot = 0;
          fb = join(fb, kindFb(k));
          const reason = optFor === 'smi' ? (k === 'ovf' ? 'overflow' : 'not a Smi') : optFor === 'number' ? 'not a Number' : 'not a String';
          msg = `Деоптимизация (reason: ${reason}): охранник поймал ${c.msg}. Кадр оптимизированного кода пересобран в кадр интерпретатора, вызов доработал в Ignition. Обратная связь расширилась до ${FB_NAME[fb]}.`;
          cls = 'bad';
          continue;
        }
        const before = fb;
        fb = join(fb, kindFb(k));
        if (fb !== before && before !== 'none') { msg = `Ignition увидел ${c.msg} — обратная связь расширилась до ${FB_NAME[fb]}. Оптимизированного кода ещё нет, деоптимизировать нечего.`; cls = 'warn'; }
        hot++;
        if (hot >= HOT) {
          tier = 'tf'; optFor = fb;
          msg = `Функция горячая — TurboFan компилирует её со ставкой на ${FB_NAME[fb]}.`;
          cls = 'ok';
        }
      }
      if (!msg) msg = tier === 'tf' ? `${c.n > 1 ? c.n + ' вызовов' : 'Вызов'} в оптимизированном коде: охранники проходят, деоптимизаций нет.` : `Ignition: ${hot} из ~${HOT} вызовов до оптимизации. Обратная связь: ${FB_NAME[fb]}.`;
      say(msg, cls);
      render();
    }
    const CODE = {
      smi: [
        ['test', 'edi, 1', 'a — Smi? младший бит 0'], ['jnz', 'deopt', 'нет → деоптимизация'],
        ['test', 'esi, 1', 'b — Smi?'], ['jnz', 'deopt', ''],
        ['add', 'edi, esi', 'Smi + Smi без распаковки'], ['jo', 'deopt', 'переполнение → деоптимизация'],
        ['mov', 'eax, edi', ''], ['ret', '', ''],
      ],
      number: [
        ['call', 'ToFloat64(a)', 'Smi → double или поле HeapNumber;'], ['', '', 'не число → деоптимизация'],
        ['call', 'ToFloat64(b)', ''],
        ['addsd', 'xmm0, xmm1', 'сложение double'],
        ['call', 'NumberFromFloat64', 'упаковать: Smi или новый HeapNumber'], ['ret', '', ''],
      ],
      string: [
        ['cmp', '[a].map, String*', 'a — строка? иначе деоптимизация'], ['cmp', '[b].map, String*', ''],
        ['call', 'StringAdd', 'конкатенация'], ['ret', '', ''],
      ],
      any: [
        ['call', 'Builtins::Add', 'общий путь: числа, строки, объекты, valueOf'], ['ret', '', ''],
      ],
    };
    function render() {
      const tierName = tier === 'tf' ? 'TurboFan (оптимизирован)' : 'Ignition (интерпретатор)';
      state.innerHTML = `<div class="${tier}"><span class="label">где работает</span><b>${tierName}</b></div>` +
        `<div><span class="label">обратная связь a + b</span><b>${FB_NAME[fb]}</b></div>` +
        `<div class="${deopts ? 'warn' : ''}"><span class="label">деоптимизаций</span><b>${deopts}</b></div>`;
      if (tier !== 'tf') {
        code.innerHTML = `<span class="c">; оптимизированного кода нет — каждый вызов идёт\n; через байткод: Ldar a1 · Add a0, [0] · Return\n; горячесть: ${hot} / ~${HOT}</span>`;
        code.classList.add('off');
        return;
      }
      code.classList.remove('off');
      code.innerHTML = `<span class="c">; add — TurboFan, ставка: ${FB_NAME[optFor]}</span>\n` + CODE[optFor].map(([op, a, c]) =>
        `<span class="k">${op.padEnd(6)}</span>${esc(a.padEnd(18))}${c ? `<span class="c">; ${esc(c)}</span>` : ''}`).join('\n');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- hidden classes & inline caches
  Deck.demo('shapes', root => {
    const ORDERS = [['x', 'y'], ['y', 'x'], ['x', 'y', 'z'], ['x', 'z'], ['z', 'x'], ['w', 'x']];
    let maps, nextId, ic, ics, objs, last;
    const bar = h('div', { class: 'controls' }, ORDERS.map(o => h('button', { class: 'btn small', onclick: () => make(o) }, h('code', null, `{${o.join(', ')}}`))),
      h('button', { class: 'btn small', onclick: reset }, 'Сброс'));
    const treeEl = h('div', { class: 'sh-tree' });
    const icEl = h('div', { class: 'sh-ic' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(
      h('pre', { class: 'vm-src', html: Deck.highlight("const o = {};  o.x = 1;  o.y = 2;   // поля в заданном порядке\nfunction getX(o) { return o.x; }   // одно место доступа", 'js') }),
      h('span', { class: 'label' }, 'Создать объект и вызвать getX(o):'), bar,
      h('div', { class: 'sh-cols' }, h('div', null, h('span', { class: 'label' }, 'Дерево переходов скрытых классов'), treeEl), h('div', null, h('span', { class: 'label' }, 'Inline cache в getX'), icEl)),
      logEl);

    function reset() {
      maps = [{ id: 0, props: [], kids: {} }];
      nextId = 1; ic = []; ics = 'uninit'; objs = 0; last = null;
      say('Пустой объект <code>{}</code> имеет класс M0. Нажмите на кнопку с порядком полей.');
      render();
    }
    function make(order) {
      let m = maps[0];
      const created = [];
      for (const p of order) {
        if (!m.kids[p]) {
          const nm = { id: nextId++, props: [...m.props, p], kids: {} };
          maps.push(nm);
          m.kids[p] = nm.id;
          created.push(nm.id);
        }
        m = maps[m.kids[p]];
      }
      objs++;
      last = m;
      const off = m.props.indexOf('x');
      const madeMsg = created.length ? `новых классов: ${created.map(i => 'M' + i).join(', ')}` : 'новых классов нет — путь переходов уже есть';
      let icMsg, cls = '';
      if (ics === 'mega') { icMsg = 'IC мегаморфный: поиск пары (класс, «x») в общей хеш-таблице stub cache. Медленнее в разы, и TurboFan не сможет встроить доступ.'; cls = 'bad'; }
      else if (ic.some(e => e.map === m.id)) { icMsg = `попадание: класс M${m.id} уже в кэше — сравнение и загрузка по смещению +${off}.`; cls = 'ok'; }
      else if (ic.length < 4) {
        ic.push({ map: m.id, off });
        ics = ic.length === 1 ? 'mono' : 'poly';
        icMsg = ic.length === 1 ? `IC стал мономорфным: «если класс M${m.id} — читаем поле по смещению +${off}».` : `IC полиморфный (${ic.length} ${plural(ic.length, ['класс', 'класса', 'классов'])}): сравнения идут по очереди.`;
        cls = ic.length === 1 ? 'ok' : 'warn';
      } else {
        ics = 'mega'; ic = [];
        icMsg = 'Пятый класс — IC стал мегаморфным: дальше только поиск в общей хеш-таблице. Обратно он не вернётся.';
        cls = 'bad';
      }
      say(`{${order.join(', ')}} → класс M${m.id}, ${madeMsg}. ${icMsg}`, cls);
      render();
    }
    function render() {
      const node = (m, depth) => {
        const kids = Object.entries(m.kids).map(([p, id]) => `<li><span class="sh-edge">+${p}</span>${node(maps[id], depth + 1)}</li>`).join('');
        const inIc = ic.some(e => e.map === m.id);
        return `<span class="sh-map${last && last.id === m.id ? ' last' : ''}${inIc ? ' ic' : ''}">M${m.id} {${m.props.join(',')}}</span>${kids ? `<ul>${kids}</ul>` : ''}`;
      };
      treeEl.innerHTML = `<ul class="sh-root"><li>${node(maps[0], 0)}</li></ul>`;
      const NAMES = { uninit: 'не инициализирован', mono: 'мономорфный', poly: 'полиморфный', mega: 'мегаморфный' };
      icEl.innerHTML = `<div class="sh-state ${ics}">${NAMES[ics]}</div>` +
        (ics === 'mega' ? '<div class="sh-entry mega">→ stub cache (общая хеш-таблица)</div>'
          : ic.map(e => `<div class="sh-entry">M${e.map} → x @ +${e.off}</div>`).join('') || '<div class="empty">пусто</div>') +
        `<div class="sh-meter"><span style="width:${ics === 'mega' ? 100 : ics === 'poly' ? 20 + ic.length * 10 : ics === 'mono' ? 10 : 0}%"></span></div><span class="note">цена доступа</span>`;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- AOT vs JIT vs interpreter
  Deck.demo('tradeoff', root => {
    // phases: [duration ms (Infinity for steady), speed relative to Go]
    const RT = [
      { name: 'Go (AOT)', start: 1, mem: 8, phases: [[Infinity, 1]] },
      { name: 'GraalVM native-image', start: 5, mem: 25, phases: [[Infinity, 0.8]] },
      { name: 'Java (HotSpot JIT)', start: 60, mem: 90, phases: [[40, 0.03], [1200, 0.35], [Infinity, 1.05]] },
      { name: 'Node.js (V8 JIT)', start: 40, mem: 50, phases: [[15, 0.05], [300, 0.3], [Infinity, 0.75]] },
      { name: 'CPython', start: 20, mem: 10, phases: [[Infinity, 0.025]] },
    ];
    const slider = h('input', { type: 'range', min: 0, max: 100, value: 30, 'aria-label': 'Объём работы' });
    const out = h('output');
    const rows = h('div', { class: 'tr-rows' });
    const axis = h('div', { class: 'tr-axis' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(h('label', { class: 'slider' }, h('span', { class: 'label' }, 'Объём работы (сколько бы занял на Go)'), slider, out), rows, axis, logEl);
    slider.addEventListener('input', update);
    const MIN = 0.3, MAX = 3e8; // ms, axis
    const pos = ms => Math.max(0, Math.min(100, Math.log10(ms / MIN) / Math.log10(MAX / MIN) * 100));
    const time = ms => ms < 1 ? ms.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' мс' : ms < 1000 ? Math.round(ms) + ' мс'
      : ms < 60000 ? (ms / 1000).toLocaleString('ru-RU', { maximumFractionDigits: ms < 10000 ? 1 : 0 }) + ' с'
        : ms < 3600000 ? (ms / 60000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' мин' : (ms / 3600000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' ч';
    axis.innerHTML = [[1, '1 мс'], [1000, '1 с'], [60000, '1 мин'], [3600000, '1 ч'], [86400000, '1 сут']].map(([ms, l]) => `<span style="left:${pos(ms)}%">${l}</span>`).join('');
    function finish(r, work) {
      let t = 0, left = work, warm = 0;
      for (const [dur, sp] of r.phases) {
        const can = dur * sp;
        if (left <= can || dur === Infinity) { t += left / sp; if (dur !== Infinity) warm += left / sp; left = 0; break; }
        left -= can; t += dur; warm += dur;
      }
      return { total: r.start + t, warm };
    }
    function update() {
      const work = 10 ** (-0.5 + (+slider.value / 100) * 7); // 0.3 ms … ~1 h
      out.textContent = time(work);
      const res = RT.map(r => ({ r, ...finish(r, work) }));
      const best = Math.min(...res.map(x => x.total));
      rows.innerHTML = res.map(({ r, total, warm }) => {
        const k = total / best;
        return `<div class="tr-row${total === best ? ' best' : ''}"><span class="tr-name">${r.name}</span>` +
          `<span class="tr-bar"><i style="width:${pos(total)}%"></i></span>` +
          `<b>${time(total)}</b><small>${k < 1.05 ? 'лучший' : '×' + (k < 10 ? k.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : Math.round(k))} · ${r.mem} МБ` +
          `${r.start / total > 0.3 ? ' · в основном старт' : warm / total > 0.3 ? ' · в основном прогрев' : ''}</small></div>`;
      }).join('');
      const jvm = res[2], go = res[0];
      let msg, cls = '';
      if (work < 30) { msg = 'Короткая задача: всё решает время запуска. CLI-утилиты, serverless-функции, хуки — территория AOT. JVM здесь ещё грузит классы, а CPython хоть и медленный, но стартует быстро.'; cls = 'warn'; }
      else if (jvm.total > go.total * 1.15) { msg = 'Средняя задача: JIT ещё не прогрелся — большая часть времени ушла на интерпретатор и C1. AOT впереди.'; }
      else { msg = 'Долгая работа: прогрев окупился, JIT догнал AOT, а с профилем может и обогнать. Но памяти JVM берёт больше, а CPython отстаёт в десятки раз — на счётном коде нужны NumPy или расширения на C.'; cls = 'ok'; }
      logEl.className = 'log ' + cls;
      logEl.innerHTML = msg;
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- linker
  Deck.demo('link', root => {
    let mode = 'static', scen = 'ok', stage = 0;
    const modeBar = h('div', { class: 'controls' }, [['static', 'Статически'], ['dynamic', 'Динамически']].map(([k, l]) => h('button', { class: 'btn small', 'data-m': k, onclick: () => { mode = k; stage = 0; render(); } }, l)));
    const scenBar = h('div', { class: 'controls' }, [['ok', 'Всё на месте'], ['missing', 'Забыли math.o'], ['dup', 'add в двух файлах']].map(([k, l]) => h('button', { class: 'btn small', 'data-s': k, onclick: () => { scen = k; stage = 0; render(); } }, l)));
    const objs = h('div', { class: 'ln-objs' });
    const result = h('div', { class: 'ln-result' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { stage = stage >= 3 ? 0 : stage + 1; render(); } }, 'Шаг');
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(modeBar, scenBar, objs, result, h('div', { class: 'controls' }, stepBtn, h('span', { class: 'ln-stage' })), logEl);
    const stageEl = root.querySelector('.ln-stage');

    // main.o: offsets of relocation fields inside .text and the instruction end (P + 4).
    const RELOCS = [
      { off: 0x0f, sym: 'add', type: 'R_X86_64_PLT32', ins: 'call add' },
      { off: 0x18, sym: '.rodata', type: 'R_X86_64_PC32', ins: 'lea rdi, [rip+…]  ; "sum=%d\\n"' },
      { off: 0x1f, sym: 'printf', type: 'R_X86_64_PLT32', ins: 'call printf' },
    ];
    const le32 = v => { const u = v >>> 0; return [0, 8, 16, 24].map(s => ((u >>> s) & 255).toString(16).padStart(2, '0')).join(' '); };
    function layout() {
      if (mode === 'static') return { main: 0x401000, add: 0x401030, printf: 0x401040, rodata: 0x49e000, plt: null, size: '≈ 800 КБ', extra: 'printf и всё, что он тянет из libc.a (vfprintf, буферы stdio, локали…)' };
      return { plt: 0x401020, printf: 0x401030, main: 0x401040, add: 0x401070, rodata: 0x402000, got: 0x404018, size: '≈ 16 КБ', extra: 'printf@plt — заглушка: jmp *[GOT]; адрес в GOT впишет ld.so' };
    }
    function render() {
      modeBar.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.m === mode));
      scenBar.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.s === scen));
      const L = layout();
      const err = scen === 'missing' ? 'missing' : scen === 'dup' ? 'dup' : null;
      const sym = (k, name, st = '') => `<div class="ln-sym ${st}"><span class="ln-k ${k === 'U' ? 'u' : ''}">${k}</span>${name}</div>`;
      const resolved = stage >= 1 && !err;
      const files = [
        ['main.o', [sym('T', 'main'), sym('U', 'add', resolved ? 'ok' : err === 'missing' && stage >= 1 ? 'bad' : ''), sym('U', 'printf', resolved ? 'ok' : ''), sym('r', '.rodata')]],
      ];
      if (scen !== 'missing') files.push(['math.o', [sym('T', 'add', err === 'dup' && stage >= 1 ? 'bad' : '')]]);
      if (scen === 'dup') files.push(['util.o', [sym('T', 'add', stage >= 1 ? 'bad' : ''), sym('T', 'max')]]);
      files.push([mode === 'static' ? 'libc.a' : 'libc.so.6', [sym('T', 'printf'), sym('T', 'malloc'), `<div class="ln-sym more">… ещё ~2500</div>`]]);
      objs.innerHTML = files.map(([n, s]) => `<div class="ln-obj"><b>${n}</b>${s.join('')}</div>`).join('');

      const bytes = RELOCS.map(r => {
        let val = null;
        if (stage >= 3 && !err) {
          const S = r.sym === 'add' ? L.add : r.sym === '.rodata' ? L.rodata : (mode === 'static' ? L.printf : L.printf);
          val = S - 4 - (L.main + r.off); // S + A − P, A = −4
        }
        const target = r.sym === 'printf' && mode === 'dynamic' ? 'printf@plt' : r.sym;
        return `<div class="ln-rel"><code>main+${hex(r.off)}</code><span class="ln-bytes ${val != null ? 'done' : ''}">${val != null ? le32(val) : '00 00 00 00'}</span><span class="ln-ins">${esc(r.ins)}${val != null ? ` → ${target} @ ${hex(r.sym === '.rodata' ? L.rodata : r.sym === 'add' ? L.add : L.printf)}` : ''}</span></div>`;
      }).join('');
      let res = '';
      if (stage >= 2 && !err) {
        const secs = mode === 'static'
          ? [['.text', L.main, 'main'], ['.text', L.add, 'add'], ['.text', L.printf, 'printf + libc']]
          : [['.plt', L.plt, 'PLT0'], ['.plt', L.printf, 'printf@plt'], ['.text', L.main, 'main'], ['.text', L.add, 'add']];
        res = `<div class="ln-map">${secs.map(([s, a, n]) => `<span><code>${hex(a)}</code> ${s} <b>${n}</b></span>`).join('')}<span><code>${hex(L.rodata)}</code> .rodata <b>"sum=%d\\n"</b></span>` +
          (mode === 'dynamic' ? `<span><code>${hex(L.got)}</code> .got.plt <b>printf → ?</b></span>` : '') + '</div>';
      }
      result.innerHTML = `<span class="label">a.out — поля перемещений в main</span>${bytes}${res}`;
      const STAGES = ['1. Объектные файлы', '2. Разрешение символов', '3. Раскладка по адресам', '4. Перемещения'];
      stageEl.textContent = STAGES[stage];
      stepBtn.textContent = stage >= 3 ? 'Сначала' : 'Шаг';
      let msg, cls = '';
      if (stage === 0) msg = 'Каждый .o скомпилирован отдельно. В <code>call add</code> вместо адреса нули: компилятор не знает, где окажется <code>add</code>. Рядом — запись о перемещении: «сюда вписать адрес add».';
      else if (err === 'missing') { msg = "<code>ld: main.o: in function `main': undefined reference to `add'</code> — символ <code>add</code> нужен, но ни один файл его не определяет. Забыли файл или библиотеку в команде сборки (<code>-lm</code>, порядок <code>-l</code> тоже важен).", cls = 'bad'; stage = 3; stepBtn.textContent = 'Сначала'; }
      else if (err === 'dup') { msg = "<code>ld: util.o: multiple definition of `add'; math.o: first defined here</code> — два сильных определения одного символа. Типично для функции, определённой в заголовочном файле без <code>static</code> или <code>inline</code>.", cls = 'bad'; stage = 3; stepBtn.textContent = 'Сначала'; }
      else if (stage === 1) msg = mode === 'static' ? 'Каждое <code>U</code> нашло определение: <code>add</code> — в math.o, <code>printf</code> — в libc.a. Из архива берутся только нужные объектные файлы, но тянут за собой зависимости.' : '<code>add</code> найден в math.o. <code>printf</code> есть в libc.so.6 — линковщик не копирует его, а записывает в бинарник <code>NEEDED libc.so.6</code> и создаёт заглушку в PLT.';
      else if (stage === 2) msg = `Секции всех файлов склеены и получили адреса. ${L.extra}.`;
      else { msg = `Поля заполнены: значение = адрес цели − адрес конца инструкции (call относительный, little-endian). Размер бинарника ${L.size}.` + (mode === 'dynamic' ? ' При запуске ld.so найдёт printf в libc.so.6 и впишет его адрес в GOT.' : ' Бинарник ни от чего не зависит.'); cls = 'ok'; }
      logEl.className = 'log ' + cls;
      logEl.innerHTML = msg;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- ELF
  Deck.demo('elf', root => {
    const D = {
      hdr: 'Заголовок ELF: магия <code>7f 45 4c 46</code>, архитектура, точка входа. За ним — таблица программных заголовков: какие куски файла куда отобразить и с какими правами. Это всё, что читает ядро в <code>execve</code>.',
      interp: 'Путь к динамическому загрузчику: <code>/lib64/ld-linux-x86-64.so.2</code>. Ядро запускает сначала его, а он — программу. Нет файла по этому пути — <code>no such file or directory</code>.',
      dynsym: 'Символы для динамической линковки: что программа импортирует (<code>printf</code>) и экспортирует. Переживает <code>strip</code> — без неё программа не запустится.',
      rela: 'Перемещения, которые применит загрузчик: адреса в GOT и, для PIE, все абсолютные указатели (база загрузки случайна — ASLR).',
      plt: 'PLT — заглушки для вызова функций из <code>.so</code>: <code>call printf@plt</code> → <code>jmp *GOT[printf]</code>. Один косвенный переход на каждый вызов в чужую библиотеку.',
      text: 'Машинный код. Отображается с правами <code>r-x</code>: исполнять можно, писать нельзя. Страницы общие для всех процессов, запущенных из этого файла.',
      init: 'Код, который выполнится до <code>main</code>: конструкторы глобальных объектов C++, <code>__attribute__((constructor))</code>.',
      rodata: 'Константы и строковые литералы. Права <code>r--</code>: попытка записать в литерал — <code>SIGSEGV</code>.',
      eh: 'Таблицы раскрутки стека: для исключений C++, <code>backtrace()</code>, <code>perf --call-graph dwarf</code> и gdb.',
      dynamic: 'Таблица для загрузчика: <code>NEEDED libc.so.6</code>, <code>RUNPATH</code>, где лежат символы и перемещения. Смотреть: <code>readelf -d</code>.',
      got: 'GOT — таблица адресов, которую заполняет загрузчик. С <code>-z relro -z now</code> после заполнения становится только для чтения — защита от перезаписи указателей.',
      data: 'Инициализированные глобальные переменные. <code>rw-</code>, у каждого процесса своя копия (копирование при записи).',
      bss: 'Глобальные переменные с нулевыми значениями. Места в файле не занимает: загрузчик просто выделяет обнулённые страницы. Массив <code>var buf [1 &lt;&lt; 20]byte</code> не увеличит бинарник.',
      sym: 'Таблица символов: имена функций по адресам. Нужна <code>nm</code>, <code>perf</code>, отладчику. В память не загружается. <code>strip</code> / <code>-ldflags=-s</code> её удаляют — тогда <code>perf</code> покажет голые адреса.',
      debug: 'DWARF: строки исходника, типы, переменные — для отладчика (gdb, dlv). В память не загружается. <code>-ldflags=-w</code> удаляет.',
      pad: 'Выравнивание: каждый сегмент начинается с новой страницы 4 КБ, чтобы отобразить его с отдельными правами. Поэтому программа из сотни байт кода весит 16 КБ.',
      comment: 'Версия компилятора, служебные строки.',
      pclntab: 'Таблица «адрес → функция, файл, строка» и карты указателей в кадрах стека. Нужна в работе: для трассировки стека в <code>panic</code>, <code>runtime.Callers</code>, профилировщика и для сборщика мусора, который сканирует стеки. Поэтому <code>-s -w</code> её не удаляет — она больше самого кода!',
      gotype: 'Описания типов для интерфейсов, <code>reflect</code> и сборщика мусора.',
      buildinfo: 'Версия Go, модули с версиями и флаги сборки. Читается <code>go version -m ./app</code> — по ней <code>govulncheck</code> ищет уязвимости прямо в бинарнике.',
      noptr: 'Данные без указателей: сборщик мусора их не сканирует. Go раскладывает глобальные переменные по этому признаку.',
    };
    const BIN = {
      go: {
        name: 'Go, hello world', total: 2351004,
        segs: [
          ['PT_LOAD', 'r-x', [['заголовки', 400, 'hdr'], ['.note.go.buildid', 136, 'comment'], ['.text', 626289, 'text']]],
          ['PT_LOAD', 'r--', [['.rodata', 63554, 'rodata'], ['.gopclntab', 649635, 'pclntab'], ['.go.type', 130368, 'gotype']]],
          ['PT_LOAD', 'rw-', [['.go.buildinfo', 656, 'buildinfo'], ['.noptrdata', 19330, 'noptr'], ['.data', 19314, 'data'], ['.bss', 132216, 'bss', true], ['.noptrbss', 87528, 'noptr', true]]],
          ['не загружается', '', [['.debug_* (сжатые)', 703160, 'debug'], ['.symtab + .strtab', 127938, 'sym']]],
        ],
        note: 'Статический, без PT_INTERP: рантайм Go внутри. С <code>-ldflags="-s -w"</code> — 1,5 МБ.',
      },
      c: {
        name: 'C, hello world (gcc -O2)', total: 15960,
        segs: [
          ['PT_LOAD', 'r--', [['заголовки', 792, 'hdr'], ['.interp', 28, 'interp'], ['.dynsym, .dynstr…', 407, 'dynsym'], ['.rela.dyn, .rela.plt', 216, 'rela']]],
          ['PT_LOAD', 'r-x', [['.init, .fini', 40, 'init'], ['.plt', 64, 'plt'], ['.text', 259, 'text']]],
          ['PT_LOAD', 'r--', [['.rodata', 18, 'rodata'], ['.eh_frame', 224, 'eh']]],
          ['PT_LOAD', 'rw-', [['.init_array', 16, 'init'], ['.dynamic', 496, 'dynamic'], ['.got', 72, 'got'], ['.data', 16, 'data'], ['.bss', 8, 'bss', true]]],
          ['не загружается', '', [['.symtab + .strtab', 1338, 'sym'], ['.comment', 43, 'comment'], ['выравнивание', 11931, 'pad']]],
        ],
        note: 'Динамический: <code>PT_INTERP</code> и <code>NEEDED libc.so.6</code>. Сам код — 259 байт.',
      },
    };
    let bin = 'go', sel = '.text';
    const bar = h('div', { class: 'controls' }, Object.entries(BIN).map(([k, b]) => h('button', { class: 'btn small', 'data-b': k, onclick: () => { bin = k; sel = '.text'; render(); } }, b.name)));
    const map = h('div', { class: 'el-map' });
    const detail = h('div', { class: 'el-detail', 'aria-live': 'polite' });
    root.append(bar, map, detail);
    const size = n => n >= 1e6 ? (n / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' МБ' : n >= 1024 ? (n / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' КБ' : n + ' Б';
    function render() {
      const B = BIN[bin];
      bar.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.b === bin));
      const max = Math.max(...B.segs.flatMap(s => s[2].map(x => x[1])));
      map.innerHTML = B.segs.map(([type, perm, secs]) => `<div class="el-seg ${perm ? 'p-' + perm.replace(/-/g, '') : 'nl'}"><div class="el-seg-h"><b>${type}</b>${perm ? `<code>${perm}</code>` : ''}</div>` +
        secs.map(([n, sz, key, nobits]) => `<button class="el-sec${n === sel ? ' sel' : ''}" data-n="${esc(n)}"><span>${esc(n)}</span><i style="width:${Math.max(1, Math.sqrt(sz / max) * 100)}%"></i><b>${size(sz)}${nobits ? ' <small>в памяти</small>' : ''}</b></button>`).join('') + '</div>').join('');
      map.querySelectorAll('.el-sec').forEach(b => b.addEventListener('click', () => { sel = b.dataset.n; render(); }));
      const s = B.segs.flatMap(sg => sg[2].map(x => [x, sg])).find(([x]) => x[0] === sel);
      const [[n, sz, key, nobits], [type, perm]] = s;
      detail.innerHTML = `<p><b>${esc(n)}</b> · ${size(sz)}${nobits ? ' в памяти, 0 Б в файле' : ''} · ${perm ? `${type} <code>${perm}</code>` : 'в память не попадает'}</p><p>${D[key]}</p>` +
        `<p class="note">Весь файл: ${size(B.total)}. ${B.note}</p>`;
    }
    render();
    return {};
  });
})();

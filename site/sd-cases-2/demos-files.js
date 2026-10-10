// Case 1 — file storage and sync: estimates, upload flow, chunking, sync with conflicts.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const num = n => n >= 100 ? Math.round(n).toLocaleString('ru-RU') : n >= 10 ? dec(n, 0) : dec(n, 1);
  const bytes = b => {
    const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ', 'ЭБ'];
    let i = 0;
    while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
    return num(b) + ' ' + u[i];
  };
  const rate = n => n >= 1e6 ? dec(n / 1e6, n >= 1e7 ? 0 : 1) + ' млн' : n >= 1e3 ? dec(n / 1e3, n >= 1e4 ? 0 : 1) + ' тыс.' : Math.round(n) + '';

  function slider(root, label, list, idx, fmt, onChange) {
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
    const set = () => { out.textContent = fmt(list[+input.value]); };
    set();
    input.addEventListener('input', () => { set(); onChange(); });
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, label), input, out));
    return () => list[+input.value];
  }
  const stat = (b, s, cls = '') => `<div class="stat ${cls}"><b>${b}</b><span>${s}</span></div>`;

  // ---------------------------------------------------------------- estimates
  Deck.demo('fs-calc', root => {
    const update = () => render();
    const dau = slider(root, 'Активных в день', [10e6, 50e6, 100e6, 200e6, 500e6], 2, v => rate(v), update);
    const files = slider(root, 'Изменений файла на человека', [1, 2, 5, 10, 20], 1, v => v + ' в день', update);
    const size = slider(root, 'Средний размер файла', [100e3, 500e3, 1e6, 5e6, 20e6], 2, v => bytes(v), update);
    const dd = h('input', { type: 'checkbox', checked: true });
    dd.addEventListener('change', update);
    root.append(h('label', { class: 'toggle' }, dd, 'Чанки и дедупликация: грузим ~30% байтов'));
    const stats = h('div', { class: 'stats' });
    const log = h('p', { class: 'log' });
    root.append(stats, log);

    function render() {
      const writes = dau() * files();
      const qps = writes / 86400;
      const frac = dd.checked ? 0.3 : 1;
      const perDay = writes * size() * frac;
      const gbit = perDay / 86400 * 8 / 1e9;
      const year = perDay * 365 * 1.5;
      const meta = qps * 10; // commit + delta + notify per device, list folders…
      stats.innerHTML =
        stat(rate(qps), 'коммитов/с (пик ×3: ' + rate(qps * 3) + ')') +
        stat(dec(gbit, gbit < 10 ? 1 : 0) + ' Гбит/с', 'загрузка, скачивание ≈ ×2') +
        stat(bytes(perDay), 'новых байтов в сутки') +
        stat(bytes(year), 'за год с избыточностью ×1,5', year > 1e18 ? 'warn' : '') +
        stat(rate(meta), 'запросов к метаданным/с') +
        stat(rate(writes * Math.max(1, Math.ceil(size() / 4e6))), 'записей о кусках в сутки');
      log.innerHTML = `Байты: ${bytes(year)} в год — это объектное хранилище, не база. ` +
        `Метаданные: ~${rate(meta)} мелких запросов в секунду — шардированная SQL-база. ` +
        (dd.checked ? 'Дедупликация и загрузка только изменённых кусков втрое режут трафик и место.' : 'Без чанков каждая правка гонит файл целиком.');
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- upload flow as a sequence diagram
  Deck.demo('fs-flow', root => {
    const LANES = ['A', 'Метаданные', 'БД', 'S3', 'Уведомл.', 'B'];
    const STEPS = [
      [0, 0, 'режет и хеширует', 'Клиент A заметил изменение файла (inotify / FSEvents), разрезал его на куски и посчитал SHA-256 каждого. Пока это всё локально.'],
      [0, 1, 'commit(хеши)', 'A отправляет список хешей и base_rev: «вот из чего теперь состоит файл, я правил ревизию 7». Ни одного байта содержимого.'],
      [1, 0, '428: нужны h3, h7', 'Сервис сверяет хеши с таблицей кусков: всё, кроме h3 и h7, уже есть. Возвращает presigned URL на запись — подписанные ссылки с коротким сроком жизни.'],
      [0, 3, 'PUT h3, h7', 'A загружает только недостающие куски прямо в объектное хранилище. Сервис метаданных байты не видит — он не узкое место по трафику. Оборвалось — докачивается кусок, а не файл.'],
      [0, 1, 'commit(хеши)', 'Повторный коммит. Теперь все куски на месте (сервис проверяет их наличие или получил событие от S3).'],
      [1, 2, 'rev 8, журнал', 'В одной транзакции: file.rev = 8, если rev был 7 (иначе 409), новый список кусков, запись в журнал namespace с курсором 1051.'],
      [1, 4, 'ns 42 изменён', 'Сервис публикует событие: «namespace 42 изменился». Без содержимого — только сигнал.'],
      [4, 5, 'есть изменения', 'Устройство B держит long-poll (или WebSocket). Сервер уведомлений отвечает на него: «что-то изменилось».'],
      [5, 1, 'delta?cursor=1050', 'B просит всё, что произошло после его курсора. Пропущенное уведомление ничего не ломает: следующий запрос по курсору вернёт то же самое.'],
      [5, 3, 'GET h3, h7', 'B скачивает только куски, которых у него нет, — по presigned GET, часто через CDN. Собирает файл, сдвигает курсор на 1051.'],
    ];
    const seq = h('div', { class: 'seq' });
    const head = h('div', { class: 'seq-head' }, LANES.map(l => h('span', null, l)));
    const rows = h('div', { class: 'seq-rows' });
    seq.append(head, rows);
    const lifelines = () => LANES.map((_, k) => h('span', { class: 'seq-life', style: `left:${center(k)}%` }));
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала')), seq, log);
    let i = 0;
    const center = k => ((k + 0.5) / LANES.length) * 100;

    function step() {
      if (i >= STEPS.length) return;
      const [a, b, label, text] = STEPS[i];
      rows.querySelectorAll('.seq-row').forEach(r => r.classList.remove('cur'));
      const row = h('div', { class: 'seq-row cur' });
      if (a === b) {
        row.append(h('span', { class: 'seq-self', style: `left:${center(a)}%` }, label));
      } else {
        const l = Math.min(center(a), center(b)), r = Math.max(center(a), center(b));
        const arrow = h('span', { class: 'seq-arrow ' + (b > a ? 'right' : 'left'), style: `left:${l}%;width:${r - l}%` });
        const lab = h('span', { class: 'seq-label', style: l > 50 ? `right:${100 - r}%` : `left:${l}%` }, label);
        row.append(arrow, lab);
      }
      rows.append(row);
      log.innerHTML = `<b>${i + 1}.</b> ${text}`;
      i++;
      stepBtn.disabled = i >= STEPS.length;
    }
    function reset() {
      i = 0;
      rows.innerHTML = '';
      rows.append(...lifelines());
      stepBtn.disabled = false;
      log.textContent = 'Нажимайте «Шаг»: как правка файла на ноутбуке A доезжает до телефона B.';
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- chunking: fixed vs content-defined
  Deck.demo('chunks', root => {
    // Deterministic pseudo-text, ~1600 bytes.
    const WORDS = 'файл кусок хеш данные версия клиент сервер диск сеть правка отчёт таблица строка байт блок архив копия журнал папка документ'.split(' ');
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) / 16777216;
    let base = '';
    while (base.length < 1600) base += WORDS[Math.floor(rnd() * WORDS.length)] + (rnd() < 0.12 ? '. ' : ' ');
    const FIXED = 128, MIN = 48, MAX = 384, WIN = 16, MASK = 63; // CDC: boundary chance 1/64 after MIN, average ≈ 110 Б

    const fnv = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); } return x >>> 0; };
    const fmix = x => { x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };
    // Rolling polynomial hash over the last WIN characters (computed directly — the text is small).
    function cdc(s) {
      const out = [];
      let start = 0;
      for (let i = 0; i < s.length; i++) {
        const len = i - start + 1;
        if (len < MIN) continue;
        let hsh = 0;
        for (let j = i - WIN + 1; j <= i; j++) hsh = (Math.imul(hsh, 31) + s.charCodeAt(j)) >>> 0;
        if ((fmix(hsh) & MASK) === 0 || len >= MAX) { out.push(s.slice(start, i + 1)); start = i + 1; }
      }
      if (start < s.length) out.push(s.slice(start));
      return out;
    }
    const fixed = s => { const out = []; for (let i = 0; i < s.length; i += FIXED) out.push(s.slice(i, i + FIXED)); return out; };

    let text, known, lastEdit;
    const rowsEl = h('div', { class: 'ck-rows' });
    const log = h('p', { class: 'log', 'aria-live': 'polite' });
    const edits = [
      ['Вставить 5 байт в начало', s => { lastEdit = 0; return 'Итак ' + s; }, 'Вставка в начало'],
      ['Изменить слово в середине', s => { const p = s.indexOf(' ', s.length >> 1) + 1; lastEdit = p; const e = s.indexOf(' ', p); return s.slice(0, p) + 'ПРАВКА' + s.slice(e); }, 'Замена слова в середине'],
      ['Удалить 40 байт', s => { const p = Math.floor(s.length * 0.3); lastEdit = p; return s.slice(0, p) + s.slice(p + 40); }, 'Удаление 40 байт'],
      ['Дописать в конец', s => { lastEdit = s.length; return s + 'новая строка в конце файла. '; }, 'Дописали в конец'],
    ];
    root.append(
      h('div', { class: 'controls' }, edits.map(([label, fn, what]) => h('button', { class: 'btn small', onclick: () => apply(fn, what) }, label)),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      rowsEl, log);

    function apply(fn, what) {
      text = fn(text);
      render(what);
    }
    function reset() {
      text = base;
      lastEdit = null;
      known = { fixed: new Set(fixed(text).map(fnv)), cdc: new Set(cdc(text).map(fnv)) };
      render(null);
    }
    function row(kind, title, chunks) {
      const set = known[kind];
      let up = 0, upBytes = 0;
      const bar = h('div', { class: 'ck-bar' });
      let pos = 0;
      chunks.forEach(c => {
        const hc = fnv(c);
        const isNew = !set.has(hc);
        if (isNew) { up++; upBytes += c.length; }
        bar.append(h('span', { class: 'ck' + (isNew ? ' new' : ''), style: `flex-grow:${c.length}`, title: `${c.length} Б, хеш ${hc.toString(16).slice(0, 4)}` },
          h('i', null, hc.toString(16).slice(0, 3))));
        pos += c.length;
      });
      chunks.forEach(c => set.add(fnv(c))); // server now has them
      const marker = lastEdit == null ? null : h('span', { class: 'ck-mark', style: `left:${(lastEdit / text.length) * 100}%` });
      if (marker) bar.append(marker);
      return [h('div', { class: 'ck-row' },
        h('div', { class: 'ck-title' }, h('b', null, title), h('span', null, `${chunks.length} ${plural(chunks.length, ['кусок', 'куска', 'кусков'])}, загрузить `, h('b', { class: up ? 'hot' : '' }, `${up} (${upBytes} Б)`))),
        bar), up, upBytes];
    }
    function render(what) {
      rowsEl.innerHTML = '';
      const [r1, u1, b1] = row('fixed', `Фиксированные по ${FIXED} Б`, fixed(text));
      const [r2, u2, b2] = row('cdc', 'По содержимому (CDC)', cdc(text));
      rowsEl.append(r1, r2);
      if (!what) {
        log.innerHTML = `Файл ${text.length} байт загружен целиком, сервер знает все куски. Подписи — первые цифры хеша.`;
        log.className = 'log';
      } else {
        log.innerHTML = `${what}: фиксированные куски — загрузить ${u1} (${b1} Б), по содержимому — ${u2} (${b2} Б). ` +
          (u1 > u2 * 2 ? 'Сдвиг сместил все фиксированные границы после правки, а границы CDC привязаны к содержимому и сдвинулись вместе с ним.' : 'Правка без сдвига: обоим способам нужно перезалить только затронутое.');
        log.className = 'log ' + (u1 > u2 * 2 ? 'warn' : 'ok');
      }
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- sync with conflicts
  Deck.demo('fs-sync', root => {
    let server, devs, cursor;
    const srvEl = h('div', { class: 'sy-server' });
    const devEls = h('div', { class: 'sy-devs' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(srvEl, devEls, logEl, h('div', { class: 'controls' }, h('button', { class: 'btn small', onclick: reset }, 'Сброс')));
    const lines = [];
    const say = (t, cls = '') => {
      lines.unshift(t); lines.length = Math.min(lines.length, 2);
      logEl.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      logEl.className = 'log ' + cls;
    };

    function reset() {
      server = { rev: 1, content: 'v1', copies: [] };
      cursor = 1;
      devs = ['A', 'B'].map(n => ({ n, online: true, base: 1, content: 'v1', dirty: false, edits: 0, seen: 1 }));
      lines.length = 0;
      say('Оба устройства синхронизированы: файл «отчёт.docx», ревизия 1.');
      render();
    }
    function edit(d) {
      d.edits++;
      d.content = d.n + d.edits;
      d.dirty = true;
      if (d.online) push(d, `${d.n} правит файл и сразу коммитит: `);
      else { say(`${d.n} правит файл офлайн: локально «${d.content}» поверх ревизии ${d.base}. Отправить пока нельзя.`); render(); }
    }
    function push(d, prefix = '') {
      if (d.base === server.rev) {
        server.rev++; server.content = d.content; cursor++;
        d.base = server.rev; d.dirty = false; d.seen = cursor;
        const others = devs.filter(o => o !== d);
        const notes = others.map(o => {
          if (!o.online) return `${o.n} офлайн — заберёт по курсору, когда вернётся`;
          if (o.dirty) return `${o.n} получил сигнал, но у него несохранённая правка`;
          pull(o);
          return `${o.n} получил сигнал и скачал ревизию ${server.rev}`;
        });
        say(`${prefix}commit(base_rev=${server.rev - 1}) принят → ревизия ${server.rev}. ${notes.join('; ')}.`, 'ok');
      } else {
        const name = `отчёт (конфликтная копия ${d.n}).docx`;
        server.copies.push({ name, content: d.content });
        cursor++;
        const mine = d.content, oldBase = d.base;
        d.dirty = false; d.content = server.content; d.base = server.rev; d.seen = cursor;
        devs.filter(o => o !== d && o.online && !o.dirty).forEach(pull);
        say(`${prefix}commit(base_rev=${oldBase}) → 409: на сервере уже ревизия ${server.rev}. Слить двоичные файлы нельзя — правка «${mine}» сохранена как «${name}», основной файл — версия «${server.content}».`, 'warn');
      }
      render();
    }
    function pull(d) {
      d.base = server.rev; d.content = server.content; d.seen = cursor;
    }
    function toggle(d) {
      d.online = !d.online;
      if (!d.online) { say(`${d.n} без сети. Long-poll оборвался, уведомлений нет.`); render(); return; }
      const behind = d.seen < cursor;
      if (d.dirty) push(d, `${d.n} снова в сети, ${behind ? `delta?cursor=${d.seen} показывает чужие изменения, ` : ''}отправляет свою правку: `);
      else {
        if (behind) { const c0 = d.seen; pull(d); say(`${d.n} снова в сети: delta?cursor=${c0} вернула пропущенные изменения, скачана ревизия ${server.rev}.`, 'ok'); }
        else say(`${d.n} снова в сети: изменений не было.`);
        render();
      }
    }
    function render() {
      srvEl.innerHTML = `<div class="sy-h">Сервер <span>курсор журнала ${cursor}</span></div>` +
        `<div class="sy-file"><b>отчёт.docx</b> rev ${server.rev} · «${server.content}»</div>` +
        server.copies.map(c => `<div class="sy-file copy"><b>${c.name}</b> · «${c.content}»</div>`).join('');
      devEls.innerHTML = '';
      devs.forEach(d => {
        const st = d.dirty ? 'не отправлено' : d.base === server.rev ? 'синхронизировано' : 'отстаёт';
        devEls.append(h('div', { class: 'sy-dev' + (d.online ? '' : ' off') + (d.dirty ? ' dirty' : '') },
          h('div', { class: 'sy-h' }, 'Устройство ' + d.n, h('span', null, d.online ? 'в сети' : 'офлайн')),
          h('div', { class: 'sy-file' }, h('b', null, '«' + d.content + '»'), ` поверх rev ${d.base}`),
          h('div', { class: 'sy-st' }, st),
          h('div', { class: 'controls' },
            h('button', { class: 'btn small', onclick: () => edit(d) }, 'Правка'),
            h('button', { class: 'btn small', onclick: () => toggle(d) }, d.online ? 'Выключить сеть' : 'Включить сеть'))));
      });
    }
    reset();
    return {};
  });
})();

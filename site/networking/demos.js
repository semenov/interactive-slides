// Shared helpers and demos for slides 2–6: encapsulation, subnets, traceroute, NAT, DNS.
(() => {
  'use strict';
  const { h } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }

  // Ladder (sequence) diagram as an SVG string. Time flows down.
  // msgs: { from: 'L'|'R', t0, t1, label, cls, lost }; spans: { side: 'L'|'R', t0, t1, label, cls }.
  function ladder({ left, right, T, msgs, spans = [], W = 420, unit = 4, top = 26, ticks }) {
    const xl = 64, xr = W - 64, H = top + T * unit + 12;
    const y = t => top + t * unit;
    let s = `<svg class="ladder" viewBox="0 0 ${W} ${H}" role="img">`;
    s += `<defs><marker id="lad-a" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0L8 4L0 8z" fill="context-stroke"/></marker></defs>`;
    s += `<text class="lad-h" x="${xl - 40}" y="14">${left}</text><text class="lad-h" x="${xr + 40}" y="14" text-anchor="end">${right}</text>`;
    s += `<line class="lad-lane" x1="${xl}" y1="${top - 4}" x2="${xl}" y2="${H - 4}"/><line class="lad-lane" x1="${xr}" y1="${top - 4}" x2="${xr}" y2="${H - 4}"/>`;
    if (ticks) for (const [t, label] of ticks) s += `<text class="lad-tick" x="${xl - 8}" y="${y(t) + 4}" text-anchor="end">${label}</text>`;
    for (const sp of spans) {
      const x = sp.side === 'L' ? xl : xr;
      s += `<rect class="lad-span ${sp.cls || ''}" x="${x - 5}" y="${y(sp.t0)}" width="10" height="${Math.max(2, (sp.t1 - sp.t0) * unit)}" rx="3"/>`;
      const tx = sp.side === 'L' ? x + 10 : x - 10;
      s += `<text class="lad-span-t ${sp.cls || ''}" x="${tx}" y="${y((sp.t0 + sp.t1) / 2) + 4}" text-anchor="${sp.side === 'L' ? 'start' : 'end'}">${sp.label}</text>`;
    }
    for (const m of msgs) {
      const x0 = m.from === 'L' ? xl : xr, x1 = m.from === 'L' ? xr : xl;
      const y0 = y(m.t0), y1 = y(m.t1);
      const cls = 'lad-m ' + (m.cls || '') + (m.lost ? ' lost' : '') + (m.cur ? ' cur' : '');
      if (m.lost) {
        const xm = x0 + (x1 - x0) * 0.55, ym = y0 + (y1 - y0) * 0.55;
        s += `<line class="${cls}" x1="${x0}" y1="${y0}" x2="${xm}" y2="${ym}"/>`;
        s += `<path class="lad-x" d="M${xm - 5} ${ym - 5}l10 10M${xm + 5} ${ym - 5}l-10 10"/>`;
      } else {
        s += `<line class="${cls}" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" marker-end="url(#lad-a)"/>`;
      }
    }
    for (const m of msgs) {
      const x0 = m.from === 'L' ? xl : xr, y0 = y(m.t0);
      const lx = m.from === 'L' ? x0 + 6 : x0 - 6;
      const tw = m.label.length * 6.4 + 4;
      s += `<rect class="lad-bg" x="${m.from === 'L' ? lx - 2 : lx - tw + 2}" y="${y0 - 13}" width="${tw}" height="13" rx="2"/>`;
      s += `<text class="lad-l ${m.cls || ''}${m.cur ? ' cur' : ''}" x="${lx}" y="${y0 - 3}" text-anchor="${m.from === 'L' ? 'start' : 'end'}">${m.label}</text>`;
    }
    return s + '</svg>';
  }

  window.Net = { logger, ladder, fmt, dec };

  // ---------------------------------------------------------------- encapsulation
  Deck.demo('encap', root => {
    const SIZES = [80, 160, 600, 1448, 3000, 8000, 20000, 64000];
    const MTUS = [[1500, 'Ethernet 1500'], [1420, 'WireGuard 1420'], [9000, 'jumbo 9000']];
    let size = 160, mtu = 1500, layer = 'tcp';
    const nest = h('div', { class: 'enc-nest' });
    const fields = h('div', { class: 'enc-fields' });
    const strip = h('div', { class: 'enc-strip' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const sizeOut = h('output');
    const sizeIn = h('input', { type: 'range', min: 0, max: SIZES.length - 1, value: 1, 'aria-label': 'Размер HTTP-сообщения' });
    sizeIn.addEventListener('input', () => { size = SIZES[+sizeIn.value]; update(); });
    const mtuBtns = MTUS.map(([m, label]) => h('button', { class: 'btn small', onclick: () => { mtu = m; update(); } }, label));
    root.append(
      nest, fields,
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'HTTP-сообщение'), sizeIn, sizeOut),
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'MTU'), mtuBtns),
      strip, stats, logEl,
    );

    const L = {
      eth: { name: 'Ethernet', hdr: '14 Б + 4 Б в конце' },
      ip: { name: 'IPv4', hdr: '20 Б' },
      tcp: { name: 'TCP', hdr: '20 Б + 12 Б опций' },
      app: { name: 'HTTP', hdr: 'данные' },
    };
    function fieldRows(first) {
      const ipLen = 20 + 32 + first;
      const F = {
        eth: [
          ['MAC получателя', '3c:84:6a:12:9e:01', 'MAC шлюза, а не сервера: кадр живёт только до следующего устройства'],
          ['MAC отправителя', 'a4:83:e7:5b:20:c4', ''],
          ['EtherType', '0x0800', 'внутри IPv4'],
          ['FCS', 'CRC-32', 'контрольная сумма в конце кадра; битый кадр молча выбрасывается'],
        ],
        ip: [
          ['Общая длина', ipLen + ' Б', 'не больше MTU'],
          ['TTL', '64', 'каждый маршрутизатор уменьшает на 1'],
          ['Протокол', '6 = TCP', '17 был бы UDP'],
          ['Флаги', 'DF', 'не фрагментировать: слишком большой пакет вернётся ошибкой ICMP'],
          ['Отправитель', '192.168.1.37', ''],
          ['Получатель', '93.184.215.14', 'не меняется на всём пути (если нет NAT)'],
        ],
        tcp: [
          ['Порты', '51544 → 80', 'порт клиента — эфемерный, выдан ядром'],
          ['seq', '1', 'номер первого байта данных (относительный)'],
          ['ack', '1', 'следующий байт, который ждём от сервера'],
          ['Флаги', 'PSH, ACK', ''],
          ['Окно', '502 × 128', '= 64 256 Б свободно в буфере получателя'],
          ['Опции', 'timestamps', '12 Б: для измерения RTT и защиты от старых сегментов'],
        ],
        app: [
          ['', 'GET /api/users HTTP/1.1', ''],
          ['', 'Host: api.example.com', ''],
          ['', 'Accept: application/json', ''],
          ['Размер', fmt(size) + ' Б', size > 1448 ? 'не влезает в один сегмент' : 'влезает в один сегмент'],
        ],
      };
      return F[layer];
    }
    function update() {
      const mss = mtu - 40, data = mss - 12;
      const n = Math.ceil(size / data);
      const first = Math.min(size, data);
      const frameBytes = k => 14 + 20 + 32 + k + 4;
      let wire = 0;
      for (let left = size; left > 0; left -= data) wire += frameBytes(Math.min(left, data)) + 20; // +preamble+gap
      sizeOut.textContent = fmt(size) + ' Б';
      mtuBtns.forEach((b, i) => b.classList.toggle('sel', MTUS[i][0] === mtu));
      const box = (k, inner) => `<div class="enc-l ${k} ${layer === k ? 'sel' : ''}" data-l="${k}"><button class="enc-h" data-l="${k}"><b>${L[k].name}</b> <span>${L[k].hdr}</span></button>${inner}</div>`;
      nest.innerHTML = box('eth', box('ip', box('tcp', box('app', `<div class="enc-data">${fmt(first)} Б данных${n > 1 ? ` <span>из ${fmt(size)}</span>` : ''}</div>`))));
      fields.innerHTML = fieldRows(first).map(([k, v, note]) =>
        `<div class="enc-f"><span>${k}</span><b>${v}</b>${note ? `<small>${note}</small>` : ''}</div>`).join('');
      const shown = Math.min(n, 48);
      strip.innerHTML = Array.from({ length: shown }, (_, i) => {
        const k = Math.min(data, size - i * data);
        return `<span class="enc-fr" title="кадр ${i + 1}"><i style="width:${(70 / frameBytes(k)) * 100}%"></i><em style="width:${(k / frameBytes(k)) * 100}%"></em></span>`;
      }).join('') + (n > shown ? `<span class="more">+${n - shown}</span>` : '');
      const over = (wire - size) / wire * 100;
      stats.innerHTML = `<div class="stat"><b>${fmt(n)}</b><span>${Deck.plural(n, ['сегмент', 'сегмента', 'сегментов'])} по ≤ ${fmt(data)} Б</span></div>` +
        `<div class="stat"><b>${fmt(wire)}</b><span>байт на проводе</span></div>` +
        `<div class="stat ${over > 30 ? 'warn' : ''}"><b>${dec(over)}%</b><span>заголовки и служебное</span></div>`;
      say(`MTU ${fmt(mtu)} → MSS ${fmt(mss)} → ${fmt(data)} Б данных в сегменте (12 Б съедают опции). ` +
        (n > 1 ? `Сообщение уйдёт ${n} ${Deck.plural(n, ['сегментом', 'сегментами', 'сегментами'])}, у каждого свои заголовки.` :
          over > 30 ? 'Маленький запрос: заголовки — заметная часть трафика. Поэтому мелкие пакеты дороги.' : 'Всё влезло в один кадр.'));
    }
    nest.addEventListener('click', e => {
      const t = e.target.closest('[data-l]');
      if (!t) return;
      layer = t.dataset.l;
      update();
    });
    update();
    return {};
  });

  // ---------------------------------------------------------------- subnet decision
  Deck.demo('subnet', root => {
    const ME = [192, 168, 1, 37], GW = [192, 168, 1, 1];
    const DST = [
      [[192, 168, 1, 80], 'принтер'],
      [[192, 168, 7, 12], 'NAS в соседнем VLAN'],
      [[10, 20, 0, 5], 'сервер в VPN'],
      [[93, 184, 215, 14], 'сайт в интернете'],
    ];
    let prefix = 24, dst = DST[0][0];
    const toInt = a => ((a[0] << 24) >>> 0) + (a[1] << 16) + (a[2] << 8) + a[3];
    const toIp = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    const maskOf = p => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
    const pOut = h('output');
    const pIn = h('input', { type: 'range', min: 8, max: 30, value: prefix, 'aria-label': 'Длина префикса' });
    pIn.addEventListener('input', () => { prefix = +pIn.value; update(); });
    const dBtns = DST.map(([a, label]) => h('button', { class: 'btn small', onclick: () => { dst = a; update(); } }, a.join('.'), h('span', { class: 'sn-tag' }, ' ' + label)));
    const bits = h('div', { class: 'sn-bits' });
    const info = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Кому:'), dBtns),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Префикс'), pIn, pOut),
      bits, info, logEl,
    );
    function binRow(label, n, cmp) {
      let s = '';
      for (let i = 0; i < 32; i++) {
        const b = (n >>> (31 - i)) & 1;
        const net = i < prefix;
        const diff = cmp != null && net && b !== ((cmp >>> (31 - i)) & 1);
        s += `<i class="${net ? 'net' : 'host'}${diff ? ' diff' : ''}">${b}</i>`;
        if (i % 8 === 7 && i < 31) s += '<i class="dot">.</i>';
      }
      return `<div class="sn-row"><span>${label}</span><code>${s}</code></div>`;
    }
    function update() {
      pOut.textContent = '/' + prefix;
      const m = maskOf(prefix), me = toInt(ME), d = toInt(dst), gw = toInt(GW);
      const net = (me & m) >>> 0, bc = (net | ~m) >>> 0;
      const same = ((d & m) >>> 0) === net;
      const gwIn = ((gw & m) >>> 0) === net;
      dBtns.forEach((b, i) => b.classList.toggle('sel', DST[i][0] === dst));
      bits.innerHTML = binRow('я ' + ME.join('.'), me) + binRow('маска ' + toIp(m), m) + binRow('кому ' + dst.join('.'), d, me);
      const hosts = Math.pow(2, 32 - prefix) - 2;
      info.innerHTML = `<div class="stat"><b>${toIp(net)}/${prefix}</b><span>моя сеть</span></div>` +
        `<div class="stat"><b>${fmt(hosts)}</b><span>адресов для хостов</span></div>` +
        `<div class="stat"><b>${toIp(bc)}</b><span>широковещательный</span></div>`;
      const priv = dst[0] === 10 || (dst[0] === 192 && dst[1] === 168) || (dst[0] === 172 && dst[1] >= 16 && dst[1] < 32);
      if (same) {
        logEl.className = 'log ok';
        logEl.innerHTML = `Биты сети совпадают — получатель рядом. Ядро спросит ARP «у кого ${dst.join('.')}?» и отправит кадр прямо на его MAC.`;
      } else if (!gwIn) {
        logEl.className = 'log bad';
        logEl.innerHTML = `Получатель в другой сети, а шлюз ${GW.join('.')} при префиксе /${prefix} тоже оказался «чужим». Маршрута нет: <code>connect: network is unreachable</code>. Неверная маска — классическая причина «вижу соседей, но не интернет».`;
      } else {
        logEl.className = 'log';
        logEl.innerHTML = `Биты сети различаются (отмечены красным) — пакет уйдёт на шлюз ${GW.join('.')}: в кадре MAC шлюза, в IP-заголовке — ${dst.join('.')}.` +
          (priv ? ' Адрес частный: дойдёт, только если у шлюза есть маршрут в ту сеть (VPN, пиринг VPC).' : '');
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- traceroute
  Deck.demo('traceroute', root => {
    const HOPS = [
      ['192.168.1.1', 'домашний роутер', 1.2],
      ['100.64.0.1', 'NAT провайдера', 6.1],
      ['198.51.100.1', 'магистраль провайдера, Москва', 7.4],
      [null, 'не отвечает на ICMP', 0],
      ['203.0.113.9', 'точка обмена трафиком, Франкфурт', 41.3],
      ['203.0.113.77', 'сеть хостинга', 43.0],
      ['93.184.215.14', 'сервер', 43.8],
    ];
    let ttl = 0;
    const path = h('div', { class: 'tr-path' });
    const out = h('pre', { class: 'code tr-out' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const nextBtn = h('button', { class: 'btn primary', onclick: step }, 'Следующий TTL');
    root.append(
      h('div', { class: 'controls' }, nextBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      path, out, logEl,
    );
    const jit = (base, k) => base ? dec(base * (1 + ((k * 37 + base * 13) % 7 - 3) / 60), 1) + ' ms' : '*';
    function reset() {
      ttl = 0;
      nextBtn.disabled = false;
      logEl.className = 'log';
      logEl.innerHTML = 'Ноутбук хочет узнать путь до 93.184.215.14. Отправим пакет с TTL = 1.';
      render();
    }
    function step() {
      ttl++;
      const [ip, name, ms] = HOPS[ttl - 1];
      const last = ttl === HOPS.length;
      if (last) {
        logEl.className = 'log ok';
        logEl.innerHTML = `TTL = ${ttl}: пакет дошёл до цели. Она отвечает не Time Exceeded, а Port Unreachable: traceroute шлёт UDP на заведомо закрытый порт (mtr и Windows — ICMP echo). Готово.`;
        nextBtn.disabled = true;
      } else if (!ip) {
        logEl.className = 'log warn';
        logEl.innerHTML = `TTL = ${ttl}: тишина. Этот маршрутизатор не отвечает на ICMP или ограничивает их частоту — но пакеты пересылает: следующие шаги ответят. «* * *» посреди пути — не поломка.`;
      } else {
        logEl.className = 'log';
        const jump = ttl === 5 ? ' Скачок на 34 мс — пересекли 2 000 км: свет в оптоволокне проходит ~200 км за миллисекунду, а RTT — путь туда и обратно.' : '';
        logEl.innerHTML = `TTL = ${ttl}: ${name} (${ip}) уменьшил TTL до нуля, выбросил пакет и ответил ICMP Time Exceeded. RTT ${dec(ms)} мс.${jump}`;
      }
      render();
    }
    function render() {
      path.innerHTML = '<span class="tr-n me" title="ноутбук">●</span>' + HOPS.map((hp, i) => {
        const cls = i + 1 < ttl ? 'past' : i + 1 === ttl ? (hp[0] ? (i + 1 === HOPS.length ? 'goal' : 'died') : 'silent') : '';
        return `<span class="tr-e ${i < ttl ? 'past' : ''}"></span><span class="tr-n ${cls}" title="${hp[1]}">${i + 1}</span>`;
      }).join('');
      out.innerHTML = '<span class="c">$ traceroute 93.184.215.14</span>\n' + HOPS.slice(0, ttl).map(([ip, , ms], i) =>
        `${String(i + 1).padStart(2)}  ${ip ? (ip.padEnd(14) + ' ' + [0, 1, 2].map(k => jit(ms, i * 3 + k).padStart(8)).join('')) : '*  *  *'}`).join('\n');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- NAT
  Deck.demo('nat', root => {
    const PUB = '203.0.113.7', API = '93.184.215.14:443';
    let table, nextPort, pkt;
    const pktEl = h('div', { class: 'nat-pkt' });
    const tableEl = h('div', { class: 'nat-table' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const B = (label, fn, cls = 'btn small') => h('button', { class: cls, onclick: fn }, label);
    root.append(
      h('div', { class: 'nat-net' },
        h('div', null, h('span', { class: 'label' }, 'локальная сеть'), h('b', null, 'ноутбук .37'), h('b', null, 'телефон .52')),
        h('div', { class: 'nat-r' }, h('span', { class: 'label' }, 'роутер с NAT'), h('b', null, PUB)),
        h('div', null, h('span', { class: 'label' }, 'интернет'), h('b', null, 'api ' + API.split(':')[0]))),
      h('div', { class: 'controls' },
        B('Ноутбук → api', () => out('192.168.1.37:51544', 'ноутбук')),
        B('Телефон → api', () => out('192.168.1.52:51544', 'телефон')),
        B('Ответ api ноутбуку', reply),
        B('Снаружи → :8080', inbound),
        B('Тишина 6 минут', idle),
        B('Сброс', reset)),
      pktEl, tableEl, logEl,
    );
    function reset() {
      table = []; nextPort = 40001; pkt = null;
      say('Таблица NAT пуста. У ноутбука и телефона частные адреса — из интернета их не видно.');
      render();
    }
    function out(src, who) {
      let e = table.find(r => r.in === src);
      const isNew = !e;
      if (!e) { e = { in: src, out: PUB + ':' + nextPort++, dst: API }; table.push(e); }
      e.age = 0;
      pkt = [`${src} → ${API}`, `${e.out} → ${API}`, 'наружу'];
      say(isNew
        ? `${who === 'телефон' ? 'Телефон использует тот же порт 51544, что и ноутбук, — роутер выдаёт другой внешний порт, чтобы различать их. ' : ''}Новая запись: ${src} ↔ ${e.out}. Сервер видит только ${PUB}.`
        : `Запись уже есть, таймер простоя сброшен. Пакет ушёл как ${e.out}.`);
      render();
    }
    function reply() {
      const e = table.find(r => r.in.startsWith('192.168.1.37'));
      if (!e) {
        pkt = [`${API} → ${PUB}:40001`, 'записи нет — пакет отброшен', 'внутрь'];
        say(table.length || nextPort > 40001
          ? 'Записи для этого соединения уже нет: истёк таймаут простоя. Ответ сервера выброшен. Клиент узнает об этом только по таймауту или RST при следующей отправке — «соединение тихо умерло».'
          : 'Ноутбук ещё ничего не отправлял — записи нет, пакет выброшен.', 'bad');
      } else {
        e.age = 0;
        pkt = [`${API} → ${e.out}`, `${API} → ${e.in}`, 'внутрь'];
        say(`Роутер нашёл запись по внешнему порту и вернул пакету адрес назначения ${e.in}.`, 'ok');
      }
      render();
    }
    function inbound() {
      pkt = [`198.51.100.50:61000 → ${PUB}:8080`, 'записи нет — пакет отброшен', 'внутрь'];
      say('Входящее соединение, которого никто изнутри не начинал. Роутер не знает, кому его отдать. Чтобы принимать соединения, нужен проброс порта или публичный адрес. Поэтому P2P и звонки пробивают NAT через STUN или идут через ретранслятор.', 'warn');
      render();
    }
    function idle() {
      const n = table.length;
      table = [];
      pkt = null;
      say(n ? `Шесть минут без пакетов. У AWS NAT Gateway таймаут простоя 350 с, у домашних роутеров бывает и меньше — ${n === 1 ? 'запись удалена' : 'записи удалены'}. Обе стороны при этом считают соединение открытым. Теперь нажмите «Ответ api ноутбуку».` :
        'Таблица и так пуста.', n ? 'warn' : '');
      render();
    }
    function render() {
      pktEl.innerHTML = pkt
        ? `<div><span class="label">пакет ${pkt[2]} до NAT</span><code>${pkt[2] === 'наружу' ? pkt[0] : pkt[0]}</code></div><div><span class="label">после NAT</span><code class="${pkt[1].includes('отброшен') ? 'drop' : ''}">${pkt[1]}</code></div>`
        : '<div><span class="label">пакетов пока нет</span><code>—</code></div>';
      tableEl.innerHTML = '<div class="nat-row head"><span>внутри</span><span>снаружи</span><span>куда</span></div>' +
        (table.length ? table.map(r => `<div class="nat-row"><code>${r.in}</code><code>${r.out}</code><code>${r.dst}</code></div>`).join('')
          : '<div class="nat-row"><span class="empty">записей нет</span></div>');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- DNS resolution chain
  Deck.demo('dns', root => {
    const NODES = [
      ['app', 'приложение', 'getaddrinfo()'],
      ['stub', 'системный резолвер', '/etc/hosts, кэш ОС'],
      ['rec', 'рекурсивный резолвер', '1.1.1.1 или провайдера'],
      ['root', 'корневой сервер', 'a.root-servers.net'],
      ['tld', 'сервер зоны .com', 'a.gtld-servers.net'],
      ['auth', 'авторитетный сервер', 'ns1.example.com'],
    ];
    // Each step: [from, to, text, ms]
    const FULL = [
      ['app', 'stub', '<code>getaddrinfo("api.example.com")</code>: в <code>/etc/hosts</code> нет, в кэше ОС нет — спросим резолвер из <code>/etc/resolv.conf</code>.', 0.1],
      ['stub', 'rec', 'Запрос по UDP на порт 53: «A-запись api.example.com?». Резолвер проверяет кэш — пусто.', 12],
      ['rec', 'root', 'Корень не знает ответа, но знает, кто отвечает за <code>.com</code>: «спроси a.gtld-servers.net». Эта подсказка кэшируется на двое суток.', 9],
      ['rec', 'tld', 'Сервер зоны <code>.com</code>: «за example.com отвечает ns1.example.com».', 24],
      ['rec', 'auth', 'Авторитетный сервер: «api.example.com A 93.184.215.14, TTL 300». Резолвер кладёт ответ в кэш на 5 минут.', 78],
      ['rec', 'app', 'Ответ возвращается приложению. Только теперь можно начинать TCP-соединение.', 0],
    ];
    const NS_CACHED = [FULL[0], FULL[1], ['rec', 'auth', 'Кэш ответа истёк, но адреса серверов <code>.com</code> и <code>example.com</code> ещё в кэше — резолвер сразу идёт к авторитетному.', 78], FULL[5]];
    const HIT = [FULL[0], ['stub', 'rec', 'Ответ в кэше резолвера, TTL ещё не истёк — ответ сразу.', 12], FULL[5]];
    let steps, i, total, cache;
    const chain = h('div', { class: 'dns-chain' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    const againBtn = h('button', { class: 'btn', onclick: () => begin(cache === 'answer' ? HIT : cache === 'ns' ? NS_CACHED : FULL) }, 'Ещё раз');
    const waitBtn = h('button', { class: 'btn', onclick: () => { if (cache === 'answer') cache = 'ns'; logEl.className = 'log'; logEl.innerHTML = 'Прошло 6 минут: TTL ответа (300 с) истёк, а записи о серверах зон ещё живы. Нажмите «Ещё раз».'; } }, 'Прошло 6 минут');
    root.append(h('div', { class: 'controls' }, stepBtn, againBtn, waitBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')), chain, stats, logEl);
    function reset() { cache = null; begin(FULL); }
    function begin(s) {
      steps = s; i = 0; total = 0;
      stepBtn.disabled = false; againBtn.disabled = true;
      logEl.className = 'log';
      logEl.innerHTML = 'Приложению нужен адрес <code>api.example.com</code>. Нажимайте «Шаг».';
      render(null);
    }
    function step() {
      const st = steps[i++];
      total += st[3];
      logEl.className = 'log' + (i === steps.length ? ' ok' : '');
      logEl.innerHTML = st[2] + (i === steps.length ? ` Итого ${dec(total, total < 2 ? 1 : 0)} мс.` : '');
      if (i === steps.length) {
        stepBtn.disabled = true; againBtn.disabled = false;
        if (steps !== HIT) cache = 'answer';
      }
      render(st);
    }
    function render(st) {
      chain.innerHTML = NODES.map(([k, name, sub]) => {
        const on = st && (st[0] === k || st[1] === k);
        const cached = (k === 'rec' && cache) ? `<em>в кэше: ${cache === 'answer' ? 'ответ, NS' : 'NS зон'}</em>` : '';
        return `<div class="dns-n ${on ? 'on' : ''}"><b>${name}</b><span>${sub}</span>${cached}</div>`;
      }).join('');
      stats.innerHTML = `<div class="stat"><b>${dec(total, total < 2 ? 1 : 0)} мс</b><span>прошло</span></div>` +
        `<div class="stat"><b>${i} / ${steps.length}</b><span>шагов</span></div>` +
        `<div class="stat"><b>${steps === FULL ? 'пустой' : steps === HIT ? 'ответ' : 'частичный'}</b><span>кэш на старте запроса</span></div>`;
    }
    reset();
    return {};
  });
})();

// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the
// model's own inputs and the protocol's farm plan, and the live-token comparables.
// No network: every byte it shows is in data.js. The page also reads its starting state
// from the URL hash, so a screenshot can open one exact view: #tab=pre|live,
// #cat=<category>, #chain=<chain>, #q=<text>, #sort=<key>, #detail=<slug>.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var main = document.querySelector('main');
  if (!DATA || !DATA.rows) {
    if (main) main.insertAdjacentHTML('afterbegin', '<p class="empty">No radar data loaded.</p>');
    return;
  }

  var state = { tab: 'pre', q: '', category: 'all', chain: 'all', sort: 'implied', dir: -1, selected: null };

  // ---------- formatting ----------

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' years';
    return Math.max(0, Math.round(days)) + ' days';
  }
  function fmtMult(n) {
    return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : n.toFixed(2) + 'x';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- tiny DOM helper ----------

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------- static sections ----------

  function renderStats() {
    var top = DATA.rows[0];
    var stats = document.getElementById('stats');
    var items = [
      [String(DATA.board_size), 'protocols ranked'],
      [String(DATA.watchlist_size), 'on the watchlist'],
      [String(DATA.early_size), 'early, below the floor'],
      [top ? fmtUsd(top.implied_value_usd) : 'n/a', 'top implied value'],
      ['Snapshot ' + DATA.as_of, 'frozen DefiLlama data'],
    ];
    items.forEach(function (it) {
      stats.appendChild(el('div', null, el('dt', { text: it[1] }), el('dd', { text: it[0] })));
    });
  }

  function renderModel() {
    var m = DATA.model;
    var box = document.getElementById('model');
    box.appendChild(el('h2', { text: 'How the ranking works — model ' + DATA.model_version }));
    box.appendChild(el('p', {
      text: 'The implied value is the entry\u2019s own claim about what a protocol\u2019s token would be worth if its record stayed as it is. ' +
        'It is not a prediction that a token will be issued, or when. Every input comes from the snapshot itself; no protocol name is ever special-cased, and the same arithmetic scores every row.',
    }));
    var formula = 'implied value  =  TVL  x  peer multiple  x  growth multiplier  x  maturity multiplier  x  reach multiplier';
    box.appendChild(el('div', { class: 'formula', text: formula }));
    var list = el('ul', null);
    list.appendChild(el('li', { html: '<b>Peer multiple</b> (' + m.peer_min.toFixed(2) + '–' + m.peer_max.toFixed(2) + '): the median market-cap-to-TVL of live-token protocols in the same category (at least ' + m.peer_min_peers + ' peers, else the global median ' + DATA.global_peer_multiple.toFixed(2) + '), shrunk toward the global median. This is what the category actually trades for.' }));
    list.appendChild(el('li', { html: '<b>Growth multiplier:</b> 1 + clamped 7-day TVL change (' + m.growth_floor + '% to +' + m.growth_cap + '%) x ' + m.growth_weight + '. A protocol losing TVL is worth less; one gaining it is worth more.' }));
    list.appendChild(el('li', { html: '<b>Maturity multiplier</b> (' + m.maturity_floor.toFixed(2) + '–1.00): 0.70 for a brand-new listing, rising to 1.00 after ' + m.maturity_days + ' days with no token. Age unknown counts as ' + m.unknown_age_days + ' days.' }));
    list.appendChild(el('li', { html: '<b>Reach multiplier:</b> 1.00 for one chain, +' + m.reach_per_chain.toFixed(2) + ' per extra chain, up to ' + (1 + m.reach_max_extra * m.reach_per_chain).toFixed(2) + '. More chains means more surface for a launch.' }));
    list.appendChild(el('li', { html: '<b>Radar Score (0–100)</b> explains the rank: scale 40 (log TVL), momentum 20 (7-day growth), maturity 15 (age), reach 10 (chains), category 15 (peer multiple). The score explains; the implied value ranks.' }));
    box.appendChild(list);
  }

  function renderFoot() {
    var foot = document.getElementById('foot');
    foot.appendChild(el('p', { text: 'Source: ' + DATA.source + '. The snapshot is frozen; it does not move and is not updated.' }));
    foot.appendChild(el('p', { text: 'Watchlist floor: ' + fmtUsd(DATA.floor_usd) + ' of TVL. A protocol records no token when the snapshot records no market cap, no CoinGecko id and no symbol for it — never a claim that it has none.' }));
    foot.appendChild(el('p', { text: 'Farm plans are actions a reader can take on-chain. They never claim a confirmed airdrop: no snapshot field says one exists.' }));
  }

  // ---------- filters ----------

  function fillFilters() {
    var catSel = document.getElementById('cat');
    var chainSel = document.getElementById('chain');
    var cats = {};
    var chains = {};
    DATA.rows.forEach(function (r) {
      if (r.category) cats[r.category] = true;
      r.chains.forEach(function (c) { chains[c] = true; });
    });
    Object.keys(cats).sort().forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    Object.keys(chains).sort().forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'growth') { va = a.change_7d === null ? -Infinity : a.change_7d; vb = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'score') { va = a.score.total; vb = b.score.total; }
      else if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else { va = a.implied_value_usd; vb = b.implied_value_usd; }
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return rows;
  }

  // ---------- board ----------

  function scoreCell(score) {
    var wrap = el('span', { class: 'score-cell' });
    var bar = el('span', { class: 'score-bar' });
    bar.appendChild(el('i', { style: 'width:' + Math.min(100, Math.max(0, score.total)) + '%' }));
    wrap.appendChild(bar);
    wrap.appendChild(document.createTextNode(score.total.toFixed(1)));
    return wrap;
  }

  function renderBoard() {
    var rows = filteredRows();
    var tbody = document.getElementById('rows');
    tbody.innerHTML = '';
    document.getElementById('count').textContent =
      rows.length + ' of ' + DATA.board_size + ' ranked protocols' +
      (state.category !== 'all' ? ' · category ' + state.category : '') +
      (state.chain !== 'all' ? ' · chain ' + state.chain : '') +
      (state.q ? ' · matching \u201c' + state.q + '\u201d' : '');
    if (rows.length === 0) {
      tbody.appendChild(el('tr', null, el('td', { colspan: '8', class: 'empty', text: 'No protocol matches these filters.' })));
      return;
    }
    rows.forEach(function (r) {
      var tr = el('tr', { 'data-slug': r.slug, onclick: function () { selectRow(r.slug, true); } });
      if (state.selected === r.slug) tr.className = 'is-selected';
      tr.appendChild(el('td', { class: 'num', text: String(r.rank) }));
      var nameCell = el('td', null, el('span', { class: 'name', text: r.name }));
      nameCell.appendChild(el('span', { class: 'sub', text: r.chains.slice(0, 3).join(' · ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) + ' more' : '') }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var g = el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d > 0 ? 'up' : r.change_7d !== null && r.change_7d < 0 ? 'down' : ''), text: fmtPct(r.change_7d) });
      tr.appendChild(g);
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      var sc = el('td', { class: 'num' });
      sc.appendChild(scoreCell(r.score));
      tr.appendChild(sc);
      tr.appendChild(el('td', { class: 'why', text: r.why }));
      tbody.appendChild(tr);
    });
  }

  // ---------- detail ----------

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  function comparables(category) {
    return DATA.live.filter(function (p) { return p.category === category; })
      .sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); })
      .slice(0, 5);
  }

  function renderDetail() {
    var box = document.getElementById('detail');
    var r = state.selected ? findRow(state.selected) : null;
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '';
    box.appendChild(el('h2', { text: '#' + r.rank + ' — ' + r.name }));
    box.appendChild(el('p', { class: 'meta', text: (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') + ' · listed ' + (r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ' old) · TVL ' + fmtUsd(r.tvl_usd) + ' · 7d ' + fmtPct(r.change_7d) }));

    var grid = el('div', { class: 'grid' });
    var left = el('div', null);
    left.appendChild(el('h3', { text: 'Why this rank — Radar Score ' + r.score.total.toFixed(1) + ' / 100' }));
    var bars = el('div', { class: 'bars' });
    [['Scale (TVL)', r.score.scale, 40], ['Momentum (7d)', r.score.momentum, 20], ['Maturity (age)', r.score.maturity, 15], ['Reach (chains)', r.score.reach, 10], ['Category (peers)', r.score.category, 15]].forEach(function (c) {
      var row = el('div', { class: 'bar-row' });
      row.appendChild(el('span', { text: c[0] }));
      var track = el('span', { class: 'track' });
      track.appendChild(el('i', { style: 'width:' + Math.min(100, (c[1] / c[2]) * 100) + '%' }));
      row.appendChild(track);
      row.appendChild(el('span', { class: 'val', text: c[1].toFixed(1) + ' / ' + c[2] }));
      bars.appendChild(row);
    });
    left.appendChild(bars);
    left.appendChild(el('h3', { text: 'The implied value, step by step' }));
    var math = el('div', { class: 'math' });
    math.appendChild(document.createTextNode(
      'TVL ' + fmtUsd(r.tvl_usd) + '\n' +
      'x peer multiple ' + fmtMult(r.peer_multiple) + '  (category median mcap/TVL)\n' +
      'x growth ' + r.growth_multiplier.toFixed(3) + '  (' + fmtPct(r.change_7d) + ' over 7 days)\n' +
      'x maturity ' + r.maturity_multiplier.toFixed(3) + '  (' + fmtAge(r.age_days) + ' with no token)\n' +
      'x reach ' + r.reach_multiplier.toFixed(3) + '  (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')\n' +
      '= implied value ' + fmtUsd(r.implied_value_usd)
    ));
    left.appendChild(math);
    grid.appendChild(left);

    var right = el('div', null);
    right.appendChild(el('h3', { text: 'Farm plan — six steps' }));
    var ol = el('ol', { class: 'steps' });
    r.farm_steps.forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    right.appendChild(ol);
    var peers = comparables(r.category);
    if (peers.length > 0) {
      right.appendChild(el('h3', { text: 'Live-token peers in ' + (r.category || 'this category') }));
      var table = el('table', { class: 'peers' });
      table.appendChild(el('thead', null, el('tr', null,
        el('th', { text: 'Protocol' }), el('th', { class: 'num', text: 'TVL' }),
        el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'MCap / TVL' }))));
      var tb = el('tbody', null);
      peers.forEach(function (p) {
        tb.appendChild(el('tr', null,
          el('td', { text: p.name }),
          el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }),
          el('td', { class: 'num', text: p.mcap_per_tvl === null ? 'n/a' : fmtMult(p.mcap_per_tvl) })));
      });
      table.appendChild(tb);
      right.appendChild(table);
    }
    grid.appendChild(right);
    box.appendChild(grid);
  }

  // ---------- live view ----------

  function renderLive() {
    var tbody = document.getElementById('live-rows');
    tbody.innerHTML = '';
    document.getElementById('live-count').textContent = DATA.live.length + ' live-token protocols with the largest market caps — the comparables.';
    DATA.live.forEach(function (p) {
      var tr = el('tr', null);
      tr.appendChild(el('td', null, el('span', { class: 'name', text: p.name })));
      tr.appendChild(el('td', { text: p.category || '—' }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }));
      tr.appendChild(el('td', { class: 'num', text: p.mcap_per_tvl === null ? 'n/a' : fmtMult(p.mcap_per_tvl) }));
      tr.appendChild(el('td', { class: 'num ' + (p.change_7d !== null && p.change_7d > 0 ? 'up' : p.change_7d !== null && p.change_7d < 0 ? 'down' : ''), text: fmtPct(p.change_7d) }));
      tbody.appendChild(tr);
    });
  }

  // ---------- tabs and selection ----------

  function setTab(tab) {
    state.tab = tab;
    document.getElementById('tab-pre').classList.toggle('is-active', tab === 'pre');
    document.getElementById('tab-live').classList.toggle('is-active', tab === 'live');
    document.getElementById('tab-pre').setAttribute('aria-selected', tab === 'pre' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-selected', tab === 'live' ? 'true' : 'false');
    document.getElementById('board-view').hidden = tab !== 'pre';
    document.getElementById('live-view').hidden = tab !== 'live';
    if (tab === 'live') renderLive();
  }

  function selectRow(slug, scroll) {
    state.selected = slug;
    renderBoard();
    renderDetail();
    if (scroll) {
      var box = document.getElementById('detail');
      if (box && !box.hidden) box.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = decodeURIComponent(kv[0] || '');
      var v = decodeURIComponent(kv[1] || '');
      if (k === 'tab' && (v === 'pre' || v === 'live')) state.tab = v;
      if (k === 'q') state.q = v;
      if (k === 'cat') state.category = v;
      if (k === 'chain') state.chain = v;
      if (k === 'sort') state.sort = v;
      if (k === 'detail') state.selected = v;
    });
  }

  function syncControls() {
    document.getElementById('q').value = state.q;
    document.getElementById('cat').value = state.category;
    document.getElementById('chain').value = state.chain;
    document.getElementById('sort').value = state.sort;
  }

  // ---------- wire up ----------

  document.getElementById('tab-pre').addEventListener('click', function () { setTab('pre'); });
  document.getElementById('tab-live').addEventListener('click', function () { setTab('live'); });
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('cat').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });

  renderStats();
  renderModel();
  renderFoot();
  fillFilters();
  readHash();
  syncControls();
  setTab(state.tab);
  renderBoard();
  renderDetail();
  var boardMain = document.getElementById('board');
  if (boardMain) boardMain.setAttribute('aria-busy', 'false');
})();

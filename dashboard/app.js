// Token Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, the live-token evidence table, the category multiples and
// a detail drawer per protocol. No network: every byte it shows is in data.js.
//
// The value model, in one place so the page can be checked against the code:
//   implied value = TVL x category multiple x momentum x maturity
//   category multiple = (n x category median Mcap/TVL + 4 x global median) / (n + 4)
//   momentum = 1 + clamp(7d TVL change, -50%, +80%) / 100 x 0.6
//   maturity = 0.75 + 0.45 x min(age in days, 1460) / 1460
// The detail drawer works the arithmetic for the protocol it opens, with the snapshot's
// own numbers at every step, and totals the farm plan's cost and time under it; the
// model section works the same arithmetic for the board's #1. The category table shows
// the median and the sample behind every multiple, with the live protocols it came from.
// View state lives in the hash: #/board, #/board?seg=early&cat=Lending, #/p/<slug>.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;

  var FLAG_LABEL = {
    'tvl-shrinking': 'TVL shrinking',
    'tvl-surging': 'TVL surging',
    'change-unreported': '7d change unreported',
    'age-unreported': 'age unreported',
    'under-120-days': 'under 120 days old',
    'single-chain': 'single chain',
    'thin-category-sample': 'thin category sample'
  };
  var FLAG_WHY = {
    'tvl-shrinking': 'TVL fell at least 15% in the last 7 days: momentum is against it, and the momentum factor already prices some of that in.',
    'tvl-surging': 'TVL rose at least 40% in 7 days: hot money may be renting the number; the momentum factor is capped at +80% for exactly this reason.',
    'change-unreported': 'The snapshot carries no 7d change for this protocol, so its momentum factor is a neutral 1.00.',
    'age-unreported': 'No listing date in the snapshot; the maturity factor assumes 365 days.',
    'under-120-days': 'Running less than 120 days: less history behind the TVL, and the maturity factor is still low.',
    'single-chain': 'Present on one chain only: no second venue if that chain or its bridge has trouble.',
    'thin-category-sample': 'Fewer than 5 token-bearing protocols in its category, so the multiple leans on the global median through shrinkage.'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usd(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function mult(n) { return n == null ? '—' : n.toFixed(2) + 'x'; }
  function $(id) { return document.getElementById(id); }

  var bySlug = {};
  D.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var catByName = {};
  D.categories.forEach(function (c) { catByName[c.category] = c; });

  var state = { seg: 'all', q: '', cat: '', chain: '', sort: 'rank', detail: null };

  // ---------- header ----------
  $('stats').innerHTML =
    '<span class="stat">Snapshot <b>' + esc(D.as_of) + '</b></span>' +
    '<span class="stat"><b>' + D.board_size + '</b> pre-token ranked</span>' +
    '<span class="stat"><b>' + D.watchlist_size + '</b> watchlist covered</span>' +
    '<span class="stat"><b>' + D.early_size + '</b> early finds</span>' +
    '<span class="stat"><b>' + D.live_size + '</b> live tokens set aside</span>' +
    '<span class="stat"><b>' + D.set_aside_count + '</b> wrapped / staked / bridged products set aside, never ranked</span>' +
    '<span class="stat">Global multiple <b>' + mult(D.global_multiple) + '</b> from ' + D.token_bearing_sample + ' token-bearing</span>' +
    '<span class="stat">Model <b>' + esc(D.model_version) + '</b></span>';
  $('modelSummary').textContent = D.model_summary;

  // ---------- cover self-check + protocol accounting ----------
  // Every figure in the strip is recomputed here, from the rows this page renders:
  // nothing in it is a typed-in claim. The checksum is FNV-1a over each row's slug,
  // rank and implied value — the same sum lib/model.ts stores as board_checksum — so
  // the strip agrees with main.ts only if the page's rows are the program's rows,
  // untouched. A check that fails shows its computed figure with a cross, not a tick.
  function commas(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pageChecksum(rows) {
    var h = 0x811c9dc5;
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i].slug + '#' + rows[i].rank + '#' + rows[i].implied_value_usd + ';';
      for (var j = 0; j < s.length; j++) h = Math.imul(h ^ s.charCodeAt(j), 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  (function () {
    var rows = D.rows;
    var ranksOk = rows.length === D.board_size;
    var monoOk = true;
    var total = 0;
    var watch = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].rank !== i + 1) ranksOk = false;
      if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) monoOk = false;
      total += rows[i].implied_value_usd;
      if (rows[i].watchlist) watch++;
    }
    var sum = pageChecksum(rows);
    var ledgerTotal = 0;
    var rankedTotal = 0;
    D.accounting.forEach(function (g) {
      ledgerTotal += g.count;
      if (g.key.indexOf('ranked-') === 0) rankedTotal += g.count;
    });
    function item(ok, text) {
      return '<span class="sc ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '\u2713 ' : '\u2717 ') + esc(text) + '</span>';
    }
    $('selfcheck').innerHTML =
      item(rows.length === D.board_size, 'this page is the program\u2019s board: ' + rows.length + ' of ' + D.board_size + ' rows recomputed here') +
      item(ranksOk && monoOk, 'ranks 1\u2013' + rows.length + ' in order, values never rise') +
      item(total === D.board_total_implied_usd, 'totals equal: $' + commas(total)) +
      item(sum === D.board_checksum, 'checksum ' + sum + ' = main.ts') +
      item(watch === D.watchlist_size, 'watchlist ' + watch + ' of ' + D.watchlist_size + ' ranked') +
      item(ledgerTotal === D.universe_size && rankedTotal === D.board_size, 'ledger ' + ledgerTotal + ' of ' + D.universe_size + ' protocols, each accounted for');
    var COLORS = { 'ranked-watchlist': '#f2a81d', 'ranked-early': '#57c785', 'token-priced': '#8a6414', 'token-unpriced': '#333a44' };
    var ASIDE = ['#4a5568', '#5b6b7f', '#3d4a5c', '#66707c', '#54606e', '#707a88', '#48525f', '#5f6a76'];
    var ai = 0;
    $('ledgerbar').innerHTML = D.accounting.map(function (g) {
      var c = COLORS[g.key] || ASIDE[ai++ % ASIDE.length];
      var w = (g.count / D.universe_size * 100).toFixed(2);
      return '<span class="segbar" style="width:' + w + '%;background:' + c + '" title="' + esc(g.label) + ': ' + g.count + '"></span>';
    }).join('');
    $('ledgerlegend').textContent = D.accounting.map(function (g) { return g.label + ' ' + g.count; }).join(' \u00b7 ') + ' \u2014 ' + D.universe_size + ' in all.';
    $('ledgerTotal').textContent = D.universe_size;
    $('ledgerRows').innerHTML = D.accounting.map(function (g) {
      return '<tr><td>' + esc(g.label) + '</td><td class="num">' + g.count + '</td><td class="chains">' + esc(g.note) + '</td></tr>';
    }).join('') + '<tr class="totalrow"><td>All protocols in the snapshot</td><td class="num">' + ledgerTotal +
      '</td><td class="chains">Counted by the program from the snapshot; the cover strip re-adds the groups on this page.</td></tr>';
  })();

  // ---------- filters ----------
  var cats = D.categories.map(function (c) { return c.category; });
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) {
    return '<option' + (c === state.cat ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  var chainSet = {};
  D.rows.forEach(function (r) { r.chains.forEach(function (c) { chainSet[c] = 1; }); });
  D.live.forEach(function (r) { r.chains.forEach(function (c) { chainSet[c] = 1; }); });
  $('chain').innerHTML = '<option value="">All chains</option>' + Object.keys(chainSet).sort().map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');

  // ---------- category evidence table ----------
  $('catRows').innerHTML = D.categories.map(function (c) {
    var peers = c.peers.map(function (p) { return esc(p.name) + ' ' + mult(p.ratio); }).join(' · ');
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.sample + '</td>' +
      '<td class="num">' + mult(c.median_ratio) + '</td><td class="num">' + mult(c.multiple) + '</td>' +
      '<td class="chains">' + peers + '</td></tr>';
  }).join('');

  // ---------- worked example: the board's #1, arithmetic and all ----------
  (function () {
    var top = D.rows[0];
    if (!top) return;
    var tm = top.model;
    var base = top.tvl_usd * tm.category_multiple;
    var afterMom = base * tm.momentum_multiplier;
    $('worked').textContent = 'Worked example — #' + top.rank + ' ' + top.name + ': ' + usd(top.tvl_usd) +
      ' TVL x ' + tm.category_multiple.toFixed(2) + 'x (' + (top.category || 'global') + ', n=' + tm.category_sample +
      ') = ' + usd(base) + '; x ' + tm.momentum_multiplier.toFixed(2) + 'x momentum = ' + usd(afterMom) +
      '; x ' + tm.maturity_multiplier.toFixed(2) + 'x maturity ≈ ' + usd(top.implied_value_usd) +
      ' implied value. Every row carries the same four numbers, and the detail drawer works them for any protocol you open.';
  })();

  // ---------- board ----------
  function flagHtml(flags) {
    if (!flags.length) return '<span class="flag">clear</span>';
    return flags.map(function (f) {
      var cls = f === 'tvl-shrinking' ? 'flag warn' : f === 'tvl-surging' ? 'flag hot' : 'flag';
      return '<span class="' + cls + '">' + esc(FLAG_LABEL[f] || f) + '</span>';
    }).join('');
  }
  function visibleRows() {
    var rows = D.rows.filter(function (r) {
      if (state.seg === 'watchlist' && r.segment !== 'watchlist') return false;
      if (state.seg === 'early' && r.segment !== 'early') return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var k = state.sort;
    rows.sort(function (a, b) {
      if (k === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (k === 'change') return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d);
      if (k === 'multiple') return b.model.category_multiple - a.model.category_multiple;
      if (k === 'age') return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days);
      return a.rank - b.rank;
    });
    return rows;
  }
  function renderBoard() {
    var rows = visibleRows();
    $('rows').innerHTML = rows.map(function (r) {
      var chg = r.change_7d == null ? '—' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        (r.watchlist ? '<span class="badge">watchlist</span>' : '') +
        '<br><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.join(', ')) + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + chg + '</td>' +
        '<td class="num">' + usd(r.implied_value_usd) + '</td>' +
        '<td class="num">' + mult(r.model.category_multiple) + '</td>' +
        '<td class="flags">' + flagHtml(r.risk_flags) + '</td></tr>';
    }).join('');
    $('empty').hidden = rows.length > 0;
    $('count').textContent = state.seg === 'live'
      ? 'Showing ' + D.live_size + ' live-token protocols — the market values the board\u2019s multiples are built from.'
      : 'Showing ' + rows.length + ' of ' + D.board_size + ' ranked protocols' +
        (rows.length < D.board_size ? ' match this filter.' : '.');
    var trs = $('rows').querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { openDetail(this.getAttribute('data-slug')); });
    }
  }

  // ---------- live ----------
  $('liveRows').innerHTML = D.live.map(function (r) {
    var chg = r.change_7d == null ? '—' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</span>';
    return '<tr><td><span class="pname">' + esc(r.name) + '</span><br><span class="pslug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td><td class="num">' + usd(r.mcap_usd) + '</td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + mult(r.ratio) + '</td><td class="num">' + chg + '</td></tr>';
  }).join('');

  // ---------- detail drawer ----------
  function openDetail(slug) {
    state.detail = slug;
    writeHash();
    renderDetail();
  }
  function closeDetail() {
    state.detail = null;
    writeHash();
    renderDetail();
  }
  function renderDetail() {
    var r = state.detail ? bySlug[state.detail] : null;
    $('drawer').hidden = !r;
    $('scrim').hidden = !r;
    if (!r) return;
    var m = r.model;
    var cat = r.category ? catByName[r.category] : null;
    // The worked arithmetic: each factor's product is shown, so the implied value can be
    // re-derived from the snapshot's numbers by hand. The factors are shown to two
    // decimals; the board's value uses the full-precision factors, so the last step reads
    // approximately, never exactly.
    var base = r.tvl_usd * m.category_multiple;
    var afterMom = base * m.momentum_multiplier;
    var multipleNote;
    if (cat && m.category_sample > 0) {
      multipleNote = 'The multiple is built from the category median ' + mult(cat.median_ratio) + ' over ' +
        m.category_sample + ' token-bearing protocol' + (m.category_sample === 1 ? '' : 's') + ', shrunk toward the global ' + mult(m.global_multiple) +
        ': (' + m.category_sample + ' x ' + cat.median_ratio.toFixed(4) + ' + 4 x ' + m.global_multiple.toFixed(4) +
        ') / ' + (m.category_sample + 4) + ' = ' + m.category_multiple.toFixed(4) + 'x.';
    } else {
      multipleNote = 'No token-bearing protocol in this category, so the multiple is the global median ' +
        mult(m.global_multiple) + ' over ' + D.token_bearing_sample + ' token-bearing protocols.';
    }
    var growthLabel = r.change_7d == null
      ? '7d change unreported, neutral 1.00x'
      : '7d ' + pct(r.change_7d) + (r.change_7d !== m.growth_pct ? ', clamped to ' + pct(m.growth_pct) : '');
    var ageLabel = m.age_days == null
      ? 'age assumed 365 days'
      : 'age ' + m.age_days + ' days' + (m.age_days > 1460 ? ', capped at 1460' : '');
    var fe = r.farm_economics;
    var money = function (v) { return '$' + (Number.isInteger(v) ? String(v) : v.toFixed(2)); };
    var farmSummary = 'About ' + money(fe.setup_gas_usd) + ' of gas to set up, about ' + money(fe.weekly_gas_usd) +
      ' a week for ' + fe.weeks + ' weeks (about ' + money(fe.total_gas_usd) + ' of gas in all), ' + money(fe.capital_usd) +
      ' of capital held ' + fe.hold_days + ' days, about ' + fe.total_minutes + ' minutes in all (' +
      fe.setup_minutes + ' to set up, ' + fe.weekly_minutes + ' a week). The steps below state the same numbers one by one.';
    var peers = cat && cat.peers.length
      ? cat.peers.map(function (p) {
          return '<tr><td>' + esc(p.name) + '</td><td class="val">' + usd(p.mcap_usd) + '</td><td class="val">' + usd(p.tvl_usd) + '</td><td class="val">' + mult(p.ratio) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="4">No token-bearing protocol in this category: the global median carries the multiple.</td></tr>';
    var flags = r.risk_flags.length
      ? r.risk_flags.map(function (f) { return '<li><b>' + esc(FLAG_LABEL[f] || f) + '</b> — ' + esc(FLAG_WHY[f] || '') + '</li>'; }).join('')
      : '<li>No flags: reported change is calm, it is not brand new, and its category sample is solid.</li>';
    $('drawer').innerHTML =
      '<button class="close" id="dclose" type="button" aria-label="Close">×</button>' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge">watchlist</span>' : '<span class="badge">early</span>') + '</h2>' +
      '<div class="sub">' + esc(r.slug) + ' · rank #' + r.rank + ' of ' + D.board_size + '</div>' +
      '<div class="kv"><span>Category <b>' + esc(r.category || '—') + '</b></span>' +
      '<span>Chains <b>' + esc(r.chains.join(', ')) + '</b></span>' +
      '<span>Listed <b>' + esc(r.listed_at || 'unreported') + '</b></span>' +
      '<span>Age <b>' + (r.age_days == null ? 'unreported' : r.age_days + ' days') + '</b></span></div>' +
      '<h3>Implied value, worked</h3>' +
      '<table><tbody>' +
      '<tr><td class="lab">TVL (snapshot)</td><td class="val">' + usd(r.tvl_usd) + '</td></tr>' +
      '<tr><td class="lab">x category multiple (' + esc(r.category || 'global') + ', n=' + m.category_sample + ')</td><td class="val">' + mult(m.category_multiple) + '</td></tr>' +
      '<tr><td class="lab">= base value</td><td class="val">' + usd(base) + '</td></tr>' +
      '<tr><td class="lab">x momentum (' + esc(growthLabel) + ')</td><td class="val">' + m.momentum_multiplier.toFixed(2) + 'x</td></tr>' +
      '<tr><td class="lab">= after momentum</td><td class="val">' + usd(afterMom) + '</td></tr>' +
      '<tr><td class="lab">x maturity (' + esc(ageLabel) + ')</td><td class="val">' + m.maturity_multiplier.toFixed(2) + 'x</td></tr>' +
      '<tr class="total"><td>≈ implied value</td><td class="val">' + usd(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="note">' + esc(multipleNote) + ' Factors are shown to two decimals; the board\u2019s value uses the full-precision factors.</p>' +
      '<h3>Live comparables in ' + esc(r.category || 'this category') + '</h3>' +
      '<table><thead><tr><th>Protocol</th><th style="text-align:right">Mcap</th><th style="text-align:right">TVL</th><th style="text-align:right">Ratio</th></tr></thead>' +
      '<tbody>' + peers + '</tbody></table>' +
      '<h3>Risk flags</h3><ul>' + flags + '</ul>' +
      '<h3>Farm plan</h3><p class="note">' + esc(farmSummary) + '</p><ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    $('dclose').addEventListener('click', closeDetail);
  }
  $('scrim').addEventListener('click', closeDetail);

  // ---------- hash state ----------
  function writeHash() {
    var h;
    if (state.detail) {
      h = '#/p/' + encodeURIComponent(state.detail);
    } else {
      var parts = [];
      if (state.seg !== 'all') parts.push('seg=' + state.seg);
      if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
      if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
      if (state.q) parts.push('q=' + encodeURIComponent(state.q));
      if (state.sort !== 'rank') parts.push('sort=' + state.sort);
      h = '#/board' + (parts.length ? '?' + parts.join('&') : '');
    }
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    var h = location.hash || '#/board';
    state.detail = null;
    var pm = h.match(/^#\/p\/(.+)$/);
    if (pm) {
      var slug = decodeURIComponent(pm[1]);
      if (bySlug[slug]) { state.detail = slug; renderAll(); return; }
    }
    var qm = h.match(/\?(.*)$/);
    if (qm) {
      qm[1].split('&').forEach(function (kv) {
        var p = kv.split('=');
        var k = p[0], v = decodeURIComponent(p.slice(1).join('=') || '');
        if (k === 'seg' && ['all', 'watchlist', 'early', 'live'].indexOf(v) >= 0) state.seg = v;
        if (k === 'cat') state.cat = v;
        if (k === 'chain') state.chain = v;
        if (k === 'q') state.q = v;
        if (k === 'sort') state.sort = v;
      });
    }
    renderAll();
  }
  function syncControls() {
    var btns = $('seg').querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].className = btns[i].getAttribute('data-seg') === state.seg ? 'on' : '';
    }
    $('q').value = state.q;
    $('cat').value = state.cat;
    $('chain').value = state.chain;
    $('sort').value = state.sort;
    $('boardWrap').hidden = state.seg === 'live';
    $('liveWrap').hidden = state.seg !== 'live';
  }
  function renderAll() {
    syncControls();
    renderBoard();
    renderDetail();
  }

  // ---------- events ----------
  $('seg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    state.seg = b.getAttribute('data-seg');
    state.detail = null;
    writeHash(); renderAll();
  });
  $('q').addEventListener('input', function () { state.q = this.value; writeHash(); renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; writeHash(); renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; writeHash(); renderBoard(); });
  $('sort').addEventListener('change', function () { state.sort = this.value; writeHash(); renderBoard(); });
  window.addEventListener('hashchange', readHash);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  readHash();
})();

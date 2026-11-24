// Token Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, the live-token evidence table, the category multiples and
// a detail drawer per protocol. No network: every byte it shows is in data.js.
//
// The value model, in one place so the page can be checked against the code:
//   log(implied value) = curve intercept + curve slope x log(TVL) + category intercept
//   multiple = implied value / TVL, falling as TVL rises (the fitted size curve)
//   curve intercept and slope are fitted at run time from the snapshot's own
//   token-bearing protocols (least squares of log market cap on log TVL); each
//   category's intercept is its mean residual, shrunk toward the global curve.
//   A 7-day-growth term and an age term were fitted the same way and dropped:
//   neither improved held-out error, so they are shown as risk flags, not priced.
// The detail drawer works the arithmetic for the protocol it opens, with the snapshot's
// own numbers at every step, and totals the farm plan's cost and time under it; the
// model section works the same arithmetic for the board's #1. The category table shows
// the median and the fitted multiple at $1B TVL behind every row, with the live
// protocols it came from.
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
    'tvl-shrinking': 'TVL fell at least 15% in the last 7 days. Growth was fitted as a value term and did not survive held-out testing, so it is flagged here rather than priced into the value.',
    'tvl-surging': 'TVL rose at least 40% in 7 days: hot money may be renting the number. Growth was fitted as a value term and did not survive held-out testing, so it is flagged here rather than priced into the value.',
    'change-unreported': 'The snapshot carries no 7d change for this protocol, so there is no growth signal to flag.',
    'age-unreported': 'No listing date in the snapshot; age was fitted as a value term and did not survive held-out testing, so it is flagged here and sets the farm hold window instead.',
    'under-120-days': 'Running less than 120 days: less history behind the TVL. Age was fitted as a value term and did not survive held-out testing, so it is flagged here and sets the farm hold window instead.',
    'single-chain': 'Present on one chain only: no second venue if that chain or its bridge has trouble.',
    'thin-category-sample': 'Fewer than 5 token-bearing protocols in its category, so its fitted intercept leans on the global curve through shrinkage.'
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
    '<span class="stat">Value curve <b>log mcap = ' + D.validation.slope.toFixed(2) + ' x log TVL</b>, fitted on ' + D.token_bearing_sample + ' token-bearing</span>' +
    '<span class="stat">Held-out 5-fold MAE <b>' + D.validation.cv_mae_fit.toFixed(2) + '</b> vs ' + D.validation.cv_mae_median.toFixed(2) + ' for category medians</span>' +
    '<span class="stat">Model <b>' + esc(D.model_version) + '</b></span>';
  $('modelSummary').textContent = D.model_summary;

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
    var lnTvl = Math.log(top.tvl_usd);
    $('worked').textContent = 'Worked example — #' + top.rank + ' ' + top.name + ': ln(' + usd(top.tvl_usd) +
      ' TVL) = ' + lnTvl.toFixed(2) + '; ' + tm.curve_slope.toFixed(2) + ' x ' + lnTvl.toFixed(2) + ' = ' +
      (tm.curve_slope * lnTvl).toFixed(2) + '; + ' + tm.curve_intercept.toFixed(2) + ' curve intercept + ' +
      (tm.category_intercept >= 0 ? '+' : '') + tm.category_intercept.toFixed(2) + ' ' + (top.category || 'global') +
      ' intercept (n=' + tm.category_sample + ') = ' +
      (tm.curve_slope * lnTvl + tm.curve_intercept + tm.category_intercept).toFixed(2) +
      '; exp gives ≈ ' + usd(top.implied_value_usd) + ' implied value, a ' + tm.category_multiple.toFixed(3) +
      'x multiple on its TVL. Every row carries the same three numbers, and the detail drawer works them for any protocol you open.';
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
    // The worked arithmetic: each term is shown, so the implied value can be
    // re-derived from the snapshot's numbers by hand. The curve terms are shown
    // to two decimals; the board's value uses the full-precision terms, so the
    // last step reads approximately, never exactly.
    var lnTvl = Math.log(r.tvl_usd);
    var slopeTerm = m.curve_slope * lnTvl;
    var lnImplied = slopeTerm + m.curve_intercept + m.category_intercept;
    var multipleNote;
    if (cat && m.category_sample > 0) {
      var meanResid = m.category_intercept * (m.category_sample + 4) / m.category_sample;
      multipleNote = 'The category intercept is the mean residual of the category\u2019s ' + m.category_sample +
        ' token-bearing protocols against the global curve (' + (meanResid >= 0 ? '+' : '') + meanResid.toFixed(2) +
        ' on average), shrunk toward the global curve: (' + m.category_sample + ' x ' + meanResid.toFixed(4) +
        ' + 4 x 0) / ' + (m.category_sample + 4) + ' = ' + (m.category_intercept >= 0 ? '+' : '') + m.category_intercept.toFixed(4) +
        '. Its median market-cap/TVL is ' + mult(cat.median_ratio) + '; the multiple here is the fitted size curve at this protocol\u2019s own TVL, not that median.';
    } else {
      multipleNote = 'No token-bearing protocol in this category, so its intercept is 0 and the protocol is priced on the global curve alone.';
    }
    var growthLabel = r.change_7d == null
      ? '7d change unreported'
      : '7d ' + pct(r.change_7d) + (r.change_7d !== m.growth_pct ? ', clamped to ' + pct(m.growth_pct) : '');
    var ageLabel = m.age_days == null
      ? 'age unreported'
      : 'age ' + m.age_days + ' days';
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
      '<tr><td class="lab">ln(TVL)</td><td class="val">' + lnTvl.toFixed(2) + '</td></tr>' +
      '<tr><td class="lab">x curve slope ' + m.curve_slope.toFixed(2) + '</td><td class="val">' + slopeTerm.toFixed(2) + '</td></tr>' +
      '<tr><td class="lab">+ curve intercept</td><td class="val">' + m.curve_intercept.toFixed(2) + '</td></tr>' +
      '<tr><td class="lab">+ ' + esc(r.category || 'global') + ' intercept (n=' + m.category_sample + ')</td><td class="val">' + (m.category_intercept >= 0 ? '+' : '') + m.category_intercept.toFixed(2) + '</td></tr>' +
      '<tr><td class="lab">= ln(implied value)</td><td class="val">' + lnImplied.toFixed(2) + '</td></tr>' +
      '<tr class="total"><td>≈ implied value</td><td class="val">' + usd(r.implied_value_usd) + '</td></tr>' +
      '<tr><td class="lab">Multiple on TVL (implied / TVL)</td><td class="val">' + m.category_multiple.toFixed(3) + 'x</td></tr>' +
      '<tr><td class="lab">7d growth (' + esc(growthLabel) + ') — tested, not priced</td><td class="val">flagged, not priced</td></tr>' +
      '<tr><td class="lab">Age (' + esc(ageLabel) + ') — tested, not priced</td><td class="val">flagged, not priced</td></tr>' +
      '</tbody></table>' +
      '<p class="note">' + esc(multipleNote) + ' Terms are shown to two decimals; the board\u2019s value uses the full-precision terms. Growth and age were fitted as value terms and dropped because neither improved held-out error; they still appear as risk flags below and set the farm hold window.</p>' +
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

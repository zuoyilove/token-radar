// The radar's valuation model: one sealed snapshot in, one ranked board of pre-token
// protocols out, with the working shown for every row.
//
// The starter house model prices every protocol at one flat 0.25 x TVL. This model instead
// asks the snapshot itself what a token is worth in each category: among the protocols that
// already have a token, the market-cap / TVL ratio has a median per category, and those
// medians are far apart (lending trades near 0.13 x TVL, cross-chain bridges above 1.2 x).
// A pre-token protocol is priced at its own category's median, shrunk toward the global
// median when the category's sample is thin, then adjusted for the last week's TVL momentum
// and for how long the protocol has run without a token:
//
//   multiple  = (n x category_median + 4 x global_median) / (n + 4), ratios winsorized to [0.001, 10]
//   momentum  = 1 + clamp(change_7d_pct, -50, +80) / 100 x 0.6     (unreported change: 1.0)
//   maturity  = 0.75 + 0.45 x min(age_days, 1460) / 1460           (unknown age: 365 days)
//   implied   = round(TVL x multiple x momentum x maturity)
//
// A row is only rankable when the protocol is a genuine launch candidate by the snapshot's
// own watchlist rule: it records no token, and it is not a wrapped, staked or bridged product
// of a token that already trades — the rule that keeps WBTC, Binance staked ETH and USDT0 off
// the watchlist. The rule is applied to the whole board, not just the watchlist: a wrapped
// product's "implied value" would price a token that already exists, so it is set aside
// (counted in the dashboard, never ranked) instead of topping the board on its TVL alone.
// No protocol name is ever special-cased: one function scores every row, and every row
// carries its audit trail (the multiple used, the sample behind it, both adjustments), so
// the board can be re-derived from the snapshot by hand.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's stated constants: the dashboard prints them and the audit trail uses them. */
export const MODEL_VERSION = 'cat-multiple-2';
export const SHRINK_K = 4;
export const RATIO_FLOOR = 0.001;
export const RATIO_CAP = 10;
export const MOMENTUM_FLOOR_PCT = -50;
export const MOMENTUM_CAP_PCT = 80;
export const MOMENTUM_WEIGHT = 0.6;
export const MATURITY_BASE = 0.75;
export const MATURITY_RANGE = 0.45;
export const MATURITY_DAYS = 1460;
export const UNKNOWN_AGE_DAYS = 365;
/** A category sample smaller than this is flagged thin on every row that uses it. */
export const THIN_SAMPLE = 5;
/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 30;
/**
 * The watchlist's own eligibility rule, from the snapshot's documentation: categories that
 * are a wrapped, staked or bridged product of a token that already trades, or an exchange
 * itself, never name a launch candidate. The board applies the same rule to every row.
 */
export const EXCLUDED_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
/** Exchange names: a protocol beginning with one is the exchange's own product. */
export const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** A whole word wrapped, staked or staking anywhere in the name, in any case. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** What the token-bearing market says about one category. */
export interface CategoryMarket {
  category: string;
  sample: number;
  median_ratio: number;
  multiple: number;
  peers: { slug: string; name: string; mcap_usd: number; tvl_usd: number; ratio: number }[];
}

/** One row of board.json: the ranked board's row, audit trail included. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_sample: number;
    global_multiple: number;
    growth_pct: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  risk_flags: string[];
  farm_steps: string[];
  /** The farm plan's economics, from the same numbers the steps state: one source of truth. */
  farm_economics: FarmEconomics;
}

/** What one farm position costs and how long it takes, in numbers the drawer can show at a glance. */
export interface FarmEconomics {
  /** The chain the plan prices gas on (the protocol's first chain, or its main chain). */
  chain: string;
  capital_usd: number;
  setup_gas_usd: number;
  weekly_gas_usd: number;
  hold_days: number;
  weeks: number;
  /** Setup gas plus one weekly gas payment per week of the hold. */
  total_gas_usd: number;
  /** Minutes to set up (wallet plus first position), once. */
  setup_minutes: number;
  /** Minutes a week of continuing activity (a weekly action plus the log). */
  weekly_minutes: number;
  /** Setup minutes plus the weekly minutes over the hold, plus the one-off claim check. */
  total_minutes: number;
}

/** The dashboard's view of one board row: the board row plus nothing it cannot show. */
export interface RadarRow extends BoardRow {
  segment: 'watchlist' | 'early';
}

/** A live-token protocol: it already trades, so it is shown at the market's value, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_summary: string;
  global_multiple: number;
  token_bearing_sample: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** Pre-token protocols set aside as wrapped/staked/bridged products, by the rule's reason. */
  set_aside_count: number;
  set_aside_reasons: { reason: string; count: number }[];
  categories: CategoryMarket[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when the date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list, computed on a sorted copy. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Why a pre-token protocol is not a launch candidate, or null when it is one: the
 * snapshot's watchlist rule, applied as a function of the protocol's own record — its
 * category, its name's words and prefix — never of its name as a special case. A token
 * the record does not carry is still "records no token", never "has none": the rule only
 * removes products the record itself shows are wrapped, staked, bridged or exchange-run.
 */
export function eligibilityReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'token-recorded';
  if (EXCLUDED_CATEGORIES.includes(p.category ?? '')) return `category-${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned-name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped-or-staked-name';
  if (EXCHANGE_PREFIXES.some((e) => p.name === e || p.name.startsWith(`${e} `))) return 'exchange-named';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and a genuine launch candidate. */
export function isRankable(p: SnapshotProtocol): boolean {
  return eligibilityReason(p) === null;
}

/** A token-bearing protocol with both figures the ratio needs. */
function hasRatio(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

const winsorRatio = (p: SnapshotProtocol): number => clamp(p.mcap_usd! / p.tvl_usd, RATIO_FLOOR, RATIO_CAP);

/**
 * The market's own multiples: the global median Mcap/TVL over every token-bearing protocol,
 * and each category's median shrunk toward it by the category's sample size. Categories are
 * returned in name order with their top peers by market cap, so the dashboard can show the
 * evidence behind every multiple it uses.
 */
export function categoryMarkets(snapshot: Snapshot): { global: number; sample: number; markets: CategoryMarket[] } {
  const bearing = snapshot.protocols.filter(hasRatio);
  const global = bearing.length > 0 ? median(bearing.map(winsorRatio)) : 0;
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of bearing) {
    const key = p.category ?? 'Uncategorized';
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  const markets: CategoryMarket[] = [...byCategory.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([category, list]) => {
      const med = median(list.map(winsorRatio));
      // A peer row is evidence, not an input: it shows the protocol's actual ratio,
      // the same number the Live table shows for the same protocol. Only the medians
      // above are computed from winsorized ratios — capping the displayed evidence
      // too would state two different ratios for one protocol on the same page
      // (Aave V2 read 10.00x as a Lending peer and 18.96x as a live token).
      const peers = [...list]
        .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
        .slice(0, 5)
        .map((p) => ({ slug: p.slug, name: p.name, mcap_usd: p.mcap_usd!, tvl_usd: p.tvl_usd, ratio: round4(p.mcap_usd! / p.tvl_usd) }));
      return {
        category,
        sample: list.length,
        median_ratio: round4(med),
        multiple: round4((list.length * med + SHRINK_K * global) / (list.length + SHRINK_K)),
        peers,
      };
    });
  return { global: round4(global), sample: bearing.length, markets };
}

/** The three factors and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  markets: CategoryMarket[],
  globalMultiple: number,
): { implied: number; multiple: number; sample: number; growthPct: number; momentum: number; maturity: number; age: number | null } {
  const market = markets.find((m) => m.category === (p.category ?? 'Uncategorized'));
  const multiple = market !== undefined ? market.multiple : globalMultiple;
  const sample = market !== undefined ? market.sample : 0;
  const growthPct = p.change_7d === null ? 0 : clamp(p.change_7d, MOMENTUM_FLOOR_PCT, MOMENTUM_CAP_PCT);
  const momentum = 1 + (growthPct / 100) * MOMENTUM_WEIGHT;
  const age = ageDays(asOf, p.listed_at);
  const maturity = MATURITY_BASE + (Math.min(age ?? UNKNOWN_AGE_DAYS, MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const implied = clamp(Math.round(p.tvl_usd * multiple * momentum * maturity), 1, 100_000_000_000_000);
  return { implied, multiple, sample, growthPct, momentum, maturity, age };
}

/**
 * The screening flags one row carries: the discipline a farmer applies before any capital
 * moves, read off the protocol's own record. A flag is a question to answer, not a verdict.
 */
export function riskFlags(p: SnapshotProtocol, age: number | null, categorySample: number): string[] {
  const flags: string[] = [];
  if (p.change_7d === null) flags.push('change-unreported');
  else if (p.change_7d <= -15) flags.push('tvl-shrinking');
  else if (p.change_7d >= 40) flags.push('tvl-surging');
  if (age === null) flags.push('age-unreported');
  else if (age < 120) flags.push('under-120-days');
  if (p.chains.length <= 1) flags.push('single-chain');
  if (categorySample < THIN_SAMPLE) flags.push('thin-category-sample');
  return flags;
}

/** Gas for one on-chain action on a chain, as a stated estimate in USD. */
function gasFor(chain: string): { setup: number; weekly: number; label: string } {
  if (chain === 'Ethereum') return { setup: 12, weekly: 6, label: 'Ethereum mainnet gas' };
  if (chain === 'Solana') return { setup: 0.1, weekly: 0.05, label: 'Solana network fees' };
  const l2 = ['Base', 'Arbitrum', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Unichain', 'Mode', 'Taiko', 'Fraxtal', 'Zora', 'World Chain', 'Sonic', 'Berachain', 'Monad'];
  if (l2.includes(chain)) return { setup: 1.5, weekly: 0.5, label: `${chain} gas (Ethereum L2)` };
  return { setup: 0.8, weekly: 0.3, label: `${chain} network fees` };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols earn a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core farming action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain}; if it offers borrowing, borrow once against the position and repay within the week so both sides of the market see the wallet.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${n} to ${chain} and put the bridged funds to work in one app on the far side instead of bridging straight back.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the native staking asset through ${n} on ${chain} and keep the receipt token in the wallet for the whole hold.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedged position each week, sized so a liquidation is impossible at normal volatility.`;
  if (c.includes('dex') || c.includes('liquidity')) return `Provide $${capital} of liquidity to ${n}'s deepest pool on ${chain}, in range, and leave the position untouched between weekly checks.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('allocator') || c.includes('curator')) return `Deposit $${capital} of USDC into a ${n} vault on ${chain} and keep the vault shares; do not chase the highest APY vault when it rotates.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} through its own app and hold the asset in the farming wallet.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it rather than looping it through other protocols.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} for the hold window and keep the policy NFT in the wallet.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${n} and take one position in its most liquid market, then let it settle instead of trading out early.`;
  if (c.includes('launchpad')) return `Register the wallet with ${n} on ${chain} and take part in one sale or staking round with $${capital} during the hold window.`;
  return `Deposit $${capital} of USDC into ${n}'s core product on ${chain} and keep the position open for the whole hold window.`;
}

/**
 * A protocol's farm economics: the cost and time its plan needs, derived from the
 * protocol's own record (first chain, TVL tier, age) — gas from the chain's fee class,
 * capital from its TVL tier, the hold window from its age — never from a hand-written
 * list of names. farmSteps states these same numbers step by step; the drawer shows
 * them summed, so the two can never disagree.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null): FarmEconomics {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const setupMinutes = 30;
  const weeklyMinutes = 15;
  return {
    chain,
    capital_usd: capital,
    setup_gas_usd: gas.setup,
    weekly_gas_usd: gas.weekly,
    hold_days: hold,
    weeks,
    total_gas_usd: Math.round((gas.setup + gas.weekly * weeks) * 100) / 100,
    setup_minutes: setupMinutes,
    weekly_minutes: weeklyMinutes,
    total_minutes: setupMinutes + weeklyMinutes * weeks + 10,
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a stated cost and duration. The plan
 * is derived from the protocol's own record (category, first chain, TVL, age) — gas from the
 * chain's fee class, capital from its TVL tier, the hold window from its age — never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const steps: { text: string; cost: string; time: string }[] = [
    {
      text: `Set up one fresh wallet for ${p.name} alone, fund it only with what this plan uses, and store the seed phrase offline; a wallet that farms one protocol is a wallet you can abandon without collateral damage.`,
      cost: `about $${gas.setup} of ${gas.label} for the funding transaction`,
      time: '10 minutes, once',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus about $${gas.setup} of ${gas.label}`,
      time: '20 minutes to set up',
    },
    {
      text: `Repeat one small qualifying action every week — a deposit top-up, a swap, a vote or a claim — so the wallet shows continuing use rather than a single drive-by transaction.`,
      cost: `about $${gas.weekly} of ${gas.label} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, across at least four weekly snapshots, and check the protocol's TVL once a week; a hold that survives a full month is the activity points programs are built to count.`,
      cost: `the $${capital} stays in the position for the whole window`,
      time: `${hold} days`,
    },
    {
      text: `When a points or rewards page appears, claim only from the link the protocol publishes in its own app or docs, and never pay a fee to claim: a claim that asks for payment is a phishing page, not a reward.`,
      cost: 'nothing to check; never pay to claim',
      time: '10 minutes when it opens',
    },
    {
      text: `Keep a farm log — wallet, dates, amounts, transaction hashes — and exit on discipline, not on rumours: withdraw if the protocol's TVL falls more than 25% from your entry week, if the program's rules change against farmers, or when the hold window ends.`,
      cost: 'nothing but the log itself',
      time: '5 minutes a week',
    },
  ];
  return steps.map((s) => {
    let out = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
    if (out.length > 600) out = `${out.slice(0, 596)}...`;
    return out;
  });
}

/** The ranked board: every rankable pre-token protocol, watchlist rows never dropped. */
export function buildBoard(snapshot: Snapshot): {
  board: BoardRow[];
  markets: CategoryMarket[];
  global: number;
  sample: number;
  setAside: { reason: string; count: number }[];
} {
  const { global, sample, markets } = categoryMarkets(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The set-aside count is the discipline made visible: pre-token by the record, but a
  // wrapped, staked or bridged product of a token that already trades, so never ranked.
  const aside = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const reason = eligibilityReason(p);
    if (reason !== null) aside.set(reason, (aside.get(reason) ?? 0) + 1);
  }
  const setAside = [...aside.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([reason, count]) => ({ reason, count }));
  for (const p of snapshot.protocols) if (isRankable(p)) chosen.set(p.slug, p);
  // Coverage is the gate's row: a watchlist slug stays on the board even if a future
  // snapshot makes it unrankable, scored by the same function as every other row.
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !chosen.has(slug)) chosen.set(slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, markets, global);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: s.v.multiple,
      category_sample: s.v.sample,
      global_multiple: global,
      growth_pct: round4(s.v.growthPct),
      momentum_multiplier: round4(s.v.momentum),
      maturity_multiplier: round4(s.v.maturity),
      age_days: s.v.age,
    },
    risk_flags: riskFlags(s.p, s.v.age, s.v.sample),
    farm_steps: farmSteps(s.p, s.v.age),
    farm_economics: farmEconomics(s.p, s.v.age),
  }));
  return { board, markets, global, sample, setAside };
}

/** The live-token protocols, by market cap: shown at market value, kept off the ranked board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, markets, global, sample, setAside } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const setAsideCount = setAside.reduce((n, r) => n + r.count, 0);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_summary:
      `Implied value = TVL x category multiple x momentum x maturity. The category multiple is the median ` +
      `market-cap/TVL of the snapshot's own token-bearing protocols in that category (each ratio winsorized ` +
      `to [0.001x, 10x] before the median, so one 400x outlier cannot price a whole category; the comparables ` +
      `tables show actual ratios), shrunk toward the global median of ${global}x by sample size ` +
      `((n x category + 4 x global) / (n + 4)). ` +
      `Momentum = 1 + clamp(7d TVL change, -50%, +80%) / 100 x 0.6. Maturity = 0.75 + 0.45 x min(age, 1460d) / 1460. ` +
      `Only a genuine launch candidate is ranked: a protocol that records no token and is not a wrapped, ` +
      `staked or bridged product of a token that already trades — the snapshot's own watchlist rule, applied ` +
      `to the whole board. ${setAsideCount} pre-token protocols are set aside by that rule and never ranked.`,
    global_multiple: global,
    token_bearing_sample: sample,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    set_aside_count: setAsideCount,
    set_aside_reasons: setAside,
    categories: markets,
    rows: board.map((r) => ({ ...r, segment: r.watchlist ? ('watchlist' as const) : ('early' as const) })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, bounds, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const slugs = new Set<string>();
  for (const r of board) {
    if (slugs.has(r.slug)) return `slug ${r.slug} appears twice`;
    slugs.add(r.slug);
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `slug ${r.slug} is not in the snapshot`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const r of board) {
    const reason = eligibilityReason(index.get(r.slug)!);
    if (reason !== null) return `${r.slug} is on the board but not a launch candidate (${reason})`;
  }
  if (board.filter((r) => !r.watchlist).length < 60) return 'fewer than 60 non-watchlist rows';
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value: not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} trimmed characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// Token Radar's model, radar-2: one frozen snapshot in, one ranked board out.
//
// The board ranks pre-token protocols by an implied launch value that is derived
// from the snapshot's own figures only. Nothing is special-cased by name: the same
// arithmetic scores every row, and the dashboard prints the arithmetic beside each
// row so a reader can check it.
//
//   implied = TVL x peerMultiple x growthMult x maturityMult x reachMult
//
// peerMultiple  The category's own valuation: the median mcap/TVL of the live-token
//               protocols in the same category (at least 3 peers, else the global
//               median), shrunk toward the global median and clamped to [0.10, 0.40].
// growthMult    From the protocol's 7-day TVL change, clamped to [-60%, +120%]:
//               1 + growth x 0.5. A falling protocol is worth less, a rising one more.
// maturityMult  From how long the protocol has run with no token yet: 0.70 for a
//               brand-new listing, rising to 1.00 after three years. Age unknown: 365 days.
// reachMult     From chain diversity: 1.00 for one chain, +0.03 per extra chain, up to 1.12.
//
// The dashboard also shows a 0-100 Radar Score per row, built from the same five
// inputs (scale 40, momentum 20, maturity 15, reach 10, category 15), so the reason
// a protocol sits where it does is visible at a glance. The score explains; the
// implied value ranks.
//
// The board covers every slug on the snapshot's watchlist (the floor) and adds the
// pre-token protocols below the floor that the same rule would have kept: no token
// recorded, not a versioned pool, not a wrapped / staked / bridged product of a
// token that already trades, not an exchange. Live-token protocols are kept apart
// and shown as the market's own values — they are the comparables, never ranked.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  peer_min_peers: number;
  peer_shrink: number;
  peer_min: number;
  peer_max: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  reach_per_chain: number;
  reach_max_extra: number;
}

export const MODEL: ModelConstants = {
  peer_min_peers: 3,
  peer_shrink: 0.6,
  peer_min: 0.1,
  peer_max: 0.4,
  growth_floor: -60,
  growth_cap: 120,
  growth_weight: 0.5,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  reach_per_chain: 0.03,
  reach_max_extra: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the comparables view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  score: {
    scale: number;
    momentum: number;
    maturity: number;
    reach: number;
    category: number;
    total: number;
  };
  why: string;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  score: BoardRow['score'];
  why: string;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_per_tvl: number | null;
}

/** Everything the dashboard needs: the board, the comparables, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_peer_multiple: number;
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list, or null when it is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product rather than a protocol of their own. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol name must not begin with. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool, not a wrapped / staked / bridged product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/**
 * The peer multiples, computed from the snapshot itself: for each category, the median
 * mcap/TVL of its live-token protocols (at least `peer_min_peers` of them), and the global
 * median over every live-token protocol. A category with too few peers falls back to the
 * global median. The multiple a category gets is the shrunk, clamped blend of the two.
 */
export interface PeerMultiples {
  global: number;
  byCategory: Map<string, number>;
  multipleFor: (category: string | null) => number;
}

export function peerMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): PeerMultiples {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0);
  const global = median(live.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0.2;
  const byCategory = new Map<string, number>();
  const cats = new Set(live.map((p) => p.category).filter((c): c is string => c !== null));
  for (const cat of cats) {
    const ratios = live.filter((p) => p.category === cat).map((p) => p.mcap_usd! / p.tvl_usd);
    if (ratios.length < model.peer_min_peers) continue;
    const med = median(ratios);
    if (med === null) continue;
    const shrunk = model.peer_shrink * med + (1 - model.peer_shrink) * global;
    byCategory.set(cat, Math.min(model.peer_max, Math.max(model.peer_min, shrunk)));
  }
  const globalClamped = Math.min(model.peer_max, Math.max(model.peer_min, global));
  return {
    global: globalClamped,
    byCategory,
    multipleFor: (category: string | null): number => {
      if (category !== null) {
        const m = byCategory.get(category);
        if (m !== undefined) return m;
      }
      return globalClamped;
    },
  };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerMultiples,
  model: ModelConstants = MODEL,
): { implied: number; peerMultiple: number; growthPct: number; growthMult: number; maturityMult: number; reachMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const peerMultiple = peers.multipleFor(protocol.category);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.reach_max_extra);
  const reachMult = 1 + extraChains * model.reach_per_chain;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peerMultiple * growthMult * maturityMult * reachMult));
  return { implied, peerMultiple, growthPct, growthMult, maturityMult, reachMult, age };
}

/** The 0-100 Radar Score, from the same five inputs the implied value uses. */
export function radarScore(
  protocol: SnapshotProtocol,
  parts: { peerMultiple: number; growthPct: number; age: number | null },
  maxTvl: number,
): { scale: number; momentum: number; maturity: number; reach: number; category: number; total: number } {
  const round1 = (n: number): number => Math.round(n * 10) / 10;
  const lo = Math.log10(5_000_000);
  const hi = Math.log10(Math.max(maxTvl, 5_000_001));
  const scale = 40 * Math.min(1, Math.max(0, (Math.log10(Math.max(protocol.tvl_usd, 1)) - lo) / (hi - lo)));
  const momentum = 10 + Math.min(30, Math.max(-30, parts.growthPct)) * (10 / 30);
  const age = parts.age ?? MODEL.unknown_age_days;
  const maturity = 15 * (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days);
  const reach = 10 * (Math.min(Math.max(protocol.chains.length - 1, 0), MODEL.reach_max_extra) / MODEL.reach_max_extra);
  const category = 15 * ((parts.peerMultiple - MODEL.peer_min) / (MODEL.peer_max - MODEL.peer_min));
  return {
    scale: round1(scale),
    momentum: round1(momentum),
    maturity: round1(maturity),
    reach: round1(reach),
    category: round1(category),
    total: round1(scale + momentum + maturity + reach + category),
  };
}

/** One short sentence saying why the row sits where it does, from its own figures. */
export function reasonFor(row: { name: string; tvl_usd: number; change_7d: number | null; chains: string[]; age_days: number | null; peer_multiple: number }, maxTvl: number): string {
  const bits: string[] = [];
  if (row.tvl_usd >= maxTvl * 0.9) bits.push('the largest TVL on the board');
  else if (row.tvl_usd >= 500_000_000) bits.push(`$${(row.tvl_usd / 1e9).toFixed(2)}B of TVL`);
  else if (row.tvl_usd >= 100_000_000) bits.push(`$${Math.round(row.tvl_usd / 1e6)}M of TVL`);
  if (row.change_7d !== null && row.change_7d >= 5) bits.push(`growing +${row.change_7d.toFixed(1)}% this week`);
  else if (row.change_7d !== null && row.change_7d <= -10) bits.push(`TVL down ${row.change_7d.toFixed(1)}% this week`);
  if (row.chains.length >= 5) bits.push(`live on ${row.chains.length} chains`);
  if (row.age_days !== null && row.age_days >= 730) bits.push(`${(row.age_days / 365).toFixed(1)} years running with no token`);
  else if (row.age_days !== null && row.age_days < 180) bits.push('a young protocol, still early');
  if (row.peer_multiple >= 0.3) bits.push(`peers in its category trade near ${(row.peer_multiple).toFixed(2)}x TVL`);
  if (bits.length === 0) bits.push('steady TVL with no token yet');
  return bits.slice(0, 3).join('; ') + '.';
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  if (p.tvl_usd >= 10_000_000) return 60;
  return 30;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC into ${name}'s lending market on ${chain}. Leave the deposit in place so it keeps earning and counting.`;
  if (c.includes('dex') || c.includes('liquidity')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP tokens. Do not pull them out early.`;
  if (c.includes('yield') && !c.includes('yield aggregator')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and keep the vault shares.`;
  if (c.includes('yield aggregator') || c.includes('allocator') || c.includes('curator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares for the full window.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then put the bridged funds to work in its app the same week.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as collateral on ${name} and open a single small hedged position on ${chain}.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} and take one position in an open market. One real position beats ten tiny ones.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and keep the position open.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the whole window.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} and use it in ${name}'s native apps, so the wallet shows real activity on the chain.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} over the month, in a few real transactions.`;
  if (c.includes('govern')) return `Hold $${capital} of voting power in ${name}'s governance on ${chain} and vote on at least one live proposal.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the full window.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet that will hold only this farm. Write its seed phrase on paper and store it offline — never in a screenshot or a chat.`,
      cost: 'no capital, under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 120 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Come back once a week and do one genuine action — a deposit, a swap, a borrow, or a vote — so the wallet reads as a real user, not a one-off deposit.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position for at least ${hold} days. Snapshots are taken over weeks, so a position that lasts one weekend rarely counts.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When ${p.name} publishes a points or rewards page, reach it only from the link on its own site or documentation. A claim that asks you to pay first is not a claim.`,
      cost: 'nothing to check; never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet address, the dates, and every transaction hash in a farm log. The log is what lets you repeat the farm — or unwind it — without guessing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerMultiples(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every pre-token protocol below the watchlist floor the same rule
  // would have kept. Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const maxTvl = Math.max(...[...chosen.values()].map((p) => p.tvl_usd));
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, peers, model);
    const score = radarScore(p, { peerMultiple: v.peerMultiple, growthPct: v.growthPct, age: v.age }, maxTvl);
    return { p, v, score };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const why = reasonFor(
      { name: s.p.name, tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, chains: s.p.chains, age_days: s.v.age, peer_multiple: s.v.peerMultiple },
      maxTvl,
    );
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      model: {
        peer_multiple: Math.round(s.v.peerMultiple * 10000) / 10000,
        growth_pct: s.v.growthPct,
        growth_multiplier: Math.round(s.v.growthMult * 10000) / 10000,
        maturity_multiplier: Math.round(s.v.maturityMult * 10000) / 10000,
        reach_multiplier: Math.round(s.v.reachMult * 10000) / 10000,
        age_days: s.v.age,
      },
      score: s.score,
      why,
      farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's comparables view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_per_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1000) / 1000 : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reach_multiplier: row.model.reach_multiplier,
    score: row.score,
    why: row.why,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_peer_multiple: peers.global,
    rows: board.map(radarRow),
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
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than the 100 the gate needs`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zuoyilove/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zuoyilove/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over the sealed DefiLlama snapshot: all 198 rankable pre-token protocols, every watchlist slug covered, each priced by an implied value derived from the snapshot's own market instead of one flat multiple. The model takes the median market-cap/TVL of the token-bearing protocols in each category (lending ≈0.13x, DEXs ≈0.34x, cross-chain bridges ≈1.22x; ratios winsorized at 10x), shrinks it toward the global median by sample size, then adjusts for 7-day TVL momentum (clamped −50%/+80%) and for how long the protocol has run without a token. Every board row carries its full audit trail — the multiple used, the sample behind it, both adjustments — plus screening risk flags (shrinking or surging TVL, under 120 days old, single chain, thin category sample, unreported figures) and a six-step farm plan with chain-aware gas costs, a TVL-tiered capital size, an age-based hold window and exit discipline. The dashboard is a static offline page: sortable, filterable by segment, category, chain and search, with a per-protocol detail drawer that works the implied value step by step from the snapshot's own numbers, shows how the category multiple was built from its live comparables, and totals the farm plan's cost and time before the steps. Live-token protocols are kept off the ranked board and shown at the market's own values. The cover carries a self-check strip the page recomputes from the rows it renders — row count, rank order, the board's total implied value, a checksum that must match the one main.ts prints into the data, watchlist coverage, and the ledger total — and a full accounting of all 758 protocols in the snapshot: ranked on the board, set aside by the watchlist rule with each reason counted, or already carrying a token, so every protocol has a stated destination.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=dcz81z7d&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

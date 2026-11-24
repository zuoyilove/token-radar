# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zuoyilove/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zuoyilove/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over the sealed DefiLlama snapshot: all 198 rankable pre-token protocols, every watchlist slug covered, each priced by an implied value derived from the snapshot's own market instead of one flat multiple. The model fits a size curve to the snapshot's own token-bearing protocols — log market cap on log TVL (fitted slope ≈ 0.52, so a token's value grows roughly with the square root of TVL), with a fitted intercept per category (lending −0.45, basis trading +0.69), shrunk toward the global curve when the sample is thin — and tests the curve held-out twice before using it (5-fold cross-validation MAE of log market cap 1.61 vs 1.82 for category medians; time split 1.63 vs 1.93). A 7-day-growth term and an age term were fitted the same way and dropped, because neither improved held-out error: growth and age show as risk flags and set the farm hold window, but are not priced into the value. Every board row carries its full audit trail — the curve terms used, the sample behind them, the growth and age figures — plus screening risk flags (shrinking or surging TVL, under 120 days old, single chain, thin category sample, unreported figures) and a six-step farm plan with chain-aware gas costs, a TVL-tiered capital size, an age-based hold window and exit discipline. The dashboard is a static offline page: sortable, filterable by segment, category, chain and search, with a per-protocol detail drawer that works the implied value step by step from the snapshot's own numbers, shows how the category intercept was built from its live comparables, and totals the farm plan's cost and time before the steps. Live-token protocols are kept off the ranked board and shown at the market's own values.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=dcz81z7d&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

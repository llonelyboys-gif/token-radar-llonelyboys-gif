# Token Radar — Pre-Token Protocols Ranked by Implied Launch Value

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/llonelyboys-gif/token-radar-llonelyboys-gif/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/llonelyboys-gif/token-radar-llonelyboys-gif/reward.svg)](https://make.fun/bounty/token-radar-01)

A dashboard that ranks protocols whose token does not exist yet — by what that token
would be worth if the protocol's record stayed as it is — and shows a reader how to
farm each one. Built for the [make.fun](https://make.fun) **token-radar-01** bounty.

## What it does

- Reads the sealed DefiLlama snapshot (`/input/snapshot.json`, as of 2026-11-14):
  758 protocols, 40 on the house watchlist (TVL ≥ $50M, no token recorded, not a
  wrapped / staked / bridged product of a token that already trades).
- Scores every pre-token protocol with a transparent model and writes the ranked
  board to `/output/board.json` — 178 rows (all 40 watchlist protocols plus 138
  early ones below the floor), each with a concrete farm plan.
- Renders a static dashboard (`dashboard/`) that is sortable and filterable, with a
  detail view for every protocol and a separate view of the live-token protocols
  whose market caps set the model's peer multiples.

## The model (radar-2)

Implied value is derived from the snapshot's own figures only — never from a
hardcoded list of names:

```
peer multiple  = median(mcap / TVL) of live-token protocols in the same category
                 (≥3 peers; otherwise the global median), shrunk toward the
                 global median and clamped to [0.10, 0.40]
growth         = clamp(change_7d, -60%, +120%)
growth mult    = 1 + growth × 0.5
maturity mult  = 0.70 + min(age_days, 1095) / 1095 × 0.30   (age unknown: 365 days)
reach mult     = 1 + min(chains − 1, 4) × 0.03
implied value  = TVL × peer multiple × growth mult × maturity mult × reach mult
```

The dashboard also shows a 0–100 Radar Score per row — scale (TVL), momentum (7-day
growth), maturity (age), reach (chain count) and category (peer multiple) — so any
reader can see exactly why a protocol sits where it does. The implied value is the
entry's own claim, never a prediction that a token will be issued or when.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only, no network. The program is deterministic: two runs
write byte-identical output. It copies `dashboard/` and `screenshots/` to the output
directory and writes `dossier.json` with the vendored `vendor/makefun-board.ts`.

## Data

Snapshot: DefiLlama `https://api.llama.fi/protocols`, fetched 2026-11-14 (see the
kit's `input/README.md`). The snapshot carries no ranking, score, or farm plan —
deriving them is this entry's work.

## License

MIT — see [LICENSE](LICENSE).

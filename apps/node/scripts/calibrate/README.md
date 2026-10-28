# Refitting the odds

The odds in `src/chain/odds.ts` are two logistic models fitted on pump.fun launches 24 to 48 hours old, with the
features as they stood five minutes in.

1. Copy `chain-tape.json`, `chain-lineage.json` and `chain-socials.json` from north's data folder, and
   `src/chain/exchanges.json`, into one folder.
2. `node --max-old-space-size=12000 extract.mjs <folder>` writes `<folder>/features.csv`.
3. `python3 model.py <folder>/features.csv <folder>/coef.json` (needs pandas and scikit-learn) prints the held-out
   AUC, a calibration table by tenths, and the coefficients and means to paste into `odds.ts`.

`peakAfter5` is the run target, `dumpedLater` the dev-dumps target. Bump `ODDS_FIT` when the coefficients change.

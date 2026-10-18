# Judge calibration

Hand-scored runs of the golden set (ADR 0007, `.docs/design/replay-and-evals.md`, Calibration).

1. `heimdall eval` writes one scoring sheet per run (`*.score.yaml`) next to its scorecard in
   `~/.heimdall/evals/<time>/sheets/`. Each sheet holds what the judge saw. Its scores are left
   blank, so the judge's numbers cannot anchor yours.
2. Score each dimension 0, 1 or 2 by the rubric, and move the sheet here.
3. `heimdall eval --calibrate` judges every scored sheet. When at least 5 are scored, every
   dimension agrees exactly on 80% or more, and none is ever off by 2, it writes a passing
   `judge.lock.json`. Until a passing lock matches the judge model, scorecards say
   **uncalibrated**.

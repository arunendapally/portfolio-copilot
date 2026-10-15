# Release checklist

1. Bump `version` in `.claude-plugin/plugin.json` and `package.json` (same value).
2. `node --test tests/*.test.js`: all pass.
3. `node scripts/build.js`: regenerates `editions/lite/`, `dist/*.plugin` and the root `.plugin` files.
4. `claude plugin validate . --strict` and `claude plugin validate ./editions/lite --strict`.
5. `python evals/run-evals.py` (T0-T2) for the full edition and `--plugin-dir editions/lite --probes T0`; `--probes T3` with a symbol you have not used recently. All PASS.
6. Manual smoke with a real broker (read-only): `specs/001-v05-rebuild/quickstart.md`.
7. Merge to main with green CI. Upload `portfolio-copilot.plugin` to claude.ai and run T0's checklist in a fresh cloud Cowork session (skills listed, house rules present).
8. Tag `vX.Y.Z`.

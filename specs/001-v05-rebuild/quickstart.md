# Quickstart: verify v0.5

```bash
node --test tests/
```

```bash
node scripts/build.js
```

```bash
claude plugin validate dist/portfolio-copilot
```

```bash
python evals/run-evals.py --plugin-dir dist/portfolio-copilot --probes T0 T1 T2
```

Manual smoke (real broker, read-only):
1. New session in your working folder: "check my portfolio".
2. Expect one status table; a Kite link only if Kite needs login. Authorise, say "done".
3. Expect a consolidated report in under a minute. Run "check" again: identical numbers.
4. "audit my GTTs": per-symbol gaps, crash test, a draft code. Do not approve.
5. Restart Claude, run "check" again: Kite should still be live (session reused).

# Release checklist

1. Bump `version` in `.claude-plugin/plugin.json` and `package.json` (same value), and add a `## [X.Y.Z] - date` section to `CHANGELOG.md`. The server and MCP client read the version from `plugin.json`.
2. `node --test tests/*.test.js`: all pass.
3. `node scripts/build.js`: regenerates `editions/lite/`, `dist/*.plugin` and the root `.plugin` files.
4. `claude plugin validate . --strict` and `claude plugin validate ./editions/lite --strict`.
5. `python evals/run-evals.py` (T0-T2) for the full edition and `--plugin-dir editions/lite --probes T0`; `--probes T3` with a symbol you have not used recently. All PASS.
6. Manual smoke with a real broker (read-only): `specs/001-v05-rebuild/quickstart.md`.
7. Merge to main with green CI. Upload `portfolio-copilot.plugin` to claude.ai and run T0's checklist in a fresh cloud Cowork session (skills listed, house rules present).
8. Tag `vX.Y.Z`.

## Versioning policy

Semantic versioning, `MAJOR.MINOR.PATCH`. While the plugin is 0.x, MINOR also carries breaking changes.

- **PATCH**: fixes only. No new tools, skills, profile fields or behaviour.
- **MINOR**: new tools, skills, profile fields or hooks; any change to how orders are approved or executed. While 0.x, breaking changes (a removed or renamed tool, a profile field that changes meaning) also bump MINOR and are listed under **Breaking** in the changelog.
- **MAJOR**: from 1.0 on, breaking changes.
- Every change to shipped files bumps the version. Claude Code caches an installed plugin by its version, so a change under an old number is not picked up.
- Hooks and server ship together and must report the same version; `broker_status` warns when a chat has hooks from a different version.
- Version is declared once in `.claude-plugin/plugin.json` (the marketplace entries carry none, so they cannot drift). The lite edition is generated from it.
- Each release has a changelog entry and a `vX.Y.Z` tag.

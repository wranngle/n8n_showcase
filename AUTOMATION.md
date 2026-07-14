# Automation Contract

Two layers of automation touch this repo; both are local-first and neither
pushes on your behalf.

## Local checkpoints (git_good)

A machine-global cron (`git_good sync`, every 15 minutes) snapshots dirty
work as a git stash checkpoint and immediately restores the worktree. No
remote refs, no PRs, no per-repo policy files — defaults are hardcoded in
the binary. Runtime evidence lands in `.artifacts/git_good/` (gitignored):
an ECS-shaped JSONL event ledger, flat `stash.<uuid>.patch` archives, and
per-session guard baselines. If a restore ever fails, the ledger records
`sync.restore-fail` and the checkpoint stash is kept for manual recovery.

## Integration (GitHub)

- All changes land through PRs against `main`; direct pushes are blocked.
- `main` requires six status checks: `shell-lint`, `yaml-lint`, `test`,
  `gitleaks`, `actionlint`, `zizmor`. The `test` check runs the full bats
  suite (`npm test`).
- Merges use GitHub auto-merge with squash and branch deletion
  (`gh pr merge --auto --squash`).
- Dependabot keeps GitHub Actions pinned and current; gitleaks scans both
  pre-commit (lefthook) and in CI.

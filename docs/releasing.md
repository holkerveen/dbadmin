# Release runbook

The short version of [README § Releasing](../README.md#releasing), as an ordered checklist. Read the README's `--no-git-tag-version` warning once before your first release; it explains *why* the bump and the tag are separate steps.

## Choosing the version

Pre-1.0, `0.x` treats **any** breaking change as a minor bump:

| Change | Bump |
|---|---|
| Removed or renamed an endpoint, changed what an existing URL does | `0.N+1.0` |
| New feature, backwards compatible | `0.N+1.0` |
| Bug fix only | `0.N.P+1` |

## Steps

1. **Bump on the feature branch**, so the PR and the release share one CI run:

   ```sh
   npm version 0.2.0 --no-git-tag-version   # the flag is required
   git commit -am 'Release 0.2.0'
   git push
   ```

2. **Open a PR against `main`** (`gh pr create`, or the web UI). Wait for the `test` job — lint, typecheck, and `./dbadmin.sh test` across both the dev and prod stacks — then merge.

3. **Wait for the `main` build to go green.** Merging starts a fresh run that publishes `edge` and `sha-<short>`. The tag must land after *this* run passes, not merely after the PR's did — that ordering is the whole point of the two-step flow.

4. **Tag and push:**

   ```sh
   git checkout main && git pull
   node -p "require('./package.json').version"   # must equal the tag, minus the v
   git tag v0.2.0
   git push origin v0.2.0
   ```

   The `assert-version` job fails the run if the tag and `package.json` disagree. Pushing the tag publishes `0.2.0`, `0.2`, `0`, and moves `latest`.

## Release notes

Lead with anything that changes behaviour for someone who upgrades without reading a diff — `:latest` and `:0` users get the new image unannounced. Call out explicitly:

- changes to what an existing URL, endpoint, or bookmark does;
- anything newly written to logs, history, or the network;
- state that will not survive a rollback to the previous tag.

## If a release goes wrong

A published tag cannot really be unpublished — anyone who fetched it keeps it, and GHCR may hold partial artifacts. Roll forward with a new patch release rather than deleting and re-pushing the tag.

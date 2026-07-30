<!--
    Copyright (c) 2026 Michael Vandeberg

    Distributed under the Boost Software License, Version 1.0. (See accompanying
    file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)

    Official repository: https://github.com/cppalliance/capy
-->
# `doc/lint` — the documentation-quality toolkit

These scripts implement the enforcement tiers in `DOC_STYLE_GUIDE.md` Part F.0. They run in
the **Documentation** workflow (`.github/workflows/docs.yml`), in the `antora` job, after the
site build. Node built-ins only, no dependencies of their own.

| Script | What it checks |
|---|---|
| `doc-lint.mjs` | Structural AsciiDoc/nav rules (A1, A6, B2, D2, …). JSON on stdout. |
| `extract-docstrings.mjs` | Extracts header docstrings into `.docstrings/*.adoc` so Vale can lint them. |
| `mrdocs-warnings.mjs` | Runs the pinned MrDocs 0.8.0 directly and parses its reference-surface warnings. |
| `run-a11y.mjs` | pa11y-ci contrast/a11y scan over the built site (`doc/build/site`). |
| `baseline.mjs` | Runs all five checks and snapshots their findings to `baseline.json`. |
| `check-no-new-violations.mjs` | **The gate.** Diffs a fresh run against `baseline.json` and fails on NEW findings. |
| `baseline-diff.mjs` | Explains what replacing `baseline.json` with a candidate would change. |

## How the gate works

`baseline.json` is a snapshot of every finding that already existed when it was taken.
`check-no-new-violations.mjs` runs a fresh scan and reports only fingerprints that are **not**
in the snapshot. Everything in the snapshot is grandfathered.

Which findings actually *block* a merge is the `--gate <check>:<regex>` spec in the blocking
step of `.github/workflows/docs.yml`. Each regex is tested against the **whole** fingerprint.

Fingerprints are built by `baseline.mjs` and their shape is load-bearing:

| Check | Fingerprint |
|---|---|
| `doc_lint` | `rule:file:#N:message` — rule at the **head** |
| `vale_adoc`, `vale_docstrings` | `file:#N:Check.Name` — check name at the **tail** |
| `mrdocs_warnings` | `file:#N:message` |
| `a11y` | `url:code:selector` |

`#N` is the Nth occurrence of that (head, tail) pair, **not a line number** — so inserting
text above a finding does not rename it. It sits mid-key on purpose: the gate spec
`vale_adoc:Capy\.PartHeadings$` is anchored on the tail, and anything appended after the check
name would make that gate match nothing while still exiting 0.

**Never hand-edit `baseline.json`.**

---

## Reseeding `baseline.json`

### When you need to

The snapshot goes stale in one direction: when you **fix** findings they disappear from the
scan but stay in the snapshot. Those stale entries are dead grandfather clauses — the finding
can be reintroduced later and the gate will still pass, because the snapshot says it is a
known issue. Reseed when a batch of fixes has landed and you want the gate to start protecting
them.

**Never reseed to make a red gate go green.** If the gate is red, something new was
introduced. Fix that instead.

### Why not just run `baseline.mjs` locally

Because a local run differs from a CI run by hundreds of fingerprints — a different MrDocs
0.8.0 build hash, `chromium` instead of the runner's `google-chrome`, different
file-processing order, a different `asciidoctor` implementation. Committing that grandfathers
your machine's quirks as if they were the project's backlog. Measured during Phase 3: a local
run adds **357** fingerprints a CI run would not.

So the candidate is authored by CI, in the CI environment, and a human reviews and commits it.

### Prerequisite

GitHub only offers the `workflow_dispatch` trigger for a workflow whose file is present **on
the repository's default branch**. If `.github/workflows/docs.yml` on the default branch has
no `workflow_dispatch:` in its `on:` block, neither the "Run workflow" button nor
`gh workflow run` will find it, and you must merge that change first. Once it is on the
default branch you can dispatch against any ref.

### 1. Run the job

Web UI: **Actions → Documentation → Run workflow →** pick the branch → **Run workflow**.

```bash
gh workflow run docs.yml --ref <branch-you-want-a-baseline-for>
gh run list --workflow=docs.yml    # then: gh run watch <run-id>
```

The run does everything a normal docs run does — including the blocking gate against the
*currently committed* baseline — and then produces a candidate baseline, **only** because you
dispatched it manually. A push or a pull request never produces one; an automatic reseed would
absorb real regressions into the grandfathered backlog.

### 2. Read the report before downloading anything

Open the finished run and read its **Summary** page, under "Candidate
doc/lint/baseline.json". Check three things, in this order:

1. **A `SKIPPED` cell in the per-check table.** Stop if you see one. A skipped check means a
   tool could not run (most often Ruby `asciidoctor` missing, which breaks the `vale_adoc`
   slice; or a MrDocs cache miss). The candidate would wipe that check's entire grandfathered
   backlog. The step will already have failed with a red annotation. Fix the environment,
   re-run, discard this candidate.

2. **"ADDED fingerprints that the merge gate WOULD have blocked."** If it says `(none — …)`,
   good. Anything listed is either **a real regression** you are about to grandfather away —
   go fix the documentation instead — or **an environment difference you have positively
   identified as such**. Do not accept a candidate with unexplained entries here. This section
   is the entire safety mechanism.

3. **The ADDED / REMOVED breakdown by check and rule.** REMOVED is what you came for: stale
   entries being retired. ADDED becomes permanently grandfathered; additions in ungated slices
   are tolerable while those slices are still being worked down, but read the rule names and
   confirm they are the classes you expect.

### 3. Accept it

```bash
gh run download <run-id> -n doc-lint-baseline-candidate -D /tmp/cand
cp /tmp/cand/baseline.json doc/lint/baseline.json
git diff --stat doc/lint/baseline.json
```

The artifact also contains `baseline-diff.txt` (the report you just read) and
`baseline.json.diff` (a `diff -u` against the committed baseline, the only place a single
changed fingerprint is visible verbatim).

Commit on a branch, naming the run that produced it and what the ADDED entries were, so the
next person can audit the decision:

```
ci: reseed doc/lint/baseline.json from CI run <run-id>

Retires <N> stale fingerprints (<breakdown>). Adds <M>, all in non-gated
slices (<breakdown>); no added fingerprint matches the blocking gate spec.
```

Open a PR. The Documentation workflow on that PR runs the gate against your new baseline —
**that run is the real proof.** If the candidate was authored in a drifted environment,
`mrdocs_warnings` (gated as a whole check) red-lines immediately. It fails closed, not open.

### Reading a candidate by hand (diagnosis only)

`baseline-diff.mjs` compares any two snapshots. Keep the `--gate` values identical to the ones
in the blocking step of `.github/workflows/docs.yml`; if they drift apart the report stops
flagging the additions that matter.

```bash
cd doc
node lint/baseline-diff.mjs lint/baseline.json /path/to/candidate.json \
  --gate 'doc_lint:^(A1|A6|B2|D2):' \
  --gate 'vale_adoc:Capy\.PartHeadings$' \
  --gate 'mrdocs_warnings:.*'
```

Exit 0 means the candidate is explainable (it may still add findings — read the report); exit
1 means it is not safe to commit at all.

### Running the checks locally

`vale_adoc` and `vale_docstrings` need an `asciidoctor` on `PATH` (Vale shells out to it for
`.adoc`), and `run-a11y.mjs` needs `doc/build/site` plus a browser:

```bash
cd doc
export PATH="$PWD/node_modules/.bin:$PATH"
node lint/baseline.mjs /tmp/local-snapshot.json      # never commit this as baseline.json
```

`baseline.mjs` output is working-directory-independent, so it is safe to run from anywhere.

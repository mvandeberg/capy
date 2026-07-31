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
doc/lint/baseline.json". The report ends in a `RESULT:` line; **if it does not say
`candidate retires … none gated`, the reseed step has failed and you must not commit the
file.** Then check four things, in this order:

1. **A `SKIPPED` cell in the per-check table.** Stop if you see one. A skipped check means a
   tool could not run (most often Ruby `asciidoctor` missing, which breaks the `vale_adoc`
   slice; or a MrDocs cache miss). The candidate would wipe that check's entire grandfathered
   backlog. Fix the environment, re-run, discard this candidate.

   The same applies to a **gated check showing `0` findings** against a non-zero committed
   count: a check that crashes reports zero, and zero looks like success. That is also fatal.
   If a gated backlog has *genuinely* reached zero — a milestone, not an accident — confirm
   the check really ran and re-run the comparator with `--allow-emptied <check>`.

2. **"ADDED fingerprints that the merge gate WOULD have blocked."** If it says `(none — …)`,
   good. Anything listed is either **a real regression** you are about to grandfather away —
   go fix the documentation instead — or **an environment difference**. Do not accept a
   candidate with unexplained entries here; this section is the entire safety mechanism. Two
   checks that settle which it is:

   - **Does the fingerprint's file and rule correspond to something that changed at the ref
     you dispatched?** `git log --oneline <default-branch>..<ref> -- <that file>`. A real
     regression has a change behind it; drift does not.
   - **Re-dispatch against the default branch and see whether the same fingerprint appears.**
     Environment drift reproduces on a ref that contains none of your work. A regression
     introduced at your ref does not.

3. **The ADDED / REMOVED breakdown by check and rule.** ADDED becomes permanently
   grandfathered; additions in ungated slices are tolerable while those slices are still being
   worked down, but read the rule names and confirm they are the classes you expect.

4. **REMOVED is what you came for — so confirm it is what you did.** The rule breakdown should
   match the work that has actually landed since the last reseed. A retirement far larger than
   the work, or spread across rules nobody touched, means a tool linted less than it should
   have rather than that the backlog shrank. (Precedent: a malformed code span once made
   `asciidoctor` swallow real prose and collapsed the linted surface from 1576 alerts to 412,
   with no error anywhere.)

### 3. Accept it

```bash
cd "$(git rev-parse --show-toplevel)"          # paths below are repo-root-relative
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

`baseline-diff.mjs` compares any two snapshots. The CI step derives its `--gate` values from
the blocking step in `.github/workflows/docs.yml` so the two cannot rot apart; when you run it
by hand, copy them from that step — a report run with a stale or missing gate spec prints
`none gated` and means nothing.

```bash
cd doc
node lint/baseline-diff.mjs lint/baseline.json /path/to/candidate.json \
  --gate 'doc_lint:^(A1|A6|B2|D2):' \
  --gate 'vale_adoc:Capy\.PartHeadings$' \
  --gate 'mrdocs_warnings:.*'
```

Exit 0 means the candidate is explainable (it may still add *ungated* findings — read the
report). Exit 1 means it must not be committed as-is, for one of three reasons, all named in
the `RESULT:` line: a check is `skipped`, a gated check collapsed to zero findings, or an added
fingerprint matches the gate spec.

### Running the checks locally

`vale_adoc` and `vale_docstrings` need an `asciidoctor` on `PATH` (Vale shells out to it for
`.adoc`), and `run-a11y.mjs` needs `doc/build/site` plus a browser:

```bash
cd doc
export PATH="$PWD/node_modules/.bin:$PATH"
node lint/baseline.mjs /tmp/local-snapshot.json      # never commit this as baseline.json
```

`baseline.mjs` output is working-directory-independent, so it is safe to run from anywhere.

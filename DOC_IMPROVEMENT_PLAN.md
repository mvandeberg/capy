# Capy / Corosio Documentation Improvement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to work task-by-task. Steps use checkbox
> (`- [ ]`) syntax. This is a **documentation** plan: a task's "test" is *docs build clean +
> Vale passes + snippets compile + page matches its acceptance checklist*, not a unit test.

**Goal:** Bring Capy and Corosio documentation to Boost re-review quality by fixing the
verified feedback in [DOC_REVIEW_FEEDBACK.md](DOC_REVIEW_FEEDBACK.md), and lock in
guardrails ([DOC_STYLE_GUIDE.md](DOC_STYLE_GUIDE.md) + Vale) so it cannot re-drift.

**Architecture:** Guardrails first, then outside-in — Structure → Accuracy →
Completeness → Wording — because polishing prose before fixing structure just creates
work to redo. Single source runs **three levels: code → docstrings (the MrDocs reference)
→ exposition** (which *links* the reference, never restates it). Two doc surfaces exist —
`.adoc` pages and header docstrings — and both get the five axes in every phase.

**Tech stack:** Antora (AsciiDoc), `antora-cpp-reference`/`-tagfiles` extensions,
`@antora/collector-extension` snippet pipeline (`test/doc/`), MrDocs reference (generated
from `include/boost/capy/**` docstrings), Vale (to be added), and the `doc-prompts/`
structured prompt collection (generation/repair engine).

## Global Constraints

- **Capy first**; Corosio follows the identical playbook (Phase 5).
- **The doc corpus is two surfaces:** exposition `.adoc` pages **and** reference docstrings
  in `include/boost/capy/**` (MrDocs generates the reference from them). Every phase covers
  both for the symbols in scope. **Reference edits land in the `.hpp`, never the generated
  page.** Reference accuracy means *docstring ↔ code*, not prose ↔ reference. Follow the
  `boost-docs` skill's Doxygen conventions for docstrings.
- **Never hand-type an API signature** in exposition prose — link with `cpp:` (Style Guide B1).
- **Never paste example code** — `include::example$...[tag=]` from a compiled source
  (Style Guide B2). Non-compiling blocks carry `role=pseudocode`/`role=external`.
- **One Diátaxis mode per page** (Style Guide A1); reference content stays in the reference.
- **Holistic adoption, not piecemeal.** The approach (Diátaxis + anti-drift guardrails +
  the five axes) is adopted across the doc set as a coherent whole and integrated together,
  not merged one task at a time. Tasks remain the unit of *work and review* (each still ends
  build-clean + `vale`-clean + commit), but they accumulate on the branch and land as one
  cohesive change rather than per-task PRs.
- **Edits are produced by the `doc-prompts/` collection**, not hand-authored ad hoc:
  `doc-write` (new/rewritten pages or docstrings), `doc-fix` (repairs from `doc-audit`
  findings), `doc-sync` (code-change drift, incl. the changed symbol's own docstring). The
  CI gates (Task 2) are the backstop, not the author.
- Doc build (local): `cd doc && npx antora --fetch local-playbook.yml` — must finish with
  **zero broken-xref warnings**.
- Snippet build (local): the `test/doc/{snippets,programs}` CMake targets must compile
  (confirm exact target name from `.github/workflows/ci.yml` before first run).
- Every task ends: **build clean → `vale doc/modules` clean at error-level → commit.**

---

## Phase 0 — Re-baseline & guardrails

### Task 1: Re-baseline the feedback against current `develop`

**Files:** update `DOC_REVIEW_FEEDBACK.md` status columns; produce `doc-worklist.md`.

**Why first:** develop has moved since the review. Already confirmed done: #2 (positioning,
`708f0d34`), #8 (snippet compile, `aa1a38c7`), signal-safety (`3dc32e8a`), much of #9 TLS
(`19d76f37`,`71040d78`). Re-checking prevents reworking items that are already closed.

- [ ] **Step 1:** For each finding #1–#30, open the current file(s) named in its
  `verify_hint` and mark it done / partial / open. Command per finding, e.g.:
  `grep -rn "Asynchronously launch a lazy task" include/boost/capy/ex/run_async.hpp`
- [ ] **Step 2:** Write `doc-worklist.md`: one row per still-open finding →
  `{finding#, library, surface (adoc|docstring), pages/headers, phase, owner}`. This
  worklist, not this plan, is the authoritative per-item task list for Phases 1–4.
- [ ] **Step 3:** Commit: `docs: re-baseline review feedback against develop`.

**Acceptance:** every finding has a current status and a surface.

### Task 2: Stand up all enforcement tiers (warning mode + baseline)

**Files:** Create `doc/.vale.ini`, `doc/.vale/styles/Capy/{Terminology,NoFluff,SentenceLength,PartHeadings,SimpleTense}.yml`;
create `doc/lint/doc-lint.mjs` and `doc/lint/baseline.json`; modify `.github/workflows/ci.yml`.

Enforcement has three tiers (Style Guide Part F.0): **gate** (blocks merge), **warning**
(flags for review), **review** (PR checklist). This task installs the machinery for all
three but runs every automated check **non-blocking at first** — the un-cleaned docs would
otherwise turn CI red across the board. Gates are promoted per phase (see
schedule below). Of the 30 style-guide rules: ~12 are gate-able, ~9 run as warnings, ~9 stay
on the PR checklist.

- [ ] **Step 1:** Create the Vale rule files from Style Guide Part F (Terminology, NoFluff,
  SentenceLength) plus two trivial adds: `PartHeadings` (regex `^==+\s+Part\s+\d+` → rule A7)
  and `SimpleTense` (existence: "will ", "has been" → rule C4).
- [ ] **Step 2:** Write `doc/lint/doc-lint.mjs` — the ~50-line structural linter for the
  gates Vale cannot express. It checks:
  - **A1** — every page under `pages/` declares `:page-mode:`
  - **A6** — `quick-start` is within the first 3 nav entries
  - **B2** — no `[source,cpp]` block holds raw code (must be `include::example$…` or carry a
    `role=pseudocode`/`role=external`)
  - **D2** — every tutorial/concept page has ≥1 `include::example$`
  Emit findings as JSON; exit 0 while in warning mode.
- [ ] **Step 3:** Add the accessibility contrast check (rule E4): build the site, run
  `pa11y-ci` (or `axe`) against the output with contrast rules enabled.
- [ ] **Step 4:** Add the **reference-surface gates** — (a) the **MrDocs build must emit no
  warnings** (undocumented parameters, mismatched `@param` names, unresolved references);
  (b) **Vale runs over docstring prose** extracted from `include/boost/capy/**`, not only the
  `.adoc` pages. (Docstring `@code` compilation is deliberately *not* here — see Task 5.)
- [ ] **Step 5:** Wire all automated checks into the CI doc job **non-blocking**
  (`continue-on-error: true`): `vale` (adoc + docstrings), `node doc/lint/doc-lint.mjs`, the
  a11y scan, and the MrDocs no-warnings check. The existing **snippet-compile job stays a
  hard gate** — it is the accuracy tier for `.adoc` example code (B2/B3/D2 correctness).
- [ ] **Step 6:** Snapshot current violations to `doc/lint/baseline.json` so CI can gate
  "no *new* violations" while the backlog is worked down.
- [ ] **Step 7:** Decide the guide's permanent home (recommend `doc/CONTRIBUTING-docs.md` or
  a contributing page) and move it there; keep a single terminology source (Style Guide C.1).
- [ ] **Step 8:** Commit: `docs: add style guide + enforcement tooling (warning mode)`.

**Acceptance:** CI runs Vale (adoc + docstrings) + doc-lint + a11y + MrDocs-no-warnings and
reports findings **without** failing the build; introducing a *new* banned word ("utilize")
or an undocumented `@param` fails the no-new-violations check; the snippet-compile job still
hard-fails on a broken `.adoc` example.

**Gate-promotion schedule.** A rule flips from warning → hard gate at the exit of the phase
that cleans it (a `continue-on-error: false` change + baseline reset):

| Promote at end of | Rules that become blocking gates |
|---|---|
| Phase 1 (Structure) | A1, A6, A7, B2, D2 |
| Phase 2 (Accuracy)  | MrDocs-no-warnings (B3 already gated via the compile job); E4 stays Review tier — theme-controlled, not Capy-fixable, same as E2 |
| Phase 4 (Wording)   | C2, C4, C9, C10 (over both `.adoc` and docstrings) |

### Task 3: Audit `cpp:`-macro / reference-link coverage (finding #7)

**Files:** produce `doc-xref-gaps.md`.

- [ ] **Step 1:** Grep exposition pages for hand-typed signatures that should be `cpp:`
  links: `grep -rnE '\b(run_async|task<|io_task|thread_pool|strand)\b' doc/modules/ROOT/pages | grep -v 'cpp:'`
- [ ] **Step 2:** Confirm the `cpp:` macro resolves in a build (pick one page, convert one
  signature, `npx antora` build, verify the link renders to the reference).
- [ ] **Step 3:** Record gap count per page in `doc-xref-gaps.md` (feeds Phase 1).
- [ ] **Step 4:** Commit the audit.

### Task 4: Harden the documentation prompt collection

**Files:** `doc-prompts/*.md` (`doc-write`, `doc-fix`, `doc-sync`, `doc-audit`, `README`).
No repo docs change in this task.

The `doc-prompts/` collection is the generation/repair engine for Phases 1–4. Prove it
against real inputs and wire it to the sub-agent harness before relying on it.

- [ ] **Step 1:** Dry-run `doc-audit` on three representative pages (a tutorial, a
  reference-heavy exposition page, a design essay). Confirm findings cite real verbatim
  spans and map to the five axes; tune the noise floor if it over- or under-reports.
- [ ] **Step 2:** Dry-run `doc-sync` on a recent public-header diff (e.g. the `run_async`
  brief or a TLS commit). Confirm it locates the stale spans — **including the changed
  symbol's own docstring** — and grounds each edit in the **new** declaration.
- [ ] **Step 3:** Dry-run `doc-write` on one small symbol. Confirm it grounds claims in the
  fact sheet, sources the example from a compiled snippet, and links the reference via `cpp:`.
- [ ] **Step 4 (reference mode):** Extend each tool for the reference surface — Step 0
  inventory includes `include/boost/capy/**` docstrings; `doc-audit` gains a reference mode
  (fixed Diátaxis mode = reference; axes remap to the docstring contract: brief/`@param`/
  `@return`/`@throws`/thread-safety/template-constraint completeness, docstring↔code accuracy,
  MrDocs render check); `doc-sync` treats the changed symbol's co-located docstring as
  drift-hit #1; `doc-write`/`doc-fix` accept a header `target_file`. Align with the
  `boost-docs` skill.
- [ ] **Step 5:** Wire the tools to the sub-agent harness (the mechanism his `code-review.md`
  uses); confirm raw code/prose never enters the main context.
- [ ] **Step 6:** Commit: `docs: harden documentation prompt collection`.

**Acceptance:** each tool runs end-to-end on a real input (a page **and** a docstring) and
returns valid typed records; a known-stale page is flagged by `doc-audit`; a known code
drift — including a stale `@param` — is caught by `doc-sync`.

### Task 5: Research — gating docstring `@code` examples

**Files:** produce `doc/lint/RESEARCH-docstring-examples.md`. No code change.

The `@par Example` / `@code` blocks in header docstrings are hand-typed and compiled by
**no** gate today (the snippet-compile job covers only the `.adoc` pages). Research how to
bring them under a compile gate. **The outcome may be to defer implementation** — this task
produces a recommendation, not necessarily a gate.

- [ ] **Step 1:** Enumerate options — (a) MrDocs `@snippet`/include directive pulling from a
  compiled `test/doc/` source; (b) a preprocessor that extracts `@code` blocks into a
  generated TU compiled in CI; (c) rely on `doc-sync` to catch drift at change-time with no
  standing gate; (d) any MrDocs-native example verification, if the current version supports it.
- [ ] **Step 2:** For each, note feasibility against the pinned MrDocs version, effort, and
  whether it round-trips cleanly into the rendered reference.
- [ ] **Step 3:** Recommend one — or recommend **defer** — with the decision and rationale
  written to the research doc.
- [ ] **Step 4:** Commit: `docs: research docstring @code example gating`.

**Acceptance:** a written recommendation with the options evaluated and a clear go/defer
decision. Any implementation is a separate follow-up, out of this plan's Phase 0.

---

## Phase 1 — Capy: Structure (macro)

Work the worklist rows tagged `structure`. Template per row below; worked examples first.
For each page touched, the **docstrings of the symbols it documents** get the same Structure
pass (contract shape); those edits land in the `.hpp`.

### Task 6 (worked example): Relocate `8i.echo-server-corosio` out of Capy (finding #19)

**Files:** Delete `doc/modules/ROOT/pages/8.examples/8i.echo-server-corosio.adoc`; modify
`doc/modules/ROOT/nav.adoc`; move content to the Corosio examples in Phase 5.

- [ ] **Step 1:** Move the page's compiled snippet source to Corosio's `example/` tree
  (or note it for Phase 5 if Corosio isn't checked out).
- [ ] **Step 2:** Remove the nav entry and the page; `grep -rn "8i.echo-server-corosio" doc`
  to find and fix inbound xrefs.
- [ ] **Step 3:** `cd doc && npx antora --fetch local-playbook.yml` → **zero broken xrefs**.
- [ ] **Step 4:** Commit: `docs: move corosio echo-server example to Corosio (#19)`.

**Acceptance:** build clean, no dangling xref, example lives with Corosio.

### Task 7 (worked example): Consolidate rationale placement (finding #10)

**Files:** `doc/modules/ROOT/pages/9.design/*`, `A.specification-methods/*`, target pages.

- [ ] **Step 1:** In the worklist, classify each `9.design`/`A.specification-methods` page as
  *cross-cutting* (stays in Explanation) or *local* (moves to an admonition on the relevant
  how-to/tutorial page) per Style Guide A3.
- [ ] **Step 2:** Move one local-rationale block into a `[NOTE]` on its home page; leave an
  xref stub if inbound links exist.
- [ ] **Step 3:** Build clean; `vale` clean.
- [ ] **Step 4:** Commit per page moved.

### Task 8 (template): flatten "Part N" headings (finding #11) & fix ordering (finding #12)

**Files:** `4.coroutines/4e.cancellation.adoc` (Part 1–9), `2.cpp20-coroutines/*`.

- [ ] **Step 1:** Replace `== Part N: X` with `== X` descriptive headings; drop the "Part"
  ceremony (Style Guide A7). For a one-paragraph "Part", fold it into a sibling section.
- [ ] **Step 2:** Verify no section depends on a concept introduced later (A5); reorder if so.
- [ ] **Step 3:** Build clean; commit.

> **Remaining Phase-1 rows** (from worklist): findings #1 (exposition-replicates-reference —
> per page, apply Style Guide B1/A2), #13/#14 (Corosio → Phase 5). Each is one task using the
> Task 7/8 template: reclassify → edit → build → `vale` → commit.

- [ ] **Phase 1 exit — promote gates:** flip A1, A6, A7, B2, D2 to blocking
  (`continue-on-error: false`), reset `doc/lint/baseline.json`, confirm CI is green.

---

## Phase 2 — Capy: Accuracy

Reference is central to this phase: `doc-sync` sweeps **docstring ↔ code** accuracy for the
symbols in scope, and the MrDocs no-warnings gate is promoted at phase exit. Reference and
exposition accuracy are fixed together, not in separate tracks.

### Task 9 (worked example): Fix `run_async` reference brief (finding #3)

**Files:** `include/boost/capy/ex/run_async.hpp:460,500,545,591,628,656,686,710,732,757…`
(this is a **docstring** fix — reference surface).

- [ ] **Step 1:** Replace the brief "Asynchronously launch a lazy task on the given
  executor" — `run_async` returns a launcher and takes **no** task. Rewrite per Style Guide
  B4, e.g.: `/** Bind an executor (and options) to produce a launcher; invoke the launcher
  with a task to start it. */` Keep wording consistent across all overloads (C10).
- [ ] **Step 2:** Rebuild the MrDocs reference (`doc/mrdocs.yml` pipeline); confirm the new
  brief renders **and MrDocs emits no warnings** for these symbols.
- [ ] **Step 3:** Expand the two-call **warning admonition** (findings #3, Gennaro/Rainer):
  add the *preconstructed-task* case and the *wrapper-function* case; link the Frame
  Allocators page for rationale (Style Guide D3).
- [ ] **Step 4:** Build clean; `vale` clean; commit: `docs: correct run_async brief and expand two-call warning (#3)`.

**Acceptance:** reference brief no longer claims a task argument; warning lists ≥3 dangerous
patterns with rationale link; MrDocs clean for the symbol.

> **Remaining Phase-2 rows:** #17 (UDP text → Phase 5), #9 residual TLS-warning mirroring in
> tutorials, #16 executor-affinity docs, #21/#22 (io_result / buffer-concept specs).
> Template = Task 9: fix → rebuild reference → verify → commit. Docstring-surface rows run
> the same template against the `.hpp`.

- [ ] **Phase 2 exit — promote gates:** flip MrDocs-no-warnings to blocking; confirm CI green.
  (E4 stays Review tier — a11y contrast findings were all shared-theme nav chrome, not
  Capy-fixable, consistent with E2's demotion.)

---

## Phase 3 — Capy: Completeness & Pedagogy (human-led)

> These tasks need judgment and must not be run unsupervised (the review's core warning).
> Use Alan's "fresh agent, no session context" technique to draft explanations, then a human
> reviews. Each task is still gated by build + `vale`. Docstring completeness (every
> `@param`/`@return`/`@throws` present) is part of this phase for the symbols in scope.

### Task 10 (worked example): Add a runnable example to the `task<T>` page (finding #5, D2)

**Files:** `4.coroutines/4a.tasks.adoc`; new compiled source `test/doc/snippets/tasks_run.cpp`.

- [ ] **Step 1:** Write a minimal compiled snippet that *runs* a `task<T>` (e.g. via
  `run_blocking` or `run_async` inline) with an assertion on the result; tag a region.
- [ ] **Step 2:** `include::example$snippets/tasks_run.cpp[tag=run]` in the page, replacing
  any hand-typed block (B2).
- [ ] **Step 3:** Build the snippet target → compiles & passes; `npx antora` → renders.
- [ ] **Step 4:** Commit: `docs: give the task page a runnable example (#5)`.

**Acceptance:** the page a reader lands on to learn `task` now shows a task actually running,
and the snippet is compiled in CI.

> **Remaining Phase-3 rows:** #5 across other concept pages (IoAwaitable, executors,
> allocators), #12 (balance coroutine-intro depth: expand symmetric transfer, trim threads),
> #28 callback-interop examples, #29 GUI example, #30 platform-issues page; plus docstring
> completeness for changed symbols. Template = Task 10.

---

## Phase 4 — Capy: Wording (STE pass, last)

### Task 11 (template): STE/Vale cleanup, page by page (and docstrings)

**Files:** each surviving page, in worklist order, **and the docstrings of the symbols it
documents**.

- [ ] **Step 1:** Run `vale` on the page **and** its symbols' docstrings; fix every finding:
  split long sentences (C1/C2), remove unnecessary negatives (C5), cut fluff/clichés (C6/C9),
  apply terminology (C10).
- [ ] **Step 2:** Build clean; re-run `vale` → clean at warning level for that page and its
  docstrings.
- [ ] **Step 3:** Commit per page: `docs: STE wording pass on <page>`.

> Wording is last on purpose — never polish prose on a page or docstring that Phase 1–3 might
> delete or rewrite.

- [ ] **Phase 4 exit — promote gates:** flip C2, C4, C9, C10 to blocking (over both `.adoc`
  and docstrings); reset `doc/lint/baseline.json` to empty (backlog cleared); confirm CI green.

---

## Phase 5 — Corosio (same playbook)

Repeat Phases 0–4 against Corosio (both surfaces), driven by its worklist rows.
Highest-value, verified-open Corosio items:

- **Structure:** collapse the three-tier duplication — delete/merge `4.guide/4a.tcp-networking`
  (duplicates the Networking Tutorial) and relocate `4.guide/4b.concurrent-programming`
  (Capy content) (finding #4); move Quick Start to the top of nav (finding #14); regroup the
  Reference by functionality, document operators with their types, separate sync/async
  (finding #13).
- **Accuracy:** mirror the TLS "not-wired-up" warning into `3.tutorials/3b.http-client`
  (finding #9); correct the UDP fragmentation text to state guaranteed-reassembly limits
  (finding #17); docstring↔code sweep via `doc-sync`.
- **Completeness:** document executor affinity (finding #16); glossary A–Z nav table + the
  missing coroutine terms (finding #23).
- **Presentation:** dark-mode contrast check (finding #27).
- **Already done — verify only:** #24 (signal/resolver overview prose), #25 (note placement).

Each is one task on the Task 6/7/9/10/11 templates.

---

## Self-review checklist (run before handing off each phase)
- [ ] Every still-open finding in DOC_REVIEW_FEEDBACK.md maps to a worklist row and a task.
- [ ] Both surfaces covered: for each symbol in scope, its docstring got the same axis pass
      as the `.adoc` (reference woven in, not deferred).
- [ ] No task hand-types a signature or pastes code in exposition (Style Guide B1/B2).
- [ ] Every task ends with build-clean + `vale`-clean + commit.
- [ ] Wording (Phase 4) runs only after structure/accuracy/completeness on that page.

## Execution options
1. **Subagent-driven (recommended):** fresh subagent per task, human review between tasks —
   fits the "human in the loop, no unsupervised drift" mandate.
2. **Inline execution:** batch with checkpoints via `superpowers:executing-plans`.

# Rationale Placement Classification (Style Guide A3)

**Purpose:** Task 7 (finding #10) worked example. Classifies every page under
`doc/modules/ROOT/pages/9.design/` and `doc/modules/ROOT/pages/A.specification-methods/`
as *cross-cutting* (rationale stays on its dedicated Explanation page), *local* (rationale
belongs in an admonition on a specific how-to/tutorial page), or *landing* (nav-only intro
page, not audited). Method: `doc-prompts/doc-audit.md` Step-1 structure axis, applying
Style Guide A3 by hand (this classification is a manual application of the rule, not a
sub-agent JSON pipeline run).

**Legend:** `verdict` — `cross-cutting` | `local` | `landing`. `home` — the how-to/tutorial
page the local rationale belongs on (only set when `verdict=local`).

| page | verdict | home | reason |
|---|---|---|---|
| `9.design/9.intro.adoc` | landing | — | Nav-only landing page for the Design section; no prose to classify. |
| `9.design/9a.CapyLayering.adoc` | cross-cutting | — | Whole-library layering essay (concepts / type-erased wrappers / `task<>` type erasure / compilation-boundary economics / symmetric transfer). Spans every abstraction layer in the library; no single tutorial owns this scope. |
| `9.design/9b.Separation.adoc` | cross-cutting | — | Capy-vs-Corosio physical-design essay (Lakos levelization, CCD, Ousterhout deep modules). By definition cross-cutting — it argues about the boundary between two libraries, not one page's mechanism. |
| `9.design/9c.ReadStream.adoc` | cross-cutting | — | The "Design Foundations: Why a Full Buffer Is Always Success" rationale (full-buffer-is-success, EOF-as-error, canonical advance-then-check loop, the conforming-sources survey across TCP/TLS/HTTP/QUIC/compression/memory/mock streams) justifies a contract consumed by every concrete stream and by composed algorithms (`read`, `when_all`, `when_any`) — not local to one tutorial. *Note (out of scope for A3, flagged for a follow-on Structure/A2 pass): this page also restates definitions/semantics that `6.streams/6b.streams.adoc` already teaches — a duplication concern, not a rationale-placement one.* |
| `9.design/9f.WriteStream.adoc` | cross-cutting | — | Same reasoning as 9c: "Buffer Top-Up: Why `write_some` Can Outperform `write_now`" is the general throughput-vs-convenience trade-off behind the primitive, with no single how-to page that teaches `write_now`/buffer top-up elsewhere to serve as its "home." Same duplication note vs `6b.streams.adoc` as above, same out-of-scope caveat. |
| `9.design/9i.TypeEraseAwaitable.adoc` | cross-cutting | — | vtable-layout rationale (flat vs per-construct-ops, cache-line analysis) spans all `any_*` wrapper types (`any_read_stream`, `any_write_stream`, `any_read_source`, `any_buffer_source`, `any_buffer_sink`, `any_write_sink`). Genuine cross-cutting design essay. |
| `9.design/9k.Executor.adoc` | **mixed** — page overall cross-cutting; **one section was local** | `4.coroutines/4g.allocators.adoc` (`TLS Preservation`) | The page as a whole (Asio comparison, `dispatch`/`post`/`defer` rationale, `continuation`/`executor_ref` design, P2300 comparison) is a genuine cross-cutting Executor-concept essay and stays. Its **"Frame Allocator Preservation" section** (former lines 275–300: "The Save/Restore Protocol" + "Where It Applies") was local rationale about one specific mechanism (`safe_resume`'s TLS save/restore around `.resume()`) that is already taught as a how-to on `4g.allocators.adoc`'s "TLS Preservation" section — a duplicate parallel rationale channel for the same material, forbidden by A3. **This is the block moved in this task** (see below). |
| `9.design/9l.RunApi.adoc` | cross-cutting | — | Two-phase-invocation rationale, naming alternatives considered (builder pattern, single-call, named method), P4003/P2300 comparison. This *is* the dedicated home for `run`/`run_async` rationale — `9k.Executor.adoc` itself xrefs here rather than duplicating. Correctly placed already. |
| `9.design/9m.WhyNotCobalt.adoc` | cross-cutting | — | Whole-library comparison essay (11 sections: streams, type erasure, mock streams, threading, context propagation, cancellation, buffers, allocators, platform separation, coroutine overhead). Textbook cross-cutting. |
| `9.design/9n.WhyNotCobaltConcepts.adoc` | cross-cutting | — | Side-by-side design analysis of Capy's vs. Cobalt's write-stream abstraction (task requirements, context propagation, buffers, semantic specification, allocation, concept-vs-ABC). Comparative essay against another library — cross-cutting by construction. |
| `9.design/9o.WhyNotTMC.adoc` | cross-cutting | — | Whole-library comparison essay (Capy vs. TooManyCooks) helping readers choose between two libraries. Cross-cutting by construction. |
| `A.specification-methods/A.intro.adoc` | landing | — | Nav-only landing page ("Methods of API Description... in the following Reference section"); no rationale to classify. |
| `A.specification-methods/Ab.cancellation.adoc` | cross-cutting | — | Defines the term "supports IoAwaitable cancellation" used to describe conformance across the entire generated Reference section, not one tutorial's mechanism. Terminology backing many reference entries, not a single how-to page. |
| `A.specification-methods/Ac.contingencies.adoc` | cross-cutting | — | Defines "contingency" and the `io_result` destructuring convention (`[ec, n]`) used across every stream operation's specification in the Reference. Foundational vocabulary for the whole API-description methodology, not local to one page. |

## Counts

- Cross-cutting: 10 pages fully cross-cutting, plus 1 page (`9k.Executor.adoc`) cross-cutting
  overall with exactly one local section.
- Local: **1 rationale block found** (within `9k.Executor.adoc`), moved in this task.
- Landing: 2 (`9.intro.adoc`, `A.intro.adoc`).

Most `9x.WhyNot*`/comparison essays and the two `A.specification-methods` glossary-style
pages are cross-cutting, matching the brief's expectation. The corpus is overwhelmingly
already A3-compliant: `9.design`/`A.specification-methods` pages are, by and large,
legitimately dedicated Explanation pages rather than a channel duplicating some how-to
page's local mechanism. The one clear exception — `9k.Executor.adoc`'s "Frame Allocator
Preservation" section duplicating `4g.allocators.adoc`'s "TLS Preservation" section — is
the block relocated below.

## The one move performed

**Source:** `doc/modules/ROOT/pages/9.design/9k.Executor.adoc`, former "Frame Allocator
Preservation" section (heading + "The Save/Restore Protocol" + "Where It Applies"
subsections).

**Destination:** `doc/modules/ROOT/pages/4.coroutines/4g.allocators.adoc`, inside the
existing "TLS Preservation" section, as a `[NOTE]` admonition block immediately after the
existing `safe_resume` usage paragraph.

**What moved verbatim:** the `safe_resume` implementation code include
(`9k_executor.cpp[tag=safe_resume]` — the *definition*, distinct from `4g.allocators.adoc`'s
existing `4g_allocators.cpp[tag=safe_resume]` include, which shows *usage*), the TLS-stack
explanation and per-call cost sentence, and the two-call-sites-exempt list
(`symmetric_transfer`, `run_async_wrapper::operator()`) verbatim.

**What was intentionally not carried over (and why):** two lead-in sentences from `9k`
("Capy propagates frame allocators via thread-local storage...", "If that user code
resumes a coroutine from a different chain...") and one summary sentence ("All executor
event loops and strand dispatch loops must use `safe_resume`...") were near-verbatim
restatements of sentences already present one paragraph above the insertion point on
`4g.allocators.adoc` (same page, adjacent). Pasting them again immediately below their own
twins would itself be the parallel-rationale-channel problem A3 forbids, just intra-page
instead of inter-page. Everything else moved is genuinely new information at the
destination. The `=== The Save/Restore Protocol` / `=== Where It Applies` sub-headings
were flattened to plain paragraphs because AsciiDoc section headings cannot nest inside a
delimited admonition block — a structural necessity, not a wording edit.

**Xref stub left at the source:** `9k.Executor.adoc` now has, in place of the removed
section, a one-line pointer:
`NOTE: For the TLS save/restore protocol required around .resume() calls (safe_resume) --
including which two call sites are deliberately exempt -- see
xref:../4.coroutines/4g.allocators.adoc#_tls_preservation[TLS Preservation].`
No page held an inbound xref to the old section (it had no `[[anchor]]`, and grepping the
whole `doc/` tree for `9k.Executor` turns up only `nav.adoc`'s whole-page link and
`9l.RunApi.adoc`'s and `9m.WhyNotCobalt.adoc`'s whole-page links elsewhere — none target
this section specifically), so the stub is precautionary for reader continuity, not a
required broken-link fix.

**Source-page fragment risk:** none. `9k.Executor.adoc` was 332 lines before the edit and
remains a substantial, complete page (Definition, Relationship to Asio, dispatch/post
rationale, `continuation` design, nothrow-copy rationale, work-tracking, `executor_ref`
design, I/O completion pattern, P2300 comparison, Summary) — it is nowhere close to empty
or a fragment.

## Verification

**Build:** `cd doc && BOOST_SRC_DIR=/home/michael/git/boost npx antora --fetch
local-playbook.yml` — exit 0, zero matches for `broken`/`target of xref not found`, and the
moved-in `xref:../4.coroutines/4g.allocators.adoc#_tls_preservation[...]` resolves to a
real anchor in the rendered HTML (`build/site/capy/4.coroutines/4g.allocators.html`,
`<h2 id="_tls_preservation">`).

**Vale:** `vale sync && vale --output=JSON` on the two touched pages, cross-checked with
`node doc/lint/check-no-new-violations.mjs` (the repo's own baseline-diff gate). Raw
line-fingerprint diff reports ~55 "new" findings on the two files, but a content-based
comparison (Check + Match text, ignoring line number) against the pre-edit versions shows
this is almost entirely a line-shift artifact of the line-based fingerprint scheme, not new
prose problems:

- `9k.Executor.adoc`: **0 findings added** by content; 7 findings *removed* (the deleted
  section's own pre-existing violations went away with it).
- `4g.allocators.adoc`: **0 findings added** by content, after a Fix-round-1 pass trimmed
  the NOTE's intra-page duplication (see below) and swapped one leftover `--` for a comma.
  An earlier draft of the moved NOTE briefly reintroduced 2 findings by content — 1×
  `Google.EmDash` and 1× `Vale.Spelling` ("coroutine") — both pre-existing, massively
  backlogged patterns already present dozens of times on this exact page and thousands of
  times across the corpus (Vale's dictionary doesn't recognize "coroutine"; the codebase's
  house style uses ASCII `--` for em dashes, which `Google.EmDash` doesn't recognize as
  one). This was not a new class of problem — the same two already-backlogged violations
  reappearing on relocated text — but Fix round 1 removed it anyway once the redundant
  sentences it lived in were trimmed.
- One genuinely new finding was caught and fixed during this task: my own newly-authored
  xref stub sentence on `9k.Executor.adoc` originally used `--` for a parenthetical, which
  is a real net-new `Google.EmDash` occurrence (new authored text, not moved). Reworded to
  use commas instead, eliminating it before commit.
- `vale_docstrings`, `doc_lint`, `mrdocs_warnings`, `a11y`: 0 new findings (unaffected —
  no headers or nav/lint-script-checked structure touched).

(Note: even a from-`develop`, unedited checkout reports 7 "new" `Vale.Spelling` findings on
`modules/ROOT/nav.adoc` under this same baseline-diff tool — confirmed by stashing this
task's edits and re-running. That drift is pre-existing and unrelated to this task.)

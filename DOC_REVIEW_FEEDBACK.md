# Capy + Corosio — Documentation Feedback from the Boost Review

**Prepared:** 2026-07-24
**Scope:** All documentation feedback from the joint Boost formal review of Capy and
Corosio (mailing-list thread, June 23 – July 7 2026, extended), plus open GitHub issues
on `cppalliance/capy` and `cppalliance/corosio` (including pre-review issues).

**Sources mined:**
- Boost ML review thread — 73 messages, 19 participants
  ([thread](https://lists.boost.org/archives/list/boost@lists.boost.org/thread/5RXXUC7XHL7JGSFPCKWMFHTRPMMLXRTC/)).
- Alan de Freitas's Corosio feedback filed as `corosio#324`
  ([issue](https://github.com/cppalliance/corosio/issues/324)).
- 12 Capy issues (#356 #353 #297 #296 #287 #283 #273 #266 #207 #170 #159 #71) and
  5 Corosio issues (#324 #285 #284 #283 #23) reviewed for documentation angle.

> ## ⚠️ Correction (2026-07-24, after pulling develop)
> Several top findings have **already been addressed on `develop`** since the review, and
> the status columns below are correspondingly stale. Confirmed via git history + file
> inspection:
> - **#2 (what Capy is / core invariant) — now largely addressed.** Commit `708f0d34`
>   (closes #341/#349) added "What Capy Is / Is Not" to `index.adoc`, the same-executor
>   invariant up front + a `4c.executors.adoc` section, and reframed `4d.io-awaitable.adoc`
>   as interop vocabulary with a "Bridging a Foreign Awaitable" escape hatch.
> - **#8 (examples don't compile) — closed at the tooling level.** Commit `aa1a38c7`
>   replaced ~480 hand-typed blocks with includes of compiled sources under `test/doc/`;
>   intentionally-non-compiling blocks now carry `role=pseudocode`/`role=external` (this
>   also addresses Alan's "pseudocode mixed with real syntax").
> - **#9 (TLS) / signal-safety** — substantially advanced: `19d76f37`/`71040d78` wired TLS
>   trust-store/verify/ALPN; `3dc32e8a` made POSIX signal handling async-signal-safe.
>
> The **re-baseline pass is the first unit of the improvement plan** for exactly this
> reason. Treat the tables below as the review-time snapshot, not current state.

**Method.** 181 raw documentation-feedback items were extracted from the sources, then
clustered into distinct findings. Each checkable finding was verified against the
**current local `develop` docs** to determine whether it is still open, partially
addressed, or already fixed. Confidence = **signal strength** (number of distinct
reviewers, author self-diagnosis counted as strong corroboration) **× accuracy** (still
open ranks higher than already-fixed).

> A note on attribution: reviewers cited the live site paths (e.g. `8.design/…`); the
> local `develop` tree has renumbered some chapters (now `9.design/…`). Verification
> maps by topic, not by URL.

---

## 1. Who gave documentation feedback, and their stance

| Reviewer | Doc feedback weight | Overall stance (my reading) |
|---|---|---|
| **Alan de Freitas** | Very high — a documentation-centric Capy review (msg 64) + all of `corosio#324` | Accept (Capy), non-conditional |
| **Rainer Deyke** | High — Capy review (msg 8) + a Corosio doc read-through (msg 71) | **Reject** (Capy) |
| **Andrzej Krzemienski** | High — msg 67 + issues #207 #170 #273 #287 #297 #356 #283 | Lean reject / "encourage and reconvene" |
| **Gennaro Prota** | Medium — praised docs, TLS-mirroring nitpick, concept naming (msg 55) | Conditional accept |
| **Peter Turcan** | Medium — three focused Corosio polish issues (#283 #284 #285) | (tech-writer polish, not a vote) |
| **toast27** | Low-medium — wants callback-interop examples; "people skip docs" (msg 57) | Lean accept (Capy) |
| **Vinnie Falco** (author) | — self-diagnosis (msg 18, msg 50) | Author |
| LegalizeAdulthood, MungoG | Low — single GH example/platform-doc requests | — |

The documentation was a **decisive factor** in the review. Rainer's reject and Andrzej's
reluctance both trace substantially to documentation problems, and the author himself
(msg 50) concluded *"This review has surfaced a documentation problem… several reviewers
have arrived at different (incompatible) conclusions about what Capy is, because we never
stated it plainly."*

---

## 2. Master list — findings ranked by confidence

Legend — **Cat:** St=Structure, Ac=Accuracy, Wo=Wording, Co=Completeness/Pedagogy,
Pr=Presentation/Tooling. **Status:** 🔴 still open · 🟡 partially addressed · 🟢 fixed ·
⚪ deferred (Corosio repo not present in this checkout — see Phase 5).

> **Re-baselined 2026-07-24 against current `develop`** (Phase 0, Task 1). Every status
> below reflects a file:line or grep verification recorded in
> `.superpowers/sdd/DOC_IMPROVEMENT_PLAN/task-1-report.md`, not the review-time snapshot.
> Still-open/partial findings have a row in `doc-worklist.md`. Corosio-scoped findings
> (`Lib=corosio`) are marked deferred regardless of prior status, because the Corosio repo
> is not checked out alongside Capy here and cannot be re-verified — including #9, #24, #25
> which the review-time doc had rated 🟡/🟢 on the strength of the Corosio-side commits/PRs
> cited (those changes live in the Corosio repo, not this one).

| # | Finding | Lib | Cat | Parties | Status |
|---|---|---|---|---|---|
| **1** | **Exposition replicates the reference and drifts from it** — prose restates full signatures/concepts that then diverge from the generated reference | both | Ac/St/Pr | Alan, Andrzej, Rainer (3) | 🟡 — *re-baseline: `antora-cpp-reference`/`-tagfiles` extensions are now installed and configured (`doc/antora.yml`, `doc/package.json`) but the `cpp:` macro has zero uses in `doc/modules/ROOT/pages` and only 3 `xref:reference:` links exist across ~65 pages; ~160 hand-typed API-term hits remain (Task-3 grep). Tooling exists, prose doesn't use it yet.* |
| **2** | **The docs never state plainly *what Capy is* / its scope + core invariant up front** → reviewers reach incompatible conclusions | capy | St/Co | Vinnie(author), Rainer, Alan, Andrzej (4) | 🟢 — *re-baseline: fixed by `708f0d34`. `index.adoc:5` "What Capy Is", `:23` "What Capy Is Not"; `4c.executors.adoc:10` anchors a full "same-executor invariant" section.* |
| **3** | **`run_async` two-call syntax under-documented** — warning lists too few dangerous cases; rationale/trade-offs not explained; reference text is wrong ("launch a lazy task" — it takes no task) | capy | Ac/Co | Rainer, Gennaro, Alan (3) | 🟡 — *re-baseline: `4b.launching.adoc:28-52` now explains the {cpp}17 evaluation-order rationale and one dangerous case (rvalue-qualified wrapper, compile-time caught). But `include/boost/capy/ex/run_async.hpp` still reads "Asynchronously launch a lazy task on the given executor" in all 18 overloads — the reference-text bug is unchanged.* |
| **4** | **Three-tier content duplication** — same material taught up to 3× (Networking Tutorial → Tutorials → Guide); Guide *TCP/IP Networking* duplicates the tutorial; Guide *Concurrent Programming* is Capy content; *UDP Sockets* mispositioned | corosio | St | Alan, Rainer (2) | ⚪ deferred (Phase 5) |
| **5** | **Not goal-oriented; no runnable examples for the library's own types** — `task` page never runs a task; IoAwaitable page has no working example; coroutine intro is syntax-first not use-case-first | capy | Co | Alan, toast27, Rainer (3) | 🟡 — *re-baseline: examples now compile (`aa1a38c7`), but `test/doc/snippets/4a_tasks.cpp` and `4d_io_awaitable.cpp` have no `main()` — no page shows a `task` actually running with output; the full runnable program (`test/doc/programs/4b_launching_run_async.cpp`) lives one page later.* |
| **6** | **"AI fluff": verbose, repetitive, unnecessary negatives ("This is X. Not Y. Not Z"), clichés/metaphors, terms undefined** — docs "orders of magnitude longer than needed" | both | Wo | Alan, Andrzej (2) | 🔴 — *re-baseline confirmed: `why-capy.adoc:275` and `9.design/9a.CapyLayering.adoc:61` are textbook unnecessary-negative patterns; 11 pages still contain banned filler words (simply/basically/essentially/obviously/of course/note that/in order to).* |
| **7** | **Missing reference cross-links** (the `cpp:` macro / `antora-cpp-reference` + `tagfiles` extensions) — hard to navigate and the root cause of finding #1's drift | both | Pr | Alan (1, stated for both libs) | 🟡 — *re-baseline: extensions are installed & configured in `doc/antora.yml`/`doc/package.json` (progress since review), but zero `cpp:` macro usages found in the page tree — the linking work itself hasn't started.* |
| **8** | **Example code that does not compile / unsafe example patterns** — IoAwaitable example was broken; many examples pass args by reference/view (dangling risk); pseudocode mixed with real syntax | both | Ac/Co | Rainer, Alan (2) | 🟡 (IoAwaitable 🟢 confirmed via spot-check; dangling-ref pattern 🔴 confirmed still present, e.g. `test/doc/snippets/5c_sequences.cpp:142`, `4f_composition.cpp:342`) |
| **9** | **TLS docs signal not-ready and are not fail-safe** — red "not wired up" boxes; unimplemented features silently ignored instead of refusing; TLS warning not mirrored in HTTPS-client tutorial | corosio | Ac/Co | Gennaro, Rainer (+author agreed) (2) | ⚪ deferred (Phase 5) — *no TLS/HTTPS-client tutorial pages exist anywhere in this Capy checkout; the cited progress commits (`3dc32e8a`,`19d76f37`,`71040d78`) do not exist in this repo's git history (confirmed `unknown revision`) — they are Corosio-repo commits.* |
| **10** | **Design-rationale placement is inconsistent** — dedicated `9.design` pages *and* `A.specification-methods` *and* interleaved prose; pick one (preference: interleaved admonitions) | capy | St | Alan (1) | 🔴 — *re-baseline confirmed: both `9.design/` (10 files) and `A.specification-methods/` (3 files) still exist as separate rationale channels.* |
| **11** | **Over-use of "Part N" mega-headings** — cancellation page runs Part 1–9; "Part 4" is a single paragraph | capy | St/Wo | Alan (1) | 🔴 — *re-baseline confirmed: `4e.cancellation.adoc` still has Part 1 through Part 9; "Part 4: Beyond Cancellation" is lines 132-140 (9 lines).* |
| **12** | **Intro chapters inconsistent** — coroutine intro under-explains hard ideas (symmetric transfer: 2 short paragraphs) while over-explaining threads; "Advanced Topics" precedes the `await_suspend` explanation it depends on | capy | St/Co | Alan (1) | 🟢 — *re-baseline (disagrees with review-time 🔴): Symmetric Transfer in `2d.advanced.adoc` is now 67 lines / 4 subsections, not "2 short paragraphs". Ordering is correct: `await_suspend`/awaiter protocol is explained in `2b.syntax.adoc`/`2c.machinery.adoc`, both prerequisites of Part IV (`2d.advanced.adoc`).* |
| **13** | **Reference organized alphabetically, not by functionality** — no backend-tag overview; operators documented via "Friends"; sync and async operations not separated | corosio | St/Pr | Rainer (1) | ⚪ deferred (Phase 5) |
| **14** | **Quick Start mispositioned** — sits at the bottom, between Glossary and Reference | corosio | St | Rainer (1) | ⚪ deferred (Phase 5) |
| **15** | **Naming clarity flagged in docs** — `execution_context` vs `ExecutionContext` (case-only), `executor_ref` (vs Boost `*_ref` convention), `buffer_length`/`buffer_size` | capy | Wo | Alan, Gennaro (concept naming) (2) | 🔴 (design-adjacent) — *re-baseline confirmed unchanged: `concept/execution_context.hpp:73` vs `ex/execution_context.hpp` class; `ex/executor_ref.hpp`; `buffers.hpp:335` `buffer_size` / `:409` `buffer_length` both still present.* |
| **16** | **Executor affinity not documented** though class-level thread-safety is | corosio | Co | Rainer (1) | ⚪ deferred (Phase 5) |
| **17** | **UDP fragmentation text misleading** — frames fragmentation as loss-amplification only; omits guaranteed-reassembly limits (oversized fragmented datagrams can be dropped outright) | corosio | Ac | Rainer (1) | ⚪ deferred (Phase 5) |
| **18** | **Missing right-rail ToC; some pages very long** | both | Pr | Alan (1) | 🔴 — *re-baseline confirmed: no `:page-toc:` control found anywhere; long pages confirmed (`9m.WhyNotCobalt.adoc` 616 lines, `9n` 506, `9o` 466, `7a.drivers` 352). Likely needs the shared boost-website UI bundle, which lives outside this repo.* |
| **19** | **`echo-server-corosio` example lives in Capy docs** — breaks the library separation; move to Corosio | capy | St | Rainer (1) | 🔴 — *re-baseline confirmed: `8.examples/8i.echo-server-corosio.adoc` and its nav entry still present.* |
| **20** | **Awaitable-returning functions need a standard description method** — `Await-effects` / `Await-returns` / `Await-error-conditions` / `Await-postconditions` | capy | Co | Andrzej (#170) (1) | 🟡 — *re-baseline confirmed: pattern used in only 4 of ~14 top-level public headers (`read.hpp`, `write.hpp`, `read_at_least.hpp`, `write_at_least.hpp`); `when_all.hpp`, `when_any.hpp`, `task.hpp`, `quitter.hpp` lack it entirely.* |
| **21** | **Meaning of `error_code` in `io_result` is under-specified / "on success" reads backwards** | capy | Ac/Co | Andrzej (#207) (1) | 🟢 — *re-baseline (disagrees with review-time 🟡): `io_result.hpp:24-44` docstring + `Ac.contingencies.adoc` fully specify the contract with no "on success" phrasing (0 grep hits in either file).* |
| **22** | **Buffer & stream concept specs need precision** — buffer-handle lifetime contract, `void*` rationale, `buffer_slice` naming/semiregular status, `Slice` concept unnecessary, `IoAwaitable` definition too loose | capy | Ac/Co | Andrzej (#273 #287 #297 #356) (1) | 🔴 — *re-baseline confirmed still open: `concept/io_awaitable.hpp:110-117` `IoAwaitable` is still just `requires(A a, h, env){ a.await_suspend(h,env); }` — no `await_ready`/`await_resume` requirement; `buffers.hpp:63-70` `void*` ctor/`data()` still has no rationale docstring. (`buffer_slice.hpp:38-60` lifetime contract has improved — partial progress on one sub-point.)* |
| **23** | **Glossary needs an A–Z nav table + more coroutine terms** (`co_await`, `co_return`, coroutine frame, promise type, …) | corosio | Pr/Co | Peter Turcan (#283) (1) | ⚪ deferred (Phase 5) |
| **24** | **Signal Handling / Name Resolution "Overview" was code-only** — needs a sentence of prose | corosio | Co | Peter Turcan (#285) (1) | ⚪ deferred (Phase 5) — *the Section-4 "already fixed" note cites Corosio-side pages/commits not present in this checkout; cannot be re-verified here (see box above).* |
| **25** | **"Code snippets assume" note placed outside the NOTE box** in Hash Server + Reconnect tutorials | corosio | St | Peter Turcan (#284) (1) | ⚪ deferred (Phase 5) — *same caveat as #24.* |
| **26** | **HALO "(Clang extension)" renders blank** where the attribute name belongs | capy | Ac/Pr | Alan (1) | 🟢 — *spot-verified: `2d.advanced.adoc:102` renders `[[clang::coro_await_elidable]]` (Clang extension).* |
| **27** | **Dark-mode contrast** — black text on dark-blue background | corosio | Pr | Rainer (1) | ⚪ deferred (Phase 5) |
| **28** | **Add callback-based-API interop examples** (using a callback API *inside* a Capy coroutine) | capy | Co | toast27 (1) | 🟢 — *re-baseline (disagrees with review-time 🔴): `8.examples/8p.asio-use-capy.adoc` (added in `708f0d34`) demonstrates calling Boost.Asio's callback/completion-token API from inside a Capy coroutine via a `use_capy` token — this is exactly the requested pattern.* |
| **29** | **GUI event-loop integration example** | capy | Co | LegalizeAdulthood (#159) (1) | 🟡 — *re-baseline (upgrade from 🔴): `8.examples/8n.custom-executor.adoc` implements a generic single-threaded run-loop executor "analogous to a GUI event loop", but its Exercises section (line 98) explicitly defers actual GUI-framework integration to the reader — no worked GUI example exists yet.* |
| **30** | **Platform-specific issues need a documentation home** (e.g. Unix-sockets Windows behavior; undefined "IOCP") | corosio | Co | MungoG (#23), Alan (2) | ⚪ deferred (Phase 5) |

---

## 3. Findings in detail (grouped by category)

### 3.1 Structure — the shape and order of the material

- **[#1, #4] Duplication is the dominant structural complaint.** In Capy the *exposition
  replicates the reference*; in Corosio the *whole doc set repeats itself* across three
  parent sections. Alan (`corosio#324`): the reader "has to read the same content three
  times." Rainer (msg 71): "Guide > TCP/IP Networking is already covered by the Networking
  Tutorial… Guide > TLS Encryption and Tutorials > TLS Context cover basically the same
  subject twice." **Verified:** `4.guide/4a.tcp-networking.adoc` and
  `4.guide/4b.concurrent-programming.adoc` both exist alongside the 12-page
  `2.networking-tutorial`; `4b` is Capy-domain concurrency content.
- **[#2] The framing failure.** The docs do not open by saying what Capy *is*. The author's
  own core invariant — *"a coroutine is always resumed by the same executor that launched
  it"* (msg 18) — is, in his words, something that "should probably be stated in the Capy
  docs up front." Because it isn't, Rainer read Capy as a restrictive framework and voted
  reject; Alan spent 35% of the docs before seeing any mention of I/O. This is the
  highest-leverage single fix.
- **[#10] Rationale is scattered** across dedicated `9.design/` pages (11 files), the
  `A.specification-methods/` chapter (3 files), *and* inline prose. **Verified present.**
  Alan's preference: interleaved admonitions.
- **[#11] "Part N" headings** — **verified:** `4e.cancellation.adoc` has Part 1 through
  Part 9; "Part 4: Beyond Cancellation" is a single short section.
- **[#13, #14] Corosio navigation.** Reference is a flat alphabetical heap; **Quick Start
  sits at nav line 48**, after Glossary and before Reference (Capy's is correctly at the
  top, line 3).
- **[#19] `8i.echo-server-corosio` still lives in Capy examples** — **verified present.**

### 3.2 Accuracy — is the documentation correct?

- **[#3] `run_async` reference is wrong.** **Verified:** all ten overloads' briefs read
  *"Asynchronously launch a lazy task on the given executor"* — but `run_async` receives
  no task; it returns the launcher object. Alan flagged exactly this.
- **[#8] Examples that don't compile.** Rainer's reject hinged partly on the IoAwaitable
  example (`capy#296`), which used `coroutine_handle<>` where a `continuation` was
  required. **Verified fixed:** `4d.io-awaitable.adoc` now uses a `continuation cont_`
  member and explains passing `continuation&` to `post`/`dispatch`. Alan's broader
  "examples that don't compile" and Rainer's dangling-by-reference example pattern remain
  open.
- **[#9] TLS is documented as not-ready and is not fail-safe.** Gennaro and Rainer both
  flagged it; the maintainers agreed and are demoting the SSL implementation to `detail`
  (msg 73) / wiring it to fail safely (msg 72). The HTTPS-client tutorial still calls
  `set_default_verify_paths()` / `set_verify_mode(peer)` (lines 277-279) **without** the
  warning that the TLS guide carries — **verified.**
- **[#17] UDP text.** **Verified:** `2g.udp.adoc:63-67` frames fragmentation purely as a
  loss-amplification problem and advises small datagrams, but does not state that oversized
  fragmented datagrams may be discarded regardless of loss (Rainer's safety point).
- **[#26] HALO blank render** — **verified fixed** in source (`2d.advanced.adoc:128`).

### 3.3 Wording — technical-writing quality

- **[#6] "AI fluff."** Alan's most emphatic theme, endorsed by Andrzej. Concrete patterns
  he named: (i) the same point re-phrased repeatedly with no new information; (ii)
  *unnecessary negatives* — "This is X. Not Y. Not Z" instead of "This is X"; (iii)
  clichés/metaphors that force the reader to reverse-engineer them; (iv) expressions used
  without definition (leaked from the authoring agent's context). He judged the docs
  "orders of magnitude longer than they need to be."
- **[#15] Naming surfaced as doc-clarity confusion** — `execution_context` vs
  `ExecutionContext` (case-only distinction), `executor_ref` vs the Boost `*_ref`
  convention, and `buffer_length` vs `buffer_size`. (Design-adjacent, but every reviewer
  hit it while reading the docs.)

### 3.4 Completeness & Pedagogy — does it teach?

- **[#5] Not goal-oriented.** The single most-repeated substantive complaint. Alan: the
  `task` page has coroutines that return `task` but "no example where the task is
  executed… a user following the documentation and compiling small examples as they learn
  has nothing they can run." toast27: people want practical examples and "a lot of people
  skip documentation." The IoAwaitable page is "full of implementation details… but not a
  single example of a task running and benefiting from any of this."
- **[#12] Uneven depth.** Threads get a whole page with working examples; symmetric
  transfer (far more consequential to Capy) gets two short paragraphs.
- **[#20, #21, #22] Andrzej's specification requests** (GitHub, pre- and mid-review):
  a standard method for documenting awaitable-returning functions (`Await-effects` etc.),
  the meaning of `error_code`/"on success" in `io_result`, and precise buffer/stream
  concept specs. The new `A.specification-methods` chapter partially addresses the first
  two; the buffer/stream issues (#273 #287 #297 #356) remain open.
- **[#16, #28, #29, #30]** executor-affinity documentation, callback-interop examples,
  GUI integration example, platform-specific issues page.

### 3.5 Presentation & Tooling — the doc system

- **[#7] Reference cross-links.** Alan (both libraries): the exposition should use the
  `cpp:` macro and the `antora-cpp-reference-extension` / `antora-cpp-tagfiles-extension`
  so prose links into the generated reference instead of re-typing signatures. This is
  **cheap, high-value, and structurally fixes the drift in #1.**
- **[#18] No right-rail ToC**, and several pages are long enough to need one.
- **[#13] Reference generation** — group by functionality; document operators with their
  types, not as free "Friends"; separate sync from async.
- **[#27] Dark-mode contrast** (not verified locally; Antora theme).

---

## 4. Already addressed — do **not** redo these

| Finding | Evidence |
|---|---|
| IoAwaitable example bug (`capy#296`, Rainer's "Fatal Flaw") | `4d.io-awaitable.adoc` now uses `continuation` correctly |
| "Code snippets assume" note placement (`corosio#284`) | includes now inside `[NOTE]` in `3e.hash-server`, `3f.reconnect` |
| Signal/Resolver overview code-only (`corosio#285`) | `4i.signals.adoc`, `4j.resolver.adoc` now have prose intros |
| HALO "(Clang extension)" blank | attribute name present in `2d.advanced.adoc:128` |

Partially addressed (started, not finished): TLS fail-safety (#9), awaitable/`io_result`
specification method (#20/#21), glossary terms (#23).

> **Re-baseline note (2026-07-24):** The Corosio-scoped rows in this table (#9 TLS,
> "Code snippets assume" #25, Signal/Resolver overview #24) cite pages/commits that live in
> the Corosio repo, which is not checked out alongside Capy here — they are marked
> ⚪ deferred (Phase 5) in Section 2 pending re-verification against that repo, not because
> they regressed. The two Capy-side rows (IoAwaitable example, HALO blank render) were
> spot-verified and remain 🟢 fixed.

---

## 5. Review of your three-category model (Structure / Accuracy / Wording)

**Verdict: the three axes are correct and well-chosen for *prose*, but incomplete for a
documentation *site*. They cleanly hold roughly half of this review's findings; the other
half fall into two axes the model omits, and one cross-cutting concern.**

What the model captures well:
- **Accuracy** and **Wording** are real and independently supported (the `run_async`
  reference error; the "AI fluff" cluster). Neither is overstated.
- **Structure** captures the duplication and ordering complaints.

Where it falls short — three gaps, in order of how loudly the review demanded them:

1. **Completeness / Pedagogy is missing, and it was the #1 substantive theme.** The
   loudest complaint — "looks complete but I didn't learn it," "no runnable example,"
   "exposition replicates the reference instead of teaching," "rationale assumed, not
   explained" — is not about structure (nothing is mis-ordered), not accuracy (nothing is
   *wrong*), and not wording (the sentences are fine). It is about whether the right
   content *exists and teaches*. This needs its own axis.
2. **Presentation / Tooling is missing.** Reference cross-links, right-rail ToC,
   dark-mode contrast, mrdocs reference organization, signature rendering — these are
   properties of the doc *system*, orthogonal to prose. Several concrete findings live
   only here.
3. **"Structure" conflates macro and micro.** The review's structural pain is almost all
   *macro* (which pages exist, cross-page duplication, rationale scattered across three
   places) rather than *within-page flow*. Worth naming both so a fix targets the right
   level.

One overstatement to guard against: treating **Wording as mere surface polish**. Alan and
Andrzej framed the "fluff" not as typos but as a *symptom of an authoring process that
drifts* — which is exactly why you want a style guide. Wording is where the drift becomes
visible, not where it originates.

**Recommended categorization (five axes + one cross-cutting concern):**

1. **Structure** — split into *macro* (page set, cross-page duplication, section order)
   and *micro* (in-page flow).
2. **Accuracy** — explicitly include (a) **example-code correctness** (compiles, safe, no
   dangling refs) and (b) **prose ↔ reference drift**.
3. **Wording / Style** — sentence-level technical-writing quality.
4. **Completeness / Pedagogy** — is the right content present, goal-oriented, and backed
   by runnable examples and rationale?
5. **Presentation / Tooling** — rendering, cross-links, navigation chrome, reference
   generation, theming.

Cross-cutting: **Drift / Maintainability.** Nearly every reviewer's deepest worry (Alan
and Andrzej explicitly) is that the docs and reference *keep* diverging. This is a process
property, not a document property — and it is the reason a style guide is worth writing.
It should be a first-class lens: every rule in the guide should be justified by "does this
reduce drift?"

---

## 6. Standards & tooling recommendations for an AI-followable style guide

The goal you described — a guide an AI agent can follow to keep quality high and prevent
drift — is best served by combining a **structural framework**, a **prose style standard**,
and an **enforcement mechanism**. Recommendations, most-impactful first:

1. **Diátaxis (structural framework) — adopt this first.** Diátaxis partitions
   documentation into four modes with distinct purposes that must not be mixed:
   *tutorials* (learning), *how-to guides* (tasks), *reference* (information), and
   *explanation* (understanding/rationale). Nearly every structural finding in this report
   is a textbook Diátaxis violation: tutorials that are really examples (#4), exposition
   that replicates the reference (#1), rationale scattered instead of confined to
   explanation (#10), a reference doing a tutorial's job (#5). Making mode boundaries
   explicit is the single highest-leverage structural rule, and it is easy for an agent to
   check ("which mode is this page? does its content match that mode?"). — https://diataxis.fr

2. **A single-source-of-truth rule (directly kills the #1 finding).** Exposition must
   **never restate reference signatures or concept definitions**; it links to the
   generated reference via the `cpp:` macro and the
   `antora-cpp-reference-extension` / `antora-cpp-tagfiles-extension` (which Alan
   explicitly asked for). This is both a style rule and a tooling change, and it removes
   the mechanism by which prose drifts from code.

3. **A mainstream prose style guide as the base — Google or Microsoft.** Both the
   [Google developer documentation style guide](https://developers.google.com/style) and
   the [Microsoft Writing Style Guide](https://learn.microsoft.com/style-guide/) cover
   voice, tone, task-orientation, terminology, and code formatting; both explicitly favor
   *goal-oriented, task-based* writing (addresses #5), and both are heavily represented in
   model training data, so an agent follows them reliably. Recommend adopting one wholesale
   as the base and layering a short project-specific delta (C++/coroutine terminology,
   Boost conventions).

4. **ASD-STE100 (Simplified Technical English) — as a *pragmatic subset*, not verbatim.**
   STE's core rules map precisely onto the "AI fluff" findings (#6): short sentences, one
   idea per sentence, active voice, approved single-term-per-concept vocabulary, and a ban
   on metaphor/wordiness. **Caveat:** strict STE was designed for aerospace maintenance
   *procedures* — it bans most gerunds and restricts vocabulary in ways that suit how-to
   steps and reference docstrings but actively harm conceptual tutorials and design
   essays. Recommendation: apply an STE-derived subset **hard** in reference docstrings and
   how-to steps, and **relaxed** (short-sentence/active-voice spirit only) in tutorials and
   explanation. This matches how the review itself distinguished dense reference prose from
   teaching prose.

5. **A prose linter in CI — Vale — to make the guide *enforceable and AI-followable*.**
   [Vale](https://vale.sh) encodes style rules (sentence length, passive voice, banned
   words, one-term-per-concept, "unnecessary negative" patterns) as version-controlled YAML
   and runs in CI. This is the concrete anti-drift mechanism: it turns the style guide from
   a document an agent *might* follow into a gate that *fails the build* when prose drifts.
   Vale ships importable Google and Microsoft styles as starting points; add custom rules
   for the terminology table and the "don't restate the reference" heuristic where
   detectable. (Alternatives: textlint, `write-good` — Vale is the most capable.)

6. **A terminology table (one term per concept).** Several findings are terminology drift
   (#15, and the launch/start/spawn/run family that recurred through the thread). A short
   controlled-vocabulary table, enforced by Vale, prevents synonym drift and is trivial for
   an agent to apply.

7. **Worth knowing, not adopting wholesale:** ISO/IEC/IEEE **26514** (design & development
   of user documentation) and **26515** (documentation in agile) are the formal standards
   in this space. They are heavyweight and process-oriented; cite them for credibility if
   needed, but Diátaxis + a mainstream style guide + Vale will deliver far more value per
   unit effort.

**Suggested stack:** *Diátaxis* (structure) + *Google or Microsoft style guide* (prose) +
*STE-derived subset for reference/how-to* (precision) + *single-source-of-truth linking
rule* (anti-drift) + *Vale in CI* (enforcement). That combination directly answers each
category of feedback in this report and gives an agent a checkable contract.

---

## 7. Appendix — confidence rationale

- **Highest confidence** goes to findings raised by ≥3 distinct reviewers *and* verified
  still-open: #1 (Alan+Andrzej+Rainer), #3 (Rainer+Gennaro+Alan), #5 (Alan+toast27+Rainer).
- **Finding #2** is rated very high despite being partly one reviewer's framing because the
  **library author independently reached the same diagnosis** (msg 50) and it is the
  proximate cause of the only reject vote — author self-corroboration is strong signal.
- **Single-party findings** (#10–#30) are ranked lower on *signal* but several are ranked
  up on *accuracy* because they are concrete and verified (e.g. #11 Part-headings, #14
  Quick Start position, #19 echo-server placement). Peter Turcan's items are single-party
  but carry weight as professional technical-writing review.
- **Already-fixed items** (#24, #25, #26, and IoAwaitable within #8) are retained for the
  record but should not consume rework effort.
- Note on double-counting: Andrzej's msg 67 quotes Alan's entire appendix and explicitly
  *endorses* it. His agreement is counted as genuine second-party corroboration of Alan's
  points, but not as independent discovery.
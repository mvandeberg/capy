# Capy Reference-Surface Audit — Docstrings

**Scope:** the **reference** surface — Doxygen docstrings in the 64 public headers under
`include/boost/capy/**` (excluding `detail/` and `impl/`). 28 sub-agents, ~450 documented
public declarations, running `doc-prompts/doc-audit.md`'s **reference mode** (Diátaxis mode
fixed to `reference`; the five axes remapped to the docstring contract).

Companion to [DOC_AUDIT_PHASE4_EXIT.md](DOC_AUDIT_PHASE4_EXIT.md), which covers the
exposition surface. **Read R1 first — it invalidates a chunk of this tool's own contract.**

**Headline:** the reference surface is in **better** shape than the pages. Prose quality is
genuinely good — the `Wo` axis is clean on 20 of 28 assignments and produced no `major`
anywhere. But **`Ac` is `major` on 14 of 28 assignments**, and the concentration is stark:
**the single largest defect class is hand-written `@par Example` code, which no gate compiles
and which has rotted in at least 12 places.**

---

## R1. The audit contract's own St rule is wrong — findings discarded

`doc-audit.md`'s reference-mode remap requires the section order *brief → description →
`@param` → `@return` → `@par` → `@throws` → `@note` → `@see`*. Six agents dutifully filed St
findings against it before I measured the premise. Both halves of the rule fail:

- **It is not the house convention.** Across every non-detail public header: **65 doc blocks
  put `@par` before the first `@param`/`@tparam`/`@return`; 26 put it after.** The
  "violating" form wins 71% to 29%, spanning `task`, `quitter`, `read`, `write`, `when_all`,
  `when_any`, `async_mutex`, `strand`, `execution_context`. Enforcing the rule would flag the
  library, not fix it.
- **It has zero reader impact.** **MrDocs 0.8.0 normalizes section order in the rendered
  output.** Verified: `task::await_resume` writes `@return` before `@par Exception Safety`
  and renders *Description → Exception Safety → Return Value*.

**I discarded every section-ordering finding and re-briefed the remaining 22 agents to skip
the rule.** The correction is a fix owed to `doc-prompts/doc-audit.md`, not to any header.
A real St finding still exists where a paragraph is *stranded* inside or after a `@par` block
(`async_event`/`async_waker` both do this) — that changes what renders where.

This is the audit tool doing exactly what it warns about: a rule stated confidently, never
checked against the corpus it governs.

---

## R2. Docstring `@par Example` code is ungated, and ~12 of 103 blocks are broken

**103 `@code` blocks across 50 public headers.** Nothing compiles them:

- The snippet-compile job (`F2`, the accuracy gate) covers only `include::example$` on
  `.adoc` pages.
- `doc/lint/extract-docstrings.mjs:105` **explicitly strips them** before Vale sees the
  prose — `Drop @code ... @endcode samples entirely — not prose.`
- Phase-0 Task 5 studied exactly this and **recommended DEFER** (`doc/lint/RESEARCH-docstring-examples.md:196`).

That deferral was reasonable without evidence. **This audit is the evidence.** Confirmed
broken, several by actually compiling them:

| Symbol | Defect | How confirmed |
|---|---|---|
| `run_async_wrapper` | `@warning` says `auto w = run_async(ex);` "does not compile" — it **does**; C++17 guaranteed copy elision never considers the deleted ctors | compiled |
| `test::run_blocking_wrapper` | copy of the same claim: "can only be used as a temporary" — `auto w = …; std::move(w)(t());` compiles and runs | compiled, with negative control |
| `work_guard` | `make_work_guard(ctx)` passes an execution **context** to a function constrained on `Executor` | read + constraint check |
| `buffer_param` | Virtual Interface Pattern: CTAD yields `span<mutable_buffer>`, needs `span<const_buffer>` | compiled (`g++ -std=c++20`) |
| `test::buffer_to_string` | calls `.data()` on bufgrind halves; returns `void const*`, satisfies no sequence concept | read + tests |
| `ExecutionContext` | `ex.post([]{})` — every capy `post` takes `continuation&`, which no closure converts to | read |
| `async_mutex` | defines `task<> protected_operation()` **twice** in one TU | read |
| `cond` | `if(…)` with a comment-only body followed by `else` — syntax error | read |
| `io_task` | uses `route_params` / `route::next`, which exist in **no** repo (capy, corosio, burl) | grep ×3 trees |
| `test::stream`, `test::write_stream` | object constructed **outside** `f.armed`, so state carries across the ~2N rounds and the trailing `// buf contains "hello"` comment is unreachable / wrong | read + unit tests |
| `Stream` concept | "echo" example discards `write_some`'s result, silently dropping bytes under the partial-write contract it inherits | read |
| `any_read_stream` / `any_write_stream` | redeclare `stream` in one scope; use undeclared `ioc`, `data`, `size` | read |

Several of these sit **next to a compiled snippet that has the correct form** — the
`buffer_to_string` example is wrong while `test/doc/snippets/7e_buffer_inspection.cpp:81`
does it right. That is the prime directive's drift, on the one surface the pipeline does not
cover. **Recommend reopening Task 5.**

---

## R3. `@see executor` names a symbol that does not exist — 19 times

The concept is `boost::capy::Executor` (`concept/executor.hpp:165`). There is no
`boost::capy::executor`. Yet:

- `ex/run_async.hpp` — **18** occurrences (one per overload)
- `ex/run.hpp` — **1**

(`ex/this_coro.hpp`'s single `@see executor` is **legitimate** — `this_coro::executor` is a
real awaitable tag object.)

**This is worse than a dead link:** because `this_coro::executor` exists, a fuzzy resolver can
silently point all 19 at the tag object instead of the concept. `continuation.hpp` gets it
right (`@see Executor, executor_ref`), so the correct form is already in the tree. One `sed`.

Related and unresolved: **MrDocs 0.8.0 appears to render every `@see` as plain unlinked
text** (observed on `task`, `io_env`, `quitter`, `when_any`, `read`). If so, `warn-broken-ref`
never sees `@see` targets at all — which would explain how 19 bad ones survived a gate that
is supposed to be blocking. **Worth a bite-test before trusting `warn-broken-ref`.**

---

## R4. Where the two surfaces disagree, the winner is not always the same

The exposition audit flagged five page↔docstring conflicts. Adjudicated against code:

| Conflict | Correct surface | Fix goes in |
|---|---|---|
| `stream::provide` direction (7b table says "this stream", code appends to peer) | **docstring** | `7b.mock-streams.adoc:224` (the page even self-contradicts at line 172) |
| `fuse` run loop (7.intro says "one extra run", code runs two full sweeps) | **docstring** | `7.intro.adoc:47` |
| `strand::dispatch` inline condition (4c says "if the strand is idle") | **docstring** | `4c.executors.adoc:122` |
| by-value buffer rule narrowed to coroutines | **docstring** | `9c.ReadStream.adoc:56` **and** `9f.WriteStream.adoc:52` — the exposition audit found only 9f |
| `ReadStream` after-error precondition (9c says UB) | **neither** — see below | both |
| `ExecutionContext` "executes function objects" / "destroys unexecuted work" | **the page** (`9k.Executor.adoc`) | `concept/execution_context.hpp` |

Two of these are worth dwelling on.

**The after-error rule.** 9c.ReadStream.adoc asserts "Once `read_some` returns an error the
caller must not call `read_some` again … the behavior after an error is undefined." That is
**refuted by the library's own conforming stream**: `test::read_stream::read_some` returns
`{error::eof, 0}` on *every* subsequent call (fully defined), and under a `fuse` it returns an
injected error while leaving `pos_` untouched, so the next call **resumes delivering data**.
9c also contradicts itself — line 149 endorses zero-length probes whose whole purpose is to
return an `ec`. But the docstring is not right either: it makes "a subsequent read"
load-bearing and never says what such a call may do. **Fix: state the permissive rule in the
concept header; delete 9c's UB text. Do not sync the copies.**

**`ExecutionContext` is Asio residue.** `concept/execution_context.hpp` still says a context
provides what is "needed to execute function objects" and that destroying it "destroys all
unexecuted work". Capy executors take `continuation&`, and `thread_pool::stop` documents the
real behavior as *abandons*. Here the **design page is correct and the header is stale** —
the reverse of every other row. Any "pages defer to headers" sweep would propagate the error.

---

## R5. Systemic patterns

- **`@par Thread Safety` is applied per-overload, not per-symbol — and MrDocs emits one page
  per overload.** `run_async` documents it on 4 of 18 overloads; `when_any` on 0 of 3;
  `when_all` on 1 of 3; `thread_pool::stop` omits it while documenting cross-thread use. Same
  for preconditions: `run_async`'s memory-resource lifetime rule appears on 1 of 6 `mr`
  overloads. **A reader landing on overload 12 gets a page with no safety contract at all.**
- **The two-call `run_async` warning reaches one page of nineteen.** MrDocs renders 19
  separate `run_async-*.html`; the full `@warning` lives only on `run_async_wrapper`, and
  **no overload carries `@see run_async_wrapper`**. `run_async-04.html` contains zero
  occurrences of "two-call". This is Phase-2 finding #3's remaining half.
- **Markdown `**bold**` does not render.** `run_async_wrapper.html` shows literal
  `&ast;&ast;` in the header's most important admonition. Single `*italic*` works.
- **`@li` lists terminate the enclosing `@warning`.** In `run_async_wrapper.html` the warning
  box closes before the `<ul>`, so all three hazardous patterns render as ordinary body text —
  the framing is stripped from exactly the content that needs it.
- **`@note` is silently demoted to body prose** by MrDocs 0.8.0 (verified on `task::handle`,
  `task::release`) — indistinguishable from ordinary text library-wide.
- **Near-clone headers duplicate every defect.** `any_read_stream`/`any_write_stream`,
  `async_event`/`async_mutex`, `error`/`cond`, `executor_ref`/`any_executor`,
  `read`/`write`/`read_at_least`/`write_at_least`, `task`/`quitter`. Fix in pairs or the pair
  re-diverges. `run_blocking_wrapper` is a copy of `run_async_wrapper` that inherited a false
  claim **and dropped its rationale clause**.
- **Blanket "operations on a default-constructed X are undefined" is false in five places** —
  the same classes document `has_value()`, `operator bool()`, `operator==`, and `target_type()`
  as working on the empty state (`any_read_stream`, `any_write_stream`, `any_executor`).
- **Missing `@tparam` on member function templates is entirely ungated** — MrDocs emits zero
  tparam warnings across all 214 baseline fingerprints, despite `warn-no-paramdoc: true`.
- **`detail::` vocabulary leaks into public prose** with no resolvable target: "trampoline",
  "chain", "the internal work guard" (names an object that does not exist — `thread_pool`
  uses a `joined_` flag), `slice_of` (public alias is `slice_type`), `stop_requested_exception`,
  `frame_memory_resource`.
- **No docstring anywhere links to an `.adoc` page.** `grep 'xref:\|specification-methods'
  include/` returns nothing. So every term defined only in `A.specification-methods/` is
  unreachable from the reference — including *"contingency"* (24 uses) and
  *"supports IoAwaitable cancellation"* (11 uses, italicised as a defined term in 12
  docstrings). Per `ef789cea`, MrDocs escapes docstring punctuation, so a docstring **cannot**
  carry an xref. That is a structural dead end, not an oversight.
- **`Capy.Terminology`'s swap list is narrower than C10.** It covers only
  launch/spawn/cancel-token/boxed. It cannot see `scheduler` used for `executor`
  (`io_awaitable.hpp`), `wrapper` vs `launcher` (all 18 `run_async` `@return` lines),
  `IoAwaitables` vs "I/O awaitable", or `@pre` vs `@par Preconditions` (17 uses each).

### The "contingency" question, resolved

The four algorithm headers say **contingency** (6× each, 24 total, and nowhere else in
`include/`); the concept headers say **condition**. **"Contingency" should win**, and the
algorithm headers are the correct side:

1. `A.specification-methods/Ac.contingencies.adoc` formally defines it.
2. "Condition" is already taken — `cond.hpp` is *"Portable error conditions"*, and the
   standard reserves *error condition* for `std::error_condition`.
3. The algorithm headers already maintain both terms as *distinct* concepts —
   `Contingencies:` heads the when-an-error-is-reported list, `Notable conditions:` heads the
   `cond::` enumerator list. Two concepts, not synonyms, so C10 does not bite them.

Fix direction: extend "contingency" into `concept/read_stream.hpp:47` and
`concept/write_stream.hpp:51`. Vale cannot help — neither word is in the swap list, and
adding one requires picking the direction.

---

## R6. Grades by assignment

`St Ac Wo Co Pr` · `M`=major `m`=minor `.`=clean · St excludes the retired ordering rule

| Header(s) | St | Ac | Wo | Co | Pr |
|---|:-:|:-:|:-:|:-:|:-:|
| `ex/run_async.hpp` | . | M | m | M | M |
| `test/stream.hpp` + `read_stream` + `write_stream` | . | M | . | m | . |
| `concept/read_stream` + `write_stream` + `stream` | . | M | . | m | m |
| `concept/executor` + `execution_context` + buffer concepts | . | M | m | m | . |
| `concept/io_awaitable` + `io_runnable` + `decomposes_to` | . | M | m | m | . |
| `buffers/consuming_buffers` + `buffer_param` + `asio` | . | M | . | m | m |
| `io/any_stream.hpp` + `write_now.hpp` | . | M | . | m | . |
| `ex/executor_ref.hpp` + `any_executor.hpp` | . | M | m | m | . |
| `ex/thread_pool.hpp` | . | M | m | m | m |
| `test/run_blocking.hpp` | . | M | . | m | . |
| `test/fuse.hpp` | . | M | m | . | . |
| `test/bufgrind` + `buffer_to_string` + `thread_name` + `test.hpp` | . | M | . | m | . |
| `io_result` + `io_task` + `error` + `cond` | . | M | . | m | m |
| `ex/this_coro` + `io_env` + `immediate` + `work_guard` + `continuation` | m | M | . | m | . |
| `ex/async_mutex.hpp` | . | M | m | M | m |
| `task.hpp` | m | M | m | m | m |
| `quitter.hpp` | m | m | m | M | . |
| `io/any_read_stream.hpp` + `any_write_stream.hpp` | . | m | . | m | . |
| `ex/strand.hpp` | m | m | . | m | . |
| `ex/async_event.hpp` + `async_waker.hpp` | m | m | m | m | m |
| `ex/execution_context.hpp` + `system_context.hpp` | m | m | m | m | . |
| `ex/run.hpp` | m | m | . | m | m |
| `when_all.hpp` | m | m | m | m | . |
| `when_any.hpp` | . | m | . | m | m |
| `ex/frame_allocator` + `frame_alloc_mixin` + `recycling_memory_resource` + `io_awaitable_promise_base` | . | m | m | m | m |
| `read` + `write` + `read_at_least` + `write_at_least` | . | m | m | . | . |
| `buffers/make_buffer` + `buffer_slice` + `buffer_copy` + `front` | . | m | m | m | m |
| `buffers.hpp` | . | m | . | . | m |

**Cleanest:** `concept/read_stream.hpp` (clean on all five in isolation), `front.hpp`,
`test/read_stream.hpp`, `buffers.hpp` (one Ac, one Pr).
**`Wo` clean on 20 of 28** — Phase 4's wording pass held on this surface.

---

## R7. Recommended order

1. **Fix `doc-audit.md`'s St ordering rule** (R1) and its two stale corpus calibrations
   (`:page-mode:` 0→1 page, `cpp:` 0→51 pages). The prompt collection is the generation
   engine for Phase 5; shipping it with a rule that flags 71% of the library is a
   force-multiplier for noise.
2. **`sed` the 19 `@see executor` → `@see Executor`** (R3), then **bite-test
   `warn-broken-ref`** — if `@see` is unlinked plain text, that gate is fail-open and belongs
   on the F4 list next to `Capy.PartHeadings`.
3. **Reopen Task 5** with R2's evidence and gate docstring `@code`. 12 confirmed-broken
   examples out of 103, two of which assert a compile failure that does not happen, is a
   different input than the research doc had.
4. **Sweep `@par Thread Safety` and preconditions across full overload sets** (R5) — MrDocs
   emits a page per overload, so per-overload coverage is the only coverage that exists.
5. **Add `@see run_async_wrapper` to all 18 `run_async` overloads** and repeat the two-call
   constraint in each brief. Closes the remaining half of Phase-2 finding #3.
6. **Apply R4's rulings** — noting that two of them run *page → header*, so a one-directional
   sweep is wrong.
7. Only then Phase 5.

## Limits

- Sub-agents were told not to report undocumented declarations (the MrDocs gate's job) and
  not to re-report C2/C4/C9/C10 (promoted, clean). Findings here are what those gates cannot
  see.
- Several agents could not run MrDocs (not on PATH) and judged `Pr` from the already-built
  `doc/build/site`, which may lag the headers. Where a `Pr` finding rests on rendered output
  it says so.
- `doc/lint/baseline.json` was authored 2026-07-30T16:45Z, before `a806892c` touched
  `frame_alloc_mixin.hpp` — baseline-based reasoning about that header is partly stale.
- ~230 candidate findings were dropped on self-challenge, plus all section-ordering findings
  discarded under R1. The dominant drop reason was **identity-shaped class briefs** (B4):
  agents measured it as house convention across 17+ headers and declined to file it per
  header. If B4 is meant to bind class briefs, that is one library-wide decision, not 28
  findings.

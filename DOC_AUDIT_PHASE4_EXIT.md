# Capy Documentation Audit — Phase-4 Exit

**Scope:** all 65 `.adoc` pages under `doc/modules/ROOT/pages`, one sub-agent per page, each
running the `doc-prompts/doc-audit.md` pipeline (Classify → Score → self-Challenge) against
`DOC_STYLE_GUIDE.md`. The reference (docstring) surface was **not** audited — this is the
exposition surface only.

**Headline:** **430 findings survived self-challenge across 65 pages; ~345 more were dropped.
Zero pages scored clean on all five axes.** 34 pages carry a `major` Accuracy grade and 13
carry a `major` Structure grade. The wording axis — the one Phase 4 just closed — is the
*healthiest* axis in the corpus: 1 `major` (why-capy.adoc) and no page where wording is the
top defect. Phase 4 did its job. What it exposed is that Phases 1 and 2 did not finish.

---

## The one-line conclusion

**Accuracy, not wording, is the corpus's dominant defect class, and the gates that were
promoted to protect it do not reach the places the defects live.** Nine of the twelve
systemic patterns below are gate-coverage holes, not writing problems. Corosio (Phase 5)
should not start until the gate holes are closed, because Phase 5 will replicate them.

---

## Part 1 — Systemic patterns

Ranked by blast radius. Each was verified in the repo, not taken from a sub-agent's word.

### S1. `Capy.PartHeadings` (rule A7) has never matched anything — and A7 is a promoted gate

`doc/.vale/styles/Capy/PartHeadings.yml` is `raw: '^Part\s+\d+\b'`. Every "Part N" title in
the corpus is a **Roman numeral**:

```
2a "Part I: Foundations"   2b "Part II: {cpp}20 Syntax"   2c "Part III: …"   2d "Part IV: …"
3a "Part I: Foundations"   3b "Part II: Synchronization"  3c "Part III: …"   3d "Part IV: …"
```

`\d+` cannot match `I`/`II`/`III`/`IV`. **`doc/lint/baseline.json` contains 0
`Capy.PartHeadings` fingerprints** against a corpus with 8 A7 violations — the CI-authored
baseline is the proof, and it is exactly the shape F4 documents for this same file
(`b54fe6c8` fixed the *scope*; the *pattern* was never fixed).

This is a **gate**, promoted at Phase-1 exit. It has been reporting clean since the day it
was written. Six independent sub-agents found it without being told to look.

Fix: `raw: '^Part\s+([0-9]+|[IVXLC]+)\b'`, then bite-test both forms per F4.

> **Bite-tested, per F4.** Planting `= Part 3:` / `== Part 5:` produced 3 `Capy.PartHeadings`
> alerts; planting `= Part III:` / `== Part IV:` produced **0**. A control page with
> `Note that … simply … utilize … spawn` fired `Capy.NoFluff` ×3 and `Capy.Terminology` ×1,
> proving the Capy styles were loaded and running. The rule works for Arabic numerals and is
> blind to Roman; the corpus is 100% Roman.
>
> **Tooling note that cost this audit real time.** `vale` *does* run here, but only with
> `cd doc && export PATH="$PWD/node_modules/.bin:$PATH"` — `asciidoctor` is `asciidoctor.js`
> from node, not Ruby, and Vale shells out to it for every `.adoc` (including the extracted
> docstring corpus). Without that PATH prepend, Vale exits 2 with `asciidoctor not found`
> and **prints nothing**, which greps identically to "clean". Several audit sub-agents hit
> this and fell back to reading rule YAML instead of running the check — the precise failure
> F4 exists to prevent. This invocation belongs in `DOC_STYLE_GUIDE.md` step 3, which today
> just says "run `vale` locally".

### S2. `doc-lint.mjs`'s B2 check only sees `[source,cpp]` blocks

`doc/lint/doc-lint.mjs:63` matches `/^\[source\s*,\s*(cpp|c\+\+)\b[^\]]*\]/i`. Anything else
is invisible to the B2 gate. Measured escapes:

| Escape route | Count | Example |
|---|---|---|
| Bare `----` listing holding real C++ | ≥2 confirmed | `9k.Executor.adoc:281`, `9l.RunApi.adoc:260` |
| `[source,c]` | 2 | `5d.system-io.adoc` (`iovec`, `WSABUF`) |
| `[source,cmake]` | 12 | every example page's Build block |
| `[source,bash]` | 1 | `quick-start.adoc` |

B2 is a **promoted gate**. It is enforcing on one language token.

### S3. The hand-pasted CMake Build block is wrong on 7 pages — and B2 cannot see it

12 of 15 `8.examples/` pages plus `quick-start.adoc` hand-paste a build recipe. The link
target has drifted into two camps:

- **Broken (7):** `quick-start` (`-lcapy`), `8a`, `8b`, `8c`, `8d`, `8f`, `8g`
  (`target_link_libraries(... PRIVATE capy)`)
- **Correct (5):** `8k`, `8l`, `8m`, `8n`, `8q` (`PRIVATE Boost::capy`)

`CMakeLists.txt:125-126` defines `boost_capy` with `add_library(Boost::capy ALIAS boost_capy)`.
**No target or library named `capy` exists.** The very first command a quick-start reader runs
does not link. Every `example/*/` directory already ships a real `CMakeLists.txt` that could
be `include::`d.

### S4. A phantom `Source`/`Sink` concept tier is documented as shipped

`include/boost/capy/concept/` contains **three** stream concepts: `ReadStream`, `WriteStream`,
`Stream`. `grep -rn 'ReadSource\|WriteSink\|BufferSource\|BufferSink' include/` returns **0**.
Five pages document them as present fact:

| Page | Claim |
|---|---|
| `6.intro.adoc` | "six concepts, arranged in three complementary pairs"; "_sources_ and _sinks_" |
| `6b.streams.adoc` | prerequisite: "the six stream concept categories" |
| `index.adoc` | "the seven stream concepts" (and "three" 15 lines earlier) |
| `9m.WhyNotCobalt.adoc` | "seven coroutine-only stream concepts"; 4 phantom wrapper + 4 phantom mock table rows |
| `9c` / `9f` | full `ReadSource`/`WriteSink` hierarchy diagrams; 9f links a "WriteSink design document" that does not exist |
| `6f.isolation.adoc` | lists `any_buffer_source`, `any_buffer_sink` as living in `<boost/capy/io/>` |

`include/boost/capy/io/` holds exactly `any_read_stream.hpp`, `any_stream.hpp`,
`any_write_stream.hpp`, `write_now.hpp`. Related: `9i.TypeEraseAwaitable.adoc` describes
`any_read_source`/`any_buffer_source` that *do* exist — **in Boost.Http** — without saying so,
so a Capy reader searches Capy's reference for them.

This is one decision, not six edits: either the tier ships, or every page marks it planned.

### S5. Claimed program output is compile-gated, never run-gated

19 pages carry 21 `*Output:*` / `== Output` blocks, all hand-typed. `test/doc/WriteProgramTest.cmake`
emits a bare `add_test("${TEST_NAME}" "${TEST_EXECUTABLE}")`; `grep -rn
'PASS_REGULAR_EXPRESSION\|expected_output' test/doc/` returns **nothing**. A doc program passes
on exit status alone. Sub-agents hand-verified several blocks as correct today and found two
that are not reproducible as printed:

- `8g.parallel-fetch.adoc` — three top-level `run_async` tasks on a default `thread_pool`
  with unsynchronized `std::cout`; the shown interleaving is one of many.
- `3b.synchronization.adoc` — "180,000, 195,327, maybe occasionally 200,000" from a program
  in `COMPILE_ONLY_PROGRAMS`, which never runs at all.

The single-source pipeline stops at the code block and does not cover the output beneath it.

### S6. Asciidoctor concatenates same-named tag regions; the compile gate cannot see the result

Asciidoctor merges every region sharing a tag name into one rendered block. The snippet file
compiles per-region; the merged block on the page can be garbage. Confirmed against
**rendered HTML** by the `3c.advanced.adoc` agent:

- `tag=wait_variants` — two regions from different scopes concatenate into a block that
  declares `auto status` twice and would not compile as shown.
- `tag=shared_mutex` — the tag opens above the pragma preamble, so the rendered block is
  ~30 lines of `#pragma GCC diagnostic ignored` before any shared-mutex code.

Same leaked-preamble defect at `4a.tasks.adoc` (`tag=include_task` renders ~28 lines of
pragmas under the caption "The `task<T>` type is defined in:").

Cheap gate: for each `tag=X` a page references, extract the *concatenated* region and compile
it standalone; or warn when a tag name has more than one region in a file.

### S7. `role=external` is being used as a general compile-gate escape hatch

14 uses: 13 on `9.design/WhyNot*` pages (legitimate — other-library comparison), and:

- `7a.drivers.adoc` — a block of **Capy's own** `fuse::armed(run_one, fn)` API.
- `9m.WhyNotCobalt.adoc` — a 75-line serializer written in **Capy's own** `task<>` and
  `capy::test::run_blocking`; `serialize_capy_task` appears nowhere else in the repo.

B3 reserves the role for other-library code. Used this way it turns off B2 for first-party
code that could be compiled.

### S8. A "compiled sketch" pattern satisfies B2 while defeating A2/B1

`test/doc/snippets/` contains deliberate sketch namespaces — `executor_concept_sketch`,
`api_sketch`, `concept_def`, `concept_layer`, `composed`, `synopsis`, `definition` — that
re-declare a real library entity so a hand-typed signature compiles. The compile gate is
satisfied; the declaration is a *copy* and drifts freely. Confirmed drift:

- `4c.executors.adoc` — the reproduced `thread_pool` constructor lost `explicit`.
- `5b.types.adoc` — the `const_buffer` sketch lost `constexpr` on four members and both copy
  operations.
- `7e.buffer-inspection.adoc` — table row says `operator bool() const`; real is
  `explicit … noexcept`.
- `5e.algorithms.adoc` — `namespace synopsis` declares `buffer_size`/`buffer_empty` as plain
  function templates; both are `constexpr noexcept` anonymous-struct function objects. The
  page's own prose says `buffer_copy` *is* a function object, then shows a free function.
- `9a.CapyLayering.adoc` — `namespace concept_layer` re-declares `capy::write`.

Where a `static_assert` does guard the sketch (`9n`, `9f`), it only asserts that 2–3 known
types satisfy both — it passes when a requirement is added that those types happen to meet.

**Any page including a `*_sketch` / `synopsis` / `concept_def` tag is an A2 candidate.**

### S9. Exposition reproduces the reference contract verbatim — 13 pages, `major` St

The highest-value structural rule (A2) is the most violated. The worst cases copy a docstring
near sentence-for-sentence:

| Page | What is reproduced |
|---|---|
| `9c.ReadStream` / `9f.WriteStream` | `Semantics` → `Conforming Signatures` copied from `read_stream.hpp`/`write_stream.hpp`. 9f's copy **has already drifted** (narrows the by-value buffer rule to coroutines only; the header requires it unconditionally). 9c states an after-error precondition the docstring does not contain — the two surfaces now disagree. |
| `6b.streams` | the same contract a **third** time |
| `7a` / `7b` / `7e` | hand-typed member tables: 14 rows for `fuse`, 6 for `run_blocking`, 3 tables in 7b, 2 in 7e |
| `4c.executors` | `Executor` concept body + `thread_pool` ctor |
| `5b.types` | full `const_buffer` / `mutable_buffer` class declarations |
| `5e.algorithms` | 4 API synopses |
| `9k.Executor` | concept body + a duplicate `Conforming Signatures` section |

`9.intro.adoc` **sanctions** it: it promises each design page carries the concept's "formal
definition". Fixing the pages without fixing the intro leaves the section describing itself
incorrectly.

Also: 16 pages carry a hand-maintained `== Reference` header table with no `xref` or `cpp:`
link. Individually below the A2 bar; collectively a 16-page ungated drift surface.

### S10. `cpp:` adoption is half-applied *within* pages

Phase-4 measurement: 51/65 pages use `cpp:`, 555 uses. But **174 bare-backticked mentions of
linkable Capy symbols remain on pages that already link elsewhere** — often in the same
sentence (`"…`run_async` for entry and cpp:run[] for hopping"`), and disproportionately in
**summary and comparison tables**, which three agents independently called out as the blind
spot. Worst: `4f.composition` (19), `9f.WriteStream` (18), `5b.types` (18), `9c` (11).

This is mechanically greppable: *a symbol linked with `cpp:` anywhere on a page but bare
elsewhere on that same page.* It is the cheapest large win in the report.

### S11. Section-intro roadmaps drift from the actual page inventory

Every `*.intro.adoc` hand-summarises its nav children in closing prose. Four have drifted:

- `5.intro` promises "dynamic buffer abstractions" — no such page, no such entity.
- `6.intro` promises "transfer algorithms" — no such page; plus the S4 phantom taxonomy.
- `4.intro` says topics end at allocators — `4h.lambda-captures` follows.
- `8.intro` promises "fully featured servers, covering real-world integration with Corosio" —
  no such page exists in the section.

`7.intro` also mis-states `fuse`'s run loop (one extra run vs. a second full sweep), while
`7a` states it correctly. Related: section landing pages have **two incompatible conventions**
— `7.intro` xrefs each child with a gloss; `5.intro`, `6.intro`, `9.intro`, `A.intro` link
nothing. `A.intro` is 21 words. No rule settles which wins.

### S12. Repeated cross-page claims that are wrong in every copy

Fix once, fix everywhere:

| Claim | Where | Reality |
|---|---|---|
| "one virtual call per I/O operation" | `why-capy`, `9a`, `9m`, `9o` | `any_read_stream::read_some` dispatches through 5 vtable pointers |
| Corosio has 3 or 4 backends | `9b` ("four"), `9k` (twice, "three"), `9o` ("io_uring planned") | 5: epoll, kqueue, io_uring, IOCP, select. `9o` also names only WolfSSL; OpenSSL ships too |
| "coroutine frame is heap-allocated" (unconditional) | `2a`, `2b`, `2c`, `2d`, `4h` | contradicted by these pages' own HALO sections |
| `epoll_context`/`iocp_context`/`select_context` types | `9k` | no such types; it is `corosio::io_context` + a backend tag |
| Buffer layout matches `WSABUF` | `5a`, `5b` ("often just a reinterpret_cast") | `WSABUF` orders members oppositely with a 32-bit length; `5d` says Capy *copies* |
| "GCC 10+, Clang 14+, MSVC 2019 16.8+" | `2a` | README says GCC 12+/Clang 17+/MSVC 14.34+; CI's oldest is GCC 13 |

Also single-site but flatly wrong and worth listing: `9a` names a `right_now` pattern — the
type is `write_now`; `9c` calls `read(stream, buffer(buf,100))` — the factory is `make_buffer`;
`5d` says Corosio "exposes" registered-buffer optimizations — it exposes none; `3a` says
`std::thread` without `std::ref` "modifies a copy" — it is a hard compile error.

---

## Part 2 — Cross-cutting question the audit cannot decide

**Does the chapter page template make every concept page mode-mixed?** 12 pages classified
`mixed` with `mode_mismatch: true`. In nearly every case the sub-agent traced it to the shared
skeleton, not to a local edit: `== Prerequisites` (39 pages) + body + `== Reference` header
table (16 pages) + a "You have now learned … Continue to …" closer. Tutorial scaffolding wraps
bodies that are reference specification or design explanation.

Five agents independently declined to file it per-page and asked for a corpus-level ruling.
Either bless the skeleton in A1/A3, or split the pages. Do not let 12 pages carry a mismatch
no one intends to act on.

**Secondary:** `3.concurrency/` (5 pages) uses **zero** Capy types — it is a deliberate
standard-C++ primer per `3.intro`, but D2 reads "the library's *own* type — not only of the
standard-library types it resembles", and Capy ships `async_mutex`/`async_event` as the
coroutine analogues of exactly what 3b/3c teach. Ratify the carve-out or reverse it.

---

## Part 3 — Undefined terms (C7), corpus-wide

Used unglossed, defined nowhere, no glossary page exists:

`await-return` (3 pages: `6b`, `9i`, `9n`) · `SBO` (3: `9k`, `9m`, `9n`) · `launcher` (7:
`why-capy`, `4d`, `4e`, `8a`, `9k`, `9l`, `9n` — self-consistent, so this is a C.1 table
decision, and Vale's `\b(launch|spawn|…)\b` cannot match the noun) · `trampoline` (`4d`, first
use precedes its only definition in `9l`) · `contingency` (`Ab` uses it; `Ac` defines it, and
nav puts `Ac` **after** `Ab`) · `reactor` (`4e`, `9k`, `9o`) · `proactor` (`9k`, one corpus
use) · `TLS` unexpanded ~15× before first expansion (`4g`) · `IIFE` in a heading (`4h`) ·
`HFT` (`9a`) · `Capy-coroutine` (`Ab`, one corpus use) · `lock-free` (`3c`, `8k` — and `8k`'s
usage is wrong: `strand` serializes with a pooled mutex).

Related reference-surface gap: `Ab.cancellation.adoc` is the sole definition of "_supports
IoAwaitable cancellation_", italicised as a defined term in **12 docstrings**, none of which
can link to it (per `ef789cea`, MrDocs escapes docstring punctuation). Nothing in the corpus
xrefs `Ab.cancellation.adoc` except `nav.adoc`.

---

## Part 4 — Per-page grades

`St Ac Wo Co Pr` · `M`=major `m`=minor `.`=clean · `⚠`=mode mismatch · Rank = 3×major+minor

| Page | St | Ac | Wo | Co | Pr | ⚠ | Rank |
|---|:-:|:-:|:-:|:-:|:-:|:-:|--:|
| 4.coroutines/4e.cancellation | M | M | m | m | m | | 9 |
| 4.coroutines/4c.executors | M | M | m | m | m | ⚠ | 9 |
| 5.buffers/5e.algorithms | M | M | m | m | m | ⚠ | 9 |
| 6.streams/6b.streams | M | M | m | m | m | ⚠ | 9 |
| 7.testing/7b.mock-streams | M | M | m | m | m | ⚠ | 9 |
| 9.design/9c.ReadStream | M | M | m | m | m | ⚠ | 9 |
| 9.design/9f.WriteStream | M | M | m | m | m | | 9 |
| 9.design/9m.WhyNotCobalt | M | M | m | m | m | | 9 |
| 5.buffers/5b.types | M | M | m | m | . | ⚠ | 8 |
| 9.design/9k.Executor | M | M | m | . | m | | 8 |
| why-capy | m | M | M | m | . | | 8 |
| index | m | M | m | m | m | | 7 |
| 7.testing/7a.drivers | M | m | m | m | m | ⚠ | 7 |
| 7.testing/7e.buffer-inspection | M | m | m | m | m | ⚠ | 7 |
| 9.design/9l.RunApi | M | m | m | . | m | | 7 |
| 5.buffers/5d.system-io | m | M | m | m | m | | 7 |
| 9.design/9a.CapyLayering | m | M | m | m | m | | 7 |
| 9.design/9o.WhyNotTMC | m | M | m | m | m | | 7 |
| 2.cpp20-coroutines/2d.advanced | m | M | m | . | m | | 6 |
| 3.concurrency/3c.advanced | m | M | m | m | . | | 6 |
| 4.coroutines/4a.tasks | m | M | m | m | m | | 6 |
| 5.buffers/5a.overview | . | M | m | m | m | | 6 |
| 6.streams/6f.isolation | m | M | m | m | . | | 6 |
| 8.examples/8c.buffer-composition | m | M | m | m | m | | 6 |
| 8.examples/8f.timeout-cancellation | m | M | m | . | m | | 6 |
| 9.design/9b.Separation | . | M | m | m | m | | 6 |
| 9.design/9n.WhyNotCobaltConcepts | m | M | m | . | . | | 5 |
| 2.cpp20-coroutines/2a.foundations | m | M | . | . | . | | 4 |
| 3.concurrency/3a.foundations | m | M | m | . | . | | 5 |
| 6.streams/6.intro | . | M | m | . | . | | 4 |
| 8.examples/8d.mock-stream-testing | m | M | . | . | m | | 5 |
| 8.examples/8b.producer-consumer | m | M | . | m | . | | 5 |
| 8.examples/8g.parallel-fetch | . | M | m | m | m | | 6 |
| 8.examples/8a.hello-task | . | M | . | m | m | | 5 |
| 8.examples/8l.async-mutex | . | M | . | m | m | | 5 |
| 9.design/9i.TypeEraseAwaitable | . | M | . | m | m | | 5 |
| 7.testing/7.intro | . | M | m | . | . | | 4 |
| quick-start | . | M | m | m | m | | 6 |
| 4.coroutines/4f.composition | m | m | m | m | m | | 5 |
| 4.coroutines/4g.allocators | m | m | m | . | m | ⚠ | 4 |
| 4.coroutines/4d.io-awaitable | m | . | m | . | m | ⚠ | 3 |
| 6.streams/6a.overview | m | m | m | . | m | | 4 |
| 5.buffers/5c.sequences | m | m | . | m | m | | 4 |
| 3.concurrency/3b.synchronization | m | m | m | m | . | | 4 |
| 2.cpp20-coroutines/2b.syntax | m | m | m | m | . | | 4 |
| 2.cpp20-coroutines/2c.machinery | m | m | m | . | . | | 3 |
| 4.coroutines/4b.launching | . | . | m | m | m | | 3 |
| 4.coroutines/4h.lambda-captures | . | m | m | m | . | | 3 |
| 5.buffers/5.intro | m | m | m | . | . | | 3 |
| 8.examples/8e.type-erased-echo | m | m | . | m | m | | 4 |
| 8.examples/8n.custom-executor | m | m | . | m | m | | 4 |
| 8.examples/8k.strand-serialization | . | . | m | m | m | | 3 |
| 8.examples/8m.parallel-tasks | . | m | . | . | . | | 1 |
| 8.examples/8o.sender-bridge | . | m | . | m | m | | 3 |
| A.spec-methods/Ac.contingencies | m | . | m | m | m | | 4 |
| A.spec-methods/Ab.cancellation | m | . | m | m | . | | 3 |
| 3.concurrency/3d.patterns | m | . | m | . | . | | 2 |
| 4.coroutines/4.intro | . | m | m | . | . | | 2 |
| 3.concurrency/3.intro | . | . | m | m | . | | 2 |
| 2.cpp20-coroutines/2.intro | . | . | m | . | . | | 1 |
| 9.design/9.intro | m | . | m | . | . | | 2 |
| 8.examples/8q.gui-integration | . | . | m | . | m | | 2 |
| 8.examples/8p.asio-use-capy | . | . | . | m | . | | 1 |
| 8.examples/8.intro | . | m | . | . | . | | 1 |
| A.spec-methods/A.intro | . | . | . | m | . | | 1 |

**No page scored clean on all five axes.** Closest: `8p.asio-use-capy` and `A.intro`
(one minor each), then `8.intro` and `8m.parallel-tasks`.

---

## Part 5 — Recommended order before Phase 5

Structure-and-accuracy first, exactly as the plan's architecture says — Phase 4 finished the
wrong-order-proof: wording is clean and it did not help.

1. **Close the gate holes** (S1, S2, S6, S7) — every hour spent fixing pages before this is
   revertible without failing CI. Bite-test each per F4. **Install asciidoctor first**, or
   the bite-test discipline cannot be executed.
2. **Reseed the baseline** — the owed Phase-4 action. ~3,700 dead grandfather clauses mean
   every Phase-3/4 fix is currently revertible. Do this before adding new findings to the
   pile.
3. **Decide S4** (phantom Source/Sink tier) — one maintainer ruling unblocks 6 pages, and it
   is the corpus's single largest accuracy defect.
4. **Sweep S3** (7 broken build recipes) — smallest effort, highest reader impact; the
   quick-start's build line does not work.
5. **Sweep S10** (`cpp:` half-adoption, 174 mechanical fixes) — greppable, low risk.
6. **Rule the mode-mixing question** (Part 2) before touching the 12 `mixed` pages.
7. **A2 sweep** (S9) — 13 pages, but do `9.intro` first so the section stops sanctioning it.
8. **Then** Phase 5. Corosio's playbook inherits every gate hole above; fixing them here is
   the only thing that keeps Phase 5 from re-earning them.

---

## Method notes and limits

- One sub-agent per page; each read the style guide, the audit prompt, and its page, scored
  five axes, then re-read to refute its own findings. ~345 findings were dropped on
  self-challenge — a 45% drop rate, which is the noise floor working.
- Agents verified accuracy against `include/boost/capy/**`, `test/doc/`, and `example/`;
  several compiled or ran binaries. Unverifiable claims were recorded as notes, not findings.
- **The reference (docstring) surface was not audited.** `doc-audit`'s reference mode exists
  and was not run. Given that S9 found the two surfaces already disagreeing on the
  `ReadStream` contract, a reference-mode pass is warranted before Phase 5.
- **`doc-prompts/doc-audit.md` needs two corrections.** Its calibration parentheticals are
  pre-Phase-1 measurements: it says "zero of 65 pages declare `:page-mode:`" (now 1 —
  `8q.gui-integration`) and "zero of 65 pages use the `cpp:` macro" (now 51 pages, 555 uses).
  I overrode both in the sub-agent briefing; the file itself is still stale.
- The style guide has **no rule id for a plain factual error**. Agents cited `B4` (written for
  reference briefs) or `D5` as the nearest fit, and two flagged the stretch explicitly. An
  accuracy rule would make the corpus's dominant defect class citable without straining.

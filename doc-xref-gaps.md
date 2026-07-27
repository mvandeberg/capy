# Doc `cpp:` / reference-link coverage audit (finding #7)

Phase 0, Task 3 of `DOC_IMPROVEMENT_PLAN.md`. This is an **audit only** — no
exposition pages are fixed here. It measures, per page, how many hand-typed
API mentions in prose *should* become `cpp:` reference-macro links (provided
by `@cppalliance/antora-cpp-tagfiles-extension`, configured in
`doc/local-playbook.yml` with `using-namespaces: [boost::]`, e.g.
`cpp:run_async[]`). The output feeds Phase 1 prioritization.

**Current state confirmed:** the 65 exposition pages under
`doc/modules/ROOT/pages/**` use **zero** `cpp:` macro links today (`grep -rl
'cpp:' doc/modules/ROOT/pages` → no hits). All API mentions in prose are
hand-typed backtick spans. The gaps below are therefore the full backlog for
Phase 1, not incremental noise.

## Method

1. Built a symbol list (54 names) from public headers under
   `include/boost/capy/**` (excluding `detail/` and example-placeholder names
   like `MyReadable`/`my_task` that appear only inside header doc-comments),
   plus the brief's example symbols (`run_async`, `task`, `io_task`,
   `thread_pool`, `strand`). Full list: see "Symbol list" below.
2. Scanned all 65 `.adoc` pages line-by-line, **excluding**:
   - content inside `[source...] ---- ... ----` listing/output blocks
     (covers `include::example$...[]` snippets, inline pseudocode blocks,
     and `*Output:*` blocks — these are compiled/verbatim, not prose),
   - heading lines (`=`, `==`, ...),
   - backtick spans that are header/file-path references (e.g.
     `` `<boost/capy/ex/run_async.hpp>` ``) — those aren't symbol-in-prose
     mentions needing a `cpp:` link.
3. For each remaining backtick span `` `...` `` containing a symbol from the
   list, classified it as:
   - **symbol-mention gap** — a bare (or near-bare) symbol name used as a
     noun in a sentence, e.g. `` `run_async` ``, `` `task<T>` ``. Linkable
     as-is via `cpp:symbol[]`.
   - **signature-restatement gap** — a full or partial declaration/call
     retyped in prose, e.g.
     `` `explicit read_stream(fuse f = {}, std::size_t max_read_size = std::size_t(-1))` ``
     or `` `run_async(executor, allocator)(my_task())` ``. These are the
     worst Style Guide B1 offenders — Phase 1 should replace them with a
     `cpp:` link plus, where useful, a real compiled example rather than a
     hand-typed signature.
   - Classification heuristic: spans containing `(`/`)`, `->`, or an
     embedded declaration pattern (`type name(`) were bucketed as
     signature-restatement; bare identifiers (optionally with a single
     `<...>` template argument or `::` qualification) were bucketed as
     symbol-mention. This is a pragmatic heuristic, not a parser — see
     "Known imprecision" below.

Grep used to build/cross-check the symbol source list (public headers,
non-`detail`):

```
find include/boost/capy -type f -name "*.hpp" | grep -v '/detail/'
grep -rhE '^[[:space:]]*(class|struct|concept)[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' \
    include/boost/capy/**/*.hpp include/boost/capy/*.hpp
```

Cross-check against the brief's sample grep (all matches are a subset of the
table below, confirming no page was missed):

```
grep -rnE '\b(run_async|task<|io_task|thread_pool|strand)\b' doc/modules/ROOT/pages | grep -v 'cpp:'
```

Symbol list used (54 names): `run_async`, `task`, `io_task`, `thread_pool`,
`strand`, `executor`, `executor_ref`, `any_executor`, `io_context`,
`execution_context`, `buffer`, `const_buffer`, `mutable_buffer`,
`buffer_param`, `buffer_slice`, `consuming_buffers`, `buffer_copy`,
`make_buffer`, `read_stream`, `write_stream`, `any_read_stream`,
`any_write_stream`, `any_stream`, `ReadStream`, `WriteStream`, `Stream`,
`Executor`, `ExecutionContext`, `IoAwaitable`, `IoAwaitableRange`,
`IoRunnable`, `ConstBufferSequence`, `MutableBufferSequence`, `io_result`,
`io_env`, `continuation`, `quitter`, `async_mutex`, `async_event`,
`async_waker`, `frame_allocator`, `frame_alloc_mixin`,
`recycling_memory_resource`, `work_guard`, `when_all`, `when_any`,
`read_at_least`, `write_at_least`, `this_coro`, `immediate`, `cond`, `error`,
`write_now`, `system_context`.

## Step 2 proof: the `cpp:` macro resolves

To confirm the mechanism actually works before recommending it for Phase 1,
one hand-typed mention was converted, built, and checked — then reverted
(this is the only edit made during the audit; it is **not** part of the
committed change).

- **Page:** `doc/modules/ROOT/pages/4.coroutines/4a.tasks.adoc`, line 137
- **Change:** `` `run_async` `` → `cpp:run_async[]`
- **Build command:** `cd doc && BOOST_SRC_DIR=/home/michael/git/boost npx antora --fetch local-playbook.yml` (output: `doc/build/site`, gitignored)
- **Result:** build succeeded (exit 0). Rendered HTML at
  `doc/build/site/capy/4.coroutines/4a.tasks.html` contains:

  ```html
  <a href="../reference/boost/capy/run_async-0e.html" class="xref page">run_async</a>
  ```

  and the target file `doc/build/site/capy/reference/boost/capy/run_async-0e.html`
  exists in the built site (the MrDocs-generated reference page for the
  `run_async` overload set). **PASS.**
- **Revert:** `git checkout -- doc/modules/ROOT/pages/4.coroutines/4a.tasks.adoc`;
  confirmed `git diff HEAD -- <page>` is empty afterward.

## Known imprecision

- The mention/signature split is a heuristic (paren/arrow detection), not a
  C++ parser. Spot-checked the top offenders (`why-capy.adoc`,
  `9m.WhyNotCobalt.adoc`, `9k.Executor.adoc`, `7b.mock-streams.adoc`,
  `9l.RunApi.adoc`, `4h.lambda-captures.adoc`) by hand; classifications held
  up (e.g. `` `explicit read_stream(fuse f = {}, ...)` `` correctly bucketed
  as signature-restatement, `` `ReadStream` `` correctly bucketed as
  mention). A handful of borderline calls remain, e.g. usage-syntax spans
  like `` `run_async(executor)(task)` `` are counted as
  signature-restatement even though they show call syntax rather than a
  formal declaration — Phase 1 should treat these as "convert the callable
  name to `cpp:`, keep or move the demonstrative syntax to a compiled
  example" rather than assuming a literal signature needs deleting.
- The 9.design pages (`WhyNotCobalt*`, `Executor`, `RunApi`, `WriteStream`,
  `ReadStream`, `TypeEraseAwaitable`, `CapyLayering`) and `why-capy.adoc` are
  narrative/rationale pages that reference many symbols densely in
  comparison prose — their high counts are real, not an artifact of the
  symbol list.
- Pages with 0 gaps (`2.cpp20-coroutines/*`, `3.concurrency/{.intro,3a,3b,3c}`,
  and the various `*.intro.adoc` section landing pages) were manually spot
  checked: they either discuss generic C++20 coroutine mechanics
  (`co_await`, `promise_type`) that have no Capy public-API symbol to link,
  or are short landing/TOC pages with no prose signatures.
- Not every conceivable Capy public symbol is in the 54-name list (e.g. some
  narrow buffer/concept helpers like `buffer_archetype`,
  `decomposes_to`), per the task's "pragmatic, not a perfect census"
  scoping. Re-running with an expanded list would likely raise a few counts
  slightly on buffer-heavy pages (`5.buffers/*`) but is unlikely to change
  the ranking of the top offenders.

## Per-page gap counts

| Page | Symbol-mention gaps | Signature-restatement gaps | Total | Notes / worst offenders |
|---|---|---|---|---|
| `why-capy.adoc` | 64 | 1 | 65 | worst: `run_async(executor)(my_task())` (L158) |
| `9.design/9n.WhyNotCobaltConcepts.adoc` | 49 | 0 | 49 | e.g. `IoAwaitable` |
| `9.design/9m.WhyNotCobalt.adoc` | 46 | 2 | 48 | worst: `run_async(executor, allocator)(my_task())` (L394) |
| `9.design/9k.Executor.adoc` | 41 | 1 | 42 | worst: `run_async(ex, alloc)(my_task())` (L315) |
| `9.design/9f.WriteStream.adoc` | 30 | 0 | 30 | e.g. `WriteStream` |
| `4.coroutines/4f.composition.adoc` | 26 | 1 | 27 | worst: `task<io_result<R1, R2, ..., Rn>>` (L28) |
| `4.coroutines/4d.io-awaitable.adoc` | 22 | 3 | 25 | worst: `env->executor` (L48) |
| `7.testing/7b.mock-streams.adoc` | 16 | 9 | 25 | worst: `read_stream rs(f)` (L25); also `explicit read_stream(fuse f = {}, std::size_t max_read_size = std::size_t(-1))` (L60) |
| `5.buffers/5b.types.adoc` | 24 | 0 | 24 | e.g. `const_buffer` |
| `9.design/9a.CapyLayering.adoc` | 21 | 0 | 21 | e.g. `ReadStream` |
| `9.design/9c.ReadStream.adoc` | 18 | 1 | 19 | worst: `read(stream, buffer(buf, 100))` (L155) |
| `9.design/9l.RunApi.adoc` | 10 | 9 | 19 | worst: `f(context)(task)` (L5); also `io_context::run()` (L112) |
| `5.buffers/5c.sequences.adoc` | 15 | 2 | 17 | worst: `buffer_slice(seq, offset, length)` (L89) |
| `4.coroutines/4e.cancellation.adoc` | 11 | 5 | 16 | worst: `task::handle()` (L169) |
| `9.design/9i.TypeEraseAwaitable.adoc` | 15 | 1 | 16 | worst: `io_result<std::span<const_buffer>>` (L92) |
| `9.design/9o.WhyNotTMC.adoc` | 13 | 3 | 16 | worst: `run_async(ex, allocator)` (L140) |
| `index.adoc` | 16 | 0 | 16 | e.g. `IoAwaitable` |
| `7.testing/7a.drivers.adoc` | 15 | 0 | 15 | e.g. `error::canceled` |
| `8.examples/8f.timeout-cancellation.adoc` | 11 | 3 | 14 | worst: `async_waker::wait()` (L86) |
| `4.coroutines/4b.launching.adoc` | 11 | 2 | 13 | worst: `run_async(executor)(task)` (L30) |
| `4.coroutines/4g.allocators.adoc` | 13 | 0 | 13 | e.g. `run_async` |
| `4.coroutines/4a.tasks.adoc` | 12 | 0 | 12 | e.g. `task<T>` |
| `4.coroutines/4c.executors.adoc` | 11 | 1 | 12 | worst: `run_async(ex)` (L32) |
| `6.streams/6a.overview.adoc` | 12 | 0 | 12 | e.g. `ReadStream` |
| `6.streams/6b.streams.adoc` | 11 | 0 | 11 | e.g. `ReadStream` |
| `5.buffers/5a.overview.adoc` | 10 | 0 | 10 | e.g. `ConstBufferSequence` |
| `8.examples/8a.hello-task.adoc` | 9 | 1 | 10 | worst: `run_async(pool.get_executor())` (L64) |
| `8.examples/8g.parallel-fetch.adoc` | 9 | 0 | 9 | e.g. `when_all` |
| `8.examples/8l.async-mutex.adoc` | 8 | 0 | 8 | e.g. `async_mutex` |
| `8.examples/8n.custom-executor.adoc` | 8 | 0 | 8 | e.g. `Executor` |
| `9.design/9b.Separation.adoc` | 8 | 0 | 8 | e.g. `when_all` |
| `7.testing/7e.buffer-inspection.adoc` | 7 | 0 | 7 | e.g. `ConstBufferSequence` |
| `8.examples/8b.producer-consumer.adoc` | 7 | 0 | 7 | e.g. `async_event` |
| `8.examples/8c.buffer-composition.adoc` | 7 | 0 | 7 | e.g. `std::array<const_buffer, N>` |
| `8.examples/8k.strand-serialization.adoc` | 7 | 0 | 7 | e.g. `strand` |
| `3.concurrency/3d.patterns.adoc` | 6 | 0 | 6 | e.g. `thread_pool` |
| `8.examples/8d.mock-stream-testing.adoc` | 6 | 0 | 6 | e.g. `test::read_stream` |
| `5.buffers/5e.algorithms.adoc` | 5 | 0 | 5 | e.g. `ConstBufferSequence` |
| `8.examples/8m.parallel-tasks.adoc` | 5 | 0 | 5 | e.g. `thread_pool` |
| `8.examples/8o.sender-bridge.adoc` | 5 | 0 | 5 | e.g. `io_result` |
| `4.coroutines/4h.lambda-captures.adoc` | 0 | 4 | 4 | worst: `[x]() -> task<> { use(x); }()` (L100) — all 4 are lambda/task usage snippets, not classic signatures |
| `A.specification-methods/Ab.cancellation.adoc` | 4 | 0 | 4 | e.g. `IoAwaitable` |
| `6.streams/6f.isolation.adoc` | 3 | 0 | 3 | e.g. `any_stream` |
| `8.examples/8e.type-erased-echo.adoc` | 3 | 0 | 3 | e.g. `any_stream` |
| `8.examples/8i.echo-server-corosio.adoc` | 3 | 0 | 3 | e.g. `io_context` |
| `8.examples/8p.asio-use-capy.adoc` | 3 | 0 | 3 | e.g. `IoAwaitable` |
| `A.specification-methods/Ac.contingencies.adoc` | 3 | 0 | 3 | e.g. `capy::io_result` |
| `5.buffers/5d.system-io.adoc` | 2 | 0 | 2 | e.g. `ConstBufferSequence` |
| `7.testing/7.intro.adoc` | 2 | 0 | 2 | e.g. `read_stream` |
| `quick-start.adoc` | 1 | 1 | 2 | worst: `run_async(executor)(greet())` (L46) |
| `2.cpp20-coroutines/2d.advanced.adoc` | 1 | 0 | 1 | e.g. `task<T>` |
| `2.cpp20-coroutines/2.intro.adoc` | 0 | 0 | 0 | generic-coroutine content only |
| `2.cpp20-coroutines/2a.foundations.adoc` | 0 | 0 | 0 | generic-coroutine content only |
| `2.cpp20-coroutines/2b.syntax.adoc` | 0 | 0 | 0 | generic-coroutine content only |
| `2.cpp20-coroutines/2c.machinery.adoc` | 0 | 0 | 0 | generic-coroutine content only |
| `3.concurrency/3.intro.adoc` | 0 | 0 | 0 | landing page |
| `3.concurrency/3a.foundations.adoc` | 0 | 0 | 0 | generic concurrency content only |
| `3.concurrency/3b.synchronization.adoc` | 0 | 0 | 0 | generic concurrency content only |
| `3.concurrency/3c.advanced.adoc` | 0 | 0 | 0 | generic concurrency content only |
| `4.coroutines/4.intro.adoc` | 0 | 0 | 0 | landing page |
| `5.buffers/5.intro.adoc` | 0 | 0 | 0 | landing page |
| `6.streams/6.intro.adoc` | 0 | 0 | 0 | landing page |
| `8.examples/8.intro.adoc` | 0 | 0 | 0 | landing page |
| `9.design/9.intro.adoc` | 0 | 0 | 0 | landing page |
| `A.specification-methods/A.intro.adoc` | 0 | 0 | 0 | landing page |
| **TOTAL** | **665** | **50** | **715** | |

## Phase 1 prioritization suggestion

By raw volume: `why-capy.adoc`, `9n.WhyNotCobaltConcepts.adoc`,
`9m.WhyNotCobalt.adoc`, `9k.Executor.adoc`, `9f.WriteStream.adoc` are the top
five and are all narrative/rationale pages dense with symbol mentions —
mostly bare-mention gaps, mechanically convertible to `cpp:` almost 1:1.

By worst-offender severity (signature-restatement density, the true B1
violations): `7b.mock-streams.adoc` (9 of 25), `9l.RunApi.adoc` (9 of 19),
and `4e.cancellation.adoc` (5 of 16) contain full constructor/method
signatures retyped in prose and should be prioritized for rewriting (link +
compiled example) over pages that only need mechanical `cpp:` substitution.

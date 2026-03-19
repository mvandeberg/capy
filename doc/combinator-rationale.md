# Design Rationale: capy::when_all and capy::when_any

## Context

This document captures the design space and trade-offs for
`capy::when_all` and `capy::when_any`, the concurrent combinators in
Capy that operate on I/O results. The central questions are: what
constitutes a cancellation trigger for sibling tasks, what the return
types should be, how multiple concurrent failures are resolved, and how
`when_any`'s winner is selected.

Peter Dimov contributed the normalization rule, the binary
success/failure model, "first ec wins" semantics, and the return type
proposals. Andrzej Krzemieński introduced the three-bucket classification
(success, failure, cancellation) and the framing that `error_code` is
status, not error. Vinnie Falco contributed the `ssl_stream_truncated`
counterexample, the partial transfer preservation question, and the
sender cost analysis (D4052R0, D4123R0).

## Current Consensus

The behavior is fully specified in `doc/combinator-spec.md`, which this
document serves as rationale for.

### capy::when_all

Success means `!ec`. On the first child failure, siblings are cancelled
and the error propagates. Exceptions always win over `error_code`.
Multiple concurrent errors: first wins (idempotent stop). The return type
lifts N child error codes into a single outer `ec`:

```cpp
// Three reads: io_result<size_t> each
auto [ec, n1, n2, n3] = co_await capy::when_all(
    stream.read_some(buf1),
    stream.read_some(buf2),
    stream.read_some(buf3));
```

Single-type children flatten directly into the outer parameter list.
Multi-type children wrap as `tuple<Ti...>`. Void children (`io_result<>`)
contribute `tuple<>`.

```cpp
capy::when_all(child1, child2, ..., childN)
  -> io_result<R1, R2, ..., Rn>
```

### capy::when_any

The first child to return `!ec` wins, cancels siblings, and provides
the result. If no child returns `!ec`, the variant holds `error_code`
at index 0:

```cpp
// Two tasks with different types
auto result = co_await capy::when_any(task_a, task_b);
// result: variant<error_code, size_t, message>
// index 0 → all failed; index 1 → task_a won; index 2 → task_b won
```

```cpp
capy::when_any(child1, child2, ..., childN)
  -> variant<error_code, R1, R2, ..., Rn>
```

## Background

### The I/O Compound Result

I/O primitives in Capy return `io_result{ec, T...}`: both an error code
and transferred data simultaneously. This is not a POSIX-style
single-return model. The `(error_code, size_t)` pair exists specifically
to transcend the POSIX limitation where a partial transfer before an
error must be split across two calls.

This compound result creates a question for combinators: when a child
returns `{ec, n}` with `ec != 0`, is that a failure? The naïve answer —
"inspect both `ec` and `n`" — leads to the predicate design. The
correct answer requires understanding what the primitives actually
produce.

### The Normalization Rule (Peter Dimov)

The rule that resolves the ambiguity:

> When `bytes_transferred == bytes_requested`, the primitive returns
> `({}, n)`, not `(success_code, n)`.

This is enforced at the primitive, not the combinator. By the time a
child result reaches the combinator, `!ec` is an unambiguous success
indicator. The combinator inspects only the `error_code`. It does not
interpret `T...`.

Consequence: the combinator's entire decision logic reduces to a single
boolean per child. This is what makes the design tractable.

### The Synchronous Analogy

The governing model for `when_all`:

```cpp
std::tuple result{ f1(), f2(), ..., fN() };
```

If any of `f1`...`fN` fails, you get the error — not a tuple of mixed
results. The tuple exists only on the success path. Every design question
about `when_all` should be checked against this analogy.

### The Runner Coroutine Architecture

The implementation uses a runner coroutine (`make_when_all_runner`) that
`co_await`s a child, stores the result, inspects `ec`, and decides
whether to request cancellation. The child is unaware of this policy.
This architecture solves what the P2300 sender model cannot solve without
a translation layer: the runner sees the full `{ec, n}` pair as a single
value, after the child completes, in the same coroutine frame.

P2300 splits the result across three channels: `set_value(T...)`,
`set_error(E)`, `set_stopped()`. Decomposing `io_result{ec, n}` before
crossing the sender boundary requires explicit handling at the translation
layer (P4093R0). With the translation layer applied, the gaps in sender
coverage are ergonomic differences, not structural ones.

---

## The Cancellation Trigger Question

When a child returns a non-success result, should siblings be cancelled?
Three positions were considered.

### Option C1: Cancel on Exception Only

Siblings are cancelled when a child throws. `error_code` failures do not
trigger cancellation; the combinator waits for all children to complete
naturally.

**Arguments for:**

1. A combinator with no knowledge of result semantics can only act on
   exceptions. This is the correct behavior when a non-exception result
   could mean anything.
2. Maximally general. The combinator does not impose a policy about what
   constitutes a fatal error.
3. Consistent with the P2300 model: `set_error` and `set_stopped` are
   explicit channels; `set_value` with a payload containing an error code
   is just a value.

**Arguments against:**

1. I/O failures are operational errors, not programming bugs. Waiting for
   a sibling read after another read fails with `ECONNRESET` is
   semantically wrong: the sibling is operating on the same connection.
2. In practice, callers will always want cancellation on I/O error. An
   interface that does not provide this forces every call site to add its
   own cancellation logic, recreating the combinator from scratch.
3. The premise that `error_code` is "just a value" conflicts with the
   design of `io_result`: its purpose is precisely to carry failure
   status. An `error_code` with a non-zero value is a failure signal by
   definition.

### Option C2: Cancel on error_code or Exception (chosen)

Siblings are cancelled when any child returns `ec != 0` or throws.
Success (`!ec`) never triggers cancellation.

**Arguments for:**

1. Matches the I/O semantics of the result type. The `error_code` in
   `io_result` exists to carry failure status. Treating it as a success
   trigger would invert the convention.
2. Matches the synchronous analogy: `{ f1(), f2() }` stops when `f1()`
   throws. The I/O analogue is stopping when `f1()` returns an error.
3. Enables the natural idiom without boilerplate:

   ```cpp
   auto [ec, n1, n2] = co_await capy::when_all(
       stream.read_some(buf1), stream.read_some(buf2));
   // Any read failure cancels the other and propagates here.
   ```

4. Sibling cancellation is idempotent. Multiple concurrent failures each
   request stop, but only the first error is stored. No synchronization
   complexity.

**Arguments against:**

1. Couples the combinator to I/O result semantics. A generic
   `when_all<io_result<T...>>` would have the same behavior, but the
   coupling is implicit rather than explicit.
2. Callers who want C1 semantics cannot get them without writing the
   combinator themselves.

### Option C3: Predicate-Based Cancellation

The caller supplies a predicate `bool(error_code, size_t)` that
determines whether a given result triggers cancellation.

**Arguments for:**

1. Maximally general. The caller can express any policy: cancel on any
   error, cancel only on certain error codes, never cancel.
2. Handles the `ssl_stream_truncated` case: some error codes are
   expected in certain protocols and should not cancel siblings.
3. Separates mechanism from policy.

**Arguments against:**

1. A single predicate cannot express independent policies per child.
   Peter Dimov's counterexample: `(ECONNRESET, 17)` — does the
   `error_code` matter, or the `size_t`, or both? With multiple children
   returning different types, a single predicate over all results cannot
   make child-specific decisions without becoming a discriminated union
   inspection.
2. The right abstraction for child-specific policy is the child itself.
   If a particular `error_code` should not be fatal for one child, wrap
   that child in a coroutine that transforms its result before the
   combinator sees it.
3. Proliferates API surface without providing proportional value. One
   `capy::when_all` with fixed semantics is simpler to document, test, and
   understand than a combinator family parameterized by predicates.
4. The normalization rule already resolves the hard case. Once the
   primitive guarantees `!ec` for full transfer and `ec` for anything
   else, "cancel on `ec`" is the correct policy with no exceptions.

---

## The Multiple Concurrent Errors Question

When two children fail simultaneously, which error propagates?

### Option M1: First Error Wins (chosen)

The first child to record a non-zero `ec` wins. Subsequent failures are
discarded.

**Arguments for:**

1. Implementation is straightforward: the runner uses an atomic compare-
   and-swap (or sets the error only if not already set). No vector of
   errors required.
2. Matches the synchronous analogy: `{ f1(), f2() }` reports the first
   exception. There is no mechanism to report both.
3. In practice, concurrent failures on the same I/O context are often
   causally related (e.g., connection reset propagates to all operations).
   The first error is usually the root cause; subsequent errors are
   consequences.
4. Consistent with P2300 `when_all` semantics.

**Arguments against:**

1. The choice of "first" is arbitrary; in a concurrent system the
   ordering is non-deterministic. The caller might care about a specific
   error code that happens not to be first.
2. Discards diagnostic information. In a multi-stream combinator, knowing
   that two streams failed concurrently could inform retry logic.

### Option M2: Accumulate All Errors

Store all errors; return a vector or a structured aggregate.

**Arguments for:**

1. No information loss.
2. Enables richer error handling for callers that care about which
   children failed.

**Arguments against:**

1. Requires heap allocation for the error collection.
2. The return type changes fundamentally: `io_result<R1,...,Rn>` becomes
   `io_result<R1,...,Rn, errors_t>` or similar. The synchronous analogy
   breaks.
3. Callers that do not care about multiple errors pay the allocation cost
   regardless.
4. For the common case — a failed I/O stream — the first error is almost
   always the relevant one.

---

## The Partial Transfer Preservation Question

When a child returns `{ec, n}` with `ec != 0` and `n > 0`, should the
combinator store the partial `n` or zero it out?

### Option P1: Zero Out Partial Values on Error

On any child failure, store default-constructed `T` values (or zero for
`size_t`).

**Arguments for:**

1. Cleaner contract: on the error path, value components are not
   meaningful and should not be inspected.
2. Avoids caller confusion about whether partial values are trustworthy.

**Arguments against:**

1. The return type already communicates failure via `ec`. The caller
   who checks `ec` and finds failure will not inspect the values anyway.
   The caller who wants to diagnose partial progress (e.g., to report
   how many bytes were transferred before the error) cannot do so.
2. Discarding values requires extra code in the runner for a case the
   caller rarely needs to reason about.
3. Vinnie Falco's counterexample: TLS streams may report both transferred
   bytes and a truncation error simultaneously. Zeroing out `n` loses
   information that the caller might use for diagnostic purposes.

### Option P2: Preserve Partial Values As-Is (chosen)

Store the values returned by the child, regardless of `ec`. On the error
path, partial values are available but not guaranteed meaningful.

**Arguments for:**

1. The combinator does not need to know what the values mean. Storing
   them as-is is the minimal-surprise behavior.
2. No additional logic in the runner for the error path.
3. Preserves diagnostic information. The caller sees `ec` and knows the
   operation failed; the partial values are available if the caller wants
   them and ignored if not.
4. Discarding would be the special case, not preservation.

**Arguments against:**

1. Callers may incorrectly use partial values without checking `ec`,
   thinking they are valid results.

---

## The Exception vs. error_code Priority Question

When one child throws and another returns `ec != 0`, which takes
precedence?

### Option X1: First-Wins (symmetric treatment)

Both exceptions and `error_code` failures are errors. First error wins,
regardless of whether it is an exception or an `error_code`.

**Arguments for:**

1. Symmetric treatment: both are errors; why privilege one?
2. Simpler to specify.

**Arguments against:**

1. There is no way to return a value through an exception. The outer
   `io_result` return type cannot hold both an `exception_ptr` and values.
   If an `error_code` failure wins over an exception, the exception is
   silently discarded. This is never correct.

### Option X2: Exception Always Wins (chosen)

If any child throws, the exception takes precedence over any `error_code`
failure. When multiple children throw, the first exception is captured;
others are discarded. After all children complete, the exception is
rethrown.

**Arguments for:**

1. The outer return type is `io_result<R...>`. There is no mechanism
   to carry both an exception and values through this type. If an
   exception occurs, the exception must propagate; the `io_result` path
   is not accessible.
2. Preserves the invariant: if an exception was thrown, it is always
   observable to the caller. Under X1, an `error_code` that arrives
   first could mask an exception that arrives a nanosecond later.

**Arguments against:**

1. If the program logic intends `error_code` failures as non-exceptional
   outcomes, distinguishing them from exceptions is appropriate. A
   design that treats them symmetrically is arguably more consistent with
   the `io_result` value model.

---

## The when_any Winner Selection Question

`when_any` returns the result of the "winning" child. How is the winner
selected?

### Option W1: First Completion

The first child to complete in any way — success or failure — wins.
Cancel remaining children. Return the first result.

**Arguments for:**

1. A combinator with no knowledge of result semantics would use this
   rule: the first task to complete provides the result.
2. Simple to implement and reason about.
3. Consistent with stdexec's experimental `exec::when_any`, which takes
   the first completion signal regardless of channel.

**Arguments against:**

1. In I/O, failure is common and expected. A read that fails with
   `EAGAIN` is not a winner; it is a transient condition. First-
   completion semantics would cancel a sibling that might have succeeded.
2. The synchronous analogy for `when_any` is "return the first function
   to return a good result." A function that throws or returns an error
   has not "returned a result" in the useful sense.
3. Consider an NNTP article fetch from two mirrors: if one mirror
   returns a 404-equivalent error code, the correct behavior is to wait
   for the other mirror, not to abort. First-completion semantics would
   return the failure immediately.

### Option W2: First Successful Completion (chosen)

A task wins by returning `!ec`. Exceptions and `error_code` failures do
not win. If no child returns `!ec`, there is no winner.

**Arguments for:**

1. Matches I/O semantics: the purpose of `when_any` is to get a result.
   A failed operation has not produced a result.
2. Enables the mirror/redundancy pattern naturally:

   ```cpp
   auto result = co_await capy::when_any(
       fetch_from_mirror_a(article), fetch_from_mirror_b(article));
   // Whichever mirror succeeds first wins.
   // The other's temporary failure does not abort the operation.
   ```

3. The normalization rule makes `!ec` reliable as a success indicator.
   Winner selection on `!ec` is coherent because the primitive has
   already resolved the partial-transfer ambiguity.

**Arguments against:**

1. Callers expecting first-completion semantics will be surprised.
2. If all tasks fail, the caller gets no result. The all-fail case must
   be handled.

---

## The when_any All-Fail Error Question

When all `when_any` children fail, what error code is returned?

### Option A1: First Error

The error code from the first child to fail is returned. Subsequent
errors are discarded.

**Arguments for:**

1. In some cases, the first failure is the root cause.

**Arguments against:**

1. In `when_any`, the implementation is naturally structured as: wait
   for each child; if it succeeds, done; if it fails, continue. The last
   failure is what terminates the wait. Returning the first requires
   extra bookkeeping (store on first failure only; ignore subsequent).
2. Symmetry with `when_all` "first wins" is not a valid rationale here.
   `when_all` and `when_any` treat errors differently by design; forcing
   consistency where the implementation pulls in the opposite direction
   adds cost for no benefit.

### Option A2: Last Error (chosen)

The error code from the last child to fail is returned.

**Arguments for:**

1. The natural implementation result. When the last child fails, its
   `ec` is what terminates the combinator. No extra storage or
   compare-and-swap required.
2. Matches stdexec's `exec::when_any` convention: last completion
   determines the result when there is no winner.

**Arguments against:**

1. Which child fails last is non-deterministic in a concurrent setting.
   The "last" error is as arbitrary as the "first."

The contract requires only that some error is returned when all children
fail. The choice of which error is an implementation detail, not a
design requirement. A2 is selected because it falls out of the natural
implementation without extra bookkeeping.

---

## The when_all Return Type Question

Given N children returning `io_result<Ti...>`, what does `when_all`
return?

### Option T1: Flat Tuple of All Values

Return `tuple<error_code, T1, T2, ..., Tn>` where the leading
`error_code` is the first failure (or default-constructed on success).

**Arguments for:**

1. Simple: structured bindings just work.
2. No new type needed.

**Arguments against:**

1. Does not compose as an `io_result`. The result cannot be passed to a
   function expecting `io_result<...>` without adaptation.
2. Children may have multiple value types (`io_result<T1, T2>`). Flat
   tuple representation would need to flatten all child values, losing
   the grouping by child.

### Option T2: io_result with Lifted ec (chosen)

Return `io_result<R1, R2, ..., Rn>` where the N child `error_code`s are
lifted into a single outer `ec`, and each `Ri` is:

- `Ti` directly, if child `i` returns `io_result<Ti>` (single type)
- `tuple<Ti1, Ti2, ...>` if child `i` returns `io_result<Ti1, Ti2, ...>`
- `tuple<>` if child `i` returns `io_result<>` (void result)

**Arguments for:**

1. The result is itself an `io_result`, composing with anything that
   handles `io_result`.
2. Single-type children flatten into the outer parameter list:
   `auto [ec, n1, n2, n3]` just works for three `io_result<size_t>`
   children.
3. Binary outcome: caller checks one `ec`. On success, destructures
   values. On failure, handles one error. Matches the synchronous
   analogy.
4. No redundant error codes on the success path (they were all zero).
   On the failure path, only the first matters.

**Arguments against:**

1. The flattening rules (single-type vs. multi-type vs. void) add
   specification complexity. Callers must know that a single-type
   child's value appears directly while a multi-type child's values
   appear wrapped in `tuple`.

---


## The when_any Return Type Question

How should `when_any` communicate both which child won and what it
returned?

### Option R1: Separate Index Field

Return `pair<size_t, variant<R1,...,Rn>>` or a struct with an index and
a variant of winner values.

**Arguments for:**

1. Explicit: the index is separate from the result.

**Arguments against:**

1. The index is redundant with `variant::index()`. Two pieces of state
   representing the same information.
2. More complex type. Accessing the winner requires consulting both
   the index and the variant.

### Option R2: Variant of Results, No Error

Return `optional<variant<R1,...,Rn>>` where `nullopt` means all failed.
Or return `variant<R1,...,Rn>` with an "empty" state.

**Arguments for:**

1. The variant directly encodes the winner identity via index.

**Arguments against:**

1. Loses the error code on all-fail. The caller knows all children
   failed but not why.
2. Optional-of-variant is an awkward type to destructure.

### Option R3: variant<error_code, R1,...,Rn> (chosen)

Return `variant<error_code, R1, R2, ..., Rn>` with the same `Ri`
flattening rules as `when_all`.

- Index 0 (`error_code`): failure or no winner. `get<0>(result)` is the
  error.
- Index 1..N: child `i-1` won. `get<i>(result)` is the winner's value.

**Arguments for:**

1. Winner identity via `result.index() - 1` maps directly to child
   index. No separate field.
2. Failure is always `index() == 0`. Simple check: `if (result.index()
   == 0)`.
3. The error code is preserved on all-fail. Caller can inspect why all
   children failed.
4. No redundant error codes: winners have `!ec` by definition; the child
   error code is stripped.
5. Consistent with `when_all` flattening rules. Same `Ri` rules, same
   error stripping. Different container (variant vs io_result).

**Arguments against:**

1. `error_code` at index 0 is a sentinel value inhabiting the same
   variant as result values. The type is overloaded: index 0 has a
   special meaning distinct from indices 1..N.
2. Index arithmetic (`index() - 1`) is a minor ergonomic friction.

---

## The Sender Model Question

Can `capy::when_all` and `capy::when_any` be implemented as P2300 senders
rather than coroutines?

### The Structural Gap Analysis

An earlier analysis identified 8/14 `when_all` and 7/10 `when_any`
scenarios as structural gaps for the P2300 sender model. The core issue:
P2300 splits `io_result{ec, n}` across three channels (`set_value`,
`set_error`, `set_stopped`). The combinator logic — inspect `ec`,
decide cancellation, store values — cannot be expressed in a single
sender operation that sees the full result.

The updated analysis (after introducing the P4093R0 translation layer)
concludes that there are **no structural gaps** when the translation layer
is applied. The coroutine body decomposes `io_result{ec, n}` before
crossing the sender boundary; the sender combinator then operates on
the decomposed values.

The differences that remain are **ergonomic**:

- Sender `when_all` implementation: ~1,271 lines across 27 files,
  17 steps to propagate a stop signal (from D4052R0/D4123R0 analysis).
- Coroutine runner implementation: ~210 lines in 1 file, 5 steps for
  the same stop propagation.
- Sender-based approach requires explicit translation at every
  `io_result` crossing point.
- Coroutine runner sees the full result in one place, without
  translation ceremony.

### The WG21 Cost Analysis (D4052R0/D4123R0)

The sender model imposes measurable costs when applied to tasks that
do not need its generality. D4052R0 and D4123R0 (Vinnie Falco) document
17 concessions to P3552R3 in a side-by-side comparison of two equivalent
task implementations, and a gap table showing a 6× code volume
difference. The paper is directed at WG21 to inform the cost/benefit
analysis of mandating senders.

For Capy's combinators, the relevant conclusion is: the coroutine
runner model is not a workaround for sender limitations; it is the
natural implementation for combinators that operate on I/O result types.
The translation layer (P4093R0) makes the approaches composable, not
interchangeable.

---

## Range-Based Combinators

The variadic forms of `when_all` and `when_any` have compile-time arity:
the number and types of children are fixed at instantiation. The range
forms have runtime arity: the number of children is determined at
runtime, and all children must have the same awaitable type.

The distinction is structural, not semantic. All design decisions made
above — C2 cancellation, M1 first-wins, P2 partial preservation, X2/XA2
exception priority, W2 first-success, A1 first-fail — apply unchanged to
the range forms.

### when_all Range Return Type

For variadic `when_all`, the return type is `io_result<R1,...,Rn>` where
the N child error codes are lifted into a single outer `ec`. This requires
compile-time knowledge of N and each child's type `Ri`.

With runtime arity, the child type `T` is uniform but N is not known at
compile time. A pack expansion into `io_result<T1,...,Tn>` is not
possible. The natural carrier for N homogeneous results is a vector:

- Non-void children: `io_result<std::vector<T>>`
- Void children: `io_result<>`

The same outer `ec` model applies. On failure, the outer `ec` carries the
first error (M1). On success, the vector holds one entry per child in
input order.

### when_any Range Return Type

The variadic `when_any` return type is `variant<error_code, R1,...,Rn>`.
Winner identity is encoded at the type level by variant index, and the
number of children and each child's distinct type are known at compile
time.

With runtime arity, all children share the same type `T`. The type-level
variant encoding is both impossible (runtime arity) and redundant (all
children have the same type). Winner identity must shift from the type
level to the value level.

The natural carrier: `io_result<size_t, T>`. The outer `ec` determines
success or failure; `size_t` is the winning child's index in the input
range; `T` is its value. Call site:

```cpp
auto [ec, idx, value] = co_await capy::when_any(tasks);
```

For void children, the value is absent: `io_result<size_t>`. The winner
index remains.

On failure (no child returned `!ec`), the outer `ec` holds the first
error (A1). The index and value are indeterminate.

The return type is consistent with the `io_result` model throughout:
`!ec` means success and the values are valid; `ec != 0` means failure.
No variant, no separate index field, no special-casing.

---

## Analysis

### The Normalization Rule Is the Keystone

All design questions become tractable once the normalization rule is
accepted. Without it, `when_all` must inspect both `ec` and `n` to
determine success — and no single predicate can make that determination
correctly across all child types. With it, `!ec` is unambiguous, the
combinator inspects only `error_code`, and the design collapses to a
simple binary decision.

The predicate approach (C3) was motivated by a world without the
normalization rule — where a result like `(ECONNRESET, 17)` is
ambiguous and the combinator cannot classify it without caller-supplied
logic. Peter Dimov showed that the predicate cannot resolve this
correctly: a single `bool(error_code, size_t)` sees only the final
values and cannot determine which child produced them or apply per-child
policy (see C3 for the full argument). The normalization rule eliminates
the ambiguity at the source; the primitive ensures this case cannot
arise.

### Cancel on ec Is the Only Coherent Choice

Given `!ec` as the unambiguous success indicator, the alternatives
reduce to:

- C1: wait for all children even when a failure is known. This is
  almost never what the caller wants for I/O operations.
- C2: cancel siblings on `ec`. This is the synchronous analogy applied.
- C3: predicate. Superseded by the normalization rule.

C1 is the correct behavior for a combinator with no knowledge of result
semantics — where a non-exception result could mean anything. C2 is the
correct behavior when the result type encodes failure status explicitly.
`io_result` is the latter; `ec != 0` is unambiguously failure.

### when_any Winner Selection Follows from the Use Case

The original motivation for `when_any` is parallelism for resilience:
try multiple sources, return the first to succeed. This requires W2
(first success, not first completion). W1 would make the combinator
useless for the NNTP/HTTP mirror use case that motivated it.

The difference from stdexec's experimental `exec::when_any` (which uses
W1 semantics) is a consequence of the I/O result convention. In P2300,
`set_value` carries the success result and `set_error` carries failure —
they are separate channels. In `io_result`, both travel in `set_value`.
W2 recreates that distinction at the value level, using `!ec` as the
equivalent of P2300's `set_value`.

### Return Types Follow from the Interface Contract

`io_result<R1,...,Rn>` for `when_all` and `variant<error_code,R1,...,Rn>`
for `when_any` are not independent choices — they follow from the
contracts:

- `when_all` succeeds with all children's values or fails with one
  error. An `io_result` with all values is the natural carrier.
- `when_any` succeeds with one child's values (identity unknown a priori)
  or fails. A variant that encodes the winner identity at index 1..N and
  failure at index 0 is the natural carrier.

The `Ri` flattening rules (single type → flatten, multiple types → wrap
in tuple, void → `tuple<>`) are consistent across both combinators and
follow from the goal of natural structured binding at the call site.

---

## Areas of Agreement

1. **`!ec` is the unambiguous success indicator at the combinator
   boundary.** The normalization rule ensures this. The combinator does
   not inspect `T...`.

2. **Cancel on error.** When a child returns `ec != 0`, siblings should
   be cancelled. Waiting for siblings after a known I/O failure is
   semantically wrong for the common I/O case.

3. **Exceptions always win over error codes in `when_all`.** If any
   child throws, the exception takes priority over `error_code`. There
   is no mechanism to carry an exception through `io_result`; it must
   propagate. `when_any` does not apply this rule: it treats errors and
   exceptions symmetrically — both are failures that do not win the
   race. In the all-fail case, no priority between exception and
   `error_code` is guaranteed.

4. **First ec wins for `when_all`.** Multiple concurrent failures are
   idempotent: each requests stop, but only the first error is stored.

5. **Partial values are preserved.** The combinator does not zero out
   partial values on the error path. The values are stored as-is;
   the caller determines their significance from `ec`.

6. **`when_any` winner requires `!ec`.** A failing task does not win.
   The combinator waits for the first success.

7. **The runner coroutine architecture is the correct implementation
   model.** The runner sees the full `{ec, n}` result in one place,
   after the child completes, without translation ceremony.

8. **The P4093R0 translation layer removes structural gaps.** The
   remaining differences between the sender model and the coroutine model
   are ergonomic, not structural.

9. **No custom predicates.** One `capy::when_all` and one `capy::when_any`
   with fixed semantics. Child-specific policy belongs in the child.

---

## Areas of Disagreement

1. **How much the sender model's ergonomic costs matter.** The
   coroutine runner is 6× smaller and simpler. Whether this matters
   for a library primarily targeting WG21 adoption is a strategic
   question, not a technical one.

2. **Whether the `Ri` flattening rules add too much specification
   complexity.** The rules are consistent and derivable from first
   principles, but they require callers to know that single-type children
   flatten and multi-type children wrap. One position holds this is
   natural; another holds it is a subtle rule that causes confusion at
   call sites.

4. **`error_code` at index 0 in `variant<error_code, R1,...,Rn>`.** The
   overloading of variant index 0 as a failure sentinel inhabiting the
   same type as result values mixes a status value with result values in
   one type. An alternative with an `optional<variant<R...>>` was
   considered but rejected for losing the error code.

---

## Summary

### when_all Design Decisions

| Question                        | Option Chosen      | Alternative(s) Rejected     | Reason                                    |
| ------------------------------- | ------------------ | ---------------------------- | ----------------------------------------- |
| Cancellation trigger            | C2: ec or throw    | C1: throw only, C3: predicate | Normalization rule makes `!ec` reliable  |
| Multiple concurrent errors      | M1: first wins     | M2: accumulate               | Symmetric with sync analogy; no alloc    |
| Partial values on error         | P2: preserve as-is | P1: zero out                 | Minimal-surprise; diagnostic value       |
| Exception vs ec priority        | X2: exception wins | X1: first wins               | No mechanism to return value via exception |
| Return type                     | T2: io_result<R..> | T1: flat tuple               | Composable; natural structured binding   |

### when_any Design Decisions

| Question                        | Option Chosen        | Alternative(s) Rejected       | Reason                                               |
| ------------------------------- | -------------------- | ----------------------------- | ---------------------------------------------------- |
| Winner selection                | W2: first `!ec`      | W1: first completion          | Mirror/redundancy use case requires success          |
| Exception during wait           | Continue waiting     | Exception wins immediately    | A sibling may still succeed; exception is failure   |
| All-fail: error or exception    | No priority guaranteed | —                           | Contract requires one propagates; which is unspecified |
| All-fail error code             | A2: last error       | A1: first error               | Natural implementation; no extra bookkeeping        |
| Return type                     | R3: variant<ec,R..>  | R1: index+variant, R2: no ec  | Winner identity at index; error code preserved      |

### Sender vs. Coroutine

| Property                        | Sender (P2300 + P4093) | Coroutine Runner        |
| ------------------------------- | ---------------------- | ----------------------- |
| Structural coverage             | Complete (with P4093)  | Complete                |
| Implementation size (approx.)   | ~1,271 lines / 27 files | ~210 lines / 1 file    |
| Stop propagation steps          | 17                     | 5                       |
| Translation ceremony            | Required at each boundary | None                 |
| Composability with senders      | Native                 | Via P4093 layer         |
| io_result inspection            | After decomposition    | Directly, as a value    |
# Boost.Capy Examples

This directory contains example programs demonstrating Boost.Capy usage.

## Examples

### async-mutex/

Fair FIFO coroutine locking with `async_mutex`.

Docs: [Async Mutex](../doc/modules/ROOT/pages/8.examples/8l.async-mutex.adoc)

### buffer-composition/

Composing buffer sequences without allocation for scatter/gather I/O.

Docs: [Buffer Composition](../doc/modules/ROOT/pages/8.examples/8c.buffer-composition.adoc)

### custom-executor/

Implementing the `Executor` concept with a single-threaded run loop.

Docs: [Custom Executor](../doc/modules/ROOT/pages/8.examples/8n.custom-executor.adoc)

### gui-integration/

Running a coroutine on a GUI event loop and resuming on the GUI thread.

Docs: [GUI Integration](../doc/modules/ROOT/pages/8.examples/8q.gui-integration.adoc)

### hello-task/

Minimal Capy program: a task that prints a message.

Docs: [Hello Task](../doc/modules/ROOT/pages/8.examples/8a.hello-task.adoc)

### mock-stream-testing/

Unit testing protocol code with mock streams and error injection.

Docs: [Mock Stream Testing](../doc/modules/ROOT/pages/8.examples/8d.mock-stream-testing.adoc)

### parallel-fetch/

Running multiple operations concurrently with `when_all`.

Docs: [Parallel Fetch](../doc/modules/ROOT/pages/8.examples/8g.parallel-fetch.adoc)

### parallel-tasks/

Distributing CPU-bound work across a thread pool and collecting results.

Docs: [Parallel Tasks](../doc/modules/ROOT/pages/8.examples/8m.parallel-tasks.adoc)

### producer-consumer/

Two tasks communicating via an async event.

Docs: [Producer-Consumer](../doc/modules/ROOT/pages/8.examples/8b.producer-consumer.adoc)

### quitter-shutdown/

Stopping worker coroutines on Ctrl+C with `quitter`, using a signal handler that only sets a flag.

Docs: [Quitter Shutdown](../doc/modules/ROOT/pages/8.examples/8r.quitter-shutdown.adoc)

### strand-serialization/

Protecting shared state with a strand instead of a mutex.

Docs: [Strand Serialization](../doc/modules/ROOT/pages/8.examples/8k.strand-serialization.adoc)

### timeout-cancellation/

Using stop tokens to implement operation timeouts.

Docs: [Timeout with Cancellation](../doc/modules/ROOT/pages/8.examples/8f.timeout-cancellation.adoc)

### type-erased-echo/

Echo server demonstrating the compilation firewall pattern.

Docs: [Type-Erased Echo](../doc/modules/ROOT/pages/8.examples/8e.type-erased-echo.adoc)

### when-any-cancellation/

Racing tasks with `when_any` and stopping the losers by polling their stop token.

Docs: [When-Any Cancellation](../doc/modules/ROOT/pages/8.examples/8s.when-any-cancellation.adoc)

### sender-bridge/

Awaiting a P2300 sender from a coroutine. Requires `BOOST_CAPY_BUILD_P2300_EXAMPLES=ON`.

Docs: [Bridging a P2300 Sender](../doc/modules/ROOT/pages/8.examples/8o.sender-bridge.adoc)

### awaitable-sender/

Turning a Capy awaitable into a P2300 sender. Requires `BOOST_CAPY_BUILD_P2300_EXAMPLES=ON`.

Docs: [More Examples](../doc/modules/ROOT/pages/8.examples/8t.more-examples.adoc)

### any-sender-size/

Measures the `exec::any_sender` operation state and the heap allocation its
`connect` performs, against the concrete operation state for the same
pipeline. Requires stdexec (`BOOST_CAPY_BUILD_P2300_EXAMPLES=ON`).

Docs: [More Examples](../doc/modules/ROOT/pages/8.examples/8t.more-examples.adoc)

### cuda/batched-write/

Runs the batched `write_some` of the CUDA device stream: three buffers, one
await, device holds the concatenation. Requires CUDA
(`BOOST_CAPY_BUILD_CUDA_EXAMPLES=ON`).

Docs: [More Examples](../doc/modules/ROOT/pages/8.examples/8t.more-examples.adoc)

### cuda/datamovement/

Compile-only check of the P4251R0 CUDA data-movement listings. Requires CUDA
(`BOOST_CAPY_BUILD_CUDA_EXAMPLES=ON`).

Docs: [More Examples](../doc/modules/ROOT/pages/8.examples/8t.more-examples.adoc)

### cuda/notification-strategies/

One GPU completion awaited through three notification mechanisms. Requires CUDA
(`BOOST_CAPY_BUILD_CUDA_EXAMPLES=ON`).

Docs: [More Examples](../doc/modules/ROOT/pages/8.examples/8t.more-examples.adoc)

### cuda/pipeline/

`await_sender` and `as_sender` with NVIDIA `nvexec`. Requires CUDA and stdexec;
see its README for the configure flags.

Docs: [More Examples](../doc/modules/ROOT/pages/8.examples/8t.more-examples.adoc)

### fabrics/

Compile-only check of the transport-neutral P4251R0 listings (libibverbs,
libfabric and UCX are optional).

Docs: [More Examples](../doc/modules/ROOT/pages/8.examples/8t.more-examples.adoc)

### asio/

Using Capy with Boost.Asio: `any_stream`, `asio_callbacks` and `use_capy`.
Built when a `Boost::asio` target exists.

Docs: [Calling Asio from a Capy Coroutine](../doc/modules/ROOT/pages/8.examples/8p.asio-use-capy.adoc)

### echo-server-corosio/

A complete echo server using Corosio for real network I/O. Requires Corosio;
its documentation lives in the Corosio repository.

## Building

### CMake

```bash
cmake -B build -DBOOST_CAPY_BUILD_EXAMPLES=ON
cmake --build build
```

### B2 (BJam)

```bash
b2 example
```

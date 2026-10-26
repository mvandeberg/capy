//
// Copyright (c) 2026 Michael Vandeberg
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
//
// Official repository: https://github.com/cppalliance/capy
//

#include <boost/capy/concept/execution_context.hpp>
#include <boost/capy/ex/abandon.hpp>
#include <boost/capy/cond.hpp>
#include <boost/capy/error.hpp>
#include <boost/capy/ex/async_mutex.hpp>
#include <boost/capy/ex/async_waker.hpp>
#include <boost/capy/ex/await_context.hpp>
#include <boost/capy/ex/execution_context.hpp>
#include <boost/capy/ex/run_async.hpp>
#include <boost/capy/quitter.hpp>
#include <boost/capy/results.hpp>
#include <boost/capy/task.hpp>

#include <chrono>
#include <cstddef>
#include <cstdio>
#include <iomanip>
#include <iostream>
#include <stop_token>
#include <system_error>
#include <tuple>

#include "quitter_proto.hpp"

/* Benchmarks for the quitter-on-abandonment proposal
   (docs/superpowers/specs/2026-10-26-quitter-abandonment-design.md, §6.3).

   Three families, each run for every coroutine type under test:

   loop   One coroutine doing N `co_await yield_awaitable{}`. Every await
          is a real executor round trip, so this is the worst case for a
          per-suspension overhead.
   entry  A task awaiting K short children, each doing one yield. This
          measures what it costs to start and finish a child.
   stop   A chain of depth D whose leaf waits on an async_waker that is
          never woken. Only the time from request_stop() until run()
          returns is measured; building and parking the chain is not.

   queue_context is a single-threaded FIFO: post() links the continuation
   through its `reserved` slot and run() drains the queue. dispatch()
   returns the handle, so a completion on the right executor resumes
   inline, as in a real I/O context.

   Each line prints `<name> <ns> ns/op`, where one op is one whole loop,
   one whole entry run, or one stop. */

using namespace boost::capy;

//-----------------------------------------------
//
// Queue Context
//
//-----------------------------------------------

class queue_context : public execution_context
{
    continuation* head_ = nullptr;
    continuation* tail_ = nullptr;

public:
    class executor_type;

    queue_context()
        : execution_context(this)
    {
    }

    ~queue_context()
    {
        // Anything still queued will never run.
        while(auto* c = pop())
            boost::capy::abandon(*c);
        shutdown();
        destroy();
    }

    executor_type
    get_executor() noexcept;

    void
    enqueue(continuation& c) noexcept
    {
        c.reserved = nullptr;
        if(tail_)
            tail_->reserved = &c;
        else
            head_ = &c;
        tail_ = &c;
    }

    std::size_t
    run_one()
    {
        auto* c = pop();
        if(!c)
            return 0;
        c->h.resume();
        return 1;
    }

    void
    run()
    {
        while(run_one())
        {
        }
    }

private:
    continuation*
    pop() noexcept
    {
        auto* c = head_;
        if(!c)
            return nullptr;
        head_ = static_cast<continuation*>(c->reserved);
        if(!head_)
            tail_ = nullptr;
        return c;
    }
};

class queue_context::executor_type
{
    queue_context* ctx_;

public:
    explicit executor_type(queue_context& ctx) noexcept
        : ctx_(&ctx)
    {
    }

    queue_context& context() const noexcept
    {
        return *ctx_;
    }

    bool operator==(executor_type const& other) const noexcept
    {
        return ctx_ == other.ctx_;
    }

    void on_work_started() const noexcept {}
    void on_work_finished() const noexcept {}

    std::coroutine_handle<> dispatch(continuation& c) const
    {
        return c.h;
    }

    void post(continuation& c) const
    {
        ctx_->enqueue(c);
    }
};

inline queue_context::executor_type
queue_context::get_executor() noexcept
{
    return executor_type(*this);
}

static_assert(Executor<queue_context::executor_type>);
static_assert(ExecutionContext<queue_context>);

//-----------------------------------------------
//
// Yield Awaitable
//
// Always suspends and posts the awaiting
// coroutine to its executor: exactly one real
// executor round trip.
//
//-----------------------------------------------

struct yield_awaitable
{
    continuation c_;

    bool await_ready() const noexcept
    {
        return false;
    }

    std::coroutine_handle<> await_suspend(
        std::coroutine_handle<> h,
        await_context const* env)
    {
        c_.h = h;
        c_.owner = env->owner;
        env->executor.post(c_);
        return std::noop_coroutine();
    }

    void await_resume() const noexcept
    {
    }
};

static_assert(ContextAwaitable<yield_awaitable>);

//-----------------------------------------------
//
// Harness (as in bench.cpp)
//
//-----------------------------------------------

static void
print_result(char const* name, double per_op)
{
    std::cout << std::left << std::setw(40) << name
              << std::right << std::setw(10) << std::fixed << std::setprecision(1)
              << per_op << " ns/op\n";
}

template<class F>
void run_benchmark(
    char const* name,
    std::size_t iterations,
    F&& f)
{
    // Warmup
    for(std::size_t i = 0; i < 1000; ++i)
        f();

    auto start = std::chrono::high_resolution_clock::now();

    for(std::size_t i = 0; i < iterations; ++i)
        f();

    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::nanoseconds>(end - start);
    print_result(name, duration.count() / static_cast<double>(iterations));
}

// Like run_benchmark, but `f` returns the part of its run to count, so
// that setup is excluded.
template<class F>
void run_timed_benchmark(
    char const* name,
    std::size_t iterations,
    F&& f)
{
    for(std::size_t i = 0; i < 1000; ++i)
        f();

    std::chrono::nanoseconds total{0};
    for(std::size_t i = 0; i < iterations; ++i)
        total += f();
    print_result(name, total.count() / static_cast<double>(iterations));
}

//-----------------------------------------------
//
// Prototype self-checks
//
// Run before any timing: numbers for a
// prototype that does not do what the spec says
// are worthless.
//
//-----------------------------------------------

namespace proto {

namespace {

struct guard
{
    bool* destroyed;

    ~guard()
    {
        *destroyed = true;
    }
};

// What the parent of the quitter saw when it resumed.
struct seen
{
    bool resumed = false;
    std::error_code ec;
};

// Awaits `q` and records what it delivered, then runs `at_resume`. A
// stop that arrives as an exception, as from today's quitter, leaves
// `ec` empty, so the checks that expect `canceled` fail on it.
template<class Q, class F>
task<> parent(Q q, seen& s, F at_resume)
{
    try
    {
        auto r = co_await std::move(q);
        s.ec = std::get<0>(r);
    }
    catch(...)
    {
    }
    s.resumed = true;
    at_resume();
}

template<class Q>
task<> parent(Q q, seen& s)
{
    return parent(std::move(q), s, []{});
}

// Runs `t` until nothing is queued, requests the stop, and drains again.
void
run_then_stop(queue_context& ctx, std::stop_source& ss, task<> t)
{
    run_async(ctx.get_executor(), ss.get_token())(std::move(t));
    ctx.run();
    ss.request_stop();
    ctx.run();
}

quitter<results<std::size_t>>
three_yields()
{
    co_await yield_awaitable{};
    co_await yield_awaitable{};
    co_await yield_awaitable{};
    co_return results<std::size_t>{std::error_code{}, 42};
}

task<>
unstopped_parent(seen& s, std::size_t& n)
{
    auto [ec, v] = co_await three_yields();
    s.ec = ec;
    n = v;
    s.resumed = true;
}

bool
check_unstopped_value()
{
    queue_context ctx;
    std::stop_source ss;
    seen s;
    std::size_t n = 0;
    s.ec = make_error_code(error::canceled);
    run_then_stop(ctx, ss, unstopped_parent(s, n));
    return s.resumed && !s.ec && n == 42;
}

quitter<>
wait_on(async_waker& w)
{
    auto [ec] = co_await w.wait();
    co_return results<>{ec};
}

bool
check_stop_delivers_canceled()
{
    queue_context ctx;
    async_waker w;
    std::stop_source ss;
    seen s;
    run_then_stop(ctx, ss, parent(wait_on(w), s));
    return s.resumed && s.ec == cond::canceled;
}

quitter<>
guarded_wait(async_waker& w, bool& destroyed, bool& reached)
{
    guard g{&destroyed};
    auto [ec] = co_await w.wait();
    (void)ec;
    reached = true;
    co_return results<>{};
}

bool
check_frames_not_resumed()
{
    queue_context ctx;
    async_waker w;
    std::stop_source ss;
    seen s;
    bool destroyed = false;
    bool reached = false;
    bool destroyed_at_resume = false;
    run_then_stop(ctx, ss, parent(guarded_wait(w, destroyed, reached), s,
        [&]{ destroyed_at_resume = destroyed; }));
    return s.resumed && !reached && destroyed_at_resume;
}

quitter<>
catch_all_wait(async_waker& w, bool& hit)
{
    try
    {
        auto [ec] = co_await w.wait();
        (void)ec;
    }
    catch(...)
    {
        hit = true;
    }
    co_return results<>{};
}

bool
check_catch_all_never_runs()
{
    queue_context ctx;
    async_waker w;
    std::stop_source ss;
    seen s;
    bool hit = false;
    run_then_stop(ctx, ss, parent(catch_all_wait(w, hit), s));
    return s.resumed && !hit && s.ec == cond::canceled;
}

struct coop_state
{
    bool task_finished = false;
    bool quitter_alive_then = false;
    bool quitter_destroyed = false;
};

task<results<>>
coop_task(async_waker& w, coop_state& st)
{
    auto [ec] = co_await w.wait();
    st.task_finished = true;
    st.quitter_alive_then = !st.quitter_destroyed;
    co_return results<>{ec};
}

quitter<>
coop_quitter(async_waker& w, coop_state& st)
{
    guard g{&st.quitter_destroyed};
    auto [ec] = co_await coop_task(w, st);
    (void)ec;
    co_return results<>{};
}

bool
check_task_below_cooperates()
{
    queue_context ctx;
    async_waker w;
    std::stop_source ss;
    seen s;
    coop_state st;
    run_then_stop(ctx, ss, parent(coop_quitter(w, st), s));
    return s.resumed && s.ec == cond::canceled &&
        st.task_finished && st.quitter_alive_then && st.quitter_destroyed;
}

quitter<>
lock_after_stop(async_mutex& mtx, std::stop_source& ss)
{
    ss.request_stop();
    auto [ec, g] = co_await mtx.scoped_lock();
    (void)ec;
    co_return results<>{};
}

bool
check_stop_pending_skips_inner()
{
    queue_context ctx;
    async_mutex mtx;
    std::stop_source ss;
    seen s;
    run_then_stop(ctx, ss, parent(lock_after_stop(mtx, ss), s));
    return s.resumed && s.ec == cond::canceled && !mtx.is_locked();
}

// Reports ready, and requests the stop from inside await_ready, so the
// stop arrives after the inner awaitable has completed.
struct stop_while_ready_awaitable
{
    std::stop_source& ss;
    bool& resumed;

    bool await_ready() noexcept
    {
        ss.request_stop();
        return true;
    }

    std::coroutine_handle<>
    await_suspend(std::coroutine_handle<> h, await_context const*) noexcept
    {
        return h;
    }

    void await_resume() noexcept
    {
        resumed = true;
    }
};

quitter<>
ready_then_stop(std::stop_source& ss, bool& resumed, bool& reached)
{
    co_await stop_while_ready_awaitable{ss, resumed};
    co_await yield_awaitable{};
    reached = true;
    co_return results<>{};
}

bool
check_ready_then_stop_runs_await_resume()
{
    queue_context ctx;
    std::stop_source ss;
    seen s;
    bool resumed = false;
    bool reached = false;
    run_then_stop(ctx, ss, parent(ready_then_stop(ss, resumed, reached), s));
    return s.resumed && s.ec == cond::canceled && resumed && !reached;
}

} // namespace

bool
self_check()
{
    struct entry
    {
        char const* name;
        bool (*fn)();
    };
    entry const checks[] = {
        {"unstopped_value", check_unstopped_value},
        {"stop_delivers_canceled", check_stop_delivers_canceled},
        {"frames_not_resumed", check_frames_not_resumed},
        {"catch_all_never_runs", check_catch_all_never_runs},
        {"task_below_cooperates", check_task_below_cooperates},
        {"stop_pending_skips_inner", check_stop_pending_skips_inner},
        {"ready_then_stop_runs_await_resume",
            check_ready_then_stop_runs_await_resume},
    };
    bool all = true;
    for(auto const& c : checks)
    {
        bool const ok = c.fn();
        std::cout << "PROTO " << c.name << (ok ? " ok\n" : " FAIL\n");
        all = all && ok;
    }
    return all;
}

} // namespace proto

//-----------------------------------------------
//
// Coroutines under test
//
// Each body is a template on its own return
// type, so task and every quitter run the same
// code.
//
//-----------------------------------------------

template<class Coro>
Coro loop_body(std::size_t n)
{
    for(std::size_t i = 0; i < n; ++i)
        co_await yield_awaitable{};
    co_return results<>{};
}

template<class Coro>
Coro entry_child()
{
    co_await yield_awaitable{};
    co_return results<>{};
}

template<class Coro>
task<> entry_parent(std::size_t k)
{
    for(std::size_t i = 0; i < k; ++i)
        (void)co_await entry_child<Coro>();
}

// The leaf waits on a waker nobody wakes; only a stop ends it. A task
// frame checks the error code and returns it, as cooperative code does.
template<class Coro>
Coro stop_chain(async_waker& w, int depth)
{
    if(depth == 1)
    {
        auto [ec] = co_await w.wait();
        co_return results<>{ec};
    }
    auto [ec] = co_await stop_chain<Coro>(w, depth - 1);
    if(ec)
        co_return results<>{ec};
    co_return results<>{};
}

// Today's quitter reports a stop to a task by throwing; catching it is
// part of what the stop costs.
template<class Coro>
task<> drive(Coro c)
{
    try
    {
        (void)co_await std::move(c);
    }
    catch(...)
    {
    }
}

//-----------------------------------------------
//
// Families
//
//-----------------------------------------------

constexpr std::size_t loop_n = 1000;
constexpr std::size_t entry_k = 1000;
constexpr int stop_depths[] = {1, 8, 64};

template<class Coro>
void bench_loop(queue_context& ctx, char const* variant)
{
    char name[64];
    std::snprintf(name, sizeof(name), "loop %s N=%zu", variant, loop_n);
    auto ex = ctx.get_executor();
    run_benchmark(name, 20000, [&]{
        run_async(ex)(drive(loop_body<Coro>(loop_n)));
        ctx.run();
    });
}

template<class Coro>
void bench_entry(queue_context& ctx, char const* variant)
{
    char name[64];
    std::snprintf(name, sizeof(name), "entry %s K=%zu", variant, entry_k);
    auto ex = ctx.get_executor();
    run_benchmark(name, 5000, [&]{
        run_async(ex)(entry_parent<Coro>(entry_k));
        ctx.run();
    });
}

template<class Coro>
void bench_stop(queue_context& ctx, char const* variant)
{
    auto ex = ctx.get_executor();
    for(int d : stop_depths)
    {
        char name[64];
        std::snprintf(name, sizeof(name), "stop %s D=%d", variant, d);
        run_timed_benchmark(name, 10000, [&]{
            std::stop_source ss;
            async_waker w;
            run_async(ex, ss.get_token())(drive(stop_chain<Coro>(w, d)));
            ctx.run();
            auto start = std::chrono::steady_clock::now();
            ss.request_stop();
            ctx.run();
            return std::chrono::steady_clock::now() - start;
        });
    }
}

int main()
{
    if(!proto::self_check())
        return 1;

    queue_context ctx;

    for(int rep = 0; rep < 5; ++rep)
    {
        std::cout << "=== repetition " << rep + 1 << " ===\n";

        bench_loop<task<results<>>>(ctx, "task");
        bench_loop<quitter<results<>>>(ctx, "quitter-exc");
        bench_loop<proto::quitter<results<>>>(ctx, "quitter-abandon");

        bench_entry<task<results<>>>(ctx, "task");
        bench_entry<quitter<results<>>>(ctx, "quitter-exc");
        bench_entry<proto::quitter<results<>>>(ctx, "quitter-abandon");

        bench_stop<task<results<>>>(ctx, "task-ec");
        bench_stop<quitter<results<>>>(ctx, "quitter-exc");
        bench_stop<proto::quitter<results<>>>(ctx, "quitter-abandon");
    }
    return 0;
}

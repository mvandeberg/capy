//
// Copyright (c) 2026 Michael Vandeberg
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
//
// Official repository: https://github.com/cppalliance/capy
//

// Compiled fragments shown in pages/4.coroutines/4m.synchronization.adoc.
// Pages include the tagged regions; scaffolding stays outside the tags.

/* Every test runs its coroutines on a thread_pool with one thread, which
   meets the rule that waiters of one primitive run on one executor. That
   thread also makes the order deterministic: run_async posts each start
   to the pool, so coroutines begin in the order they were launched, and a
   coroutine runs until it suspends. A "probe" coroutine launched after a
   waiter therefore runs once the waiter is suspended, which lets a test
   thread act on a waiter that is known to be queued. pool.join() waits
   for every coroutine to finish before the assertions run.

   Tests only await call expressions directly, such as
   `co_await ready.wait()`. They never store or move an awaiter. */

#include "../doc_warnings.hpp"

// GCC gives false positive -Wmaybe-uninitialized on structured bindings
// via the tuple protocol inside coroutine frames.
#if defined(__GNUC__) && !defined(__clang__)
#pragma GCC diagnostic ignored "-Wmaybe-uninitialized"
#endif

#include <boost/capy/cond.hpp>
#include <boost/capy/ex/async_event.hpp>
#include <boost/capy/ex/async_mutex.hpp>
#include <boost/capy/ex/async_waker.hpp>
#include <boost/capy/ex/run_async.hpp>
#include <boost/capy/ex/thread_pool.hpp>
#include <boost/capy/results.hpp>
#include <boost/capy/task.hpp>

#include <exception>
#include <latch>
#include <stop_token>
#include <system_error>
#include <thread>
#include <vector>

#include "test_suite.hpp"

namespace capy = boost::capy;

namespace {

// What a waiter observed, so a test can check it after the pool joins.
struct outcome
{
    bool done = false;
    std::error_code ec;
};

// Launch a task on the pool with no stop token.
template<class Task>
void launch(capy::thread_pool& pool, Task&& task)
{
    capy::run_async(pool.get_executor(),
        [] {}, [](std::exception_ptr) {})(std::forward<Task>(task));
}

// Launch a task on the pool under a stop token.
template<class Task>
void launch(capy::thread_pool& pool, std::stop_token token, Task&& task)
{
    capy::run_async(pool.get_executor(), token,
        [] {}, [](std::exception_ptr) {})(std::forward<Task>(task));
}

// Runs after every coroutine launched before it has suspended or finished.
capy::task<> probe(std::latch& reached)
{
    reached.count_down();
    co_return;
}

// tag::event[]
capy::task<> wait_for_ready(capy::async_event& ready, outcome& seen)
{
    auto [ec] = co_await ready.wait();  // suspends until set() or a stop
    seen.ec = ec;
    seen.done = true;
}

capy::task<> announce(capy::async_event& ready)
{
    ready.set();  // resumes every waiter through its executor
    co_return;
}
// end::event[]

capy::task<> check_event_state(
    capy::async_event& ready, bool& set_after_set, bool& set_after_clear)
{
    ready.set();
    set_after_set = ready.is_set();
    ready.clear();
    set_after_clear = ready.is_set();
    co_return;
}

capy::task<> set_then_wait(capy::async_event& ready, outcome& seen)
{
    ready.set();
    auto [ec] = co_await ready.wait();  // already set: completes at once
    seen.ec = ec;
    seen.done = true;
}

// tag::mutex[]
capy::task<> update(
    capy::async_mutex& mtx, int id, std::vector<int>& order)
{
    auto [ec, guard] = co_await mtx.scoped_lock();
    if(ec)
        co_return;  // canceled: the guard holds no lock
    order.push_back(id);
}   // the guard's destructor unlocks, and the next waiter resumes
// end::mutex[]

// Holds the mutex across a suspension until `release` is set.
capy::task<> hold_until(
    capy::async_mutex& mtx, capy::async_event& release)
{
    auto [ec, guard] = co_await mtx.scoped_lock();
    co_await release.wait();
}

capy::task<> open_gate(capy::async_event& release)
{
    release.set();
    co_return;
}

capy::task<> lock_when_free(
    capy::async_mutex& mtx, outcome& seen, bool& locked_inside)
{
    auto [ec, guard] = co_await mtx.scoped_lock();
    seen.ec = ec;
    seen.done = true;
    locked_inside = mtx.is_locked();
}

capy::task<> lock_canceled(
    capy::async_mutex& mtx, capy::async_event& release,
    outcome& seen, bool& locked_after)
{
    auto [ec, guard] = co_await mtx.scoped_lock();
    seen.ec = ec;
    seen.done = true;
    locked_after = mtx.is_locked();
    release.set();  // let the holder finish
}

// tag::waker[]
capy::task<> wait_for_signal(capy::async_waker& waker, outcome& seen)
{
    auto [ec] = co_await waker.wait();  // woken, or canceled by a stop
    seen.ec = ec;
    seen.done = true;
}
// end::waker[]

// Wakes twice, then waits twice: the first wait is satisfied by the
// latched token, and the second finds none.
capy::task<> wake_twice_wait_twice(
    capy::async_waker& waker, outcome& first, outcome& second)
{
    waker.wake();
    waker.wake();
    auto [ec1] = co_await waker.wait();
    first.ec = ec1;
    first.done = true;
    auto [ec2] = co_await waker.wait();
    second.ec = ec2;
    second.done = true;
}

capy::task<> note_state(outcome const& seen, bool& done_at_probe)
{
    done_at_probe = seen.done;
    co_return;
}

struct synchronization_test
{
    // set() resumes every waiter, and is_set() and clear() track the flag.
    void testEventBroadcast()
    {
        capy::thread_pool pool(1);
        capy::async_event ready;
        outcome first;
        outcome second;
        bool set_after_set = false;
        bool set_after_clear = true;

        launch(pool, wait_for_ready(ready, first));
        launch(pool, wait_for_ready(ready, second));
        launch(pool, announce(ready));
        launch(pool, check_event_state(
            ready, set_after_set, set_after_clear));
        pool.join();

        BOOST_TEST(first.done);
        BOOST_TEST(! first.ec);
        BOOST_TEST(second.done);
        BOOST_TEST(! second.ec);
        BOOST_TEST(set_after_set);
        BOOST_TEST(! set_after_clear);
    }

    // The event is already set, so a stop request that precedes the wait
    // does not cancel it.
    void testEventSetBeforeWaitIgnoresStop()
    {
        capy::thread_pool pool(1);
        capy::async_event ready;
        outcome seen;
        std::stop_source src;
        src.request_stop();

        launch(pool, src.get_token(), set_then_wait(ready, seen));
        pool.join();

        BOOST_TEST(seen.done);
        BOOST_TEST(! seen.ec);
    }

    // A stop request completes a waiter that is still queued.
    void testEventCanceledWhileQueued()
    {
        capy::thread_pool pool(1);
        capy::async_event ready;
        outcome seen;
        std::stop_source src;
        std::latch reached{1};

        launch(pool, src.get_token(), wait_for_ready(ready, seen));
        launch(pool, probe(reached));
        reached.wait();
        src.request_stop();
        pool.join();

        BOOST_TEST(seen.done);
        BOOST_TEST(seen.ec == capy::cond::canceled);
        BOOST_TEST(! ready.is_set());
    }

    // Waiters acquire the mutex in the order they called scoped_lock().
    void testMutexFifo()
    {
        capy::thread_pool pool(1);
        capy::async_mutex mtx;
        capy::async_event release;
        std::vector<int> order;

        launch(pool, hold_until(mtx, release));
        launch(pool, update(mtx, 1, order));
        launch(pool, update(mtx, 2, order));
        launch(pool, update(mtx, 3, order));
        launch(pool, open_gate(release));
        pool.join();

        BOOST_TEST_EQ(order.size(), 3u);
        if(order.size() == 3)
        {
            BOOST_TEST_EQ(order[0], 1);
            BOOST_TEST_EQ(order[1], 2);
            BOOST_TEST_EQ(order[2], 3);
        }
        BOOST_TEST(! mtx.is_locked());
    }

    // A free mutex is acquired even when a stop request precedes the call.
    void testMutexFreeIgnoresStop()
    {
        capy::thread_pool pool(1);
        capy::async_mutex mtx;
        outcome seen;
        bool locked_inside = false;
        std::stop_source src;
        src.request_stop();

        launch(pool, src.get_token(),
            lock_when_free(mtx, seen, locked_inside));
        pool.join();

        BOOST_TEST(seen.done);
        BOOST_TEST(! seen.ec);
        BOOST_TEST(locked_inside);
        BOOST_TEST(! mtx.is_locked());
    }

    // A stopped waiter gets cancellation and the holder keeps the lock.
    void testMutexCanceledWaiter()
    {
        capy::thread_pool pool(1);
        capy::async_mutex mtx;
        capy::async_event release;
        outcome seen;
        bool locked_after = false;
        std::stop_source src;
        std::latch reached{1};

        launch(pool, hold_until(mtx, release));
        launch(pool, src.get_token(),
            lock_canceled(mtx, release, seen, locked_after));
        launch(pool, probe(reached));
        reached.wait();
        src.request_stop();
        pool.join();

        BOOST_TEST(seen.done);
        BOOST_TEST(seen.ec == capy::cond::canceled);
        BOOST_TEST(locked_after);
        BOOST_TEST(! mtx.is_locked());
    }

    // Two wakes with no waiter latch one token: the first wait() returns
    // at once, and the second suspends until a third wake().
    void testWakerCollapsesWakes()
    {
        capy::thread_pool pool(1);
        capy::async_waker waker;
        outcome first;
        outcome second;
        bool second_done_at_probe = true;
        std::latch reached{1};

        launch(pool, wake_twice_wait_twice(waker, first, second));
        launch(pool, note_state(second, second_done_at_probe));
        launch(pool, probe(reached));
        reached.wait();

        BOOST_TEST(first.done);
        BOOST_TEST(! first.ec);
        BOOST_TEST(! second_done_at_probe);

        waker.wake();
        pool.join();

        BOOST_TEST(second.done);
        BOOST_TEST(! second.ec);
    }

    // wake() is the one operation that any thread may call.
    void testWakerCrossThread()
    {
        capy::thread_pool pool(1);
        capy::async_waker waker;
        outcome seen;
        std::latch reached{1};

        launch(pool, wait_for_signal(waker, seen));
        launch(pool, probe(reached));
        reached.wait();

        // tag::waker_cross_thread[]
        std::thread notifier([&waker] { waker.wake(); });
        notifier.join();
        // end::waker_cross_thread[]
        pool.join();

        BOOST_TEST(seen.done);
        BOOST_TEST(! seen.ec);
    }

    void run()
    {
        testEventBroadcast();
        testEventSetBeforeWaitIgnoresStop();
        testEventCanceledWhileQueued();
        testMutexFifo();
        testMutexFreeIgnoresStop();
        testMutexCanceledWaiter();
        testWakerCollapsesWakes();
        testWakerCrossThread();
    }
};

} // namespace

TEST_SUITE(synchronization_test, "boost.capy.doc.4m_synchronization");

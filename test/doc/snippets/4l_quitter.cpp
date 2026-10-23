//
// Copyright (c) 2026 Michael Vandeberg
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
//
// Official repository: https://github.com/cppalliance/capy
//

// Compiled fragments shown in pages/4.coroutines/4l.quitter.adoc. Pages
// include the tagged regions; scaffolding stays outside the tags.

/* Every test parks its quitters on a capy::async_waker that nothing ever
   wakes, so only a stop request can complete the wait. The pool has one
   thread, which meets the waker's rule that continuations never run
   concurrently. A std::latch in worker_log tells the test thread that the
   body has reached its wait, and pool.join() waits for run_async to
   deliver the completion, so each test observes a finished coroutine.

   The `launch` tag has two regions. Asciidoctor joins every region of a
   tag, so the page shows run_async followed by request_stop, while the
   test waits for the worker to reach its wait in between. That keeps the
   stop on the "suspended in wait()" path instead of racing the start. */

#include "../doc_warnings.hpp"

// tag::include_quitter[]
#include <boost/capy/quitter.hpp>
// end::include_quitter[]

#include <boost/capy/ex/async_waker.hpp>
#include <boost/capy/ex/run_async.hpp>
#include <boost/capy/ex/this_coro.hpp>
#include <boost/capy/ex/thread_pool.hpp>
#include <boost/capy/results.hpp>
#include <boost/capy/task.hpp>
#include <boost/capy/when_all.hpp>
#include <boost/capy/when_any.hpp>

#include <exception>
#include <latch>
#include <stop_token>

#include "test_suite.hpp"

namespace capy = boost::capy;

namespace {

// Records what a worker body did, so a test can check it afterward.
struct worker_log
{
    std::latch waiting{1};
    bool started_waiting = false;
    bool opened = false;          // the body ran its first statement
    bool closed = false;          // connection's destructor ran
    bool handled = false;         // the body resumed after a wait
    bool swallowed = false;       // a catch(...) in the body caught the stop
    bool parent_saw_stop = false; // a task parent caught the stopped worker

    void wait_started()
    {
        if(started_waiting)
            return;
        started_waiting = true;
        waiting.count_down();
    }

    void work_handled()
    {
        handled = true;
    }
};

// Stands in for an RAII resource such as a socket.
struct connection
{
    worker_log& log;

    explicit connection(worker_log& l)
        : log(l)
    {
        log.opened = true;
    }

    ~connection()
    {
        log.closed = true;
    }
};

// tag::worker[]
capy::quitter<> worker(capy::async_waker& work_ready, worker_log& log)
{
    connection conn(log);  // closed by its destructor, even on a stop

    for(;;)
    {
        log.wait_started();
        co_await work_ready.wait();  // no ec check: a stop never resumes here
        log.work_handled();
    }
}
// end::worker[]

// tag::mixing[]
capy::task<> supervisor(capy::async_waker& work_ready, worker_log& log)
{
    // Read the token first: a catch handler cannot co_await.
    auto token = co_await capy::this_coro::stop_token;
    try
    {
        co_await worker(work_ready, log);
    }
    catch(...)
    {
        // A stopped quitter reaches a task parent as an exception.
        if(! token.stop_requested())
            throw;                   // a genuine failure: pass it on
        log.parent_saw_stop = true;  // the shutdown: carry on
    }
}
// end::mixing[]

// tag::catch_all[]
// WRONG: the catch-all swallows the stop request.
capy::quitter<> careless(capy::async_waker& work_ready, worker_log& log)
{
    log.wait_started();
    try
    {
        co_await work_ready.wait();
    }
    catch(...)
    {
        log.swallowed = true;    // the stop lands here
    }
    co_await work_ready.wait();  // the stop is still requested: stops here
    log.work_handled();
}
// end::catch_all[]

// A when_all child: when_all needs children that return results.
capy::quitter<capy::results<>>
waiting_child(capy::async_waker& work_ready, worker_log& log)
{
    log.wait_started();
    auto r = co_await work_ready.wait();
    log.work_handled();
    co_return r;
}

capy::quitter<int> answer()
{
    co_return 42;
}

struct quitter_test
{
    // Stop while the body is suspended in wait(): the body unwinds,
    // the destructor runs, and run_async calls the error handler.
    void testStopUnwindsBody()
    {
        capy::thread_pool pool(1);
        capy::async_waker work_ready;
        worker_log log;
        std::stop_source src;
        int values = 0;
        int errors = 0;
        std::exception_ptr error;

        capy::run_async(pool.get_executor(), src.get_token(),
            [&] { ++values; },
            [&](std::exception_ptr ep) { ++errors; error = ep; })(
                worker(work_ready, log));
        log.waiting.wait();
        src.request_stop();
        pool.join();

        BOOST_TEST(log.opened);
        BOOST_TEST(log.closed);
        BOOST_TEST(! log.handled);
        BOOST_TEST_EQ(values, 0);
        BOOST_TEST_EQ(errors, 1);
        BOOST_TEST(error != nullptr);
    }

    // A stop requested before the start: the first statement never runs.
    void testStopBeforeStart()
    {
        capy::thread_pool pool(1);
        capy::async_waker work_ready;
        worker_log log;
        std::stop_source src;
        src.request_stop();
        int values = 0;
        int errors = 0;
        std::exception_ptr error;

        capy::run_async(pool.get_executor(), src.get_token(),
            [&] { ++values; },
            [&](std::exception_ptr ep) { ++errors; error = ep; })(
                worker(work_ready, log));
        pool.join();

        BOOST_TEST(! log.opened);
        BOOST_TEST(! log.closed);
        BOOST_TEST_EQ(values, 0);
        BOOST_TEST_EQ(errors, 1);
        BOOST_TEST(error != nullptr);
    }

    // The shutdown pattern shown on the page.
    void testRunAsyncStoppedGoesToErrorHandler()
    {
        capy::thread_pool pool(1);
        auto ex = pool.get_executor();
        capy::async_waker work_ready;
        worker_log log;
        int finished = 0;
        int shutdowns = 0;
        std::exception_ptr failure;

        // tag::launch[]
        std::stop_source src;

        auto on_done = [&] { ++finished; };
        auto on_error = [&](std::exception_ptr ep)
        {
            // A stopped quitter completes here, not in on_done.
            if(src.stop_requested())
                ++shutdowns;   // the shutdown we asked for
            else
                failure = ep;  // a genuine error: report it
        };

        capy::run_async(ex, src.get_token(), on_done, on_error)(
            worker(work_ready, log));
        // end::launch[]

        log.waiting.wait();

        // tag::launch[]

        // Later, from any thread, to shut down:
        src.request_stop();
        // end::launch[]

        pool.join();

        BOOST_TEST_EQ(finished, 0);
        BOOST_TEST_EQ(shutdowns, 1);
        BOOST_TEST(failure == nullptr);
        BOOST_TEST(log.closed);
        BOOST_TEST(! log.handled);
    }

    // Without a stop request, a quitter delivers its value like a task.
    void testNoStopBehavesLikeTask()
    {
        capy::thread_pool pool(1);
        std::stop_source src;
        int value = 0;
        int errors = 0;

        capy::run_async(pool.get_executor(), src.get_token(),
            [&](int v) { value = v; },
            [&](std::exception_ptr) { ++errors; })(answer());
        pool.join();

        BOOST_TEST_EQ(value, 42);
        BOOST_TEST_EQ(errors, 0);
    }

    // A task awaiting a stopped quitter catches an exception, with the
    // stop token already requested.
    void testTaskParentSeesException()
    {
        capy::thread_pool pool(1);
        capy::async_waker work_ready;
        worker_log log;
        std::stop_source src;
        int values = 0;
        int errors = 0;

        capy::run_async(pool.get_executor(), src.get_token(),
            [&] { ++values; },
            [&](std::exception_ptr) { ++errors; })(
                supervisor(work_ready, log));
        log.waiting.wait();
        src.request_stop();
        pool.join();

        // parent_saw_stop is set only inside catch(...), and only when
        // the token reports the stop; otherwise the task rethrows.
        BOOST_TEST(log.parent_saw_stop);
        BOOST_TEST(log.closed);
        BOOST_TEST(! log.handled);
        BOOST_TEST_EQ(values, 1);
        BOOST_TEST_EQ(errors, 0);
    }

    // when_all of stopped quitters throws to its task awaiter.
    void testWhenAllOfStoppedQuittersThrows()
    {
        capy::thread_pool pool(1);
        capy::async_waker ready1;
        capy::async_waker ready2;
        worker_log log1;
        worker_log log2;
        std::stop_source src;
        bool caught = false;
        bool returned = false;
        int errors = 0;

        auto parent = [&]() -> capy::task<>
        {
            try
            {
                auto r = co_await capy::when_all(
                    waiting_child(ready1, log1),
                    waiting_child(ready2, log2));
                (void)r;
                returned = true;
            }
            catch(...)
            {
                caught = true;
            }
        };

        capy::run_async(pool.get_executor(), src.get_token(),
            [] {},
            [&](std::exception_ptr) { ++errors; })(parent());
        log1.waiting.wait();
        log2.waiting.wait();
        src.request_stop();
        pool.join();

        BOOST_TEST(caught);
        BOOST_TEST(! returned);
        BOOST_TEST(! log1.handled);
        BOOST_TEST(! log2.handled);
        BOOST_TEST_EQ(errors, 0);
    }

    // when_any of quitters that all stop: no child wins, every failure
    // is an exception, so the awaiter sees one rethrown.
    void testWhenAnyOfStoppedQuittersThrows()
    {
        capy::thread_pool pool(1);
        capy::async_waker ready1;
        capy::async_waker ready2;
        worker_log log1;
        worker_log log2;
        std::stop_source src;
        bool caught = false;
        bool returned = false;
        int errors = 0;

        auto parent = [&]() -> capy::task<>
        {
            try
            {
                auto r = co_await capy::when_any(
                    waiting_child(ready1, log1),
                    waiting_child(ready2, log2));
                (void)r;
                returned = true;
            }
            catch(...)
            {
                caught = true;
            }
        };

        capy::run_async(pool.get_executor(), src.get_token(),
            [] {},
            [&](std::exception_ptr) { ++errors; })(parent());
        log1.waiting.wait();
        log2.waiting.wait();
        src.request_stop();
        pool.join();

        BOOST_TEST(caught);
        BOOST_TEST(! returned);
        BOOST_TEST(! log1.handled);
        BOOST_TEST(! log2.handled);
        BOOST_TEST_EQ(errors, 0);
    }

    // A catch(...) around a co_await swallows the stop; the next
    // co_await stops the body again.
    void testCatchAllInterceptsStop()
    {
        capy::thread_pool pool(1);
        capy::async_waker work_ready;
        worker_log log;
        std::stop_source src;
        int errors = 0;

        capy::run_async(pool.get_executor(), src.get_token(),
            [] {},
            [&](std::exception_ptr) { ++errors; })(
                careless(work_ready, log));
        log.waiting.wait();
        src.request_stop();
        pool.join();

        BOOST_TEST(log.swallowed);
        BOOST_TEST(! log.handled);
        BOOST_TEST_EQ(errors, 1);
    }

    // this_coro queries never check the stop token; the next real
    // co_await does.
    void testThisCoroTagDoesNotStop()
    {
        capy::thread_pool pool(1);
        capy::async_waker work_ready;
        std::stop_source src;
        bool after_tag = false;
        bool tag_saw_stop = false;
        bool after_wait = false;

        auto body = [&]() -> capy::quitter<>
        {
            src.request_stop();
            auto t = co_await capy::this_coro::stop_token;
            after_tag = true;
            tag_saw_stop = t.stop_requested();
            co_await work_ready.wait();
            after_wait = true;
        };

        capy::run_async(pool.get_executor(), src.get_token(),
            [] {}, [](std::exception_ptr) {})(body());
        pool.join();

        BOOST_TEST(after_tag);
        BOOST_TEST(tag_saw_stop);
        BOOST_TEST(! after_wait);
    }

    // An operation that is already complete does not suspend, and the
    // stop check still runs before the body sees its result.
    void testStopWinsOverReadyOperation()
    {
        capy::thread_pool pool(1);
        capy::async_waker work_ready;
        std::stop_source src;
        bool after_wait = false;

        auto body = [&]() -> capy::quitter<>
        {
            src.request_stop();
            work_ready.wake();  // latch a token: the next wait() is ready
            co_await work_ready.wait();
            after_wait = true;
        };

        capy::run_async(pool.get_executor(), src.get_token(),
            [] {}, [](std::exception_ptr) {})(body());
        pool.join();

        BOOST_TEST(! after_wait);
    }

    // With no error handler the stop is discarded; a value-only handler
    // is never called; a handler that accepts exception_ptr is called.
    void testStopWithoutErrorHandler()
    {
        auto run_stopped = [](auto&&... handlers)
        {
            capy::thread_pool pool(1);
            capy::async_waker work_ready;
            worker_log log;
            std::stop_source src;
            src.request_stop();
            capy::run_async(pool.get_executor(), src.get_token(),
                handlers...)(worker(work_ready, log));
            pool.join();
        };

        run_stopped();  // returning at all shows nothing terminated

        int value_calls = 0;
        run_stopped([&] { ++value_calls; });
        BOOST_TEST_EQ(value_calls, 0);

        int generic_calls = 0;
        run_stopped([&](auto&&...) { ++generic_calls; });
        BOOST_TEST_EQ(generic_calls, 1);
    }

    void run()
    {
        testStopWithoutErrorHandler();
        testStopUnwindsBody();
        testStopBeforeStart();
        testRunAsyncStoppedGoesToErrorHandler();
        testNoStopBehavesLikeTask();
        testTaskParentSeesException();
        testWhenAllOfStoppedQuittersThrows();
        testWhenAnyOfStoppedQuittersThrows();
        testCatchAllInterceptsStop();
        testThisCoroTagDoesNotStop();
        testStopWinsOverReadyOperation();
    }
};

} // namespace

TEST_SUITE(quitter_test, "boost.capy.doc.4l_quitter");

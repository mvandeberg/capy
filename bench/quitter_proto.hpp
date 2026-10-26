//
// Copyright (c) 2026 Michael Vandeberg
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
//
// Official repository: https://github.com/cppalliance/capy
//

#ifndef BOOST_CAPY_BENCH_QUITTER_PROTO_HPP
#define BOOST_CAPY_BENCH_QUITTER_PROTO_HPP

#include <boost/capy/concept/context_awaitable.hpp>
#include <boost/capy/continuation.hpp>
#include <boost/capy/detail/await_suspend_helper.hpp>
#include <boost/capy/error.hpp>
#include <boost/capy/ex/abandon.hpp>
#include <boost/capy/ex/await_context.hpp>
#include <boost/capy/ex/context_awaitable_promise_base.hpp>
#include <boost/capy/ex/frame_alloc_mixin.hpp>
#include <boost/capy/ex/frame_allocator.hpp>
#include <boost/capy/results.hpp>

#include <coroutine>
#include <exception>
#include <optional>
#include <type_traits>
#include <utility>

/* Prototype: a quitter that stops by abandonment
   (docs/superpowers/specs/2026-10-26-quitter-abandonment-design.md, §3).

   Benchmark-only. It is co_await-able from a task; launchers are out of
   scope.

   Segment. A proto::quitter awaited by anything but another
   proto::quitter opens a segment in its await_suspend (§3.4). The
   segment is one coroutine frame, `segment`, which is both:
   - the owner: its chain_owner is bound to it, and the segment's
     await_context names that chain_owner, so a holder that abandons any
     coroutine in the segment posts this frame; and
   - the gate (§3.3): every quitter frame in the segment awaits its inner
     operation with the segment's handle as the continuation instead of
     its own, and the segment decides, when resumed, what happens next.
   A quitter awaited by a quitter joins the parent's segment: it gets the
   same environment and gate, and its final transfer goes straight to the
   parent frame, bypassing the gate.

   Every time the segment is resumed it decides, in this order:
   1. abandoned (by the gate's own stop, or by a holder's teardown):
      release and destroy the top quitter frame, which destroys the frames
      below it. After a stop, hand the parent the canceled value; after a
      teardown, abandon the parent, as run's boundary_trampoline does.
   2. the top quitter frame is done: transfer to the parent.
   3. stop requested: the operation is done with the waiting frame and the
      gate now holds it, so abandon the segment (a post of this frame).
   4. otherwise: transfer to the frame that was waiting.
   The owner tells a stop from a teardown with its own `stopped_` flag,
   written before chain_owner::abandon(), whose post publishes it.

   Why the segment is never resumed while it is running. Its body is
   `for(;;) co_await hop{}`, and all four decisions are made inside
   hop::await_suspend, that is, after the frame has suspended. Its handle
   is only ever reachable from three places: an operation the waiting
   quitter frame started (case 4 hands control to that frame, which starts
   the next operation only after the segment has suspended), the top
   quitter's final transfer, and the chain_owner's post. Each fires at
   most once per suspension, because only one quitter frame in a segment
   awaits an operation at a time, and the owner's post happens only when
   no operation holds it (case 3, or a holder that gave it up). Once
   await_suspend has handed the handle on (by returning it, resuming a
   target inline, or posting), it touches nothing of the frame again.

   Synchronous completions (§3.3). The stop is checked before the inner
   await_ready. A ready inner awaitable, an inner await_suspend returning
   false, and one returning the segment's own handle all continue to the
   inner await_resume without a gate hop. On builds with
   BOOST_CAPY_SYMMETRIC_TRANSFER_WORKAROUND, the inner await_ready is asked
   from inside await_suspend, as detail::await_ready_then_suspend does;
   that helper is not called because it cannot recognise the segment's
   handle coming back. */

namespace proto {

namespace capy = boost::capy;

template<class T = capy::results<>>
struct quitter;

namespace detail {

template<class T>
struct is_quitter : std::false_type {};

template<class T>
struct is_quitter<quitter<T>> : std::true_type {};

template<class T>
struct stopped_value;

template<class... Ts>
struct stopped_value<capy::results<Ts...>>
{
    static capy::results<Ts...> get()
    {
        return {make_error_code(capy::error::canceled), Ts{}...};
    }
};

// What the segment needs of the quitter that opened it, without its T.
struct quitter_base
{
    std::coroutine_handle<> h_;
    bool stopped_ = false;
};

struct segment
{
    struct promise_type : capy::frame_alloc_mixin
    {
        capy::chain_owner owner_;
        capy::await_context env_;
        capy::continuation parent_;
        std::coroutine_handle<> target_;
        quitter_base* q_ = nullptr;
        bool stopped_ = false;
        // An unwind is still owed. Cleared before the parent is resumed
        // or abandoned, and by the quitter when it destroys the segment.
        bool active_ = false;

        ~promise_type()
        {
            // Destroyed instead of resumed: a closed executor discarded the
            // post. That is teardown, whatever the cause (§3.4).
            if(active_)
            {
                active_ = false;
                destroy_top();
                auto parent = parent_;
                capy::abandon(parent);
            }
        }

        segment get_return_object() noexcept
        {
            return segment{
                std::coroutine_handle<promise_type>::from_promise(*this)};
        }

        std::suspend_always initial_suspend() noexcept { return {}; }
        std::suspend_always final_suspend() noexcept { return {}; }
        void return_void() noexcept {}
        void unhandled_exception() noexcept { std::terminate(); }

        std::coroutine_handle<> handle() noexcept
        {
            return std::coroutine_handle<promise_type>::from_promise(*this);
        }

        // Called by the gate, or by a quitter frame that finds a stop
        // pending before it starts an operation. Holds the waiting frame.
        void abandon_for_stop() noexcept
        {
            stopped_ = true;
            owner_.abandon();
        }

        void destroy_top() noexcept
        {
            auto h = std::exchange(q_->h_, nullptr);
            h.destroy();
        }

        std::coroutine_handle<> decide() noexcept
        {
            if(owner_.abandoned())
            {
                active_ = false;
                destroy_top();
                if(stopped_)
                {
                    q_->stopped_ = true;
                    return parent_.h;
                }
                auto parent = parent_;
                capy::abandon(parent);
                return std::noop_coroutine();
            }
            if(q_->h_.done())
            {
                active_ = false;
                return parent_.h;
            }
            if(env_.stop_token.stop_requested())
            {
                abandon_for_stop();
                return std::noop_coroutine();
            }
            return target_;
        }
    };

    struct hop
    {
        bool await_ready() const noexcept { return false; }

        auto await_suspend(
            std::coroutine_handle<promise_type> h) noexcept
        {
            return capy::detail::symmetric_transfer(h.promise().decide());
        }

        void await_resume() const noexcept {}
    };

    std::coroutine_handle<promise_type> h_;
};

inline segment
make_segment()
{
    for(;;)
        co_await segment::hop{};
}

} // namespace detail

template<class T>
struct [[nodiscard]] quitter : detail::quitter_base
{
    struct promise_type
        : capy::context_awaitable_promise_base<promise_type>
    {
        std::optional<T> result_;
        std::exception_ptr ep_;
        detail::segment::promise_type* seg_ = nullptr;

        quitter get_return_object() noexcept
        {
            return quitter{
                std::coroutine_handle<promise_type>::from_promise(*this)};
        }

        auto initial_suspend() noexcept
        {
            struct awaiter
            {
                promise_type* p_;
                bool await_ready() const noexcept { return false; }
                void await_suspend(std::coroutine_handle<>) const noexcept {}
                void await_resume() const noexcept
                {
                    capy::set_current_frame_allocator(
                        p_->environment()->frame_allocator);
                }
            };
            return awaiter{this};
        }

        auto final_suspend() noexcept
        {
            struct awaiter
            {
                promise_type* p_;
                bool await_ready() const noexcept { return false; }
                std::coroutine_handle<> await_suspend(
                    std::coroutine_handle<>) const noexcept
                {
                    return p_->continuation();
                }
                void await_resume() const noexcept {}
            };
            return awaiter{this};
        }

        void return_value(T v)
        {
            result_ = std::move(v);
        }

        void unhandled_exception() noexcept
        {
            ep_ = std::current_exception();
        }

        // co_await of an ordinary ContextAwaitable: through the gate.
        template<class Awaitable>
        struct transform_awaiter
        {
            std::decay_t<Awaitable> a_;
            promise_type* p_;
            bool skipped_ = false;

#if BOOST_CAPY_SYMMETRIC_TRANSFER_WORKAROUND
            bool await_ready() const noexcept
            {
                return false;
            }

            template<class Promise>
            bool await_suspend(std::coroutine_handle<Promise> h) noexcept
            {
                auto* seg = p_->seg_;
                auto const* env = p_->environment();
                if(env->stop_token.stop_requested())
                {
                    seg->abandon_for_stop();
                    return true;
                }
                if(a_.await_ready())
                    return false;
                seg->target_ = h;
                auto gate = seg->handle();
                using R = decltype(a_.await_suspend(gate, env));
                if constexpr(std::is_same_v<R, bool>)
                {
                    return a_.await_suspend(gate, env);
                }
                else if constexpr(std::is_void_v<R>)
                {
                    a_.await_suspend(gate, env);
                    return true;
                }
                else
                {
                    std::coroutine_handle<> r = a_.await_suspend(gate, env);
                    if(r == gate)
                        return false;
                    capy::detail::symmetric_transfer(r);
                    return true;
                }
            }
#else
            bool await_ready() noexcept
            {
                if(p_->environment()->stop_token.stop_requested())
                {
                    skipped_ = true;
                    return false;
                }
                return a_.await_ready();
            }

            template<class Promise>
            std::coroutine_handle<> await_suspend(
                std::coroutine_handle<Promise> h) noexcept
            {
                auto* seg = p_->seg_;
                if(skipped_)
                {
                    seg->abandon_for_stop();
                    return std::noop_coroutine();
                }
                auto const* env = p_->environment();
                seg->target_ = h;
                auto gate = seg->handle();
                // After the inner await_suspend the gate may already have
                // run and destroyed this frame: use locals only.
                using R = decltype(a_.await_suspend(gate, env));
                if constexpr(std::is_same_v<R, bool>)
                {
                    if(!a_.await_suspend(gate, env))
                        return h;
                    return std::noop_coroutine();
                }
                else if constexpr(std::is_void_v<R>)
                {
                    a_.await_suspend(gate, env);
                    return std::noop_coroutine();
                }
                else
                {
                    std::coroutine_handle<> r = a_.await_suspend(gate, env);
                    if(r == gate)
                        return h;
                    return r;
                }
            }
#endif

            decltype(auto) await_resume()
            {
                capy::set_current_frame_allocator(
                    p_->environment()->frame_allocator);
                return a_.await_resume();
            }
        };

        // co_await of a quitter: the child joins this segment.
        template<class Q>
        struct join_awaiter
        {
            Q q_;
            promise_type* p_;

            bool await_ready() const noexcept
            {
                return false;
            }

            template<class Promise>
            auto await_suspend(std::coroutine_handle<Promise> h) noexcept
            {
                auto* seg = p_->seg_;
                if(p_->environment()->stop_token.stop_requested())
                {
                    seg->abandon_for_stop();
                    return capy::detail::symmetric_transfer(
                        std::noop_coroutine());
                }
                auto& cp = q_.promise();
                cp.seg_ = seg;
                cp.set_environment(p_->environment());
                cp.set_continuation(h);
                return capy::detail::symmetric_transfer(q_.h_);
            }

            decltype(auto) await_resume()
            {
                capy::set_current_frame_allocator(
                    p_->environment()->frame_allocator);
                return q_.take_result();
            }
        };

        template<class Awaitable>
        auto transform_awaitable(Awaitable&& a)
        {
            using A = std::decay_t<Awaitable>;
            if constexpr(detail::is_quitter<A>::value)
            {
                return join_awaiter<A>{std::forward<Awaitable>(a), this};
            }
            else
            {
                static_assert(capy::ContextAwaitable<A>,
                    "requires ContextAwaitable");
                return transform_awaiter<Awaitable>{
                    std::forward<Awaitable>(a), this};
            }
        }
    };

    quitter(quitter&& other) noexcept
        : quitter_base{std::exchange(other.h_, nullptr), other.stopped_}
        , seg_(std::exchange(other.seg_, {}))
    {
    }

    quitter(quitter const&) = delete;
    quitter& operator=(quitter const&) = delete;
    quitter& operator=(quitter&&) = delete;

    ~quitter()
    {
        if(h_)
            h_.destroy();
        if(seg_.h_)
        {
            seg_.h_.promise().active_ = false;
            seg_.h_.destroy();
        }
    }

    bool await_ready() const noexcept
    {
        return false;
    }

    // Opens a segment. The quitter must not move until it is resumed.
    std::coroutine_handle<> await_suspend(
        std::coroutine_handle<> cont,
        capy::await_context const* env)
    {
        // The body never starts, and the parent gets the canceled value.
        if(env->stop_token.stop_requested())
        {
            stopped_ = true;
            return cont;
        }
        seg_ = detail::make_segment();
        auto& sp = seg_.h_.promise();
        sp.owner_.bind(seg_.h_, env->executor);
        sp.env_.executor = env->executor;
        sp.env_.stop_token = env->stop_token;
        sp.env_.frame_allocator = env->frame_allocator;
        sp.env_.owner = &sp.owner_;
        sp.parent_.h = cont;
        sp.parent_.owner = env->owner;
        sp.q_ = this;
        sp.active_ = true;
        auto& p = promise();
        p.seg_ = &sp;
        p.set_environment(&sp.env_);
        p.set_continuation(seg_.h_);
        return h_;
    }

    T await_resume()
    {
        if(stopped_)
            return detail::stopped_value<T>::get();
        return take_result();
    }

private:
    template<class>
    friend struct quitter;

    detail::segment seg_{};

    explicit quitter(std::coroutine_handle<promise_type> h) noexcept
        : quitter_base{h}
    {
    }

    promise_type& promise() const noexcept
    {
        return std::coroutine_handle<promise_type>::from_address(
            h_.address()).promise();
    }

    T take_result()
    {
        auto& p = promise();
        if(p.ep_)
            std::rethrow_exception(p.ep_);
        return std::move(*p.result_);
    }
};

} // namespace proto

#endif

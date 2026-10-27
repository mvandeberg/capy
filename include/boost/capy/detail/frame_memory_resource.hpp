//
// Copyright (c) 2025 Vinnie Falco (vinnie.falco@gmail.com)
// Copyright (c) 2026 Michael Vandeberg
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
//
// Official repository: https://github.com/cppalliance/capy
//

#ifndef BOOST_CAPY_DETAIL_FRAME_MEMORY_RESOURCE_HPP
#define BOOST_CAPY_DETAIL_FRAME_MEMORY_RESOURCE_HPP

#include <boost/capy/detail/config.hpp>

#include <cstddef>
#include <memory>
#include <memory_resource>
#include <type_traits>

namespace boost {
namespace capy {
namespace detail {

/** Wrapper that adapts a standard Allocator to memory_resource.

    This wrapper is used to store value-type allocators in the
    execution context or trampoline frame. It rebinds the allocator
    to `std::max_align_t` and allocates whole units of it, so every
    block is aligned for any frame. A standard allocator takes no
    alignment argument, and one rebound to `std::byte` may pack blocks
    at byte alignment.

    Alignments above `alignof(std::max_align_t)` are not supported.

    @tparam Alloc The standard allocator type.
*/
template<class Alloc>
class frame_memory_resource : public std::pmr::memory_resource
{
    using traits = std::allocator_traits<Alloc>;
    using unit_alloc =
        typename traits::template rebind_alloc<std::max_align_t>;
    using unit_traits = std::allocator_traits<unit_alloc>;

    static_assert(
        requires { typename traits::value_type; },
        "Alloc must satisfy allocator requirements");

    static_assert(
        std::is_copy_constructible_v<Alloc>,
        "Alloc must be copy constructible");

    unit_alloc alloc_;

    static std::size_t
    units(std::size_t bytes) noexcept
    {
        return (bytes + sizeof(std::max_align_t) - 1) /
            sizeof(std::max_align_t);
    }

public:
    /** Construct from an allocator.

        The allocator is rebind-copied to `std::max_align_t`.

        @param a The allocator to adapt.
    */
    explicit
    frame_memory_resource(Alloc const& a)
        : alloc_(a)
    {
    }

    /** Get the memory resource pointer.

        @return Pointer to this memory resource.
    */
    std::pmr::memory_resource* get() noexcept { return this; }

protected:
    void*
    do_allocate(std::size_t bytes, std::size_t alignment) override
    {
        BOOST_CAPY_ASSERT(alignment <= alignof(std::max_align_t));
        (void)alignment;
        return unit_traits::allocate(alloc_, units(bytes));
    }

    void
    do_deallocate(void* p, std::size_t bytes, std::size_t) override
    {
        unit_traits::deallocate(
            alloc_, static_cast<std::max_align_t*>(p), units(bytes));
    }

    bool
    do_is_equal(const memory_resource& other) const noexcept override
    {
        return this == &other;
    }
};

} // namespace detail
} // namespace capy
} // namespace boost

#endif

//
// Copyright (c) 2026 Steve Gerbino
// Copyright (c) 2026 Michael Vandeberg
//
// Distributed under the Boost Software License, Version 1.0. (See accompanying
// file LICENSE_1_0.txt or copy at http://www.boost.org/LICENSE_1_0.txt)
//
// Official repository: https://github.com/cppalliance/capy
//

// Test that header file is self-contained.
#include <boost/capy/detail/frame_memory_resource.hpp>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <memory_resource>

#include "test_suite.hpp"

namespace boost {
namespace capy {
namespace detail {

class frame_memory_resource_test
{
public:
    void
    run()
    {
        frame_memory_resource<std::allocator<int>> fmr{
            std::allocator<int>{}};

        std::pmr::memory_resource* mr = fmr.get();
        BOOST_TEST(mr == &fmr);

        // do_allocate / do_deallocate round trip through the resource.
        void* p = mr->allocate(64, alignof(std::max_align_t));
        BOOST_TEST(p != nullptr);
        mr->deallocate(p, 64, alignof(std::max_align_t));

        // do_is_equal: identity only.
        frame_memory_resource<std::allocator<int>> other{
            std::allocator<int>{}};
        BOOST_TEST(mr->is_equal(*mr));
        BOOST_TEST(! mr->is_equal(*other.get()));

        testAlignmentHonored();
    }

    // A byte allocator over a bump resource packs allocations at
    // byte alignment; frames still need alignof(max_align_t).
    void
    testAlignmentHonored()
    {
        std::pmr::monotonic_buffer_resource upstream;
        frame_memory_resource<std::pmr::polymorphic_allocator<std::byte>>
            fmr{&upstream};
        std::pmr::memory_resource* mr = fmr.get();

        constexpr std::size_t align = alignof(std::max_align_t);
        void* p1 = mr->allocate(align + 8, align);
        void* p2 = mr->allocate(align + 8, align);
        BOOST_TEST_EQ(reinterpret_cast<std::uintptr_t>(p1) % align, 0u);
        BOOST_TEST_EQ(reinterpret_cast<std::uintptr_t>(p2) % align, 0u);
        mr->deallocate(p2, align + 8, align);
        mr->deallocate(p1, align + 8, align);
    }
};

TEST_SUITE(frame_memory_resource_test, "boost.capy.detail.frame_memory_resource");

} // detail
} // capy
} // boost

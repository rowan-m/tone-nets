## 2024-05-30 - Memoizing noteToSemitone

**Learning:** `noteToSemitone` is called very frequently (e.g., inside loops mapping edges, calculating intervals, generating pitch classes for 3D visualization). Memoizing this simple string-to-number transformation or removing its regex dramatically increases performance by nearly 14x for cached values, avoiding repeated allocations and regex evaluations.
**Action:** Use a memoization Map for simple pure functions that are called thousands of times inside visualization loops.

## 2024-05-18 - Optimized Dijkstra's Algorithm in Network Parsing

**Learning:** The previous implementation of `dijkstraDistances` within `networkParser.js` used a naive array combined with `Array.prototype.sort()` to emulate a priority queue. This operation forces an O(E log E) sort during every vertex exploration loop, resulting in drastic overhead when graphing heavily populated MIDI files.
**Action:** Replace faux priority queues with an explicit `MinHeap` class containing O(log E) `push`/`pop` operations. This is a common performance bottleneck in JS-based graph algorithms where a native PriorityQueue/Heap does not exist.

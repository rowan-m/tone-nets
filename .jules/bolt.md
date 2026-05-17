## 2024-05-17 - Iterating Maps vs Iterating Keys

**Learning:** When dealing with sparse properties stored in Maps (like node distances in a graph after BFS/Dijkstra where many components might be unreachable), it's far faster to iterate over `Map.values()` directly. Previously, `NetworkParser._sumEfficiencyForNode` iterated over all vertices in the graph and did `Map.get(targetNode)`, resulting in O(V^2) overall complexity because it iterated over many unreachable nodes needlessly and incurred high Map lookup overhead. Directly iterating the values scales the operation to O(V * reachable_nodes) and eliminates Map key lookups, resulting in an ~18-19x speedup on disconnected or sparse graphs.

**Action:** Whenever iterating over a populated Map to sum or aggregate its values (and the keys are not strictly needed to coordinate with an external structure), use `for (const value of map.values())` instead of iterating a superset array of keys and doing a `.get()`.

## 2025-02-23 - [ngraph.graph Traversal Optimization]
**Learning:** `ngraph.graph`'s `forEachLinkedNode` defaults to iterating over both incoming and outgoing edges for directed graphs. In scenarios where only outgoing edges are needed (e.g., Dijkstra, BFS, Entropy calculation), manually checking `link.fromId === u` is inefficient.
**Action:** Always pass `true` as the third argument (`graph.forEachLinkedNode(u, callback, true)`) to restrict iteration to outgoing edges, significantly reducing loop overhead in dense networks.

# Incremental MIDI Network Visualization Plan

This document outlines the multi-stage implementation of the "Incremental Build" mode for Tone Nets.

## Goals
- Add a toggle between "Static" (analyze first) and "Incremental" (build while playing) modes.
- Real-time graph growth and dynamic 3D layout during playback.
- Modular, reusable code following TDD.
- Maintain high performance (no stuttering).

---

## Stage 1: Refactor for Modularity (Complete)
- [x] Refactor `NetworkParser` to expose helper methods for incremental updates.
- [x] Refactor `NetworkVisualizer` to support dynamic node/edge creation.
- [x] Decouple `NetworkVisualizer`'s rendering from the full graph initialization.

## Stage 2: Implement Incremental Visualizer Logic (Complete)
- [x] Support continuous layout simulation in `NetworkVisualizer.animate()`.
- [x] Implement `NetworkVisualizer.addNode(id, data)` to dynamically create Three.js objects.
- [x] Implement `NetworkVisualizer.addEdge(fromId, toId, data)` to dynamically create lines/cones.
- [x] Implement `NetworkVisualizer.updateElement(id, type, newData)` to reflect weight changes (e.g., node scale, edge color).

## Stage 3: UI and State Management (Complete)
- [x] Add "Incremental Mode" toggle to `index.html`.
- [x] Update `main.js` to handle mode selection.
- [x] Implement the "Incremental" orchestration:
    - Load MIDI metadata only.
    - Start `MidiPlayer`.
    - Catch `onNotePlay` and update the visualizer/graph in real-time.

## Stage 4: Performance & Refinement (Complete)
- [x] Throttle layout steps if graph becomes too large (Done via physics settings and native rAF).
- [x] Implement "Cooling" logic for the layout when no new notes are added for a while (Managed by `ngraph.forcelayout` physics).
- [x] Ensure `MidiPlayer` hooks don't block the main thread.

## Stage 5: Validation & TDD (Complete)
- [x] Write unit tests for incremental graph updates.
- [x] Verify that metrics are NOT calculated in incremental mode to save perf.
- [x] Cross-browser performance testing.

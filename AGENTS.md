# Agent Context: Tone Nets

This project is a high-performance 3D visualization of musical networks, based on the Nature paper ["Decoding the evolution of melodic and harmonic structure of Western music through the lens of network science"](https://www.nature.com/articles/s41598-026-42872-7).

## 🛡️ Mandatory Workflow (Finality Gate)

Before completing any task, you **MUST** follow this sequence. A task is not complete until all these steps pass:

1.  **Strict TDD**: Write a failing test co-located with the source (e.g., `MyModule.test.js`) before implementation.
2.  **Implementation**: Write clean, modular Vanilla JS (ES Modules).
3.  **Local Validation**: Run `npm test src/js/MyModule.test.js` to verify your specific change.
4.  **Finality Gate**: Run `npm run check`. This is the **Source of Truth**. It executes:
    - `prettier`: Formatting check.
    - `eslint`: Linting and security analysis.
    - `vitest`: Full test suite with coverage enforcement (80% lines/funcs/stmts, 65% branches).
    - `vite build`: Production build verification.

**Failure to run `npm run check` and resolve all reported issues (including coverage drops) is a breach of the project's engineering standards.**

## 🏗️ Architecture Overview

The application is an orchestrator-based system managed by `main.js`. Subsystems are decoupled:

1.  **Network Parser & Metrics (`NetworkParser.js`, `NetworkMetrics.js`)**:
    - **Logic**: Offloaded to `parser.worker.js` (Web Worker) to keep the UI thread smooth.
    - **Scientific Parity**:
        - Chord-to-chord transitions based on exact MIDI ticks.
        - Skips self-loops ($w_{xx} = 0$).
        - Excludes MIDI Channel 10 (drums).
    - **Metrics**: Efficiency, Reciprocity, Entropy, Scale-interval Embedding.

2.  **3D Visualizer (`NetworkVisualizer.js`)**:
    - **Engine**: Three.js (Orthographic Camera).
    - **Layout**: `ngraph.forcelayout` in 3D.
    - **Visuals**: Quadratic Bezier edges, pitch-class coloring, instanced rendering for performance.
    - **Tour Mode**: Uses camera-aligned AABB projections for tight bounding and optimal zoom.

3.  **Visual Effects (`VisualEffectsManager.js`)**:
    - **Shaders**: Manages bloom, CRT effects, and background visualizations.
    - **Feedback**: Handles real-time spectrum analysis (equalizer) and interactive emojis.

4.  **Audio Engine (`MidiPlayer.js`)**:
    - **Synthesis**: SpessaSynth (SoundFont) + Tone.js (AudioContext).
    - **Analysis**: Provides live frequency data via `AnalyserNode`.

## ⚖️ Hard Constraints (Scientific Parity)

These rules from the original paper are **non-negotiable**:

- **Transition Definition**: $i \to j$ if $i$ starts at $T$ and $j$ starts at $T+1$.
- **Chord Handling**: Transitions are calculated from _all_ notes in group $T$ to _all_ notes in group $T+1$.
- **Self-Loops**: Always skipped ($w_{xx} = 0$).
- **Drum Filtering**: Channel 10 MUST be excluded.

## 🏗️ Architectural Patterns

- **Decoupling**: Subsystems must not communicate directly. Use `main.js` as the bridge.
- **Performance**: Use `ObjectPool` for high-frequency objects (emojis). Use InstancedMesh for nodes/cones.
- **BALLISTICS**: Use smooth interpolation (lerp) for all camera and UI transitions to maintain a "liquid" feel.

## 🧪 Testing Guide

- **Co-location**: `Module.js` and `Module.test.js` live in the same folder.
- **Mocks**: Use Vitest's `vi.mock` for heavy dependencies (Three.js, Tone.js).
- **Coverage**: Coverage must not drop. If you add logic, add tests.

## 📂 File Map

- `src/js/main.js`: Lifecycle orchestrator.
- `src/js/NetworkParser.js`: MIDI processing.
- `src/js/NetworkVisualizer.js`: Rendering engine.
- `src/js/MidiPlayer.js`: Audio synthesis.
- `src/js/VisualEffectsManager.js`: Shaders and FX.
- `src/js/UIManager.js`: DOM and Event handling.

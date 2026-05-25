# Agent Context: Tone Nets

This project ports the original R-based visualisations from the paper ["Decoding the evolution of melodic and harmonic structure of Western music through the lens of network science"](https://www.nature.com/articles/s41598-026-42872-7) to a client-side web app. It visualizes MIDI note transitions as a 3D topological web and calculates complexity metrics defined in the linked paper.

## 🚀 Quick Start for Agents

1.  **Understand the Ethos**: Strict TDD. Write a failing test first.
2.  **Environment**: `npm ci` followed by `npm run dev`.
3.  **Validation**: `npm run check` is the "Source of Truth" for quality. It runs linting, formatting, tests (with coverage), and build.
4.  **Entry Point**: `src/js/main.js` is the central orchestrator.

## 🏗️ Architecture Overview

The application is built with Vanilla JS (ES Modules) and Vite, structured into three primary subsystems:

1.  **Network Parser (`src/js/NetworkParser.js` & `src/js/parser.worker.js`)**:
    - **Parsing**: Uses `@tonejs/midi` for binary MIDI parsing.
    - **Graph Construction**: Builds a directed, weighted graph using `ngraph.graph`.
    - **Scientific Parity**:
        - Groups notes by exact **MIDI ticks** to handle chords/simultaneous events.
        - Skips self-loops ($w_{xx} = 0$) as per paper specifications.
        - Filters out MIDI Channel 10 (drums) from transition analysis.
    - **Metrics**: Calculates academic complexity metrics (Efficiency, Reciprocity, Entropy, Scale-interval Embedding).
    - **Scaling**: Parsing and metrics calculation are offloaded to a **Web Worker**.

2.  **3D Visualizer (`src/js/NetworkVisualizer.js`)**:
    - **Engine**: Uses `Three.js` with `TrackballControls`.
    - **Layout Strategy**: Uses `ngraph.forcelayout` in **3D mode**. Assigns mass to nodes based on degree ($1 + \log_2(\text{degree} + 1) \cdot 5$).
    - **Visuals**: Quadratic Bezier edges with directional cones, pitch-class based node coloring (HSL), and post-processing bloom.
    - **Interactivity**: `THREE.Raycaster` for hover; reference-counting `playCount` for playback highlights.

3.  **Audio Player (`src/js/MidiPlayer.js`)**:
    - **Synthesis**: Uses `Tone.js` for `AudioContext` and `spessasynth_lib` for SoundFont synthesis.
    - **Scheduling**: Syncs visual highlights with audio via `spessasynth_lib`'s `Sequencer` events.

## ⚖️ Hard Constraints (Scientific Parity)

These rules are derived from the original Nature paper. Any modification to these must be scientifically justified:

- **Transition Definition**: A transition exists between note $i$ and note $j$ if $i$ starts at time $T$ and $j$ starts at time $T+1$.
- **Chord Handling**: Simultaneous notes (same **MIDI ticks**) are grouped. Transitions are calculated from _all_ notes in group $T$ to _all_ notes in group $T+1$.
- **Self-Loops**: Self-loops ($w_{xx}$) are explicitly skipped. A transition from 'C4' to 'C4' is not recorded.
- **Drum Filtering**: MIDI Channel 10 (index 9) MUST be excluded from network analysis.
- **Metric Logic**:
    - **Efficiency**: Global (unweighted) and Weighted (via Dijkstra). Weighted uses $d = 1/w$ as distance.
    - **Reciprocity**: Binary, Weighted, and Normalized ($\rho$).
    - **Entropy**: Mean Node Entropy.
    - **Scale-interval Embedding**: 12D interval signature (directed pitch class intervals).

## 🏗️ Architectural Patterns

- **Orchestrator Model**: `main.js` manages the lifecycle. Subsystems should not talk to each other directly.
- **Reference-Counting Highlights**: Visual highlights use a `playCount` property. Increment on `noteOn`, decrement on `noteOff`.
- **Object Pooling**: High-frequency objects (like floating emojis) use the `ObjectPool` class.
- **Throttling**: 3D Layout calculations are throttled on mobile and backgrounded when the tab is hidden.

## 🛠️ Common Tasks

### Adding a New Theme

1.  Define the theme object in `src/js/Themes.js`.
2.  Register it in `src/js/main.js` inside `init()` via `visualizer.themeManager.registerTheme()`.
3.  Add any custom shaders to `VisualEffectsManager.js`.

### Adding a New Complexity Metric

1.  Implement logic in `src/js/NetworkMetrics.js`.
2.  Add unit test in `src/js/NetworkMetrics.test.js`.
3.  Update `src/js/NetworkParser.js` summary.
4.  Update `UIManager.js` for display.

## 🧪 Testing Guide

- **Location**: Tests are co-located with their source files (e.g., `Utils.test.js`).
- **Framework**: Vitest.
- **Commands**:
    - `npm test`: Run all tests.
    - `npm run test:watch`: Interactive TDD mode.
    - `npm run test:coverage`: Ensure you haven't dropped coverage.

## 📱 Mobile & Background Constraints

- **Audio Routing**: On mobile, audio is routed to a `MediaStreamDestination` and attached to an _unmuted_ `<audio playsinline>` element to prevent OS suspension.
- **Desktop Keep-Alive**: Background suspension on desktop is prevented using a looping silent audio track (`background.mp3`).
- **Memory Allocation**: Dynamic voice allocation in SpessaSynth is disabled on mobile; voice cap reduced to 64.

## 📂 File Map

- `src/js/NetworkParser.js`: MIDI -> Graph logic.
- `src/js/NetworkVisualizer.js`: Three.js rendering engine.
- `src/js/NetworkMetrics.js`: Mathematical analysis.
- `src/js/VisualEffectsManager.js`: Shaders, highlights, emojis.
- `src/js/MidiPlayer.js`: Audio synthesis and scheduling.
- `src/js/UIManager.js`: DOM interaction and event handling.
- `src/js/Utils.js`: MIDI/Math utilities.

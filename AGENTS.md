# Agent Context: Tone Nets

This project ports the original R-based visualisations from the paper ["Decoding the evolution of melodic and harmonic structure of Western music through the lens of network science"](https://www.nature.com/articles/s41598-026-42872-7) to a client-side web app. It visualizes MIDI note transitions as a 3D topological web and calculates complexity metrics defined in the linked paper.

## Run the development environment

```bash
cd music-analysis-web
npm ci
npm run dev
```

## Contribute

Before committing or sending a pull request, run the linting, formatting, and tests:

```bash
npm run prettier
npm run eslint
npm run test
```

Other available scripts:

- `npm run build`: Production build.
- `npm run preview`: Preview the production build locally.
- `npm run test:coverage`: Run tests with coverage reporting.

## Architecture Overview

The application is built with Vanilla JS (ES Modules) and Vite, structured into three primary subsystems:

1.  **Network Parser (`src/js/networkParser.js` & `src/js/parser.worker.js`)**:
    - **Parsing**: Uses `@tonejs/midi` for binary MIDI parsing.
    - **Graph Construction**: Builds a directed, weighted graph using `ngraph.graph`.
    - **Scientific Parity**:
        - Groups notes by exact **MIDI ticks** to handle chords/simultaneous events.
        - Skips self-loops ($w_{xx} = 0$) as per paper specifications.
        - Filters out MIDI Channel 10 (drums) from transition analysis.
    - **Metrics**: Calculates academic complexity metrics:
        - **Efficiency**: Global (unweighted) and Weighted (via Dijkstra).
        - **Reciprocity**: Binary, Weighted, and Normalized ($\rho$).
        - **Entropy**: Mean Node Entropy.
        - **Scale-interval Embedding**: 12D interval signature (directed pitch class intervals).
    - **Scaling**: Parsing and metrics calculation (which involve $O(V \cdot E)$ operations like BFS/Dijkstra) are performed in a **Web Worker** to keep the UI responsive.

2.  **3D Visualizer (`src/js/visualizer.js`)**:
    - **Engine**: Uses `Three.js` with `OrbitControls` for interactive 3D rendering.
    - **Layout Strategy**: Uses `ngraph.forcelayout` in **2D mode** for planar separation, then maps **Node Degree to the Z-axis** to create a 2.5D topological landscape.
    - **Performance**: Layout is calculated **incrementally (async)** over 3000 steps with real-time progress reporting.
    - **Visuals**: Quadratic Bezier edges with directional cones, pitch-class based node coloring (HSL), and post-processing bloom.
    - **Interactivity**:
        - `THREE.Raycaster` for hover-based highlighting and metadata display.
        - Real-time highlighting of nodes and edges during playback.
        - Floating instrument emojis above active nodes using `THREE.Sprite`.

3.  **Audio Player (`src/js/audioPlayer.js`)**:
    - **Synthesis**: Combines `Tone.js` for scheduling/transport and `spessasynth_lib` for high-quality SoundFont synthesis.
    - **Resources**: Uses a 7.5MB General MIDI SoundFont (`.sf2`) stored in `public/`.
    - **Scheduling**: Uses `Tone.Transport` to schedule notes, program changes, and CC events. Employs `Tone.Draw` to sync visual highlights with audio.
    - **Constraints**: Calls `Tone.start()` on first user interaction (file selection or example click) to unlock the AudioContext.

## Key Dependencies & Rationale

- **Three.js**: Industry standard for hardware-accelerated 3D visuals.
- **Tone.js**: Robust transport scheduling and Web Audio management.
- **spessasynth_lib**: High-fidelity SoundFont (SF2) rendering via AudioWorklets.
- **ngraph.graph / ngraph.forcelayout**: High-performance, lightweight graph data structures and physics engines.
- **Vitest**: Modern testing framework; chosen for speed and Vite compatibility.
- **postprocessing**: High-performance bloom and shader effects.

## Coding Conventions

- **Linting**: Strict security and quality rules via `eslint-plugin-security`, `sonarjs`, and `no-unsanitized`.
- **Formatting**: Prettier with 4-space tabs and single quotes.
- **Testing**: Unit tests for utility functions (`utils.js`) and network construction logic (`networkParser.js`).
- **Media Support**: Implements `MediaSession` API for lock-screen controls and metadata.

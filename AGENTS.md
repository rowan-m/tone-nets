# Agent Context: Music Analysis Web

This project ports the original R-based visualisations from the paper ["Decoding the evolution of melodic and harmonic structure of Western music through the lens of network science"](https://www.nature.com/articles/s41598-026-42872-7) to a client-side web app. It visualizes MIDI note transitions as a 3D topological web and calculates complexity metrics defined in the linked paper.

## Run the development environment

```bash
cd music-analysis-web
npm ci
npm run dev
```

## Contribute

Before committing or sending a pull request, run the linting and formatting checks locally:

```
npm run prettier
npm run eslint
npm run test
```

The application output of the `dev` command will specify the localhost port where the app is running.

##  Architecture Overview

The application is built with Vanilla JS (ES Modules) and Vite, structured into three primary subsystems:

1.  **Network Parser (`src/js/networkParser.js` & `src/js/parser.worker.js`)**:
    - Uses `@tonejs/midi` for binary parsing.
    - Constructs a directed, weighted graph using `ngraph.graph`.
    - Calculates academic metrics: Global Efficiency (via BFS), Mean Node Entropy, Weighted Reciprocity, Density, and **Scale-interval Embedding** (12D interval signature).
    - **Scaling**: Parsing and metrics calculation are performed in a **Web Worker** to keep the main thread responsive.
    - **Logic Note**: Simultaneous notes are grouped by exact MIDI ticks to ensure precise sequential transitions.

2.  **3D Visualizer (`src/js/visualizer.js`)**:
    - Uses `Three.js` for rendering.
    - **Layout Strategy**: Uses `ngraph.forcelayout` in **2D mode** to ensure perfect planar separation, then maps **Node Degree to the Z-axis** to create a 2.5D topological landscape.
    - **Performance**: Layout is calculated **incrementally (async)** over 3000 steps to prevent UI blocking, with real-time progress reporting.
    - **Visuals**: Supports Quadratic Bezier edges, mid-edge directional arrows, and post-processing bloom.
    - **Interactivity**: Uses `THREE.Raycaster` for hover-based highlighting and metadata display.

3.  **Audio Player (`src/js/audioPlayer.js`)**:
    - Uses `Tone.js` for synthesis.
    - **Constraint**: Calls `Tone.start()` immediately upon file selection to capture the browser's user gesture token before heavy layout calculations begin.

## Key Dependencies & Rationale

- **Three.js**: Industry standard for hardware-accelerated 3D visuals.
- **Tone.js / @tonejs/midi**: Robust MIDI parsing and low-latency web audio synthesis.
- **ngraph.graph / ngraph.forcelayout**: High-performance, lightweight graph data structures and physics engines.
- **Vitest**: Modern, fast unit testing framework compatible with Vite.
- **postprocessing**: Used specifically for the Bloom effect.

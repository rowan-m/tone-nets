# Agent Context: Tone Nets

This project ports the original R-based visualisations from the paper ["Decoding the evolution of melodic and harmonic structure of Western music through the lens of network science"](https://www.nature.com/articles/s41598-026-42872-7) to a client-side web app. It visualizes MIDI note transitions as a 3D topological web and calculates complexity metrics defined in the linked paper.

## Run the development environment

```bash
npm ci
npm run dev
```

## Contribute

This project follows a strict **Test-Driven Development (TDD)** ethos. All contributing agents MUST follow the **Red/Green/Refactor** approach:

1.  **Red**: Before implementing a feature or fix, write a test that fails. Use this to empirically reproduce bugs or define new behavior.
2.  **Green**: Write the minimal code necessary to make the test pass. Do not over-engineer at this stage.
3.  **Refactor**: Optimize and clean the code while ensuring the tests remain green. Adhere to the established architectural patterns.

Before committing or sending a pull request, run the linting, formatting, and tests:

```bash
npm run prettier
npm run eslint
npm run test
```

Other available scripts:

- `npm run build`: Production build.
- `npm run preview`: Preview the production build locally.
- `npm run test:coverage`: Run tests with code coverage reporting.

## Architecture Overview

The application is built with Vanilla JS (ES Modules) and Vite, structured into three primary subsystems:

1.  **Network Parser (`src/js/NetworkParser.js` & `src/js/parser.worker.js`)**:
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
    - **Scaling**: Parsing and metrics calculation (which involve $O(V \cdot E)$ operations like BFS/Dijkstra) are performed in a **Web Worker**. Since `ngraph.graph` objects cannot be transferred directly, data is passed as a serialized `{ nodes, links }` structure and reconstructed via `NetworkParser.rebuildGraph()`.

2.  **3D Visualizer (`src/js/NetworkVisualizer.js`)**:
    - **Engine**: Uses `Three.js` with `OrbitControls` for interactive 3D rendering.
    - **Layout Strategy**: Uses `ngraph.forcelayout` in **3D mode** (`dimensions: 3`). Assigns physical **mass** to nodes in the simulator based on their degree ($1 + \log_2(\text{degree} + 1) \cdot 5$) to ensure hubs maintain spatial dominance.
    - **Performance**: Layout is calculated **incrementally (async)** over 3000 steps with real-time progress reporting. Throttled on mobile to maintain framerates.
    - **Visuals**: Quadratic Bezier edges with directional cones, pitch-class based node coloring (HSL), and post-processing bloom.
    - **Interactivity**:
        - `THREE.Raycaster` for hover-based highlighting and metadata display.
        - Real-time highlighting of nodes and edges during playback using a **reference-counting `playCount` system**.
        - Floating instrument emojis above active nodes using `THREE.Sprite`.

3.  **Audio Player (`src/js/MidiPlayer.js`)**:
    - **Synthesis**: Uses `Tone.js` for `AudioContext` management and `spessasynth_lib` for high-quality SoundFont synthesis and MIDI sequencing.
    - **Resources**: Uses a 7.5MB General MIDI SoundFont (`.sf2`) stored in `public/`.
    - **Scheduling**: Uses `spessasynth_lib`'s built-in `Sequencer` and `eventHandler` to sync visual highlights with audio. Uses `requestAnimationFrame` in `main.js` to decouple UI updates from the strict audio loop.
    - **Constraints**: Calls `Tone.start()` on first user interaction (file selection or example click) to unlock the AudioContext.

## Technical Implementation Details

- **UI Stack**: The project uses **Vanilla CSS** and direct **DOM manipulation** (no UI framework). The entry point `main.js` acts as a controller, coordinating subsystems via callback hooks (e.g., `player.onNotePlay`).
- **Metric Logic**: **Weighted Efficiency** is calculated using Dijkstra's algorithm where the distance between nodes is the inverse of their transition weight ($d = 1/w$).
- **Reference Counting**: Visual highlights for nodes and edges use a `playCount` counter. This ensures that overlapping notes or chords correctly maintain highlights until the final instance is released.
- **Performance Patterns**: High-frequency lookups and caches (like `Utils.noteToSemitone`) utilize native **`Map`** objects instead of plain objects for better V8 performance.
- **Security Patterns**: MIDI uploads are restricted to **5MB** and verified via a **Magic Number check** (`0x4d546864`) in `main.js` before processing.

## Mobile & Background Constraints

To maintain stable audio on low-power mobile devices and prevent the OS from suspending the audio context when the app is backgrounded, the following strict patterns are enforced:
- **Audio Routing**: On mobile, audio is routed exclusively to a `MediaStreamDestination` and attached to an *unmuted* `<audio playsinline>` element appended to the DOM. This forces the OS to recognize the tab as actively playing media.
- **Memory Allocation**: Dynamic voice allocation (`autoAllocateVoices`) in SpessaSynth is disabled on mobile, and the voice cap is reduced. This prevents garbage collection pauses in the `AudioWorklet` thread which cause severe audio corruption. Interpolation is also dropped to linear.
- **Main Thread Offloading**: When `document.visibilityState === 'hidden'`, all 3D `requestAnimationFrame` render loops and DOM updates are instantly short-circuited to conserve 100% of CPU for the background `AudioWorklet`.

## Key Dependencies & Rationale

- **Three.js**: Industry standard for hardware-accelerated 3D visuals.
- **Tone.js**: Robust Web Audio `Context` management and start-up unlocking.
- **spessasynth_lib**: High-fidelity SoundFont (SF2) rendering and MIDI sequencing via AudioWorklets.
- **ngraph.graph / ngraph.forcelayout**: High-performance, lightweight graph data structures and physics engines.
- **Vitest**: Modern testing framework; chosen for speed and Vite compatibility.
- **postprocessing**: High-performance bloom and shader effects.

## Coding Conventions

- **Linting**: Strict security and quality rules via `eslint-plugin-security`, `sonarjs`, `no-unsanitized`, and `@eslint/css`.
- **Formatting**: Prettier with 4-space tabs and single quotes.
- **Testing**: Mandated TDD workflow. Unit tests are required for all utility functions (`src/js/Utils.js`), network construction logic, and UI-independent business logic. Tests must be written before implementation (Red phase).
- **Media Support**: Implements `MediaSession` API for lock-screen controls and metadata.

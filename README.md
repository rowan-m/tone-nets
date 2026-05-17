# Tone Nets

The paper ["Decoding the evolution of melodic and harmonic structure of Western music through the lens of network science"](https://www.nature.com/articles/s41598-026-42872-7) analysed and visualised musical tracks to identify structural trends over a range of genres. This project is a web-based implementation inspired by the [original R-based visualisations](https://osf.io/ujre4/files/osfstorage).

[Try 🎶 Tone Nets 🎶 now!](https://tone-nets.web.app/)

The application parses MIDI files to analyse note transitions and visualises the results as a 3D topological web.

## Architecture

1.  **Network Parsing & Analysis**
    The application uses `@tonejs/midi` to convert binary MIDI data into a structured format. This processing occurs in a background Web Worker to maintain UI responsiveness. Notes are grouped by their exact MIDI ticks to identify chords and sequential transitions, while Channel 10 (drums) is excluded from analysis. Transitions are stored in a directed, weighted graph using `ngraph.graph`, where nodes represent pitch classes and edges represent transitions. The worker calculates academic complexity metrics including:
    - **Efficiency**: Global (unweighted) and Weighted (via Dijkstra).
    - **Reciprocity**: Binary, Weighted, and Normalized ($\rho$).
    - **Entropy**: Mean Node Entropy.
    - **Scale-interval Embedding**: A 12D interval signature of directed pitch class intervals.

2.  **3D Visualization**
    The graph is rendered using `three` (Three.js). A 2D layout is calculated incrementally over 3000 steps by `ngraph.forcelayout` using a spring-physics simulation. This layout is then mapped to 3D space, with the Z-axis (depth) determined by each node's degree (connection count), creating a 2.5D topological landscape. Visual features include:
    - Quadratic Bezier edges with directional cones.
    - Pitch-class based node coloring (HSL).
    - Floating instrument emojis above active nodes using `THREE.Sprite`.
    - Post-processing bloom effects via the `postprocessing` library.
    - Interactive metadata display and highlighting via `THREE.Raycaster`.

3.  **Audio Playback & Synchronization**
    Playback is managed by `tone` (Tone.js) for transport scheduling and `spessasynth_lib` for high-quality SoundFont synthesis. The system supports:
    - General MIDI SoundFont (`.sf2`) rendering.
    - Scheduling of notes, program changes, and CC events.
    - Real-time synchronization of visual highlights using `Tone.Draw`.
    - `MediaSession` API integration for lock-screen controls and metadata.

## Develop

To run this project locally:

```bash
npm ci
npm run dev
```

## Contribute

Before submitting a pull request, run the `check` tasks to validate formatting, quality issues, tests, and the build:

```bash
npm run check
```

## Attribution

Sample MIDI files included from Wikimedia Commons:

- [Beethoven's Moonlight Sonata](https://commons.wikimedia.org/wiki/File:Beethoven_-_Moonlight_Sonata_1st_Movement.mid)
- [Chopin's Funeral March](https://commons.wikimedia.org/wiki/File:Chopin_-_Funeral_March.mid)

_Tone Nets sounds a bit like [Tonnetz](https://wikipedia.org/wiki/Tonnetz). Ha ha, so clever._

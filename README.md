# Tone Nets

The paper ["Decoding the evolution of melodic and harmonic structure of Western music through the lens of network science"](https://www.nature.com/articles/s41598-026-42872-7) analysed and visualised musical tracks to identify structural trends over a range of genres. This project is a web-based implementation inspired by the [original R-based visualisations](https://osf.io/ujre4/files/osfstorage).

[Try 🎶 Tone Nets 🎶 now!](https://tone-nets.web.app/)

The application parses MIDI files to analyse note transitions and visualises the results as a 3D topological web.

## Architecture

1.  **Network Parsing & Analysis**
    The application parses note-to-note transitions from MIDI data into a directed, weighted graph using `ngraph.graph`, where nodes represent pitch classes and edges represent transitions. Drums (Channel 10) are excluded. The application supports two operational modes:
    - **Live Build Mode** (default): The network is constructed dynamically in real time as the music plays.
    - **Static Mode**: The MIDI file is parsed upfront using `@tonejs/midi` in a background Web Worker (to keep the UI responsive). The worker calculates academic complexity metrics:
        - **Efficiency**: Global (unweighted) and Weighted (via Dijkstra).
        - **Reciprocity**: Binary, Weighted, and Normalized ($\rho$).
        - **Entropy**: Mean Node Entropy.
        - **Scale-interval Embedding**: A 12D interval signature of directed pitch class intervals.

2.  **3D Visualization**
    The graph is rendered in 3D using `three` (Three.js) with `TrackballControls` for user interaction. A 3D force-directed layout is calculated by `ngraph.forcelayout` using a spring-physics simulation. To keep layout components cohesive, isolated nodes are pulled toward the main component's hubs via temporary anchor links. Visual features include:
    - Quadratic Bezier edges with directional cones.
    - Pitch-class based node coloring (HSL).
    - Dynamic visual themes (including a high-reflection `terminator` theme with metallic shaders and a custom fire/plasma background).
    - Floating instrument emojis above active nodes using `THREE.Sprite`.
    - Post-processing bloom effects via the `postprocessing` library.
    - Interactive metadata display and highlighting via `THREE.Raycaster`.

3.  **Audio Playback & Keep-Alive**
    Playback is managed by `tone` (Tone.js) and `spessasynth_lib` for high-quality SoundFont synthesis. To ensure audio is never suspended when the application is backgrounded or on mobile:
    - Audio is routed to a `MediaStreamDestination` and an unmuted, playsinline `<audio>` element on mobile, and supported by a silent keep-alive MP3 loop on desktop.
    - Live playback highlights and instrument emojis are synced in real time.
    - Full `MediaSession` API integration synchronizes metadata and lock-screen controls.

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

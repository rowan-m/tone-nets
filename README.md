# Tone Nets

The paper ["Decoding the evolution of melodic and harmonic structure of Western music through the lens of network science"](https://www.nature.com/articles/s41598-026-42872-7) analysed and visualised musical tracks to identify structural trends over a range of genres. This project is a web-based implementation inspired by the [original R-based visualisations](https://osf.io/ujre4/files/osfstorage).

[Try 🎶 Tone Nets 🎶 now!](https://tone-nets.web.app/)

The application parses MIDI files to analyse note transitions and visualises the results as a 3D topological web.

## Architecture

1.  **Network Parsing & Analysis**
    The application uses `@tonejs/midi` to convert binary MIDI data into a structured format. This processing occurs in a background Web Worker to maintain UI responsiveness. Notes are grouped by their MIDI tick to identify chords and sequential transitions. These transitions are stored in a directed, weighted graph using `ngraph.graph`, where nodes represent pitch classes and edges represent transitions. The worker calculates metrics such as Density, Reciprocity, Mean Node Entropy, and Global Efficiency.

2.  **3D Visualization**
    The graph is rendered using `three` (Three.js). A 2D layout is calculated by `ngraph.forcelayout` using a spring-physics simulation. This layout is then mapped to 3D space, with the Z-axis (depth) determined by each node's degree (connection count). Edges are rendered as curved Quadratic Bezier lines. The `postprocessing` library is used to apply a Bloom effect to the scene. Interaction and node highlighting are handled via Three.js raycasting.

3.  **Audio Playback & Synchronization**
    Playback is managed by `tone` (Tone.js), which provides the master clock and event scheduling. Audio synthesis is performed by `spessasynth_lib`, a Web Audio Worklet synthesizer that renders audio from SoundFont (`.sf2`) data. `Tone.Draw` is used to synchronize visual highlights in the 3D scene with audio playback events.

## Develop

To run this project locally:

```bash
npm ci
npm run dev
```

## Contribute

Before sending a pull request, run the linting and formatting checks locally:

```
npm run prettier
npm run eslint
```

## Attribution

Sample MIDI files included from Wikimedia Commons: 
- [Beethoven's Moonlight Sonata](https://commons.wikimedia.org/wiki/File:Beethoven_-_Moonlight_Sonata_1st_Movement.mid)
- [Chopin's Funeral March](https://commons.wikimedia.org/wiki/File:Chopin_-_Funeral_March.mid)

_Tone Nets sounds a bit like [Tonnetz](https://wikipedia.org/wiki/Tonnetz). Ha ha, so clever._

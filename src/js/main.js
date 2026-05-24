import { NetworkParser } from './NetworkParser.js';
import { NetworkVisualizer } from './NetworkVisualizer.js';
import { MidiPlayer } from './MidiPlayer.js';
import { UIManager } from './UIManager.js';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import createGraph from 'ngraph.graph';
import { Utils } from './Utils.js';
import { DefaultTheme, TerminatorTheme, RetroTheme } from './Themes.js';

console.log('Tone Nets Initialized');

// Setup Web Worker
const parserWorker = new Worker(
    new URL('./parser.worker.js', import.meta.url),
    { type: 'module' },
);

const init = async () => {
    let isIncrementalMode = true;
    let isAutoplayMode = true;

    const visualizer = new NetworkVisualizer('canvas-container');

    // Register themes
    visualizer.themeManager.registerTheme(DefaultTheme);
    visualizer.themeManager.registerTheme(TerminatorTheme);
    visualizer.themeManager.registerTheme(RetroTheme);
    visualizer.setTheme('default');

    // Warm-up visualizer and shaders to prevent JIT/shader compilation lag on first play
    const warmUpGraph = createGraph();
    warmUpGraph.addNode('A');
    warmUpGraph.addNode('B');
    warmUpGraph.addLink('A', 'B');
    await visualizer.initIncremental(warmUpGraph);
    for (let i = 0; i < 5; i++) {
        visualizer.layout.step();
    }
    if (
        visualizer.composer &&
        typeof visualizer.composer.render === 'function'
    ) {
        visualizer.composer.render();
    }
    visualizer.clear();

    const player = new MidiPlayer();

    const callbacks = {
        onIncrementalToggle: (checked) => {
            isIncrementalMode = checked;
        },
        onAutoplayToggle: (checked) => {
            isAutoplayMode = checked;
        },
        onLoopToggle: (checked) => {
            player.isLooping = checked;
        },
        onTourToggle: (checked) => {
            if (checked) {
                visualizer.startAutoTour();
            } else {
                visualizer.stopAutoTour();
            }
        },
        onTogglePlayPause: () => {
            togglePlayPause();
        },
        onRestart: () => {
            player.restart();
        },
        onThemeCycle: () => {
            const nextThemeName = visualizer.cycleTheme();
            const nextTheme = visualizer.themeManager.getTheme(nextThemeName);
            ui.setThemeUI(nextTheme);
        },
        onFileSelection: (file) => {
            player.initialize().catch((err) => {
                console.warn(
                    'Early player initialization failed during file selection:',
                    err,
                );
            });
            handleFileSelection(file);
        },
        isPlaying: () => player.isPlaying,
        onExampleMidiClick: (fileName) => {
            player.initialize().catch((err) => {
                console.warn(
                    'Early player initialization failed during example click:',
                    err,
                );
            });
            loadMidiFromUrl(`./${fileName}`, fileName);
        },
        onVisibilityChange: () => {
            visualizer.resetPlayingHighlights();
        },
    };

    const ui = new UIManager(callbacks);
    ui.setThemeUI(visualizer.themeManager.getCurrentTheme());

    visualizer.onTourChange = (enabled) => {
        ui.els.tourToggle.checked = enabled;
        ui.els.tourToggle.setAttribute('aria-expanded', enabled);
    };
    player.isLooping = ui.els.loopToggle.checked;

    const updateMetricsUI = (summary, fileName) => {
        ui.updateMetrics(summary, fileName, isIncrementalMode);
    };

    ui.els.uploadInput.disabled = true;

    try {
        await player.loadSoundfont();
        ui.hideStatus();
        ui.els.uploadInput.disabled = false;
    } catch (error) {
        ui.showError('Error loading SoundFont.', error);
    }

    const notePlayQueue = [];
    const noteReleaseQueue = [];
    let lastCountUpdate = 0;

    const processSingleNotePlay = (event) => {
        const { nodeId, prevNodeId, instrumentId, isDrums } = event;
        let graphChanged = false;

        if (isIncrementalMode && !isDrums) {
            // Mutate graph here (SRP: main.js as orchestrator)
            if (prevNodeId && prevNodeId !== nodeId) {
                NetworkParser.addTransition(
                    visualizer.graph,
                    prevNodeId,
                    nodeId,
                );
                graphChanged = true;
            } else if (nodeId) {
                const isNewNode = NetworkParser.ensureNodesExist(
                    visualizer.graph,
                    [nodeId],
                );
                if (isNewNode) graphChanged = true;
            }

            visualizer.addTransitionIncremental(prevNodeId, nodeId);
        }

        visualizer.highlightPlayingElement(nodeId, prevNodeId);
        const emoji = Utils.getInstrumentEmoji(instrumentId, isDrums);
        visualizer.showInstrumentEmoji(nodeId, emoji);

        return graphChanged;
    };

    const processQueuedNoteEvents = () => {
        if (notePlayQueue.length === 0 && noteReleaseQueue.length === 0) return;

        // Process all releases first to ensure correct overlap release mapping
        for (let i = 0; i < noteReleaseQueue.length; i++) {
            const { nodeId, prevNodeId } = noteReleaseQueue[i];
            visualizer.releasePlayingElement(nodeId, prevNodeId);
        }
        noteReleaseQueue.length = 0;

        let graphChanged = false;
        for (let i = 0; i < notePlayQueue.length; i++) {
            if (processSingleNotePlay(notePlayQueue[i])) {
                graphChanged = true;
            }
        }
        notePlayQueue.length = 0;

        if (graphChanged) {
            const now = performance.now();
            if (now - lastCountUpdate > 250) {
                ui.els.vCountEl.textContent = visualizer.graph.getNodesCount();
                ui.els.eCountEl.textContent = visualizer.graph.getLinksCount();
                lastCountUpdate = now;
            }
        }
    };

    visualizer.onBeforeFrame = processQueuedNoteEvents;

    player.onNotePlay = (nodeId, prevNodeId, instrumentId, isDrums) => {
        if (document.visibilityState === 'hidden' || !player.isPlaying) return;
        notePlayQueue.push({
            nodeId,
            prevNodeId:
                prevNodeId !== undefined && prevNodeId !== null
                    ? prevNodeId
                    : null,
            instrumentId,
            isDrums,
        });
    };

    player.onNoteRelease = (nodeId, prevNodeId) => {
        if (document.visibilityState === 'hidden') return;
        noteReleaseQueue.push({
            nodeId,
            prevNodeId:
                prevNodeId !== undefined && prevNodeId !== null
                    ? prevNodeId
                    : null,
        });
    };

    player.onStop = () => {
        notePlayQueue.length = 0;
        noteReleaseQueue.length = 0;
        visualizer.resetPlayingHighlights();
        if (!player.isPlaying) {
            ui.setPlaybackUI(false);
        }
    };

    visualizer.onHover = (data) => {
        ui.updateHoverInfo(data);
    };

    const updateMediaSession = (titleString, fileName) => {
        if ('mediaSession' in navigator) {
            let title = fileName;
            let artist = 'Tone Nets';

            if (titleString && titleString !== 'Unknown Title') {
                if (titleString.includes(' - ')) {
                    const parts = titleString.split(' - ');
                    title = parts[0].trim();
                    artist = parts.slice(1).join(' - ').trim();
                } else {
                    title = titleString;
                }
            }

            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: artist,
                album: 'Tone Nets',
                artwork: [
                    {
                        src: '/now-playing.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                ],
            });

            player.updateMediaSessionPosition();
        }
    };

    const togglePlayPause = () => {
        if (player.isPlaying) {
            player.pause();
            visualizer.setPaused(true);
            ui.setPlaybackUI(false);
        } else {
            player.resume();
            visualizer.setPaused(false);
            ui.setPlaybackUI(true);
        }
    };

    const processMidi = async (arrayBuffer, fileName) => {
        console.log(
            'Processing MIDI:',
            fileName,
            'Incremental:',
            isIncrementalMode,
            'Autoplay:',
            isAutoplayMode,
            'Looping:',
            player.isLooping,
        );
        ui.showStatus('Parsing MIDI and building network...');
        ui.els.playBtn.disabled = true;
        ui.els.pauseBtn.disabled = true;
        ui.els.restartBtn.disabled = true;
        ui.els.tourToggle.disabled = true;
        ui.els.statsToggle.disabled = true;

        try {
            if (isIncrementalMode) {
                const midi = new Midi(arrayBuffer);
                const title = NetworkParser.extractMetadata(midi);

                updateMetricsUI(
                    {
                        title: title,
                        vertices: 0,
                        edges: 0,
                        density: '0.0000',
                        efficiency: '-',
                        weightedEfficiency: '-',
                        entropy: '-',
                        binaryReciprocity: '-',
                        reciprocity: '-',
                        reciprocityRho: '-',
                        embedding: new Array(12).fill('0.0000'),
                    },
                    fileName,
                );
                updateMediaSession(title, fileName);

                const graph = createGraph();
                await visualizer.initIncremental(graph);
                ui.els.welcomeMsg.classList.add('hidden');

                // Initialize audio early so AudioContext starts running and stabilizing
                await Tone.start();
                await player.initialize();

                // Set up UI and start visualizer rendering loop before starting audio playback
                ui.els.playBtn.disabled = false;
                ui.els.pauseBtn.disabled = false;
                ui.els.restartBtn.disabled = false;
                ui.els.tourToggle.disabled = false;
                ui.els.statsToggle.disabled = true;
                ui.els.statsToggle.checked = false;
                ui.els.infoPanel.classList.add('hidden');

                if (ui.els.tourToggle.checked) {
                    visualizer.startAutoTour();
                }

                ui.setPlaybackUI(isAutoplayMode);
                visualizer.setPaused(!isAutoplayMode);

                ui.hideStatus();

                // Trigger playback after the UI has updated and visualizer rendering has started
                await player.play(arrayBuffer.slice(0), isAutoplayMode);
            } else {
                parserWorker.onmessage = (e) => {
                    const { summary, serializedGraph, error } = e.data;

                    if (error) {
                        ui.showError('Error processing MIDI file.', error);

                        return;
                    }

                    if (summary.duration) {
                        player.duration = summary.duration;
                    }
                    updateMetricsUI(summary, fileName);
                    updateMediaSession(summary.title, fileName);

                    console.log(
                        'Network built successfully (in worker):',
                        summary,
                    );

                    const graph = NetworkParser.rebuildGraph(serializedGraph);

                    visualizer.onLayoutProgress = (percent) => {
                        ui.showStatus(
                            `Calculating topological layout: ${percent}%`,
                        );
                    };

                    visualizer.buildVisualization(graph).then(async () => {
                        try {
                            ui.els.welcomeMsg.classList.add('hidden');

                            // Initialize audio early so AudioContext starts running and stabilizing
                            await Tone.start();
                            await player.initialize();

                            // Set up UI and start visualizer rendering loop before starting audio playback
                            ui.els.playBtn.disabled = false;
                            ui.els.pauseBtn.disabled = false;
                            ui.els.restartBtn.disabled = false;
                            ui.els.tourToggle.disabled = false;
                            ui.els.statsToggle.disabled = false;

                            ui.setPlaybackUI(isAutoplayMode);
                            visualizer.setPaused(!isAutoplayMode);

                            if (ui.els.tourToggle.checked) {
                                visualizer.startAutoTour();
                            } else {
                                visualizer.stopAutoTour();
                            }

                            ui.hideStatus();

                            // Trigger playback after the UI has updated and visualizer rendering has started
                            await player.play(
                                arrayBuffer.slice(0),
                                isAutoplayMode,
                            );
                        } catch (err) {
                            ui.showError('Error starting audio playback.', err);
                        }
                    });
                };

                parserWorker.postMessage({ midiBuffer: arrayBuffer });
            }
        } catch (err) {
            ui.showError('Error processing MIDI file.', err);
        }
    };

    const loadMidiFromUrl = async (url, fileName) => {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch MIDI');
            const arrayBuffer = await response.arrayBuffer();
            await processMidi(arrayBuffer, fileName);
        } catch (err) {
            ui.showError(`Error loading ${fileName}.`, err);
        }
    };

    const handleFileSelection = async (file) => {
        if (!file) return;
        const fileName = file.name;
        const ext = fileName.toLowerCase();

        const MAX_FILE_SIZE = 5 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            ui.showStatus(
                'File is too large. Please upload a MIDI file smaller than 5MB.',
            );
            setTimeout(() => ui.hideStatus(), 3000);
            return;
        }

        if (ext.endsWith('.mid') || ext.endsWith('.midi')) {
            const arrayBuffer = await file.arrayBuffer();

            let isValidMidi = false;
            if (arrayBuffer.byteLength >= 4) {
                const dataView = new DataView(arrayBuffer);
                const magicNumber = dataView.getUint32(0, false);
                if (magicNumber === 0x4d546864) {
                    isValidMidi = true;
                }
            }

            if (isValidMidi) {
                await processMidi(arrayBuffer, fileName);
            } else {
                ui.showStatus('Invalid or corrupted MIDI file.');
                setTimeout(() => ui.hideStatus(), 3000);
            }
        } else {
            ui.showStatus(
                'Invalid file type. Please upload a .mid or .midi file.',
            );
            setTimeout(() => ui.hideStatus(), 3000);
        }
    };
};

document.addEventListener('DOMContentLoaded', init);

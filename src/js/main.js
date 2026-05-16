import { NetworkParser } from './NetworkParser.js';
import { NetworkVisualizer } from './NetworkVisualizer.js';
import { MidiPlayer } from './MidiPlayer.js';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import createGraph from 'ngraph.graph';

console.log('Tone Nets Initialized');

// Setup Web Worker
const parserWorker = new Worker(
    new URL('./parser.worker.js', import.meta.url),
    { type: 'module' },
);

import { Utils } from './Utils.js';

const init = async () => {
    const uploadInput = document.getElementById('midi-upload');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const restartBtn = document.getElementById('restart-btn');
    const closeInfo = document.getElementById('close-info');
    const vCountEl = document.getElementById('v-count');
    const eCountEl = document.getElementById('e-count');
    const infoPanel = document.getElementById('info-panel');
    const welcomeMsg = document.getElementById('welcome-msg');
    const hoverPanel = document.getElementById('hover-panel');
    const hoverNode = document.getElementById('hover-node');
    const hoverNodeId = document.getElementById('hover-node-id');
    const hoverNodeDegree = document.getElementById('hover-node-degree');
    const hoverEdge = document.getElementById('hover-edge');
    const hoverEdgeFrom = document.getElementById('hover-edge-from');
    const hoverEdgeTo = document.getElementById('hover-edge-to');
    const hoverEdgeInterval = document.getElementById('hover-edge-interval');
    const hoverEdgeWeight = document.getElementById('hover-edge-weight');
    const appTitle = document.getElementById('app-title');
    const statusModal = document.getElementById('status-modal');
    const statusModalText = document.getElementById('status-modal-text');
    const appEl = document.getElementById('app');
    const hideUiBtn = document.getElementById('hide-ui');
    const showUiBtn = document.getElementById('show-ui');

    const autoplayToggle = document.getElementById('autoplay-toggle');
    const loopToggle = document.getElementById('loop-toggle');
    const incrementalToggle = document.getElementById('incremental-toggle');
    const statsToggle = document.getElementById('stats-toggle');
    const tourToggle = document.getElementById('tour-toggle');

    let isIncrementalMode = true;
    let isAutoplayMode = true;

    // Handle Incremental Mode Toggle
    incrementalToggle.addEventListener('change', (e) => {
        isIncrementalMode = e.target.checked;
        if (isIncrementalMode) {
            infoPanel.classList.add('hidden');
            statsToggle.disabled = true;
            statsToggle.checked = false;
        } else if (!playBtn.disabled) {
            // If a file is loaded
            statsToggle.disabled = false;
        }
    });

    // Handle Autoplay Toggle
    autoplayToggle.addEventListener('change', (e) => {
        isAutoplayMode = e.target.checked;
    });

    // Handle Loop Toggle
    loopToggle.addEventListener('change', (e) => {
        player.isLooping = e.target.checked;
    });

    // Handle Stats Toggle
    statsToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            infoPanel.classList.remove('hidden');
        } else {
            infoPanel.classList.add('hidden');
        }
        statsToggle.setAttribute('aria-expanded', e.target.checked);
    });

    // Handle Tour Toggle
    tourToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            visualizer.startAutoTour();
        } else {
            visualizer.stopAutoTour();
        }
    });

    const toggleUi = () => {
        appEl.classList.toggle('ui-hidden');
    };

    hideUiBtn.addEventListener('click', toggleUi);
    showUiBtn.addEventListener('click', toggleUi);

    const metricEls = {
        efficiency: document.getElementById('metric-efficiency'),
        weightedEfficiency: document.getElementById(
            'metric-weighted-efficiency',
        ),
        entropy: document.getElementById('metric-entropy'),
        binaryReciprocity: document.getElementById('metric-binary-reciprocity'),
        reciprocity: document.getElementById('metric-reciprocity'),
        reciprocityRho: document.getElementById('metric-reciprocity-rho'),
        density: document.getElementById('metric-density'),
        intervalBars: document.querySelectorAll('#interval-bars .bar'),
    };

    // Show non-dismissable status modal
    statusModal.showModal();
    statusModal.addEventListener('cancel', (e) => e.preventDefault());

    const visualizer = new NetworkVisualizer('canvas-container');
    visualizer.onTourChange = (enabled) => {
        tourToggle.checked = enabled;
    };
    const player = new MidiPlayer();
    player.isLooping = loopToggle.checked;

    const showStatus = (text) => {
        statusModalText.textContent = text;
        if (!statusModal.open) {
            statusModal.showModal();
        }
    };

    const hideStatus = () => {
        if (statusModal.open) {
            statusModal.close();
        }
    };

    const updateMetricsUI = (summary, fileName) => {
        appTitle.textContent = summary.title ? summary.title : fileName;

        vCountEl.textContent = summary.vertices;
        eCountEl.textContent = summary.edges;

        // Populate metrics
        Object.keys(metricEls).forEach((key) => {
            if (key === 'intervalBars') return;
            if (metricEls[key]) metricEls[key].textContent = summary[key];
        });

        // Update Interval Signature Bars
        summary.embedding.forEach((val, i) => {
            const percentage = Math.round(parseFloat(val) * 100);
            const bar = metricEls.intervalBars[i];
            if (bar) {
                bar.style.height = `${percentage}%`;
                bar.title = `${Utils.INTERVAL_NAMES[i]}: ${percentage}%`;
                bar.setAttribute('aria-valuenow', percentage);
            }
        });

        if (isIncrementalMode || window.innerWidth <= 768) {
            infoPanel.classList.add('hidden');
        } else {
            infoPanel.classList.remove('hidden');
        }
    };

    // Disable upload until soundfont is loaded
    uploadInput.disabled = true;

    try {
        await player.loadSoundfont();
        hideStatus();
        uploadInput.disabled = false;
    } catch (error) {
        showStatus('Error loading SoundFont. See console.');
        console.error(error);
    }

    let lastCountUpdate = 0;
    player.onNotePlay = (nodeId, prevNodeId, instrumentId, isDrums) => {
        // Optimization: Skip heavy visualization updates if the page is hidden (backgrounded)
        // to prioritize CPU for the AudioWorklet and prevent stuttering on mobile.
        // We must return BEFORE requestAnimationFrame to prevent a massive queue from building up
        // while the tab is inactive.
        if (document.visibilityState === 'hidden') return;

        // Use requestAnimationFrame to decouple heavy visual work from the audio sequencer's
        // event loop, preventing "tempo drag" on mobile.
        requestAnimationFrame(() => {
            // Re-check visibility inside the frame in case state changed
            if (document.visibilityState === 'hidden') return;

            if (isIncrementalMode && !isDrums) {
                visualizer.addTransitionIncremental(prevNodeId, nodeId);

                // Throttle DOM updates for performance
                const now = performance.now();
                if (now - lastCountUpdate > 250) {
                    vCountEl.textContent = visualizer.graph.getNodesCount();
                    eCountEl.textContent = visualizer.graph.getLinksCount();
                    lastCountUpdate = now;
                }
            }

            visualizer.highlightPlayingElement(nodeId, prevNodeId);
            const emoji = Utils.getInstrumentEmoji(instrumentId, isDrums);
            visualizer.showInstrumentEmoji(nodeId, emoji);
        });
    };
    player.onNoteRelease = (nodeId, prevNodeId) => {
        if (document.visibilityState === 'hidden') return;
        requestAnimationFrame(() => {
            if (document.visibilityState === 'hidden') return;
            visualizer.releasePlayingElement(nodeId, prevNodeId);
        });
    };
    player.onStop = () => {
        visualizer.resetPlayingHighlights();
        if (!player.isPlaying) {
            playBtn.classList.remove('hidden');
            pauseBtn.classList.add('hidden');
        }
    };

    visualizer.onHover = (data) => {
        if (!data) {
            hoverPanel.classList.add('hidden');
            return;
        }

        hoverPanel.classList.remove('hidden');

        if (data.type === 'node') {
            hoverNode.classList.remove('hidden');
            hoverEdge.classList.add('hidden');
            hoverNodeId.textContent = `Node: ${data.id}`;
            hoverNodeDegree.textContent = data.degree;
        } else if (data.type === 'edge') {
            hoverNode.classList.add('hidden');
            hoverEdge.classList.remove('hidden');
            const interval = Utils.getIntervalName(
                data.sourceId,
                data.targetId,
            );
            hoverEdgeFrom.textContent = data.sourceId;
            hoverEdgeTo.textContent = data.targetId;
            hoverEdgeInterval.textContent = interval;
            hoverEdgeWeight.textContent = data.weight;
        }
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

            // Update position state once metadata is set
            player.updateMediaSessionPosition();
        }
    };

    const togglePlayPause = () => {
        if (player.isPlaying) {
            player.pause();
            visualizer.setPaused(true);

            playBtn.classList.remove('hidden');
            pauseBtn.classList.add('hidden');
        } else {
            player.resume();
            visualizer.setPaused(false);

            playBtn.classList.add('hidden');
            pauseBtn.classList.remove('hidden');
        }
    };

    // Setup Play/Pause Toggles
    playBtn.addEventListener('click', togglePlayPause);
    pauseBtn.addEventListener('click', togglePlayPause);

    // Setup Restart Button
    restartBtn.addEventListener('click', () => {
        player.restart();
    });

    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', togglePlayPause);
        navigator.mediaSession.setActionHandler('pause', togglePlayPause);
    }

    const processMidi = async (arrayBuffer, fileName) => {
        await Tone.start();

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
        showStatus('Parsing MIDI and building network...');
        playBtn.disabled = true;
        pauseBtn.disabled = true;
        restartBtn.disabled = true;
        tourToggle.disabled = true;
        statsToggle.disabled = true;

        try {
            if (isIncrementalMode) {
                // Incremental Mode Logic
                // 1. Just extract metadata and basic info
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

                // 2. Init Visualizer with empty graph
                const graph = createGraph();
                await visualizer.initIncremental(graph);
                welcomeMsg.classList.add('hidden');

                // 3. Play Audio
                await player.play(arrayBuffer.slice(0), isAutoplayMode);

                // 4. Update UI
                playBtn.disabled = false;
                pauseBtn.disabled = false;
                restartBtn.disabled = false;
                tourToggle.disabled = false;
                statsToggle.disabled = true; // Metrics are disabled in incremental mode
                statsToggle.checked = false;
                infoPanel.classList.add('hidden');

                if (tourToggle.checked) {
                    visualizer.startAutoTour();
                }

                if (isAutoplayMode) {
                    playBtn.classList.add('hidden');
                    pauseBtn.classList.remove('hidden');
                    visualizer.setPaused(false);
                } else {
                    playBtn.classList.remove('hidden');
                    pauseBtn.classList.add('hidden');
                    visualizer.setPaused(true);
                }

                hideStatus();
            } else {
                // Static Mode Logic (Existing)
                // Play Audio
                await player.play(arrayBuffer.slice(0), isAutoplayMode);

                // Use Web Worker to build the network
                parserWorker.onmessage = (e) => {
                    const { summary, serializedGraph, error } = e.data;

                    if (error) {
                        console.error('Worker error:', error);
                        showStatus('Error processing MIDI file. See console.');
                        return;
                    }

                    if (summary.duration) {
                        player.duration = summary.duration;
                    }
                    updateMetricsUI(summary, fileName);
                    updateMediaSession(summary.title, fileName);
                    playBtn.disabled = false;
                    pauseBtn.disabled = false;
                    restartBtn.disabled = false;
                    tourToggle.disabled = false;
                    statsToggle.disabled = false;

                    // Set button state based on autoplay
                    if (isAutoplayMode) {
                        playBtn.classList.add('hidden');
                        pauseBtn.classList.remove('hidden');
                        visualizer.setPaused(false);
                    } else {
                        playBtn.classList.remove('hidden');
                        pauseBtn.classList.add('hidden');
                        visualizer.setPaused(true);
                    }

                    console.log(
                        'Network built successfully (in worker):',
                        summary,
                    );

                    // Rebuild graph from serialized data
                    const graph = NetworkParser.rebuildGraph(serializedGraph);

                    // Setup Progress UI
                    visualizer.onLayoutProgress = (percent) => {
                        showStatus(
                            `Calculating topological layout: ${percent}%`,
                        );
                    };

                    // Build 3D Visualization
                    visualizer.buildVisualization(graph).then(() => {
                        welcomeMsg.classList.add('hidden');
                        hideStatus();

                        if (tourToggle.checked) {
                            visualizer.startAutoTour();
                        } else {
                            visualizer.stopAutoTour();
                        }
                    });
                };

                parserWorker.postMessage({ midiBuffer: arrayBuffer });
            }
        } catch (err) {
            console.error('Error processing MIDI file:', err);
            showStatus('Error processing MIDI file. See console.');
        }
    };

    const loadMidiFromUrl = async (url, fileName) => {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch MIDI');
            const arrayBuffer = await response.arrayBuffer();
            await processMidi(arrayBuffer, fileName);
        } catch (err) {
            console.error('Error loading MIDI:', err);
            showStatus(`Error loading ${fileName}.`);
        }
    };

    const handleFileSelection = async (file) => {
        if (!file) return;
        const fileName = file.name;
        const ext = fileName.toLowerCase();

        // Security enhancement: Add file size limit to prevent potential DoS from extremely large files.
        const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
        if (file.size > MAX_FILE_SIZE) {
            showStatus(
                'File is too large. Please upload a MIDI file smaller than 5MB.',
            );
            setTimeout(hideStatus, 3000);
            return;
        }

        if (ext.endsWith('.mid') || ext.endsWith('.midi')) {
            const arrayBuffer = await file.arrayBuffer();

            // Security enhancement: Validate magic number to prevent processing malicious files
            let isValidMidi = false;
            if (arrayBuffer.byteLength >= 4) {
                const dataView = new DataView(arrayBuffer);
                const magicNumber = dataView.getUint32(0, false);
                if (magicNumber === 0x4d546864) {
                    // "MThd"
                    isValidMidi = true;
                }
            }

            if (isValidMidi) {
                await processMidi(arrayBuffer, fileName);
            } else {
                showStatus('Invalid or corrupted MIDI file.');
                setTimeout(hideStatus, 3000);
            }
        } else {
            showStatus(
                'Invalid file type. Please upload a .mid or .midi file.',
            );
            setTimeout(hideStatus, 3000);
        }
    };

    closeInfo.addEventListener('click', () => {
        infoPanel.classList.add('hidden');
        statsToggle.checked = false;
        statsToggle.setAttribute('aria-expanded', 'false');
    });

    // Close info panel on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !infoPanel.classList.contains('hidden')) {
            infoPanel.classList.add('hidden');
            statsToggle.checked = false;
            statsToggle.setAttribute('aria-expanded', 'false');
            statsToggle.focus();
        }

        if (e.key.toLowerCase() === 'h') {
            if (
                document.activeElement.tagName === 'INPUT' ||
                document.activeElement.tagName === 'BUTTON'
            ) {
                return;
            }
            toggleUi();
        }

        if (e.key === ' ' || e.key === 'Spacebar') {
            // Ignore if focus is in an input or a button to avoid double-firing or interfering with typing
            if (
                document.activeElement.tagName === 'INPUT' ||
                document.activeElement.tagName === 'BUTTON'
            ) {
                return;
            }

            e.preventDefault(); // Prevent page scroll

            if (!playBtn.disabled) {
                if (player.isPlaying) {
                    pauseBtn.click();
                } else {
                    playBtn.click();
                }
            }
        }
    });

    // Handle Example MIDI clicks
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('example-midi')) {
            e.preventDefault();
            const fileName = e.target.dataset.file;
            loadMidiFromUrl(`./${fileName}`, fileName);
        }
    });

    uploadInput.addEventListener('change', (e) => {
        handleFileSelection(e.target.files[0]);
        e.target.value = '';
    });

    // Reset visualization state when coming back from background
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            visualizer.resetPlayingHighlights();
        }
    });

    // Drag and Drop functionality
    const canvasContainer = document.getElementById('canvas-container');

    canvasContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!uploadInput.disabled && e.dataTransfer.types.includes('Files')) {
            canvasContainer.classList.add('drag-active');
        }
    });

    canvasContainer.addEventListener('dragleave', (e) => {
        e.preventDefault();
        canvasContainer.classList.remove('drag-active');
    });

    canvasContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        canvasContainer.classList.remove('drag-active');
        if (!uploadInput.disabled) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    });
};

document.addEventListener('DOMContentLoaded', init);

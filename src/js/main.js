import { NetworkParser } from './NetworkParser.js';
import { NetworkVisualizer } from './NetworkVisualizer.js';
import { MidiPlayer } from './MidiPlayer.js';
import * as Tone from 'tone';

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
    const toggleInfo = document.getElementById('toggle-info');
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

    // Metric Elements
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
    const player = new MidiPlayer();

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
        appTitle.innerText = summary.title ? summary.title : fileName;

        vCountEl.innerText = summary.vertices;
        eCountEl.innerText = summary.edges;

        // Populate metrics
        Object.keys(metricEls).forEach((key) => {
            if (key === 'intervalBars') return;
            if (metricEls[key]) metricEls[key].innerText = summary[key];
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

        if (window.innerWidth <= 768) {
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

    player.onNotePlay = (nodeId, prevNodeId, instrumentId, isDrums) => {
        visualizer.highlightPlayingElement(nodeId, prevNodeId);
        const emoji = Utils.getInstrumentEmoji(instrumentId, isDrums);
        visualizer.showInstrumentEmoji(nodeId, emoji);
    };
    player.onNoteRelease = (nodeId, prevNodeId) =>
        visualizer.releasePlayingElement(nodeId, prevNodeId);
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

        console.log('Processing MIDI:', fileName);
        showStatus('Parsing MIDI and building network...');
        playBtn.disabled = true;
        pauseBtn.disabled = true;
        restartBtn.disabled = true;
        toggleInfo.disabled = true;

        const autoplayToggle = document.getElementById('autoplay-toggle');
        const autoplay = autoplayToggle ? autoplayToggle.checked : true;

        try {
            // Play Audio
            await player.play(arrayBuffer.slice(0), autoplay);

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
                toggleInfo.disabled = false;

                // Set button state based on autoplay
                if (autoplay) {
                    playBtn.classList.add('hidden');
                    pauseBtn.classList.remove('hidden');
                    visualizer.setPaused(false);
                } else {
                    playBtn.classList.remove('hidden');
                    pauseBtn.classList.add('hidden');
                    visualizer.setPaused(true);
                }

                console.log('Network built successfully (in worker):', summary);

                // Rebuild graph from serialized data
                const graph = NetworkParser.rebuildGraph(serializedGraph);

                // Setup Progress UI
                visualizer.onLayoutProgress = (percent) => {
                    showStatus(`Calculating topological layout: ${percent}%`);
                };

                // Build 3D Visualization
                visualizer.buildVisualization(graph).then(() => {
                    welcomeMsg.classList.add('hidden');
                    hideStatus();
                });
            };

            parserWorker.postMessage({ midiBuffer: arrayBuffer });
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
            await processMidi(arrayBuffer, fileName);
        } else {
            showStatus(
                'Invalid file type. Please upload a .mid or .midi file.',
            );
            setTimeout(hideStatus, 3000);
        }
    };

    // Setup Info Panel Toggle
    toggleInfo.addEventListener('click', () => {
        infoPanel.classList.toggle('hidden');
    });

    closeInfo.addEventListener('click', () => {
        infoPanel.classList.add('hidden');
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

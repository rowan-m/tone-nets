import { rebuildGraph } from './networkParser.js';
import { NetworkVisualizer } from './visualizer.js';
import { MidiPlayer } from './audioPlayer.js';
import * as Tone from 'tone';

console.log('Tone Nets Initialized');

// Setup Web Worker
const parserWorker = new Worker(
    new URL('./parser.worker.js', import.meta.url),
    { type: 'module' },
);

import { INTERVAL_NAMES, getIntervalName } from './utils.js';

const init = async () => {
    const uploadInput = document.getElementById('midi-upload');
    const muteToggle = document.getElementById('mute-toggle');
    const toggleInfo = document.getElementById('toggle-info');
    const closeInfo = document.getElementById('close-info');
    const vCountEl = document.getElementById('v-count');
    const eCountEl = document.getElementById('e-count');
    const infoPanel = document.getElementById('info-panel');
    const welcomeMsg = document.getElementById('welcome-msg');
    const hoverPanel = document.getElementById('hover-panel');
    const hoverContent = document.getElementById('hover-content');
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
        intervalBars: document.getElementById('interval-bars'),
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
        appTitle.innerText =
            summary.title !== 'Unknown Title' ? summary.title : fileName;

        vCountEl.innerText = summary.vertices;
        eCountEl.innerText = summary.edges;

        // Populate metrics
        Object.keys(metricEls).forEach((key) => {
            if (key === 'intervalBars') return;
            // eslint-disable-next-line security/detect-object-injection
            if (metricEls[key]) metricEls[key].innerText = summary[key];
        });

        // Render Interval Signature
        metricEls.intervalBars.innerHTML = '';
        summary.embedding.forEach((val, i) => {
            const bar = document.createElement('div');
            bar.className = 'bar';
            bar.style.height = `${parseFloat(val) * 100}%`;
            // eslint-disable-next-line security/detect-object-injection
            bar.title = `${INTERVAL_NAMES[i]}: ${Math.round(parseFloat(val) * 100)}%`;
            metricEls.intervalBars.appendChild(bar);
        });

        if (window.innerWidth <= 768) {
            infoPanel.classList.add('hidden');
        } else {
            infoPanel.classList.remove('hidden');
        }
        toggleInfo.classList.remove('hidden');
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

    player.onNotePlay = (nodeId, prevNodeId) =>
        visualizer.highlightPlayingElement(nodeId, prevNodeId);
    player.onNoteRelease = (nodeId, prevNodeId) =>
        visualizer.releasePlayingElement(nodeId, prevNodeId);
    player.onStop = () => visualizer.resetPlayingHighlights();

    visualizer.onHover = (data) => {
        if (!data) {
            hoverPanel.classList.add('hidden');
            return;
        }

        hoverPanel.classList.remove('hidden');
        hoverContent.textContent = ''; // Clear safely

        const addMetric = (labelText, valueText) => {
            const div = document.createElement('div');
            div.className = 'metric';
            const label = document.createElement('label');
            label.textContent = labelText;
            const span = document.createElement('span');
            span.textContent = valueText;
            div.appendChild(label);
            div.appendChild(span);
            hoverContent.appendChild(div);
        };

        if (data.type === 'node') {
            const h2 = document.createElement('h2');
            h2.textContent = `Node: ${data.id}`;
            hoverContent.appendChild(h2);
            addMetric('Total Connections', data.degree);
        } else if (data.type === 'edge') {
            const interval = getIntervalName(data.sourceId, data.targetId);
            const h2 = document.createElement('h2');
            h2.textContent = 'Transition';
            hoverContent.appendChild(h2);
            addMetric('From', data.sourceId);
            addMetric('To', data.targetId);
            addMetric('Interval', interval);
            addMetric('Frequency', data.weight);
        }
    };

    const processMidi = async (arrayBuffer, fileName) => {
        await Tone.start();

        console.log('Processing MIDI:', fileName);
        showStatus('Parsing MIDI and building network...');
        muteToggle.disabled = true;

        try {
            // Play Audio
            player.play(arrayBuffer.slice(0)).catch((err) => {
                console.error('Audio playback error:', err);
            });

            // Use Web Worker to build the network
            parserWorker.onmessage = (e) => {
                const { summary, serializedGraph, error } = e.data;

                if (error) {
                    console.error('Worker error:', error);
                    showStatus('Error processing MIDI file. See console.');
                    return;
                }

                updateMetricsUI(summary, fileName);
                muteToggle.disabled = false;

                console.log('Network built successfully (in worker):', summary);

                // Rebuild graph from serialized data
                const graph = rebuildGraph(serializedGraph);

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

    // Setup Mute Toggle
    muteToggle.addEventListener('click', () => {
        const isMuted = player.toggleMute();
        // eslint-disable-next-line no-unsanitized/property
        muteToggle.innerHTML = isMuted
            ? '<span aria-hidden="true">🔇</span>Unmute'
            : '<span aria-hidden="true">🔊</span>Mute';
        muteToggle.style.backgroundColor = isMuted
            ? 'rgba(0, 255, 255, 0.2)'
            : '';
        muteToggle.style.borderColor = isMuted ? 'var(--accent-text)' : '';
        muteToggle.style.color = isMuted ? 'var(--accent-text)' : 'white';
    });

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
            loadMidiFromUrl(`/${fileName}`, fileName);
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

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

const setupUI = (callbacks) => {
    const els = {
        uploadInput: document.getElementById('midi-upload'),
        playBtn: document.getElementById('play-btn'),
        pauseBtn: document.getElementById('pause-btn'),
        restartBtn: document.getElementById('restart-btn'),
        closeInfo: document.getElementById('close-info'),
        vCountEl: document.getElementById('v-count'),
        eCountEl: document.getElementById('e-count'),
        infoPanel: document.getElementById('info-panel'),
        welcomeMsg: document.getElementById('welcome-msg'),
        hoverPanel: document.getElementById('hover-panel'),
        hoverNode: document.getElementById('hover-node'),
        hoverNodeId: document.getElementById('hover-node-id'),
        hoverNodeDegree: document.getElementById('hover-node-degree'),
        hoverEdge: document.getElementById('hover-edge'),
        hoverEdgeFrom: document.getElementById('hover-edge-from'),
        hoverEdgeTo: document.getElementById('hover-edge-to'),
        hoverEdgeInterval: document.getElementById('hover-edge-interval'),
        hoverEdgeWeight: document.getElementById('hover-edge-weight'),
        appTitle: document.getElementById('app-title'),
        statusModal: document.getElementById('status-modal'),
        statusModalText: document.getElementById('status-modal-text'),
        appEl: document.getElementById('app'),
        hideUiBtn: document.getElementById('hide-ui'),
        showUiBtn: document.getElementById('show-ui'),
        autoplayToggle: document.getElementById('autoplay-toggle'),
        loopToggle: document.getElementById('loop-toggle'),
        incrementalToggle: document.getElementById('incremental-toggle'),
        statsToggle: document.getElementById('stats-toggle'),
        tourToggle: document.getElementById('tour-toggle'),
        canvasContainer: document.getElementById('canvas-container'),
        metricEls: {
            efficiency: document.getElementById('metric-efficiency'),
            weightedEfficiency: document.getElementById(
                'metric-weighted-efficiency',
            ),
            entropy: document.getElementById('metric-entropy'),
            binaryReciprocity: document.getElementById(
                'metric-binary-reciprocity',
            ),
            reciprocity: document.getElementById('metric-reciprocity'),
            reciprocityRho: document.getElementById('metric-reciprocity-rho'),
            density: document.getElementById('metric-density'),
            intervalBars: document.querySelectorAll('#interval-bars .bar'),
        },
    };

    const showStatus = (text) => {
        els.statusModalText.textContent = text;
        if (!els.statusModal.open) {
            els.statusModal.showModal();
        }
    };

    const hideStatus = () => {
        if (els.statusModal.open) {
            els.statusModal.close();
        }
    };

    const toggleUi = () => {
        els.appEl.classList.toggle('ui-hidden');
    };

    // Show non-dismissable status modal initially
    els.statusModal.showModal();
    els.statusModal.addEventListener('cancel', (e) => e.preventDefault());

    // Event Listeners
    els.incrementalToggle.addEventListener('change', (e) => {
        callbacks.onIncrementalToggle(e.target.checked);
        if (e.target.checked) {
            els.infoPanel.classList.add('hidden');
            els.statsToggle.disabled = true;
            els.statsToggle.checked = false;
        } else if (!els.playBtn.disabled) {
            els.statsToggle.disabled = false;
        }
    });

    els.autoplayToggle.addEventListener('change', (e) => {
        callbacks.onAutoplayToggle(e.target.checked);
    });

    els.loopToggle.addEventListener('change', (e) => {
        callbacks.onLoopToggle(e.target.checked);
    });

    els.statsToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            els.infoPanel.classList.remove('hidden');
        } else {
            els.infoPanel.classList.add('hidden');
        }
        els.statsToggle.setAttribute('aria-expanded', e.target.checked);
    });

    els.tourToggle.addEventListener('change', (e) => {
        callbacks.onTourToggle(e.target.checked);
    });

    els.hideUiBtn.addEventListener('click', toggleUi);
    els.showUiBtn.addEventListener('click', toggleUi);

    els.playBtn.addEventListener('click', callbacks.onTogglePlayPause);
    els.pauseBtn.addEventListener('click', callbacks.onTogglePlayPause);
    els.restartBtn.addEventListener('click', callbacks.onRestart);

    els.uploadInput.addEventListener('change', (e) => {
        callbacks.onFileSelection(e.target.files[0]);
        e.target.value = '';
    });

    els.closeInfo.addEventListener('click', () => {
        els.infoPanel.classList.add('hidden');
        els.statsToggle.checked = false;
        els.statsToggle.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !els.infoPanel.classList.contains('hidden')) {
            els.infoPanel.classList.add('hidden');
            els.statsToggle.checked = false;
            els.statsToggle.setAttribute('aria-expanded', 'false');
            els.statsToggle.focus();
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
            if (
                document.activeElement.tagName === 'INPUT' ||
                document.activeElement.tagName === 'BUTTON'
            ) {
                return;
            }

            e.preventDefault();

            if (!els.playBtn.disabled) {
                if (callbacks.isPlaying()) {
                    els.pauseBtn.click();
                } else {
                    els.playBtn.click();
                }
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('example-midi')) {
            e.preventDefault();
            const fileName = e.target.dataset.file;
            callbacks.onExampleMidiClick(fileName);
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            callbacks.onVisibilityChange();
        }
    });

    els.canvasContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (
            !els.uploadInput.disabled &&
            e.dataTransfer.types.includes('Files')
        ) {
            els.canvasContainer.classList.add('drag-active');
        }
    });

    els.canvasContainer.addEventListener('dragleave', (e) => {
        e.preventDefault();
        els.canvasContainer.classList.remove('drag-active');
    });

    els.canvasContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        els.canvasContainer.classList.remove('drag-active');
        if (!els.uploadInput.disabled) {
            callbacks.onFileSelection(e.dataTransfer.files[0]);
        }
    });

    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler(
            'play',
            callbacks.onTogglePlayPause,
        );
        navigator.mediaSession.setActionHandler(
            'pause',
            callbacks.onTogglePlayPause,
        );
    }

    return { els, showStatus, hideStatus };
};

const init = async () => {
    let isIncrementalMode = true;
    let isAutoplayMode = true;

    const visualizer = new NetworkVisualizer('canvas-container');
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
        onFileSelection: (file) => {
            handleFileSelection(file);
        },
        isPlaying: () => player.isPlaying,
        onExampleMidiClick: (fileName) => {
            loadMidiFromUrl(`./${fileName}`, fileName);
        },
        onVisibilityChange: () => {
            visualizer.resetPlayingHighlights();
        },
    };

    const ui = setupUI(callbacks);

    visualizer.onTourChange = (enabled) => {
        ui.els.tourToggle.checked = enabled;
    };
    player.isLooping = ui.els.loopToggle.checked;

    const updateMetricsUI = (summary, fileName) => {
        ui.els.appTitle.textContent = summary.title ? summary.title : fileName;

        ui.els.vCountEl.textContent = summary.vertices;
        ui.els.eCountEl.textContent = summary.edges;

        Object.keys(ui.els.metricEls).forEach((key) => {
            if (key === 'intervalBars') return;
            if (ui.els.metricEls[key])
                ui.els.metricEls[key].textContent = summary[key];
        });

        summary.embedding.forEach((val, i) => {
            const percentage = Math.round(parseFloat(val) * 100);
            const bar = ui.els.metricEls.intervalBars[i];
            if (bar) {
                bar.style.height = `${percentage}%`;
                bar.title = `${Utils.INTERVAL_NAMES[i]}: ${percentage}%`;
                bar.setAttribute('aria-valuenow', percentage);
            }
        });

        if (isIncrementalMode || window.innerWidth <= 768) {
            ui.els.infoPanel.classList.add('hidden');
        } else {
            ui.els.infoPanel.classList.remove('hidden');
        }
    };

    ui.els.uploadInput.disabled = true;

    try {
        await player.loadSoundfont();
        ui.hideStatus();
        ui.els.uploadInput.disabled = false;
    } catch (error) {
        ui.showStatus('Error loading SoundFont. See console.');
        console.error(error);
    }

    let lastCountUpdate = 0;
    player.onNotePlay = (nodeId, prevNodeId, instrumentId, isDrums) => {
        if (document.visibilityState === 'hidden') return;
        requestAnimationFrame(() => {
            if (document.visibilityState === 'hidden') return;

            if (isIncrementalMode && !isDrums) {
                visualizer.addTransitionIncremental(prevNodeId, nodeId);
                const now = performance.now();
                if (now - lastCountUpdate > 250) {
                    ui.els.vCountEl.textContent =
                        visualizer.graph.getNodesCount();
                    ui.els.eCountEl.textContent =
                        visualizer.graph.getLinksCount();
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
            ui.els.playBtn.classList.remove('hidden');
            ui.els.pauseBtn.classList.add('hidden');
        }
    };

    visualizer.onHover = (data) => {
        if (!data) {
            ui.els.hoverPanel.classList.add('hidden');
            return;
        }

        ui.els.hoverPanel.classList.remove('hidden');

        if (data.type === 'node') {
            ui.els.hoverNode.classList.remove('hidden');
            ui.els.hoverEdge.classList.add('hidden');
            ui.els.hoverNodeId.textContent = `Node: ${data.id}`;
            ui.els.hoverNodeDegree.textContent = data.degree;
        } else if (data.type === 'edge') {
            ui.els.hoverNode.classList.add('hidden');
            ui.els.hoverEdge.classList.remove('hidden');
            const interval = Utils.getIntervalName(
                data.sourceId,
                data.targetId,
            );
            ui.els.hoverEdgeFrom.textContent = data.sourceId;
            ui.els.hoverEdgeTo.textContent = data.targetId;
            ui.els.hoverEdgeInterval.textContent = interval;
            ui.els.hoverEdgeWeight.textContent = data.weight;
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

            player.updateMediaSessionPosition();
        }
    };

    const togglePlayPause = () => {
        if (player.isPlaying) {
            player.pause();
            visualizer.setPaused(true);

            ui.els.playBtn.classList.remove('hidden');
            ui.els.pauseBtn.classList.add('hidden');
        } else {
            player.resume();
            visualizer.setPaused(false);

            ui.els.playBtn.classList.add('hidden');
            ui.els.pauseBtn.classList.remove('hidden');
        }
    };

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

                await player.play(arrayBuffer.slice(0), isAutoplayMode);

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

                if (isAutoplayMode) {
                    ui.els.playBtn.classList.add('hidden');
                    ui.els.pauseBtn.classList.remove('hidden');
                    visualizer.setPaused(false);
                } else {
                    ui.els.playBtn.classList.remove('hidden');
                    ui.els.pauseBtn.classList.add('hidden');
                    visualizer.setPaused(true);
                }

                ui.hideStatus();
            } else {
                await player.play(arrayBuffer.slice(0), isAutoplayMode);

                parserWorker.onmessage = (e) => {
                    const { summary, serializedGraph, error } = e.data;

                    if (error) {
                        console.error('Worker error:', error);
                        ui.showStatus(
                            'Error processing MIDI file. See console.',
                        );
                        return;
                    }

                    if (summary.duration) {
                        player.duration = summary.duration;
                    }
                    updateMetricsUI(summary, fileName);
                    updateMediaSession(summary.title, fileName);
                    ui.els.playBtn.disabled = false;
                    ui.els.pauseBtn.disabled = false;
                    ui.els.restartBtn.disabled = false;
                    ui.els.tourToggle.disabled = false;
                    ui.els.statsToggle.disabled = false;

                    if (isAutoplayMode) {
                        ui.els.playBtn.classList.add('hidden');
                        ui.els.pauseBtn.classList.remove('hidden');
                        visualizer.setPaused(false);
                    } else {
                        ui.els.playBtn.classList.remove('hidden');
                        ui.els.pauseBtn.classList.add('hidden');
                        visualizer.setPaused(true);
                    }

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

                    visualizer.buildVisualization(graph).then(() => {
                        ui.els.welcomeMsg.classList.add('hidden');
                        ui.hideStatus();

                        if (ui.els.tourToggle.checked) {
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
            ui.showStatus('Error processing MIDI file. See console.');
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
            ui.showStatus(`Error loading ${fileName}.`);
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
            setTimeout(ui.hideStatus, 3000);
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
                setTimeout(ui.hideStatus, 3000);
            }
        } else {
            ui.showStatus(
                'Invalid file type. Please upload a .mid or .midi file.',
            );
            setTimeout(ui.hideStatus, 3000);
        }
    };
};

document.addEventListener('DOMContentLoaded', init);

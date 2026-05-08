import { rebuildGraph } from './networkParser.js';
import { NetworkVisualizer } from './visualizer.js';
import { MidiPlayer } from './audioPlayer.js';
import * as Tone from 'tone';

console.log("Music Analysis Visualizer Initialized");

// Setup Web Worker
const parserWorker = new Worker(new URL('./parser.worker.js', import.meta.url), { type: 'module' });

import { INTERVAL_NAMES, getIntervalName } from './utils.js';

const init = () => {
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
    
    // Initialize Subsystems
    const visualizer = new NetworkVisualizer('canvas-container');
    const player = new MidiPlayer();

    player.onNotePlay = (nodeId, prevNodeId) => visualizer.highlightPlayingElement(nodeId, prevNodeId);
    player.onNoteRelease = (nodeId, prevNodeId) => visualizer.releasePlayingElement(nodeId, prevNodeId);
    player.onStop = () => visualizer.resetPlayingHighlights();

    visualizer.onHover = (data) => {
        if (!data) {
            hoverPanel.classList.add('hidden');
            return;
        }
        
        hoverPanel.classList.remove('hidden');
        if (data.type === 'node') {
            hoverContent.innerHTML = `
                <h2>Node: ${data.id}</h2>
                <div class="metric"><label>Total Connections</label><span>${data.degree}</span></div>
            `;
        } else if (data.type === 'edge') {
            const interval = getIntervalName(data.sourceId, data.targetId);
            hoverContent.innerHTML = `
                <h2>Transition</h2>
                <div class="metric"><label>From</label><span>${data.sourceId}</span></div>
                <div class="metric"><label>To</label><span>${data.targetId}</span></div>
                <div class="metric"><label>Interval</label><span>${interval}</span></div>
                <div class="metric"><label>Frequency</label><span>${data.weight}</span></div>
            `;
        }
    };

    // Setup Mute Toggle
    muteToggle.addEventListener('click', () => {
        const isMuted = player.toggleMute();
        muteToggle.innerText = isMuted ? "Unmute" : "Mute";
        muteToggle.style.backgroundColor = isMuted ? "rgba(0, 255, 255, 0.2)" : "";
        muteToggle.style.borderColor = isMuted ? "var(--accent-text)" : "";
        muteToggle.style.color = isMuted ? "var(--accent-text)" : "white";
    });

    // Setup Info Panel Toggle
    toggleInfo.addEventListener('click', () => {
        infoPanel.classList.toggle('hidden');
    });

    closeInfo.addEventListener('click', () => {
        infoPanel.classList.add('hidden');
    });

    uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            // IMMEDIATE USER GESTURE HANDLING
            // We must start the audio context immediately upon the file selection event.
            // If we wait for the 3000-step layout calculation, the browser's 
            // "transient user activation" token will expire and audio will be blocked.
            await Tone.start();

            console.log("File selected:", file.name);
            welcomeMsg.innerText = "Parsing MIDI and building network...";
            welcomeMsg.classList.remove('hidden');
            muteToggle.disabled = true;

            try {
                // Read file as ArrayBuffer for @tonejs/midi
                const arrayBuffer = await file.arrayBuffer();
                // Play Audio
                player.play(arrayBuffer.slice(0));
                
                // Use Web Worker to build the network
                parserWorker.onmessage = (e) => {
                    const { summary, serializedGraph, error } = e.data;
                    
                    if (error) {
                        console.error("Worker error:", error);
                        welcomeMsg.innerText = "Error processing MIDI file. See console.";
                        return;
                    }

                    // Update UI Summary
                    appTitle.innerText = summary.title !== 'Unknown Title' ? summary.title : file.name;
                    
                    vCountEl.innerText = summary.vertices;
                    eCountEl.innerText = summary.edges;
                    document.getElementById('metric-efficiency').innerText = summary.efficiency;
                    document.getElementById('metric-weighted-efficiency').innerText = summary.weightedEfficiency;
                    document.getElementById('metric-entropy').innerText = summary.entropy;
                    document.getElementById('metric-binary-reciprocity').innerText = summary.binaryReciprocity;
                    document.getElementById('metric-reciprocity').innerText = summary.reciprocity;
                    document.getElementById('metric-reciprocity-rho').innerText = summary.reciprocityRho;
                    document.getElementById('metric-density').innerText = summary.density;
                    
                    // Render Interval Signature
                    const barContainer = document.getElementById('interval-bars');
                    barContainer.innerHTML = '';
                    summary.embedding.forEach((val, i) => {
                        const bar = document.createElement('div');
                        bar.className = 'bar';
                        bar.style.height = `${parseFloat(val) * 100}%`;
                        bar.title = `${INTERVAL_NAMES[i]}: ${Math.round(parseFloat(val) * 100)}%`;
                        barContainer.appendChild(bar);
                    });

                    if (window.innerWidth <= 768) {
                        infoPanel.classList.add('hidden');
                    } else {
                        infoPanel.classList.remove('hidden');
                    }
                    toggleInfo.classList.remove('hidden');
                    welcomeMsg.classList.add('hidden');
                    muteToggle.disabled = false;

                    console.log("Network built successfully (in worker):", summary);

                    // Rebuild graph from serialized data
                    const graph = rebuildGraph(serializedGraph);

                    // Setup Progress UI
                    visualizer.onLayoutProgress = (percent) => {
                        welcomeMsg.innerText = `Calculating topological layout: ${percent}%`;
                        welcomeMsg.classList.remove('hidden');
                    };

                    // Build 3D Visualization
                    visualizer.buildVisualization(graph).then(() => {
                        welcomeMsg.classList.add('hidden');
                    });
                };

                parserWorker.postMessage({ midiBuffer: arrayBuffer });

            } catch (err) {
                console.error("Error processing MIDI file:", err);
                welcomeMsg.innerText = "Error processing MIDI file. See console.";
            }
        }
    });
};

document.addEventListener('DOMContentLoaded', init);

import { rebuildGraph } from './networkParser.js';
import { NetworkVisualizer } from './visualizer.js';
import { MidiPlayer } from './audioPlayer.js';
import * as Tone from 'tone';

console.log("Music Analysis Visualizer Initialized");

// Setup Web Worker
const parserWorker = new Worker(new URL('./parser.worker.js', import.meta.url), { type: 'module' });

const INTERVAL_NAMES = ["Perfect Unison", "Minor Second", "Major Second", "Minor Third", "Major Third", "Perfect Fourth", "Tritone", "Perfect Fifth", "Minor Sixth", "Major Sixth", "Minor Seventh", "Major Seventh"];

function getIntervalName(n1, n2) {
    const notes = { 'C':0, 'C#':1, 'DB':1, 'D':2, 'D#':3, 'EB':3, 'E':4, 'F':5, 'F#':6, 'GB':6, 'G':7, 'G#':8, 'AB':8, 'A':9, 'A#':10, 'BB':10, 'B':11 };
    const parsePitch = (n) => {
        const match = n.toUpperCase().match(/([A-G]#?B?)/);
        return match ? notes[match[1]] : 0;
    };
    const diff = (parsePitch(n2) - parsePitch(n1) + 12) % 12;
    return INTERVAL_NAMES[diff];
}

const init = () => {
    const uploadInput = document.getElementById('midi-upload');
    const muteToggle = document.getElementById('mute-toggle');
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
        muteToggle.style.backgroundColor = isMuted ? "#ff4500" : "#1a1a1f";
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
                    document.getElementById('metric-entropy').innerText = summary.entropy;
                    document.getElementById('metric-reciprocity').innerText = summary.reciprocity;
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

                    infoPanel.classList.remove('hidden');
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

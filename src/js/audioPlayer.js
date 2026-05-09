import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

export class MidiPlayer {
    constructor() {
        this.synth = null;
        this.sf2Buffer = null;
        this.isPlaying = false;
        this.isMuted = false;
        this.scheduledEvents = [];
        this.masterGain = null;
        
        // Hooks for visualization
        this.onNotePlay = null;
        this.onNoteRelease = null;
        this.onStop = null;
    }

    async loadSoundfont(url = '/creative-emu10k1-8mbgmsfx.sf2') {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load soundfont: ${response.statusText}`);
        this.sf2Buffer = await response.arrayBuffer();
    }

    async initialize() {
        // If we haven't fetched the buffer yet, do it now
        if (!this.sf2Buffer) {
             await this.loadSoundfont();
        }

        // Only create the synth once the user has interacted
        if (Tone.context.state !== 'running') {
            await Tone.start();
        }

        if (!this.synth) {
            // Create a dedicated native AudioContext to bypass Tone.js standardized-audio-context wrappers
            const rawCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (rawCtx.state === 'suspended') {
                await rawCtx.resume();
            }
            
            // Register the AudioWorklet processor BEFORE creating the synthesizer
            await rawCtx.audioWorklet.addModule(processorUrl);

            // Create master gain
            this.masterGain = rawCtx.createGain();
            this.masterGain.gain.value = this.isMuted ? 0 : 1;
            this.masterGain.connect(rawCtx.destination);
            
            // Initialize SpessaSynth
            this.synth = new WorkletSynthesizer(rawCtx);
            
            // Disconnect from default destination (if any) and connect to our master gain
            this.synth.disconnect();
            this.synth.connect(this.masterGain);
            
            // Wait for worklet to be ready
            await this.synth.isReady;
            
            // Load the SoundFont
            await this.synth.soundBankManager.addSoundBank(this.sf2Buffer, 'default');
        }
    }

    async play(midiBuffer) {
        this.stop(); // Stop any existing playback

        // Ensure audio context is started and synth exists
        await this.initialize();

        const midi = new Midi(midiBuffer);
        const startDelay = 0.5; // Start half a second from the beginning of Transport

        midi.tracks.forEach(track => {
            const channel = track.channel; // 0-15

            track.notes.forEach((note, index) => {
                const prevNote = index > 0 ? track.notes[index - 1] : null;
                
                const scheduledEvent = Tone.Transport.schedule((time) => {
                    if (this.synth) {
                        // Use Tone.Draw to fire exactly at the visual frame to avoid Tone.Transport lookahead mismatch
                        Tone.Draw.schedule(() => {
                            // SpessaSynth: noteOn(channel, note, velocity)
                            // Velocity is typically 0-127
                            this.synth.noteOn(channel, note.midi, Math.round(note.velocity * 127));
                            if (this.onNotePlay) {
                                this.onNotePlay(note.name, prevNote ? prevNote.name : null);
                            }
                        }, time);
                    }
                }, note.time + startDelay);
                this.scheduledEvents.push(scheduledEvent);
                
                const releaseEvent = Tone.Transport.schedule((time) => {
                    if (this.synth) {
                        Tone.Draw.schedule(() => {
                            this.synth.noteOff(channel, note.midi);
                            if (this.onNoteRelease) {
                                this.onNoteRelease(note.name, prevNote ? prevNote.name : null);
                            }
                        }, time);
                    }
                }, note.time + startDelay + note.duration);
                this.scheduledEvents.push(releaseEvent);
            });
        });

        // Ensure transport starts from the beginning
        Tone.Transport.position = 0;
        Tone.Transport.start();
        this.isPlaying = true;
    }

    stop() {
        Tone.Transport.stop();
        Tone.Transport.cancel(0); // Clear scheduled events
        this.scheduledEvents = [];
        if (this.synth) {
            // Synthesizer might have stopAll or we can just send "all notes off" CC
            for (let i = 0; i < 16; i++) {
                 // CC 123 is All Notes Off
                 this.synth.controllerChange(i, 123, 0);
            }
        }
        if (this.onStop) {
            this.onStop();
        }
        this.isPlaying = false;
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.masterGain) {
            this.masterGain.gain.value = this.isMuted ? 0 : 1;
        }
        if (this.isMuted && this.synth) {
            // Silence currently playing notes
            for (let i = 0; i < 16; i++) {
                 this.synth.controllerChange(i, 123, 0);
            }
        }
        return this.isMuted;
    }
}

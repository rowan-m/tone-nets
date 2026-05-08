import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';

export class MidiPlayer {
    constructor() {
        this.synth = null;
        this.isPlaying = false;
        this.isMuted = false;
        this.scheduledEvents = [];
        
        // Hooks for visualization
        this.onNotePlay = null;
        this.onNoteRelease = null;
        this.onStop = null;
    }

    async initialize() {
        // Only create the synth once the user has interacted
        if (!this.synth) {
            await Tone.start();
            this.synth = new Tone.PolySynth(Tone.Synth).toDestination();
        } else if (Tone.context.state !== 'running') {
            await Tone.start();
        }
    }

    async play(midiBuffer) {
        this.stop(); // Stop any existing playback

        // Ensure audio context is started and synth exists
        await this.initialize();

        const midi = new Midi(midiBuffer);
        const startDelay = 0.5; // Start half a second from the beginning of Transport

        midi.tracks.forEach(track => {
            // Ignore percussion for this simple synth
            if (track.channel === 9) return;

            track.notes.forEach((note, index) => {
                const prevNote = index > 0 ? track.notes[index - 1] : null;
                
                const scheduledEvent = Tone.Transport.schedule((time) => {
                    if (!this.isMuted && this.synth) {
                        this.synth.triggerAttackRelease(note.name, note.duration, time, note.velocity);
                    }
                    
                    if (this.onNotePlay) {
                        Tone.Draw.schedule(() => {
                            this.onNotePlay(note.name, prevNote ? prevNote.name : null);
                        }, time);
                    }
                }, note.time + startDelay);
                this.scheduledEvents.push(scheduledEvent);
                
                const releaseEvent = Tone.Transport.schedule((time) => {
                    if (this.onNoteRelease) {
                        Tone.Draw.schedule(() => {
                            this.onNoteRelease(note.name, prevNote ? prevNote.name : null);
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
            this.synth.releaseAll();
        }
        if (this.onStop) {
            this.onStop();
        }
        this.isPlaying = false;
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.isMuted && this.synth) {
            this.synth.releaseAll(); // Immediately silence currently playing notes
        }
        return this.isMuted;
    }
}

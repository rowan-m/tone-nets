import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';

export class MidiPlayer {
    constructor() {
        this.synth = null;
        this.isPlaying = false;
        this.isMuted = false;
        this.scheduledEvents = [];
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

            track.notes.forEach(note => {
                const scheduledEvent = Tone.Transport.schedule((time) => {
                    if (!this.isMuted && this.synth) {
                        this.synth.triggerAttackRelease(note.name, note.duration, time, note.velocity);
                    }
                }, note.time + startDelay);
                this.scheduledEvents.push(scheduledEvent);
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

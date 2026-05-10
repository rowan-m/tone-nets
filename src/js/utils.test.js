import { describe, it, expect } from 'vitest';
import { noteToSemitone, getInterval, getIntervalName, getInstrumentEmoji } from './utils.js';

describe('utils', () => {
    describe('noteToSemitone', () => {
        it('should convert basic notes correctly', () => {
            expect(noteToSemitone('C4')).toBe(48);
            expect(noteToSemitone('A4')).toBe(57);
            expect(noteToSemitone('C5')).toBe(60);
        });

        it('should handle sharps and flats', () => {
            expect(noteToSemitone('C#4')).toBe(49);
            expect(noteToSemitone('Db4')).toBe(49);
            expect(noteToSemitone('Bb3')).toBe(46);
        });

        it('should handle negative octaves', () => {
            expect(noteToSemitone('C-1')).toBe(-12);
        });

        it('should handle default octave (4)', () => {
            expect(noteToSemitone('C')).toBe(48);
        });

        it('should be case insensitive', () => {
            expect(noteToSemitone('c4')).toBe(48);
            expect(noteToSemitone('eb2')).toBe(27);
        });

        it('should return 0 for invalid notes', () => {
            expect(noteToSemitone('H4')).toBe(0);
            expect(noteToSemitone('')).toBe(0);
        });
    });

    describe('getInterval', () => {
        it('should calculate interval between notes correctly', () => {
            expect(getInterval('C4', 'G4')).toBe(7);
            expect(getInterval('G4', 'C5')).toBe(5);
            expect(getInterval('C4', 'C#4')).toBe(1);
            expect(getInterval('C#4', 'C4')).toBe(11);
        });
    });

    describe('getIntervalName', () => {
        it('should return correct interval names', () => {
            expect(getIntervalName('C4', 'C4')).toBe('Perfect Unison');
            expect(getIntervalName('C4', 'G4')).toBe('Perfect Fifth');
            expect(getIntervalName('C4', 'C5')).toBe('Perfect Unison');
        });
    });

    describe('getInstrumentEmoji', () => {
        it('should return correct emojis', () => {
            expect(getInstrumentEmoji(0)).toBe('🎹');
            expect(getInstrumentEmoji(40)).toBe('🎻');
            expect(getInstrumentEmoji(0, true)).toBe('🥁');
            expect(getInstrumentEmoji(999)).toBe('🎵');
        });
    });
});

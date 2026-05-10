import { describe, it, expect } from 'vitest';
import { noteToSemitone, getInterval, getIntervalName } from './utils.js';

describe('utils', () => {
    describe('noteToSemitone', () => {
        it('should correctly convert notes to semitones', () => {
            expect(noteToSemitone('C4')).toBe(48);
            expect(noteToSemitone('C#4')).toBe(49);
            expect(noteToSemitone('Db4')).toBe(49);
            expect(noteToSemitone('D4')).toBe(50);
            expect(noteToSemitone('A4')).toBe(57);
            expect(noteToSemitone('B4')).toBe(59);
            expect(noteToSemitone('C5')).toBe(60);
        });

        it('should handle different octaves', () => {
            expect(noteToSemitone('C0')).toBe(0);
            expect(noteToSemitone('C-1')).toBe(-12);
        });

        it('should handle case insensitivity', () => {
            expect(noteToSemitone('c4')).toBe(48);
            expect(noteToSemitone('Eb4')).toBe(51);
            expect(noteToSemitone('eb4')).toBe(51);
        });

        it('should return 0 for invalid notes', () => {
            expect(noteToSemitone('H4')).toBe(0);
            expect(noteToSemitone('')).toBe(0);
        });
    });

    describe('getInterval', () => {
        it('should calculate the directed pitch class interval', () => {
            expect(getInterval('C4', 'C4')).toBe(0);
            expect(getInterval('C4', 'G4')).toBe(7);
            expect(getInterval('G4', 'C4')).toBe(5); // 48 - 55 = -7. (-7 % 12 + 12) % 12 = 5
            expect(getInterval('C4', 'C5')).toBe(0);
            expect(getInterval('B4', 'C5')).toBe(1);
        });
    });

    describe('getIntervalName', () => {
        it('should return the correct interval name', () => {
            expect(getIntervalName('C4', 'C4')).toBe('Perfect Unison');
            expect(getIntervalName('C4', 'C#4')).toBe('Minor Second');
            expect(getIntervalName('C4', 'D4')).toBe('Major Second');
            expect(getIntervalName('C4', 'Eb4')).toBe('Minor Third');
            expect(getIntervalName('C4', 'E4')).toBe('Major Third');
            expect(getIntervalName('C4', 'F4')).toBe('Perfect Fourth');
            expect(getIntervalName('C4', 'F#4')).toBe('Tritone');
            expect(getIntervalName('C4', 'G4')).toBe('Perfect Fifth');
            expect(getIntervalName('C4', 'Ab4')).toBe('Minor Sixth');
            expect(getIntervalName('C4', 'A4')).toBe('Major Sixth');
            expect(getIntervalName('C4', 'Bb4')).toBe('Minor Seventh');
            expect(getIntervalName('C4', 'B4')).toBe('Major Seventh');
        });

        it('should handle octave differences correctly (modulo 12)', () => {
            expect(getIntervalName('C4', 'C5')).toBe('Perfect Unison');
            expect(getIntervalName('C4', 'G5')).toBe('Perfect Fifth');
        });

        it('should handle downward intervals correctly', () => {
            expect(getIntervalName('G4', 'C4')).toBe('Perfect Fourth'); // G to C is a perfect 4th down (5 semitones up)
        });
    });
});

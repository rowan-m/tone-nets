import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { AudioSpectrumAnalyzer } from './AudioSpectrumAnalyzer.js';

describe('AudioSpectrumAnalyzer', () => {
    it('initializes equalizer data buffer and NearestFilter DataTexture', () => {
        const analyzer = new AudioSpectrumAnalyzer({ barCount: 32 });

        expect(analyzer.barCount).toBe(32);
        expect(analyzer.freqData).toBeInstanceOf(Uint8Array);
        expect(analyzer.freqData).toHaveLength(32);
        expect(analyzer.texture).toBeInstanceOf(THREE.DataTexture);
        expect(analyzer.texture.minFilter).toBe(THREE.NearestFilter);
        expect(analyzer.texture.magFilter).toBe(THREE.NearestFilter);
    });

    it('updates frequency bars with attack and decay ballistics', () => {
        const analyzer = new AudioSpectrumAnalyzer({ barCount: 32 });

        // Safe no-op when frequencyData is null
        analyzer.updateEqualizer(null);
        expect(analyzer.freqData.every((v) => v === 0)).toBe(true);

        // Attack phase with high energy
        const highFreq = new Uint8Array(128).fill(200);
        analyzer.updateEqualizer(highFreq);
        expect(analyzer.freqData.some((v) => v > 0)).toBe(true);
        const peakVal = analyzer.freqData[10];

        // Decay phase with zero energy
        const zeroFreq = new Uint8Array(128).fill(0);
        analyzer.updateEqualizer(zeroFreq);
        expect(analyzer.freqData[10]).toBeLessThan(peakVal);
    });

    it('calculates normalized band energy for bass and treble ranges', () => {
        expect(AudioSpectrumAnalyzer.getBandEnergy(null, 0, 0.2)).toBe(0);
        expect(
            AudioSpectrumAnalyzer.getBandEnergy(new Uint8Array(0), 0, 0.2),
        ).toBe(0);

        const data = new Uint8Array(100);
        data.fill(255, 0, 20); // Full bass energy in first 20%
        data.fill(128, 50, 100); // ~50% treble energy in upper half

        expect(AudioSpectrumAnalyzer.getBandEnergy(data, 0, 0.2)).toBeCloseTo(
            1.0,
        );
        expect(AudioSpectrumAnalyzer.getBandEnergy(data, 0.5, 1.0)).toBeCloseTo(
            128 / 255,
        );
    });

    it('disposes the underlying DataTexture on dispose()', () => {
        const analyzer = new AudioSpectrumAnalyzer();
        const disposeSpy = vi.spyOn(analyzer.texture, 'dispose');

        analyzer.dispose();
        expect(disposeSpy).toHaveBeenCalledOnce();
    });
});

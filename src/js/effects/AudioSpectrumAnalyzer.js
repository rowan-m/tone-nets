import * as THREE from 'three';

/**
 * Reusable audio spectrum helper for logarithmic equalizer bars and frequency band energy.
 */
export class AudioSpectrumAnalyzer {
    constructor({
        barCount = 32,
        minFreq = 120,
        maxFreq = 16000,
        sampleRate = 44100,
    } = {}) {
        this.barCount = barCount;
        this.minFreq = minFreq;
        this.maxFreq = maxFreq;
        this.sampleRate = sampleRate;

        this.freqData = new Uint8Array(barCount);
        this.texture = new THREE.DataTexture(
            this.freqData,
            barCount,
            1,
            THREE.RedFormat,
        );
        this.texture.minFilter = THREE.NearestFilter;
        this.texture.magFilter = THREE.NearestFilter;
    }

    updateEqualizer(frequencyData) {
        if (!frequencyData) return;

        const binCount = frequencyData.length;
        const { barCount, minFreq, maxFreq, sampleRate } = this;
        const freqToBin = (freq) =>
            Math.floor((freq * binCount * 2) / sampleRate);

        for (let i = 0; i < barCount; i++) {
            const fStart = minFreq * Math.pow(maxFreq / minFreq, i / barCount);
            const fEnd =
                minFreq * Math.pow(maxFreq / minFreq, (i + 1) / barCount);

            const binStart = freqToBin(fStart);
            const binEnd = Math.max(binStart + 1, freqToBin(fEnd));

            let maxVal = 0;
            for (let j = binStart; j < binEnd; j++) {
                if (j < binCount) {
                    maxVal = Math.max(maxVal, frequencyData[j]);
                }
            }

            const tiltFactor = 1.0 + (i / (barCount - 1)) * 2.5;
            const adjustedVal = Math.max(0, maxVal - 5) * tiltFactor;
            const targetValue = Math.min(255, adjustedVal * 0.6);
            const currentVal = this.freqData[i];

            if (targetValue > currentVal) {
                this.freqData[i] = targetValue * 0.4 + currentVal * 0.6;
            } else {
                this.freqData[i] = currentVal * 0.94;
            }
        }

        this.texture.needsUpdate = true;
    }

    static getBandEnergy(frequencyData, startFraction = 0, endFraction = 1) {
        if (!frequencyData || frequencyData.length === 0) return 0;

        const startBin = Math.floor(frequencyData.length * startFraction);
        const endBin = Math.max(
            startBin + 1,
            Math.floor(frequencyData.length * endFraction),
        );
        let sum = 0;
        let count = 0;
        for (let i = startBin; i < endBin && i < frequencyData.length; i++) {
            sum += frequencyData[i] / 255.0;
            count++;
        }
        return count > 0 ? sum / count : 0;
    }

    dispose() {
        if (this.texture) {
            this.texture.dispose();
        }
    }
}

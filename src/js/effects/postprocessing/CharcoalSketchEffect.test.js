import { describe, it, expect } from 'vitest';
import { CharcoalSketchEffect } from './CharcoalSketchEffect.js';

describe('CharcoalSketchEffect', () => {
    it('initializes uniforms and updates portal rotation, center, size, tilt, and resolution on update()', () => {
        const effect = new CharcoalSketchEffect();

        expect(effect.name).toBe('CharcoalSketchEffect');
        expect(effect.uniforms.get('uTime').value).toBe(0);
        expect(effect.uniforms.get('uFPS').value).toBe(5.0);

        effect.update(null, { width: 1920, height: 1080 }, 1.0);

        expect(effect.uniforms.get('uTime').value).toBeCloseTo(1.0);
        expect(effect.uniforms.get('uPaneAngle').value).toBeCloseTo(0.25);
        expect(effect.uniforms.get('uResolution').value.x).toBe(1920);
        expect(effect.uniforms.get('uResolution').value.y).toBe(1080);
    });

    it('updates audio-reactive jitter at 5fps stop-motion frame boundaries via updateAudio()', () => {
        const effect = new CharcoalSketchEffect();
        const highBass = new Uint8Array(100).fill(255);

        // At uTime = 0 (frame 0), updateAudio should update uJitterStrength
        effect.updateAudio(highBass);
        expect(effect.uniforms.get('uJitterStrength').value).toBeCloseTo(
            0.0028 + 0.0055,
        );

        // Within the same 5fps frame (uTime = 0.05 -> floor(0.25) === 0), jitter stays locked
        effect.update(null, null, 0.05);
        effect.updateAudio(new Uint8Array(100).fill(0));
        expect(effect.uniforms.get('uJitterStrength').value).toBeCloseTo(
            0.0028 + 0.0055,
        );

        // Advance to next 5fps frame (uTime = 0.25 -> floor(1.25) === 1), jitter updates to base (0.0028)
        effect.update(null, null, 0.2);
        effect.updateAudio(null);
        expect(effect.uniforms.get('uJitterStrength').value).toBeCloseTo(
            0.0028,
        );
    });
});

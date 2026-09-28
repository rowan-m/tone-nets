import { describe, it, expect } from 'vitest';
import { RetroCRTEffect } from './RetroCRTEffect.js';

describe('RetroCRTEffect', () => {
    it('initializes with uTime and uDistortion uniforms and increments uTime on update', () => {
        const effect = new RetroCRTEffect();

        expect(effect.name).toBe('RetroCRTEffect');
        expect(effect.uniforms.get('uTime').value).toBe(0);
        expect(effect.uniforms.get('uDistortion').value).toBeCloseTo(0.12);

        effect.update(null, null, 0.5);
        expect(effect.uniforms.get('uTime').value).toBeCloseTo(0.5);
    });
});

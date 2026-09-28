import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CameraWrappedParticleField } from './CameraWrappedParticleField.js';

describe('CameraWrappedParticleField', () => {
    it('creates a Points mesh with normalized positions and generated colors', () => {
        const field = new CameraWrappedParticleField({
            count: 50,
            size: 6,
            opacity: 0.5,
            colorGenerator: (i, targetColor) =>
                targetColor.setRGB(0.5, 0.2, 0.1),
        });

        expect(field.points).toBeInstanceOf(THREE.Points);
        const posAttr = field.points.geometry.getAttribute('position');
        const colAttr = field.points.geometry.getAttribute('color');
        expect(posAttr.count).toBe(50);
        expect(colAttr.count).toBe(50);
        expect(colAttr.getX(0)).toBeCloseTo(0.5);
        expect(field.points.material.size).toBe(6);
        expect(field.points.material.opacity).toBeCloseTo(0.5);
    });

    it('injects default camera-wrapping vertex and radial alpha fragment shader in onBeforeCompile', () => {
        const field = new CameraWrappedParticleField({ count: 10 });
        const mockShader = {
            uniforms: {},
            vertexShader: '#include <begin_vertex>',
            fragmentShader: '#include <premultiplied_alpha_fragment>',
        };

        field.points.material.onBeforeCompile(mockShader);

        expect(field.shader).toBe(mockShader);
        expect(mockShader.uniforms.uTime).toBeDefined();
        expect(mockShader.uniforms.uSpread).toBeDefined();
        expect(mockShader.vertexShader).toContain('uTime');
        expect(mockShader.vertexShader).toContain('uSpread');
        expect(mockShader.vertexShader).not.toContain(
            '#include <begin_vertex>',
        );
        expect(mockShader.fragmentShader).toContain('radialAlpha');
    });

    it('supports custom vertex and fragment shader injections (e.g., twinkling stars)', () => {
        const field = new CameraWrappedParticleField({
            count: 10,
            vertexPreamble: 'varying float vTwinkle;',
            vertexTransform:
                'vec3 transformed = position * uSpread; vTwinkle = 1.0;',
            fragmentPreamble: 'varying float vTwinkle;',
            fragmentAlpha: 'gl_FragColor.a *= vTwinkle;',
        });
        const mockShader = {
            uniforms: {},
            vertexShader: '#include <begin_vertex>',
            fragmentShader: '#include <premultiplied_alpha_fragment>',
        };

        field.points.material.onBeforeCompile(mockShader);

        expect(mockShader.vertexShader).toContain('varying float vTwinkle;');
        expect(mockShader.vertexShader).toContain('vTwinkle = 1.0;');
        expect(mockShader.fragmentShader).toContain('varying float vTwinkle;');
        expect(mockShader.fragmentShader).toContain(
            'gl_FragColor.a *= vTwinkle;',
        );
    });

    it('updates uTime and uSpread when shader is compiled', () => {
        const field = new CameraWrappedParticleField({ count: 10 });

        // Safe no-op before onBeforeCompile runs
        expect(() => field.update(0.1, 2000)).not.toThrow();

        const mockShader = {
            uniforms: {},
            vertexShader: '#include <begin_vertex>',
            fragmentShader: '#include <premultiplied_alpha_fragment>',
        };
        field.points.material.onBeforeCompile(mockShader);

        field.update(0.3, 2500);
        expect(mockShader.uniforms.uTime.value).toBeCloseTo(0.3);
        expect(mockShader.uniforms.uSpread.value).toBe(2500);
    });

    it('disposes geometry and material on dispose()', () => {
        const field = new CameraWrappedParticleField({ count: 10 });
        const geoDispose = vi.spyOn(field.points.geometry, 'dispose');
        const matDispose = vi.spyOn(field.points.material, 'dispose');

        field.dispose();

        expect(geoDispose).toHaveBeenCalledOnce();
        expect(matDispose).toHaveBeenCalledOnce();
    });
});

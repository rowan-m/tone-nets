import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { FullscreenShaderQuad } from './FullscreenShaderQuad.js';

describe('FullscreenShaderQuad', () => {
    it('creates a clip-space 2x2 plane mesh with default vertex shader and uTime uniform', () => {
        const fragmentShader =
            'void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }';
        const quad = new FullscreenShaderQuad({ fragmentShader });

        expect(quad.mesh).toBeInstanceOf(THREE.Mesh);
        expect(quad.mesh.frustumCulled).toBe(false);
        expect(quad.mesh.renderOrder).toBe(-1000);
        expect(quad.mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
        expect(quad.mesh.material.depthWrite).toBe(false);
        expect(quad.mesh.material.depthTest).toBe(false);
        expect(quad.uniforms.uTime.value).toBe(0);
        expect(quad.mesh.material.fragmentShader).toBe(fragmentShader);
        expect(quad.mesh.material.vertexShader).toContain('gl_Position');
    });

    it('merges custom uniforms and options', () => {
        const customUniform = { value: 42 };
        const customVertex =
            'void main() { gl_Position = vec4(position, 1.0); }';
        const quad = new FullscreenShaderQuad({
            fragmentShader: 'void main() {}',
            vertexShader: customVertex,
            uniforms: { uCustom: customUniform },
            transparent: true,
            renderOrder: -500,
        });

        expect(quad.uniforms.uCustom).toBe(customUniform);
        expect(quad.uniforms.uTime).toBeDefined();
        expect(quad.mesh.material.transparent).toBe(true);
        expect(quad.mesh.renderOrder).toBe(-500);
        expect(quad.mesh.material.vertexShader).toBe(customVertex);
    });

    it('increments uTime on updateTime(delta)', () => {
        const quad = new FullscreenShaderQuad({
            fragmentShader: 'void main() {}',
        });

        quad.updateTime(0.25);
        expect(quad.uniforms.uTime.value).toBeCloseTo(0.25);

        quad.updateTime(0.5);
        expect(quad.uniforms.uTime.value).toBeCloseTo(0.75);
    });

    it('disposes geometry and material on dispose()', () => {
        const quad = new FullscreenShaderQuad({
            fragmentShader: 'void main() {}',
        });
        const geoDispose = vi.spyOn(quad.mesh.geometry, 'dispose');
        const matDispose = vi.spyOn(quad.mesh.material, 'dispose');

        quad.dispose();

        expect(geoDispose).toHaveBeenCalledOnce();
        expect(matDispose).toHaveBeenCalledOnce();
    });
});

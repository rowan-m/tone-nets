import * as THREE from 'three';

const DEFAULT_VERTEX_SHADER = `
varying vec2 vUv;
varying vec2 vScreenPos;
void main() {
    vUv = uv;
    vScreenPos = position.xy;
    gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

/**
 * Reusable clip-space fullscreen shader quad for theme backgrounds.
 */
export class FullscreenShaderQuad {
    constructor({
        fragmentShader,
        vertexShader = DEFAULT_VERTEX_SHADER,
        uniforms = {},
        transparent = false,
        renderOrder = -1000,
    }) {
        this.uniforms = {
            uTime: { value: 0 },
            ...uniforms,
        };

        const geometry = new THREE.PlaneGeometry(2, 2);
        const material = new THREE.ShaderMaterial({
            depthWrite: false,
            depthTest: false,
            transparent,
            uniforms: this.uniforms,
            vertexShader,
            fragmentShader,
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = renderOrder;
    }

    updateTime(delta) {
        this.uniforms.uTime.value += delta;
    }

    dispose() {
        if (this.mesh.geometry) {
            this.mesh.geometry.dispose();
        }
        if (this.mesh.material) {
            this.mesh.material.dispose();
        }
    }
}

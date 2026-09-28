import * as THREE from 'three';
import { FullscreenShaderQuad } from '../effects/FullscreenShaderQuad.js';
import { AudioSpectrumAnalyzer } from '../effects/AudioSpectrumAnalyzer.js';
import { CharcoalSketchEffect } from '../effects/postprocessing/CharcoalSketchEffect.js';

const STUDIO_PAPER_FRAGMENT_SHADER = `
uniform float uTime;
uniform vec3 uNeonGlow;
varying vec2 vScreenPos;

float hash_smudge(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise_smudge(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash_smudge(i + vec2(0.0, 0.0)), hash_smudge(i + vec2(1.0, 0.0)), u.x),
        mix(hash_smudge(i + vec2(0.0, 1.0)), hash_smudge(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
        v += a * noise_smudge(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    float smudge = fbm(vScreenPos * 1.5 + vec2(1.2, 3.4));
    float dist = length(vScreenPos);
    float vignette = smoothstep(0.0, 1.8, dist + (smudge - 0.5) * 0.45);
    
    vec3 centerColor = vec3(0.956, 0.968, 0.964);
    vec3 edgeColor = vec3(0.815, 0.847, 0.858);
    vec3 paperColor = mix(centerColor, edgeColor, vignette);
    
    vec3 glowedColor = mix(paperColor, uNeonGlow, vignette * 0.55);
    
    float grain = hash_smudge(vScreenPos * 400.0);
    vec3 finalColor = glowedColor * (0.975 + 0.05 * grain);
    
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

export const TakeOnMeRealTheme = {
    name: 'take-on-me-real',
    highlightColor: 0xff3388, // Vivid Neon Hot Pink (fluorescent)
    nodeMaterial: {
        roughness: 0.1,
        metalness: 0.05,
        emissiveIntensity: 0.45,
    },
    edges: {
        renderMode: 'tubes',
        tubeRadius: 0.4,
        palette: {
            low: 0xd0e8eb,
            high: 0x5cb3b1,
        },
        highlight: {
            useWeightColor: false,
            intensityMultiplier: 1.0,
        },
    },
    postProcessing: {
        hdrBuffer: false,
        bloom: {
            intensity: 1.0,
            threshold: 0.9,
        },
        createEffects: () => [new CharcoalSketchEffect()],
    },
    showOutlines: true,
    edgeTubeRadius: 0.4,
    background: 0xf4f7f6,
    emoji: '📼',
    getNodeColor: (pitchClass) => {
        const pastels = [
            { hue: 340 / 360, saturation: 0.7, lightness: 0.75 }, // Pastel Pink
            { hue: 180 / 360, saturation: 0.65, lightness: 0.7 }, // Soft Turquoise
            { hue: 270 / 360, saturation: 0.65, lightness: 0.75 }, // Pastel Lavender
            { hue: 25 / 360, saturation: 0.75, lightness: 0.75 }, // Pastel Peach
            { hue: 55 / 360, saturation: 0.7, lightness: 0.78 }, // Lemon Yellow
            { hue: 140 / 360, saturation: 0.6, lightness: 0.75 }, // Soft Mint Green
            { hue: 205 / 360, saturation: 0.7, lightness: 0.75 }, // Powder Blue
            { hue: 310 / 360, saturation: 0.7, lightness: 0.75 }, // Soft Orchid/Magenta
        ];
        return pastels[pitchClass % pastels.length];
    },
    createBackground: ({ camera } = {}) => {
        const group = new THREE.Group();
        const quad = new FullscreenShaderQuad({
            fragmentShader: STUDIO_PAPER_FRAGMENT_SHADER,
            uniforms: {
                uNeonGlow: { value: new THREE.Color(0, 0, 0) },
            },
        });
        group.add(quad.mesh);

        const grid = new THREE.GridHelper(
            16000,
            64,
            new THREE.Color(0x7c8a8c),
            new THREE.Color(0xc2cbcc),
        );
        grid.position.set(0, -250, 0);
        grid.material.transparent = true;
        grid.material.opacity = 0.22;
        grid.renderOrder = -900;
        group.add(grid);

        const scratchVec3 = new THREE.Vector3();
        const scratchQuat1 = new THREE.Quaternion();
        const scratchQuat2 = new THREE.Quaternion();
        const scratchColor = new THREE.Color();

        return {
            group,
            quad,
            grid,
            onGraphBoundsChange(center, radius = 250) {
                group.position.copy(center);
                const yOffset = Math.min(-250, -radius * 1.1);
                grid.position.set(0, yOffset, 0);
            },
            update(delta, frequencyData = null) {
                if (camera && camera.position) {
                    const zoom = camera.zoom || 1.0;
                    const viewHeight = (camera.top - camera.bottom) / zoom;

                    scratchVec3.x = camera.position.x - group.position.x;
                    scratchVec3.z = camera.position.z - group.position.z;
                    scratchVec3.y =
                        camera.position.y -
                        group.position.y -
                        viewHeight * 0.15;

                    grid.position.copy(scratchVec3);

                    if (camera.quaternion) {
                        scratchQuat1
                            .set(0, 0, 0, 1)
                            .slerp(camera.quaternion, 0.88);
                        scratchQuat2.setFromAxisAngle(
                            scratchVec3.set(1, 0, 0),
                            0.4,
                        );
                        grid.quaternion
                            .copy(scratchQuat1)
                            .multiply(scratchQuat2);
                    }
                }

                quad.updateTime(delta);
                const time = quad.uniforms.uTime.value;
                const trebleEnergy = AudioSpectrumAnalyzer.getBandEnergy(
                    frequencyData,
                    0.5,
                    1.0,
                );
                const hue = (time * 0.035) % 1.0;
                const glowIntensity = 0.18 + trebleEnergy * 0.82;
                const targetGlow = scratchColor
                    .setHSL(hue, 0.92, 0.65)
                    .multiplyScalar(glowIntensity);

                quad.uniforms.uNeonGlow.value.lerp(targetGlow, 0.12);
            },
            dispose() {
                quad.dispose();
                if (grid.geometry) grid.geometry.dispose();
                if (grid.material) grid.material.dispose();
            },
        };
    },
};

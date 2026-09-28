import * as THREE from 'three';
import { FullscreenShaderQuad } from '../effects/FullscreenShaderQuad.js';
import { AudioSpectrumAnalyzer } from '../effects/AudioSpectrumAnalyzer.js';
import { RetroCRTEffect } from '../effects/postprocessing/RetroCRTEffect.js';

const RETRO_EQUALIZER_FRAGMENT_SHADER = `
uniform sampler2D uFreqTexture;
varying vec2 vUv;

void main() {
    float barCount = 32.0;
    float x = vUv.x * barCount;
    float barIdx = floor(x);
    float xInBar = fract(x);
    
    float barMask = step(0.1, xInBar) * step(xInBar, 0.9);
    float freq = texture2D(uFreqTexture, vec2((barIdx + 0.5) / barCount, 0.5)).r;
    float distFromCenter = abs(vUv.y - 0.5);
    float heightMask = step(distFromCenter, freq * 0.25);
    float scanline = sin(vUv.y * 200.0) * 0.1 + 0.9;
    
    float gradient = pow(smoothstep(0.0, freq * 0.25, distFromCenter), 1.5);
    vec3 baseColor = vec3(0.0, 0.2, 0.05);
    vec3 tipColor = vec3(0.0, 0.8, 0.2);
    vec3 color = mix(baseColor, tipColor, gradient);
    
    float alpha = barMask * heightMask * 0.12 * scanline;
    gl_FragColor = vec4(color, alpha);
}
`;

export const RetroTheme = {
    name: 'retro',
    highlightColor: 0x00ff44, // Terminal Green
    emojiTint: '#00ff44',
    nodeMaterial: {
        roughness: 1.0,
        metalness: 0.0,
        emissiveIntensity: 0.5,
        wireframe: true,
    },
    background: 0x000500, // Very dark green
    emoji: '📟',
    showOutlines: false,
    maxResolution: { width: 640, height: 480 },
    geometrySegments: 6,
    postProcessing: {
        hdrBuffer: false,
        bloom: {
            intensity: 3.0,
            threshold: 0.15,
        },
        createEffects: () => [new RetroCRTEffect()],
    },
    getNodeColor: (pitchClass) => {
        const hue = 120 / 360; // Green
        const saturation = 0.8;
        const lightness = 0.3 + (pitchClass / 12) * 0.4;
        return { hue, saturation, lightness };
    },
    createBackground: () => {
        const group = new THREE.Group();
        const analyzer = new AudioSpectrumAnalyzer({ barCount: 32 });
        const quad = new FullscreenShaderQuad({
            fragmentShader: RETRO_EQUALIZER_FRAGMENT_SHADER,
            uniforms: {
                uFreqTexture: { value: analyzer.texture },
            },
            transparent: true,
        });
        group.add(quad.mesh);

        return {
            group,
            analyzer,
            quad,
            update(delta, frequencyData) {
                analyzer.updateEqualizer(frequencyData);
            },
            dispose() {
                quad.dispose();
                analyzer.dispose();
            },
        };
    },
};

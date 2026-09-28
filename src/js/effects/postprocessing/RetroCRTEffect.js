import * as THREE from 'three';
import { Effect } from 'postprocessing';

const retroCRTFragmentShader = `
uniform float uTime;
uniform float uDistortion;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // Barrel Distortion
    vec2 centeredUv = uv - 0.5;
    float dist = dot(centeredUv, centeredUv);
    vec2 distortedUv = uv + centeredUv * dist * uDistortion;
    
    // Check bounds
    if (distortedUv.x < 0.0 || distortedUv.x > 1.0 || distortedUv.y < 0.0 || distortedUv.y > 1.0) {
        outputColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    
    // Chromatic Aberration (RGB Shift)
    float shift = 0.0015 * (1.0 + dist * 2.0);
    vec4 col;
    col.r = texture2D(inputBuffer, distortedUv + vec2(shift, 0.0)).r;
    col.g = texture2D(inputBuffer, distortedUv).g;
    col.b = texture2D(inputBuffer, distortedUv - vec2(shift, 0.0)).b;
    col.a = 1.0;
    
    // Subtle Scanlines
    float scanline = sin(distortedUv.y * 800.0) * 0.005;
    col.rgb -= scanline;
    
    // Static Noise
    float noise = (fract(sin(dot(distortedUv + uTime * 0.01, vec2(12.9898,78.233))) * 43758.5453) - 0.5) * 0.015;
    col.rgb += noise;
    
    // Vignette
    float vignette = 1.0 - dist * 0.6;
    col.rgb *= vignette;
    
    outputColor = col;
}
`;

export class RetroCRTEffect extends Effect {
    constructor() {
        super('RetroCRTEffect', retroCRTFragmentShader, {
            uniforms: new Map([
                ['uTime', new THREE.Uniform(0)],
                ['uDistortion', new THREE.Uniform(0.12)],
            ]),
        });
        this.name = 'RetroCRTEffect';
    }

    update(renderer, inputBuffer, deltaTime) {
        this.uniforms.get('uTime').value += deltaTime;
    }
}

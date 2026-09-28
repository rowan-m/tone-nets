import * as THREE from 'three';
import { FullscreenShaderQuad } from '../effects/FullscreenShaderQuad.js';
import { CameraWrappedParticleField } from '../effects/CameraWrappedParticleField.js';

const TERMINATOR_FIRE_FRAGMENT_SHADER = `
uniform float uTime;
varying vec2 vUv;

float random_fire(in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float noise_fire(in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random_fire(i);
    float b = random_fire(i + vec2(1.0, 0.0));
    float c = random_fire(i + vec2(0.0, 1.0));
    float d = random_fire(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
    vec2 st = vUv * vec2(4.0, 2.0);
    st.y -= uTime * 0.15;
    st.x += sin(uTime * 0.2 + vUv.y * 4.0) * 0.2 + cos(uTime * 0.3 - vUv.y * 8.0) * 0.1;

    float n = noise_fire(st * 2.0) * 0.5 
            + noise_fire(st * 5.0 - vec2(uTime * 0.05, 0.0)) * 0.25
            + noise_fire(st * 10.0 + vec2(0.0, uTime * 0.1)) * 0.125;

    float grad = smoothstep(1.0, 0.1, vUv.y);
    float intensity = n * grad * 2.0;

    vec3 dark = vec3(0.01, 0.0, 0.0);
    vec3 red = vec3(0.3, 0.02, 0.0);
    vec3 orange = vec3(0.6, 0.15, 0.0);

    vec3 fireColor = mix(dark, red, smoothstep(0.1, 0.4, intensity));
    fireColor = mix(fireColor, orange, smoothstep(0.6, 0.9, intensity));

    gl_FragColor = vec4(fireColor, 1.0);
}
`;

export function terminatorNodeShader(shader) {
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `
        #include <common>
        uniform float uTime;
        
        float random_fire(in vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }

        float noise_fire(in vec2 st) {
            vec2 i = floor(st);
            vec2 f = fract(st);
            float a = random_fire(i);
            float b = random_fire(i + vec2(1.0, 0.0));
            float c = random_fire(i + vec2(0.0, 1.0));
            float d = random_fire(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }
        `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `
        #include <emissivemap_fragment>
        
        float isHighlighted = 0.0;
        #ifdef USE_COLOR
            totalEmissiveRadiance *= vColor.rgb;
            isHighlighted = step(2.0, length(vColor.rgb));
        #endif

        vec3 viewIncident = -normalize(vViewPosition);
        vec3 ref = reflect(viewIncident, normal);

        float u = atan(ref.z, ref.x) / (2.0 * PI) + 0.5;
        float v = ref.y * 0.5 + 0.5;
        vec2 refUv = vec2(u, v);

        vec2 st = refUv * vec2(4.0, 2.0);
        st.y -= uTime * 1.2;
        st.x += sin(uTime * 0.8 + refUv.y * 4.0) * 0.2 + cos(uTime * 1.5 - refUv.y * 8.0) * 0.1;

        float n = noise_fire(st * 2.0) * 0.5 
                + noise_fire(st * 5.0 - vec2(uTime * 0.3, 0.0)) * 0.25
                + noise_fire(st * 10.0 + vec2(0.0, uTime * 0.6)) * 0.125;

        float grad = smoothstep(1.0, 0.1, refUv.y);
        float intensity = n * grad * 2.5;

        vec3 dark = vec3(0.02, 0.02, 0.02);
        vec3 red = vec3(0.8, 0.1, 0.0);
        vec3 orange = vec3(1.0, 0.5, 0.0);
        vec3 gold = vec3(1.0, 0.85, 0.2);

        vec3 fireColor = mix(dark, red, smoothstep(0.1, 0.5, intensity));
        fireColor = mix(fireColor, orange, smoothstep(0.4, 0.8, intensity));
        fireColor = mix(fireColor, gold, smoothstep(0.7, 0.95, intensity));

        fireColor = mix(fireColor * 1.5, vec3(0.0), isHighlighted * 0.8);
        totalEmissiveRadiance += fireColor;
        
        #ifdef USE_COLOR
            totalEmissiveRadiance += vColor.rgb * isHighlighted * 0.5;
        #endif
        `,
    );
}

export const TerminatorTheme = {
    name: 'terminator',
    highlightColor: 0x00aaff, // Electric Blue
    nodeMaterial: {
        roughness: 0.05,
        metalness: 1.0,
        emissiveIntensity: 0.25,
        envMapIntensity: 1.5,
    },
    background: 0x110000, // Deep Red background base
    emoji: '💀',
    getNodeColor: (pitchClass) => {
        const hue = pitchClass / 12;
        const saturation = 0.1;
        const lightness = 0.8;
        return { hue, saturation, lightness };
    },
    nodeShader: terminatorNodeShader,
    createBackground: ({ camera } = {}) => {
        const group = new THREE.Group();
        const quad = new FullscreenShaderQuad({
            fragmentShader: TERMINATOR_FIRE_FRAGMENT_SHADER,
        });
        group.add(quad.mesh);

        const colorDarkRed = new THREE.Color(0x880000);
        const colorRed = new THREE.Color(0xff2200);
        const colorOrange = new THREE.Color(0xff8800);

        const embers = new CameraWrappedParticleField({
            count: 800,
            size: 6,
            opacity: 0.5,
            colorGenerator: (i, targetColor) => {
                const r = Math.random();
                if (r < 0.5) {
                    targetColor.copy(colorDarkRed).lerp(colorRed, r * 2.0);
                } else {
                    targetColor
                        .copy(colorRed)
                        .lerp(colorOrange, (r - 0.5) * 2.0);
                }
            },
        });
        group.add(embers.points);

        return {
            group,
            quad,
            embers,
            update(delta) {
                quad.updateTime(delta);
                let spread = 2000;
                if (camera && camera.zoom) {
                    const viewHeight =
                        (camera.top - camera.bottom) / camera.zoom;
                    const viewWidth =
                        (camera.right - camera.left) / camera.zoom;
                    spread = Math.max(viewWidth, viewHeight) * 2.0;
                }
                embers.update(delta, spread);
            },
            dispose() {
                quad.dispose();
                embers.dispose();
            },
        };
    },
};

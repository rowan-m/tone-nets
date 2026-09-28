import * as THREE from 'three';
import { CameraWrappedParticleField } from '../effects/CameraWrappedParticleField.js';

const CONSTELLATION_SKY_VERTEX_SHADER = `
varying vec2 vUv;
varying vec2 vScreenPos;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vScreenPos = gl_Position.xy / gl_Position.w;
}
`;

const CONSTELLATION_SKY_FRAGMENT_SHADER = `
uniform float uTime;
varying vec2 vUv;
varying vec2 vScreenPos;

float hash_c(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float random_dither(vec2 uv) {
    return fract(sin(dot(uv.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
    float distFromCenter = length(vScreenPos);
    vec3 bgBlue = vec3(0.002, 0.012, 0.035);
    vec3 bgBlack = vec3(0.0, 0.0, 0.002);
    vec3 bgColor = mix(bgBlack, bgBlue, smoothstep(0.0, 1.2, distFromCenter));

    vec2 st = vUv * vec2(1200.0, 600.0);
    vec2 ipos = floor(st);
    vec2 fpos = fract(st);

    float r = hash_c(ipos);
    float starValue = 0.0;

    if (r > 0.94) {
        vec2 starCenter = vec2(hash_c(ipos + 1.1), hash_c(ipos + 2.2));
        float dist = length(fpos - starCenter);

        float twinkleSpeed = 0.02 + r * 0.15;
        float twinkle = 0.8 + 0.2 * sin(uTime * twinkleSpeed + r * 100.0);

        float starSize = 0.07 + 0.11 * hash_c(ipos + 3.3);
        starValue = smoothstep(starSize, 0.0, dist) * twinkle;
    }

    vec3 starColor = vec3(1.0, 1.0, 1.0);
    float colorSeed = hash_c(ipos + 4.4);
    if (colorSeed < 0.3) {
        starColor = vec3(0.75, 0.88, 1.0);
    } else if (colorSeed > 0.7) {
        starColor = vec3(1.0, 0.94, 0.83);
    }

    vec3 finalColor = bgColor + starColor * starValue * 0.35;
    float dither = random_dither(gl_FragCoord.xy);
    finalColor += (dither - 0.5) / 255.0;

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

const STAR_PARTICLE_VERTEX_PREAMBLE = `
varying float vTwinkle;
float hash_p(float n) {
    return fract(sin(n) * 43758.5453123);
}
`;

const STAR_PARTICLE_VERTEX_TRANSFORM = `
vec3 scaledPos = position * uSpread;

float particleSeed = position.x + position.y + position.z;
float driftSpeed = 0.01 + 0.01 * hash_p(particleSeed);
scaledPos.x += cos(uTime * driftSpeed + particleSeed * 10.0) * uSpread * 0.005;
scaledPos.y += sin(uTime * driftSpeed + particleSeed * 10.0) * uSpread * 0.005;

vec3 transformed = scaledPos;

float twinkleSpeed = 0.2 + 0.3 * hash_p(particleSeed + 1.0);
vTwinkle = 0.1 + 0.9 * (0.5 + 0.5 * sin(uTime * twinkleSpeed + hash_p(particleSeed) * 6.28));
`;

const STAR_PARTICLE_FRAGMENT_ALPHA = `
float dist = length(gl_PointCoord - vec2(0.5));
if (dist > 0.5) discard;
float radialAlpha = smoothstep(0.5, 0.05, dist);
gl_FragColor = vec4(gl_FragColor.rgb, gl_FragColor.a * radialAlpha * vTwinkle);
`;

export function constellationNodeShader(shader) {
    shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        transformed *= 0.45;
        `,
    );

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
        float viewAlign = max(0.0, dot(normal, normalize(vViewPosition)));
        
        float isHighlighted = 0.0;
        #ifdef USE_COLOR
            totalEmissiveRadiance *= vColor.rgb;
            isHighlighted = step(2.0, length(vColor.rgb));
        #endif

        vec2 st1 = normal.xy * 3.0 + vec2(uTime * 0.15, uTime * -0.1);
        vec2 st2 = normal.xy * 6.0 + vec2(uTime * -0.1, uTime * 0.2);
        vec2 st3 = normal.xy * 12.0 + vec2(uTime * 0.25, uTime * 0.25);
        
        float p1 = noise_fire(st1);
        float p2 = noise_fire(st2);
        float p3 = noise_fire(st3);
        float plasma = p1 * 0.5 + p2 * 0.3 + p3 * 0.2;
        
        float starAlpha = smoothstep(0.0, 0.45, viewAlign);
        
        vec3 starColor = vec3(1.0, 1.0, 1.0);
        #ifdef USE_COLOR
            starColor = normalize(vColor.rgb);
        #endif
        
        vec3 plasmaColor = mix(starColor, vec3(1.0, 1.0, 1.0), plasma * 0.2);
        vec3 hotCore = mix(plasmaColor, vec3(1.0, 1.0, 1.0), pow(viewAlign, 6.0) * 0.4);
        
        float emissiveBoost = 0.95 + isHighlighted * 2.05;
        totalEmissiveRadiance = hotCore * starAlpha * emissiveBoost;
        
        float rimExponent = mix(3.5, 2.0, isHighlighted);
        float rimIntensity = mix(0.4, 2.2, isHighlighted);
        float rim = pow(1.0 - viewAlign, rimExponent);
        vec3 rimColor = starColor * rim * rimIntensity;
        totalEmissiveRadiance += rimColor;
        
        float spikeH = exp(-abs(normal.y) * 45.0) * exp(-abs(normal.x) * 1.5);
        float spikeV = exp(-abs(normal.x) * 45.0) * exp(-abs(normal.y) * 1.5);
        float spike = (spikeH + spikeV) * viewAlign;
        vec3 spikeColor = (starColor + vec3(0.5)) * spike * isHighlighted * 3.5;
        totalEmissiveRadiance += spikeColor;
        
        float finalAlpha = max(starAlpha, rim * (0.95 + isHighlighted * 0.05));
        finalAlpha = max(finalAlpha, spike * isHighlighted * 0.95);
        diffuseColor.a = finalAlpha;
        diffuseColor.rgb = vec3(0.0);
        `,
    );
}

export const ConstellationTheme = {
    name: 'constellation',
    highlightColor: 0xffd700, // Twinkling Gold
    emojiTint: '#58a6ff',
    nodeMaterial: {
        roughness: 0.3,
        metalness: 0.2,
        emissiveIntensity: 1.5,
        transparent: true,
    },
    nodeHighlight: {
        useBaseColor: true,
        intensityMultiplier: 1.5,
        activeEmissiveIntensity: 1.5,
    },
    edges: {
        renderMode: 'lines',
        palette: {
            low: 0x0a1630,
            high: 0x182c50,
        },
        highlight: {
            useWeightColor: true,
            intensityMultiplier: 1.5,
        },
    },
    postProcessing: {
        hdrBuffer: true,
        bloom: {
            intensity: 5.5,
            threshold: 0.15,
        },
    },
    showOutlines: false,
    background: 0x00020a, // Deep midnight blue
    emoji: '🌌',
    getNodeColor: (pitchClass) => {
        const hue = pitchClass / 12;
        const saturation = 0.6;
        const lightness = 0.7;
        return { hue, saturation, lightness };
    },
    nodeShader: constellationNodeShader,
    createBackground: ({ camera } = {}) => {
        const group = new THREE.Group();
        const geo = new THREE.SphereGeometry(2500, 32, 32);
        const mat = new THREE.ShaderMaterial({
            depthWrite: false,
            depthTest: false,
            side: THREE.BackSide,
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: CONSTELLATION_SKY_VERTEX_SHADER,
            fragmentShader: CONSTELLATION_SKY_FRAGMENT_SHADER,
        });

        const sphere = new THREE.Mesh(geo, mat);
        sphere.frustumCulled = false;
        sphere.renderOrder = -1000;
        sphere.position.set(0, 0, 0);
        group.add(sphere);

        const colorWhite = new THREE.Color(0xffffff);
        const colorSoftBlue = new THREE.Color(0xb0e0e6);
        const colorSoftGold = new THREE.Color(0xfff8dc);

        const stars = new CameraWrappedParticleField({
            count: 400,
            size: 4,
            opacity: 0.6,
            colorGenerator: (i, targetColor) => {
                const r = Math.random();
                if (r < 0.4) {
                    targetColor.copy(colorWhite);
                } else if (r < 0.7) {
                    targetColor
                        .copy(colorSoftBlue)
                        .lerp(colorWhite, Math.random() * 0.5);
                } else {
                    targetColor
                        .copy(colorSoftGold)
                        .lerp(colorWhite, Math.random() * 0.5);
                }
            },
            vertexPreamble: STAR_PARTICLE_VERTEX_PREAMBLE,
            vertexTransform: STAR_PARTICLE_VERTEX_TRANSFORM,
            fragmentPreamble: 'varying float vTwinkle;',
            fragmentAlpha: STAR_PARTICLE_FRAGMENT_ALPHA,
        });
        group.add(stars.points);

        const bgController = {
            group,
            sphere,
            stars,
            camera,
            update(
                delta,
                _frequencyData,
                graphCenter = null,
                graphRadius = null,
            ) {
                if (graphCenter) {
                    group.position.copy(graphCenter);
                } else {
                    group.position.set(0, 0, 0);
                }

                const activeCamera = bgController.camera;
                if (activeCamera && activeCamera.position) {
                    sphere.position
                        .copy(activeCamera.position)
                        .sub(group.position);

                    const zoom = activeCamera.zoom || 1.0;
                    const targetScale = Math.min(3.6, 1.0 / zoom);
                    sphere.scale.set(targetScale, targetScale, targetScale);

                    if (activeCamera.quaternion) {
                        sphere.quaternion
                            .set(0, 0, 0, 1)
                            .slerp(activeCamera.quaternion, 0.9);
                    }
                } else {
                    sphere.position.set(0, 0, 0);
                    sphere.scale.set(1.0, 1.0, 1.0);
                    sphere.quaternion.set(0, 0, 0, 1);
                }

                sphere.material.uniforms.uTime.value += delta;

                const radiusValue =
                    graphRadius !== null && !isNaN(graphRadius)
                        ? graphRadius
                        : 1000.0;
                const spreadValue = Math.max(3000.0, radiusValue * 3.0);
                stars.update(delta, spreadValue);
            },
            dispose() {
                geo.dispose();
                mat.dispose();
                stars.dispose();
            },
        };

        return bgController;
    },
};

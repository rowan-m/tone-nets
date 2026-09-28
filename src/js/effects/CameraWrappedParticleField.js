import * as THREE from 'three';

const DEFAULT_VERTEX_TRANSFORM = `
    vec3 scaledPos = position * uSpread;
    scaledPos.y += uTime * uSpread * 0.03;
    scaledPos.x += sin(uTime * 0.5 + position.z * 10.0) * uSpread * 0.02;
    vec3 offset = scaledPos - cameraPosition;
    vec3 transformed = mod(offset + uSpread * 0.5, uSpread) - uSpread * 0.5;
    transformed += cameraPosition;
`;

const DEFAULT_FRAGMENT_ALPHA = `
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float radialAlpha = smoothstep(0.5, 0.1, dist);
    gl_FragColor = vec4(gl_FragColor.rgb, gl_FragColor.a * radialAlpha);
`;

/**
 * Reusable 3D particle field with normalized positions and custom shader hooks.
 */
export class CameraWrappedParticleField {
    constructor({
        count = 400,
        size = 5,
        opacity = 0.5,
        colorGenerator = null,
        vertexPreamble = '',
        vertexTransform = DEFAULT_VERTEX_TRANSFORM,
        fragmentPreamble = '',
        fragmentAlpha = DEFAULT_FRAGMENT_ALPHA,
    } = {}) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const scratchColor = new THREE.Color(1, 1, 1);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = Math.random() - 0.5;
            positions[i * 3 + 1] = Math.random() - 0.5;
            positions[i * 3 + 2] = Math.random() - 0.5;

            if (colorGenerator) {
                colorGenerator(i, scratchColor);
            }

            colors[i * 3] = scratchColor.r;
            colors[i * 3 + 1] = scratchColor.g;
            colors[i * 3 + 2] = scratchColor.b;
        }

        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3),
        );
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size,
            vertexColors: true,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.shader = null;

        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uSpread = { value: 1000 };
            this.shader = shader;

            shader.vertexShader =
                `
                uniform float uTime;
                uniform float uSpread;
                ${vertexPreamble}
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                vertexTransform,
            );

            if (fragmentPreamble) {
                shader.fragmentShader =
                    `${fragmentPreamble}\n` + shader.fragmentShader;
            }

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <premultiplied_alpha_fragment>',
                `
                #include <premultiplied_alpha_fragment>
                ${fragmentAlpha}
                `,
            );
        };

        this.points = new THREE.Points(geometry, material);
    }

    update(delta, spread) {
        if (this.shader) {
            this.shader.uniforms.uTime.value += delta;
            if (spread !== undefined) {
                this.shader.uniforms.uSpread.value = spread;
            }
        }
    }

    dispose() {
        if (this.points.geometry) {
            this.points.geometry.dispose();
        }
        if (this.points.material) {
            this.points.material.dispose();
        }
    }
}

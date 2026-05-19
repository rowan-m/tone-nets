import * as THREE from 'three';

/**
 * Manages visual feedback like highlights and floating emojis.
 * Separated from NetworkVisualizer to follow SRP.
 */
export class VisualEffectsManager {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        this.activeEmojis = [];
        this.emojiPool = [];
        this.emojiTextureCache = new Map();
        this.maxEmojis = 100;

        this._cameraUp = new THREE.Vector3();

        this.terminatorGroup = new THREE.Group();
        this.terminatorGroup.visible = false;
        this.scene.add(this.terminatorGroup);
        this._initTerminatorBackground();
    }

    _initTerminatorBackground() {
        // Create a fullscreen quad for the "flame" background so it's always centered and never clips
        const geo = new THREE.PlaneGeometry(2, 2);
        const mat = new THREE.ShaderMaterial({
            depthWrite: false,
            depthTest: false,
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    // Render as a fullscreen quad behind everything
                    gl_Position = vec4(position.xy, 1.0, 1.0);
                }
            `,
            fragmentShader: `
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

                    // Flow upwards slowly and sway gently
                    st.y -= uTime * 0.15;
                    st.x += sin(uTime * 0.2 + vUv.y * 4.0) * 0.2 + cos(uTime * 0.3 - vUv.y * 8.0) * 0.1;

                    // Layered noise with slower time-based offset
                    float n = noise_fire(st * 2.0) * 0.5 
                            + noise_fire(st * 5.0 - vec2(uTime * 0.05, 0.0)) * 0.25
                            + noise_fire(st * 10.0 + vec2(0.0, uTime * 0.1)) * 0.125;

                    float grad = smoothstep(1.0, 0.1, vUv.y);
                    float intensity = n * grad * 2.0;

                    // Deep, smoldering background colors
                    vec3 dark = vec3(0.01, 0.0, 0.0);
                    vec3 red = vec3(0.3, 0.02, 0.0);
                    vec3 orange = vec3(0.6, 0.15, 0.0);

                    vec3 fireColor = mix(dark, red, smoothstep(0.1, 0.4, intensity));
                    // Push orange to only the very highest intensity peaks
                    fireColor = mix(fireColor, orange, smoothstep(0.6, 0.9, intensity));

                    gl_FragColor = vec4(fireColor, 1.0);
                }
            `,
        });

        this.terminatorSphere = new THREE.Mesh(geo, mat);
        this.terminatorSphere.frustumCulled = false;
        this.terminatorSphere.renderOrder = -1000;
        this.terminatorGroup.add(this.terminatorSphere);

        // Add floating plasma particles
        const particleCount = 800; // Increased count for dense local field
        const particleGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);

        const colorDarkRed = new THREE.Color(0x880000);
        const colorRed = new THREE.Color(0xff2200);
        const colorOrange = new THREE.Color(0xff8800);
        const scratchColor = new THREE.Color();

        for (let i = 0; i < particleCount; i++) {
            // Spawn particles in a normalized 1x1x1 unit box.
            // The shader will scale them to the camera frustum dynamically.
            positions[i * 3] = Math.random() - 0.5;
            positions[i * 3 + 1] = Math.random() - 0.5;
            positions[i * 3 + 2] = Math.random() - 0.5;

            // Pick a random color from the plasma gradient
            const r = Math.random();
            if (r < 0.5) {
                scratchColor.copy(colorDarkRed).lerp(colorRed, r * 2.0);
            } else {
                scratchColor.copy(colorRed).lerp(colorOrange, (r - 0.5) * 2.0);
            }

            colors[i * 3] = scratchColor.r;
            colors[i * 3 + 1] = scratchColor.g;
            colors[i * 3 + 2] = scratchColor.b;
        }

        particleGeo.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3),
        );
        particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const particleMat = new THREE.PointsMaterial({
            size: 6, // Smaller size
            vertexColors: true,
            transparent: true,
            opacity: 0.5, // More transparent
            blending: THREE.AdditiveBlending,
            depthWrite: false, // Prevents particles from occluding each other weirdly
        });

        // Inject custom fragment shader logic to make the square points round and soft
        // and vertex shader logic to wrap them infinitely around the camera
        particleMat.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uSpread = { value: 1000 };
            this.particleShader = shader;

            shader.vertexShader =
                `
                uniform float uTime;
                uniform float uSpread;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                // Scale normalized positions by the dynamically calculated camera view spread
                vec3 scaledPos = position * uSpread;
                
                // Drift particles slowly upwards and slightly sideways over time
                scaledPos.y += uTime * uSpread * 0.03;
                scaledPos.x += sin(uTime * 0.5 + position.z * 10.0) * uSpread * 0.02;
                
                // Wrap positions infinitely around the camera to guarantee constant density
                vec3 offset = scaledPos - cameraPosition;
                vec3 transformed = mod(offset + uSpread * 0.5, uSpread) - uSpread * 0.5;
                transformed += cameraPosition;
                `,
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <premultiplied_alpha_fragment>',
                `
                #include <premultiplied_alpha_fragment>
                
                // Calculate distance from center of the point sprite
                float dist = length(gl_PointCoord - vec2(0.5));
                
                // Discard pixels outside the circle, and create a soft glowing fade
                if (dist > 0.5) discard;
                float radialAlpha = smoothstep(0.5, 0.1, dist);
                
                gl_FragColor = vec4(gl_FragColor.rgb, gl_FragColor.a * radialAlpha);
                `,
            );
        };

        this.embers = new THREE.Points(particleGeo, particleMat);
        this.terminatorGroup.add(this.embers);
    }

    enableTerminatorBackground(enabled) {
        this.terminatorGroup.visible = enabled;
    }

    update(delta) {
        this._updateEmojis(delta);
        if (this.terminatorGroup.visible) {
            this.terminatorSphere.material.uniforms.uTime.value += delta;

            if (this.particleShader) {
                this.particleShader.uniforms.uTime.value += delta;

                // Calculate the visible spread based on orthographic frustum height/width.
                // We multiply by 2.0 to ensure the wrapping box safely covers the screen corners
                // even when the camera is panned or the window is extremely wide/tall.
                const viewHeight =
                    (this.camera.top - this.camera.bottom) / this.camera.zoom;
                const viewWidth =
                    (this.camera.right - this.camera.left) / this.camera.zoom;
                this.particleShader.uniforms.uSpread.value =
                    Math.max(viewWidth, viewHeight) * 2.0;
            }
        }
    }

    _updateEmojis(delta) {
        this._cameraUp
            .set(0, 1, 0)
            .applyQuaternion(this.camera.quaternion)
            .normalize();

        const lifeStep = delta * 1.25;
        const moveStep = delta * 30;

        for (let i = this.activeEmojis.length - 1; i >= 0; i--) {
            const emojiData = this.activeEmojis[i];
            emojiData.life -= lifeStep;

            if (emojiData.life <= 0) {
                this._recycleEmoji(i);
                continue;
            }

            emojiData.sprite.position.addScaledVector(this._cameraUp, moveStep);
            emojiData.sprite.material.opacity = emojiData.life;
        }
    }

    _recycleEmoji(index) {
        const emojiData = this.activeEmojis[index];
        this.scene.remove(emojiData.sprite);
        this.emojiPool.push(emojiData.sprite);
        this.activeEmojis.splice(index, 1);
    }

    showInstrumentEmoji(position, emoji) {
        if (this.activeEmojis.length >= this.maxEmojis) {
            this._recycleEmoji(0);
        }

        let sprite;
        if (this.emojiPool.length > 0) {
            sprite = this.emojiPool.pop();
            sprite.material.map = this._getEmojiTexture(emoji);
            sprite.material.opacity = 1.0;
        } else {
            sprite = this._createEmojiSprite(emoji);
        }

        sprite.position.copy(position);

        this.scene.add(sprite);
        this.activeEmojis.push({
            sprite: sprite,
            life: 1.0,
        });
    }

    _getEmojiTexture(emoji) {
        let texture = this.emojiTextureCache.get(emoji);

        if (!texture) {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.font = '48px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(emoji, 32, 32);

            texture = new THREE.CanvasTexture(canvas);
            this.emojiTextureCache.set(emoji, texture);
        }
        return texture;
    }

    _createEmojiSprite(emoji) {
        const texture = this._getEmojiTexture(emoji);

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(40, 40, 1);
        return sprite;
    }

    clear() {
        this.activeEmojis.forEach((emojiData) => {
            this.scene.remove(emojiData.sprite);
            if (emojiData.sprite.material) emojiData.sprite.material.dispose();
        });
        this.activeEmojis = [];

        this.emojiPool.forEach((sprite) => {
            if (sprite.material) sprite.material.dispose();
        });
        this.emojiPool = [];
    }
}

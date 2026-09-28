import * as THREE from 'three';
import { ObjectPool } from './ObjectPool.js';
import { Utils } from './Utils.js';

/**
 * Manages visual feedback like highlights and floating emojis.
 * Separated from NetworkVisualizer to follow SRP.
 */
export class VisualEffectsManager {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        this.maxEmojis = 100;
        this.emojiTextureCache = new Map();
        this.retroMode = false;
        this.constellationMode = false;

        this.emojiPool = new ObjectPool(
            (emoji) => this._createEmojiSprite(emoji),
            (item, emoji) => {
                item.sprite.material.map = this._getEmojiTexture(
                    emoji,
                    this.retroMode,
                    this.constellationMode,
                );
                item.sprite.material.opacity = 1.0;
                item.life = 1.0;
            },
            (item) => {
                this.scene.remove(item.sprite);
            },
            this.maxEmojis,
        );

        this._cameraUp = new THREE.Vector3();
        this._scratchVec3_1 = new THREE.Vector3();
        this._scratchQuat_1 = new THREE.Quaternion();
        this._scratchQuat_2 = new THREE.Quaternion();
        this._scratchColor = new THREE.Color();
        this.studioGrid = null;

        this.terminatorGroup = new THREE.Group();
        this.terminatorGroup.visible = false;
        this.scene.add(this.terminatorGroup);
        this._initTerminatorBackground();

        this.retroGroup = new THREE.Group();
        this.retroGroup.visible = false;
        this.scene.add(this.retroGroup);
        this._initRetroBackground();

        this.constellationGroup = new THREE.Group();
        this.constellationGroup.visible = false;
        this.scene.add(this.constellationGroup);
        this._initConstellationBackground();

        this.studioGroup = new THREE.Group();
        this.studioGroup.visible = false;
        this.scene.add(this.studioGroup);
        this._initStudioBackground();

        if (typeof document !== 'undefined' || global.document) {
            const uniqueEmojis = new Set(
                Object.values(Utils.INSTRUMENT_EMOJIS),
            );
            for (const emoji of uniqueEmojis) {
                this._getEmojiTexture(emoji);
            }

            // Pre-allocate pool to avoid jank without breaking encapsulation
            const initialItems = [];
            for (let i = 0; i < 40; i++) {
                initialItems.push(this.emojiPool.acquire('🎹'));
            }
            for (let i = 0; i < 40; i++) {
                this.emojiPool.release(initialItems[i]);
            }
        }
    }

    get activeEmojis() {
        return this.emojiPool.active;
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

    enableRetroBackground(enabled) {
        this.retroGroup.visible = enabled;
    }

    enableConstellationBackground(enabled) {
        this.constellationGroup.visible = enabled;
    }

    enableStudioBackground(enabled) {
        this.studioGroup.visible = enabled;
    }

    updateStudioPosition(center, radius = 250) {
        if (this.studioGroup) {
            this.studioGroup.position.copy(center);
            if (this.studioGrid) {
                // Place the floor grid safely at least 250 units (or 1.1x the graph radius) below the network center
                const yOffset = Math.min(-250, -radius * 1.1);
                this.studioGrid.position.set(0, yOffset, 0);
            }
        }
    }

    setRetroMode(enabled) {
        this.retroMode = enabled;
    }

    setConstellationMode(enabled) {
        this.constellationMode = enabled;
    }

    update(
        delta,
        frequencyData = null,
        graphCenter = null,
        graphRadius = null,
    ) {
        this._updateEmojis(delta);
        this._updateTerminatorBackground(delta);
        this._updateRetroBackground(frequencyData);
        this._updateConstellationBackground(delta, graphCenter, graphRadius);
        this._updateStudioBackground(delta, frequencyData);
    }

    _updateStudioBackground(delta, frequencyData = null) {
        if (!this.studioGroup.visible) return;

        // Position and rotate the 3D floor grid relative to the camera
        // so it stays fixed to the bottom/center of the screen but tilts in 3D perspective!
        if (this.camera && this.studioGrid) {
            const zoom = this.camera.zoom || 1.0;
            // Calculate orthographic viewport height
            const viewHeight = (this.camera.top - this.camera.bottom) / zoom;

            // 1. Center the grid horizontally under the camera
            this._scratchVec3_1.x =
                this.camera.position.x - this.studioGroup.position.x;
            this._scratchVec3_1.z =
                this.camera.position.z - this.studioGroup.position.z;

            // 2. Position the grid vertically higher up (15% of viewport height downward)
            // This raises the apparent horizon line for the grid to sit around the center of the viewport
            this._scratchVec3_1.y =
                this.camera.position.y -
                this.studioGroup.position.y -
                viewHeight * 0.15;

            this.studioGrid.position.copy(this._scratchVec3_1);

            // 3. Slerp track camera rotation (88% slerp) for sluggish parallax,
            // and compose an additional 23-degree (0.4 rad) pitch tilt on the X-axis
            // to slant the floor towards the camera and show much more of the grid
            this._scratchQuat_1
                .set(0, 0, 0, 1)
                .slerp(this.camera.quaternion, 0.88);

            this._scratchQuat_2.setFromAxisAngle(
                this._scratchVec3_1.set(1, 0, 0),
                0.4,
            );

            this.studioGrid.quaternion
                .copy(this._scratchQuat_1)
                .multiply(this._scratchQuat_2);
        }

        // 4. Update the background vignette's time and audio-reactive sunset neon glows (Concept 4)
        if (
            this.studioSphere &&
            this.studioSphere.material &&
            this.studioSphere.material.uniforms.uNeonGlow
        ) {
            const uniforms = this.studioSphere.material.uniforms;
            uniforms.uTime.value += delta;
            const time = uniforms.uTime.value;

            // Calculate treble (high-frequency) energy
            let trebleEnergy = 0;
            if (frequencyData && frequencyData.length > 0) {
                const startBin = Math.floor(frequencyData.length * 0.5);
                let trebleSum = 0;
                for (let i = startBin; i < frequencyData.length; i++) {
                    trebleSum += frequencyData[i] / 255.0;
                }
                trebleEnergy =
                    trebleSum / (frequencyData.length - startBin || 1);
            }

            // Slowly cycle HSL hue over time to create a gentle, rotating sunset light cycle (80s vibe!)
            const hue = (time * 0.035) % 1.0;

            // Set the target neon color (vivid, highly saturated 80s glows)
            // Add a beautiful, noticeable ambient baseline of 0.18 (18% always visible)
            // that pulses dynamically up to 100% based on synthesizer treble energy!
            const glowIntensity = 0.18 + trebleEnergy * 0.82;
            const targetGlow = this._scratchColor
                .setHSL(hue, 0.92, 0.65)
                .multiplyScalar(glowIntensity);

            // Smoothly lerp to avoid abrupt color flickering
            uniforms.uNeonGlow.value.lerp(targetGlow, 0.12);
        }
    }

    _updateConstellationBackground(
        delta,
        graphCenter = null,
        graphRadius = null,
    ) {
        if (!this.constellationGroup.visible) return;

        // Position the main constellation group at the graph center so particle stars behave normally
        if (graphCenter) {
            this.constellationGroup.position.copy(graphCenter);
        } else {
            this.constellationGroup.position.set(0, 0, 0);
        }

        // Position the background sphere at the camera and apply physical scaling with clipping protection
        if (this.camera && this.camera.position) {
            this.constellationSphere.position
                .copy(this.camera.position)
                .sub(this.constellationGroup.position);

            // Physical base radius is 2500. Far clipping plane is 10000.
            // We clamp the scale to 3.6 so the physical radius never exceeds 9000, protecting from clipping.
            const zoom = this.camera.zoom || 1.0;
            const targetScale = Math.min(3.6, 1.0 / zoom);
            this.constellationSphere.scale.set(
                targetScale,
                targetScale,
                targetScale,
            );

            // Apply fractional rotation (slerp) to make stars rotate 10x slower in the viewport (90% tracking)
            if (this.camera.quaternion) {
                this.constellationSphere.quaternion
                    .set(0, 0, 0, 1)
                    .slerp(this.camera.quaternion, 0.9);
            }
        } else {
            this.constellationSphere.position.set(0, 0, 0);
            this.constellationSphere.scale.set(1.0, 1.0, 1.0);
            this.constellationSphere.quaternion.set(0, 0, 0, 1);
        }

        this.constellationSphere.material.uniforms.uTime.value += delta;

        if (this.constellationParticleShader) {
            this.constellationParticleShader.uniforms.uTime.value += delta;

            const radiusValue =
                graphRadius !== null && !isNaN(graphRadius)
                    ? graphRadius
                    : 1000.0;
            const spreadValue = Math.max(3000.0, radiusValue * 3.0);
            this.constellationParticleShader.uniforms.uSpread.value =
                spreadValue;
        }
    }

    _updateTerminatorBackground(delta) {
        if (!this.terminatorGroup.visible) return;

        this.terminatorSphere.material.uniforms.uTime.value += delta;

        if (this.particleShader) {
            this.particleShader.uniforms.uTime.value += delta;

            // Calculate the visible spread based on orthographic frustum height/width.
            const viewHeight =
                (this.camera.top - this.camera.bottom) / this.camera.zoom;
            const viewWidth =
                (this.camera.right - this.camera.left) / this.camera.zoom;
            this.particleShader.uniforms.uSpread.value =
                Math.max(viewWidth, viewHeight) * 2.0;
        }
    }

    _updateRetroBackground(frequencyData) {
        if (!this.retroGroup.visible || !frequencyData) return;

        const binCount = frequencyData.length;
        const barCount = 32;
        // Increase minFreq from 20Hz to ~120Hz to skip the sub-bass range
        // where bins are too close together to create distinct bars.
        const minFreq = 120;
        const maxFreq = 16000;
        const sampleRate = 44100;

        // Helper to convert frequency to FFT bin index
        const freqToBin = (freq) =>
            Math.floor((freq * binCount * 2) / sampleRate);

        for (let i = 0; i < barCount; i++) {
            // Calculate frequency range for this bar using logarithmic spacing
            const fStart = minFreq * Math.pow(maxFreq / minFreq, i / barCount);
            const fEnd =
                minFreq * Math.pow(maxFreq / minFreq, (i + 1) / barCount);

            // Ensure we cover a continuous range of bins with no gaps
            const binStart = freqToBin(fStart);
            const binEnd = Math.max(binStart + 1, freqToBin(fEnd)); // Guarantee at least 1 bin

            let maxVal = 0;
            // Use peak detection (max) instead of average for more responsive bars in small ranges
            for (let j = binStart; j < binEnd; j++) {
                if (j < binCount) {
                    maxVal = Math.max(maxVal, frequencyData[j]);
                }
            }

            // Music energy naturally falls off at higher frequencies (approx -3dB per octave).
            // We apply a "Slope Compensation" (Tilt) to flatten this visually for a more
            // balanced "Full" look across the screen.
            const tiltFactor = 1.0 + (i / (barCount - 1)) * 2.5; // Reduced from 4.0

            // Subtract a small noise floor and apply tilt
            const adjustedVal = Math.max(0, maxVal - 5) * tiltFactor;
            const targetValue = Math.min(255, adjustedVal * 0.6); // Reduced from 0.8

            const currentVal = this.retroFreqData[i];

            // Smooth decay/rise with "liquid" ballistics to reduce flicker
            if (targetValue > currentVal) {
                // Slower "attack" for a more fluid, less jumpy rise (was 0.8)
                this.retroFreqData[i] = targetValue * 0.4 + currentVal * 0.6;
            } else {
                // Slower "decay" for a graceful, high-quality fall (was 0.88)
                this.retroFreqData[i] = currentVal * 0.94;
            }
        }
        this.retroFreqTexture.needsUpdate = true;
    }

    _updateEmojis(delta) {
        this._cameraUp
            .set(0, 1, 0)
            .applyQuaternion(this.camera.quaternion)
            .normalize();

        const lifeStep = delta * 1.25;
        const moveStep = delta * 30;

        for (let i = this.emojiPool.active.length - 1; i >= 0; i--) {
            const emojiData = this.emojiPool.active[i];
            emojiData.life -= lifeStep;

            if (emojiData.life <= 0) {
                this.emojiPool.releaseIndex(i);
                continue;
            }

            emojiData.sprite.position.addScaledVector(this._cameraUp, moveStep);
            emojiData.sprite.material.opacity = emojiData.life;
        }
    }

    showInstrumentEmoji(position, emoji) {
        const item = this.emojiPool.acquire(emoji);
        item.sprite.position.copy(position);
        this.scene.add(item.sprite);
    }

    _initRetroBackground() {
        const geo = new THREE.PlaneGeometry(2, 2);
        this.retroFreqData = new Uint8Array(32);
        this.retroFreqTexture = new THREE.DataTexture(
            this.retroFreqData,
            32,
            1,
            THREE.RedFormat,
        );
        this.retroFreqTexture.minFilter = THREE.NearestFilter;
        this.retroFreqTexture.magFilter = THREE.NearestFilter;

        const mat = new THREE.ShaderMaterial({
            depthWrite: false,
            depthTest: false,
            transparent: true,
            uniforms: {
                uFreqTexture: { value: this.retroFreqTexture },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 1.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uFreqTexture;
                varying vec2 vUv;

                void main() {
                    float barCount = 32.0;
                    float x = vUv.x * barCount;
                    float barIdx = floor(x);
                    float xInBar = fract(x);
                    
                    // Small gap between bars
                    float barMask = step(0.1, xInBar) * step(xInBar, 0.9);
                    
                    // Fetch frequency for this bar
                    float freq = texture2D(uFreqTexture, vec2((barIdx + 0.5) / barCount, 0.5)).r;
                    
                    // Centered vertically
                    float distFromCenter = abs(vUv.y - 0.5);
                    
                    // Height mask (max half-height is 0.25 to make total height 0.5)
                    float heightMask = step(distFromCenter, freq * 0.25);
                    
                    // Subtle scanline effect on the bars
                    float scanline = sin(vUv.y * 200.0) * 0.1 + 0.9;
                    
                    // Vertical gradient: More pronounced, darker base
                    // Use power function to make the transition sharper/more pronounced
                    float gradient = pow(smoothstep(0.0, freq * 0.25, distFromCenter), 1.5);
                    vec3 baseColor = vec3(0.0, 0.2, 0.05); // Much darker muted green
                    vec3 tipColor = vec3(0.0, 0.8, 0.2); // Slightly darker terminal green
                    vec3 color = mix(baseColor, tipColor, gradient);
                    
                    // Slightly lower overall alpha for a more "glowy" but subtle look
                    float alpha = barMask * heightMask * 0.12 * scanline;
                    
                    gl_FragColor = vec4(color, alpha);
                }
            `,
        });

        this.retroEqualizer = new THREE.Mesh(geo, mat);
        this.retroEqualizer.frustumCulled = false;
        this.retroEqualizer.renderOrder = -1000;
        this.retroGroup.add(this.retroEqualizer);
    }

    _initConstellationBackground() {
        const geo = new THREE.SphereGeometry(2500, 32, 32);
        const mat = new THREE.ShaderMaterial({
            depthWrite: false,
            depthTest: false,
            side: THREE.BackSide,
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec2 vScreenPos;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    vScreenPos = gl_Position.xy / gl_Position.w;
                }
            `,
            fragmentShader: `
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
                    // Screen-space radial gradient from center of viewport (black) to edges (dark indigo)
                    float distFromCenter = length(vScreenPos);
                    vec3 bgBlue = vec3(0.002, 0.012, 0.035); // Soothing, dark celestial blue/indigo
                    vec3 bgBlack = vec3(0.0, 0.0, 0.002);
                    vec3 bgColor = mix(bgBlack, bgBlue, smoothstep(0.0, 1.2, distFromCenter));

                    // Background stars scattering using standard UVs for high density wrapping
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
                        starColor = vec3(0.75, 0.88, 1.0); // soft celestial blue
                    } else if (colorSeed > 0.7) {
                        starColor = vec3(1.0, 0.94, 0.83); // soft cosmic gold
                    }

                    vec3 finalColor = bgColor + starColor * starValue * 0.35;
                    
                    // Apply high-frequency sub-perceptual dithering noise to completely dissolve 8-bit color banding
                    float dither = random_dither(gl_FragCoord.xy);
                    finalColor += (dither - 0.5) / 255.0;

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
        });

        this.constellationSphere = new THREE.Mesh(geo, mat);
        this.constellationSphere.frustumCulled = false;
        this.constellationSphere.renderOrder = -1000;
        this.constellationSphere.position.set(0, 0, 0);
        this.constellationGroup.add(this.constellationSphere);

        // Add drifting, twinkling celestial stars particles
        const particleCount = 400;
        const particleGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);

        const colorWhite = new THREE.Color(0xffffff);
        const colorSoftBlue = new THREE.Color(0xb0e0e6); // Powder Blue
        const colorSoftGold = new THREE.Color(0xfff8dc); // Cornsilk / Warm white
        const scratchColor = new THREE.Color();

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = Math.random() - 0.5;
            positions[i * 3 + 1] = Math.random() - 0.5;
            positions[i * 3 + 2] = Math.random() - 0.5;

            const r = Math.random();
            if (r < 0.4) {
                scratchColor.copy(colorWhite);
            } else if (r < 0.7) {
                scratchColor
                    .copy(colorSoftBlue)
                    .lerp(colorWhite, Math.random() * 0.5);
            } else {
                scratchColor
                    .copy(colorSoftGold)
                    .lerp(colorWhite, Math.random() * 0.5);
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
            size: 4,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        particleMat.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uSpread = { value: 1000 };
            this.constellationParticleShader = shader;

            shader.vertexShader =
                `
                uniform float uTime;
                uniform float uSpread;
                varying float vTwinkle;
                
                float hash_p(float n) {
                    return fract(sin(n) * 43758.5453123);
                }
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                vec3 scaledPos = position * uSpread;
                
                float particleSeed = position.x + position.y + position.z;
                float driftSpeed = 0.01 + 0.01 * hash_p(particleSeed);
                scaledPos.x += cos(uTime * driftSpeed + particleSeed * 10.0) * uSpread * 0.005;
                scaledPos.y += sin(uTime * driftSpeed + particleSeed * 10.0) * uSpread * 0.005;
                
                vec3 transformed = scaledPos;
                
                float twinkleSpeed = 0.2 + 0.3 * hash_p(particleSeed + 1.0);
                vTwinkle = 0.1 + 0.9 * (0.5 + 0.5 * sin(uTime * twinkleSpeed + hash_p(particleSeed) * 6.28));
                `,
            );

            shader.fragmentShader =
                `
                varying float vTwinkle;
            ` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <premultiplied_alpha_fragment>',
                `
                #include <premultiplied_alpha_fragment>
                
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                float radialAlpha = smoothstep(0.5, 0.05, dist);
                
                gl_FragColor = vec4(gl_FragColor.rgb, gl_FragColor.a * radialAlpha * vTwinkle);
                `,
            );
        };

        this.constellationStars = new THREE.Points(particleGeo, particleMat);
        this.constellationGroup.add(this.constellationStars);
    }

    _initStudioBackground() {
        // 1. Screen-space 2D plane vignette background with soft, organic charcoal dust smudges
        const planeGeo = new THREE.PlaneGeometry(2, 2);
        const planeMat = new THREE.ShaderMaterial({
            depthWrite: false,
            depthTest: false,
            uniforms: {
                uTime: { value: 0 },
                uNeonGlow: { value: new THREE.Color(0, 0, 0) },
            },
            vertexShader: `
                varying vec2 vScreenPos;
                void main() {
                    gl_Position = vec4(position.xy, 1.0, 1.0);
                    vScreenPos = position.xy;
                }
            `,
            fragmentShader: `
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
                    // Soft, irregular, organic charcoal dust smudges to simulate hand-rubbed graphite shadow clouds
                    float smudge = fbm(vScreenPos * 1.5 + vec2(1.2, 3.4));
                    
                    float dist = length(vScreenPos);
                    // Modulate the vignette boundaries with the smudge noise to warp the shadows into hand-drawn patterns
                    float vignette = smoothstep(0.0, 1.8, dist + (smudge - 0.5) * 0.45);
                    
                    vec3 centerColor = vec3(0.956, 0.968, 0.964); // #f4f7f6
                    vec3 edgeColor = vec3(0.815, 0.847, 0.858);   // #d0d8db
                    vec3 paperColor = mix(centerColor, edgeColor, vignette);
                    
                    // Blend the neon glow into the corners dynamically (increased mix factor for high visibility)
                    vec3 glowedColor = mix(paperColor, uNeonGlow, vignette * 0.55);
                    
                    // Add subtle paper grain tooth
                    float grain = hash_smudge(vScreenPos * 400.0);
                    vec3 finalColor = glowedColor * (0.975 + 0.05 * grain);
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
        });

        this.studioSphere = new THREE.Mesh(planeGeo, planeMat);
        this.studioSphere.frustumCulled = false;
        this.studioSphere.renderOrder = -1000;
        this.studioGroup.add(this.studioSphere);

        // 2. Faint drafted floor grid to anchor the 3D perspective
        const gridSize = 16000;
        const divisions = 64;
        const grid = new THREE.GridHelper(
            gridSize,
            divisions,
            new THREE.Color(0x7c8a8c), // Center axes pencil color
            new THREE.Color(0xc2cbcc), // Grid line pencil color
        );
        grid.position.set(0, -250, 0);
        grid.material.transparent = true;
        grid.material.opacity = 0.22; // Very faint, subtle lines
        grid.renderOrder = -900; // Rendered behind nodes but in front of background
        this.studioGroup.add(grid);
        this.studioGrid = grid;
    }

    _getEmojiTexture(emoji, isRetro = false, isConstellation = false) {
        let cacheKey = emoji;
        if (isRetro) {
            cacheKey = `${emoji}_retro`;
        } else if (isConstellation) {
            cacheKey = `${emoji}_constellation`;
        }
        let texture = this.emojiTextureCache.get(cacheKey);

        if (!texture) {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');

            ctx.font = '48px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (isRetro) {
                // Draw the emoji grayscaled to preserve internal luminosity details
                ctx.filter = 'grayscale(100%) contrast(120%)';
                ctx.fillText(emoji, 32, 32);

                // Tint using 'color' mode: preserves luminosity (details) while applying hue/sat
                ctx.filter = 'none';
                ctx.globalCompositeOperation = 'color';
                ctx.fillStyle = '#00ff44';
                ctx.fillRect(0, 0, 64, 64);

                // Final pass: ensure background transparency is maintained (as 'color' fills the rect)
                ctx.globalCompositeOperation = 'destination-in';
                ctx.fillText(emoji, 32, 32);
            } else if (isConstellation) {
                // Draw the emoji grayscaled to preserve internal luminosity details
                ctx.filter = 'grayscale(100%) contrast(120%)';
                ctx.fillText(emoji, 32, 32);

                // Tint using 'color' mode: preserves luminosity (details) while applying a beautiful slightly lighter celestial blue hue
                ctx.filter = 'none';
                ctx.globalCompositeOperation = 'color';
                ctx.fillStyle = '#58a6ff'; // Beautiful slightly lighter celestial blue shade
                ctx.fillRect(0, 0, 64, 64);

                // Final pass: ensure background transparency is maintained
                ctx.globalCompositeOperation = 'destination-in';
                ctx.fillText(emoji, 32, 32);
            } else {
                ctx.fillText(emoji, 32, 32);
            }

            texture = new THREE.CanvasTexture(canvas);
            this.emojiTextureCache.set(cacheKey, texture);
        }
        return texture;
    }

    _createEmojiSprite(emoji) {
        const texture = this._getEmojiTexture(
            emoji,
            this.retroMode,
            this.constellationMode,
        );

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            color: 0xffffff,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(40, 40, 1);
        return { sprite: sprite, life: 1.0 };
    }

    clear() {
        this.emojiPool.clear((item) => {
            this.scene.remove(item.sprite);
            if (item.sprite.material) item.sprite.material.dispose();
        });
    }
}

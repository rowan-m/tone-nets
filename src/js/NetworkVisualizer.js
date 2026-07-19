import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import {
    EffectComposer,
    RenderPass,
    EffectPass,
    BloomEffect,
    Effect,
} from 'postprocessing';
import { Utils } from './Utils.js';
import { NetworkLayout } from './NetworkLayout.js';
import { VisualEffectsManager } from './VisualEffectsManager.js';
import { ThemeManager } from './ThemeManager.js';

/**
 * Custom post-processing effect for a retro CRT look.
 * Includes barrel distortion, RGB shift, scanlines, and noise.
 */
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
    // Shift is stronger at the edges of the screen
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

class RetroCRTEffect extends Effect {
    constructor() {
        super('RetroCRTEffect', retroCRTFragmentShader, {
            uniforms: new Map([
                ['uTime', new THREE.Uniform(0)],
                ['uDistortion', new THREE.Uniform(0.12)],
            ]),
        });
    }

    update(renderer, inputBuffer, deltaTime) {
        this.uniforms.get('uTime').value += deltaTime;
    }
}

export class NetworkVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = new THREE.Scene();
        const aspect = this.container.clientWidth / this.container.clientHeight;
        const d = 1000;
        this.camera = new THREE.OrthographicCamera(
            -d * aspect,
            d * aspect,
            d,
            -d,
            1,
            10000,
        );
        this.baseFrustumSize = d * 2;
        this.renderer = new THREE.WebGLRenderer({
            powerPreference: 'high-performance',
            antialias: false,
            stencil: false,
            depth: true,
        });

        this.highlightColor = 0xffe600; // Electric Yellow
        this.highlightIntensity = 12.0; // HDR multiplier for bloom. High value needed because base emissiveIntensity is ~0.15

        this.nodes = new Map();
        this.nodeList = [];
        this.edges = [];

        this.edgeMap = new Map();
        this.pickableObjects = [];
        this._objectsToIntersect = [];
        this.hoveredObject = null;
        this.layout = null;
        this.graphGroup = new THREE.Group();
        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Line.threshold = 5;
        this.mouse = new THREE.Vector2(-1000, -1000);
        this.mouseMoved = false;
        this.onHover = null;
        this.onBeforeFrame = null;

        this.playingNodes = new Set();
        this.playingEdges = new Set();
        this.isPaused = false;
        this.incrementalMode = false;
        this.graph = null;
        this.maxDegree = 1;
        this.maxWeight = 1;
        this.layoutScale = 10.0;
        this.autoTour = false;
        this.autoTourTime = 0;

        this.themeManager = new ThemeManager();
        this.currentThemeName = null;

        this._isMobile = Utils.isMobile();
        this._frameCount = 0;

        this.tourCurrentVelocity = new THREE.Vector3();
        this.tourTargetVelocity = new THREE.Vector3();
        this.tourRotation = new THREE.Quaternion();
        this.tourSpeedChangeTimer = 0;
        this.graphBoundingBox = new THREE.Box3();
        this.graphCenter = new THREE.Vector3();
        this.currentTourTarget = new THREE.Vector3();
        this.scene.add(this.graphGroup);

        this.effects = new VisualEffectsManager(this.scene, this.camera);

        this._lastFrameTime = 0;
        this._lastRaycastTime = 0;
        this._raycastThrottleMs = 33; // ~30fps for hover logic

        this.coneMaterialPool = new Map();

        // Shared colors for interpolation to avoid object churn
        this._colorLow = new THREE.Color(0x444444);
        this._colorMid = new THREE.Color(0x666666);
        this._colorHigh = new THREE.Color(0x999999);
        this._scratchColor = new THREE.Color();

        // Reusable vectors to minimize GC
        this._cameraUp = new THREE.Vector3();
        this._upVec = new THREE.Vector3(0, 1, 0);
        this._scratchVec3_1 = new THREE.Vector3();
        this._scratchVec3_2 = new THREE.Vector3();
        this._scratchVec3_3 = new THREE.Vector3();
        this._scratchVec3_4 = new THREE.Vector3();
        this._scratchVec3_5 = new THREE.Vector3();
        this._scratchBox3 = new THREE.Box3();
        this._scratchSphere = new THREE.Sphere();
        this._scratchCurve = new THREE.QuadraticBezierCurve3();

        // Shared materials for hover/highlight states
        this.hoverEdgeMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
        });
        this.hoverConeMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
        });

        this.highlightEdgeMaterial = new THREE.LineBasicMaterial({
            color: this.highlightColor,
            transparent: true,
            opacity: 1.0,
        });
        this.highlightConeMaterial = new THREE.MeshBasicMaterial({
            color: this.highlightColor,
            transparent: true,
            opacity: 1.0,
        });

        this.maxNodeCapacity = 512;
        this.maxEdgeCapacity = 4096;
        this.maxEdgeSegments = 20;

        // Precompute Bezier coefficients for each segment index to avoid dynamic calculations in the hot loop
        this._bezierCoefficients = [];
        for (let i = 0; i <= this.maxEdgeSegments; i++) {
            const t = i / this.maxEdgeSegments;
            const u = 1 - t;
            this._bezierCoefficients.push({
                c0: u * u,
                c1: 2 * u * t,
                c2: t * t,
            });
        }

        this.edgePositions = new Float32Array(
            this.maxEdgeCapacity * this.maxEdgeSegments * 2 * 3,
        );
        this.edgeColors = new Float32Array(
            this.maxEdgeCapacity * this.maxEdgeSegments * 2 * 3,
        );
        this.edgeAlphas = new Float32Array(
            this.maxEdgeCapacity * this.maxEdgeSegments * 2,
        );

        this.nodeInstancedMesh = null;
        this.outlineInstancedMesh = null;
        this.coneInstancedMesh = null;
        this.edgeLineSegments = null;

        this.nodeInstanceIdMap = new Map(); // nodeId -> instanceId
        this.instanceIdNodeMap = new Map(); // instanceId -> nodeId
        this.edgeInstanceIdMap = new Map(); // edgeId -> instanceId
        this.instanceIdEdgeMap = new Map(); // instanceId -> edgeId
        this.edgeBufferIndexMap = new Map(); // edgeId -> bufferIndex (in segments)
        this._graphDirtySinceLastFakeLinks = true;

        this._scratchMatrix = new THREE.Matrix4();
        this._currentGeometrySegments = 32;

        this.initThree();
        this.initPostProcessing();

        // Bind event handlers
        this.animate = this.animate.bind(this);
        this._onWindowResize = this._onWindowResize.bind(this);
        this._onPointerInteraction = this._onPointerInteraction.bind(this);
        this._onPointerLeave = this._onPointerLeave.bind(this);

        this._isAnimating = false;
        this._animationFrameId = null;

        this._setupEventListeners();
    }

    _setupEventListeners() {
        window.addEventListener('resize', this._onWindowResize);
        this.container.addEventListener(
            'pointermove',
            this._onPointerInteraction,
        );
        this.container.addEventListener(
            'pointerdown',
            this._onPointerInteraction,
        );
        this.container.addEventListener('pointerleave', this._onPointerLeave);
    }

    _onWindowResize() {
        this._updateResolution();
        const aspect =
            this.renderer.domElement.width / this.renderer.domElement.height;
        const d = this.baseFrustumSize / 2;
        this.camera.left = -d * aspect;
        this.camera.right = d * aspect;
        this.camera.top = d;
        this.camera.bottom = -d;
        this.camera.updateProjectionMatrix();
    }

    _updateResolution() {
        const theme = this.themeManager.getCurrentTheme();
        let width = this.container.clientWidth;
        let height = this.container.clientHeight;

        if (theme && theme.maxResolution) {
            const aspect = width / height;
            if (
                width > theme.maxResolution.width ||
                height > theme.maxResolution.height
            ) {
                if (
                    theme.maxResolution.width / theme.maxResolution.height >
                    aspect
                ) {
                    height = theme.maxResolution.height;
                    width = height * aspect;
                } else {
                    width = theme.maxResolution.width;
                    height = width / aspect;
                }
            }
        }

        // We set the renderer size but keep the canvas style at 100% to let the browser scale it
        this.renderer.setSize(width, height, false);
        this.composer.setSize(width, height);

        const canvas = this.renderer.domElement;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.imageRendering =
            theme && theme.maxResolution ? 'pixelated' : 'auto';
    }

    enableRetroEffects(enabled) {
        if (this.effects) {
            this.effects.setRetroMode(enabled);
        }

        if (enabled) {
            if (!this.retroCRTPass) {
                const effect = new RetroCRTEffect();
                this.retroCRTPass = new EffectPass(this.camera, effect);
            }
            this.composer.addPass(this.retroCRTPass);
        } else if (this.retroCRTPass) {
            this.composer.removePass(this.retroCRTPass);
        }
    }

    _onPointerInteraction(e) {
        const rect = this.container.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        this.mouseMoved = true;
    }

    _onPointerLeave() {
        this.mouse.set(-1000, -1000);
        this.mouseMoved = true;
    }

    startAnimationLoop() {
        if (!this._isAnimating) {
            this._isAnimating = true;
            this._lastFrameTime = performance.now();
            this._animationFrameId = requestAnimationFrame(this.animate);
        }
    }

    stopAnimationLoop() {
        if (this._isAnimating) {
            this._isAnimating = false;
            if (this._animationFrameId !== null) {
                cancelAnimationFrame(this._animationFrameId);
                this._animationFrameId = null;
            }
        }
    }

    initThree() {
        this.renderer.setSize(
            this.container.clientWidth,
            this.container.clientHeight,
        );
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.container.appendChild(this.renderer.domElement);

        // Initial dummy camera setup for the empty scene.
        // This will be completely overridden by fitCameraToGraph() once a MIDI is loaded.
        this.camera.up.set(0, 1, 0); // Y-up
        this.camera.position.set(0, 800, 800);
        this.camera.lookAt(0, 0, 0);

        this.controls = new TrackballControls(
            this.camera,
            this.renderer.domElement,
        );
        this.controls.rotateSpeed = 2.0;
        this.controls.dynamicDampingFactor = 0.1;
        this.controls.addEventListener('start', () => this.stopAutoTour());
        this.controls.addEventListener('change', () => {
            this.mouseMoved = true;
        });

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 2);
        this.scene.add(directionalLight);
    }

    initPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomEffect = new BloomEffect({
            intensity: 3.0,
            luminanceThreshold: 0.15,
            luminanceSmoothing: 0.85,
            mipmapBlur: true,
        });

        this.bloomEffect = bloomEffect;
        this.composer.addPass(new EffectPass(this.camera, bloomEffect));
    }

    clear() {
        this.stopAnimationLoop();
        this.stopAutoTour();
        if (this.controls) {
            this.controls.reset();
        }

        this.effects.clear();

        // Reset tour-related state fully
        this.tourCurrentVelocity.set(0, 0, 0);
        this.tourTargetVelocity.set(0, 0, 0);
        this.tourRotation.set(0, 0, 0, 1);
        this.tourSpeedChangeTimer = 0;

        // Dispose pooled materials
        this.coneMaterialPool.forEach((mat) => mat.dispose());
        this.coneMaterialPool.clear();

        this.nodes.clear();
        this.nodeList = [];
        this.edges = [];

        this.edgeMap.clear();
        this.playingNodes.clear();
        this.playingEdges.clear();
        this.pickableObjects = [];
        this._updateObjectsToIntersect();
        this.graph = null;
        this.incrementalMode = false;
        this.maxDegree = 1;
        this._graphDirtySinceLastFakeLinks = true;
        this.maxWeight = 1;

        if (this.nodeInstancedMesh) {
            this.nodeInstancedMesh.count = 0;
            this.nodeInstancedMesh.instanceMatrix.needsUpdate = true;
            if (this.nodeInstancedMesh.instanceColor) {
                this.nodeInstancedMesh.instanceColor.needsUpdate = true;
            }
        }
        if (this.outlineInstancedMesh) {
            this.outlineInstancedMesh.count = 0;
            this.outlineInstancedMesh.instanceMatrix.needsUpdate = true;
        }
        if (this.coneInstancedMesh) {
            this.coneInstancedMesh.count = 0;
            this.coneInstancedMesh.instanceMatrix.needsUpdate = true;
            if (this.coneInstancedMesh.instanceColor) {
                this.coneInstancedMesh.instanceColor.needsUpdate = true;
            }
        }
        if (this.edgeLineSegments) {
            this.edgeLineSegments.geometry.setDrawRange(0, 0);
            this.edgeLineSegments.geometry.attributes.position.needsUpdate = true;
            this.edgeLineSegments.geometry.attributes.color.needsUpdate = true;
            this.edgeLineSegments.geometry.attributes.alpha.needsUpdate = true;
        }

        this.nodeInstanceIdMap.clear();
        this.instanceIdNodeMap.clear();
        this.edgeInstanceIdMap.clear();
        this.instanceIdEdgeMap.clear();
        this.edgeBufferIndexMap.clear();

        this.isPaused = false;

        if (this.layout) {
            this.layout.dispose();
            this.layout = null;
        }
    }

    async _computeLayout(graph) {
        this.layout = new NetworkLayout(graph);

        const currentToken = {};
        this._buildToken = currentToken;

        const totalSteps = 3000;

        // Ensure isolated components are pulled together statically before simulation runs
        this._updateFakeLinks();

        await this.layout.runSimulation(totalSteps, (percent) => {
            if (this._buildToken !== currentToken) return;
            if (this.onLayoutProgress) {
                this.onLayoutProgress(percent);
            }
        });

        return this._buildToken === currentToken;
    }

    async initIncremental(graph) {
        this.clear();
        this.graph = graph;
        this.incrementalMode = true;

        this.layout = new NetworkLayout(graph);

        this.maxDegree = 1;
        this.maxWeight = 1;

        // Ensure safe defaults for camera/tour logic when graph is empty
        this.graphCenter.set(0, 0, 0);
        this.currentTourTarget.set(0, 0, 0);
        this.graphRadius = 100;

        // Initialize geometries if not already done
        this._initSharedGeometries();

        // Ensure new materials reflect the currently active theme immediately
        this.setTheme(this.currentThemeName);

        this.fitCameraToGraph();
        this.startAutoTour();
        this.startAnimationLoop();
    }

    _initSharedGeometries(segments) {
        const sphereSegments = segments || this._currentGeometrySegments || 32;

        if (!this.sphereGeo) {
            this._currentGeometrySegments = sphereSegments;
            this.sphereGeo = new THREE.SphereGeometry(
                1,
                sphereSegments,
                sphereSegments,
            );
            this.outlineGeo = new THREE.SphereGeometry(1.08, 20, 20);
            this.outlineMat = new THREE.MeshBasicMaterial({
                color: 0x000000,
                side: THREE.BackSide,
            });
            this.coneGeo = new THREE.ConeGeometry(1.2, 3.5, 16);
            this.coneGeo.rotateX(Math.PI / 2);

            // Initialize InstancedMeshes
            const nodeMat = new THREE.MeshStandardMaterial({
                roughness: 0.3,
                metalness: 0.2,
                emissive: 0xffffff,
                emissiveIntensity: 0.15, // Base glow for all nodes
            });
            nodeMat.userData.uTime = { value: 0 };
            nodeMat.userData.uIsConstellation = { value: 0 };

            // Inject instance-based emissive modulation and procedural reflection
            nodeMat.onBeforeCompile = (shader) => {
                shader.uniforms.uTime = nodeMat.userData.uTime;
                shader.uniforms.uIsConstellation =
                    nodeMat.userData.uIsConstellation;
                this.nodeShader = shader; // Save reference to update uTime in loop

                shader.vertexShader = shader.vertexShader.replace(
                    '#include <common>',
                    `
                    #include <common>
                    uniform float uIsConstellation;
                    `,
                );

                shader.vertexShader = shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `
                    #include <begin_vertex>
                    if (uIsConstellation > 0.5) {
                        transformed *= 1.35;
                    }
                    `,
                );

                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `
                    #include <common>
                    uniform float uTime;
                    uniform float uIsConstellation;
                    
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
                        // Detect if the node is currently highlighted (HDR values > 2.0)
                        isHighlighted = step(2.0, length(vColor.rgb));
                    #endif

                    // Procedural Reflection Layer
                    if (metalnessFactor > 0.5) {
                        // Calculate reflection vector in VIEW space instead of world space.
                        vec3 viewIncident = -normalize(vViewPosition);
                        vec3 ref = reflect(viewIncident, normal);

                        // Convert to equirectangular UVs
                        float u = atan(ref.z, ref.x) / (2.0 * PI) + 0.5;
                        float v = ref.y * 0.5 + 0.5;
                        vec2 refUv = vec2(u, v);

                        vec2 st = refUv * vec2(4.0, 2.0);

                        // Flow upwards faster and sway chaotically
                        st.y -= uTime * 1.2;
                        st.x += sin(uTime * 0.8 + refUv.y * 4.0) * 0.2 + cos(uTime * 1.5 - refUv.y * 8.0) * 0.1;

                        // Layered noise with time-based offset for internal chaos
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

                        // If the node is highlighted, we fade out the fire reflection so it doesn't wash out the pure blue highlight
                        fireColor = mix(fireColor * 1.5, vec3(0.0), isHighlighted * 0.8);

                        totalEmissiveRadiance += fireColor;
                        
                        #ifdef USE_COLOR
                            // Force an intense emissive boost when highlighted to guarantee a clean, bright bloom over the dark metal
                            totalEmissiveRadiance += vColor.rgb * isHighlighted * 0.5;
                        #endif
                    }

                    if (uIsConstellation > 0.5) {
                        float viewAlign = max(0.0, dot(normal, normalize(vViewPosition)));
                        
                        // 1. High-Detail Bubbling Plasma (3 octaves of FBM noise)
                        vec2 st1 = normal.xy * 3.0 + vec2(uTime * 0.15, uTime * -0.1);
                        vec2 st2 = normal.xy * 6.0 + vec2(uTime * -0.1, uTime * 0.2);
                        vec2 st3 = normal.xy * 12.0 + vec2(uTime * 0.25, uTime * 0.25);
                        
                        float p1 = noise_fire(st1);
                        float p2 = noise_fire(st2);
                        float p3 = noise_fire(st3);
                        float plasma = p1 * 0.5 + p2 * 0.3 + p3 * 0.2;
                        
                        // 2. High-Density Opaque Core + Fuzzy Outer Corona (Normal Blending)
                        // This makes the core completely opaque to block internal connections!
                        float starAlpha = smoothstep(0.0, 0.45, viewAlign);
                        
                        vec3 starColor = vec3(1.0, 1.0, 1.0);
                        #ifdef USE_COLOR
                            starColor = vColor.rgb;
                        #endif
                        
                        // 3. Detailed Plasma Color
                        vec3 plasmaColor = mix(starColor, vec3(1.0, 1.0, 1.0), plasma * 0.2);
                        vec3 hotCore = mix(plasmaColor, vec3(1.0, 1.0, 1.0), pow(viewAlign, 6.0) * 0.4);
                        
                        // Emit star core intensity
                        totalEmissiveRadiance = hotCore * starAlpha * 1.5;
                        
                        // 4. Beautiful Fresnel Corona Outer Edge (Eliminates the dark edge and makes it ultra fuzzy!)
                        float rim = pow(1.0 - viewAlign, 3.5);
                        vec3 rimColor = starColor * rim * 1.8; // High glow on outer edges
                        totalEmissiveRadiance += rimColor;
                        
                        // Set the final transparency (Ensures center core is 100% opaque, outer halo is semi-transparent)
                        diffuseColor.a = max(starAlpha, rim * 0.95);
                        diffuseColor.rgb = vec3(0.0);
                    }
                    `,
                );
            };

            this.nodeInstancedMesh = new THREE.InstancedMesh(
                this.sphereGeo,
                nodeMat,
                this.maxNodeCapacity,
            );
            this.nodeInstancedMesh.instanceMatrix.setUsage(
                THREE.DynamicDrawUsage,
            );
            if (this.nodeInstancedMesh.instanceColor) {
                this.nodeInstancedMesh.instanceColor.setUsage(
                    THREE.DynamicDrawUsage,
                );
            }
            this.nodeInstancedMesh.userData.type = 'node-batch';
            this.nodeInstancedMesh.frustumCulled = false;
            this.nodeInstancedMesh.geometry.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(),
                100000,
            );
            this.graphGroup.add(this.nodeInstancedMesh);

            this.outlineInstancedMesh = new THREE.InstancedMesh(
                this.outlineGeo,
                this.outlineMat,
                this.maxNodeCapacity,
            );
            this.outlineInstancedMesh.instanceMatrix.setUsage(
                THREE.DynamicDrawUsage,
            );
            this.outlineInstancedMesh.frustumCulled = false;
            this.outlineInstancedMesh.geometry.boundingSphere =
                new THREE.Sphere(new THREE.Vector3(), 100000);
            this.graphGroup.add(this.outlineInstancedMesh);

            const coneMat = new THREE.MeshStandardMaterial({
                transparent: true,
                opacity: 1.0,
                emissive: 0xffffff,
                emissiveIntensity: 0.2,
            });
            coneMat.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <emissivemap_fragment>',
                    `
                    #include <emissivemap_fragment>
                    #ifdef USE_COLOR
                        totalEmissiveRadiance *= vColor.rgb;
                    #endif
                    `,
                );
            };

            this.coneInstancedMesh = new THREE.InstancedMesh(
                this.coneGeo,
                coneMat,
                this.maxEdgeCapacity,
            );
            this.coneInstancedMesh.instanceMatrix.setUsage(
                THREE.DynamicDrawUsage,
            );
            if (this.coneInstancedMesh.instanceColor) {
                this.coneInstancedMesh.instanceColor.setUsage(
                    THREE.DynamicDrawUsage,
                );
            }
            this.coneInstancedMesh.userData.type = 'cone-batch';
            this.coneInstancedMesh.frustumCulled = false;
            this.coneInstancedMesh.geometry.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(),
                100000,
            );
            this.graphGroup.add(this.coneInstancedMesh);

            const edgeGeo = new THREE.BufferGeometry();
            edgeGeo.setAttribute(
                'position',
                new THREE.BufferAttribute(this.edgePositions, 3),
            );
            edgeGeo.setAttribute(
                'color',
                new THREE.BufferAttribute(this.edgeColors, 3),
            );
            edgeGeo.setAttribute(
                'alpha',
                new THREE.BufferAttribute(this.edgeAlphas, 1),
            );
            edgeGeo.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(),
                100000,
            );

            const edgeMat = new THREE.ShaderMaterial({
                transparent: true,
                vertexColors: true,
                uniforms: {
                    uGlobalOpacity: { value: 1.0 },
                    uHDRIntensity: { value: 1.0 },
                },
                vertexShader: `
                    attribute float alpha;
                    varying float vAlpha;
                    varying vec3 vColor;
                    void main() {
                        vAlpha = alpha;
                        vColor = color;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    varying float vAlpha;
                    varying vec3 vColor;
                    uniform float uGlobalOpacity;
                    uniform float uHDRIntensity;
                    void main() {
                        // Multiply color by HDR intensity to trigger bloom more strongly on highlights
                        gl_FragColor = vec4(vColor * uHDRIntensity, vAlpha * uGlobalOpacity);
                    }
                `,
            });

            this.edgeLineSegments = new THREE.LineSegments(edgeGeo, edgeMat);
            this.edgeLineSegments.frustumCulled = false;
            this.graphGroup.add(this.edgeLineSegments);
        }

        this._updateObjectsToIntersect();
    }

    _reinitGeometries(segments) {
        const disposeMesh = (mesh) => {
            if (!mesh) return;
            this.graphGroup.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    for (let i = 0; i < mesh.material.length; i++) {
                        mesh.material[i].dispose();
                    }
                } else {
                    mesh.material.dispose();
                }
            }
        };

        disposeMesh(this.nodeInstancedMesh);
        this.nodeInstancedMesh = null;
        disposeMesh(this.outlineInstancedMesh);
        this.outlineInstancedMesh = null;
        disposeMesh(this.coneInstancedMesh);
        this.coneInstancedMesh = null;
        disposeMesh(this.edgeLineSegments);
        this.edgeLineSegments = null;

        if (this.sphereGeo) this.sphereGeo.dispose();
        if (this.outlineGeo) this.outlineGeo.dispose();
        if (this.coneGeo) this.coneGeo.dispose();

        this.sphereGeo = null;
        this.outlineGeo = null;
        this.coneGeo = null;

        this._initSharedGeometries(segments);

        // Re-upload data if a graph exists
        if (this.graph) {
            // Restore instance counts on new meshes
            if (this.nodeInstancedMesh) {
                this.nodeInstancedMesh.count = this.nodeList.length;
            }
            if (this.outlineInstancedMesh) {
                this.outlineInstancedMesh.count = this.nodeList.length;
            }
            if (this.coneInstancedMesh) {
                this.coneInstancedMesh.count = this.edges.length;
            }

            this._updatePositionsFromLayout();
            this._updateThemeNodeColors(this.currentThemeName);
        }
    }

    _updateElementVisuals(id, type) {
        if (type === 'node') {
            const nodeData = this.nodes.get(id);
            if (!nodeData) return;
            const node = this.graph.getNode(id);
            const degree = (node.data && node.data.degree) || 1;
            nodeData.degree = degree;
            nodeData.mesh.userData.degree = degree;

            const pos = this.layout.getNodePosition(id);
            const normDegree = Math.min(1, degree / this.maxDegree);
            const scale = 3 + normDegree * 15;

            this._scratchMatrix.makeTranslation(
                pos.x * this.layoutScale,
                pos.y * this.layoutScale,
                pos.z * this.layoutScale,
            );
            this._scratchMatrix.scale(
                this._scratchVec3_1.set(scale, scale, scale),
            );

            this.nodeInstancedMesh.setMatrixAt(
                nodeData.instanceId,
                this._scratchMatrix,
            );
            this.outlineInstancedMesh.setMatrixAt(
                nodeData.instanceId,
                this._scratchMatrix,
            );

            this.nodeInstancedMesh.instanceMatrix.needsUpdate = true;
            this.outlineInstancedMesh.instanceMatrix.needsUpdate = true;
        } else if (type === 'edge') {
            const edgeData = this.edgeMap.get(id);
            if (!edgeData) return;
            const link = edgeData.link;
            if (link) {
                this._updateEdgeBuffer(
                    id,
                    link,
                    this.layoutScale,
                    this.maxWeight,
                );
            }
        }
    }

    _updateAllVisualScales() {
        for (let i = 0; i < this.nodeList.length; i++) {
            this._updateElementVisuals(this.nodeList[i].id, 'node');
        }
        for (let i = 0; i < this.edges.length; i++) {
            const edgeData = this.edges[i];
            const edgeId = `${edgeData.sourceId}->${edgeData.targetId}`;
            this._updateElementVisuals(edgeId, 'edge');
        }
    }

    _updateSpecificVisuals(sourceId, targetId, hasTransition) {
        if (sourceId) this._updateElementVisuals(sourceId, 'node');
        if (targetId) this._updateElementVisuals(targetId, 'node');
        if (hasTransition) {
            this._updateElementVisuals(`${sourceId}->${targetId}`, 'edge');
        }
    }

    addTransitionIncremental(sourceId, targetId) {
        if (!this.incrementalMode || !this.graph || !targetId) return;

        const hasTransition = Boolean(sourceId && sourceId !== targetId);

        const sourceNode = hasTransition ? this.graph.getNode(sourceId) : null;
        const targetNode = this.graph.getNode(targetId);

        this._ensureNodeVisuals(sourceNode, sourceId);
        this._ensureNodeVisuals(targetNode, targetId);

        let globalUpdateNeeded = false;
        if (hasTransition) {
            globalUpdateNeeded = this._ensureEdgeVisuals(sourceId, targetId);
        }

        if (this._updateMaxMetrics(sourceNode, targetNode)) {
            globalUpdateNeeded = true;
        }

        if (globalUpdateNeeded) {
            this._scheduleGlobalUpdate();
        } else {
            this._updateSpecificVisuals(sourceId, targetId, hasTransition);
        }
    }

    _ensureNodeVisuals(node, id) {
        if (node && !this.nodes.has(id)) {
            this._renderNode(node, this.layoutScale, this.maxDegree);
        }
    }

    _ensureEdgeVisuals(sourceId, targetId) {
        const edgeId = `${sourceId}->${targetId}`;
        const link = this.graph.getLink(sourceId, targetId);
        let globalUpdateNeeded = false;

        if (link && !this.edgeBufferIndexMap.has(edgeId)) {
            this._renderEdge(link, this.layoutScale, this.maxWeight);
        }

        if (link && link.data.weight > this.maxWeight) {
            this.maxWeight = link.data.weight;
            globalUpdateNeeded = true;
        }
        return globalUpdateNeeded;
    }

    _updateMaxMetrics(sourceNode, targetNode) {
        let increased = false;
        if (sourceNode && sourceNode.data.degree > this.maxDegree) {
            this.maxDegree = sourceNode.data.degree;
            increased = true;
        }
        if (targetNode && targetNode.data.degree > this.maxDegree) {
            this.maxDegree = targetNode.data.degree;
            increased = true;
        }
        return increased;
    }

    _scheduleGlobalUpdate() {
        // Debounce global updates to avoid O(N+E) work on every note-on event
        // during high-activity periods.
        if (this._globalUpdateTimeout) clearTimeout(this._globalUpdateTimeout);
        this._globalUpdateTimeout = setTimeout(() => {
            this._updateAllVisualScales();
            this._globalUpdateTimeout = null;
        }, 100);
    }

    _renderNode(node, layoutScale, maxDegree) {
        if (this.nodeInstanceIdMap.has(node.id)) return;

        this._graphDirtySinceLastFakeLinks = true;
        this._initSharedGeometries();

        const instanceId = this.nodeInstanceIdMap.size;
        if (instanceId >= this.maxNodeCapacity) return;

        this.nodeInstanceIdMap.set(node.id, instanceId);
        this.instanceIdNodeMap.set(instanceId, node.id);

        const pos = this.layout.getNodePosition(node.id);
        const degree = (node.data && node.data.degree) || 1;
        const normDegree = Math.min(1, degree / maxDegree);

        const pitchClass = Utils.noteToSemitone(node.id) % 12;
        const currentTheme = this.themeManager.getCurrentTheme();

        let hue, saturation, lightness;
        if (currentTheme && currentTheme.getNodeColor) {
            ({ hue, saturation, lightness } = currentTheme.getNodeColor(
                pitchClass,
                Utils,
            ));
        } else {
            hue = pitchClass / 12;
            saturation = 1.0;
            lightness = 0.5;
        }

        const baseColor = this._scratchColor
            .setHSL(hue, saturation, lightness)
            .getHex();

        const scale = 3 + normDegree * 15;
        this._scratchMatrix.makeTranslation(
            pos.x * layoutScale,
            pos.y * layoutScale,
            pos.z * layoutScale,
        );
        this._scratchMatrix.scale(this._scratchVec3_1.set(scale, scale, scale));

        this.nodeInstancedMesh.setMatrixAt(instanceId, this._scratchMatrix);
        this.nodeInstancedMesh.setColorAt(instanceId, this._scratchColor);
        this.nodeInstancedMesh.instanceMatrix.needsUpdate = true;
        if (this.nodeInstancedMesh.instanceColor) {
            this.nodeInstancedMesh.instanceColor.needsUpdate = true;
        }

        // Outlines
        this.outlineInstancedMesh.setMatrixAt(instanceId, this._scratchMatrix);
        this.outlineInstancedMesh.instanceMatrix.needsUpdate = true;

        this.nodeInstancedMesh.count = instanceId + 1;
        this.outlineInstancedMesh.count = instanceId + 1;

        const nodeData = {
            id: node.id,
            instanceId: instanceId,
            baseColor: baseColor,
            degree: degree,
            playCount: 0,
            // Keep a dummy mesh for test compatibility and raycasting metadata
            mesh: {
                userData: {
                    type: 'node',
                    id: node.id,
                    degree: degree,
                    instanceId: instanceId,
                },
                position: {
                    x: pos.x * layoutScale,
                    y: pos.y * layoutScale,
                    z: pos.z * layoutScale,
                },
                material: {
                    emissive: 0x000000,
                    emissiveIntensity: 0.2,
                },
            },
        };
        this.nodes.set(node.id, nodeData);
        this.nodeList.push(nodeData);
    }

    _renderNodes(graph, layoutScale, maxDegree) {
        this._initSharedGeometries();
        graph.forEachNode((node) => {
            this._renderNode(node, layoutScale, maxDegree);
        });
    }

    static _hashCache = new Map();

    static _hashString(str) {
        let cached = this._hashCache.get(str);
        if (cached !== undefined) return cached;
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = (h << 5) - h + str.charCodeAt(i);
            h |= 0;
        }
        this._hashCache.set(str, h);
        return h;
    }

    _updateEdgeCurve(curve, sPosRaw, tPosRaw, layoutScale, seed) {
        const sPos = curve.v0.set(
            sPosRaw.x * layoutScale,
            sPosRaw.y * layoutScale,
            sPosRaw.z * layoutScale,
        );
        const tPos = curve.v2.set(
            tPosRaw.x * layoutScale,
            tPosRaw.y * layoutScale,
            tPosRaw.z * layoutScale,
        );

        const dx = tPos.x - sPos.x;
        const dy = tPos.y - sPos.y;
        const dz = tPos.z - sPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const midPoint = this._scratchVec3_1
            .copy(sPos)
            .add(tPos)
            .multiplyScalar(0.5);

        const edgeDir = this._scratchVec3_2;
        if (dist > 0) {
            edgeDir.set(dx / dist, dy / dist, dz / dist);
        } else {
            edgeDir.set(0, 0, 0);
        }

        const pickAxis =
            Math.abs(edgeDir.y) < 0.9
                ? this._upVec
                : this._scratchVec3_3.set(1, 0, 0);
        const perp = this._scratchVec3_3
            .crossVectors(edgeDir, pickAxis)
            .normalize();

        // Introduce organic variation by rotating the perpendicular vector around the edge direction.
        // We use the pre-computed seed to create a stable but unique rotation for each edge pair.
        const angle = (seed % 360) * 0.017453292519943295;
        perp.applyAxisAngle(edgeDir, angle);

        // Curvature amount: reduced to ~15% of distance for a cleaner, more readable network.
        // We still keep a small random offset to avoid "parallel" curves in symmetric graphs.
        const curveAmount = dist * (0.15 + (seed % 10) * 0.01);
        curve.v1.copy(midPoint).add(perp.multiplyScalar(curveAmount));

        return curve;
    }

    _getEdgeColor(normWeight) {
        if (normWeight <= 0.5) {
            return this._scratchColor
                .copy(this._colorLow)
                .lerp(this._colorMid, normWeight * 2);
        }
        return this._scratchColor
            .copy(this._colorMid)
            .lerp(this._colorHigh, (normWeight - 0.5) * 2);
    }

    _getEdgeVisualProperties(edgeId, normWeight) {
        const edgeData = this.edgeMap.get(edgeId);
        const isPlaying = edgeData && edgeData.playCount > 0;
        const isHovered =
            this.hoveredObject &&
            this.hoveredObject.userData.type === 'edge' &&
            `${this.hoveredObject.userData.sourceId}->${this.hoveredObject.userData.targetId}` ===
                edgeId;

        let edgeColor, edgeOpacity;

        if (isHovered) {
            edgeColor = this._scratchColor
                .set(0xffffff)
                .multiplyScalar(this.highlightIntensity);
            edgeOpacity = 1.0;
            if (edgeData) edgeData.line.material = this.hoverEdgeMaterial;
        } else if (isPlaying) {
            edgeColor = this._scratchColor
                .set(this.highlightColor)
                .multiplyScalar(this.highlightIntensity);
            edgeOpacity = 1.0;
            if (edgeData) edgeData.line.material = this.highlightEdgeMaterial;
        } else {
            edgeColor = this._getEdgeColor(normWeight);
            edgeOpacity = 0.4 + normWeight * 0.6;
            if (edgeData)
                edgeData.line.material = edgeData.line.userData.origMaterial;
        }

        return { edgeColor, edgeOpacity, edgeData };
    }

    _updateEdgeBuffer(
        edgeId,
        link,
        layoutScale,
        maxWeight,
        needsUpdateAttribute = true,
    ) {
        const edgeIndex = this.edgeBufferIndexMap.get(edgeId);
        if (edgeIndex === undefined) return;

        const edgeData = this.edgeMap.get(edgeId);
        if (!edgeData) return;

        const sPosRaw = this.layout.getNodePosition(link.fromId);
        const tPosRaw = this.layout.getNodePosition(link.toId);

        const curve = this._updateEdgeCurve(
            this._scratchCurve,
            sPosRaw,
            tPosRaw,
            layoutScale,
            edgeData.seed,
        );

        const baseIdx = edgeIndex * this.maxEdgeSegments * 2;
        const posAttr = this.edgeLineSegments.geometry.attributes.position;
        const colorAttr = this.edgeLineSegments.geometry.attributes.color;
        const alphaAttr = this.edgeLineSegments.geometry.attributes.alpha;

        const normWeight = Math.min(1, link.data.weight / maxWeight);
        const { edgeColor, edgeOpacity } = this._getEdgeVisualProperties(
            edgeId,
            normWeight,
        );

        for (let i = 0; i < this.maxEdgeSegments; i++) {
            const coef1 = this._bezierCoefficients[i];
            const coef2 = this._bezierCoefficients[i + 1];

            const p1x =
                coef1.c0 * curve.v0.x +
                coef1.c1 * curve.v1.x +
                coef1.c2 * curve.v2.x;
            const p1y =
                coef1.c0 * curve.v0.y +
                coef1.c1 * curve.v1.y +
                coef1.c2 * curve.v2.y;
            const p1z =
                coef1.c0 * curve.v0.z +
                coef1.c1 * curve.v1.z +
                coef1.c2 * curve.v2.z;

            const p2x =
                coef2.c0 * curve.v0.x +
                coef2.c1 * curve.v1.x +
                coef2.c2 * curve.v2.x;
            const p2y =
                coef2.c0 * curve.v0.y +
                coef2.c1 * curve.v1.y +
                coef2.c2 * curve.v2.y;
            const p2z =
                coef2.c0 * curve.v0.z +
                coef2.c1 * curve.v1.z +
                coef2.c2 * curve.v2.z;

            const vIdx1 = (baseIdx + i * 2) * 3;
            const vIdx2 = (baseIdx + i * 2 + 1) * 3;

            posAttr.array[vIdx1] = p1x;
            posAttr.array[vIdx1 + 1] = p1y;
            posAttr.array[vIdx1 + 2] = p1z;

            posAttr.array[vIdx2] = p2x;
            posAttr.array[vIdx2 + 1] = p2y;
            posAttr.array[vIdx2 + 2] = p2z;

            colorAttr.array[vIdx1] = edgeColor.r;
            colorAttr.array[vIdx1 + 1] = edgeColor.g;
            colorAttr.array[vIdx1 + 2] = edgeColor.b;
            colorAttr.array[vIdx2] = edgeColor.r;
            colorAttr.array[vIdx2 + 1] = edgeColor.g;
            colorAttr.array[vIdx2 + 2] = edgeColor.b;

            alphaAttr.array[baseIdx + i * 2] = edgeOpacity;
            alphaAttr.array[baseIdx + i * 2 + 1] = edgeOpacity;
        }

        if (needsUpdateAttribute) {
            posAttr.needsUpdate = true;
            colorAttr.needsUpdate = true;
            alphaAttr.needsUpdate = true;
        }

        // Update cone
        if (
            edgeData &&
            edgeData.cone &&
            edgeData.cone.instanceId !== undefined
        ) {
            // Midpoint at t = 0.5: 0.25 * v0 + 0.5 * v1 + 0.25 * v2
            const midX =
                0.25 * curve.v0.x + 0.5 * curve.v1.x + 0.25 * curve.v2.x;
            const midY =
                0.25 * curve.v0.y + 0.5 * curve.v1.y + 0.25 * curve.v2.y;
            const midZ =
                0.25 * curve.v0.z + 0.5 * curve.v1.z + 0.25 * curve.v2.z;
            this._scratchVec3_1.set(midX, midY, midZ);

            // Tangent direction at t = 0.5: v2 - v0
            this._scratchVec3_2.subVectors(curve.v2, curve.v0).normalize();

            this._scratchMatrix.makeTranslation(
                this._scratchVec3_1.x,
                this._scratchVec3_1.y,
                this._scratchVec3_1.z,
            );
            this._scratchMatrix.lookAt(
                this._scratchVec3_1,
                this._scratchVec3_3
                    .copy(this._scratchVec3_1)
                    .add(this._scratchVec3_2),
                this._upVec,
            );
            this.coneInstancedMesh.setMatrixAt(
                edgeData.cone.instanceId,
                this._scratchMatrix,
            );
            this.coneInstancedMesh.setColorAt(
                edgeData.cone.instanceId,
                edgeColor,
            );
            if (needsUpdateAttribute) {
                this.coneInstancedMesh.instanceMatrix.needsUpdate = true;
                if (this.coneInstancedMesh.instanceColor) {
                    this.coneInstancedMesh.instanceColor.needsUpdate = true;
                }
            }

            edgeData.cone.position.copy(this._scratchVec3_1);
        }

        this.edgeLineSegments.geometry.setDrawRange(
            0,
            this.edgeBufferIndexMap.size * this.maxEdgeSegments * 2,
        );
    }

    _renderEdge(link, layoutScale, maxWeight) {
        this._initSharedGeometries();

        const edgeId = `${link.fromId}->${link.toId}`;
        if (this.edgeBufferIndexMap.has(edgeId)) return;

        this._graphDirtySinceLastFakeLinks = true;
        const edgeIndex = this.edgeBufferIndexMap.size;
        if (edgeIndex >= this.maxEdgeCapacity) return;

        this.edgeBufferIndexMap.set(edgeId, edgeIndex);

        const sPosRaw = this.layout.getNodePosition(link.fromId);
        const tPosRaw = this.layout.getNodePosition(link.toId);

        const seed = link
            ? NetworkVisualizer._hashString(link.fromId) +
              NetworkVisualizer._hashString(link.toId)
            : 0;

        const curve = this._updateEdgeCurve(
            this._scratchCurve,
            sPosRaw,
            tPosRaw,
            layoutScale,
            seed,
        );

        const normWeight = Math.min(1, link.data.weight / maxWeight);
        const weightBucket = Math.round(normWeight * 100);

        const edgeColor = this._getEdgeColor(normWeight);
        const edgeOpacity = 0.4 + normWeight * 0.6;

        let coneMat = this.coneMaterialPool.get(weightBucket);
        if (!coneMat) {
            coneMat = new THREE.MeshBasicMaterial({
                color: edgeColor,
                transparent: true,
                opacity: Math.max(0.2, edgeOpacity),
            });
            this.coneMaterialPool.set(weightBucket, coneMat);
        }

        // Midpoint at t = 0.5: 0.25 * v0 + 0.5 * v1 + 0.25 * v2
        const midX = 0.25 * curve.v0.x + 0.5 * curve.v1.x + 0.25 * curve.v2.x;
        const midY = 0.25 * curve.v0.y + 0.5 * curve.v1.y + 0.25 * curve.v2.y;
        const midZ = 0.25 * curve.v0.z + 0.5 * curve.v1.z + 0.25 * curve.v2.z;
        this._scratchVec3_1.set(midX, midY, midZ);
        const arrowPos = this._scratchVec3_1;

        // Tangent direction at t = 0.5: v2 - v0
        this._scratchVec3_2.subVectors(curve.v2, curve.v0).normalize();
        const arrowDir = this._scratchVec3_2;

        const coneInstanceId = this.edgeInstanceIdMap.size;
        if (coneInstanceId < this.maxEdgeCapacity) {
            this.edgeInstanceIdMap.set(edgeId, coneInstanceId);
            this.instanceIdEdgeMap.set(coneInstanceId, edgeId);

            this._scratchMatrix.makeTranslation(
                arrowPos.x,
                arrowPos.y,
                arrowPos.z,
            );
            this._scratchMatrix.lookAt(
                arrowPos,
                this._scratchVec3_3.copy(arrowPos).add(arrowDir),
                this._upVec,
            );
            this.coneInstancedMesh.setMatrixAt(
                coneInstanceId,
                this._scratchMatrix,
            );
            this.coneInstancedMesh.setColorAt(coneInstanceId, coneMat.color);
            this.coneInstancedMesh.instanceMatrix.needsUpdate = true;
            if (this.coneInstancedMesh.instanceColor) {
                this.coneInstancedMesh.instanceColor.needsUpdate = true;
            }
            this.coneInstancedMesh.count = coneInstanceId + 1;
        }

        const edgeData = {
            // Keep a dummy line for test compatibility and raycasting metadata
            line: {
                userData: {
                    type: 'edge',
                    sourceId: link.fromId,
                    targetId: link.toId,
                    weight: link.data.weight,
                    origMaterial: {
                        color: edgeColor.clone(),
                        opacity: edgeOpacity,
                    },
                },
                material: {
                    color: edgeColor.clone(),
                    opacity: edgeOpacity,
                },
                geometry: {
                    attributes: {
                        position: { array: new Float32Array(0) },
                    },
                },
            },
            cone: {
                userData: { origMaterial: coneMat },
                material: coneMat,
                position: arrowPos.clone(),
                instanceId: coneInstanceId,
            },
            sourceId: link.fromId,
            targetId: link.toId,
            link: link,
            seed: seed,
        };
        this.edges.push(edgeData);
        this.edgeMap.set(edgeId, edgeData);

        this._updateEdgeBuffer(edgeId, link, layoutScale, maxWeight);
    }

    _renderEdges(graph, layoutScale, maxWeight) {
        this._initSharedGeometries();
        graph.forEachLink((link) => {
            if (link.data && link.data.isFake) return;
            this._renderEdge(link, layoutScale, maxWeight);
        });
    }

    async buildVisualization(graph) {
        this.clear();
        this.graph = graph;

        const isLayoutComplete = await this._computeLayout(graph);

        if (!isLayoutComplete) return;

        const layoutScale = 10.0;

        let maxDegree = 1;
        graph.forEachNode((node) => {
            const degree = (node.data && node.data.degree) || 1;
            if (degree > maxDegree) maxDegree = degree;
        });
        this.maxDegree = maxDegree;

        let maxWeight = 1;
        graph.forEachLink((link) => {
            if (link.data.weight > maxWeight) maxWeight = link.data.weight;
        });
        this.maxWeight = maxWeight;

        this._renderNodes(graph, layoutScale, maxDegree);
        this._renderEdges(graph, layoutScale, maxWeight);

        // Ensure new materials reflect the currently active theme immediately
        this.setTheme(this.currentThemeName);

        this.fitCameraToGraph();

        this.startAutoTour();
        this.startAnimationLoop();
    }

    fitCameraToGraph() {
        if (this.nodes.size === 0) return;

        this.stopAutoTour();

        this.camera.up.set(0, 1, 0); // Reset to default Y-up

        this._updateAutoTourBounds();

        let radius = this.graphRadius;
        if (isNaN(radius) || radius <= 0 || !isFinite(radius)) {
            radius = 100; // Safe default for incremental mode starting empty
        }

        let frustumSize = radius * 2 * 1.01; // Add 1% padding

        const aspect = this.container.clientWidth / this.container.clientHeight;

        // Adjust for aspect ratio if window is taller than it is wide
        if (aspect < 1) {
            frustumSize /= aspect;
        }

        // Update camera frustum and reset zoom
        this.baseFrustumSize = frustumSize;
        const d = frustumSize / 2;
        this.camera.left = -d * aspect;
        this.camera.right = d * aspect;
        this.camera.top = d;
        this.camera.bottom = -d;
        this.camera.zoom = 1; // Reset zoom from any previous user interaction
        this.camera.updateProjectionMatrix();

        // Set camera to an angled perspective to showcase the 3D structure
        const viewDist = radius * 2.5;

        this.controls.target.copy(this.graphCenter);
        this.camera.position.set(
            this.graphCenter.x + viewDist * 0.5,
            this.graphCenter.y + viewDist * 0.4,
            this.graphCenter.z + viewDist * 0.8,
        );
        this.controls.update();
    }

    _clearNodeHoverState(obj) {
        const nodeData = this.nodes.get(obj.userData.id);
        if (!nodeData) return;
        const isPlaying = nodeData.playCount > 0;

        if (isPlaying) {
            // Update dummy mesh for tests
            obj.material.emissive = this.highlightColor;
            obj.material.emissiveIntensity = 1.0;

            this.nodeInstancedMesh.setColorAt(
                nodeData.instanceId,
                this._scratchColor
                    .set(this.highlightColor)
                    .multiplyScalar(this.highlightIntensity),
            );
        } else {
            // Update dummy mesh for tests
            obj.material.emissive = nodeData.baseColor;
            obj.material.emissiveIntensity = 0.2;

            this._scratchColor.setHex(nodeData.baseColor);
            this.nodeInstancedMesh.setColorAt(
                nodeData.instanceId,
                this._scratchColor,
            );
        }
        if (this.nodeInstancedMesh.instanceColor) {
            this.nodeInstancedMesh.instanceColor.needsUpdate = true;
        }
    }

    _clearEdgeHoverState(obj) {
        const edgeId = `${obj.userData.sourceId}->${obj.userData.targetId}`;
        const edgeData = this.edgeMap.get(edgeId);
        if (!edgeData) return;

        const link = edgeData.link;
        if (link) {
            this._updateEdgeBuffer(
                edgeId,
                link,
                this.layoutScale,
                this.maxWeight,
            );
        }
    }

    _clearHoverObjectState(obj) {
        if (obj.userData.type === 'node') {
            this._clearNodeHoverState(obj);
        } else if (obj.userData.type === 'edge') {
            this._clearEdgeHoverState(obj);
        }
    }

    _applyHoverObjectState(obj) {
        if (obj.userData.type === 'node') {
            const nodeData = this.nodes.get(obj.userData.id);
            if (nodeData) {
                // Update dummy mesh for tests
                obj.material.emissiveIntensity = 0.8;
                obj.material.emissive = 0xffffff;

                this.nodeInstancedMesh.setColorAt(
                    nodeData.instanceId,
                    this._scratchColor
                        .set(0xffffff)
                        .multiplyScalar(this.highlightIntensity),
                );
                if (this.nodeInstancedMesh.instanceColor) {
                    this.nodeInstancedMesh.instanceColor.needsUpdate = true;
                }
            }
        } else if (obj.userData.type === 'edge') {
            const edgeId = `${obj.userData.sourceId}->${obj.userData.targetId}`;
            const edgeData = this.edgeMap.get(edgeId);
            if (edgeData) {
                const link = edgeData.link;
                if (link) {
                    this._updateEdgeBuffer(
                        edgeId,
                        link,
                        this.layoutScale,
                        this.maxWeight,
                    );
                }
            }
        }
    }

    _updateHoverState(target) {
        if (this.hoveredObject !== target) {
            if (this.hoveredObject) {
                const prevObj = this.hoveredObject;
                this.hoveredObject = null; // Clear it first so that redraw functions (like _getEdgeVisualProperties) know it's no longer hovered
                this._clearHoverObjectState(prevObj);
            }

            this.hoveredObject = target;

            if (this.hoveredObject) {
                this._applyHoverObjectState(this.hoveredObject);
            }

            if (this.onHover) {
                this.onHover(
                    this.hoveredObject ? this.hoveredObject.userData : null,
                );
            }
        }
    }

    _updateFakeLinks() {
        if (!this.graph || !this.layout) return;
        if (!this._graphDirtySinceLastFakeLinks) return;
        this._graphDirtySinceLastFakeLinks = false;

        // 1. Remove previously added fake links
        const fakeLinksToRemove = [];
        this.graph.forEachLink((link) => {
            if (link.data && link.data.isFake) {
                fakeLinksToRemove.push(link);
            }
        });
        for (let i = 0; i < fakeLinksToRemove.length; i++) {
            const link = fakeLinksToRemove[i];
            if (this.graph.removeLink) {
                this.graph.removeLink(link);
            } else if (this.graph.removeEdge) {
                this.graph.removeEdge(link);
            }
        }

        // 2. Identify isolated components
        const components = [];
        const visited = new Set();

        this.graph.forEachNode((node) => {
            if (visited.has(node.id)) return;
            const comp = [];
            const queue = [node.id];
            visited.add(node.id);

            let head = 0;
            while (head < queue.length) {
                const cur = queue[head++];
                comp.push(cur);
                this.graph.forEachLinkedNode(cur, (linkedNode) => {
                    if (!visited.has(linkedNode.id)) {
                        visited.add(linkedNode.id);
                        queue.push(linkedNode.id);
                    }
                });
            }
            components.push(comp);
        });

        if (components.length <= 1) return;

        // 3. Sort components by size descending
        components.sort((a, b) => b.length - a.length);
        const mainComp = components[0];

        // 4. Find the highest degree node in the main component to act as the central anchor
        let anchorNodeId = mainComp[0];
        let maxDeg = -1;
        for (let i = 0; i < mainComp.length; i++) {
            const nodeId = mainComp[i];
            const node = this.graph.getNode(nodeId);
            const degree = (node.data && node.data.degree) || 0;
            if (degree > maxDeg) {
                maxDeg = degree;
                anchorNodeId = nodeId;
            }
        }

        // 5. Link the isolated components to this central anchor
        for (let i = 1; i < components.length; i++) {
            const targetNodeId = components[i][0];
            this.graph.addLink(anchorNodeId, targetNodeId, {
                isFake: true,
                weight: 5, // Strong pull to pack them tightly
            });
        }
    }

    _updateNodePositions() {
        for (let i = 0; i < this.nodeList.length; i++) {
            const nodeData = this.nodeList[i];
            const pos = this.layout.getNodePosition(nodeData.id);
            const degree = nodeData.degree || 1;
            const normDegree = Math.min(1, degree / this.maxDegree);
            const scale = 3 + normDegree * 15;

            this._scratchMatrix.makeTranslation(
                pos.x * this.layoutScale,
                pos.y * this.layoutScale,
                pos.z * this.layoutScale,
            );
            this._scratchMatrix.scale(
                this._scratchVec3_1.set(scale, scale, scale),
            );

            this.nodeInstancedMesh.setMatrixAt(
                nodeData.instanceId,
                this._scratchMatrix,
            );
            this.outlineInstancedMesh.setMatrixAt(
                nodeData.instanceId,
                this._scratchMatrix,
            );

            // Update dummy mesh position for tests/auto-tour
            nodeData.mesh.position.x = pos.x * this.layoutScale;
            nodeData.mesh.position.y = pos.y * this.layoutScale;
            nodeData.mesh.position.z = pos.z * this.layoutScale;
        }

        this.nodeInstancedMesh.instanceMatrix.needsUpdate = true;
        this.outlineInstancedMesh.instanceMatrix.needsUpdate = true;
    }

    _updateEdgePositions() {
        for (let i = 0; i < this.edges.length; i++) {
            const edgeData = this.edges[i];
            const link = edgeData.link;
            if (link) {
                this._updateEdgeBuffer(
                    `${edgeData.sourceId}->${edgeData.targetId}`,
                    link,
                    this.layoutScale,
                    this.maxWeight,
                    false, // Defer attribute updates
                );
            }
        }

        // Batch update GPU attributes once for all edges
        if (this.edgeLineSegments && this.edges.length > 0) {
            const posAttr = this.edgeLineSegments.geometry.attributes.position;
            const colorAttr = this.edgeLineSegments.geometry.attributes.color;
            const alphaAttr = this.edgeLineSegments.geometry.attributes.alpha;
            if (posAttr) posAttr.needsUpdate = true;
            if (colorAttr) colorAttr.needsUpdate = true;
            if (alphaAttr) alphaAttr.needsUpdate = true;
        }

        if (this.coneInstancedMesh && this.edges.length > 0) {
            this.coneInstancedMesh.instanceMatrix.needsUpdate = true;
            if (this.coneInstancedMesh.instanceColor) {
                this.coneInstancedMesh.instanceColor.needsUpdate = true;
            }
        }
    }

    _updatePositionsFromLayout() {
        if (!this.layout) return;

        this._updateNodePositions();
        this._updateEdgePositions();

        if (this.autoTour) {
            this._updateAutoTourBounds();
        }
    }

    _updateAutoTourBounds() {
        // Update bounding box and center for auto-tour
        if (this.nodes.size > 0) {
            this.graphBoundingBox.makeEmpty();
            for (let i = 0; i < this.nodeList.length; i++) {
                this.graphBoundingBox.expandByPoint(
                    this.nodeList[i].mesh.position,
                );
            }

            // Use geometric center instead of average to balance the view
            this.graphBoundingBox.getCenter(this.graphCenter);

            const size = this._scratchVec3_2;
            this.graphBoundingBox.getSize(size);

            // radius is half of the diagonal, ensures sphere contains the box
            let radius = size.length() * 0.5;

            if (isNaN(radius) || radius <= 0 || !isFinite(radius)) {
                radius = 100;
            }
            // Add padding so outer nodes don't clip bounds
            this.graphRadius = radius + 2;
        }
    }

    _shouldSkipFrame(time) {
        if (document.visibilityState === 'hidden') {
            this._lastFrameTime = time;
            return true;
        }

        // Skip heavy rendering and raycasting if the visualization is completely empty
        if (
            !this.graph &&
            this.effects.activeEmojis.length === 0 &&
            this.nodes.size === 0
        ) {
            this._lastFrameTime = time;
            return true;
        }

        return false;
    }

    _handleRaycasting(time) {
        // Raycast if mouse moved, or if camera/layout is active (to keep hover accurate as things move)
        const isInteracting =
            this.mouseMoved ||
            (this.mouse.x !== -1000 &&
                (this.autoTour ||
                    (this.incrementalMode && this.layout && !this.isPaused)));

        if (
            isInteracting &&
            time - this._lastRaycastTime > this._raycastThrottleMs
        ) {
            this._performRaycast();
            this._lastRaycastTime = time;
        }
    }

    animate(time) {
        if (!this._isAnimating) return;
        this._animationFrameId = requestAnimationFrame(this.animate);

        if (this.onBeforeFrame) {
            this.onBeforeFrame();
        }

        if (this._shouldSkipFrame(time)) {
            return;
        }

        const delta =
            this.isPaused || !this._lastFrameTime
                ? 0
                : (time - this._lastFrameTime) / 1000;
        this._lastFrameTime = time;
        this._frameCount++;

        this._stepIncrementalPhysics();

        if (this.controls) {
            this.controls.update();
        }

        this._handleRaycasting(time);

        if (
            this.nodeInstancedMesh &&
            this.nodeInstancedMesh.material.userData.uTime
        ) {
            this.nodeInstancedMesh.material.userData.uTime.value += delta;
        }

        if (this.nodeShader) {
            this.nodeShader.uniforms.uTime.value += delta;
        }

        const frequencyData = this.audioSource
            ? this.audioSource.getFrequencyData()
            : null;
        this.effects.update(delta, frequencyData, this.graphCenter);
        this._updateAutoTour(delta);
        this.composer.render();
    }

    _stepIncrementalPhysics() {
        if (this.incrementalMode && this.layout && !this.isPaused) {
            if (!this._isMobile || this._frameCount % 2 === 0) {
                if (this._frameCount % 60 === 0) {
                    this._updateFakeLinks();
                }
                this.layout.step();
                this._updatePositionsFromLayout();
            }
        }
    }

    _updateObjectsToIntersect() {
        this._objectsToIntersect.length = 0;
        if (this.nodeInstancedMesh) {
            this._objectsToIntersect.push(this.nodeInstancedMesh);
        }
        if (this.coneInstancedMesh) {
            this._objectsToIntersect.push(this.coneInstancedMesh);
        }
        if (this.edgeLineSegments) {
            this._objectsToIntersect.push(this.edgeLineSegments);
        }
        for (let i = 0; i < this.pickableObjects.length; i++) {
            if (this.pickableObjects[i]) {
                this._objectsToIntersect.push(this.pickableObjects[i]);
            }
        }
    }

    _resolveRaycastTarget(intersects) {
        if (intersects.length === 0) return null;

        const intersect = intersects[0];
        if (intersect.object === this.nodeInstancedMesh) {
            const instanceId = intersect.instanceId;
            const nodeId = this.instanceIdNodeMap.get(instanceId);
            const nodeData = this.nodes.get(nodeId);
            return nodeData ? nodeData.mesh : null;
        } else if (intersect.object === this.coneInstancedMesh) {
            const instanceId = intersect.instanceId;
            const edgeId = this.instanceIdEdgeMap.get(instanceId);
            const edgeData = this.edgeMap.get(edgeId);
            return edgeData ? edgeData.line : null;
        } else if (intersect.object === this.edgeLineSegments) {
            const vertexIndex = intersect.index;
            const edgeIndex = Math.floor(
                vertexIndex / (this.maxEdgeSegments * 2),
            );
            const edgeId = this.instanceIdEdgeMap.get(edgeIndex);
            const edgeData = this.edgeMap.get(edgeId);
            return edgeData ? edgeData.line : null;
        }
        return intersect.object;
    }

    _performRaycast() {
        this.camera.updateMatrixWorld();
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const intersects = this.raycaster.intersectObjects(
            this._objectsToIntersect,
            false,
        );

        const target = this._resolveRaycastTarget(intersects);

        this._updateHoverState(target);
        this.mouseMoved = false;
    }

    _updateAutoTour(delta) {
        if (this.autoTour && this.graphCenter) {
            this.autoTourTime += delta;
            this.tourSpeedChangeTimer -= delta;

            if (this.tourSpeedChangeTimer <= 0) {
                this.tourTargetVelocity.set(
                    Math.random() * 0.4 - 0.2,
                    Math.random() * 0.4 - 0.2,
                    Math.random() * 0.4 - 0.2,
                );
                this.tourSpeedChangeTimer = 8.0 + Math.random() * 4.0;
            }

            this.tourCurrentVelocity.lerp(this.tourTargetVelocity, delta * 0.5);

            const frameRotation = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(
                    this.tourCurrentVelocity.x * delta,
                    this.tourCurrentVelocity.y * delta,
                    this.tourCurrentVelocity.z * delta,
                    'XYZ',
                ),
            );

            this.tourRotation.multiply(frameRotation);

            const radius = this.graphRadius * 3;
            const offset = new THREE.Vector3(0, 0, radius).applyQuaternion(
                this.tourRotation,
            );

            this._scratchVec3_1.copy(this.graphCenter).add(offset);
            this.currentTourTarget.lerp(this.graphCenter, delta * 2.0);
            this.controls.target.copy(this.currentTourTarget);

            this.camera.position.lerp(this._scratchVec3_1, delta * 1.5);

            const upVector = new THREE.Vector3(0, 1, 0).applyQuaternion(
                this.tourRotation,
            );
            this.camera.up.copy(upVector);

            this.camera.lookAt(this.currentTourTarget);
            this.camera.updateMatrixWorld();

            // Calculate tightest zoom based on current camera rotation.
            // We project all nodes into camera space to find the tightest width/height.
            let minX = Infinity,
                maxX = -Infinity;
            let minY = Infinity,
                maxY = -Infinity;

            const viewMatrix = this.camera.matrixWorldInverse;
            const tempVec = this._scratchVec3_2;

            for (let i = 0; i < this.nodeList.length; i++) {
                tempVec
                    .copy(this.nodeList[i].mesh.position)
                    .applyMatrix4(viewMatrix);
                minX = Math.min(minX, tempVec.x);
                maxX = Math.max(maxX, tempVec.x);
                minY = Math.min(minY, tempVec.y);
                maxY = Math.max(maxY, tempVec.y);
            }

            const width = Math.max(0.1, maxX - minX);
            const height = Math.max(0.1, maxY - minY);

            // Target zoom to fit this bounding box, with 10% padding for comfort
            const padding = 1.1;
            const targetZoomX =
                (this.camera.right - this.camera.left) / (width * padding);
            const targetZoomY =
                (this.camera.top - this.camera.bottom) / (height * padding);

            let targetZoom = Math.min(targetZoomX, targetZoomY);

            // Cap zoom to prevent extreme close-ups on single nodes or empty graphs
            targetZoom = Math.min(targetZoom, 10.0);

            this.camera.zoom += (targetZoom - this.camera.zoom) * delta * 2.0;
            this.camera.updateProjectionMatrix();
        } else {
            this.controls.update();
        }
    }

    showInstrumentEmoji(nodeId, emoji) {
        const nodeData = this.nodes.get(nodeId);
        if (!nodeData) return;

        this.effects.showInstrumentEmoji(nodeData.mesh.position, emoji);
        this.startAnimationLoop();
    }

    _highlightNode(nodeId, highlightColor) {
        const nodeData = this.nodes.get(nodeId);
        if (nodeData) {
            if (!nodeData.playCount) nodeData.playCount = 0;
            nodeData.playCount++;
            this.playingNodes.add(nodeData);

            if (
                nodeData.playCount === 1 &&
                this.hoveredObject !== nodeData.mesh
            ) {
                // Update dummy mesh for tests
                nodeData.mesh.material.emissiveIntensity = 1.0;
                nodeData.mesh.material.emissive = highlightColor;

                this.nodeInstancedMesh.setColorAt(
                    nodeData.instanceId,
                    this._scratchColor
                        .set(highlightColor)
                        .multiplyScalar(this.highlightIntensity),
                );
                if (this.nodeInstancedMesh.instanceColor) {
                    this.nodeInstancedMesh.instanceColor.needsUpdate = true;
                }
            }
        }
    }

    _highlightEdge(prevNodeId, nodeId) {
        if (!prevNodeId) return;
        const edgeId = `${prevNodeId}->${nodeId}`;
        const edgeData = this.edgeMap.get(edgeId);
        if (edgeData) {
            if (!edgeData.playCount) edgeData.playCount = 0;
            edgeData.playCount++;
            this.playingEdges.add(edgeData);

            const link = edgeData.link;
            if (link) {
                this._updateEdgeBuffer(
                    edgeId,
                    link,
                    this.layoutScale,
                    this.maxWeight,
                );
            }
        }
    }

    highlightPlayingElement(nodeId, prevNodeId) {
        this._highlightNode(nodeId, this.highlightColor);
        const normPrev =
            prevNodeId !== undefined && prevNodeId !== null ? prevNodeId : null;
        if (normPrev !== null) {
            this._highlightEdge(normPrev, nodeId);
        }
    }

    _releaseNode(nodeId) {
        const nodeData = this.nodes.get(nodeId);
        if (nodeData && nodeData.playCount > 0) {
            nodeData.playCount--;
            if (nodeData.playCount === 0) {
                this.playingNodes.delete(nodeData);
                if (this.hoveredObject !== nodeData.mesh) {
                    // Update dummy mesh for tests
                    nodeData.mesh.material.emissiveIntensity = 0.2;
                    nodeData.mesh.material.emissive = nodeData.baseColor;

                    this._scratchColor.setHex(nodeData.baseColor);
                    this.nodeInstancedMesh.setColorAt(
                        nodeData.instanceId,
                        this._scratchColor,
                    );
                    if (this.nodeInstancedMesh.instanceColor) {
                        this.nodeInstancedMesh.instanceColor.needsUpdate = true;
                    }
                }
            }
        }
    }

    _releaseEdge(prevNodeId, nodeId) {
        if (!prevNodeId) return;
        const edgeId = `${prevNodeId}->${nodeId}`;
        const edgeData = this.edgeMap.get(edgeId);
        if (edgeData && edgeData.playCount > 0) {
            edgeData.playCount--;
            if (edgeData.playCount === 0) {
                this.playingEdges.delete(edgeData);
                const link = edgeData.link;
                if (link) {
                    this._updateEdgeBuffer(
                        edgeId,
                        link,
                        this.layoutScale,
                        this.maxWeight,
                    );
                }
            }
        }
    }

    releasePlayingElement(nodeId, prevNodeId) {
        this._releaseNode(nodeId);
        const normPrev =
            prevNodeId !== undefined && prevNodeId !== null ? prevNodeId : null;
        if (normPrev !== null) {
            this._releaseEdge(normPrev, nodeId);
        }
    }

    resetPlayingHighlights() {
        for (const nodeData of this.playingNodes.values()) {
            nodeData.playCount = 0;
            if (this.hoveredObject !== nodeData.mesh) {
                // Update dummy mesh for tests
                nodeData.mesh.material.emissiveIntensity = 0.2;
                nodeData.mesh.material.emissive = nodeData.baseColor;

                this._scratchColor.setHex(nodeData.baseColor);
                this.nodeInstancedMesh.setColorAt(
                    nodeData.instanceId,
                    this._scratchColor,
                );
            }
        }
        if (this.nodeInstancedMesh && this.nodeInstancedMesh.instanceColor) {
            this.nodeInstancedMesh.instanceColor.needsUpdate = true;
        }
        this.playingNodes.clear();

        for (const edgeData of this.playingEdges.values()) {
            edgeData.playCount = 0;
            const edgeId = `${edgeData.sourceId}->${edgeData.targetId}`;
            const link = edgeData.link;
            if (link) {
                this._updateEdgeBuffer(
                    edgeId,
                    link,
                    this.layoutScale,
                    this.maxWeight,
                );
            }
        }
        this.playingEdges.clear();
    }

    startAutoTour() {
        if (this.autoTour) return;
        this.autoTour = true;
        this.autoTourTime = 0;
        this.tourCurrentVelocity.set(0, 0, 0);
        this.tourTargetVelocity.set(0, 0, 0);
        this.tourSpeedChangeTimer = 0; // Trigger immediately

        // Capture current state to transition smoothly
        this.currentTourTarget = this.controls.target.clone();

        // Initialize the rotation quaternion based on current camera offset
        const offset = new THREE.Vector3().subVectors(
            this.camera.position,
            this.currentTourTarget,
        );

        // We calculate a base rotation. Assuming default is looking down Z.
        const defaultLook = new THREE.Vector3(0, 0, 1);
        this.tourRotation.setFromUnitVectors(
            defaultLook,
            offset.clone().normalize(),
        );

        if (this.onTourChange) this.onTourChange(true);
    }

    stopAutoTour() {
        if (!this.autoTour) return;
        this.autoTour = false;
        if (this.onTourChange) this.onTourChange(false);
    }

    setPaused(paused) {
        this.isPaused = paused;
    }

    _updateThemeNodeColors() {
        const currentTheme = this.themeManager.getCurrentTheme();
        for (let i = 0; i < this.nodeList.length; i++) {
            const nodeData = this.nodeList[i];
            const pitchClass = Utils.noteToSemitone(nodeData.id) % 12;
            let hue, saturation, lightness;

            if (currentTheme && currentTheme.getNodeColor) {
                ({ hue, saturation, lightness } = currentTheme.getNodeColor(
                    pitchClass,
                    Utils,
                ));
            } else {
                hue = pitchClass / 12;
                saturation = 1.0;
                lightness = 0.5;
            }

            nodeData.baseColor = this._scratchColor
                .setHSL(hue, saturation, lightness)
                .getHex();

            // Only update instance color if the node is not currently highlighted
            if (
                nodeData.playCount === 0 &&
                this.hoveredObject !== nodeData.mesh
            ) {
                if (this.nodeInstancedMesh) {
                    this._scratchColor.setHex(nodeData.baseColor);
                    this.nodeInstancedMesh.setColorAt(
                        nodeData.instanceId,
                        this._scratchColor,
                    );
                }
            }
        }

        if (this.nodeInstancedMesh && this.nodeInstancedMesh.instanceColor) {
            this.nodeInstancedMesh.instanceColor.needsUpdate = true;
        }
    }

    _updateThemeBloom(themeName) {
        if (this.bloomEffect) {
            this.bloomEffect.intensity =
                themeName === 'constellation' ? 5.5 : 3.0;
        }
    }

    _updateNodeMaterialThemeProperties(theme, themeName) {
        if (!this.nodeInstancedMesh) return;

        const mat = this.nodeInstancedMesh.material;
        mat.roughness = theme.nodeMaterial.roughness;
        mat.metalness = theme.nodeMaterial.metalness;
        mat.emissiveIntensity = theme.nodeMaterial.emissiveIntensity;
        mat.wireframe = !!theme.nodeMaterial.wireframe;
        mat.transparent = themeName === 'constellation';
        mat.blending = THREE.NormalBlending;
        mat.depthWrite = true;
        mat.needsUpdate = true;

        if (mat.userData && mat.userData.uIsConstellation) {
            mat.userData.uIsConstellation.value =
                themeName === 'constellation' ? 1.0 : 0.0;
        }
    }

    setTheme(themeName) {
        const oldTheme = this.themeManager.getCurrentTheme();
        if (oldTheme && oldTheme.onDeactivate) {
            oldTheme.onDeactivate(this);
        }

        this.themeManager.setTheme(themeName);
        this.currentThemeName = themeName;
        const theme = this.themeManager.getCurrentTheme();

        // Update CSS theme attribute
        if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-theme', themeName);
        }

        this.highlightColor = theme.highlightColor;
        this.highlightEdgeMaterial.color.setHex(this.highlightColor);
        this.highlightConeMaterial.color.setHex(this.highlightColor);

        this._updateResolution();
        this._updateThemeNodeColors(themeName);

        const targetSegments = theme.geometrySegments || 32;
        if (targetSegments !== this._currentGeometrySegments) {
            this._reinitGeometries(targetSegments);
        }

        if (this.outlineInstancedMesh) {
            this.outlineInstancedMesh.visible = theme.showOutlines !== false;
        }

        this._updateNodeMaterialThemeProperties(theme, themeName);

        if (this.nodeShader && this.nodeShader.uniforms.uIsConstellation) {
            this.nodeShader.uniforms.uIsConstellation.value =
                themeName === 'constellation' ? 1.0 : 0.0;
        }

        this._updateThemeBloom(themeName);

        if (this.coneInstancedMesh) {
            this.coneInstancedMesh.material.emissiveIntensity =
                theme.nodeMaterial.emissiveIntensity + 0.05;
            this.coneInstancedMesh.material.wireframe =
                !!theme.nodeMaterial.wireframe;
            this.coneInstancedMesh.material.needsUpdate = true;
        }

        if (this.edgeLineSegments) {
            this.edgeLineSegments.material.transparent = true;
            this.edgeLineSegments.material.opacity = theme.nodeMaterial
                .wireframe
                ? 0.4
                : 1.0;
        }

        this.renderer.setClearColor(theme.background);

        if (theme.onActivate) {
            theme.onActivate(this);
        }

        // Refresh existing highlights with new color
        this.resetPlayingHighlights();
        this._updateAllVisualScales();
    }

    cycleTheme() {
        const nextTheme = this.themeManager.cycleTheme();
        this.setTheme(nextTheme);
        return nextTheme;
    }

    dispose() {
        this.stopAnimationLoop();
        this.stopAutoTour();

        if (this.controls) {
            this.controls.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
            if (
                this.renderer.domElement &&
                this.renderer.domElement.parentElement
            ) {
                this.renderer.domElement.parentElement.removeChild(
                    this.renderer.domElement,
                );
            }
        }

        if (this.composer) {
            this.composer.dispose();
        }

        if (this.layout) {
            this.layout.dispose();
        }

        this.clear();

        window.removeEventListener('resize', this._onWindowResize);
        this.container.removeEventListener(
            'pointermove',
            this._onPointerInteraction,
        );
        this.container.removeEventListener(
            'pointerdown',
            this._onPointerInteraction,
        );
        this.container.removeEventListener(
            'pointerleave',
            this._onPointerLeave,
        );
    }
}

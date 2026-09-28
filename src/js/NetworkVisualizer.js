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

const charcoalSketchFragmentShader = `
uniform float uTime;
uniform float uPaneAngle;
uniform vec2 uPaneCenter;
uniform vec2 uPaneSize;
uniform float uPaneYaw;
uniform float uPanePitch;
uniform float uPaneWidth;
uniform float uFPS;
uniform float uJitterStrength;
uniform vec2 uResolution;

float hash2D(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash2D(i + vec2(0.0, 0.0)), hash2D(i + vec2(1.0, 0.0)), u.x),
        mix(hash2D(i + vec2(0.0, 1.0)), hash2D(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // 1. Aspect ratio correction to prevent shearing/squashing as the box rotates
    float aspect = uResolution.x / uResolution.y;
    vec2 aspectUv = vec2(uv.x * aspect, uv.y);
    vec2 aspectCenter = vec2(uPaneCenter.x * aspect, uPaneCenter.y);
    vec2 centeredUv = aspectUv - aspectCenter;

    // 2. Apply 3D Perspective Rotation (Yaw / Pitch) assuming z = 0 initially
    float x_rot = centeredUv.x * cos(uPaneYaw);
    float y_rot = centeredUv.y * cos(uPanePitch) - centeredUv.x * sin(uPaneYaw) * sin(uPanePitch);
    float z_rot = centeredUv.y * sin(uPanePitch) + centeredUv.x * sin(uPaneYaw) * cos(uPanePitch);

    // Perspective projection back to 2D screen plane
    float focalDistance = 1.8; // Perspective intensity strength (smaller = more dramatic tilt)
    float w = 1.0 - z_rot / focalDistance;
    vec2 projected = vec2(x_rot, y_rot) / w;

    // 3. Apply 2D Z-axis rotation to the projected coordinates
    float cosTheta = cos(uPaneAngle);
    float sinTheta = sin(uPaneAngle);
    vec2 dUv = vec2(
        projected.x * cosTheta + projected.y * sinTheta,
        -projected.x * sinTheta + projected.y * cosTheta
    );

    // 4. Calculate 2D Box Signed Distance Field (SDF) using the projected/transformed coords
    vec2 d = abs(dUv) - uPaneSize * 0.5;
    float outsideDist = length(max(d, 0.0));
    float insideDist = min(max(d.x, d.y), 0.0);
    float sdf = outsideDist + insideDist;

    // Determine if we are inside the portal or within the sketchy border thickness
    bool isInside = (sdf <= 0.0);
    bool isBorder = (abs(sdf) <= uPaneWidth);

    if (!isInside && !isBorder) {
        outputColor = inputColor;
        return;
    }

    // 5. Render the Charcoal Drawing / Pencil Sketch effect!
    float sketchTime = floor(uTime * uFPS) / uFPS;
    
    // Smooth, continuous coordinate wiggling
    // Raised spatial frequency (45.0) to slightly break outline coherence for a scribbled hand-drawn look
    float n1 = noise2D(uv * 45.0 + sketchTime * 8.0);
    float n2 = noise2D(uv * 45.0 - sketchTime * 11.0);
    vec2 jitter = vec2(n1 - 0.5, n2 - 0.5) * uJitterStrength;
    vec2 jitterUv = uv + jitter;

    vec4 texColor = texture2D(inputBuffer, jitterUv);
    float gray = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));

    float texelX = 1.0 / uResolution.x;
    float texelY = 1.0 / uResolution.y;

    float g00 = dot(texture2D(inputBuffer, jitterUv + vec2(-texelX, -texelY)).rgb, vec3(0.299, 0.587, 0.114));
    float g10 = dot(texture2D(inputBuffer, jitterUv + vec2(0.0, -texelY)).rgb, vec3(0.299, 0.587, 0.114));
    float g20 = dot(texture2D(inputBuffer, jitterUv + vec2(texelX, -texelY)).rgb, vec3(0.299, 0.587, 0.114));
    float g01 = dot(texture2D(inputBuffer, jitterUv + vec2(-texelX, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float g21 = dot(texture2D(inputBuffer, jitterUv + vec2(texelX, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float g02 = dot(texture2D(inputBuffer, jitterUv + vec2(-texelX, texelY)).rgb, vec3(0.299, 0.587, 0.114));
    float g12 = dot(texture2D(inputBuffer, jitterUv + vec2(0.0, texelY)).rgb, vec3(0.299, 0.587, 0.114));
    float g22 = dot(texture2D(inputBuffer, jitterUv + vec2(texelX, texelY)).rgb, vec3(0.299, 0.587, 0.114));

    float sx = (g20 + 2.0 * g21 + g22) - (g00 + 2.0 * g01 + g02);
    float sy = (g02 + 2.0 * g12 + g22) - (g00 + 2.0 * g10 + g20);
    float edge = sqrt(sx * sx + sy * sy);

    // B. Create a high-frequency, multi-layered stroke mask to vary the transparency of outlines and details
    float mask1 = noise2D(jitterUv * 130.0 + sketchTime * 5.0);
    float mask2 = noise2D(jitterUv * 260.0 - sketchTime * 8.5);
    float strokeMask = smoothstep(0.3, 0.7, (mask1 + mask2 * 0.5) / 1.5);
    
    // Multiply edge detection by the stroke mask to elegantly break up lines and make them freeform & minimal
    // Widened smoothstep bounds (0.08 to 0.45) for rich variance in stroke transparency based on edge strength
    float edgeStroke = smoothstep(0.08, 0.45, edge) * strokeMask;

    float paper = noise2D(uv * 400.0) * 0.12 + 0.88;
    
    // C. Blend outlines with soft charcoal grey (0.22) rather than hard black, keeping strokes beautifully light
    float outlineColor = mix(gray, 0.22, edgeStroke * 0.75);

    // D. Soft minimal shading in shadowed areas
    float shadeNoise = noise2D(jitterUv * 200.0 + vec2(sketchTime, -sketchTime) * 2.0);
    float shadedGray = outlineColor;
    if (outlineColor < 0.8) {
        float shadeFactor = smoothstep(0.8, 0.2, outlineColor) * strokeMask;
        shadedGray = mix(outlineColor, outlineColor * (0.6 + 0.4 * shadeNoise), shadeFactor * 0.55);
    }

    // E. Calm contrast mapping to preserve soft midtones and graphite texture
    float sketchColor = smoothstep(0.01, 0.99, shadedGray * paper);

    vec3 finalSketch = vec3(sketchColor);

    // 6. Render a sketchy charcoal frame outline
    if (isBorder && !isInside) {
        float borderStroke = noise2D(uv * 300.0 + sketchTime * 5.0) * 0.4 + 0.6;
        float edgeOutline = smoothstep(uPaneWidth, uPaneWidth * 0.3, abs(sdf)) * borderStroke;
        finalSketch = mix(finalSketch, vec3(0.05), edgeOutline); // Rich charcoal stroke
        outputColor = vec4(finalSketch, 1.0);
    } else {
        outputColor = vec4(finalSketch, 1.0);
    }
}
`;

class CharcoalSketchEffect extends Effect {
    constructor() {
        super('CharcoalSketchEffect', charcoalSketchFragmentShader, {
            uniforms: new Map([
                ['uTime', new THREE.Uniform(0)],
                ['uPaneAngle', new THREE.Uniform(0)],
                ['uPaneCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
                ['uPaneSize', new THREE.Uniform(new THREE.Vector2(0.75, 0.55))],
                ['uPaneYaw', new THREE.Uniform(0)],
                ['uPanePitch', new THREE.Uniform(0)],
                ['uPaneWidth', new THREE.Uniform(0.015)],
                ['uFPS', new THREE.Uniform(5.0)],
                ['uJitterStrength', new THREE.Uniform(0.0035)],
                [
                    'uResolution',
                    new THREE.Uniform(new THREE.Vector2(1024, 768)),
                ],
            ]),
        });
    }

    update(renderer, inputBuffer, deltaTime) {
        const uTimeUniform = this.uniforms.get('uTime');
        uTimeUniform.value += deltaTime;
        const time = uTimeUniform.value;

        // Slow, elegant rotation (e.g. rotating the portal window)
        this.uniforms.get('uPaneAngle').value = time * 0.25;

        // Sweep horizontally from left to right and back to show wide glimpses of both worlds (slightly slower)
        const center = this.uniforms.get('uPaneCenter').value;
        center.x = 0.5 + 0.42 * Math.sin(time * 0.22); // Sweeps between 0.08 and 0.92 (slower)
        center.y = 0.5 + 0.05 * Math.cos(time * 0.12); // Gentle vertical float (slower)

        // Focused breathing scale of the portal's dimensions (scaled up again)
        const size = this.uniforms.get('uPaneSize').value;
        size.x = 0.75 + 0.08 * Math.sin(time * 0.3);
        size.y = 0.55 + 0.05 * Math.cos(time * 0.5);

        // Animate 3D tilt (yaw and pitch oscillations)
        this.uniforms.get('uPaneYaw').value = 0.45 * Math.sin(time * 0.4);
        this.uniforms.get('uPanePitch').value = 0.3 * Math.cos(time * 0.6);

        const res = this.uniforms.get('uResolution').value;
        if (inputBuffer) {
            res.set(inputBuffer.width, inputBuffer.height);
        }
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
        this.charcoalSketchPass = null;
        this.charcoalSketchEffect = null;
        this.retroCRTPass = null;
        this._lastSketchFrame = -1;

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
        this._constellationEdgeLow = new THREE.Color(0x0a1630); // Very subtle dark midnight blue
        this._constellationEdgeHigh = new THREE.Color(0x182c50); // Slightly lighter subtle blue for higher weights
        this._takeOnMeEdgeLow = new THREE.Color(0xd0e8eb); // Soft blue-grey pastel teal
        this._takeOnMeEdgeHigh = new THREE.Color(0x5cb3b1); // Vibrant pastel turquoise

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
        this._scratchQuat_1 = new THREE.Quaternion();
        this._scratchEuler = new THREE.Euler();

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
        this.edgeTubeInstancedMesh = null;
        this.edgeTubeGeo = null;

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
        const isConstellation = this.currentThemeName === 'constellation';
        const targetType = isConstellation
            ? THREE.HalfFloatType
            : THREE.UnsignedByteType;

        this.composer = new EffectComposer(this.renderer, {
            frameBufferType: targetType,
        });
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

    _updateComposerBufferType(themeName) {
        const isConstellation = themeName === 'constellation';
        const targetType = isConstellation
            ? THREE.HalfFloatType
            : THREE.UnsignedByteType;

        if (this.composer) {
            const buffer =
                this.composer.inputBuffer || this.composer.writeBuffer;
            const currentType = buffer
                ? buffer.texture.type
                : THREE.UnsignedByteType;
            if (currentType === targetType) {
                // Buffer format did not change (e.g. default <-> take-on-me-real), but we still update the existing bloom effect properties dynamically
                this._updateThemeBloom(themeName);
                return;
            }
        }

        // Dispose of old composer and bloom effect to prevent memory leaks and clear WebGL buffer states completely
        const disposeResource = (res) => {
            if (res && typeof res.dispose === 'function') {
                res.dispose();
            }
        };
        disposeResource(this.composer);
        disposeResource(this.bloomEffect);
        this.bloomEffect = null;

        // Recreate composer with target format
        this.composer = new EffectComposer(this.renderer, {
            frameBufferType: targetType,
        });

        this.composer.addPass(new RenderPass(this.scene, this.camera));

        // Create a brand new BloomEffect with appropriate baseline intensity to fully reset WebGL textures
        const themeConfig = {
            constellation: { intensity: 5.5, threshold: 0.15 },
            'take-on-me-real': { intensity: 1.0, threshold: 0.9 },
            default: { intensity: 3.0, threshold: 0.15 },
        };
        const config = themeConfig[themeName] || themeConfig.default;

        this.bloomEffect = new BloomEffect({
            intensity: config.intensity,
            luminanceThreshold: config.threshold,
            luminanceSmoothing: 0.85,
            mipmapBlur: true,
        });

        this.composer.addPass(new EffectPass(this.camera, this.bloomEffect));

        if (this.retroCRTPass && this.effects && this.effects.retroMode) {
            this.composer.addPass(this.retroCRTPass);
        }

        if (this.charcoalSketchPass && themeName === 'take-on-me-real') {
            this.composer.addPass(this.charcoalSketchPass);
        }
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
        if (this.edgeTubeInstancedMesh) {
            this.edgeTubeInstancedMesh.count = 0;
            this.edgeTubeInstancedMesh.instanceMatrix.needsUpdate = true;
            if (this.edgeTubeInstancedMesh.instanceColor) {
                this.edgeTubeInstancedMesh.instanceColor.needsUpdate = true;
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
                        transformed *= 0.45;
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
                        
                        // 1. Detect if the node is active/highlighted (HDR color length > 2.0)
                        float isHighlighted = 0.0;
                        #ifdef USE_COLOR
                            isHighlighted = step(2.0, length(vColor.rgb));
                        #endif

                        // 2. High-Detail Bubbling Plasma (3 octaves of FBM noise)
                        vec2 st1 = normal.xy * 3.0 + vec2(uTime * 0.15, uTime * -0.1);
                        vec2 st2 = normal.xy * 6.0 + vec2(uTime * -0.1, uTime * 0.2);
                        vec2 st3 = normal.xy * 12.0 + vec2(uTime * 0.25, uTime * 0.25);
                        
                        float p1 = noise_fire(st1);
                        float p2 = noise_fire(st2);
                        float p3 = noise_fire(st3);
                        float plasma = p1 * 0.5 + p2 * 0.3 + p3 * 0.2;
                        
                        // 3. High-Density Opaque Core + Fuzzy Outer Corona (Normal Blending)
                        // This makes the core completely opaque to block internal connections!
                        float starAlpha = smoothstep(0.0, 0.45, viewAlign);
                        
                        vec3 starColor = vec3(1.0, 1.0, 1.0);
                        #ifdef USE_COLOR
                            starColor = normalize(vColor.rgb);
                        #endif
                        
                        // 4. Detailed Plasma Color
                        vec3 plasmaColor = mix(starColor, vec3(1.0, 1.0, 1.0), plasma * 0.2);
                        vec3 hotCore = mix(plasmaColor, vec3(1.0, 1.0, 1.0), pow(viewAlign, 6.0) * 0.4);
                        
                        // 5. Dynamic Luminosity (Inactive is brighter, active gets a massive boost!)
                        float emissiveBoost = 0.95 + isHighlighted * 2.05;
                        totalEmissiveRadiance = hotCore * starAlpha * emissiveBoost;
                        
                        // 6. Beautiful Fresnel Corona Outer Edge (Wider and brighter when active!)
                        float rimExponent = mix(3.5, 2.0, isHighlighted);
                        float rimIntensity = mix(0.4, 2.2, isHighlighted);
                        float rim = pow(1.0 - viewAlign, rimExponent);
                        vec3 rimColor = starColor * rim * rimIntensity;
                        totalEmissiveRadiance += rimColor;
                        
                        // 7. Four-Way Lens Flare Diffraction Spikes (Burst forth when active!)
                        float spikeH = exp(-abs(normal.y) * 45.0) * exp(-abs(normal.x) * 1.5);
                        float spikeV = exp(-abs(normal.x) * 45.0) * exp(-abs(normal.y) * 1.5);
                        float spike = (spikeH + spikeV) * viewAlign;
                        vec3 spikeColor = (starColor + vec3(0.5)) * spike * isHighlighted * 3.5;
                        totalEmissiveRadiance += spikeColor;
                        
                        // Set the final transparency (Corona & Spikes expand when active)
                        float finalAlpha = max(starAlpha, rim * (0.95 + isHighlighted * 0.05));
                        finalAlpha = max(finalAlpha, spike * isHighlighted * 0.95);
                        diffuseColor.a = finalAlpha;
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

            // Tube geometry and instanced mesh for thick edges
            this.edgeTubeGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
            const tubeMat = new THREE.MeshStandardMaterial({
                roughness: 0.1,
                metalness: 0.05,
                emissive: 0xffffff,
                emissiveIntensity: 0.45,
            });
            tubeMat.onBeforeCompile = (shader) => {
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

            this.edgeTubeInstancedMesh = new THREE.InstancedMesh(
                this.edgeTubeGeo,
                tubeMat,
                this.maxEdgeCapacity * this.maxEdgeSegments,
            );
            this.edgeTubeInstancedMesh.instanceMatrix.setUsage(
                THREE.DynamicDrawUsage,
            );
            if (this.edgeTubeInstancedMesh.instanceColor) {
                this.edgeTubeInstancedMesh.instanceColor.setUsage(
                    THREE.DynamicDrawUsage,
                );
            }
            this.edgeTubeInstancedMesh.userData.type = 'edge-tube-batch';
            this.edgeTubeInstancedMesh.frustumCulled = false;
            this.edgeTubeInstancedMesh.visible =
                this.currentThemeName === 'take-on-me-real';
            this.edgeTubeInstancedMesh.geometry.boundingSphere =
                new THREE.Sphere(new THREE.Vector3(), 100000);
            this.graphGroup.add(this.edgeTubeInstancedMesh);
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
        disposeMesh(this.edgeTubeInstancedMesh);
        this.edgeTubeInstancedMesh = null;

        if (this.sphereGeo) this.sphereGeo.dispose();
        if (this.outlineGeo) this.outlineGeo.dispose();
        if (this.coneGeo) this.coneGeo.dispose();
        if (this.edgeTubeGeo) this.edgeTubeGeo.dispose();

        this.sphereGeo = null;
        this.outlineGeo = null;
        this.coneGeo = null;
        this.edgeTubeGeo = null;

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
            if (this.edgeTubeInstancedMesh) {
                this.edgeTubeInstancedMesh.count =
                    this.edges.length * this.maxEdgeSegments;
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

        const pitchClass = ((Utils.noteToSemitone(node.id) % 12) + 12) % 12;
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

    _getEdgeColor(normWeight, forceOriginalColor = false) {
        if (this.currentThemeName === 'constellation' && !forceOriginalColor) {
            return this._scratchColor
                .copy(this._constellationEdgeLow)
                .lerp(this._constellationEdgeHigh, normWeight);
        }

        if (
            this.currentThemeName === 'take-on-me-real' &&
            !forceOriginalColor
        ) {
            return this._scratchColor
                .copy(this._takeOnMeEdgeLow)
                .lerp(this._takeOnMeEdgeHigh, normWeight);
        }

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
            const currentTheme = this.themeManager.getCurrentTheme();
            if (currentTheme && currentTheme.name === 'constellation') {
                // Pass true for forceOriginalColor to preserve the original highlight color/effect
                edgeColor = this._getEdgeColor(normWeight, true).multiplyScalar(
                    this.highlightIntensity * 1.5,
                );
            } else {
                edgeColor = this._scratchColor
                    .set(this.highlightColor)
                    .multiplyScalar(this.highlightIntensity);
            }
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

    _updateEdgeTubeSegment(
        edgeIndex,
        i,
        p1x,
        p1y,
        p1z,
        p2x,
        p2y,
        p2z,
        edgeColor,
    ) {
        if (!this.edgeTubeInstancedMesh) return;

        const instanceId = edgeIndex * this.maxEdgeSegments + i;

        this._scratchVec3_1.set(p1x, p1y, p1z);
        this._scratchVec3_2.set(p2x, p2y, p2z);

        const direction = this._scratchVec3_3.subVectors(
            this._scratchVec3_2,
            this._scratchVec3_1,
        );
        const length = direction.length();
        const normDir = direction.normalize();

        const alignAxis = this._scratchVec3_4.set(0, 1, 0);
        const quaternion = this._scratchQuat_1.setFromUnitVectors(
            alignAxis,
            normDir,
        );

        const midpoint = this._scratchVec3_5
            .addVectors(this._scratchVec3_1, this._scratchVec3_2)
            .multiplyScalar(0.5);

        const radius = this._currentEdgeTubeRadius || 0.4;
        const scale = this._scratchVec3_3.set(radius, length, radius);

        this._scratchMatrix.compose(midpoint, quaternion, scale);
        this.edgeTubeInstancedMesh.setMatrixAt(instanceId, this._scratchMatrix);
        this.edgeTubeInstancedMesh.setColorAt(instanceId, edgeColor);
    }

    _updateEdgeCone(edgeData, curve, edgeColor, needsUpdateAttribute) {
        if (!edgeData.cone || edgeData.cone.instanceId === undefined) return;

        // Midpoint at t = 0.5: 0.25 * v0 + 0.5 * v1 + 0.25 * v2
        const midX = 0.25 * curve.v0.x + 0.5 * curve.v1.x + 0.25 * curve.v2.x;
        const midY = 0.25 * curve.v0.y + 0.5 * curve.v1.y + 0.25 * curve.v2.y;
        const midZ = 0.25 * curve.v0.z + 0.5 * curve.v1.z + 0.25 * curve.v2.z;
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
        this.coneInstancedMesh.setColorAt(edgeData.cone.instanceId, edgeColor);
        if (needsUpdateAttribute) {
            this._updateMeshNeedsUpdate(this.coneInstancedMesh);
        }

        edgeData.cone.position.copy(this._scratchVec3_1);
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

            if (
                this.edgeTubeInstancedMesh &&
                this.edgeTubeInstancedMesh.visible
            ) {
                this._updateEdgeTubeSegment(
                    edgeIndex,
                    i,
                    p1x,
                    p1y,
                    p1z,
                    p2x,
                    p2y,
                    p2z,
                    edgeColor,
                );
            }
        }

        if (needsUpdateAttribute) {
            posAttr.needsUpdate = true;
            colorAttr.needsUpdate = true;
            alphaAttr.needsUpdate = true;
            if (
                this.edgeTubeInstancedMesh &&
                this.edgeTubeInstancedMesh.visible
            ) {
                this._updateMeshNeedsUpdate(this.edgeTubeInstancedMesh);
            }
        }

        // Update cone
        this._updateEdgeCone(edgeData, curve, edgeColor, needsUpdateAttribute);

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

        if (this.edgeTubeInstancedMesh) {
            this.edgeTubeInstancedMesh.count =
                this.edges.length * this.maxEdgeSegments;
        }

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

    _updateLineSegmentsNeedsUpdate() {
        if (!this.edgeLineSegments || this.edges.length === 0) return;
        const geom = this.edgeLineSegments.geometry;
        if (geom.attributes.position)
            geom.attributes.position.needsUpdate = true;
        if (geom.attributes.color) geom.attributes.color.needsUpdate = true;
        if (geom.attributes.alpha) geom.attributes.alpha.needsUpdate = true;
    }

    _updateMeshNeedsUpdate(mesh) {
        if (!mesh) return;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
        }
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

        this._updateLineSegmentsNeedsUpdate();

        if (this.edges.length > 0) {
            this._updateMeshNeedsUpdate(this.coneInstancedMesh);
            if (
                this.edgeTubeInstancedMesh &&
                this.edgeTubeInstancedMesh.visible
            ) {
                this._updateMeshNeedsUpdate(this.edgeTubeInstancedMesh);
            }
        }
    }

    _updatePositionsFromLayout() {
        if (!this.layout) return;

        this._updateNodePositions();
        this._updateEdgePositions();

        if (this.nodes.size > 0) {
            this.graphBoundingBox.makeEmpty();
            for (let i = 0; i < this.nodeList.length; i++) {
                this.graphBoundingBox.expandByPoint(
                    this.nodeList[i].mesh.position,
                );
            }
            this.graphBoundingBox.getCenter(this.graphCenter);
            this.graphRadius = this.graphBoundingBox.getBoundingSphere(
                this._scratchSphere,
            ).radius;

            if (this.effects) {
                this.effects.updateStudioPosition(
                    this.graphCenter,
                    this.graphRadius,
                );
            }
        }

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

    _updateAudioReactiveJitter(frequencyData) {
        if (
            !this.charcoalSketchEffect ||
            this.currentThemeName !== 'take-on-me-real'
        ) {
            return;
        }

        const uTime = this.charcoalSketchEffect.uniforms.get('uTime').value;
        const currentFrame = Math.floor(uTime * 5.0); // Clamped to 5.0 FPS (matches uFPS)

        // Only update the wiggling amplitude when a new stop-motion sketch cell triggers!
        // This eliminates 60fps high-frequency vibrations and guarantees a chunky, solid traditional 5fps stop-motion feel
        if (currentFrame !== this._lastSketchFrame) {
            this._lastSketchFrame = currentFrame;

            let bassEnergy = 0;
            if (frequencyData && frequencyData.length > 0) {
                const bassCount = Math.max(
                    1,
                    Math.floor(frequencyData.length * 0.2),
                );
                let bassSum = 0;
                for (let i = 0; i < bassCount; i++) {
                    bassSum += frequencyData[i] / 255.0;
                }
                bassEnergy = bassSum / bassCount;
            }
            // Base jitter is 0.0028, wiggles up to 0.0083 with bass energy!
            const targetJitter = 0.0028 + bassEnergy * 0.0055;
            this.charcoalSketchEffect.uniforms.get('uJitterStrength').value =
                targetJitter;
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
        this.effects.update(
            delta,
            frequencyData,
            this.graphCenter,
            this.graphRadius,
        );

        this._updateAudioReactiveJitter(frequencyData);

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
        if (this.edgeTubeInstancedMesh) {
            this._objectsToIntersect.push(this.edgeTubeInstancedMesh);
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
        } else if (intersect.object === this.edgeTubeInstancedMesh) {
            const instanceId = intersect.instanceId;
            const edgeIndex = Math.floor(instanceId / this.maxEdgeSegments);
            const edgeId = this.instanceIdEdgeMap.get(edgeIndex);
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

            const frameRotation = this._scratchQuat_1.setFromEuler(
                this._scratchEuler.set(
                    this.tourCurrentVelocity.x * delta,
                    this.tourCurrentVelocity.y * delta,
                    this.tourCurrentVelocity.z * delta,
                    'XYZ',
                ),
            );

            this.tourRotation.multiply(frameRotation);

            const radius = this.graphRadius * 3;
            const offset = this._scratchVec3_3
                .set(0, 0, radius)
                .applyQuaternion(this.tourRotation);

            this._scratchVec3_1.copy(this.graphCenter).add(offset);
            this.currentTourTarget.lerp(this.graphCenter, delta * 2.0);
            this.controls.target.copy(this.currentTourTarget);

            this.camera.position.lerp(this._scratchVec3_1, delta * 1.5);

            const upVector = this._scratchVec3_4
                .set(0, 1, 0)
                .applyQuaternion(this.tourRotation);
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

    _applyNodeHighlight(nodeData, highlightColor) {
        const currentTheme = this.themeManager.getCurrentTheme();
        const useBaseColor =
            currentTheme && currentTheme.name === 'constellation';
        const colorToUse = useBaseColor ? nodeData.baseColor : highlightColor;
        const intensityToUse = useBaseColor
            ? this.highlightIntensity * 1.5
            : this.highlightIntensity;

        // Update dummy mesh for tests
        nodeData.mesh.material.emissiveIntensity = useBaseColor ? 1.5 : 1.0;
        nodeData.mesh.material.emissive = colorToUse;

        this.nodeInstancedMesh.setColorAt(
            nodeData.instanceId,
            this._scratchColor.set(colorToUse).multiplyScalar(intensityToUse),
        );
        if (this.nodeInstancedMesh.instanceColor) {
            this.nodeInstancedMesh.instanceColor.needsUpdate = true;
        }
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
                this._applyNodeHighlight(nodeData, highlightColor);
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
            const pitchClass =
                ((Utils.noteToSemitone(nodeData.id) % 12) + 12) % 12;
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
            if (themeName === 'constellation') {
                this.bloomEffect.intensity = 5.5;
                if (this.bloomEffect.luminanceMaterial) {
                    this.bloomEffect.luminanceMaterial.threshold = 0.15;
                }
            } else if (themeName === 'take-on-me-real') {
                this.bloomEffect.intensity = 1.0;
                if (this.bloomEffect.luminanceMaterial) {
                    this.bloomEffect.luminanceMaterial.threshold = 0.9;
                }
            } else {
                this.bloomEffect.intensity = 3.0;
                if (this.bloomEffect.luminanceMaterial) {
                    this.bloomEffect.luminanceMaterial.threshold = 0.15;
                }
            }
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

    _updateThemeCones(theme) {
        if (this.coneInstancedMesh) {
            this.coneInstancedMesh.material.emissiveIntensity =
                theme.nodeMaterial.emissiveIntensity + 0.05;
            this.coneInstancedMesh.material.wireframe =
                !!theme.nodeMaterial.wireframe;
            this.coneInstancedMesh.material.needsUpdate = true;
        }
    }

    _updateThemeEdgesVisibility(themeName, theme) {
        const isTakeOnMeReal = themeName === 'take-on-me-real';

        if (this.edgeLineSegments) {
            this.edgeLineSegments.visible = !isTakeOnMeReal;
            this.edgeLineSegments.material.transparent = true;
            this.edgeLineSegments.material.opacity = theme.nodeMaterial
                .wireframe
                ? 0.4
                : 1.0;
        }

        if (this.edgeTubeInstancedMesh) {
            this.edgeTubeInstancedMesh.visible = isTakeOnMeReal;
            this.edgeTubeInstancedMesh.material.roughness =
                theme.nodeMaterial.roughness !== undefined
                    ? theme.nodeMaterial.roughness
                    : 0.1;
            this.edgeTubeInstancedMesh.material.metalness =
                theme.nodeMaterial.metalness !== undefined
                    ? theme.nodeMaterial.metalness
                    : 0.05;
            this.edgeTubeInstancedMesh.material.emissiveIntensity =
                theme.nodeMaterial.emissiveIntensity !== undefined
                    ? theme.nodeMaterial.emissiveIntensity
                    : 0.45;
            this.edgeTubeInstancedMesh.material.wireframe =
                !!theme.nodeMaterial.wireframe;
            this.edgeTubeInstancedMesh.material.needsUpdate = true;
        }
    }

    setTheme(themeName) {
        const oldTheme = this.themeManager.getCurrentTheme();
        if (oldTheme && oldTheme.onDeactivate) {
            oldTheme.onDeactivate(this);
        }

        this.themeManager.setTheme(themeName);
        this.currentThemeName = themeName;
        this._updateComposerBufferType(themeName);
        const theme = this.themeManager.getCurrentTheme();
        this._currentEdgeTubeRadius = theme.edgeTubeRadius || 0.4;

        // Update CSS theme attribute
        if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-theme', themeName);
        }

        this.highlightColor = theme.highlightColor;
        this.highlightEdgeMaterial.color.setHex(this.highlightColor);
        this.highlightConeMaterial.color.setHex(this.highlightColor);

        this._updateResolution();

        const targetSegments = theme.geometrySegments || 32;
        if (targetSegments !== this._currentGeometrySegments) {
            this._reinitGeometries(targetSegments);
        }

        this._updateThemeEdgesVisibility(themeName, theme);
        this._updateThemeNodeColors(themeName);

        // Reset and update highlights for all currently active/playing nodes under the new theme
        for (const nodeData of this.playingNodes) {
            this._applyNodeHighlight(nodeData, this.highlightColor);
        }

        this._updateEdgePositions();

        if (this.outlineInstancedMesh) {
            this.outlineInstancedMesh.visible = theme.showOutlines !== false;
        }

        this._updateNodeMaterialThemeProperties(theme, themeName);

        if (this.nodeShader && this.nodeShader.uniforms.uIsConstellation) {
            this.nodeShader.uniforms.uIsConstellation.value =
                themeName === 'constellation' ? 1.0 : 0.0;
        }

        this._updateThemeBloom(themeName);
        this._updateThemeCones(theme);

        if (themeName === 'take-on-me-real') {
            if (!this.charcoalSketchPass) {
                this.charcoalSketchEffect = new CharcoalSketchEffect();
                this.charcoalSketchPass = new EffectPass(
                    this.camera,
                    this.charcoalSketchEffect,
                );
            }
            this.composer.addPass(this.charcoalSketchPass);
        } else if (this.charcoalSketchPass) {
            this.composer.removePass(this.charcoalSketchPass);
        }

        this.renderer.setClearColor(theme.background);

        if (theme.onActivate) {
            theme.onActivate(this);
        }

        // Refresh existing highlights with new color
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

        if (this.charcoalSketchPass) {
            this.charcoalSketchPass.dispose();
            this.charcoalSketchPass = null;
            this.charcoalSketchEffect = null;
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

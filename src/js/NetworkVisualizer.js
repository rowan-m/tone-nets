import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import {
    EffectComposer,
    RenderPass,
    EffectPass,
    BloomEffect,
} from 'postprocessing';
import { Utils } from './Utils.js';
import { NetworkLayout } from './NetworkLayout.js';
import { VisualEffectsManager } from './VisualEffectsManager.js';

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
        this.edges = [];
        this.edgeMap = new Map();
        this.pickableObjects = [];
        this.hoveredObject = null;
        this.layout = null;
        this.graphGroup = new THREE.Group();
        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Line.threshold = 5;
        this.mouse = new THREE.Vector2(-1000, -1000);
        this.mouseMoved = false;
        this.onHover = null;

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
        this.emojiTextureCache = new Map();

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

        this._scratchMatrix = new THREE.Matrix4();

        this.initThree();
        this.initPostProcessing();
        this.animate = this.animate.bind(this);
        this._isAnimating = false;
        this._animationFrameId = null;
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

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 2);
        this.scene.add(directionalLight);

        window.addEventListener('resize', () => {
            const aspect =
                this.container.clientWidth / this.container.clientHeight;
            const d = this.baseFrustumSize / 2;
            this.camera.left = -d * aspect;
            this.camera.right = d * aspect;
            this.camera.top = d;
            this.camera.bottom = -d;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(
                this.container.clientWidth,
                this.container.clientHeight,
            );
            this.composer.setSize(
                this.container.clientWidth,
                this.container.clientHeight,
            );
        });

        this.container.addEventListener('pointermove', (e) => {
            const rect = this.container.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this.mouseMoved = true;
        });

        this.container.addEventListener('pointerleave', () => {
            this.mouse.set(-1000, -1000);
            this.mouseMoved = true;
        });
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
        this.edges = [];
        this.edgeMap.clear();
        this.playingNodes.clear();
        this.playingEdges.clear();
        this.pickableObjects = [];
        this.graph = null;
        this.incrementalMode = false;
        this.maxDegree = 1;
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

        this.fitCameraToGraph();
        this.startAutoTour();
        this.startAnimationLoop();
    }

    _initSharedGeometries() {
        if (!this.sphereGeo) {
            const sphereSegments = 20;
            this.sphereGeo = new THREE.SphereGeometry(
                1,
                sphereSegments,
                sphereSegments,
            );
            this.outlineGeo = new THREE.SphereGeometry(1.08, 12, 12);
            this.outlineMat = new THREE.MeshBasicMaterial({
                color: 0x000000,
                side: THREE.BackSide,
            });
            this.coneGeo = new THREE.ConeGeometry(1.2, 3.5, 8);
            this.coneGeo.rotateX(Math.PI / 2);

            // Initialize InstancedMeshes
            const nodeMat = new THREE.MeshStandardMaterial({
                roughness: 0.3,
                metalness: 0.2,
                emissive: 0xffffff,
                emissiveIntensity: 0.15, // Base glow for all nodes
            });
            // Inject instance-based emissive modulation
            nodeMat.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <emissivemap_fragment>',
                    `
                    #include <emissivemap_fragment>
                    #ifdef USE_INSTANCING_COLOR
                        totalEmissiveRadiance *= vInstanceColor.rgb;
                    #endif
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
                    #ifdef USE_INSTANCING_COLOR
                        totalEmissiveRadiance *= vInstanceColor.rgb;
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
            const link = this.graph.getLink(
                edgeData.sourceId,
                edgeData.targetId,
            );
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
        for (const id of this.nodes.keys()) {
            this._updateElementVisuals(id, 'node');
        }
        for (const id of this.edgeMap.keys()) {
            this._updateElementVisuals(id, 'edge');
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

        this._initSharedGeometries();

        const instanceId = this.nodeInstanceIdMap.size;
        if (instanceId >= this.maxNodeCapacity) return;

        this.nodeInstanceIdMap.set(node.id, instanceId);
        this.instanceIdNodeMap.set(instanceId, node.id);

        const pos = this.layout.getNodePosition(node.id);
        const degree = (node.data && node.data.degree) || 1;
        const normDegree = Math.min(1, degree / maxDegree);

        const pitchClass = Utils.noteToSemitone(node.id) % 12;
        const hue = pitchClass / 12;
        // Use full saturation (1.0) and medium lightness (0.5) for the most vibrant, pure colors
        const baseColor = new THREE.Color().setHSL(hue, 1.0, 0.5);

        const scale = 3 + normDegree * 15;
        this._scratchMatrix.makeTranslation(
            pos.x * layoutScale,
            pos.y * layoutScale,
            pos.z * layoutScale,
        );
        this._scratchMatrix.scale(this._scratchVec3_1.set(scale, scale, scale));

        this.nodeInstancedMesh.setMatrixAt(instanceId, this._scratchMatrix);
        this.nodeInstancedMesh.setColorAt(instanceId, baseColor);
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
                position: new THREE.Vector3(
                    pos.x * layoutScale,
                    pos.y * layoutScale,
                    pos.z * layoutScale,
                ),
                material: {
                    emissive: new THREE.Color(),
                    emissiveIntensity: 0.2,
                },
            },
        };
        this.nodes.set(node.id, nodeData);
    }

    _renderNodes(graph, layoutScale, maxDegree) {
        this._initSharedGeometries();
        graph.forEachNode((node) => {
            this._renderNode(node, layoutScale, maxDegree);
        });
    }

    static _hashString(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = (h << 5) - h + str.charCodeAt(i);
            h |= 0;
        }
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

        const dist = sPos.distanceTo(tPos);
        const midPoint = this._scratchVec3_1
            .copy(sPos)
            .add(tPos)
            .multiplyScalar(0.5);

        const edgeDir = this._scratchVec3_2.subVectors(tPos, sPos).normalize();
        const pickAxis =
            Math.abs(edgeDir.y) < 0.9
                ? this._upVec
                : this._scratchVec3_3.set(1, 0, 0);
        const perp = this._scratchVec3_3
            .crossVectors(edgeDir, pickAxis)
            .normalize();

        // Introduce organic variation by rotating the perpendicular vector around the edge direction.
        // We use the pre-computed seed to create a stable but unique rotation for each edge pair.
        const angle = (seed % 360) * (Math.PI / 180);
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

    _updateEdgeBuffer(edgeId, link, layoutScale, maxWeight) {
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
            const t1 = i / this.maxEdgeSegments;
            const t2 = (i + 1) / this.maxEdgeSegments;

            curve.getPoint(t1, this._scratchVec3_1);
            curve.getPoint(t2, this._scratchVec3_2);

            const vIdx1 = (baseIdx + i * 2) * 3;
            const vIdx2 = (baseIdx + i * 2 + 1) * 3;

            posAttr.array[vIdx1] = this._scratchVec3_1.x;
            posAttr.array[vIdx1 + 1] = this._scratchVec3_1.y;
            posAttr.array[vIdx1 + 2] = this._scratchVec3_1.z;

            posAttr.array[vIdx2] = this._scratchVec3_2.x;
            posAttr.array[vIdx2 + 1] = this._scratchVec3_2.y;
            posAttr.array[vIdx2 + 2] = this._scratchVec3_2.z;

            colorAttr.array[vIdx1] = edgeColor.r;
            colorAttr.array[vIdx1 + 1] = edgeColor.g;
            colorAttr.array[vIdx1 + 2] = edgeColor.b;
            colorAttr.array[vIdx2] = edgeColor.r;
            colorAttr.array[vIdx2 + 1] = edgeColor.g;
            colorAttr.array[vIdx2 + 2] = edgeColor.b;

            alphaAttr.array[baseIdx + i * 2] = edgeOpacity;
            alphaAttr.array[baseIdx + i * 2 + 1] = edgeOpacity;
        }

        posAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;

        // Update cone
        if (
            edgeData &&
            edgeData.cone &&
            edgeData.cone.instanceId !== undefined
        ) {
            curve.getPoint(0.5, this._scratchVec3_1);
            curve.getTangent(0.5, this._scratchVec3_2).normalize();

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
            this.coneInstancedMesh.instanceMatrix.needsUpdate = true;
            if (this.coneInstancedMesh.instanceColor) {
                this.coneInstancedMesh.instanceColor.needsUpdate = true;
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

        const tMid = 0.5;
        curve.getPoint(tMid, this._scratchVec3_1);
        const arrowPos = this._scratchVec3_1;
        curve.getTangent(tMid, this._scratchVec3_2).normalize();
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
            this.graphCenter.set(0, 0, 0);
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
            obj.material.emissive.setHex(this.highlightColor);
            obj.material.emissiveIntensity = 1.0;

            this.nodeInstancedMesh.setColorAt(
                nodeData.instanceId,
                this._scratchColor
                    .set(this.highlightColor)
                    .multiplyScalar(this.highlightIntensity),
            );
        } else {
            // Update dummy mesh for tests
            obj.material.emissive.copy(nodeData.baseColor);
            obj.material.emissiveIntensity = 0.2;

            this.nodeInstancedMesh.setColorAt(
                nodeData.instanceId,
                nodeData.baseColor,
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

        const link = this.graph.getLink(
            obj.userData.sourceId,
            obj.userData.targetId,
        );
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
                obj.material.emissive.setHex(0xffffff);

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
            const link = this.graph.getLink(
                obj.userData.sourceId,
                obj.userData.targetId,
            );
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

    _updateEmojis(delta) {
        // We want to float "up" relative to the screen, which is the camera's up vector
        this._cameraUp
            .set(0, 1, 0)
            .applyQuaternion(this.camera.quaternion)
            .normalize();

        const lifeStep = delta * 1.25; // Expire over ~0.8s
        const moveStep = delta * 30; // Move ~30 units/s

        for (let i = this.activeEmojis.length - 1; i >= 0; i--) {
            const emojiData = this.activeEmojis[i];
            emojiData.life -= lifeStep;

            if (emojiData.life <= 0) {
                this._recycleEmoji(i);
                continue;
            }

            // Move up relative to camera view
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

    _updateFakeLinks() {
        if (!this.graph || !this.layout) return;

        // 1. Remove previously added fake links
        const fakeLinksToRemove = [];
        this.graph.forEachLink((link) => {
            if (link.data && link.data.isFake) {
                fakeLinksToRemove.push(link);
            }
        });
        fakeLinksToRemove.forEach((link) => {
            if (this.graph.removeLink) {
                this.graph.removeLink(link);
            } else if (this.graph.removeEdge) {
                this.graph.removeEdge(link);
            }
        });

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
        mainComp.forEach((nodeId) => {
            const node = this.graph.getNode(nodeId);
            const degree = (node.data && node.data.degree) || 0;
            if (degree > maxDeg) {
                maxDeg = degree;
                anchorNodeId = nodeId;
            }
        });

        // 5. Link the isolated components to this central anchor
        for (let i = 1; i < components.length; i++) {
            const targetNodeId = components[i][0];
            this.graph.addLink(anchorNodeId, targetNodeId, {
                isFake: true,
                weight: 5, // Strong pull to pack them tightly
            });
        }
    }

    _updatePositionsFromLayout() {
        if (!this.layout) return;

        for (const [id, nodeData] of this.nodes.entries()) {
            const pos = this.layout.getNodePosition(id);
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
            nodeData.mesh.position.set(
                pos.x * this.layoutScale,
                pos.y * this.layoutScale,
                pos.z * this.layoutScale,
            );
        }

        this.nodeInstancedMesh.instanceMatrix.needsUpdate = true;
        this.outlineInstancedMesh.instanceMatrix.needsUpdate = true;

        for (let i = 0; i < this.edges.length; i++) {
            const edgeData = this.edges[i];
            const link = this.graph.getLink(
                edgeData.sourceId,
                edgeData.targetId,
            );
            if (link) {
                this._updateEdgeBuffer(
                    `${edgeData.sourceId}->${edgeData.targetId}`,
                    link,
                    this.layoutScale,
                    this.maxWeight,
                );
            }
        }

        this._updateAutoTourBounds();
    }

    _updateAutoTourBounds() {
        // Also update bounding box/center for auto-tour
        if (this.nodes.size > 0) {
            let sumX = 0,
                sumY = 0,
                sumZ = 0;
            for (const nodeData of this.nodes.values()) {
                sumX += nodeData.mesh.position.x;
                sumY += nodeData.mesh.position.y;
                sumZ += nodeData.mesh.position.z;
            }

            this.graphCenter.set(
                sumX / this.nodes.size,
                sumY / this.nodes.size,
                sumZ / this.nodes.size,
            );

            let maxDistSq = 0;
            for (const nodeData of this.nodes.values()) {
                const distSq = this.graphCenter.distanceToSquared(
                    nodeData.mesh.position,
                );
                if (distSq > maxDistSq) maxDistSq = distSq;
            }

            let radius = Math.sqrt(maxDistSq);
            if (isNaN(radius) || radius <= 0 || !isFinite(radius)) {
                radius = 100;
            }
            // Add padding so outer nodes don't clip bounds
            this.graphRadius = radius + 2;
        }
    }

    animate(time) {
        if (!this._isAnimating) return;
        this._animationFrameId = requestAnimationFrame(this.animate);

        if (document.visibilityState === 'hidden') {
            this._lastFrameTime = time;
            return;
        }

        // Skip heavy rendering and raycasting if the visualization is completely empty
        if (
            !this.graph &&
            this.effects.activeEmojis.length === 0 &&
            this.nodes.size === 0
        ) {
            this._lastFrameTime = time;
            return;
        }

        const delta =
            this.isPaused || !this._lastFrameTime
                ? 0
                : (time - this._lastFrameTime) / 1000;
        this._lastFrameTime = time;
        this._frameCount++;

        this._stepIncrementalPhysics();

        if (
            this.mouseMoved &&
            time - this._lastRaycastTime > this._raycastThrottleMs
        ) {
            this._performRaycast();
            this._lastRaycastTime = time;
        }

        this.effects.update(delta);
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

    _performRaycast() {
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const objectsToIntersect = [
            this.nodeInstancedMesh,
            this.edgeLineSegments,
            ...this.pickableObjects,
        ].filter(Boolean);

        const intersects = this.raycaster.intersectObjects(
            objectsToIntersect,
            false,
        );
        let target = null;
        if (intersects.length > 0) {
            const intersect = intersects[0];
            if (intersect.object === this.nodeInstancedMesh) {
                const instanceId = intersect.instanceId;
                const nodeId = this.instanceIdNodeMap.get(instanceId);
                const nodeData = this.nodes.get(nodeId);
                target = nodeData ? nodeData.mesh : null;
            } else if (intersect.object === this.edgeLineSegments) {
                const vertexIndex = intersect.index;
                const edgeIndex = Math.floor(
                    vertexIndex / (this.maxEdgeSegments * 2),
                );
                const edgeId = this.instanceIdEdgeMap.get(edgeIndex);
                const edgeData = this.edgeMap.get(edgeId);
                target = edgeData ? edgeData.line : null;
            } else {
                target = intersect.object;
            }
        }

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

            const aspect =
                this.container.clientWidth / this.container.clientHeight;

            const requiredFrustumSize =
                Math.max(
                    this.graphRadius * 2,
                    (this.graphRadius * 2) / aspect,
                ) * 1.01;

            const targetZoom = this.baseFrustumSize / requiredFrustumSize;

            this.camera.zoom += (targetZoom - this.camera.zoom) * delta * 2.0;
            this.camera.updateProjectionMatrix();

            this.camera.position.lerp(this._scratchVec3_1, delta * 1.5);

            const upVector = new THREE.Vector3(0, 1, 0).applyQuaternion(
                this.tourRotation,
            );
            this.camera.up.copy(upVector);

            this.camera.lookAt(this.currentTourTarget);
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
                nodeData.mesh.material.emissive.setHex(highlightColor);

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

            const link = this.graph.getLink(prevNodeId, nodeId);
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
        this._highlightEdge(prevNodeId, nodeId);
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
                    nodeData.mesh.material.emissive.copy(nodeData.baseColor);

                    this.nodeInstancedMesh.setColorAt(
                        nodeData.instanceId,
                        nodeData.baseColor,
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
                const link = this.graph.getLink(prevNodeId, nodeId);
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
        this._releaseEdge(prevNodeId, nodeId);
    }

    resetPlayingHighlights() {
        for (const nodeData of this.playingNodes.values()) {
            nodeData.playCount = 0;
            if (this.hoveredObject !== nodeData.mesh) {
                // Update dummy mesh for tests
                nodeData.mesh.material.emissiveIntensity = 0.2;
                nodeData.mesh.material.emissive.copy(nodeData.baseColor);

                this.nodeInstancedMesh.setColorAt(
                    nodeData.instanceId,
                    nodeData.baseColor,
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
            const link = this.graph.getLink(
                edgeData.sourceId,
                edgeData.targetId,
            );
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
}

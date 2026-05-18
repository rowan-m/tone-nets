import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import createLayout from 'ngraph.forcelayout';
import {
    EffectComposer,
    RenderPass,
    EffectPass,
    BloomEffect,
} from 'postprocessing';
import { Utils } from './Utils.js';
import { NetworkParser } from './NetworkParser.js';

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
        this.activeEmojis = [];
        this.emojiPool = [];
        this.maxEmojis = 100;
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

        this._lastFrameTime = 0;
        this._lastRaycastTime = 0;
        this._raycastThrottleMs = 33; // ~30fps for hover logic

        this.edgeMaterialPool = new Map();
        this.coneMaterialPool = new Map();
        this.nodeMaterialCache = new Map();
        this.emojiTextureCache = new Map();

        // Shared colors for interpolation to avoid object churn
        this._colorLow = new THREE.Color(0xbbbbbb);
        this._colorMid = new THREE.Color(0xdddddd);
        this._colorHigh = new THREE.Color(0xffffff);
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

        this.initThree();
        this.initPostProcessing();
        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
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
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this.mouseMoved = true;
        });
    }

    initPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomEffect = new BloomEffect({
            intensity: 1.5,
            luminanceThreshold: 0.1,
            luminanceSmoothing: 0.9,
            mipmapBlur: true,
        });

        this.composer.addPass(new EffectPass(this.camera, bloomEffect));
    }

    clear() {
        this.stopAutoTour();
        if (this.controls) {
            this.controls.reset();
        }

        // Reset tour-related state fully
        this.tourCurrentVelocity.set(0, 0, 0);
        this.tourTargetVelocity.set(0, 0, 0);
        this.tourRotation.set(0, 0, 0, 1);
        this.tourSpeedChangeTimer = 0;

        const edgeMats = new Set(this.edgeMaterialPool.values());
        const coneMats = new Set(this.coneMaterialPool.values());
        const nodeMats = new Set(this.nodeMaterialCache.values());
        const sharedMats = new Set([
            this.highlightEdgeMaterial,
            this.highlightConeMaterial,
            this.hoverEdgeMaterial,
            this.hoverConeMaterial,
        ]);

        while (this.graphGroup.children.length > 0) {
            const child = this.graphGroup.children[0];
            child.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();

                if (!obj.material) return;
                const mats = Array.isArray(obj.material)
                    ? obj.material
                    : [obj.material];
                mats.forEach((mat) => {
                    if (
                        edgeMats.has(mat) ||
                        coneMats.has(mat) ||
                        nodeMats.has(mat) ||
                        sharedMats.has(mat)
                    )
                        return;
                    if (mat.map && !this.emojiTextureCache.has(mat.map))
                        mat.map.dispose();
                    mat.dispose();
                });
            });
            this.graphGroup.remove(child);
        }

        // Dispose pooled materials
        this.edgeMaterialPool.forEach((mat) => mat.dispose());
        this.edgeMaterialPool.clear();
        this.coneMaterialPool.forEach((mat) => mat.dispose());
        this.coneMaterialPool.clear();
        this.nodeMaterialCache.forEach((mat) => mat.dispose());
        this.nodeMaterialCache.clear();

        this.emojiPool.forEach((sprite) => {
            if (sprite.material) sprite.material.dispose();
        });
        this.emojiPool = [];

        // We don't dispose emojiTextureCache here because those are reusable across different MIDI files
        // but we DO dispose the sprites in the clear() call if they are active.

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

        // Clear active emojis
        this.activeEmojis.forEach((emojiData) => {
            this.scene.remove(emojiData.sprite);
            if (emojiData.sprite.material) emojiData.sprite.material.dispose();
        });
        this.activeEmojis = [];

        if (this.layout) {
            this.layout.dispose();
            this.layout = null;
        }
    }

    async _computeLayout(graph) {
        this.layout = createLayout(graph, {
            dimensions: 3,
            physicsSettings: {
                springLength: 40,
                springCoefficient: 0.02,
                gravity: -200,
                theta: 0.8,
                dragCoefficient: 0.6,
                nodeMass: (nodeId) => {
                    const node = graph.getNode(nodeId);
                    if (!node) return 1;
                    const degree = (node.data && node.data.degree) || 1;
                    return 1 + Math.log2(degree + 1) * 5;
                },
                springTransform: (link, spring) => {
                    if (link.data && link.data.isFake) {
                        spring.length = 0;
                        spring.weight = 5;
                    } else {
                        spring.length = 40;
                        spring.weight = (link.data && link.data.weight) || 1;
                    }
                },
            },
        });

        const currentToken = {};
        this._buildToken = currentToken;

        const totalSteps = 3000;
        const batchSize = 100;

        // Ensure isolated components are pulled together statically before simulation runs
        this._updateFakeLinks();

        for (let i = 0; i < totalSteps; i++) {
            if (this._buildToken !== currentToken) return false;

            this.layout.step();

            if (i % batchSize === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
                if (this._buildToken !== currentToken) return false;

                if (this.onLayoutProgress) {
                    this.onLayoutProgress(Math.round((i / totalSteps) * 100));
                }
            }
        }
        if (this.onLayoutProgress) this.onLayoutProgress(100);
        return true;
    }

    async initIncremental(graph) {
        this.clear();
        this.graph = graph;
        this.incrementalMode = true;

        this.layout = createLayout(graph, {
            dimensions: 3,
            physicsSettings: {
                springLength: 40,
                springCoefficient: 0.02,
                gravity: -200,
                theta: 0.8,
                dragCoefficient: 0.6,
                nodeMass: (nodeId) => {
                    const node = graph.getNode(nodeId);
                    if (!node) return 1;
                    const degree = (node.data && node.data.degree) || 1;
                    return 1 + Math.log2(degree + 1) * 5;
                },
                springTransform: (link, spring) => {
                    if (link.data && link.data.isFake) {
                        spring.length = 0;
                        spring.weight = 5;
                    } else {
                        spring.length = 40;
                        spring.weight = (link.data && link.data.weight) || 1;
                    }
                },
            },
        });

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
        }
    }

    _updateElementVisuals(id, type) {
        if (type === 'node') {
            const nodeData = this.nodes.get(id);
            if (!nodeData) return;
            const node = this.graph.getNode(id);
            const degree = (node.data && node.data.degree) || 1;
            const normDegree = Math.min(1, degree / this.maxDegree);
            const scale = 3 + normDegree * 15;
            nodeData.mesh.scale.set(scale, scale, scale);
            nodeData.mesh.userData.degree = degree;
        } else if (type === 'edge') {
            const edgeData = this.edgeMap.get(id);
            if (!edgeData) return;
            const link = this.graph.getLink(
                edgeData.sourceId,
                edgeData.targetId,
            );
            const normWeight = Math.min(1, link.data.weight / this.maxWeight);
            const weightBucket = Math.round(normWeight * 100);

            let mat = this.edgeMaterialPool.get(weightBucket);
            let coneMat = this.coneMaterialPool.get(weightBucket);

            if (!mat || !coneMat) {
                const edgeColor = this._getEdgeColor(normWeight);
                const edgeOpacity = 0.2 + normWeight * 0.5;

                mat = new THREE.LineBasicMaterial({
                    color: edgeColor,
                    transparent: true,
                    opacity: edgeOpacity,
                });
                this.edgeMaterialPool.set(weightBucket, mat);

                coneMat = new THREE.MeshBasicMaterial({
                    color: edgeColor,
                    transparent: true,
                    opacity: Math.max(0.2, edgeOpacity),
                });
                this.coneMaterialPool.set(weightBucket, coneMat);
            }

            edgeData.line.material = mat;
            edgeData.line.userData.origMaterial = mat;
            edgeData.line.userData.weight = link.data.weight;
            if (edgeData.cone) {
                edgeData.cone.material = coneMat;
                edgeData.cone.userData.origMaterial = coneMat;
            }
        }
    }

    _updateAllVisualScales() {
        this.nodes.forEach((_, id) => this._updateElementVisuals(id, 'node'));
        this.edgeMap.forEach((_, id) => this._updateElementVisuals(id, 'edge'));
    }

    _processIncrementalNode(nodeId, incrementDegree) {
        if (!nodeId) return null;

        let node = this.graph.getNode(nodeId);
        if (!node) {
            node = this.graph.addNode(nodeId, { name: nodeId, degree: 0 });
        }
        if (!node.data) node.data = {};
        if (typeof node.data.degree !== 'number') node.data.degree = 0;

        if (incrementDegree) {
            node.data.degree++;
        }

        if (!this.nodes.has(nodeId)) {
            this._renderNode(node, this.layoutScale, this.maxDegree);
        }

        return node;
    }

    _processIncrementalLink(sourceId, targetId, hasTransition) {
        if (!hasTransition) return false;

        const isNewLink = NetworkParser.addTransition(
            this.graph,
            sourceId,
            targetId,
        );
        const link = this.graph.getLink(sourceId, targetId);

        if (isNewLink) {
            this._renderEdge(link, this.layoutScale, this.maxWeight);
        }

        if (link && link.data.weight > this.maxWeight) {
            this.maxWeight = link.data.weight;
            return true;
        }
        return false;
    }

    addTransitionIncremental(sourceId, targetId) {
        if (!this.incrementalMode || !this.graph || !targetId) return;

        const hasTransition = Boolean(sourceId && sourceId !== targetId);
        const sourceNode = hasTransition
            ? this._processIncrementalNode(sourceId, true)
            : null;
        const targetNode = this._processIncrementalNode(
            targetId,
            hasTransition,
        );

        let globalUpdateNeeded = this._processIncrementalLink(
            sourceId,
            targetId,
            hasTransition,
        );

        if (this._updateMaxMetrics(sourceNode, targetNode)) {
            globalUpdateNeeded = true;
        }

        if (globalUpdateNeeded) {
            this._scheduleGlobalUpdate();
        } else {
            this._updateSpecificVisuals(sourceId, targetId, hasTransition);
        }
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

    _updateSpecificVisuals(sourceId, targetId, hasTransition) {
        if (sourceId) this._updateElementVisuals(sourceId, 'node');
        if (targetId) this._updateElementVisuals(targetId, 'node');
        if (hasTransition) {
            this._updateElementVisuals(`${sourceId}->${targetId}`, 'edge');
        }
    }

    _renderNode(node, layoutScale, maxDegree) {
        const pos = this.layout.getNodePosition(node.id);
        const degree = (node.data && node.data.degree) || 1;
        const normDegree = Math.min(1, degree / maxDegree);

        const pitchClass = Utils.noteToSemitone(node.id) % 12;

        let baseMaterial = this.nodeMaterialCache.get(pitchClass);
        if (!baseMaterial) {
            const hue = pitchClass / 12;
            const nodeColor = new THREE.Color().setHSL(hue, 1.0, 0.6);

            baseMaterial = new THREE.MeshStandardMaterial({
                color: nodeColor,
                emissive: nodeColor,
                emissiveIntensity: 0.2,
                roughness: 0.3,
                metalness: 0.2,
                transparent: false,
                opacity: 1.0,
            });
            this.nodeMaterialCache.set(pitchClass, baseMaterial);
        }

        const material = baseMaterial.clone();
        const mesh = new THREE.Mesh(this.sphereGeo, material);

        const scale = 3 + normDegree * 15;
        mesh.scale.set(scale, scale, scale);

        const x = pos.x * layoutScale;
        const y = pos.y * layoutScale;
        const z = pos.z * layoutScale;
        mesh.position.set(x, y, z);

        const outlineMesh = new THREE.Mesh(this.outlineGeo, this.outlineMat);
        mesh.add(outlineMesh);

        this.graphGroup.add(mesh);
        mesh.userData = {
            type: 'node',
            id: node.id,
            degree: degree,
            origEmissive: material.emissive.getHex(),
            origEmissiveIntensity: material.emissiveIntensity,
        };
        this.pickableObjects.push(mesh);
        this.nodes.set(node.id, { mesh: mesh, id: node.id });
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
        // We use the pre-computed sum of node IDs (seed) to create a stable but unique rotation for each edge pair.
        const angle = (seed % 360) * (Math.PI / 180);
        perp.applyAxisAngle(edgeDir, angle);

        // Curvature amount: reduced to ~15% of distance for a cleaner, more readable network.
        // We still keep a small random offset to avoid "parallel" curves in symmetric graphs.
        const curveAmount = dist * (0.15 + (seed % 10) * 0.01);
        curve.v1.copy(midPoint).add(perp.multiplyScalar(curveAmount));

        return curve;
    }

    _getEdgeColor(normWeight) {
        if (normWeight < 0.5) {
            return this._scratchColor
                .copy(this._colorLow)
                .lerp(this._colorMid, normWeight * 2)
                .clone();
        }
        return this._scratchColor
            .copy(this._colorMid)
            .lerp(this._colorHigh, (normWeight - 0.5) * 2)
            .clone();
    }

    _renderEdge(link, layoutScale, maxWeight, coneGeo) {
        const sPosRaw = this.layout.getNodePosition(link.fromId);
        const tPosRaw = this.layout.getNodePosition(link.toId);
        const targetConeGeo = coneGeo || this.coneGeo;

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

        const segments = 20;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array((segments + 1) * 3);
        for (let i = 0; i <= segments; i++) {
            curve.getPoint(i / segments, this._scratchVec3_1);
            positions[i * 3] = this._scratchVec3_1.x;
            positions[i * 3 + 1] = this._scratchVec3_1.y;
            positions[i * 3 + 2] = this._scratchVec3_1.z;
        }
        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3),
        );

        const normWeight = Math.min(1, link.data.weight / maxWeight);
        const weightBucket = Math.round(normWeight * 100);

        let mat = this.edgeMaterialPool.get(weightBucket);
        let coneMat = this.coneMaterialPool.get(weightBucket);

        if (!mat || !coneMat) {
            const edgeColor = this._getEdgeColor(normWeight);
            // Reduced opacity for a cleaner, less "hairy" network silhouette.
            const edgeOpacity = 0.2 + normWeight * 0.5;

            mat = new THREE.LineBasicMaterial({
                color: edgeColor,
                transparent: true,
                opacity: edgeOpacity,
            });
            this.edgeMaterialPool.set(weightBucket, mat);

            coneMat = new THREE.MeshBasicMaterial({
                color: edgeColor,
                transparent: true,
                opacity: Math.max(0.2, edgeOpacity),
            });
            this.coneMaterialPool.set(weightBucket, coneMat);
        }

        const line = new THREE.Line(geometry, mat);
        this.graphGroup.add(line);

        line.userData = {
            type: 'edge',
            sourceId: link.fromId,
            targetId: link.toId,
            weight: link.data.weight,
            origMaterial: mat,
        };
        this.pickableObjects.push(line);

        const tMid = 0.5;
        curve.getPoint(tMid, this._scratchVec3_1);
        const arrowPos = this._scratchVec3_1;
        curve.getTangent(tMid, this._scratchVec3_2).normalize();
        const arrowDir = this._scratchVec3_2;

        const cone = new THREE.Mesh(targetConeGeo, coneMat);
        cone.position.copy(arrowPos);
        cone.lookAt(this._scratchVec3_3.copy(arrowPos).add(arrowDir));
        cone.userData = {
            origMaterial: coneMat,
        };

        this.graphGroup.add(cone);
        line.userData.cone = cone;

        const edgeData = {
            line: line,
            cone: cone,
            sourceId: link.fromId,
            targetId: link.toId,
            seed: seed,
        };
        this.edges.push(edgeData);
        this.edgeMap.set(`${link.fromId}->${link.toId}`, edgeData);
    }

    _renderEdges(graph, layoutScale, maxWeight) {
        this._initSharedGeometries();
        graph.forEachLink((link) => {
            this._renderEdge(link, layoutScale, maxWeight, this.coneGeo);
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

        let maxWeight = 1;
        graph.forEachLink((link) => {
            if (link.data.weight > maxWeight) maxWeight = link.data.weight;
        });

        this._renderNodes(graph, layoutScale, maxDegree);
        this._renderEdges(graph, layoutScale, maxWeight);

        this.fitCameraToGraph();

        this.startAutoTour();
    }

    fitCameraToGraph() {
        if (this.graphGroup.children.length === 0) return;

        this.stopAutoTour();

        this.camera.up.set(0, 1, 0); // Reset to default Y-up

        this._scratchBox3.setFromObject(this.graphGroup);
        this.graphBoundingBox.copy(this._scratchBox3);
        this._scratchBox3.getCenter(this.graphCenter);

        // Use bounding sphere to ensure the graph never clips when rotated
        this._scratchBox3.getBoundingSphere(this._scratchSphere);

        let radius = this._scratchSphere.radius;
        if (isNaN(radius) || radius <= 0 || !isFinite(radius)) {
            radius = 100; // Safe default for incremental mode starting empty
            this.graphCenter.set(0, 0, 0);
        }

        this.graphRadius = radius;
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
        const isPlaying = nodeData && nodeData.playCount > 0;

        if (isPlaying) {
            obj.material.emissive.setHex(this.highlightColor);
            obj.material.emissiveIntensity = 1.0;
        } else {
            obj.material.emissive.setHex(obj.userData.origEmissive);
            obj.material.emissiveIntensity = obj.userData.origEmissiveIntensity;
        }
    }

    _clearEdgeHoverState(obj) {
        const edgeId = `${obj.userData.sourceId}->${obj.userData.targetId}`;
        const edgeData = this.edgeMap.get(edgeId);
        const isPlaying = edgeData && edgeData.playCount > 0;

        if (isPlaying) {
            obj.material = this.highlightEdgeMaterial;
            if (obj.userData.cone) {
                obj.userData.cone.material = this.highlightConeMaterial;
            }
        } else {
            obj.material = obj.userData.origMaterial;
            if (obj.userData.cone) {
                obj.userData.cone.material =
                    obj.userData.cone.userData.origMaterial;
            }
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
            obj.material.emissiveIntensity = 0.8;
            obj.material.emissive.setHex(0xffffff);
        } else if (obj.userData.type === 'edge') {
            // Assign shared hover material
            obj.material = this.hoverEdgeMaterial;
            if (obj.userData.cone) {
                obj.userData.cone.material = this.hoverConeMaterial;
            }
        }
    }

    _updateHoverState(target) {
        if (this.hoveredObject !== target) {
            if (this.hoveredObject) {
                this._clearHoverObjectState(this.hoveredObject);
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

        this.nodes.forEach((nodeData, id) => {
            const pos = this.layout.getNodePosition(id);
            nodeData.mesh.position.set(
                pos.x * this.layoutScale,
                pos.y * this.layoutScale,
                pos.z * this.layoutScale,
            );
        });

        this.edges.forEach((edgeData) => {
            this._updateEdgeVisuals(edgeData);
        });

        this._updateAutoTourBounds();
    }

    _updateEdgeVisuals(edgeData) {
        const sPosRaw = this.layout.getNodePosition(edgeData.sourceId);
        const tPosRaw = this.layout.getNodePosition(edgeData.targetId);

        this._updateEdgeCurve(
            this._scratchCurve,
            sPosRaw,
            tPosRaw,
            this.layoutScale,
            edgeData.seed,
        );

        const positions = edgeData.line.geometry.attributes.position.array;
        const segments = 20;
        for (let i = 0; i <= segments; i++) {
            this._scratchCurve.getPoint(i / segments, this._scratchVec3_1);
            positions[i * 3] = this._scratchVec3_1.x;
            positions[i * 3 + 1] = this._scratchVec3_1.y;
            positions[i * 3 + 2] = this._scratchVec3_1.z;
        }
        edgeData.line.geometry.attributes.position.needsUpdate = true;

        const tMid = 0.5;
        this._scratchCurve.getPoint(tMid, this._scratchVec3_1);
        edgeData.cone.position.copy(this._scratchVec3_1);
        this._scratchCurve.getTangent(tMid, this._scratchVec3_2).normalize();
        edgeData.cone.lookAt(
            this._scratchVec3_3
                .copy(this._scratchVec3_1)
                .add(this._scratchVec3_2),
        );
    }

    _updateAutoTourBounds() {
        // Also update bounding box/center for auto-tour
        if (this.nodes.size > 0) {
            let sumX = 0,
                sumY = 0,
                sumZ = 0;
            this.nodes.forEach((nodeData) => {
                sumX += nodeData.mesh.position.x;
                sumY += nodeData.mesh.position.y;
                sumZ += nodeData.mesh.position.z;
            });

            this.graphCenter.set(
                sumX / this.nodes.size,
                sumY / this.nodes.size,
                sumZ / this.nodes.size,
            );

            let maxDistSq = 0;
            this.nodes.forEach((nodeData) => {
                const distSq = this.graphCenter.distanceToSquared(
                    nodeData.mesh.position,
                );
                if (distSq > maxDistSq) maxDistSq = distSq;
            });

            let radius = Math.sqrt(maxDistSq);
            if (isNaN(radius) || radius <= 0 || !isFinite(radius)) {
                radius = 100;
            }
            // Add padding so outer nodes don't clip bounds
            this.graphRadius = radius + 2;
        }
    }

    animate(time) {
        requestAnimationFrame(this.animate);

        if (document.visibilityState === 'hidden') {
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

        this._updateEmojis(delta);
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
        const intersects = this.raycaster.intersectObjects(
            this.pickableObjects,
            false,
        );
        let target = null;
        if (intersects.length > 0) {
            const hit =
                intersects.find((i) => i.object.userData.type === 'node') ||
                intersects[0];
            target = hit.object;
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
            depthTest: false, // Ensure it's visible over nodes
        });
        const sprite = new THREE.Sprite(material);
        // Scaled up to be larger and more visible
        sprite.scale.set(40, 40, 1);
        return sprite;
    }

    showInstrumentEmoji(nodeId, emoji) {
        const nodeData = this.nodes.get(nodeId);
        if (!nodeData) return;

        // Enforce limit - recycle oldest if needed
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

        // Center exactly over the node's position. depthTest: false handles visibility.
        sprite.position.copy(nodeData.mesh.position);

        this.scene.add(sprite);
        this.activeEmojis.push({
            sprite: sprite,
            life: 1.0,
        });
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
                nodeData.mesh.material.emissiveIntensity = 1.0;
                nodeData.mesh.material.emissive.setHex(highlightColor);
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

            if (
                edgeData.playCount === 1 &&
                this.hoveredObject !== edgeData.line
            ) {
                edgeData.line.material = this.highlightEdgeMaterial;
                if (edgeData.cone) {
                    edgeData.cone.material = this.highlightConeMaterial;
                }
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
                    nodeData.mesh.material.emissiveIntensity =
                        nodeData.mesh.userData.origEmissiveIntensity;
                    nodeData.mesh.material.emissive.setHex(
                        nodeData.mesh.userData.origEmissive,
                    );
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
                if (this.hoveredObject !== edgeData.line) {
                    edgeData.line.material =
                        edgeData.line.userData.origMaterial;
                    if (edgeData.cone) {
                        edgeData.cone.material =
                            edgeData.cone.userData.origMaterial;
                    }
                }
            }
        }
    }

    releasePlayingElement(nodeId, prevNodeId) {
        this._releaseNode(nodeId);
        this._releaseEdge(prevNodeId, nodeId);
    }

    resetPlayingHighlights() {
        this.playingNodes.forEach((nodeData) => {
            nodeData.playCount = 0;
            if (this.hoveredObject !== nodeData.mesh) {
                nodeData.mesh.material.emissiveIntensity =
                    nodeData.mesh.userData.origEmissiveIntensity;
                nodeData.mesh.material.emissive.setHex(
                    nodeData.mesh.userData.origEmissive,
                );
            }
        });
        this.playingNodes.clear();

        this.playingEdges.forEach((edgeData) => {
            edgeData.playCount = 0;
            if (this.hoveredObject !== edgeData.line) {
                edgeData.line.material = edgeData.line.userData.origMaterial;
                if (edgeData.cone) {
                    edgeData.cone.material =
                        edgeData.cone.userData.origMaterial;
                }
            }
        });
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

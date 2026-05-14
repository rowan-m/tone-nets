import * as THREE from 'three';
import { ArcballControls } from 'three/examples/jsm/controls/ArcballControls.js';
import createLayout from 'ngraph.forcelayout';
import {
    EffectComposer,
    RenderPass,
    EffectPass,
    BloomEffect,
} from 'postprocessing';
import { Utils } from './Utils.js';

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
        this.autoTour = false;
        this.autoTourTime = 0;
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

        this.controls = new ArcballControls(
            this.camera,
            this.renderer.domElement,
        );
        if (this.controls.setGizmosVisible) {
            this.controls.setGizmosVisible(false);
        }
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
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

                if (obj.material) {
                    const mats = Array.isArray(obj.material)
                        ? obj.material
                        : [obj.material];
                    mats.forEach((mat) => {
                        if (
                            !edgeMats.has(mat) &&
                            !coneMats.has(mat) &&
                            !nodeMats.has(mat) &&
                            !sharedMats.has(mat)
                        ) {
                            if (
                                mat.map &&
                                !this.emojiTextureCache.has(mat.map)
                            ) {
                                mat.map.dispose();
                            }
                            mat.dispose();
                        }
                    });
                }
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
            dimensions: 2,
            physicsSettings: {
                springLength: 150,
                springCoeff: 0.0001,
                gravity: -10,
                theta: 0.8,
                dragCoeff: 0.1,
                timeStep: 20,
            },
        });

        const currentToken = {};
        this._buildToken = currentToken;

        const totalSteps = 3000;
        const batchSize = 100;
        const bodies = this.layout.simulator.bodies;
        const bodiesLen = bodies.length;

        for (let i = 0; i < totalSteps; i++) {
            if (this._buildToken !== currentToken) return false;

            this.layout.step();

            for (let j = 0; j < bodiesLen; j++) {
                const pos = bodies[j].pos;
                pos.x *= 0.995;
                pos.y *= 0.995;
            }

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

    _renderNodes(graph, layoutScale, zDepthScale, maxDegree) {
        const sphereSegments = 20; // Reduced from 32 for performance
        const sphereGeo = new THREE.SphereGeometry(
            1,
            sphereSegments,
            sphereSegments,
        );

        const outlineGeo = new THREE.SphereGeometry(1.08, 12, 12);
        let outlineMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            side: THREE.BackSide,
        });

        graph.forEachNode((node) => {
            const pos = this.layout.getNodePosition(node.id);
            const degree = node.data.degree || 1;
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

            // Must clone so each node can have independent highlight state (emissiveIntensity)
            const material = baseMaterial.clone();
            const mesh = new THREE.Mesh(sphereGeo, material);

            const scale = 2 + normDegree * 6;
            mesh.scale.set(scale, scale, scale);

            const zPos = normDegree * zDepthScale - zDepthScale * 0.25;
            mesh.position.set(pos.x * layoutScale, pos.y * layoutScale, zPos);

            const outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
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
            this.nodes.set(node.id, { mesh: mesh, id: node.id, z: zPos });
        });
    }

    _updateEdgeCurve(curve, sPosRaw, tPosRaw, sZ, tZ, layoutScale) {
        const sPos = curve.v0.set(
            sPosRaw.x * layoutScale,
            sPosRaw.y * layoutScale,
            sZ,
        );
        const tPos = curve.v2.set(
            tPosRaw.x * layoutScale,
            tPosRaw.y * layoutScale,
            tZ,
        );

        const midPoint = this._scratchVec3_1
            .copy(sPos)
            .add(tPos)
            .multiplyScalar(0.5);
        const dx = tPos.x - sPos.x;
        const dy = tPos.y - sPos.y;
        const xyDist = Math.sqrt(dx * dx + dy * dy);

        const normal = this._scratchVec3_2.set(-dy, dx, 0).normalize();
        const controlPoint = curve.v1
            .copy(midPoint)
            .add(normal.multiplyScalar(xyDist * 0.25));
        controlPoint.z = Math.max(sZ, tZ) + xyDist * 0.15;

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
        const sZ = this.nodes.get(link.fromId).z;
        const tZ = this.nodes.get(link.toId).z;

        const curve = this._updateEdgeCurve(
            this._scratchCurve,
            sPosRaw,
            tPosRaw,
            sZ,
            tZ,
            layoutScale,
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
            const edgeOpacity = 0.4 + normWeight * 0.6;

            mat = new THREE.LineBasicMaterial({
                color: edgeColor,
                transparent: true,
                opacity: edgeOpacity,
            });
            this.edgeMaterialPool.set(weightBucket, mat);

            coneMat = new THREE.MeshBasicMaterial({
                color: edgeColor,
                transparent: true,
                opacity: Math.max(0.4, edgeOpacity),
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

        const cone = new THREE.Mesh(coneGeo, coneMat);
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
        };
        this.edges.push(edgeData);
        this.edgeMap.set(`${link.fromId}->${link.toId}`, edgeData);
    }

    _renderEdges(graph, layoutScale, maxWeight) {
        const coneGeo = new THREE.ConeGeometry(1.2, 3.5, 8);
        coneGeo.rotateX(Math.PI / 2);

        graph.forEachLink((link) => {
            this._renderEdge(link, layoutScale, maxWeight, coneGeo);
        });
    }

    async buildVisualization(graph) {
        this.clear();

        const isLayoutComplete = await this._computeLayout(graph);
        if (!isLayoutComplete) return;

        const layoutScale = 4.0;
        const zDepthScale = 300;

        let maxDegree = 1;
        graph.forEachNode((node) => {
            if (node.data.degree > maxDegree) maxDegree = node.data.degree;
        });

        let maxWeight = 1;
        graph.forEachLink((link) => {
            if (link.data.weight > maxWeight) maxWeight = link.data.weight;
        });

        this._renderNodes(graph, layoutScale, zDepthScale, maxDegree);
        this._renderEdges(graph, layoutScale, maxWeight);

        this.fitCameraToGraph();
        this.graphCenter = new THREE.Vector3();
        this._scratchBox3.setFromObject(this.graphGroup);
        this._scratchBox3.getCenter(this.graphCenter);
        this._scratchBox3.getBoundingSphere(this._scratchSphere);
        this.graphRadius = this._scratchSphere.radius;
    }

    fitCameraToGraph() {
        if (this.graphGroup.children.length === 0) return;

        this._scratchBox3.setFromObject(this.graphGroup);
        const center = this._scratchVec3_1;
        this._scratchBox3.getCenter(center);

        // Use bounding sphere to ensure the graph never clips when rotated
        this._scratchBox3.getBoundingSphere(this._scratchSphere);

        const radius = this._scratchSphere.radius;
        let frustumSize = radius * 2 * 1.05; // Add 5% padding

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

        // Set camera to a top-down view (looking down the Z axis at the XY plane)
        // Since ngraph layout uses X and Y, and we map degree to Z,
        // looking down Z provides the clearest 2D view of the network structure.
        const viewDist = radius * 3;

        this.camera.position.set(center.x, center.y, center.z + viewDist);
        this.camera.lookAt(center);

        this.controls.target.copy(center);
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

    animate(time) {
        requestAnimationFrame(this.animate);

        const delta =
            this.isPaused || !this._lastFrameTime
                ? 0
                : (time - this._lastFrameTime) / 1000;
        this._lastFrameTime = time;

        // Raycasting Logic - Only if mouse moved and throttled
        if (
            this.mouseMoved &&
            time - this._lastRaycastTime > this._raycastThrottleMs
        ) {
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
            this._lastRaycastTime = time;
        }

        this._updateEmojis(delta);

        if (this.autoTour && this.graphCenter && this.currentTourSpherical) {
            this.autoTourTime += delta;

            // Use multiple sine waves to create complex, non-repeating variation
            const slowVar = Math.sin(this.autoTourTime * 0.1);
            const fastVar = Math.sin(this.autoTourTime * 0.5);

            // Periodically vary the rotational speed (theta)
            // This ensures it repeatedly fully loops around but with smooth variations in pace
            const baseThetaSpeed = 0.4;
            const thetaSpeed = baseThetaSpeed + slowVar * 0.15 + fastVar * 0.05;
            this.currentTourSpherical.theta -= delta * thetaSpeed;

            // Periodically vary the vertical oscillation (phi)
            // Varying amplitude and frequency provides more organic movement than a fixed sine
            const phiAmplitude =
                Math.PI / 3 +
                Math.cos(this.autoTourTime * 0.15) * (Math.PI / 8);
            const phiFrequency = 0.3 + Math.sin(this.autoTourTime * 0.1) * 0.1;
            const targetPhi =
                Math.PI / 2 +
                Math.sin(this.autoTourTime * phiFrequency) * phiAmplitude;

            this.currentTourSpherical.phi +=
                (targetPhi - this.currentTourSpherical.phi) * delta * 1.2;

            // Variate the distance slightly for a "breathing" effect
            const targetDist = this.graphRadius * (3 + slowVar * 0.5);
            this.currentTourSpherical.radius +=
                (targetDist - this.currentTourSpherical.radius) * delta * 1.5;

            // Smoothly interpolate target back to the center of the graph
            this.currentTourTarget.lerp(this.graphCenter, delta * 2.0);
            this.controls.target.copy(this.currentTourTarget);

            // Interpolate zoom
            this.camera.zoom += (1 - this.camera.zoom) * delta * 2.0;
            this.camera.updateProjectionMatrix();

            // Prevent phi from going exactly to 0 or PI to avoid gimbal lock/flipping
            this.currentTourSpherical.phi = Math.max(
                0.01,
                Math.min(Math.PI - 0.01, this.currentTourSpherical.phi),
            );

            // Apply the updated spherical coordinates
            const offset = new THREE.Vector3().setFromSpherical(
                this.currentTourSpherical,
            );
            this.camera.position.copy(this.currentTourTarget).add(offset);

            // For TrackballControls, we just ensure it looks at the target
            // It will manage its own up vector based on the drag history
            this.camera.lookAt(this.currentTourTarget);
        }

        this.controls.update();
        this.composer.render();
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
        sprite.scale.set(15, 15, 1);
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

        sprite.position.copy(nodeData.mesh.position);
        // Offset a bit so it's not buried in the node
        sprite.position.z += 10;

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
        this.autoTour = true;
        this.autoTourTime = 0;

        // Capture current state to transition smoothly
        this.currentTourTarget = this.controls.target.clone();
        const offset = new THREE.Vector3().subVectors(
            this.camera.position,
            this.currentTourTarget,
        );
        this.currentTourSpherical = new THREE.Spherical().setFromVector3(
            offset,
        );
    }

    stopAutoTour() {
        this.autoTour = false;
    }

    setPaused(paused) {
        this.isPaused = paused;
    }
}

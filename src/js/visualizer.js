import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import createLayout from 'ngraph.forcelayout';
import {
    EffectComposer,
    RenderPass,
    EffectPass,
    BloomEffect,
} from 'postprocessing';
import { noteToSemitone } from './utils.js';

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
            depth: false,
        });

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
        this.pickableObjects = [];
        this.hoveredObject = null;
        this.onHover = null;
        this.activeEmojis = [];
        this.scene.add(this.graphGroup);

        this.edgeMaterialPool = new Map();
        this.coneMaterialPool = new Map();

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

        const highlightColor = 0xffe600; // Electric Yellow
        this.highlightEdgeMaterial = new THREE.LineBasicMaterial({
            color: highlightColor,
            transparent: true,
            opacity: 1.0,
        });
        this.highlightConeMaterial = new THREE.MeshBasicMaterial({
            color: highlightColor,
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
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // Initial dummy camera setup for the empty scene.
        // This will be completely overridden by fitCameraToGraph() once a MIDI is loaded.
        this.camera.up.set(0, 0, 1);
        this.camera.position.set(0, -800, 800);
        this.camera.lookAt(0, 0, 0);

        this.controls = new OrbitControls(
            this.camera,
            this.renderer.domElement,
        );
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

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
        });
    }

    initPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomEffect = new BloomEffect({
            intensity: 1.5,
            luminanceThreshold: 0.1,
            luminanceSmoothing: 0.9,
        });

        this.composer.addPass(new EffectPass(this.camera, bloomEffect));
    }

    clear() {
        while (this.graphGroup.children.length > 0) {
            const child = this.graphGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            this.graphGroup.remove(child);
        }

        // Dispose pooled materials
        this.edgeMaterialPool.forEach((mat) => mat.dispose());
        this.edgeMaterialPool.clear();
        this.coneMaterialPool.forEach((mat) => mat.dispose());
        this.coneMaterialPool.clear();

        this.nodes.clear();
        this.edges = [];
        this.edgeMap.clear();

        // Clear active emojis
        this.activeEmojis.forEach((emojiData) => {
            this.scene.remove(emojiData.sprite);
            if (emojiData.sprite.material.map)
                emojiData.sprite.material.map.dispose();
            emojiData.sprite.material.dispose();
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
        for (let i = 0; i < totalSteps; i++) {
            if (this._buildToken !== currentToken) return false;

            this.layout.step();

            this.layout.simulator.bodies.forEach((body) => {
                body.pos.x -= body.pos.x * 0.005;
                body.pos.y -= body.pos.y * 0.005;
            });

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
        const sphereGeo = new THREE.SphereGeometry(1, 32, 32);

        graph.forEachNode((node) => {
            const pos = this.layout.getNodePosition(node.id);
            const degree = node.data.degree || 1;
            const normDegree = Math.min(1, degree / maxDegree);

            const pitchClass = noteToSemitone(node.id) % 12;
            const hue = pitchClass / 12;
            const nodeColor = new THREE.Color().setHSL(hue, 1.0, 0.6);

            const material = new THREE.MeshStandardMaterial({
                color: nodeColor,
                emissive: nodeColor,
                emissiveIntensity: 0.2,
                roughness: 0.3,
                metalness: 0.2,
                transparent: false,
                opacity: 1.0,
            });
            const mesh = new THREE.Mesh(sphereGeo, material);

            const scale = 2 + normDegree * 6;
            mesh.scale.set(scale, scale, scale);

            const zPos = normDegree * zDepthScale - zDepthScale * 0.25;
            mesh.position.set(pos.x * layoutScale, pos.y * layoutScale, zPos);

            const outlineGeo = new THREE.SphereGeometry(1.08, 16, 16);
            const outlineMat = new THREE.MeshBasicMaterial({
                color: 0x000000,
                side: THREE.BackSide,
            });
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

    _createEdgeCurve(sPosRaw, tPosRaw, sZ, tZ, layoutScale) {
        const sPos = new THREE.Vector3(
            sPosRaw.x * layoutScale,
            sPosRaw.y * layoutScale,
            sZ,
        );
        const tPos = new THREE.Vector3(
            tPosRaw.x * layoutScale,
            tPosRaw.y * layoutScale,
            tZ,
        );

        const midPoint = sPos.clone().add(tPos).multiplyScalar(0.5);
        const xyDist = Math.sqrt(
            Math.pow(tPos.x - sPos.x, 2) + Math.pow(tPos.y - sPos.y, 2),
        );
        const dx = tPos.x - sPos.x;
        const dy = tPos.y - sPos.y;
        const normal = new THREE.Vector3(-dy, dx, 0).normalize();

        const controlPoint = midPoint.add(normal.multiplyScalar(xyDist * 0.25));
        controlPoint.z = Math.max(sZ, tZ) + xyDist * 0.15;

        return new THREE.QuadraticBezierCurve3(sPos, controlPoint, tPos);
    }

    _getEdgeColor(normWeight) {
        const colorLow = new THREE.Color(0xbbbbbb);
        const colorMid = new THREE.Color(0xdddddd);
        const colorHigh = new THREE.Color(0xffffff);

        if (normWeight < 0.5) {
            return colorLow.clone().lerp(colorMid, normWeight * 2);
        }
        return colorMid.clone().lerp(colorHigh, (normWeight - 0.5) * 2);
    }

    _renderEdge(link, layoutScale, maxWeight, coneGeo) {
        const sPosRaw = this.layout.getNodePosition(link.fromId);
        const tPosRaw = this.layout.getNodePosition(link.toId);
        const sZ = this.nodes.get(link.fromId).z;
        const tZ = this.nodes.get(link.toId).z;

        const curve = this._createEdgeCurve(
            sPosRaw,
            tPosRaw,
            sZ,
            tZ,
            layoutScale,
        );

        const pts = curve.getPoints(20);
        const geometry = new THREE.BufferGeometry().setFromPoints(pts);

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
        const arrowPos = curve.getPoint(tMid);
        const arrowDir = curve.getTangent(tMid).normalize();

        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.copy(arrowPos);
        cone.lookAt(arrowPos.clone().add(arrowDir));
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
    }

    fitCameraToGraph() {
        if (this.graphGroup.children.length === 0) return;

        const box = new THREE.Box3().setFromObject(this.graphGroup);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Use bounding sphere to ensure the graph never clips when rotated
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);

        const radius = sphere.radius;
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

        // Set camera to an isometric angle
        const isoDist = radius * 3; // Move far enough back to avoid near-plane clipping
        this.camera.position.set(
            center.x + isoDist,
            center.y - isoDist,
            center.z + isoDist,
        );
        this.camera.lookAt(center);

        this.controls.target.copy(center);
        this.controls.update();
    }

    _clearHoverObjectState(obj) {
        if (obj.userData.type === 'node') {
            obj.material.emissive.setHex(obj.userData.origEmissive);
            obj.material.emissiveIntensity = obj.userData.origEmissiveIntensity;
        } else if (obj.userData.type === 'edge') {
            // Restore original shared material instead of mutating
            // Check if it should be highlighted instead of normal
            const edgeId = `${obj.userData.sourceId}->${obj.userData.targetId}`;
            const edgeData = this.edgeMap.get(edgeId);

            if (edgeData && edgeData.playCount > 0) {
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

    _updateEmojis() {
        const upVec = new THREE.Vector3(0, 1, 0);
        // Get the camera's up vector in world space to float "up" relative to the view
        this.camera.getWorldDirection(upVec);
        // We want to float "up" relative to the screen, which is the camera's up vector
        const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
            this.camera.quaternion,
        );

        for (let i = this.activeEmojis.length - 1; i >= 0; i--) {
            // eslint-disable-next-line security/detect-object-injection
            const emojiData = this.activeEmojis[i];
            emojiData.life -= 0.02;

            if (emojiData.life <= 0) {
                this.scene.remove(emojiData.sprite);
                emojiData.sprite.material.map.dispose();
                emojiData.sprite.material.dispose();
                this.activeEmojis.splice(i, 1);
                continue;
            }

            // Move up relative to camera view
            emojiData.sprite.position.addScaledVector(cameraUp, 0.5);
            emojiData.sprite.material.opacity = emojiData.life;
        }
    }

    animate() {
        requestAnimationFrame(this.animate);

        // Raycasting Logic
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
        this._updateEmojis();

        this.controls.update();
        this.composer.render();
    }

    _createEmojiSprite(emoji) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = '48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);
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

        const sprite = this._createEmojiSprite(emoji);
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
        const highlightColor = 0xffe600; // Electric Yellow
        this._highlightNode(nodeId, highlightColor);
        this._highlightEdge(prevNodeId, nodeId);
    }

    _releaseNode(nodeId) {
        const nodeData = this.nodes.get(nodeId);
        if (nodeData && nodeData.playCount > 0) {
            nodeData.playCount--;
            if (
                nodeData.playCount === 0 &&
                this.hoveredObject !== nodeData.mesh
            ) {
                nodeData.mesh.material.emissiveIntensity =
                    nodeData.mesh.userData.origEmissiveIntensity;
                nodeData.mesh.material.emissive.setHex(
                    nodeData.mesh.userData.origEmissive,
                );
            }
        }
    }

    _releaseEdge(prevNodeId, nodeId) {
        if (!prevNodeId) return;
        const edgeId = `${prevNodeId}->${nodeId}`;
        const edgeData = this.edgeMap.get(edgeId);
        if (edgeData && edgeData.playCount > 0) {
            edgeData.playCount--;
            if (
                edgeData.playCount === 0 &&
                this.hoveredObject !== edgeData.line
            ) {
                edgeData.line.material = edgeData.line.userData.origMaterial;
                if (edgeData.cone) {
                    edgeData.cone.material =
                        edgeData.cone.userData.origMaterial;
                }
            }
        }
    }

    releasePlayingElement(nodeId, prevNodeId) {
        this._releaseNode(nodeId);
        this._releaseEdge(prevNodeId, nodeId);
    }

    resetPlayingHighlights() {
        this.nodes.forEach((nodeData) => {
            nodeData.playCount = 0;
            if (this.hoveredObject !== nodeData.mesh) {
                nodeData.mesh.material.emissiveIntensity =
                    nodeData.mesh.userData.origEmissiveIntensity;
                nodeData.mesh.material.emissive.setHex(
                    nodeData.mesh.userData.origEmissive,
                );
            }
        });

        this.edgeMap.forEach((edgeData) => {
            edgeData.playCount = 0;
            if (this.hoveredObject !== edgeData.line) {
                edgeData.line.material = edgeData.line.userData.origMaterial;
                if (edgeData.cone) {
                    edgeData.cone.material =
                        edgeData.cone.userData.origMaterial;
                }
            }
        });
    }
}

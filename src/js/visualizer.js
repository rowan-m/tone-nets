import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import createLayout from 'ngraph.forcelayout';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';

export class NetworkVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = new THREE.Scene();
        const aspect = this.container.clientWidth / this.container.clientHeight;
        const d = 1000;
        this.camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 10000);
        this.baseFrustumSize = d * 2;
        this.renderer = new THREE.WebGLRenderer({ powerPreference: "high-performance", antialias: false, stencil: false, depth: false });
        
        this.nodes = new Map();
        this.edges = [];
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
        this.scene.add(this.graphGroup);

        this.initThree();
        this.initPostProcessing();
        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    initThree() {
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        this.camera.position.z = 800;

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 2);
        this.scene.add(directionalLight);

        window.addEventListener('resize', () => {
            const aspect = this.container.clientWidth / this.container.clientHeight;
            const d = this.baseFrustumSize / 2;
            this.camera.left = -d * aspect;
            this.camera.right = d * aspect;
            this.camera.top = d;
            this.camera.bottom = -d;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
            this.composer.setSize(this.container.clientWidth, this.container.clientHeight);
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
            luminanceSmoothing: 0.9
        });

        this.composer.addPass(new EffectPass(this.camera, bloomEffect));
    }

    clear() {
        while(this.graphGroup.children.length > 0){ 
            const child = this.graphGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            this.graphGroup.remove(child); 
        }
        this.nodes.clear();
        this.edges = [];
        if (this.layout) {
            this.layout.dispose();
            this.layout = null;
        }
    }

    async buildVisualization(graph) {
        this.clear();
        
        // 1. Initialize Force Layout in 2D to keep the clean, separated structural web
        this.layout = createLayout(graph, { 
            dimensions: 2,
            physicsSettings: {
                springLength: 150,
                springCoeff: 0.0001,
                gravity: -10,
                theta: 0.8,
                dragCoeff: 0.1,
                timeStep: 20
            }
        });
        
        // Fully compute the 2D layout incrementally to avoid blocking
        const totalSteps = 3000;
        const batchSize = 100;
        for (let i = 0; i < totalSteps; i++) {
            this.layout.step();
            if (i % batchSize === 0) {
                // Yield to main thread
                await new Promise(resolve => setTimeout(resolve, 0));
                if (this.onLayoutProgress) {
                    this.onLayoutProgress(Math.round((i / totalSteps) * 100));
                }
            }
        }
        if (this.onLayoutProgress) this.onLayoutProgress(100);

        const layoutScale = 4.0;
        const zDepthScale = 300; // How much the 3D effect pops out

        const color1 = new THREE.Color(0x00ffff); // Neon Cyan
        const color2 = new THREE.Color(0xff00ff); // Neon Magenta
        
        let maxDegree = 1;
        graph.forEachNode(node => {
            if (node.data.degree > maxDegree) maxDegree = node.data.degree;
        });

        let maxWeight = 1;
        graph.forEachLink(link => {
            if (link.data.weight > maxWeight) maxWeight = link.data.weight;
        });

        const sphereGeo = new THREE.SphereGeometry(1, 32, 32);

        // 2. Create Node Meshes (Apply Z-depth based on degree)
        graph.forEachNode(node => {
            const pos = this.layout.getNodePosition(node.id);
            const degree = node.data.degree || 1;
            
            const normDegree = Math.min(1, degree / maxDegree);
            const nodeColor = color1.clone().lerp(color2, normDegree);
            
            const material = new THREE.MeshStandardMaterial({ 
                color: nodeColor,
                emissive: nodeColor,
                emissiveIntensity: 0.2,
                roughness: 0.3,
                metalness: 0.2,
                transparent: false,
                opacity: 1.0
            });
            const mesh = new THREE.Mesh(sphereGeo, material);
            
            const scale = 2 + (normDegree * 6); 
            mesh.scale.set(scale, scale, scale);
            
            // MEANINGFUL Z-AXIS: Highly connected notes pop out towards the camera
            const zPos = (normDegree * zDepthScale) - (zDepthScale * 0.25);
            mesh.position.set(pos.x * layoutScale, pos.y * layoutScale, zPos);
            
            const outlineGeo = new THREE.SphereGeometry(1.08, 16, 16);
            const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
            const outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
            mesh.add(outlineMesh);

            this.graphGroup.add(mesh);
            // Store the calculated Z so edges can use it
            mesh.userData = { 
                type: 'node', 
                id: node.id, 
                degree: degree, 
                origEmissive: material.emissive.getHex(),
                origEmissiveIntensity: material.emissiveIntensity
            };
            this.pickableObjects.push(mesh);
            this.nodes.set(node.id, { mesh: mesh, id: node.id, z: zPos });
        });

        // 3. Create Edge Meshes (Curved Lines with Bright Heatmap)
        const colorLow = new THREE.Color(0xbbbbbb);   // Rare: Medium-Light Grey
        const colorMid = new THREE.Color(0xdddddd);   // Frequent: Very Light Grey
        const colorHigh = new THREE.Color(0xffffff);  // Very Frequent: Pure White

        // Reusable cone geometry for arrows (oriented so tip points along +Z)
        const coneGeo = new THREE.ConeGeometry(1.2, 3.5, 8); // Scaled down to match lines
        coneGeo.rotateX(Math.PI / 2);

        graph.forEachLink(link => {
            const sPosRaw = this.layout.getNodePosition(link.fromId);
            const tPosRaw = this.layout.getNodePosition(link.toId);
            const sZ = this.nodes.get(link.fromId).z;
            const tZ = this.nodes.get(link.toId).z;
            
            const sPos = new THREE.Vector3(sPosRaw.x * layoutScale, sPosRaw.y * layoutScale, sZ);
            const tPos = new THREE.Vector3(tPosRaw.x * layoutScale, tPosRaw.y * layoutScale, tZ);
            
            const midPoint = sPos.clone().add(tPos).multiplyScalar(0.5);
            const xyDist = Math.sqrt(Math.pow(tPos.x - sPos.x, 2) + Math.pow(tPos.y - sPos.y, 2));
            const dx = tPos.x - sPos.x;
            const dy = tPos.y - sPos.y;
            const normal = new THREE.Vector3(-dy, dx, 0).normalize();
            
            const controlPoint = midPoint.add(normal.multiplyScalar(xyDist * 0.25));
            controlPoint.z = Math.max(sZ, tZ) + (xyDist * 0.15); 
            
            const curve = new THREE.QuadraticBezierCurve3(sPos, controlPoint, tPos);
            
            // --- RESTORE FULL LINES TO CENTER ---
            const pts = curve.getPoints(20); 
            const geometry = new THREE.BufferGeometry().setFromPoints(pts);
            
            // --- DATA-DRIVEN STYLING ---
            const normWeight = Math.min(1, link.data.weight / maxWeight);
            
            // Weight Color: Med Grey -> Pure White
            let edgeColor;
            if (normWeight < 0.5) {
                edgeColor = colorLow.clone().lerp(colorMid, normWeight * 2);
            } else {
                edgeColor = colorMid.clone().lerp(colorHigh, (normWeight - 0.5) * 2);
            }

            // Opacity: Significantly increased base opacity so thin lines pop
            const edgeOpacity = 0.4 + (normWeight * 0.6);

            const mat = new THREE.LineBasicMaterial({ 
                color: edgeColor, 
                transparent: true, 
                opacity: edgeOpacity 
            });

            const line = new THREE.Line(geometry, mat);
            this.graphGroup.add(line);
            
            line.userData = { 
                type: 'edge', 
                sourceId: link.fromId, 
                targetId: link.toId, 
                weight: link.data.weight, 
                origOpacity: edgeOpacity, 
                origColor: edgeColor.getHex() 
            };
            this.pickableObjects.push(line);
            
            // --- PLACE ARROW AT CENTER OF CURVE ---
            const tMid = 0.5;
            const arrowPos = curve.getPoint(tMid);
            const arrowDir = curve.getTangent(tMid).normalize();
            
            const coneMat = new THREE.MeshBasicMaterial({ 
                color: edgeColor, 
                transparent: true, 
                opacity: Math.max(0.4, edgeOpacity) 
            });
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.copy(arrowPos);
            cone.lookAt(arrowPos.clone().add(arrowDir));

            this.graphGroup.add(cone);

            // STORE CONE IN LINE USERDATA FOR HIGHLIGHT SYNC
            line.userData.cone = cone;

            this.edges.push({
                line: line,
                cone: cone,
                sourceId: link.fromId,
                targetId: link.toId
            });
            });

            // Auto-fit camera to the graph's bounding box
            const box = new THREE.Box3().setFromObject(this.graphGroup);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            // For OrthographicCamera, the view size must encapsulate the bounding box
            const maxDim = Math.max(size.x, size.y, size.z);
            let frustumSize = maxDim * 1.4; // Add padding

            const aspect = this.container.clientWidth / this.container.clientHeight;

            // Adjust for aspect ratio if window is taller than it is wide
            if (aspect < 1) {
                frustumSize /= aspect;
            }

            // Update camera frustum to fit the graph
            this.baseFrustumSize = frustumSize;
            const d = frustumSize / 2;
            this.camera.left = -d * aspect;
            this.camera.right = d * aspect;
            this.camera.top = d;
            this.camera.bottom = -d;
            this.camera.updateProjectionMatrix();

            // Set camera to an isometric angle
            const isoDist = maxDim * 2; // Move far enough back to not clip near plane
            this.camera.position.set(center.x + isoDist, center.y - isoDist, center.z + isoDist);
            this.camera.lookAt(center);
            this.controls.target.copy(center);
            }

            animate() {
            requestAnimationFrame(this.animate);

            // Raycasting Logic
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObjects(this.pickableObjects, false);
            let target = null;
            if (intersects.length > 0) {
            const hit = intersects.find(i => i.object.userData.type === 'node') || intersects[0];
            target = hit.object;
            }
            if (this.hoveredObject !== target) {
            if (this.hoveredObject) {
                if (this.hoveredObject.userData.type === 'node') {
                    this.hoveredObject.material.emissive.setHex(this.hoveredObject.userData.origEmissive);
                    this.hoveredObject.material.emissiveIntensity = this.hoveredObject.userData.origEmissiveIntensity;
                } else if (this.hoveredObject.userData.type === 'edge') {
                    this.hoveredObject.material.opacity = this.hoveredObject.userData.origOpacity;
                    this.hoveredObject.material.color.setHex(this.hoveredObject.userData.origColor);
                    // RESTORE CONE
                    if (this.hoveredObject.userData.cone) {
                        this.hoveredObject.userData.cone.material.opacity = Math.max(0.4, this.hoveredObject.userData.origOpacity);
                        this.hoveredObject.userData.cone.material.color.setHex(this.hoveredObject.userData.origColor);
                    }
                }
            }
            this.hoveredObject = target;
            if (this.hoveredObject) {
                if (this.hoveredObject.userData.type === 'node') {
                    this.hoveredObject.material.emissiveIntensity = 0.8;
                    this.hoveredObject.material.emissive.setHex(0xffffff);
                } else if (this.hoveredObject.userData.type === 'edge') {
                    this.hoveredObject.material.opacity = 1.0;
                    this.hoveredObject.material.color.setHex(0xffffff);
                    // HIGHLIGHT CONE
                    if (this.hoveredObject.userData.cone) {
                        this.hoveredObject.userData.cone.material.opacity = 1.0;
                        this.hoveredObject.userData.cone.material.color.setHex(0xffffff);
                    }
                }
            }
            if (this.onHover) {
                this.onHover(this.hoveredObject ? this.hoveredObject.userData : null);
            }
            }
            this.controls.update();
            this.composer.render();
            }
            }

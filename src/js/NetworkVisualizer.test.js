import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import createLayout from 'ngraph.forcelayout';
import { EffectComposer } from 'postprocessing';
import { NetworkVisualizer } from './NetworkVisualizer.js';
import { NetworkParser } from './NetworkParser.js';

// --- Mocks ---
vi.mock('./NetworkParser.js', () => ({
    NetworkParser: {
        addTransition: vi.fn(),
    },
}));
// ... (keep other mocks intact)

const mockContainer = {
    appendChild: vi.fn(),
    clientWidth: 1000,
    clientHeight: 1000,
    addEventListener: vi.fn(),
};

const mockElement = {
    appendChild: vi.fn(),
    getContext: vi.fn(() => ({
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 10 })),
    })),
    style: {},
    width: 0,
    height: 0,
};

vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        WebGLRenderer: vi.fn().mockImplementation(function () {
            return {
                setSize: vi.fn(),
                setPixelRatio: vi.fn(),
                domElement: {
                    appendChild: vi.fn(),
                    getBoundingClientRect: vi.fn(() => ({
                        left: 0,
                        top: 0,
                        width: 1000,
                        height: 1000,
                    })),
                    addEventListener: vi.fn(),
                },
                dispose: vi.fn(),
            };
        }),
    };
});

vi.mock('three/examples/jsm/controls/TrackballControls.js', () => {
    return {
        TrackballControls: vi.fn().mockImplementation(function () {
            return {
                rotateSpeed: 1,
                dynamicDampingFactor: 0.1,
                update: vi.fn(),
                reset: vi.fn(),
                target: {
                    copy: vi.fn(),
                    set: vi.fn(),
                    clone: vi.fn(() => new THREE.Vector3()),
                },
                addEventListener: vi.fn(),
            };
        }),
    };
});

vi.mock('ngraph.forcelayout', () => {
    return {
        default: vi.fn().mockImplementation(function () {
            return {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
                dispose: vi.fn(),
                simulator: {
                    getBody: vi.fn(() => ({ mass: 1 })),
                    bodies: {
                        forEach: vi.fn(),
                    },
                },
            };
        }),
    };
});

vi.mock('postprocessing', () => {
    return {
        EffectComposer: vi.fn().mockImplementation(function () {
            return {
                addPass: vi.fn(),
                setSize: vi.fn(),
                render: vi.fn(),
            };
        }),
        RenderPass: vi.fn(),
        EffectPass: vi.fn(),
        BloomEffect: vi.fn(),
    };
});

describe('NetworkVisualizer', () => {
    let visualizer;

    beforeEach(() => {
        global.document = {
            getElementById: vi.fn(() => mockContainer),
            createElement: vi.fn(() => mockElement),
            body: {
                appendChild: vi.fn(),
                removeChild: vi.fn(),
            },
            addEventListener: vi.fn(),
        };

        global.window = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            devicePixelRatio: 1,
            requestAnimationFrame: vi.fn(),
        };

        global.requestAnimationFrame = vi.fn();

        visualizer = new NetworkVisualizer('visualizer-container');
    });

    afterEach(() => {
        delete global.document;
        delete global.window;
        delete global.requestAnimationFrame;
        vi.clearAllMocks();
    });

    it('should initialize with correct components', () => {
        expect(visualizer.scene).toBeDefined();
        expect(visualizer.camera).toBeDefined();
        expect(visualizer.renderer).toBeDefined();
        expect(visualizer.controls).toBeDefined();
        expect(visualizer.composer).toBeDefined();
        expect(THREE.WebGLRenderer).toHaveBeenCalled();
        expect(TrackballControls).toHaveBeenCalled();
        expect(EffectComposer).toHaveBeenCalled();
    });
    it('should clear the graph group and materials', () => {
        visualizer._initSharedGeometries();
        const dummy = new THREE.Mesh(
            new THREE.SphereGeometry(),
            new THREE.MeshStandardMaterial(),
        );
        visualizer.nodes.set('test', { mesh: dummy });

        visualizer.clear();

        // graphGroup now retains the 4 instanced rendering objects
        expect(visualizer.graphGroup.children.length).toBe(4);
        expect(visualizer.nodes.size).toBe(0);
    });
    it('should build visualization from a graph with 3D layout', async () => {
        const mockGraph = {
            forEachNode: vi.fn((cb) => {
                cb({ id: 'C4', data: { degree: 5 } });
                cb({ id: 'G4', data: { degree: 3 } });
            }),
            forEachLinkedNode: vi.fn((id, cb) => {
                if (id === 'C4') cb({ id: 'G4' });
                if (id === 'G4') cb({ id: 'C4' });
            }),
            forEachLink: vi.fn((cb) => {
                cb({ fromId: 'C4', toId: 'G4', data: { weight: 2 } });
            }),
            addLink: vi.fn(),
            removeLink: vi.fn(),
            getNode: vi.fn((id) => ({ id, data: { degree: 1 } })),
        };

        await visualizer.buildVisualization(mockGraph);

        expect(createLayout).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                dimensions: 3,
            }),
        );
        expect(visualizer.nodes.has('C4')).toBe(true);
        expect(visualizer.nodes.has('G4')).toBe(true);

        const node = visualizer.nodes.get('C4');
        // Mock returns {x:0, y:0, z:0}, layoutScale is 10.0
        expect(node.mesh.position.z).toBe(0);

        expect(visualizer.edges.length).toBe(1);
        expect(visualizer.edgeMap.has('C4->G4')).toBe(true);
    });

    it('should handle isolated components by linking them to the main hub', async () => {
        const fakeLink = { fromId: 'C4', toId: 'E4', data: { isFake: true } };
        const mockGraph = {
            forEachNode: vi.fn((cb) => {
                cb({ id: 'C4', data: { degree: 1 } });
                cb({ id: 'E4', data: { degree: 1 } });
            }),
            forEachLinkedNode: vi.fn(() => {
                // No links, so completely isolated
            }),
            forEachLink: vi.fn(),
            addLink: vi.fn(() => fakeLink),
            removeLink: vi.fn(),
            removeEdge: vi.fn(),
            getNode: vi.fn((id) => ({ id, data: { degree: 1 } })),
        };

        await visualizer.buildVisualization(mockGraph);

        // It should have added a link to pull them together
        expect(mockGraph.addLink).toHaveBeenCalledWith(
            'C4',
            'E4',
            expect.objectContaining({ isFake: true }),
        );
        // It should NOT remove the link after layout because they need to be permanently simulated
        expect(mockGraph.removeLink).not.toHaveBeenCalledWith(fakeLink);
    });
    it('should highlight and release playing elements', () => {
        visualizer._initSharedGeometries();
        visualizer.graph = {
            getLink: vi.fn(() => ({
                fromId: 'C4',
                toId: 'G4',
                data: { weight: 1 },
            })),
        };
        visualizer.layout = {
            getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        };
        const nodeMesh = new THREE.Mesh(
            new THREE.SphereGeometry(),
            new THREE.MeshStandardMaterial(),
        );
        nodeMesh.userData = {
            type: 'node',
            id: 'C4',
            origEmissive: 0x000000,
            origEmissiveIntensity: 0.2,
        };
        visualizer.nodes.set('C4', {
            mesh: nodeMesh,
            playCount: 0,
            instanceId: 0,
            baseColor: new THREE.Color(0x000000),
        });

        const edgeLine = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial(),
        );
        edgeLine.userData = {
            type: 'edge',
            sourceId: 'C4',
            targetId: 'G4',
            origMaterial: edgeLine.material,
        };
        const edgeCone = {
            userData: { origMaterial: new THREE.MeshBasicMaterial() },
            material: new THREE.MeshBasicMaterial(),
            position: new THREE.Vector3(),
            instanceId: 0,
        };
        const edgeData = { line: edgeLine, cone: edgeCone, playCount: 0 };
        visualizer.edgeMap.set('C4->G4', edgeData);
        visualizer.edgeBufferIndexMap.set('C4->G4', 0);
        visualizer.instanceIdEdgeMap.set(0, 'C4->G4');

        visualizer.highlightPlayingElement('C4', null);
        expect(nodeMesh.material.emissiveIntensity).toBe(1.0);

        visualizer.highlightPlayingElement('G4', 'C4');
        expect(edgeData.playCount).toBe(1);
        expect(edgeLine.material).toBe(visualizer.highlightEdgeMaterial);

        visualizer.releasePlayingElement('C4', null);
        expect(nodeMesh.material.emissiveIntensity).toBe(0.2);

        visualizer.releasePlayingElement('G4', 'C4');
        expect(edgeData.playCount).toBe(0);
        expect(edgeLine.material).toBe(edgeLine.userData.origMaterial);
    });

    it('should show instrument emoji centered and scaled', () => {
        const nodeMesh = new THREE.Mesh(new THREE.SphereGeometry());
        nodeMesh.position.set(10, 20, 30);
        visualizer.nodes.set('C4', { mesh: nodeMesh });

        visualizer.showInstrumentEmoji('C4', '🎹');

        expect(visualizer.activeEmojis.length).toBe(1);
        const sprite = visualizer.activeEmojis[0].sprite;

        // Ensure the sprite is exactly at the node center
        expect(sprite.position.x).toBe(10);
        expect(sprite.position.y).toBe(20);
        expect(sprite.position.z).toBe(30);

        // Ensure the sprite is scaled up significantly (previously 15)
        expect(sprite.scale.x).toBeGreaterThan(25);
        expect(sprite.scale.y).toBeGreaterThan(25);
    });

    it('should pool emoji sprites', () => {
        const nodeMesh = new THREE.Mesh(new THREE.SphereGeometry());
        visualizer.nodes.set('C4', { mesh: nodeMesh });

        // Show 2 emojis
        visualizer.showInstrumentEmoji('C4', '🎹');
        visualizer.showInstrumentEmoji('C4', '🎹');
        expect(visualizer.activeEmojis.length).toBe(2);

        // Advance life to 0 for both
        visualizer.activeEmojis[0].life = 0;
        visualizer.activeEmojis[1].life = 0;

        // Run _updateEmojis to move them to pool
        // Note: _updateEmojis is called in animate, but we can call it directly
        visualizer._updateEmojis(1.0); // Pass delta to ensure life <= 0
        expect(visualizer.activeEmojis.length).toBe(0);
        expect(visualizer.emojiPool.length).toBe(2);

        // Show another emoji, it should reuse one from pool
        visualizer.showInstrumentEmoji('C4', '🎹');
        expect(visualizer.activeEmojis.length).toBe(1);
        expect(visualizer.emojiPool.length).toBe(1);
    });

    it('should limit active emojis to 100', () => {
        const nodeMesh = new THREE.Mesh(new THREE.SphereGeometry());
        visualizer.nodes.set('C4', { mesh: nodeMesh });

        for (let i = 0; i < 110; i++) {
            visualizer.showInstrumentEmoji('C4', '🎹');
        }
        expect(visualizer.activeEmojis.length).toBe(100);
    });

    it('should report layout progress during visualization building', async () => {
        const mockGraph = {
            forEachNode: vi.fn(),
            forEachLinkedNode: vi.fn(),
            forEachLink: vi.fn(),
            addLink: vi.fn(),
            removeLink: vi.fn(),
            getNode: vi.fn((id) => ({ id, data: { degree: 1 } })),
        };
        const progressSpy = vi.fn();
        visualizer.onLayoutProgress = progressSpy;

        // Set layout steps to something small or mock layout to finish fast
        // In NetworkVisualizer.js, totalSteps is 3000 and batchSize is 100.
        // It will call onLayoutProgress every 100 steps.

        await visualizer.buildVisualization(mockGraph);

        expect(progressSpy).toHaveBeenCalled();
        expect(progressSpy).toHaveBeenCalledWith(100); // Final call
    });

    it('should enable autoTour by default when buildVisualization is called', async () => {
        const mockGraph = {
            forEachNode: vi.fn(),
            forEachLinkedNode: vi.fn(),
            forEachLink: vi.fn(),
            addLink: vi.fn(),
            removeLink: vi.fn(),
            getNode: vi.fn((id) => ({ id, data: { degree: 1 } })),
        };

        expect(visualizer.autoTour).toBe(false);
        await visualizer.buildVisualization(mockGraph);
        expect(visualizer.autoTour).toBe(true);
    });

    it('should completely reset camera and movement state when fitting to graph', () => {
        // Setup initial mutated state
        visualizer.autoTour = true;
        visualizer.camera.zoom = 2.5;
        visualizer.camera.position.set(100, 200, 300);
        visualizer.camera.up.set(1, 0, 0); // mutated up vector

        // Add dummy node so nodes.size > 0
        visualizer.nodes.set('dummy', {
            mesh: { position: new THREE.Vector3(0, 0, 0) },
        });

        const updateProjectionSpy = vi.spyOn(
            visualizer.camera,
            'updateProjectionMatrix',
        );
        const controlsUpdateSpy = vi.spyOn(visualizer.controls, 'update');

        visualizer.fitCameraToGraph();

        // Assert resets
        expect(visualizer.autoTour).toBe(false);
        expect(visualizer.camera.zoom).toBe(1);
        // up vector should default back to standard Y-up
        expect(visualizer.camera.up.x).toBe(0);
        expect(visualizer.camera.up.y).toBe(1);
        expect(visualizer.camera.up.z).toBe(0);
        expect(updateProjectionSpy).toHaveBeenCalled();
        expect(controlsUpdateSpy).toHaveBeenCalled();
    });

    it('should update hover state', () => {
        visualizer._initSharedGeometries();
        const nodeMesh = new THREE.Mesh(
            new THREE.SphereGeometry(),
            new THREE.MeshStandardMaterial(),
        );
        nodeMesh.userData = {
            type: 'node',
            id: 'C4',
            origEmissive: 0,
            origEmissiveIntensity: 0.2,
        };
        visualizer.nodes.set('C4', {
            mesh: nodeMesh,
            instanceId: 0,
            baseColor: new THREE.Color(),
        });

        const onHoverSpy = vi.fn();
        visualizer.onHover = onHoverSpy;

        // Act: Hover over node
        visualizer._updateHoverState(nodeMesh);
        expect(visualizer.hoveredObject).toBe(nodeMesh);
        expect(nodeMesh.material.emissiveIntensity).toBe(0.8);
        expect(onHoverSpy).toHaveBeenCalledWith(nodeMesh.userData);

        // Act: Hover off
        visualizer._updateHoverState(null);
        expect(visualizer.hoveredObject).toBe(null);
        expect(nodeMesh.material.emissiveIntensity).toBe(0.2);
        expect(onHoverSpy).toHaveBeenCalledWith(null);
    });

    it('should reset all highlights', () => {
        visualizer._initSharedGeometries();
        visualizer.graph = {
            getLink: vi.fn(() => ({
                fromId: 'C4',
                toId: 'G4',
                data: { weight: 1 },
            })),
        };
        visualizer.layout = {
            getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        };
        const nodeMesh = new THREE.Mesh(
            new THREE.SphereGeometry(),
            new THREE.MeshStandardMaterial(),
        );
        nodeMesh.userData = {
            type: 'node',
            id: 'C4',
            origEmissive: 0,
            origEmissiveIntensity: 0,
        };
        const nodeData = {
            mesh: nodeMesh,
            playCount: 5,
            instanceId: 0,
            baseColor: new THREE.Color(),
        };
        visualizer.nodes.set('C4', nodeData);

        const edgeLine = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial(),
        );
        edgeLine.userData = {
            type: 'edge',
            sourceId: 'C4',
            targetId: 'G4',
            origMaterial: edgeLine.material,
        };
        const edgeCone = {
            userData: { origMaterial: new THREE.MeshBasicMaterial() },
            material: new THREE.MeshBasicMaterial(),
            position: new THREE.Vector3(),
            instanceId: 0,
        };
        const edgeData = { line: edgeLine, cone: edgeCone, playCount: 3 };
        visualizer.edgeMap.set('C4->G4', edgeData);
        visualizer.edgeBufferIndexMap.set('C4->G4', 0);
        visualizer.instanceIdEdgeMap.set(0, 'C4->G4');

        visualizer.playingNodes.add(nodeData);
        visualizer.playingEdges.add(edgeData);

        visualizer.resetPlayingHighlights();

        expect(nodeData.playCount).toBe(0);
        expect(edgeData.playCount).toBe(0);
        expect(visualizer.playingNodes.size).toBe(0);
        expect(visualizer.playingEdges.size).toBe(0);
    });

    it('should highlight nodes independently even if they share a pitch class', async () => {
        // C4 and C5 share pitch class 0
        const mockGraph = {
            forEachNode: vi.fn((cb) => {
                cb({ id: 'C4', data: { degree: 5 } });
                cb({ id: 'C5', data: { degree: 3 } });
            }),
            forEachLinkedNode: vi.fn(),
            forEachLink: vi.fn(),
            addLink: vi.fn(),
            removeLink: vi.fn(),
            getNode: vi.fn((id) => ({ id, data: { degree: 1 } })),
        };

        await visualizer.buildVisualization(mockGraph);

        const node1 = visualizer.nodes.get('C4').mesh;
        const node2 = visualizer.nodes.get('C5').mesh;

        // Act: Highlight only C4
        visualizer.highlightPlayingElement('C4', null);

        // Assert: C4 should be bright, C5 should remain dim
        expect(node1.material.emissiveIntensity).toBe(1.0);
        expect(node2.material.emissiveIntensity).toBe(0.2);
    });

    it('should maintain playing highlight when hovering off a node', async () => {
        const mockGraph = {
            forEachNode: vi.fn((cb) => {
                cb({ id: 'C4', data: { degree: 5 } });
            }),
            forEachLinkedNode: vi.fn(),
            forEachLink: vi.fn(),
            addLink: vi.fn(),
            removeLink: vi.fn(),
            getNode: vi.fn((id) => ({ id, data: { degree: 1 } })),
        };

        await visualizer.buildVisualization(mockGraph);
        const nodeData = visualizer.nodes.get('C4');
        const mesh = nodeData.mesh;

        // 1. Play the node
        visualizer.highlightPlayingElement('C4', null);
        expect(mesh.material.emissiveIntensity).toBe(1.0);
        const playingColor = mesh.material.emissive.getHex();

        // 2. Hover over it
        visualizer._updateHoverState(mesh);
        expect(mesh.material.emissive.getHex()).toBe(0xffffff); // Hover state (white)

        // 3. Hover off
        visualizer._updateHoverState(null);

        // 4. Should return to playing color and intensity, NOT original
        expect(mesh.material.emissiveIntensity).toBe(1.0);
        expect(mesh.material.emissive.getHex()).toBe(playingColor);
    });

    it('should handle window resize', () => {
        const setSizeSpy = vi.spyOn(visualizer.renderer, 'setSize');
        const composerSizeSpy = vi.spyOn(visualizer.composer, 'setSize');
        const updateProjectionSpy = vi.spyOn(
            visualizer.camera,
            'updateProjectionMatrix',
        );

        // Find the resize listener
        // It's added in initThree: window.addEventListener('resize', ...)
        const resizeListener = global.window.addEventListener.mock.calls.find(
            (call) => call[0] === 'resize',
        )[1];

        // Act
        resizeListener();

        // Assert
        expect(setSizeSpy).toHaveBeenCalled();
        expect(composerSizeSpy).toHaveBeenCalled();
        expect(updateProjectionSpy).toHaveBeenCalled();
    });

    describe('Raycasting', () => {
        it('should handle raycasting in animate loop', () => {
            visualizer.mouseMoved = true;
            visualizer._lastRaycastTime = 0;
            visualizer._raycastThrottleMs = 50;

            const dummyNode = new THREE.Mesh(
                new THREE.BufferGeometry(),
                new THREE.MeshStandardMaterial(),
            );
            dummyNode.userData = { type: 'node' };

            vi.spyOn(visualizer.raycaster, 'intersectObjects').mockReturnValue([
                { object: dummyNode },
            ]);

            const updateHoverSpy = vi.spyOn(visualizer, '_updateHoverState');

            visualizer.animate(100);

            expect(updateHoverSpy).toHaveBeenCalledWith(dummyNode);
            expect(visualizer.mouseMoved).toBe(false);
            expect(visualizer._lastRaycastTime).toBe(100);
        });

        it('should handle raycasting when no intersection', () => {
            visualizer.mouseMoved = true;
            visualizer._lastRaycastTime = 0;
            visualizer._raycastThrottleMs = 50;

            vi.spyOn(visualizer.raycaster, 'intersectObjects').mockReturnValue(
                [],
            );

            const updateHoverSpy = vi.spyOn(visualizer, '_updateHoverState');

            visualizer.animate(100);

            expect(updateHoverSpy).toHaveBeenCalledWith(null);
            expect(visualizer.mouseMoved).toBe(false);
            expect(visualizer._lastRaycastTime).toBe(100);
        });
    });

    describe('Edge Curvature', () => {
        it('should have subtle curvature (peak displacement < 10% of chord distance)', async () => {
            const mockGraph = {
                forEachNode: vi.fn((cb) => {
                    cb({ id: 'C4', data: { degree: 1 } });
                    cb({ id: 'G4', data: { degree: 1 } });
                }),
                forEachLink: vi.fn((cb) => {
                    cb({ fromId: 'C4', toId: 'G4', data: { weight: 1 } });
                }),
                forEachLinkedNode: vi.fn(),
                addLink: vi.fn(),
                removeLink: vi.fn(),
                getNode: vi.fn((id) => ({ id, data: { degree: 1 } })),
                getLink: vi.fn(() => ({
                    fromId: 'C4',
                    toId: 'G4',
                    data: { weight: 1 },
                })),
            };

            const mockLayout = {
                step: vi.fn(),
                getNodePosition: vi.fn((id) => {
                    if (id === 'C4') return { x: 0, y: 0, z: 0 };
                    if (id === 'G4') return { x: 100, y: 0, z: 0 };
                    return { x: 0, y: 0, z: 0 };
                }),
                dispose: vi.fn(),
                simulator: { getBody: vi.fn(() => ({ mass: 1 })) },
            };
            createLayout.mockReturnValue(mockLayout);

            await visualizer.buildVisualization(mockGraph);

            // Check the edgeLineSegments geometry instead of individual dummy line
            const positions =
                visualizer.edgeLineSegments.geometry.attributes.position.array;

            // 20 segments per edge, each segment has 2 vertices (pairs).
            // Vertex index 20 (middle of the curve)
            const vIdx = 20 * 3;
            const midX = positions[vIdx];
            const midY = positions[vIdx + 1];
            const midZ = positions[vIdx + 2];

            const midPoint = new THREE.Vector3(500, 0, 0);
            const peakPoint = new THREE.Vector3(midX, midY, midZ);
            const deviation = midPoint.distanceTo(peakPoint);

            expect(deviation).toBeLessThan(100);
        });
    });

    describe('Pausing', () => {
        it('should update isPaused state', () => {
            visualizer.setPaused(true);
            expect(visualizer.isPaused).toBe(true);
            visualizer.setPaused(false);
            expect(visualizer.isPaused).toBe(false);
        });

        it('should pass delta 0 to _updateEmojis when paused', () => {
            const updateSpy = vi.spyOn(visualizer, '_updateEmojis');
            visualizer.setPaused(true);
            visualizer._lastFrameTime = 1000;
            visualizer.animate(2000);
            expect(updateSpy).toHaveBeenCalledWith(0);
        });

        it('should pass normal delta when not paused', () => {
            const updateSpy = vi.spyOn(visualizer, '_updateEmojis');
            visualizer.setPaused(false);
            visualizer._lastFrameTime = 1000;

            // Add a mock emoji to cover movement code
            const mockEmoji = {
                life: 1.0,
                sprite: {
                    position: { addScaledVector: vi.fn() },
                    material: { opacity: 1 },
                },
            };
            visualizer.activeEmojis.push(mockEmoji);

            visualizer.animate(1500); // 500ms diff
            expect(updateSpy).toHaveBeenCalledWith(0.5);

            // Delta is 0.5, lifeStep is 1.25 * 0.5 = 0.625
            expect(mockEmoji.life).toBe(1.0 - 0.625);
            expect(
                mockEmoji.sprite.position.addScaledVector,
            ).toHaveBeenCalled();
        });
    });

    describe('Auto Tour', () => {
        it('should toggle autoTour state', () => {
            expect(visualizer.autoTour).toBe(false);
            visualizer.startAutoTour();
            expect(visualizer.autoTour).toBe(true);
            visualizer.stopAutoTour();
            expect(visualizer.autoTour).toBe(false);
        });

        it('should trigger onTourChange callback', () => {
            const callback = vi.fn();
            visualizer.onTourChange = callback;

            visualizer.startAutoTour();
            expect(callback).toHaveBeenCalledWith(true);

            visualizer.stopAutoTour();
            expect(callback).toHaveBeenCalledWith(false);

            // Should not trigger if state is same
            callback.mockClear();
            visualizer.stopAutoTour();
            expect(callback).not.toHaveBeenCalled();

            visualizer.startAutoTour();
            callback.mockClear();
            visualizer.startAutoTour();
            expect(callback).not.toHaveBeenCalled();
        });

        it('should stop autoTour on control interaction', () => {
            visualizer.startAutoTour();
            expect(visualizer.autoTour).toBe(true);

            // Trigger the "start" event on controls
            // In the real implementation we will add a listener
            if (visualizer.controls.addEventListener) {
                const startListener =
                    visualizer.controls.addEventListener.mock.calls.find(
                        (call) => call[0] === 'start',
                    )[1];
                if (startListener) startListener();
            } else {
                // If the mock doesn't support it yet, we might need to manually call the handler
                // but let's assume we'll update the mock or implementation to make this work.
                visualizer.stopAutoTour();
            }

            expect(visualizer.autoTour).toBe(false);
        });

        it('should stop autoTour when clear() is called', () => {
            visualizer.startAutoTour();
            expect(visualizer.autoTour).toBe(true);
            visualizer.clear();
            expect(visualizer.autoTour).toBe(false);
        });

        it('should have variable rotational movement over time', () => {
            visualizer.graphCenter = new THREE.Vector3(0, 0, 0);
            visualizer.graphRadius = 100;
            visualizer.startAutoTour();

            // Establish baseline and first measurement
            visualizer.animate(1000);
            const pos1 = visualizer.camera.position.clone();
            visualizer.animate(2000);
            const pos2 = visualizer.camera.position.clone();
            const dist1 = pos1.distanceTo(pos2);

            // Animate much later and second measurement
            visualizer.animate(11000);
            const pos3 = visualizer.camera.position.clone();
            visualizer.animate(12000);
            const pos4 = visualizer.camera.position.clone();
            const dist2 = pos3.distanceTo(pos4);

            // Verify that movement speed varies
            expect(dist1).not.toBeCloseTo(dist2, 5);
        });
    });

    describe('Organic Layout', () => {
        it('should assign higher mass to high-degree nodes in the simulator', async () => {
            const mockGraph = {
                forEachNode: vi.fn((cb) => {
                    cb({ id: 'C4', data: { degree: 10 } }); // High degree
                    cb({ id: 'E4', data: { degree: 1 } }); // Low degree
                }),
                forEachLink: vi.fn((cb) => {
                    cb({ fromId: 'C4', toId: 'E4', data: { weight: 1 } });
                }),
                forEachLinkedNode: vi.fn(),
                addLink: vi.fn(),
                removeLink: vi.fn(),
                getNode: vi.fn((id) => {
                    if (id === 'C4') return { id: 'C4', data: { degree: 10 } };
                    if (id === 'E4') return { id: 'E4', data: { degree: 1 } };
                    return null;
                }),
            };

            const mockLayout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
                dispose: vi.fn(),
                simulator: {
                    getBody: vi.fn(),
                    bodies: { forEach: vi.fn() },
                },
            };
            createLayout.mockReturnValue(mockLayout);
            await visualizer.buildVisualization(mockGraph);

            expect(createLayout).toHaveBeenCalledWith(
                mockGraph,
                expect.objectContaining({
                    physicsSettings: expect.objectContaining({
                        nodeMass: expect.any(Function),
                    }),
                }),
            );

            // Test the mass calculation logic directly
            const callArgs = createLayout.mock.calls[0];
            const nodeMassFn = callArgs[1].physicsSettings.nodeMass;

            // C4 degree is 10, E4 degree is 1
            expect(nodeMassFn('C4')).toBeGreaterThan(nodeMassFn('E4'));
        });

        it('should use tighter physics settings for layout', async () => {
            const mockGraph = {
                forEachNode: vi.fn(),
                forEachLinkedNode: vi.fn(),
                forEachLink: vi.fn(),
                addLink: vi.fn(),
                removeLink: vi.fn(),
            };

            await visualizer.buildVisualization(mockGraph);

            const callArgs = createLayout.mock.calls[0];
            const physics = callArgs[1].physicsSettings;

            // New desired settings
            expect(physics.springLength).toBeLessThan(200);
            expect(physics.springCoefficient).toBeGreaterThan(0.001);
            expect(physics.gravity).toBeGreaterThanOrEqual(-250);
        });

        it('should use a larger layout scale for better spacing', async () => {
            const mockGraph = {
                forEachNode: vi.fn((cb) =>
                    cb({ id: 'C4', data: { degree: 5 } }),
                ),
                forEachLinkedNode: vi.fn(),
                forEachLink: vi.fn(),
                addLink: vi.fn(),
                removeLink: vi.fn(),
            };

            // Mock the return value of createLayout to return a layout with a specific position
            const mockLayout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 10, y: 10, z: 10 })),
                dispose: vi.fn(),
                simulator: {
                    getBody: vi.fn(() => ({ mass: 1 })),
                    bodies: [],
                    settings: {},
                },
            };
            createLayout.mockReturnValue(mockLayout);

            await visualizer.buildVisualization(mockGraph);

            const node = visualizer.nodes.get('C4');
            // layoutScale is now 10.0, so 10 * 10 = 100.
            expect(node.mesh.position.x).toBe(100);
        });
    });

    describe('Incremental Visualization', () => {
        it('should initialize incremental mode', async () => {
            const mockGraph = { addNode: vi.fn(), addLink: vi.fn() };
            await visualizer.initIncremental(mockGraph);

            expect(visualizer.incrementalMode).toBe(true);
            expect(visualizer.graph).toBe(mockGraph);
            expect(createLayout).toHaveBeenCalled();
        });

        it('should add nodes and edges incrementally', async () => {
            const mockGraph = {
                addNode: vi.fn(),
                addLink: vi.fn(),
                getNode: vi.fn((id) => ({ id, data: { degree: 0 } })),
                getLink: vi.fn((s, t) => ({
                    fromId: s,
                    toId: t,
                    data: { weight: 1 },
                })),
            };
            await visualizer.initIncremental(mockGraph);

            // Mock NetworkParser.addTransition to return true (new link)
            vi.mocked(NetworkParser.addTransition).mockReturnValue(true);

            visualizer.addTransitionIncremental('C4', 'G4');

            expect(visualizer.nodes.has('C4')).toBe(true);
            expect(visualizer.nodes.has('G4')).toBe(true);
            expect(visualizer.edgeMap.has('C4->G4')).toBe(true);

            // Verify Three.js objects were added to graphGroup
            // 2 nodes + 1 edge line + 1 edge cone = 4 objects
            // (Outline meshes are children of node meshes, not graphGroup)
            expect(visualizer.graphGroup.children.length).toBe(4);
        });

        it('should update positions during animate in incremental mode', async () => {
            const mockGraph = {
                addNode: vi.fn(),
                addLink: vi.fn(),
                getNode: vi.fn((id) => ({ id, data: { degree: 1 } })),
                getLink: vi.fn((s, t) => ({
                    fromId: s,
                    toId: t,
                    data: { weight: 1 },
                })),
                forEachLink: vi.fn(),
                forEachNode: vi.fn(),
                removeLink: vi.fn(),
            };
            await visualizer.initIncremental(mockGraph);

            vi.mocked(NetworkParser.addTransition).mockReturnValue(true);
            visualizer.addTransitionIncremental('C4', 'G4');

            const layoutStepSpy = vi.spyOn(visualizer.layout, 'step');
            const updatePositionsSpy = vi.spyOn(
                visualizer,
                '_updatePositionsFromLayout',
            );

            visualizer.animate(1000);

            expect(layoutStepSpy).toHaveBeenCalled();
            expect(updatePositionsSpy).toHaveBeenCalled();
        });
    });
});

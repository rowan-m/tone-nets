import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { EffectComposer } from 'postprocessing';
import { NetworkVisualizer } from './NetworkVisualizer.js';
import { NetworkLayout } from './NetworkLayout.js';
import { VisualEffectsManager } from './VisualEffectsManager.js';

// --- Mocks ---
vi.mock('./NetworkParser.js', () => ({
    NetworkParser: {
        addTransition: vi.fn(),
    },
}));

export const mockNetworkLayoutConstructor = vi.fn();
export const mockVisualEffectsManagerConstructor = vi.fn();

vi.mock('./NetworkLayout.js', () => {
    return {
        NetworkLayout: vi.fn().mockImplementation(function () {
            mockNetworkLayoutConstructor(...arguments);
            this.layout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
                dispose: vi.fn(),
            };
            this.runSimulation = vi.fn((steps, progressCb) => {
                if (progressCb) progressCb(100);
                return Promise.resolve(true);
            });
            this.step = () => this.layout.step();
            this.getNodePosition = (id) => this.layout.getNodePosition(id);
            this.dispose = () => this.layout.dispose();
        }),
    };
});

vi.mock('./VisualEffectsManager.js', () => {
    return {
        VisualEffectsManager: vi.fn().mockImplementation(function () {
            mockVisualEffectsManagerConstructor(...arguments);
            this.activeEmojis = [];
            this.update = vi.fn();
            this.showInstrumentEmoji = vi.fn();
            this.clear = vi.fn();
        }),
    };
});

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
                dispose: vi.fn(),
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

vi.mock('postprocessing', () => {
    return {
        EffectComposer: vi.fn().mockImplementation(function () {
            return {
                addPass: vi.fn(),
                setSize: vi.fn(),
                render: vi.fn(),
                dispose: vi.fn(),
            };
        }),
        RenderPass: vi.fn(),
        EffectPass: vi.fn(),
        BloomEffect: vi.fn(),
    };
});

describe('NetworkVisualizer', () => {
    let visualizer;

    // --- Helpers ---
    const createMockNodeData = (id, instanceId = 0) => {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(),
            new THREE.MeshStandardMaterial(),
        );
        mesh.userData = {
            type: 'node',
            id,
            origEmissive: 0,
            origEmissiveIntensity: 0.2,
        };
        return {
            mesh,
            playCount: 0,
            instanceId,
            baseColor: new THREE.Color(),
        };
    };

    const createMockEdgeData = (sourceId, targetId, instanceId = 0) => {
        const line = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial(),
        );
        line.userData = {
            type: 'edge',
            sourceId,
            targetId,
            weight: 1,
            origMaterial: line.material,
        };
        const cone = {
            userData: { origMaterial: new THREE.MeshBasicMaterial() },
            material: new THREE.MeshBasicMaterial(),
            position: new THREE.Vector3(),
            instanceId,
        };
        return {
            line,
            cone,
            playCount: 0,
            sourceId,
            targetId,
            seed: Math.random(),
        };
    };

    const createMockGraph = (nodes = [], links = []) => {
        // Ensure links have data object with weight
        const sanitizedLinks = links.map((l) => ({
            ...l,
            data: l.data || { weight: 1 },
        }));

        return {
            forEachNode: vi.fn((cb) => {
                nodes.forEach((node) => cb(node));
            }),
            forEachLinkedNode: vi.fn((id, cb) => {
                sanitizedLinks.forEach((link) => {
                    if (link.fromId === id) cb({ id: link.toId });
                    if (link.toId === id) cb({ id: link.fromId });
                });
            }),
            forEachLink: vi.fn((cb) => {
                sanitizedLinks.forEach((link) => cb(link));
            }),
            addLink: vi.fn(),
            removeLink: vi.fn(),
            getNodesCount: vi.fn(() => nodes.length),
            getNode: vi.fn((id) => nodes.find((n) => n.id === id)),
            getLink: vi.fn((from, to) =>
                sanitizedLinks.find((l) => l.fromId === from && l.toId === to),
            ),
        };
    };

    beforeEach(() => {
        global.document = {
            getElementById: vi.fn(() => mockContainer),
            createElement: vi.fn(() => mockElement),
            body: {
                appendChild: vi.fn(),
                removeChild: vi.fn(),
            },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            visibilityState: 'visible',
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

    describe('Initialization & Cleanup', () => {
        it('should initialize with correct components (AAA Pattern)', () => {
            // Arrange & Act (done in beforeEach/constructor)

            // Assert
            expect(visualizer.scene).toBeDefined();
            expect(visualizer.camera).toBeDefined();
            expect(visualizer.renderer).toBeDefined();
            expect(visualizer.controls).toBeDefined();
            expect(visualizer.composer).toBeDefined();
            expect(THREE.WebGLRenderer).toHaveBeenCalled();
            expect(TrackballControls).toHaveBeenCalled();
            expect(EffectComposer).toHaveBeenCalled();
            expect(VisualEffectsManager).toHaveBeenCalled();
        });

        it('should completely reset state and clear the graph group on clear()', () => {
            // Arrange
            visualizer._initSharedGeometries();
            const nodeData = createMockNodeData('test');
            visualizer.nodes.set('test', nodeData);

            // Act
            visualizer.clear();

            // Assert
            // graphGroup now retains the 4 instanced rendering objects
            expect(visualizer.graphGroup.children.length).toBe(4);
            expect(visualizer.nodes.size).toBe(0);
            expect(visualizer.effects.clear).toHaveBeenCalled();
        });

        it('should dispose of all resources and remove listeners on dispose()', () => {
            // Arrange
            const disposeSpy = vi.spyOn(visualizer.renderer, 'dispose');
            const removeEventListenerSpy = vi.spyOn(
                window,
                'removeEventListener',
            );

            // Act
            visualizer.dispose();

            // Assert
            expect(disposeSpy).toHaveBeenCalled();
            expect(removeEventListenerSpy).toHaveBeenCalled();
            expect(visualizer._isAnimating).toBe(false);
        });

        it('should update paused state', () => {
            // Act & Assert
            visualizer.setPaused(true);
            expect(visualizer.isPaused).toBe(true);

            visualizer.setPaused(false);
            expect(visualizer.isPaused).toBe(false);
        });
    });

    describe('Building Visualization', () => {
        it('should build visualization from a graph and use NetworkLayout', async () => {
            // Arrange
            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 5 } },
                    { id: 'G4', data: { degree: 3 } },
                ],
                [{ fromId: 'C4', toId: 'G4', data: { weight: 2 } }],
            );

            // Act
            await visualizer.buildVisualization(mockGraph);

            // Assert
            expect(NetworkLayout).toHaveBeenCalledWith(mockGraph);
            expect(visualizer.nodes.has('C4')).toBe(true);
            expect(visualizer.nodes.has('G4')).toBe(true);

            const node = visualizer.nodes.get('C4');
            // Mock returns {x:0, y:0, z:0}, layoutScale is 10.0
            expect(node.mesh.position.z).toBe(0);
        });

        it('should handle disconnected components by linking them to the main hub', async () => {
            // Arrange
            const mockGraph = createMockGraph(
                [
                    { id: 'Hub', data: { degree: 10 } },
                    { id: 'Isolated1', data: { degree: 1 } },
                    { id: 'Isolated2', data: { degree: 1 } },
                ],
                [{ fromId: 'Isolated1', toId: 'Isolated2' }],
            );

            // Act
            await visualizer.buildVisualization(mockGraph);

            // Assert
            // It links the main component anchor to the isolated components
            expect(mockGraph.addLink).toHaveBeenCalledWith('Isolated1', 'Hub', {
                weight: 5,
                isFake: true,
            });
        });

        it('should handle empty graph in fitCameraToGraph', () => {
            // Arrange
            visualizer.nodes.clear();

            // Act & Assert
            expect(() => visualizer.fitCameraToGraph()).not.toThrow();
        });

        it('should report layout progress during visualization building', async () => {
            // Arrange
            const mockGraph = createMockGraph();
            const progressSpy = vi.fn();
            visualizer.onLayoutProgress = progressSpy;

            // Act
            await visualizer.buildVisualization(mockGraph);

            // Assert
            expect(progressSpy).toHaveBeenCalled();
            expect(progressSpy).toHaveBeenCalledWith(100); // Final call from mocked layout
        });
    });

    describe('Incremental Mode & Updates', () => {
        it('should initialize incremental mode and start autoTour', () => {
            // Arrange
            const mockGraph = createMockGraph();

            // Act
            visualizer.initIncremental(mockGraph);

            // Assert
            expect(visualizer.incrementalMode).toBe(true);
            expect(visualizer.autoTour).toBe(true);
            expect(visualizer.graph).toBe(mockGraph);
        });

        it('should handle addTransitionIncremental for new nodes and edges', () => {
            // Arrange
            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 1 } },
                    { id: 'G4', data: { degree: 1 } },
                ],
                [{ fromId: 'C4', toId: 'G4', data: { weight: 1 } }],
            );
            visualizer.graph = mockGraph;
            visualizer.incrementalMode = true;
            visualizer.layout = {
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };

            // Act
            visualizer.addTransitionIncremental('C4', 'G4');

            // Assert
            expect(visualizer.nodes.has('C4')).toBe(true);
            expect(visualizer.nodes.has('G4')).toBe(true);
            expect(visualizer.edgeMap.has('C4->G4')).toBe(true);
        });

        it('should schedule a global update when max metrics increase', () => {
            // Arrange
            vi.useFakeTimers();
            const mockGraph = createMockGraph(
                [
                    { id: 'C4', data: { degree: 10 } },
                    { id: 'G4', data: { degree: 1 } },
                ],
                [{ fromId: 'C4', toId: 'G4', data: { weight: 1 } }],
            );
            visualizer.graph = mockGraph;
            visualizer.incrementalMode = true;
            visualizer.layout = {
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };
            visualizer.maxDegree = 1;
            const updateSpy = vi.spyOn(visualizer, '_updateAllVisualScales');

            // Act
            visualizer.addTransitionIncremental('C4', 'G4');

            // Assert
            expect(visualizer.maxDegree).toBe(10);
            vi.runAllTimers();
            expect(updateSpy).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('should step physics in incremental mode during animate() and update positions', () => {
            // Arrange
            visualizer._initSharedGeometries();
            visualizer.incrementalMode = true;
            visualizer.graph = createMockGraph();
            visualizer.layout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 1, y: 2, z: 3 })),
            };
            visualizer._isAnimating = true;
            visualizer._lastFrameTime = 1000;

            const nodeData = createMockNodeData('A');
            visualizer.nodes.set('A', nodeData);
            visualizer.edges.push({ sourceId: 'A', targetId: 'B' });

            // Act
            visualizer.animate(1500);

            // Assert
            expect(visualizer.layout.step).toHaveBeenCalled();
            expect(nodeData.mesh.position.x).toBe(1 * visualizer.layoutScale);
        });

        it('should NOT step physics if incrementalMode is false', () => {
            // Arrange
            visualizer._initSharedGeometries();
            visualizer.incrementalMode = false;
            visualizer.graph = createMockGraph();
            visualizer.nodes.set('dummy', createMockNodeData('dummy'));
            visualizer.layout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };
            visualizer._isAnimating = true;

            // Act
            visualizer.animate(1500);

            // Assert
            expect(visualizer.layout.step).not.toHaveBeenCalled();
        });

        it('should NOT step physics if visualization is paused', () => {
            // Arrange
            visualizer._initSharedGeometries();
            visualizer.incrementalMode = true;
            visualizer.isPaused = true;
            visualizer.graph = createMockGraph();
            visualizer.nodes.set('dummy', createMockNodeData('dummy'));
            visualizer.layout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };
            visualizer._isAnimating = true;

            // Act
            visualizer.animate(1500);

            // Assert
            expect(visualizer.layout.step).not.toHaveBeenCalled();
        });

        it('should throttle physics on mobile', () => {
            // Arrange
            visualizer._initSharedGeometries();
            visualizer.incrementalMode = true;
            visualizer._isMobile = true;
            visualizer.graph = createMockGraph();
            visualizer.nodes.set('dummy', createMockNodeData('dummy'));
            visualizer.layout = {
                step: vi.fn(),
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };
            visualizer._isAnimating = true;

            // Act - Frame 0 becomes 1 (odd)
            visualizer._frameCount = 0;
            visualizer.animate(1500);
            expect(visualizer.layout.step).not.toHaveBeenCalled();

            // Act - Frame 1 becomes 2 (even)
            visualizer._frameCount = 1;
            visualizer.animate(2000);
            expect(visualizer.layout.step).toHaveBeenCalled();
        });
    });

    describe('Interactive Highlighting', () => {
        it('should highlight and release playing elements including edges and update buffers', () => {
            // Arrange
            visualizer._initSharedGeometries();
            const fromId = 'C4';
            const toId = 'G4';
            const edgeId = `${fromId}->${toId}`;

            // Mock a link in the graph to ensure _updateEdgeBuffer is called
            const link = { fromId, toId, data: { weight: 1 } };
            visualizer.graph = createMockGraph([], [link]);

            const nodeDataTo = createMockNodeData(toId, 1);
            visualizer.nodes.set(toId, nodeDataTo);
            visualizer.nodes.set(fromId, createMockNodeData(fromId, 0));

            const edgeData = createMockEdgeData(fromId, toId, 0);
            visualizer.edgeMap.set(edgeId, edgeData);
            visualizer.edgeBufferIndexMap.set(edgeId, 0);

            // Mock layout for edge buffer update
            visualizer.layout = {
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };

            const updateBufferSpy = vi.spyOn(visualizer, '_updateEdgeBuffer');

            // Act - Highlight
            visualizer.highlightPlayingElement(toId, fromId);

            // Assert
            expect(nodeDataTo.playCount).toBe(1);
            expect(edgeData.playCount).toBe(1);
            expect(visualizer.playingNodes.has(nodeDataTo)).toBe(true);
            expect(updateBufferSpy).toHaveBeenCalled();

            // Act - Release
            visualizer.releasePlayingElement(toId, fromId);

            // Assert
            expect(nodeDataTo.playCount).toBe(0);
            expect(edgeData.playCount).toBe(0);
            expect(updateBufferSpy).toHaveBeenCalledTimes(2);
        });

        it('should reset all highlights and update edge buffers', () => {
            // Arrange
            visualizer._initSharedGeometries();
            const fromId = 'C4';
            const toId = 'G4';
            const edgeId = `${fromId}->${toId}`;

            const nodeData = createMockNodeData(fromId);
            nodeData.playCount = 5;
            visualizer.nodes.set(fromId, nodeData);

            const edgeData = createMockEdgeData(fromId, toId);
            edgeData.playCount = 3;
            visualizer.edgeMap.set(edgeId, edgeData);
            visualizer.playingNodes.add(nodeData);
            visualizer.playingEdges.add(edgeData);

            // Mock link and layout
            const link = { fromId, toId, data: { weight: 1 } };
            visualizer.graph = createMockGraph([], [link]);
            visualizer.layout = {
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };

            const updateBufferSpy = vi.spyOn(visualizer, '_updateEdgeBuffer');

            // Act
            visualizer.resetPlayingHighlights();

            // Assert
            expect(nodeData.playCount).toBe(0);
            expect(edgeData.playCount).toBe(0);
            expect(visualizer.playingNodes.size).toBe(0);
            expect(updateBufferSpy).toHaveBeenCalled();
        });
    });

    describe('Raycasting & Hover', () => {
        it('should update hover state when intersecting a node', () => {
            // Arrange
            visualizer._initSharedGeometries();
            const nodeId = 'C4';
            const nodeData = createMockNodeData(nodeId);
            visualizer.nodes.set(nodeId, nodeData);
            visualizer.instanceIdNodeMap.set(0, nodeId);
            visualizer.graph = createMockGraph([{ id: nodeId }]);

            visualizer.raycaster.intersectObjects = vi.fn(() => [
                { object: visualizer.nodeInstancedMesh, instanceId: 0 },
            ]);
            visualizer.mouseMoved = true;
            const hoverSpy = vi.fn();
            visualizer.onHover = hoverSpy;

            // Act
            visualizer._performRaycast();

            // Assert
            expect(visualizer.hoveredObject).toBe(nodeData.mesh);
            expect(hoverSpy).toHaveBeenCalledWith(nodeData.mesh.userData);
        });

        it('should update hover state when intersecting an edge and update buffer', () => {
            // Arrange
            visualizer._initSharedGeometries();
            const fromId = 'C4';
            const toId = 'G4';
            const edgeId = `${fromId}->${toId}`;

            const edgeData = createMockEdgeData(fromId, toId);
            visualizer.edgeMap.set(edgeId, edgeData);
            visualizer.instanceIdEdgeMap.set(0, edgeId);

            // Mock link and layout
            const link = { fromId, toId, data: { weight: 1 } };
            visualizer.graph = createMockGraph([], [link]);
            visualizer.layout = {
                getNodePosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
            };

            visualizer.raycaster.intersectObjects = vi.fn(() => [
                { object: visualizer.edgeLineSegments, index: 0 },
            ]);
            visualizer.mouseMoved = true;
            const updateBufferSpy = vi.spyOn(visualizer, '_updateEdgeBuffer');

            // Act
            visualizer._performRaycast();

            // Assert
            expect(visualizer.hoveredObject).toBe(edgeData.line);
            expect(updateBufferSpy).toHaveBeenCalled();
        });

        it('should handle intersection with arbitrary pickable objects', () => {
            // Arrange
            visualizer._initSharedGeometries();
            const arbitraryObject = new THREE.Mesh();
            visualizer.raycaster.intersectObjects = vi.fn(() => [
                { object: arbitraryObject },
            ]);
            visualizer.mouseMoved = true;

            // Act
            visualizer._performRaycast();

            // Assert
            expect(visualizer.hoveredObject).toBe(arbitraryObject);
        });

        it('should clear hover state when nothing is hit', () => {
            // Arrange
            visualizer._initSharedGeometries();
            visualizer.hoveredObject = {
                material: {
                    emissive: new THREE.Color(),
                    emissiveIntensity: 1.0,
                },
                userData: {
                    origEmissiveIntensity: 0.2,
                    origEmissive: 0,
                    type: 'node',
                    id: 'test',
                },
            };
            visualizer.nodes.set('test', createMockNodeData('test'));
            visualizer.raycaster.intersectObjects = vi.fn(() => []);
            visualizer.mouseMoved = true;

            // Act
            visualizer._performRaycast();

            // Assert
            expect(visualizer.hoveredObject).toBeNull();
        });
    });

    describe('Animation Loop & Visibility', () => {
        it('should short-circuit animate() if the visualization is completely empty', () => {
            // Arrange
            visualizer._isAnimating = true;
            visualizer.graph = null;
            visualizer.nodes.clear();
            visualizer.effects.activeEmojis = [];
            const stepSpy = vi.spyOn(visualizer, '_stepIncrementalPhysics');

            // Act
            visualizer.animate(1000);

            // Assert
            expect(stepSpy).not.toHaveBeenCalled();
            expect(visualizer._lastFrameTime).toBe(1000);
        });

        it('should skip heavy updates when document is hidden', () => {
            // Arrange
            global.document.visibilityState = 'hidden';
            visualizer._isAnimating = true;
            visualizer.graph = {}; // Not empty
            const stepSpy = vi.spyOn(visualizer, '_stepIncrementalPhysics');

            // Act
            visualizer.animate(1000);

            // Assert
            expect(stepSpy).not.toHaveBeenCalled();
            expect(visualizer._lastFrameTime).toBe(1000);
        });

        it('should call effectsManager.update and render on each tick', () => {
            // Arrange
            visualizer._isAnimating = true;
            visualizer.graph = createMockGraph();
            visualizer.nodes.set('dummy', createMockNodeData('dummy'));
            visualizer._lastFrameTime = 1000;

            // Act
            visualizer.animate(1500); // 500ms diff

            // Assert
            expect(visualizer.effects.update).toHaveBeenCalledWith(0.5);
            expect(visualizer.composer.render).toHaveBeenCalled();
        });

        it('should handle window resize gracefully', () => {
            // Arrange
            const setSizeSpy = vi.spyOn(visualizer.renderer, 'setSize');
            const resizeListener =
                global.window.addEventListener.mock.calls.find(
                    (call) => call[0] === 'resize',
                )[1];

            // Act
            resizeListener();

            // Assert
            expect(setSizeSpy).toHaveBeenCalled();
        });
    });

    describe('Camera & Tour Logic', () => {
        it('should reset camera state when fitting to graph', () => {
            // Arrange
            visualizer.autoTour = true;
            visualizer.camera.zoom = 2.5;
            visualizer.nodes.set('dummy', {
                mesh: { position: new THREE.Vector3(0, 0, 0) },
            });

            // Act
            visualizer.fitCameraToGraph();

            // Assert
            expect(visualizer.autoTour).toBe(false);
            expect(visualizer.camera.zoom).toBe(1);
        });

        it('should toggle autoTour and trigger onTourChange callback', () => {
            // Arrange
            const tourChangeSpy = vi.fn();
            visualizer.onTourChange = tourChangeSpy;

            // Act & Assert
            visualizer.startAutoTour();
            expect(visualizer.autoTour).toBe(true);
            expect(tourChangeSpy).toHaveBeenCalledWith(true);

            visualizer.stopAutoTour();
            expect(visualizer.autoTour).toBe(false);
            expect(tourChangeSpy).toHaveBeenCalledWith(false);
        });

        it('should update camera and controls during autoTour in animate()', () => {
            // Arrange
            visualizer.nodes.set('dummy', createMockNodeData('dummy'));
            visualizer.graphCenter = new THREE.Vector3(0, 0, 0);
            visualizer.graphRadius = 100;
            visualizer.startAutoTour();
            visualizer._isAnimating = true;
            visualizer._lastFrameTime = 1000;

            const lookAtSpy = vi.spyOn(visualizer.camera, 'lookAt');

            // Act
            visualizer.animate(1500); // 500ms delta

            // Assert
            expect(lookAtSpy).toHaveBeenCalled();
        });
    });
});

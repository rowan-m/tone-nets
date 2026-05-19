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

    describe('Initialization & Cleanup', () => {
        it('should initialize with correct components', () => {
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
            const dummy = new THREE.Mesh(
                new THREE.SphereGeometry(),
                new THREE.MeshStandardMaterial(),
            );
            visualizer.nodes.set('test', { mesh: dummy });

            // Act
            visualizer.clear();

            // Assert
            // graphGroup now retains the 4 instanced rendering objects
            expect(visualizer.graphGroup.children.length).toBe(4);
            expect(visualizer.nodes.size).toBe(0);
            expect(visualizer.effects.clear).toHaveBeenCalled();
        });
    });

    describe('Building Visualization', () => {
        it('should build visualization from a graph and use NetworkLayout', async () => {
            // Arrange
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

        it('should handle isolated components by linking them to the main hub before layout', async () => {
            // Arrange
            const mockGraph = {
                forEachNode: vi.fn((cb) => {
                    cb({ id: 'Hub', data: { degree: 10 } });
                    cb({ id: 'Isolated1', data: { degree: 1 } });
                    cb({ id: 'Isolated2', data: { degree: 1 } });
                }),
                forEachLinkedNode: vi.fn((id, cb) => {
                    // Isolated1 and Isolated2 are linked to each other, but not to Hub
                    if (id === 'Isolated1') cb({ id: 'Isolated2' });
                    if (id === 'Isolated2') cb({ id: 'Isolated1' });
                }),
                forEachLink: vi.fn(),
                addLink: vi.fn(),
                removeLink: vi.fn(),
                getNodesCount: vi.fn(() => 3),
                getNode: vi.fn((id) => {
                    if (id === 'Hub') return { id, data: { degree: 10 } };
                    return { id, data: { degree: 1 } };
                }),
            };

            // Act
            await visualizer.buildVisualization(mockGraph);

            // Assert
            // It links the main component anchor to the isolated components
            expect(mockGraph.addLink).toHaveBeenCalledWith('Isolated1', 'Hub', {
                weight: 5,
                isFake: true,
            });
        });

        it('should report layout progress during visualization building', async () => {
            // Arrange
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

            // Act
            await visualizer.buildVisualization(mockGraph);

            // Assert
            expect(progressSpy).toHaveBeenCalled();
            expect(progressSpy).toHaveBeenCalledWith(100); // Final call from mocked layout
        });
    });

    describe('Interactive Highlighting', () => {
        it('should highlight and release playing elements', () => {
            // Arrange
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
            const nodeData = {
                mesh: nodeMesh,
                playCount: 0,
                instanceId: 0,
                baseColor: new THREE.Color(),
            };
            visualizer.nodes.set('C4', nodeData);

            // Act - Highlight
            visualizer.highlightPlayingElement('C4', null);

            // Assert
            expect(nodeData.playCount).toBe(1);
            expect(visualizer.playingNodes.has(nodeData)).toBe(true);
            expect(nodeMesh.material.emissiveIntensity).toBe(1.0);

            // Act - Release
            visualizer.releasePlayingElement('C4', null);

            // Assert
            expect(nodeData.playCount).toBe(0);
            expect(visualizer.playingNodes.has(nodeData)).toBe(false);
            expect(nodeMesh.material.emissiveIntensity).toBe(0.2); // Returns to normal
        });

        it('should reset all highlights', () => {
            // Arrange
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

            // Act
            visualizer.resetPlayingHighlights();

            // Assert
            expect(nodeData.playCount).toBe(0);
            expect(edgeData.playCount).toBe(0);
            expect(visualizer.playingNodes.size).toBe(0);
            expect(visualizer.playingEdges.size).toBe(0);
        });

        it('should maintain playing highlight when hovering off a node', async () => {
            // Arrange
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

            // Act 1. Play the node
            visualizer.highlightPlayingElement('C4', null);
            expect(mesh.material.emissiveIntensity).toBe(1.0);
            const playingColor = mesh.material.emissive.getHex();

            // Act 2. Hover over it
            visualizer._updateHoverState(mesh);
            expect(mesh.material.emissive.getHex()).toBe(0xffffff); // Hover state (white)

            // Act 3. Hover off
            visualizer._updateHoverState(null);

            // Assert 4. Should return to playing color and intensity, NOT original
            expect(mesh.material.emissiveIntensity).toBe(1.0);
            expect(mesh.material.emissive.getHex()).toBe(playingColor);
        });
    });

    describe('Visual Feedback Delegation', () => {
        it('should delegate showInstrumentEmoji to VisualEffectsManager', () => {
            // Arrange
            const nodeMesh = new THREE.Mesh(new THREE.SphereGeometry());
            nodeMesh.position.set(10, 20, 30);
            visualizer.nodes.set('C4', { mesh: nodeMesh });

            // Act
            visualizer.showInstrumentEmoji('C4', '🎹');

            // Assert
            expect(visualizer.effects.showInstrumentEmoji).toHaveBeenCalledWith(
                nodeMesh.position,
                '🎹',
            );
        });
    });

    describe('Camera & Tour Logic', () => {
        it('should enable autoTour by default when buildVisualization is called', async () => {
            // Arrange
            const mockGraph = {
                forEachNode: vi.fn(),
                forEachLinkedNode: vi.fn(),
                forEachLink: vi.fn(),
                addLink: vi.fn(),
                removeLink: vi.fn(),
                getNode: vi.fn((id) => ({ id, data: { degree: 1 } })),
            };

            // Act
            await visualizer.buildVisualization(mockGraph);

            // Assert
            expect(visualizer.autoTour).toBe(true);
        });

        it('should completely reset camera and movement state when fitting to graph', () => {
            // Arrange
            visualizer.autoTour = true;
            visualizer.camera.zoom = 2.5;
            visualizer.camera.position.set(100, 200, 300);
            visualizer.camera.up.set(1, 0, 0); // mutated up vector

            visualizer.nodes.set('dummy', {
                mesh: { position: new THREE.Vector3(0, 0, 0) },
            });

            const updateProjectionSpy = vi.spyOn(
                visualizer.camera,
                'updateProjectionMatrix',
            );
            const controlsUpdateSpy = vi.spyOn(visualizer.controls, 'update');

            // Act
            visualizer.fitCameraToGraph();

            // Assert
            expect(visualizer.autoTour).toBe(false);
            expect(visualizer.camera.zoom).toBe(1);
            expect(visualizer.camera.up.x).toBe(0);
            expect(visualizer.camera.up.y).toBe(1);
            expect(visualizer.camera.up.z).toBe(0);
            expect(updateProjectionSpy).toHaveBeenCalled();
            expect(controlsUpdateSpy).toHaveBeenCalled();
        });
    });

    describe('Animation Loop', () => {
        beforeEach(() => {
            visualizer.graph = {};
            visualizer._isAnimating = true;
        });

        it('should call effectsManager.update on each tick', () => {
            // Arrange
            visualizer.setPaused(false);
            visualizer._lastFrameTime = 1000;

            // Act
            visualizer.animate(1500); // 500ms diff

            // Assert
            expect(visualizer.effects.update).toHaveBeenCalledWith(0.5);
        });

        it('should handle window resize gracefully', () => {
            // Arrange
            const setSizeSpy = vi.spyOn(visualizer.renderer, 'setSize');
            const composerSizeSpy = vi.spyOn(visualizer.composer, 'setSize');
            const updateProjectionSpy = vi.spyOn(
                visualizer.camera,
                'updateProjectionMatrix',
            );

            const resizeListener =
                global.window.addEventListener.mock.calls.find(
                    (call) => call[0] === 'resize',
                )[1];

            // Act
            resizeListener();

            // Assert
            expect(setSizeSpy).toHaveBeenCalled();
            expect(composerSizeSpy).toHaveBeenCalled();
            expect(updateProjectionSpy).toHaveBeenCalled();
        });
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import createLayout from 'ngraph.forcelayout';
import { EffectComposer } from 'postprocessing';
import { NetworkVisualizer } from './NetworkVisualizer.js';

// --- Mocks ---

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

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => {
    return {
        OrbitControls: vi.fn().mockImplementation(function () {
            return {
                enableDamping: false,
                dampingFactor: 0,
                update: vi.fn(),
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
                getNodePosition: vi.fn(() => ({ x: 0, y: 0 })),
                dispose: vi.fn(),
                simulator: {
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
        expect(OrbitControls).toHaveBeenCalled();
        expect(EffectComposer).toHaveBeenCalled();
    });

    it('should clear the graph group and materials', () => {
        const dummy = new THREE.Mesh(
            new THREE.SphereGeometry(),
            new THREE.MeshBasicMaterial(),
        );
        visualizer.graphGroup.add(dummy);
        visualizer.nodes.set('test', { mesh: dummy });

        const disposeSpy = vi.spyOn(dummy.geometry, 'dispose');

        visualizer.clear();

        expect(visualizer.graphGroup.children.length).toBe(0);
        expect(visualizer.nodes.size).toBe(0);
        expect(disposeSpy).toHaveBeenCalled();
    });

    it('should build visualization from a graph', async () => {
        const mockGraph = {
            forEachNode: vi.fn((cb) => {
                cb({ id: 'C4', data: { degree: 5 } });
                cb({ id: 'G4', data: { degree: 3 } });
            }),
            forEachLink: vi.fn((cb) => {
                cb({ fromId: 'C4', toId: 'G4', data: { weight: 2 } });
            }),
        };

        await visualizer.buildVisualization(mockGraph);

        expect(createLayout).toHaveBeenCalled();
        expect(visualizer.nodes.has('C4')).toBe(true);
        expect(visualizer.nodes.has('G4')).toBe(true);
        expect(visualizer.edges.length).toBe(1);
        expect(visualizer.edgeMap.has('C4->G4')).toBe(true);
    });

    it('should highlight and release playing elements', () => {
        const nodeMesh = new THREE.Mesh(
            new THREE.SphereGeometry(),
            new THREE.MeshStandardMaterial(),
        );
        nodeMesh.userData = {
            type: 'node',
            origEmissive: 0x000000,
            origEmissiveIntensity: 0.2,
        };
        visualizer.nodes.set('C4', { mesh: nodeMesh, playCount: 0 });

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
        const edgeData = { line: edgeLine, playCount: 0 };
        visualizer.edgeMap.set('C4->G4', edgeData);

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

    it('should show instrument emoji', () => {
        const nodeMesh = new THREE.Mesh(new THREE.SphereGeometry());
        nodeMesh.position.set(10, 20, 30);
        visualizer.nodes.set('C4', { mesh: nodeMesh });

        visualizer.showInstrumentEmoji('C4', '🎹');

        expect(visualizer.activeEmojis.length).toBe(1);
        expect(visualizer.activeEmojis[0].sprite.position.x).toBe(10);
        expect(visualizer.activeEmojis[0].sprite.position.y).toBe(20);
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
            forEachLink: vi.fn(),
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

    it('should fit camera to graph', () => {
        // Arrange
        const dummy = new THREE.Mesh(new THREE.SphereGeometry());
        visualizer.graphGroup.add(dummy);

        // Mock camera projection matrix update
        const updateSpy = vi.spyOn(visualizer.camera, 'updateProjectionMatrix');

        // Act
        visualizer.fitCameraToGraph();

        // Assert
        expect(updateSpy).toHaveBeenCalled();
        expect(visualizer.camera.zoom).toBe(1);
    });

    it('should update hover state', () => {
        const nodeMesh = new THREE.Mesh(
            new THREE.SphereGeometry(),
            new THREE.MeshStandardMaterial(),
        );
        nodeMesh.userData = {
            type: 'node',
            origEmissive: 0,
            origEmissiveIntensity: 0.2,
        };

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
        const nodeMesh = new THREE.Mesh(
            new THREE.SphereGeometry(),
            new THREE.MeshStandardMaterial(),
        );
        nodeMesh.userData = {
            type: 'node',
            origEmissive: 0,
            origEmissiveIntensity: 0,
        };
        const nodeData = { mesh: nodeMesh, playCount: 5 };
        visualizer.nodes.set('C4', nodeData);

        const edgeLine = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial(),
        );
        edgeLine.userData = { type: 'edge', origMaterial: edgeLine.material };
        const edgeData = { line: edgeLine, playCount: 3 };
        visualizer.edgeMap.set('C4->G4', edgeData);

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
            forEachLink: vi.fn(),
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
            forEachLink: vi.fn(),
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
            visualizer.animate(1500); // 500ms diff
            expect(updateSpy).toHaveBeenCalledWith(0.5);
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
    });
});

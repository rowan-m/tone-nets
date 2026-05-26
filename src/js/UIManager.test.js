import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager } from './UIManager.js';

describe('UIManager', () => {
    let uiManager;
    let mockCallbacks;
    let mockElements;
    let mockIntervalBars;

    // Helper to create a functional mock element
    const createMockElement = (id) => {
        const classes = new Set();
        const listeners = {};
        const attributes = {};
        return {
            id,
            addEventListener: vi.fn((event, cb) => {
                listeners[event] = cb;
            }),
            removeEventListener: vi.fn((event) => {
                delete listeners[event];
            }),
            dispatchEvent: (event) => {
                if (listeners[event.type]) {
                    listeners[event.type](event);
                }
            },
            classList: {
                add: vi.fn((cls) => classes.add(cls)),
                remove: vi.fn((cls) => classes.delete(cls)),
                toggle: vi.fn((cls) => {
                    if (classes.has(cls)) {
                        classes.delete(cls);
                        return false;
                    }
                    classes.add(cls);
                    return true;
                }),
                contains: vi.fn((cls) => classes.has(cls)),
            },
            contains: vi.fn(() => false),
            showModal: vi.fn(function () {
                this.open = true;
            }),
            close: vi.fn(function () {
                this.open = false;
            }),
            focus: vi.fn(),
            click: vi.fn(function () {
                if (listeners['click']) listeners['click']({ target: this });
            }),
            appendChild: vi.fn(),
            setAttribute: vi.fn((name, val) => {
                attributes[name] = val;
            }),
            getAttribute: vi.fn((name) => attributes[name]),
            dataset: {},
            style: {},
            textContent: '',
            value: '',
            files: [],
            disabled: false,
            open: false,
        };
    };

    beforeEach(() => {
        mockElements = {};
        mockIntervalBars = Array.from({ length: 12 }, (_, i) =>
            createMockElement(`bar-${i}`),
        );

        mockCallbacks = {
            onIncrementalToggle: vi.fn(),
            onAutoplayToggle: vi.fn(),
            onLoopToggle: vi.fn(),
            onTourToggle: vi.fn(),
            onThemeCycle: vi.fn(),
            onTogglePlayPause: vi.fn(),
            onRestart: vi.fn(),
            onFileSelection: vi.fn(),
            onExampleMidiClick: vi.fn(),
            isPlaying: vi.fn(() => false),
            onVisibilityChange: vi.fn(),
        };

        vi.stubGlobal('document', {
            getElementById: vi.fn((id) => {
                if (!mockElements[id]) {
                    mockElements[id] = createMockElement(id);
                }
                return mockElements[id];
            }),
            querySelectorAll: vi.fn(() => mockIntervalBars),
            addEventListener: vi.fn(),
            activeElement: {},
            createElement: vi.fn((tag) => createMockElement(tag)),
            createTextNode: vi.fn((text) => ({
                nodeType: 3,
                textContent: text,
            })),
            visibilityState: 'visible',
        });

        vi.stubGlobal('window', {
            innerWidth: 1024,
            addEventListener: vi.fn(),
        });

        vi.stubGlobal('navigator', {
            mediaSession: {
                setActionHandler: vi.fn(),
            },
        });

        uiManager = new UIManager(mockCallbacks);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('Initialization', () => {
        it('should lookup elements and setup initial modal state', () => {
            // Assert
            expect(document.getElementById).toHaveBeenCalledWith('midi-upload');
            expect(mockElements['status-modal'].showModal).toHaveBeenCalled();
            expect(
                mockElements['incremental-toggle'].addEventListener,
            ).toHaveBeenCalledWith('change', expect.any(Function));
        });

        it('should setup media session handlers if available', () => {
            // Assert
            expect(
                navigator.mediaSession.setActionHandler,
            ).toHaveBeenCalledWith('play', expect.any(Function));
            expect(
                navigator.mediaSession.setActionHandler,
            ).toHaveBeenCalledWith('pause', expect.any(Function));
        });
    });

    describe('Status Modal', () => {
        it('should show status with specified text', () => {
            // Act
            uiManager.showStatus('Loading...');

            // Assert
            expect(mockElements['status-modal-text'].textContent).toBe(
                'Loading...',
            );
            expect(mockElements['status-modal'].showModal).toHaveBeenCalled();
        });

        it('should hide status and remove loading class', () => {
            // Arrange
            mockElements['status-modal'].open = true;

            // Act
            uiManager.hideStatus();

            // Assert
            expect(mockElements['status-modal'].close).toHaveBeenCalled();
            expect(
                mockElements['status-modal'].classList.remove,
            ).toHaveBeenCalledWith('pre-loading');
        });

        it('should prevent default on modal cancel to keep it non-dismissable', () => {
            // Arrange
            const mockEvent = { preventDefault: vi.fn(), type: 'cancel' };

            // Act
            mockElements['status-modal'].dispatchEvent(mockEvent);

            // Assert
            expect(mockEvent.preventDefault).toHaveBeenCalled();
        });

        it('should show error and log to console', () => {
            // Arrange
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});

            // Act
            uiManager.showError('Oops', new Error('test'));

            // Assert
            expect(consoleSpy).toHaveBeenCalledWith('Oops', expect.any(Error));
            expect(mockElements['status-modal-text'].textContent).toContain(
                'Oops',
            );
            consoleSpy.mockRestore();
        });
    });

    describe('UI Toggling', () => {
        it('should toggle UI hidden class and manage focus', () => {
            // Arrange
            mockElements['app'].classList.toggle.mockReturnValue(true); // becomes hidden
            document.activeElement = mockElements['hide-ui'];

            // Act
            uiManager.toggleUi();

            // Assert
            expect(mockElements['app'].classList.toggle).toHaveBeenCalledWith(
                'ui-hidden',
            );
            expect(mockElements['show-ui'].focus).toHaveBeenCalled();
        });

        it('should focus hide button when UI becomes visible', () => {
            // Arrange
            mockElements['app'].classList.toggle.mockReturnValue(false); // becomes visible
            document.activeElement = mockElements['show-ui'];

            // Act
            uiManager.toggleUi();

            // Assert
            expect(mockElements['hide-ui'].focus).toHaveBeenCalled();
        });
    });

    describe('Playback UI', () => {
        it('should show pause button and focus it when playing starts', () => {
            // Arrange
            document.activeElement = mockElements['play-btn'];

            // Act
            uiManager.setPlaybackUI(true);

            // Assert
            expect(mockElements['play-btn'].classList.add).toHaveBeenCalledWith(
                'hidden',
            );
            expect(
                mockElements['pause-btn'].classList.remove,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['pause-btn'].focus).toHaveBeenCalled();
        });

        it('should show play button and focus it when playing stops', () => {
            // Arrange
            document.activeElement = mockElements['pause-btn'];

            // Act
            uiManager.setPlaybackUI(false);

            // Assert
            expect(
                mockElements['play-btn'].classList.remove,
            ).toHaveBeenCalledWith('hidden');
            expect(
                mockElements['pause-btn'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['play-btn'].focus).toHaveBeenCalled();
        });

        it('should update theme button with emoji and set document attribute', () => {
            // Arrange
            const mockDocElement = createMockElement('html');
            const originalDoc = document;
            vi.stubGlobal('document', {
                ...originalDoc,
                documentElement: mockDocElement,
                getElementById: (id) =>
                    mockElements[id] || createMockElement(id),
                createElement: (tag) => createMockElement(tag),
                createTextNode: (text) => ({ nodeType: 3, textContent: text }),
            });

            // Act
            uiManager.setThemeUI({ name: 'terminator', emoji: '💀' });

            // Assert
            const appendCalls =
                mockElements['theme-btn'].appendChild.mock.calls;
            const span = appendCalls[0][0];
            expect(span.textContent).toBe('💀');
            expect(mockDocElement.setAttribute).toHaveBeenCalledWith(
                'data-theme',
                'terminator',
            );
        });
    });

    describe('Metrics Updates', () => {
        const mockSummary = {
            title: 'Test Song',
            vertices: 10,
            edges: 20,
            efficiency: 0.5,
            weightedEfficiency: 0.4,
            entropy: 1.2,
            binaryReciprocity: 0.3,
            reciprocity: 0.2,
            reciprocityRho: 0.1,
            density: 0.05,
            embedding: Array.from({ length: 12 }, () => 0.1),
        };

        it('should update text content for all metric elements', () => {
            // Act
            uiManager.updateMetrics(mockSummary, 'test.mid', false);

            // Assert
            expect(mockElements['v-count'].textContent).toBe(10);
            expect(mockElements['e-count'].textContent).toBe(20);
            expect(mockElements['metric-efficiency'].textContent).toBe(0.5);
            expect(mockElements['metric-density'].textContent).toBe(0.05);
        });

        it('should truncate extremely long titles', () => {
            // Arrange
            const longTitle = 'A'.repeat(50);
            const summary = { ...mockSummary, title: longTitle };

            // Act
            uiManager.updateMetrics(summary, 'test.mid', false);

            // Assert
            expect(mockElements['app-title'].textContent.length).toBe(35);
            expect(mockElements['app-title'].textContent).toMatch(/\.\.\.$/);
        });

        it('should fallback to filename if title is missing', () => {
            // Arrange
            const summary = { ...mockSummary, title: '' };

            // Act
            uiManager.updateMetrics(summary, 'my-file.mid', false);

            // Assert
            expect(mockElements['app-title'].textContent).toBe('my-file.mid');
        });

        it('should update interval bars with percentages', () => {
            // Act
            uiManager.updateMetrics(mockSummary, 'test.mid', false);

            // Assert
            expect(mockIntervalBars[0].style.height).toBe('10%');
            expect(mockIntervalBars[0].getAttribute('aria-valuenow')).toBe(10);
        });

        it('should automatically hide info panel on small screens', () => {
            // Arrange
            vi.stubGlobal('window', { innerWidth: 500 });

            // Act
            uiManager.updateMetrics(mockSummary, 'test.mid', false);

            // Assert
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['stats-toggle'].checked).toBe(false);
        });

        it('should hide info panel in incremental mode regardless of screen size', () => {
            // Act
            uiManager.updateMetrics(mockSummary, 'test.mid', true);

            // Assert
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
        });
    });

    describe('Hover Information', () => {
        it('should hide hover panel when data is null', () => {
            // Act
            uiManager.updateHoverInfo(null);

            // Assert
            expect(
                mockElements['hover-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
        });

        it('should display node-specific information', () => {
            // Arrange
            const nodeData = { type: 'node', id: 'C4', degree: 5 };

            // Act
            uiManager.updateHoverInfo(nodeData);

            // Assert
            expect(
                mockElements['hover-panel'].classList.remove,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['hover-node-id'].textContent).toBe('Node: C4');
            expect(mockElements['hover-node-degree'].textContent).toBe(5);
            expect(
                mockElements['hover-edge'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(
                mockElements['hover-node'].classList.remove,
            ).toHaveBeenCalledWith('hidden');
        });

        it('should display edge-specific information', () => {
            // Arrange
            const edgeData = {
                type: 'edge',
                sourceId: 'C4',
                targetId: 'G4',
                weight: 2,
            };

            // Act
            uiManager.updateHoverInfo(edgeData);

            // Assert
            expect(mockElements['hover-edge-from'].textContent).toBe('C4');
            expect(mockElements['hover-edge-to'].textContent).toBe('G4');
            expect(mockElements['hover-edge-weight'].textContent).toBe(2);
            expect(
                mockElements['hover-node'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(
                mockElements['hover-edge'].classList.remove,
            ).toHaveBeenCalledWith('hidden');
        });
    });

    describe('Interactive Events', () => {
        it('should handle incremental toggle and disable stats when enabled', () => {
            // Act
            mockElements['incremental-toggle'].dispatchEvent({
                type: 'change',
                target: { checked: true },
            });

            // Assert
            expect(mockCallbacks.onIncrementalToggle).toHaveBeenCalledWith(
                true,
            );
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['stats-toggle'].disabled).toBe(true);
        });

        it('should handle hide/show UI button clicks', () => {
            // Act
            mockElements['hide-ui'].click();
            // Assert
            expect(mockElements['app'].classList.toggle).toHaveBeenCalledWith(
                'ui-hidden',
            );

            // Act
            mockElements['show-ui'].click();
            // Assert
            expect(mockElements['app'].classList.toggle).toHaveBeenCalledTimes(
                2,
            );
        });

        it('should handle autoplay and loop toggles', () => {
            // Act
            mockElements['autoplay-toggle'].dispatchEvent({
                type: 'change',
                target: { checked: true },
            });
            mockElements['loop-toggle'].dispatchEvent({
                type: 'change',
                target: { checked: false },
            });

            // Assert
            expect(mockCallbacks.onAutoplayToggle).toHaveBeenCalledWith(true);
            expect(mockCallbacks.onLoopToggle).toHaveBeenCalledWith(false);
        });

        it('should handle stats toggle change', () => {
            // Act
            mockElements['stats-toggle'].dispatchEvent({
                type: 'change',
                target: { checked: true },
            });

            // Assert
            expect(
                mockElements['info-panel'].classList.remove,
            ).toHaveBeenCalledWith('hidden');
            expect(
                mockElements['stats-toggle'].getAttribute('aria-expanded'),
            ).toBe(true);

            // Act
            mockElements['stats-toggle'].dispatchEvent({
                type: 'change',
                target: { checked: false },
            });

            // Assert
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(
                mockElements['stats-toggle'].getAttribute('aria-expanded'),
            ).toBe(false);
        });

        it('should handle tour toggle change', () => {
            // Act
            mockElements['tour-toggle'].dispatchEvent({
                type: 'change',
                target: { checked: true },
            });

            // Assert
            expect(mockCallbacks.onTourToggle).toHaveBeenCalledWith(true);
        });

        it('should handle theme button click', () => {
            // Act
            mockElements['theme-btn'].click();

            // Assert
            expect(mockCallbacks.onThemeCycle).toHaveBeenCalled();
        });

        it('should handle file selection from input', () => {
            // Arrange
            const mockFile = { name: 'test.mid' };

            // Act
            mockElements['midi-upload'].dispatchEvent({
                type: 'change',
                target: { files: [mockFile], value: 'test.mid' },
            });

            // Assert
            expect(mockCallbacks.onFileSelection).toHaveBeenCalledWith(
                mockFile,
            );
            expect(mockElements['midi-upload'].value).toBe('');
        });

        it('should handle close info click', () => {
            // Act
            mockElements['close-info'].click();

            // Assert
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['stats-toggle'].checked).toBe(false);
            expect(mockElements['stats-toggle'].focus).toHaveBeenCalled();
        });

        it('should handle keyboard shortcuts for play/pause', () => {
            // Arrange
            const keydownHandler = document.addEventListener.mock.calls.find(
                (c) => c[0] === 'keydown',
            )[1];
            mockElements['play-btn'].disabled = false;
            mockCallbacks.isPlaying.mockReturnValue(false);

            // Act
            keydownHandler({
                key: 'p',
                preventDefault: vi.fn(),
                toLowerCase: () => 'p',
            });

            // Assert
            expect(mockElements['play-btn'].click).toHaveBeenCalled();
        });

        it('should not trigger shortcuts when typing in inputs', () => {
            // Arrange
            const keydownHandler = document.addEventListener.mock.calls.find(
                (c) => c[0] === 'keydown',
            )[1];
            document.activeElement = { tagName: 'INPUT' };

            // Act
            keydownHandler({
                key: 'p',
                preventDefault: vi.fn(),
                toLowerCase: () => 'p',
            });

            // Assert
            expect(mockElements['play-btn'].click).not.toHaveBeenCalled();
        });

        it('should handle example MIDI clicks', () => {
            // Arrange
            const clickHandler = document.addEventListener.mock.calls.find(
                (c) => c[0] === 'click',
            )[1];
            const mockEvent = {
                target: {
                    classList: { contains: (cls) => cls === 'example-midi' },
                    dataset: { file: 'example.mid' },
                },
                preventDefault: vi.fn(),
            };

            // Act
            clickHandler(mockEvent);

            // Assert
            expect(mockCallbacks.onExampleMidiClick).toHaveBeenCalledWith(
                'example.mid',
            );
        });

        it('should handle visibility change', () => {
            // Arrange
            const visibilityHandler = document.addEventListener.mock.calls.find(
                (c) => c[0] === 'visibilitychange',
            )[1];
            document.visibilityState = 'visible';

            // Act
            visibilityHandler();

            // Assert
            expect(mockCallbacks.onVisibilityChange).toHaveBeenCalled();
        });

        it('should handle drag and drop flow and prevent flickering', () => {
            // Arrange
            const mockFile = { name: 'dragged.mid' };
            const container = mockElements['canvas-container'];

            // Act - Drag Over
            container.dispatchEvent({
                type: 'dragover',
                preventDefault: vi.fn(),
                dataTransfer: { types: ['Files'] },
            });
            // Assert
            expect(container.classList.add).toHaveBeenCalledWith('drag-active');

            // Act - Drag Leave (to child - should NOT remove)
            container.contains.mockReturnValue(true);
            container.dispatchEvent({
                type: 'dragleave',
                preventDefault: vi.fn(),
                relatedTarget: { id: 'child' },
            });
            expect(container.classList.remove).not.toHaveBeenCalledWith(
                'drag-active',
            );

            // Act - Drag Leave (to outside - should remove)
            container.contains.mockReturnValue(false);
            container.dispatchEvent({
                type: 'dragleave',
                preventDefault: vi.fn(),
                relatedTarget: { id: 'outside' },
            });
            expect(container.classList.remove).toHaveBeenCalledWith(
                'drag-active',
            );

            // Act - Drop
            container.dispatchEvent({
                type: 'drop',
                preventDefault: vi.fn(),
                dataTransfer: { files: [mockFile] },
            });
            // Assert
            expect(container.classList.remove).toHaveBeenCalledWith(
                'drag-active',
            );
            expect(mockCallbacks.onFileSelection).toHaveBeenCalledWith(
                mockFile,
            );
        });

        it('should close info panel on Escape key', () => {
            // Arrange
            const keydownHandler = document.addEventListener.mock.calls.find(
                (c) => c[0] === 'keydown',
            )[1];
            mockElements['info-panel'].classList.contains.mockReturnValue(
                false,
            ); // visible

            // Act
            keydownHandler({ key: 'Escape' });

            // Assert
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['stats-toggle'].checked).toBe(false);
        });
    });
});

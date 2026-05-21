import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager } from './UIManager.js';

describe('UIManager', () => {
    let uiManager;
    let mockCallbacks;
    let mockElements;

    const createMockElement = (id) => ({
        id,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        classList: {
            add: vi.fn(),
            remove: vi.fn(),
            toggle: vi.fn(),
            contains: vi.fn(),
        },
        showModal: vi.fn(),
        close: vi.fn(),
        focus: vi.fn(),
        click: vi.fn(),
        appendChild: vi.fn(),
        setAttribute: vi.fn(),
        getAttribute: vi.fn(),
        dataset: {},
        style: {},
        textContent: '',
        value: '',
        files: [],
        disabled: false,
        open: false,
    });

    beforeEach(() => {
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

        mockElements = {
            'midi-upload': createMockElement('midi-upload'),
            'play-btn': createMockElement('play-btn'),
            'pause-btn': createMockElement('pause-btn'),
            'restart-btn': createMockElement('restart-btn'),
            'close-info': createMockElement('close-info'),
            'v-count': createMockElement('v-count'),
            'e-count': createMockElement('e-count'),
            'info-panel': createMockElement('info-panel'),
            'welcome-msg': createMockElement('welcome-msg'),
            'hover-panel': createMockElement('hover-panel'),
            'hover-node': createMockElement('hover-node'),
            'hover-node-id': createMockElement('hover-node-id'),
            'hover-node-degree': createMockElement('hover-node-degree'),
            'hover-edge': createMockElement('hover-edge'),
            'hover-edge-from': createMockElement('hover-edge-from'),
            'hover-edge-to': createMockElement('hover-edge-to'),
            'hover-edge-interval': createMockElement('hover-edge-interval'),
            'hover-edge-weight': createMockElement('hover-edge-weight'),
            'app-title': createMockElement('app-title'),
            'status-modal': createMockElement('status-modal'),
            'status-modal-text': createMockElement('status-modal-text'),
            app: createMockElement('app'),
            'hide-ui': createMockElement('hide-ui'),
            'show-ui': createMockElement('show-ui'),
            'theme-btn': createMockElement('theme-btn'),
            'autoplay-toggle': createMockElement('autoplay-toggle'),
            'loop-toggle': createMockElement('loop-toggle'),
            'incremental-toggle': createMockElement('incremental-toggle'),
            'stats-toggle': createMockElement('stats-toggle'),
            'tour-toggle': createMockElement('tour-toggle'),
            'canvas-container': createMockElement('canvas-container'),
            'metric-efficiency': createMockElement('metric-efficiency'),
            'metric-weighted-efficiency': createMockElement(
                'metric-weighted-efficiency',
            ),
            'metric-entropy': createMockElement('metric-entropy'),
            'metric-binary-reciprocity': createMockElement(
                'metric-binary-reciprocity',
            ),
            'metric-reciprocity': createMockElement('metric-reciprocity'),
            'metric-reciprocity-rho': createMockElement(
                'metric-reciprocity-rho',
            ),
            'metric-density': createMockElement('metric-density'),
        };

        const mockIntervalBars = Array.from({ length: 12 }, (_, i) =>
            createMockElement(`bar-${i}`),
        );

        vi.stubGlobal('document', {
            getElementById: vi.fn((id) => mockElements[id]),
            querySelectorAll: vi.fn(() => mockIntervalBars),
            addEventListener: vi.fn(),
            activeElement: {},
            createElement: vi.fn((tag) => createMockElement(tag)),
            createTextNode: vi.fn((text) => ({
                nodeType: 3,
                textContent: text,
            })),
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
        it('should lookup all elements and setup listeners', () => {
            expect(document.getElementById).toHaveBeenCalledWith('midi-upload');
            expect(mockElements['status-modal'].showModal).toHaveBeenCalled();
            expect(
                mockElements['incremental-toggle'].addEventListener,
            ).toHaveBeenCalledWith('change', expect.any(Function));
        });
    });

    describe('Status Modal', () => {
        it('should show status with text', () => {
            uiManager.showStatus('Loading...');
            expect(mockElements['status-modal-text'].textContent).toBe(
                'Loading...',
            );
            expect(mockElements['status-modal'].showModal).toHaveBeenCalled();
        });

        it('should hide status', () => {
            mockElements['status-modal'].open = true;
            uiManager.hideStatus();
            expect(mockElements['status-modal'].close).toHaveBeenCalled();
        });

        it('should show error and log to console', () => {
            const consoleSpy = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            uiManager.showError('Oops', new Error('test'));
            expect(consoleSpy).toHaveBeenCalled();
            expect(mockElements['status-modal-text'].textContent).toContain(
                'Oops',
            );
            consoleSpy.mockRestore();
        });
    });

    describe('UI Toggling', () => {
        it('should toggle UI hidden class', () => {
            uiManager.toggleUi();
            expect(mockElements['app'].classList.toggle).toHaveBeenCalledWith(
                'ui-hidden',
            );
        });
    });

    describe('Playback UI', () => {
        it('should update buttons for playing state', () => {
            document.activeElement = mockElements['play-btn'];
            uiManager.setPlaybackUI(true);
            expect(mockElements['play-btn'].classList.add).toHaveBeenCalledWith(
                'hidden',
            );
            expect(
                mockElements['pause-btn'].classList.remove,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['pause-btn'].focus).toHaveBeenCalled();
        });

        it('should update buttons for paused state', () => {
            document.activeElement = mockElements['pause-btn'];
            uiManager.setPlaybackUI(false);
            expect(
                mockElements['play-btn'].classList.remove,
            ).toHaveBeenCalledWith('hidden');
            expect(
                mockElements['pause-btn'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['play-btn'].focus).toHaveBeenCalled();
        });

        it('should update theme button emoji', () => {
            uiManager.setThemeUI({ name: 'terminator', emoji: '💀' });
            const appendCalls =
                mockElements['theme-btn'].appendChild.mock.calls;
            const span = appendCalls[0][0];
            expect(span.textContent).toContain('💀');
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
            embedding: new Array(12).fill(0.1),
        };

        it('should update basic metric text content', () => {
            uiManager.updateMetrics(mockSummary, 'test.mid', false);
            expect(mockElements['v-count'].textContent).toBe(10);
            expect(mockElements['e-count'].textContent).toBe(20);
            expect(mockElements['metric-efficiency'].textContent).toBe(0.5);
        });

        it('should truncate the app title if it is too long (over 35 characters)', () => {
            const longSummary = {
                ...mockSummary,
                title: 'This is an extremely long MIDI title that will definitely overflow on mobile screens',
            };
            uiManager.updateMetrics(longSummary, 'short.mid', false);
            expect(mockElements['app-title'].textContent).toBe(
                'This is an extremely long MIDI t...',
            );

            const shortSummaryWithNoTitle = {
                ...mockSummary,
                title: '',
            };
            uiManager.updateMetrics(
                shortSummaryWithNoTitle,
                'extremely_long_midi_filename_fallback_test_case.mid',
                false,
            );
            expect(mockElements['app-title'].textContent).toBe(
                'extremely_long_midi_filename_fal...',
            );
        });

        it('should update interval bars', () => {
            uiManager.updateMetrics(mockSummary, 'test.mid', false);
            const bars = document.querySelectorAll();
            expect(bars[0].style.height).toBe('10%');
            expect(bars[0].setAttribute).toHaveBeenCalledWith(
                'aria-valuenow',
                10,
            );
        });

        it('should hide info panel in incremental mode', () => {
            uiManager.updateMetrics(mockSummary, 'test.mid', true);
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
        });
    });

    describe('Hover Information', () => {
        it('should hide hover panel if no data', () => {
            uiManager.updateHoverInfo(null);
            expect(
                mockElements['hover-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
        });

        it('should show node information', () => {
            const nodeData = { type: 'node', id: 'C4', degree: 5 };
            uiManager.updateHoverInfo(nodeData);
            expect(
                mockElements['hover-panel'].classList.remove,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['hover-node-id'].textContent).toBe('Node: C4');
            expect(mockElements['hover-node-degree'].textContent).toBe(5);
        });

        it('should show edge information', () => {
            const edgeData = {
                type: 'edge',
                sourceId: 'C4',
                targetId: 'G4',
                weight: 2,
            };
            uiManager.updateHoverInfo(edgeData);
            expect(mockElements['hover-edge-from'].textContent).toBe('C4');
            expect(mockElements['hover-edge-to'].textContent).toBe('G4');
            expect(mockElements['hover-edge-weight'].textContent).toBe(2);
        });
    });

    describe('Event Listeners', () => {
        it('should handle incremental toggle change', () => {
            const changeHandler = mockElements[
                'incremental-toggle'
            ].addEventListener.mock.calls.find((c) => c[0] === 'change')[1];
            changeHandler({ target: { checked: true } });
            expect(mockCallbacks.onIncrementalToggle).toHaveBeenCalledWith(
                true,
            );
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
        });

        it('should handle theme cycle click', () => {
            const clickHandler = mockElements[
                'theme-btn'
            ].addEventListener.mock.calls.find((c) => c[0] === 'click')[1];
            clickHandler();
            expect(mockCallbacks.onThemeCycle).toHaveBeenCalled();
        });

        it('should handle file upload change', () => {
            const changeHandler = mockElements[
                'midi-upload'
            ].addEventListener.mock.calls.find((c) => c[0] === 'change')[1];
            const mockFile = { name: 'test.mid' };
            changeHandler({ target: { files: [mockFile], value: 'test.mid' } });
            expect(mockCallbacks.onFileSelection).toHaveBeenCalledWith(
                mockFile,
            );
        });

        it('should handle keyboard shortcuts', () => {
            const keydownHandler = document.addEventListener.mock.calls.find(
                (c) => c[0] === 'keydown',
            )[1];

            // 'p' play/pause
            mockElements['play-btn'].disabled = false;
            mockCallbacks.isPlaying.mockReturnValue(false);
            keydownHandler({ key: 'p', preventDefault: vi.fn() });
            expect(mockElements['play-btn'].click).toHaveBeenCalled();

            mockCallbacks.isPlaying.mockReturnValue(true);
            keydownHandler({ key: 'P', preventDefault: vi.fn() });
            expect(mockElements['pause-btn'].click).toHaveBeenCalled();

            // 'h' toggle UI
            keydownHandler({ key: 'h' });
            expect(mockElements['app'].classList.toggle).toHaveBeenCalledWith(
                'ui-hidden',
            );
        });

        it('should handle example MIDI clicks', () => {
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
            clickHandler(mockEvent);
            expect(mockEvent.preventDefault).toHaveBeenCalled();
            expect(mockCallbacks.onExampleMidiClick).toHaveBeenCalledWith(
                'example.mid',
            );
        });

        it('should handle visibility change', () => {
            const visibilityHandler = document.addEventListener.mock.calls.find(
                (c) => c[0] === 'visibilitychange',
            )[1];
            document.visibilityState = 'visible';
            visibilityHandler();
            expect(mockCallbacks.onVisibilityChange).toHaveBeenCalled();
        });

        it('should handle drag and drop', () => {
            const dragOverHandler = mockElements[
                'canvas-container'
            ].addEventListener.mock.calls.find((c) => c[0] === 'dragover')[1];
            const dragLeaveHandler = mockElements[
                'canvas-container'
            ].addEventListener.mock.calls.find((c) => c[0] === 'dragleave')[1];
            const dropHandler = mockElements[
                'canvas-container'
            ].addEventListener.mock.calls.find((c) => c[0] === 'drop')[1];

            const mockEvent = {
                preventDefault: vi.fn(),
                dataTransfer: {
                    types: ['Files'],
                    files: [{ name: 'dropped.mid' }],
                },
            };

            dragOverHandler(mockEvent);
            expect(mockEvent.preventDefault).toHaveBeenCalled();
            expect(
                mockElements['canvas-container'].classList.add,
            ).toHaveBeenCalledWith('drag-active');

            dragLeaveHandler(mockEvent);
            expect(
                mockElements['canvas-container'].classList.remove,
            ).toHaveBeenCalledWith('drag-active');

            dropHandler(mockEvent);
            expect(mockCallbacks.onFileSelection).toHaveBeenCalledWith(
                mockEvent.dataTransfer.files[0],
            );
        });

        it('should focus correct button in toggleUi', () => {
            mockElements['app'].classList.toggle.mockReturnValue(true); // isHidden
            document.activeElement = mockElements['hide-ui'];
            uiManager.toggleUi();
            expect(mockElements['show-ui'].focus).toHaveBeenCalled();

            mockElements['app'].classList.toggle.mockReturnValue(false); // !isHidden
            document.activeElement = mockElements['show-ui'];
            uiManager.toggleUi();
            expect(mockElements['hide-ui'].focus).toHaveBeenCalled();
        });

        it('should prevent default on status modal cancel', () => {
            const cancelHandler = mockElements[
                'status-modal'
            ].addEventListener.mock.calls.find((c) => c[0] === 'cancel')[1];
            const mockEvent = { preventDefault: vi.fn() };
            cancelHandler(mockEvent);
            expect(mockEvent.preventDefault).toHaveBeenCalled();
        });

        it('should handle stats toggle change', () => {
            const changeHandler = mockElements[
                'stats-toggle'
            ].addEventListener.mock.calls.find((c) => c[0] === 'change')[1];

            // Checked
            changeHandler({ target: { checked: true } });
            expect(
                mockElements['info-panel'].classList.remove,
            ).toHaveBeenCalledWith('hidden');
            expect(
                mockElements['stats-toggle'].setAttribute,
            ).toHaveBeenCalledWith('aria-expanded', true);

            // Unchecked
            changeHandler({ target: { checked: false } });
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(
                mockElements['stats-toggle'].setAttribute,
            ).toHaveBeenCalledWith('aria-expanded', false);
        });

        it('should handle tour toggle change', () => {
            const changeHandler = mockElements[
                'tour-toggle'
            ].addEventListener.mock.calls.find((c) => c[0] === 'change')[1];
            changeHandler({ target: { checked: true } });
            expect(mockCallbacks.onTourToggle).toHaveBeenCalledWith(true);
            expect(
                mockElements['tour-toggle'].setAttribute,
            ).toHaveBeenCalledWith('aria-expanded', true);
        });

        it('should handle close info click', () => {
            const clickHandler = mockElements[
                'close-info'
            ].addEventListener.mock.calls.find((c) => c[0] === 'click')[1];
            clickHandler();
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['stats-toggle'].checked).toBe(false);
            expect(mockElements['stats-toggle'].focus).toHaveBeenCalled();
        });

        it('should handle Escape key to close info panel', () => {
            const keydownHandler = document.addEventListener.mock.calls.find(
                (c) => c[0] === 'keydown',
            )[1];

            mockElements['info-panel'].classList.contains.mockReturnValue(
                false,
            ); // not hidden
            keydownHandler({ key: 'Escape' });
            expect(
                mockElements['info-panel'].classList.add,
            ).toHaveBeenCalledWith('hidden');
            expect(mockElements['stats-toggle'].checked).toBe(false);
        });

        it('should not toggle UI or play/pause if input/textarea is focused', () => {
            const keydownHandler = document.addEventListener.mock.calls.find(
                (c) => c[0] === 'keydown',
            )[1];

            document.activeElement = { tagName: 'INPUT' };

            // 'h' key
            keydownHandler({ key: 'h' });
            expect(mockElements['app'].classList.toggle).not.toHaveBeenCalled();

            // 'p' key
            keydownHandler({ key: 'p', preventDefault: vi.fn() });
            expect(mockElements['play-btn'].click).not.toHaveBeenCalled();
        });
    });
});

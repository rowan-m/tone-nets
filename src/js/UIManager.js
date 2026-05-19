import { Utils } from './Utils.js';

/**
 * Manages the DOM elements and UI state of the application.
 * Separated from main.js to follow SRP and simplify orchestration.
 */
export class UIManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.els = this._lookupElements();
        this._setupListeners();
    }

    _lookupElements() {
        return {
            uploadInput: document.getElementById('midi-upload'),
            playBtn: document.getElementById('play-btn'),
            pauseBtn: document.getElementById('pause-btn'),
            restartBtn: document.getElementById('restart-btn'),
            closeInfo: document.getElementById('close-info'),
            vCountEl: document.getElementById('v-count'),
            eCountEl: document.getElementById('e-count'),
            infoPanel: document.getElementById('info-panel'),
            welcomeMsg: document.getElementById('welcome-msg'),
            hoverPanel: document.getElementById('hover-panel'),
            hoverNode: document.getElementById('hover-node'),
            hoverNodeId: document.getElementById('hover-node-id'),
            hoverNodeDegree: document.getElementById('hover-node-degree'),
            hoverEdge: document.getElementById('hover-edge'),
            hoverEdgeFrom: document.getElementById('hover-edge-from'),
            hoverEdgeTo: document.getElementById('hover-edge-to'),
            hoverEdgeInterval: document.getElementById('hover-edge-interval'),
            hoverEdgeWeight: document.getElementById('hover-edge-weight'),
            appTitle: document.getElementById('app-title'),
            statusModal: document.getElementById('status-modal'),
            statusModalText: document.getElementById('status-modal-text'),
            appEl: document.getElementById('app'),
            hideUiBtn: document.getElementById('hide-ui'),
            showUiBtn: document.getElementById('show-ui'),
            themeBtn: document.getElementById('theme-btn'),
            autoplayToggle: document.getElementById('autoplay-toggle'),
            loopToggle: document.getElementById('loop-toggle'),
            incrementalToggle: document.getElementById('incremental-toggle'),
            statsToggle: document.getElementById('stats-toggle'),
            tourToggle: document.getElementById('tour-toggle'),
            canvasContainer: document.getElementById('canvas-container'),
            metricEls: {
                efficiency: document.getElementById('metric-efficiency'),
                weightedEfficiency: document.getElementById(
                    'metric-weighted-efficiency',
                ),
                entropy: document.getElementById('metric-entropy'),
                binaryReciprocity: document.getElementById(
                    'metric-binary-reciprocity',
                ),
                reciprocity: document.getElementById('metric-reciprocity'),
                reciprocityRho: document.getElementById(
                    'metric-reciprocity-rho',
                ),
                density: document.getElementById('metric-density'),
                intervalBars: document.querySelectorAll('#interval-bars .bar'),
            },
        };
    }

    _setupListeners() {
        // Show non-dismissable status modal initially
        this.els.statusModal.showModal();
        this.els.statusModal.addEventListener('cancel', (e) =>
            e.preventDefault(),
        );

        this.els.incrementalToggle.addEventListener('change', (e) => {
            this.callbacks.onIncrementalToggle(e.target.checked);
            if (e.target.checked) {
                this.els.infoPanel.classList.add('hidden');
                this.els.statsToggle.disabled = true;
                this.els.statsToggle.checked = false;
            } else if (!this.els.playBtn.disabled) {
                this.els.statsToggle.disabled = false;
            }
        });

        this.els.autoplayToggle.addEventListener('change', (e) => {
            this.callbacks.onAutoplayToggle(e.target.checked);
        });

        this.els.loopToggle.addEventListener('change', (e) => {
            this.callbacks.onLoopToggle(e.target.checked);
        });

        this.els.statsToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.els.infoPanel.classList.remove('hidden');
            } else {
                this.els.infoPanel.classList.add('hidden');
            }
            this.els.statsToggle.setAttribute(
                'aria-expanded',
                e.target.checked,
            );
        });

        this.els.tourToggle.addEventListener('change', (e) => {
            this.callbacks.onTourToggle(e.target.checked);
            this.els.tourToggle.setAttribute('aria-expanded', e.target.checked);
        });

        this.els.hideUiBtn.addEventListener('click', () => this.toggleUi());
        this.els.showUiBtn.addEventListener('click', () => this.toggleUi());
        this.els.themeBtn.addEventListener('click', () =>
            this.callbacks.onThemeCycle(),
        );

        this.els.playBtn.addEventListener(
            'click',
            this.callbacks.onTogglePlayPause,
        );
        this.els.pauseBtn.addEventListener(
            'click',
            this.callbacks.onTogglePlayPause,
        );
        this.els.restartBtn.addEventListener('click', this.callbacks.onRestart);

        this.els.uploadInput.addEventListener('change', (e) => {
            this.callbacks.onFileSelection(e.target.files[0]);
            e.target.value = '';
        });

        this.els.closeInfo.addEventListener('click', () => {
            this.els.infoPanel.classList.add('hidden');
            this.els.statsToggle.checked = false;
            this.els.statsToggle.setAttribute('aria-expanded', 'false');
            this.els.statsToggle.focus();
        });

        this._setupGlobalKeyboardListeners();
        this._setupDragDropListeners();
        this._setupMediaSessionHandlers();
    }

    _setupGlobalKeyboardListeners() {
        document.addEventListener('keydown', (e) => {
            if (
                e.key === 'Escape' &&
                !this.els.infoPanel.classList.contains('hidden')
            ) {
                this.els.infoPanel.classList.add('hidden');
                this.els.statsToggle.checked = false;
                this.els.statsToggle.setAttribute('aria-expanded', 'false');
                this.els.statsToggle.focus();
            }

            if (e.key.toLowerCase() === 'h') {
                if (
                    document.activeElement.tagName === 'INPUT' ||
                    document.activeElement.tagName === 'BUTTON'
                ) {
                    return;
                }
                this.toggleUi();
            }

            if (e.key.toLowerCase() === 'p') {
                if (
                    document.activeElement.tagName === 'INPUT' ||
                    document.activeElement.tagName === 'TEXTAREA'
                ) {
                    return;
                }

                e.preventDefault();

                if (!this.els.playBtn.disabled) {
                    if (this.callbacks.isPlaying()) {
                        this.els.pauseBtn.click();
                    } else {
                        this.els.playBtn.click();
                    }
                }
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('example-midi')) {
                e.preventDefault();
                const fileName = e.target.dataset.file;
                this.callbacks.onExampleMidiClick(fileName);
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.callbacks.onVisibilityChange();
            }
        });
    }

    _setupDragDropListeners() {
        this.els.canvasContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (
                !this.els.uploadInput.disabled &&
                e.dataTransfer.types.includes('Files')
            ) {
                this.els.canvasContainer.classList.add('drag-active');
            }
        });

        this.els.canvasContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.els.canvasContainer.classList.remove('drag-active');
        });

        this.els.canvasContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            this.els.canvasContainer.classList.remove('drag-active');
            if (!this.els.uploadInput.disabled) {
                this.callbacks.onFileSelection(e.dataTransfer.files[0]);
            }
        });
    }

    _setupMediaSessionHandlers() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler(
                'play',
                this.callbacks.onTogglePlayPause,
            );
            navigator.mediaSession.setActionHandler(
                'pause',
                this.callbacks.onTogglePlayPause,
            );
        }
    }

    toggleUi() {
        const isHidden = this.els.appEl.classList.toggle('ui-hidden');
        if (document.activeElement === this.els.hideUiBtn && isHidden) {
            this.els.showUiBtn.focus();
        } else if (document.activeElement === this.els.showUiBtn && !isHidden) {
            this.els.hideUiBtn.focus();
        }
    }

    showStatus(text) {
        this.els.statusModalText.textContent = text;
        if (!this.els.statusModal.open) {
            this.els.statusModal.showModal();
        }
    }

    hideStatus() {
        if (this.els.statusModal.open) {
            this.els.statusModal.close();
        }
    }

    showError(message, err) {
        console.error(message, err);
        this.showStatus(`${message} See console.`);
    }

    updateMetrics(summary, fileName, isIncrementalMode) {
        this.els.appTitle.textContent = summary.title
            ? summary.title
            : fileName;

        this.els.vCountEl.textContent = summary.vertices;
        this.els.eCountEl.textContent = summary.edges;

        Object.keys(this.els.metricEls).forEach((key) => {
            if (key === 'intervalBars') return;
            if (this.els.metricEls[key])
                this.els.metricEls[key].textContent = summary[key];
        });

        summary.embedding.forEach((val, i) => {
            const percentage = Math.round(parseFloat(val) * 100);
            const bar = this.els.metricEls.intervalBars[i];
            if (bar) {
                bar.style.height = `${percentage}%`;
                bar.title = `${Utils.INTERVAL_NAMES[i]}: ${percentage}%`;
                bar.setAttribute('aria-valuenow', percentage);
                bar.setAttribute('aria-valuetext', `${percentage}%`);
            }
        });

        if (isIncrementalMode || window.innerWidth <= 768) {
            this.els.infoPanel.classList.add('hidden');
            this.els.statsToggle.checked = false;
        } else {
            this.els.infoPanel.classList.remove('hidden');
            this.els.statsToggle.checked = true;
        }
        this.els.statsToggle.setAttribute(
            'aria-expanded',
            this.els.statsToggle.checked,
        );
    }

    setPlaybackUI(isPlaying) {
        if (isPlaying) {
            this.els.playBtn.classList.add('hidden');
            this.els.pauseBtn.classList.remove('hidden');
        } else {
            this.els.playBtn.classList.remove('hidden');
            this.els.pauseBtn.classList.add('hidden');
        }
    }

    setThemeUI(theme) {
        const emoji = theme.emoji || '🎨';

        this.els.themeBtn.textContent = '';
        const span = document.createElement('span');
        span.setAttribute('aria-hidden', 'true');
        span.textContent = emoji;
        this.els.themeBtn.appendChild(span);
        this.els.themeBtn.appendChild(document.createTextNode(' Theme'));
    }

    updateHoverInfo(data) {
        if (!data) {
            this.els.hoverPanel.classList.add('hidden');
            return;
        }

        this.els.hoverPanel.classList.remove('hidden');

        if (data.type === 'node') {
            this.els.hoverNode.classList.remove('hidden');
            this.els.hoverEdge.classList.add('hidden');
            this.els.hoverNodeId.textContent = `Node: ${data.id}`;
            this.els.hoverNodeDegree.textContent = data.degree;
        } else if (data.type === 'edge') {
            this.els.hoverNode.classList.add('hidden');
            this.els.hoverEdge.classList.remove('hidden');
            const interval = Utils.getIntervalName(
                data.sourceId,
                data.targetId,
            );
            this.els.hoverEdgeFrom.textContent = data.sourceId;
            this.els.hoverEdgeTo.textContent = data.targetId;
            this.els.hoverEdgeInterval.textContent = interval;
            this.els.hoverEdgeWeight.textContent = data.weight;
        }
    }
}

/**
 * Transport Bar UI
 * Handles transport control buttons and display
 */

import * as State from '../state.js';
import { getTransport } from '../transport.js';

class TransportBar {
    constructor() {
        // Buttons
        this.beginningBtn = document.getElementById('btn-beginning');
        this.playBtn = document.getElementById('btn-play');
        this.stopBtn = document.getElementById('btn-stop');
        this.pauseBtn = document.getElementById('btn-pause');
        this.loopBtn = document.getElementById('btn-loop');
        
        // Time display
        this.currentTimeEl = document.getElementById('current-time');
        this.totalTimeEl = document.getElementById('total-time');
        
        // Value displays
        this.speedValueEl = document.getElementById('speed-value');
        this.tempoValueEl = document.getElementById('tempo-value');
        
        // Selects
        this.pitchSelect = document.getElementById('pitch-select');
        this.timeSignatureSelect = document.getElementById('time-signature');
        
        // Transport reference
        this.transport = null;
        
        this.init();
    }

    async init() {
        this.transport = getTransport();
        
        this.attachEventListeners();
        this.attachStateListeners();
    }

    attachEventListeners() {
        // Beginning button (return to start)
        this.beginningBtn.addEventListener('click', () => {
            this.transport.seek(0);
        });

        // Play button
        this.playBtn.addEventListener('click', () => {
            this.transport.play();
        });

        // Stop button
        this.stopBtn.addEventListener('click', () => {
            this.transport.stop();
        });

        // Pause button
        this.pauseBtn.addEventListener('click', () => {
            this.transport.pause();
        });

        // Loop button
        this.loopBtn.addEventListener('click', () => {
            State.toggleLoop();
        });

        // Pitch select
        this.pitchSelect.addEventListener('change', () => {
            this.transport.setPitch(parseInt(this.pitchSelect.value));
        });

        // Time signature select
        this.timeSignatureSelect.addEventListener('change', () => {
            this.transport.setTimeSignature(this.timeSignatureSelect.value);
        });

        // Editable value fields - click to edit
        this.setupEditableValue(this.speedValueEl, 'speed', {
            parse: (text) => parseFloat(text.replace('x', '')),
            format: (val) => this.transport.formatSpeed(val),
            validate: (val) => !isNaN(val),
            apply: (val) => {
                const clamped = Math.max(0.5, Math.min(2.0, val));
                this.transport.setSpeed(clamped);
                return clamped;
            }
        });

        this.setupEditableValue(this.tempoValueEl, 'tempo', {
            parse: (text) => parseFloat(text.replace(' BPM', '').replace('BPM', '')),
            format: (val) => this.transport.formatTempo(val),
            validate: (val) => Number.isFinite(val),
            apply: (val) => {
                const rounded = Number(val.toFixed(2));
                const clamped = Math.max(20, Math.min(300, rounded));
                this.transport.setTempo(clamped);
                return clamped;
            }
        });
    }

    /**
     * Set up click-to-edit functionality for a value display
     */
    setupEditableValue(element, paramName, { parse, format, validate, apply }) {
        element.addEventListener('click', () => {
            // Don't allow editing if already editing
            if (element.querySelector('input')) return;

            const currentText = element.textContent;
            const currentValue = parse(currentText);

            // Create input element
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'knob-value-input';
            input.value = currentValue;
            
            // Replace span content with input
            element.textContent = '';
            element.appendChild(input);
            input.focus();
            input.select();

            const finishEditing = (save) => {
                if (save) {
                    const newValue = parse(input.value);
                    if (!isNaN(newValue) && validate(newValue)) {
                        const appliedValue = apply(newValue);
                        element.textContent = format(appliedValue ?? newValue);
                    } else {
                        // Invalid value, revert
                        element.textContent = currentText;
                    }
                } else {
                    // Cancelled, revert
                    element.textContent = currentText;
                }
            };

            input.addEventListener('blur', () => finishEditing(true));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    finishEditing(false);
                }
            });
        });
    }

    attachStateListeners() {
        // Update button states on playback state change
        State.subscribe(State.Events.PLAYBACK_STATE_CHANGED, ({ newState }) => {
            this.updateButtonStates(newState);
        });

        // Update time display on position change
        State.subscribe(State.Events.POSITION_CHANGED, (position) => {
            this.updateTimeDisplay(position);
        });

        // Update total time when tracks change
        State.subscribe(State.Events.TRACK_ADDED, () => {
            this.updateTotalTime();
        });

        State.subscribe(State.Events.TRACK_REMOVED, () => {
            this.updateTotalTime();
        });

        // Update controls when song changes
        State.subscribe(State.Events.SONG_SWITCHED, (song) => {
            this.updateFromSong(song);
        });

        // Update controls when transport settings change
        State.subscribe(State.Events.TRANSPORT_UPDATED, ({ song }) => {
            this.updateFromSong(song);
        });

        // Update on state load
        State.subscribe(State.Events.STATE_LOADED, () => {
            const song = State.getActiveSong();
            if (song) {
                this.updateFromSong(song);
            }
        });

        // Update loop button state
        State.subscribe(State.Events.LOOP_UPDATED, ({ enabled }) => {
            this.updateLoopButton(enabled);
        });
    }

    updateButtonStates(playbackState) {
        // Only highlight play when playing, pause when paused
        // Stop is a momentary action, never stays highlighted
        this.playBtn.classList.toggle('active', playbackState === 'playing');
        this.pauseBtn.classList.toggle('active', playbackState === 'paused');
        this.stopBtn.classList.remove('active');
    }

    updateLoopButton(enabled) {
        this.loopBtn.classList.toggle('active', enabled);
    }

    updateTimeDisplay(position) {
        this.currentTimeEl.textContent = this.transport.formatTime(position);
    }

    updateTotalTime() {
        const duration = State.getMaxDuration();
        this.totalTimeEl.textContent = this.transport.formatTime(duration);
    }

    updateFromSong(song) {
        if (!song) return;

        const { transport } = song;

        // Update value displays
        this.speedValueEl.textContent = this.transport.formatSpeed(transport.speed);
        this.tempoValueEl.textContent = this.transport.formatTempo(transport.tempo);

        // Update selects
        this.pitchSelect.value = transport.pitch;
        this.timeSignatureSelect.value = transport.timeSignature;

        // Update time display
        this.updateTimeDisplay(transport.position);
        this.updateTotalTime();

        // Update loop button
        this.updateLoopButton(transport.loopEnabled);
    }

    /**
     * Handle keyboard shortcuts
     */
    handleKeydown(e) {
        // Space: Play/Stop toggle
        if (e.code === 'Space' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            // Don't trigger if focused on an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            
            e.preventDefault();
            this.transport.togglePlayStop();
        }

        // Ctrl+Space: Pause toggle
        if (e.code === 'Space' && e.ctrlKey) {
            e.preventDefault();
            this.transport.pause();
        }
    }
}

// Singleton instance
let transportBarInstance = null;

export function getTransportBar() {
    if (!transportBarInstance) {
        transportBarInstance = new TransportBar();
    }
    return transportBarInstance;
}

export default TransportBar;

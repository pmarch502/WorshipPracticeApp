/**
 * Transport Bar UI
 * Handles transport control buttons and display
 */

import * as State from '../state.js';
import { getTransport } from '../transport.js';
import { getTempoAtTime, getTimeSigAtTime } from '../metadata.js';

// Key names in chromatic order starting from A
const KEYS = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];

/**
 * Transpose a key by semitones
 * @param {string} originalKey - Original key (e.g., 'C', 'Bb')
 * @param {number} semitones - Number of semitones to transpose
 * @returns {string|null} Transposed key or null if invalid
 */
function transposeKey(originalKey, semitones) {
    const index = KEYS.indexOf(originalKey);
    if (index === -1) return null;
    return KEYS[((index + semitones) % 12 + 12) % 12];
}

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
        
        // Time signature display (read-only)
        this.timeSignatureEl = document.getElementById('time-signature');
        
        // Labels
        this.pitchLabel = document.getElementById('pitch-label');
        
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
    }

    /**
     * Set up click-to-edit functionality for a value display
     */
    setupEditableValue(element, paramName, { parse, format, validate, apply }) {
        element.addEventListener('click', () => {
            // Don't allow editing if read-only or already editing
            if (element.classList.contains('read-only')) return;
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
            this.updateTempoFromPosition(position);
            this.updateTimeSigFromPosition(position);
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

        // Update pitch label and tempo editability when metadata is loaded
        State.subscribe(State.Events.SONG_METADATA_UPDATED, ({ song }) => {
            if (song.id === State.state.activeSongId) {
                this.updatePitchLabel(song);
                this.updatePitchSelectOptions(song);
                this.updateFromSong(song);
            }
        });
        
        // Update total time when arrangement changes (virtual duration changes)
        State.subscribe(State.Events.ARRANGEMENT_CHANGED, () => {
            this.updateTotalTime();
        });
        
        // Update total time when sections are updated (includes virtual sections recalculation)
        // This ensures total time is correct on initial load when arrangement is restored from saved state
        State.subscribe(State.Events.SECTIONS_UPDATED, () => {
            this.updateTotalTime();
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
        
        // Tempo always comes from metadata or defaults to 120 BPM
        const tempo = getTempoAtTime(transport.position, song.metadata?.tempos);
        this.tempoValueEl.textContent = this.transport.formatTempo(tempo);

        const hasTimeSigMetadata = song.metadata?.['time-sigs']?.length > 0;

        // Update selects
        this.pitchSelect.value = transport.pitch;
        
        // For time signature: use metadata if available, otherwise use default 4/4
        if (hasTimeSigMetadata) {
            const timeSig = getTimeSigAtTime(transport.position, song.metadata['time-sigs']);
            this.timeSignatureEl.textContent = timeSig;
        } else {
            this.timeSignatureEl.textContent = '4/4';
        }

        // Update time display
        this.updateTimeDisplay(transport.position);
        this.updateTotalTime();

        // Update loop button
        this.updateLoopButton(transport.loopEnabled);

        // Update pitch label with transposed key
        this.updatePitchLabel(song);
        
        // Update pitch select dropdown options with transposed keys
        this.updatePitchSelectOptions(song);
    }

    /**
     * Update tempo display based on current playhead position
     * Uses metadata tempo or falls back to 120 BPM
     * @param {number} position - Current position in seconds
     */
    updateTempoFromPosition(position) {
        const song = State.getActiveSong();
        const tempo = getTempoAtTime(position, song?.metadata?.tempos);
        this.tempoValueEl.textContent = this.transport.formatTempo(tempo);
    }

    /**
     * Update time signature display based on current playhead position
     * Only updates display if song has time signature metadata
     * @param {number} position - Current position in seconds
     */
    updateTimeSigFromPosition(position) {
        const song = State.getActiveSong();
        const timeSigs = song?.metadata?.['time-sigs'];
        
        if (timeSigs && timeSigs.length > 0) {
            const timeSig = getTimeSigAtTime(position, timeSigs);
            this.timeSignatureEl.textContent = timeSig;
        }
    }

    /**
     * Update the pitch label to show the transposed key
     * @param {Object} song - Song object
     */
    updatePitchLabel(song) {
        const originalKey = song?.metadata?.key;
        const pitch = song?.transport?.pitch ?? 0;
        
        if (originalKey && KEYS.includes(originalKey)) {
            const transposedKey = transposeKey(originalKey, pitch);
            this.pitchLabel.textContent = `PITCH (${transposedKey})`;
        } else {
            this.pitchLabel.textContent = 'PITCH';
        }
    }

    /**
     * Update pitch select dropdown options to show transposed keys
     * @param {Object} song - Song object
     */
    updatePitchSelectOptions(song) {
        const originalKey = song?.metadata?.key;
        const options = this.pitchSelect.options;
        
        for (let i = 0; i < options.length; i++) {
            const semitones = parseInt(options[i].value);
            const sign = semitones > 0 ? '+' : '';
            const simpleText = `${sign}${semitones}`;
            
            if (originalKey && KEYS.includes(originalKey)) {
                const transposedKey = transposeKey(originalKey, semitones);
                // Show key in dropdown options, but not for the selected value
                options[i].textContent = options[i].selected 
                    ? simpleText 
                    : `${simpleText} (${transposedKey})`;
            } else {
                options[i].textContent = simpleText;
            }
        }
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

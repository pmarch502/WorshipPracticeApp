/**
 * Transport Controller
 * Handles playback controls, speed, pitch, tempo
 */

import * as State from './state.js';
import { getAudioEngine } from './audioEngine.js';

class Transport {
    constructor() {
        this.audioEngine = null;
    }

    async init() {
        this.audioEngine = getAudioEngine();
        await this.audioEngine.init();
        
        // Make audio engine accessible globally for other modules
        window.audioEngine = this.audioEngine;
    }

    /**
     * Toggle play/stop
     */
    togglePlayStop() {
        const playbackState = State.state.playbackState;
        
        if (playbackState === 'playing') {
            this.stop();
        } else {
            this.play();
        }
    }

    /**
     * Start playback
     */
    play() {
        const song = State.getActiveSong();
        if (!song || song.tracks.length === 0) return;
        
        this.audioEngine.play();
    }

    /**
     * Stop playback and return to last play position
     */
    stop() {
        this.audioEngine.stop();
    }

    /**
     * Pause playback at current position
     */
    pause() {
        if (State.state.playbackState === 'paused') {
            // Resume from paused position
            this.play();
        } else if (State.state.playbackState === 'playing') {
            this.audioEngine.pause();
        }
    }

    /**
     * Seek to a specific position
     */
    seek(position) {
        this.audioEngine.seek(position);
    }

    /**
     * Set playback speed (time stretch)
     * @param {number} speed - Speed multiplier (0.5 to 2.0)
     */
    setSpeed(speed) {
        const clampedSpeed = Math.max(0.5, Math.min(2.0, speed));
        State.updateTransport({ speed: clampedSpeed });
        this.audioEngine.setSpeed(clampedSpeed);
    }

    /**
     * Set pitch shift
     * @param {number} semitones - Pitch shift in semitones (-6 to +6)
     */
    setPitch(semitones) {
        const clampedPitch = Math.max(-6, Math.min(6, Math.round(semitones)));
        State.updateTransport({ pitch: clampedPitch });
        this.audioEngine.setPitch(clampedPitch);
    }

    /**
     * Set tempo (affects timeline only, not playback)
     * @param {number} bpm - Tempo in BPM (20 to 300)
     */
    setTempo(bpm) {
        const clampedTempo = Math.max(20, Math.min(300, bpm));
        State.updateTransport({ tempo: clampedTempo });
    }

    /**
     * Set time signature
     * @param {string} timeSignature - Time signature (e.g., "4/4")
     */
    setTimeSignature(timeSignature) {
        State.updateTransport({ timeSignature });
    }

    /**
     * Get current position in seconds
     */
    getCurrentPosition() {
        return this.audioEngine.getCurrentPosition();
    }

    /**
     * Format time for display
     * @param {number} seconds - Time in seconds
     * @returns {string} - Formatted time string (HH:MM:SS.mmm)
     */
    formatTime(seconds) {
        if (!isFinite(seconds) || isNaN(seconds)) {
            return '00:00:00.000';
        }
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }

    /**
     * Format speed for display
     */
    formatSpeed(speed) {
        return `${speed.toFixed(2)}x`;
    }

    /**
     * Format pitch for display
     */
    formatPitch(semitones) {
        if (semitones === 0) return '0';
        if (semitones > 0) return `+${semitones}`;
        return semitones.toString();
    }

    /**
     * Format tempo for display
     * Displays with minimal decimals (e.g., 72 not 72.00, but 72.5 stays 72.5)
     */
    formatTempo(bpm) {
        // Ensure at most 2 decimal places, then remove trailing zeros
        const formatted = Number(bpm.toFixed(2));
        return `${formatted} BPM`;
    }
}

// Singleton instance
let transportInstance = null;

export function getTransport() {
    if (!transportInstance) {
        transportInstance = new Transport();
    }
    return transportInstance;
}

export default Transport;

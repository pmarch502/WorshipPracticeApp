/**
 * Audio Engine
 * Handles Web Audio API, audio loading, playback, and pitch/time stretching
 * Uses SoundTouch via AudioWorklet for high-quality independent speed/pitch control
 */

import * as State from './state.js';
import { getSectionAtTime } from './sections.js';
import { BASE_PIXELS_PER_SECOND } from './ui/waveformPanel.js';
import { getWaveformPanel } from './ui/waveformPanel.js';

class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.pitchShifter = null; // PitchShifterWorklet for tempo/pitch processing
        this.trackNodes = new Map(); // trackId -> { source, gainNode, panNode, audioBuffer }
        this.audioBuffers = new Map(); // trackId -> AudioBuffer (persists across song switches)
        
        this.isPlaying = false;
        this.startTime = 0; // AudioContext time when playback started
        this.startPosition = 0; // Position in audio when playback started
        
        this.animationFrame = null;
        
        // Pitch/speed settings (applied globally via SoundTouch)
        this._pitch = 0; // semitones (-6 to +6)
        this._speed = 1.0; // tempo (0.5 to 2.0)
        
        // Track section mute state for smooth transitions
        // trackId -> { currentSectionIndex: number, isSectionMuted: boolean }
        this.trackSectionState = new Map();
    }

    /**
     * Initialize the audio context and pitch shifter worklet
     * Must be called after user interaction
     */
    async init() {
        if (this.audioContext) return;
        
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Initialize the SoundTouch pitch shifter worklet
        // PitchShifterWorklet is loaded from soundtouch.js (global)
        this.pitchShifter = new PitchShifterWorklet(this.audioContext);
        await this.pitchShifter.init();
        
        // Create master gain node
        this.masterGain = this.audioContext.createGain();
        
        // Connect: pitchShifter -> masterGain -> destination
        this.pitchShifter.connect(this.masterGain);
        this.masterGain.connect(this.audioContext.destination);
        
        console.log('Audio engine initialized with SoundTouch worklet, sample rate:', this.audioContext.sampleRate);
    }

    /**
     * Resume audio context if suspended
     */
    async resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    /**
     * Decode audio file to AudioBuffer
     * @param {Blob} blob - Audio file blob
     * @returns {Promise<AudioBuffer>}
     */
    async decodeAudio(blob) {
        await this.init();
        
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        
        return audioBuffer;
    }

    /**
     * Load audio for a track
     * @param {string} trackId - Track ID
     * @param {Blob} blob - Audio blob
     * @returns {Promise<AudioBuffer>}
     */
    async loadTrackAudio(trackId, blob) {
        // Check in-memory cache first
        if (this.audioBuffers.has(trackId)) {
            console.log(`Using cached AudioBuffer for track: ${trackId}`);
            return this.audioBuffers.get(trackId);
        }
        
        const buffer = await this.decodeAudio(blob);
        this.audioBuffers.set(trackId, buffer);
        return buffer;
    }

    /**
     * Check if an AudioBuffer is cached for a track
     * @param {string} trackId 
     * @returns {boolean}
     */
    hasAudioBuffer(trackId) {
        return this.audioBuffers.has(trackId);
    }

    /**
     * Get cached AudioBuffer for a track
     * @param {string} trackId 
     * @returns {AudioBuffer|null}
     */
    getAudioBuffer(trackId) {
        return this.audioBuffers.get(trackId) || null;
    }

    /**
     * Clear cached AudioBuffer for a track
     * @param {string} trackId 
     */
    clearAudioBuffer(trackId) {
        this.audioBuffers.delete(trackId);
        console.log(`Cleared AudioBuffer for track: ${trackId}`);
    }

    /**
     * Clear cached AudioBuffers for multiple tracks
     * @param {string[]} trackIds 
     */
    clearAudioBuffers(trackIds) {
        for (const trackId of trackIds) {
            this.audioBuffers.delete(trackId);
        }
        console.log(`Cleared AudioBuffers for ${trackIds.length} tracks`);
    }

    /**
     * Create audio nodes for a track
     */
    createTrackNodes(trackId, audioBuffer) {
        const track = State.getTrack(trackId);
        if (!track) return null;

        // Clean up existing nodes
        this.disposeTrackNodes(trackId);

        // Create nodes
        const gainNode = this.audioContext.createGain();
        const panNode = this.audioContext.createStereoPanner();
        
        // Apply track settings
        gainNode.gain.value = track.volume / 100;
        panNode.pan.value = track.pan / 100;

        // Connect chain: gainNode -> panNode -> pitchShifter (-> masterGain -> destination)
        // All tracks go through the shared pitchShifter for tempo/pitch processing
        gainNode.connect(panNode);
        panNode.connect(this.pitchShifter.inputNode);

        const nodes = {
            audioBuffer,
            gainNode,
            panNode,
            source: null
        };

        this.trackNodes.set(trackId, nodes);
        return nodes;
    }

    /**
     * Dispose audio nodes for a track
     */
    disposeTrackNodes(trackId) {
        const nodes = this.trackNodes.get(trackId);
        if (nodes) {
            if (nodes.source) {
                try {
                    nodes.source.stop();
                } catch (e) {}
                nodes.source.disconnect();
            }
            if (nodes.gainNode) nodes.gainNode.disconnect();
            if (nodes.panNode) nodes.panNode.disconnect();
        }
        this.trackNodes.delete(trackId);
    }

    /**
     * Start playback from a position
     * @param {number} position - Position in seconds
     */
    play(position = null) {
        const song = State.getActiveSong();
        if (!song || song.tracks.length === 0) return;

        this.resume();

        // Use provided position or current position
        const startPos = position !== null ? position : song.transport.position;
        
        // Store last play position for Stop
        State.updateTransport({ lastPlayPosition: startPos });

        this.isPlaying = true;
        this.startTime = this.audioContext.currentTime;
        this.startPosition = startPos;

        // Start all tracks
        song.tracks.forEach(track => {
            this.startTrack(track.id, startPos);
        });

        State.setPlaybackState('playing');
        this.startPositionUpdate();
    }

    /**
     * Start a single track
     */
    startTrack(trackId, position) {
        const track = State.getTrack(trackId);
        if (!track) return;

        const nodes = this.trackNodes.get(trackId);
        if (!nodes || !nodes.audioBuffer) return;

        // Check if track should be audible
        const isTrackAudible = State.isTrackAudible(trackId);
        
        // Check if current section is muted
        const song = State.getActiveSong();
        let isSectionMuted = false;
        if (song && song.sections && song.sections.length > 0) {
            const currentSection = getSectionAtTime(song.sections, position);
            if (currentSection) {
                isSectionMuted = State.isSectionMuted(trackId, currentSection.index);
            }
        }

        // Stop existing source
        if (nodes.source) {
            try {
                nodes.source.stop();
            } catch (e) {}
        }

        // Create new source
        const source = this.audioContext.createBufferSource();
        source.buffer = nodes.audioBuffer;
        
        // Note: Speed and pitch are handled by the SoundTouch worklet
        // Source plays at normal rate, pitchShifter does the processing
        source.playbackRate.value = 1.0;

        source.connect(nodes.gainNode);
        nodes.source = source;

        // Set gain based on track audibility AND section mute state
        const shouldBeMuted = !isTrackAudible || isSectionMuted;
        nodes.gainNode.gain.value = shouldBeMuted ? 0 : track.volume / 100;

        // Calculate offset, clamped to valid range
        const offset = Math.max(0, Math.min(position, nodes.audioBuffer.duration));
        
        // Start playback
        source.start(0, offset);

        // Handle track end
        source.onended = () => {
            if (this.isPlaying) {
                // Check if all tracks have ended
                this.checkPlaybackComplete();
            }
        };
    }

    /**
     * Stop playback and return to last play position
     */
    stop() {
        const song = State.getActiveSong();
        if (!song) return;

        this.isPlaying = false;
        this.stopPositionUpdate();

        // Stop all sources
        this.trackNodes.forEach((nodes, trackId) => {
            if (nodes.source) {
                try {
                    nodes.source.stop();
                } catch (e) {}
                nodes.source = null;
            }
        });

        // Clear pitch shifter buffers
        if (this.pitchShifter) {
            this.pitchShifter.clear();
        }

        // Clear section mute tracking state
        this.trackSectionState.clear();

        // Return to last play position
        State.setPosition(song.transport.lastPlayPosition);
        State.setPlaybackState('stopped');
    }

    /**
     * Pause playback at current position
     */
    pause() {
        if (!this.isPlaying) return;

        const currentPos = this.getCurrentPosition();
        
        this.isPlaying = false;
        this.stopPositionUpdate();

        // Stop all sources
        this.trackNodes.forEach((nodes, trackId) => {
            if (nodes.source) {
                try {
                    nodes.source.stop();
                } catch (e) {}
                nodes.source = null;
            }
        });

        // Clear pitch shifter buffers
        if (this.pitchShifter) {
            this.pitchShifter.clear();
        }

        // Clear section mute tracking state
        this.trackSectionState.clear();

        // Keep position where we stopped
        State.setPosition(currentPos);
        State.setPlaybackState('paused');
    }

    /**
     * Get current playback position
     * Note: Since SoundTouch handles tempo, the source plays at 1.0 rate.
     * The position in the original audio advances at real-time rate.
     */
    getCurrentPosition() {
        if (!this.isPlaying) {
            const song = State.getActiveSong();
            return song ? song.transport.position : 0;
        }

        // Source plays at 1.0 rate, so elapsed real time = position in original audio
        // SoundTouch time-stretches the output, but we track source position
        const elapsed = this.audioContext.currentTime - this.startTime;
        return this.startPosition + elapsed;
    }

    /**
     * Seek to a position
     */
    seek(position) {
        const wasPlaying = this.isPlaying;
        
        if (wasPlaying) {
            // Stop current playback
            this.trackNodes.forEach((nodes) => {
                if (nodes.source) {
                    try {
                        nodes.source.stop();
                    } catch (e) {}
                    nodes.source = null;
                }
            });
        }

        // Clear the pitch shifter buffers to avoid stale audio
        if (this.pitchShifter) {
            this.pitchShifter.clear();
        }

        State.setPosition(position);

        // Scroll waveform panel to keep playhead visible
        const song = State.getActiveSong();
        if (song) {
            const zoom = song.timeline?.zoom || 1;
            const offset = song.timeline?.offset || 0;
            const pixelPosition = position * BASE_PIXELS_PER_SECOND * zoom;
            const adjustedPosition = pixelPosition + (offset * BASE_PIXELS_PER_SECOND * zoom);
            
            // Get waveform panel and call its scroll method
            const waveformPanel = getWaveformPanel();
            if (waveformPanel) {
                waveformPanel.scrollToPlayhead(adjustedPosition);
            }
        }

        if (wasPlaying) {
            // Resume from new position
            this.play(position);
        }
    }

    /**
     * Start position update loop
     */
    startPositionUpdate() {
        const update = () => {
            if (!this.isPlaying) return;
            
            const position = this.getCurrentPosition();
            
            // Check if loop is active and we've reached the loop end
            const song = State.getActiveSong();
            if (song) {
                const { loopEnabled, loopStart, loopEnd } = song.transport;
                
                if (loopEnabled && loopStart !== null && loopEnd !== null) {
                    // Only loop back if position is close to loopEnd (within 0.1s tolerance)
                    // This prevents looping when user deliberately seeks past the loop
                    if (position >= loopEnd && position < loopEnd + 0.1) {
                        // Loop back to start
                        this.seek(loopStart);
                        return; // seek() will restart position update if playing
                    }
                }
            }
            
            // Update section mutes for all tracks
            this.updateAllSectionMutes(position);
            
            State.setPosition(position);
            
            // Check if we've reached the end
            const maxDuration = State.getMaxDuration();
            if (position >= maxDuration) {
                this.stop();
                return;
            }

            this.animationFrame = requestAnimationFrame(update);
        };

        this.animationFrame = requestAnimationFrame(update);
    }

    /**
     * Stop position update loop
     */
    stopPositionUpdate() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    /**
     * Check if all tracks have finished playing
     */
    checkPlaybackComplete() {
        const position = this.getCurrentPosition();
        const maxDuration = State.getMaxDuration();
        
        if (position >= maxDuration - 0.1) {
            this.stop();
        }
    }

    /**
     * Update track volume
     */
    setTrackVolume(trackId, volume) {
        const nodes = this.trackNodes.get(trackId);
        if (nodes && nodes.gainNode) {
            const isAudible = State.isTrackAudible(trackId);
            nodes.gainNode.gain.value = isAudible ? volume / 100 : 0;
        }
    }

    /**
     * Update track pan
     */
    setTrackPan(trackId, pan) {
        const nodes = this.trackNodes.get(trackId);
        if (nodes && nodes.panNode) {
            nodes.panNode.pan.value = pan / 100;
        }
    }

    /**
     * Update track audibility (solo/mute)
     */
    updateTrackAudibility(trackId) {
        const track = State.getTrack(trackId);
        const nodes = this.trackNodes.get(trackId);
        
        if (track && nodes && nodes.gainNode) {
            const isTrackAudible = State.isTrackAudible(trackId);
            
            // Also check section mute if playing
            let isSectionMuted = false;
            if (this.isPlaying) {
                const song = State.getActiveSong();
                if (song && song.sections && song.sections.length > 0) {
                    const position = this.getCurrentPosition();
                    const currentSection = getSectionAtTime(song.sections, position);
                    if (currentSection) {
                        isSectionMuted = State.isSectionMuted(trackId, currentSection.index);
                    }
                }
            }
            
            const shouldBeMuted = !isTrackAudible || isSectionMuted;
            nodes.gainNode.gain.value = shouldBeMuted ? 0 : track.volume / 100;
        }
    }

    /**
     * Update all tracks' audibility
     */
    updateAllTracksAudibility() {
        const song = State.getActiveSong();
        if (!song) return;

        song.tracks.forEach(track => {
            this.updateTrackAudibility(track.id);
        });
    }

    /**
     * Update section mute state for a track based on current position
     * Uses smooth gain ramps to avoid audio clicks
     * @param {string} trackId - Track ID
     * @param {number} currentTime - Current playback position in seconds
     */
    updateSectionMuteForTrack(trackId, currentTime) {
        const song = State.getActiveSong();
        if (!song || !song.sections || song.sections.length === 0) return;
        
        const track = State.getTrack(trackId);
        const nodes = this.trackNodes.get(trackId);
        if (!track || !nodes || !nodes.gainNode) return;
        
        // Get current section
        const currentSection = getSectionAtTime(song.sections, currentTime);
        if (!currentSection) return;
        
        const sectionIndex = currentSection.index;
        const isSectionMuted = State.isSectionMuted(trackId, sectionIndex);
        
        // Get previous state
        let prevState = this.trackSectionState.get(trackId);
        if (!prevState) {
            prevState = { currentSectionIndex: -1, isSectionMuted: false };
            this.trackSectionState.set(trackId, prevState);
        }
        
        // Check if section mute state has changed
        const stateChanged = prevState.currentSectionIndex !== sectionIndex || 
                            prevState.isSectionMuted !== isSectionMuted;
        
        if (stateChanged) {
            // Update stored state
            prevState.currentSectionIndex = sectionIndex;
            prevState.isSectionMuted = isSectionMuted;
            
            // Calculate target gain
            const isTrackAudible = State.isTrackAudible(trackId);
            const shouldBeMuted = !isTrackAudible || isSectionMuted;
            const targetGain = shouldBeMuted ? 0 : track.volume / 100;
            
            // Apply smooth gain ramp (~50ms)
            // setTargetAtTime with timeConstant of 0.015 reaches ~95% in 50ms
            const now = this.audioContext.currentTime;
            nodes.gainNode.gain.cancelScheduledValues(now);
            nodes.gainNode.gain.setTargetAtTime(targetGain, now, 0.015);
        }
    }

    /**
     * Update section mutes for all tracks
     * @param {number} currentTime - Current playback position in seconds
     */
    updateAllSectionMutes(currentTime) {
        const song = State.getActiveSong();
        if (!song) return;
        
        song.tracks.forEach(track => {
            this.updateSectionMuteForTrack(track.id, currentTime);
        });
    }

    /**
     * Force update section mute for a specific track (e.g., when user toggles mute)
     * @param {string} trackId - Track ID
     */
    applySectionMuteChange(trackId) {
        if (!this.isPlaying) return;
        
        const position = this.getCurrentPosition();
        
        // Reset the tracked state so it will be recalculated
        this.trackSectionState.delete(trackId);
        
        // Update immediately
        this.updateSectionMuteForTrack(trackId, position);
    }

    /**
     * Set playback speed (time stretch)
     * Uses SoundTouch worklet for high-quality time stretching without pitch change
     */
    setSpeed(speed) {
        this._speed = speed;
        
        // Update the SoundTouch worklet tempo
        if (this.pitchShifter) {
            this.pitchShifter.tempo = speed;
        }
    }

    /**
     * Set pitch (semitones)
     * Uses SoundTouch worklet for pitch shifting without speed change
     */
    setPitch(semitones) {
        this._pitch = semitones;
        
        // Update the SoundTouch worklet pitch
        if (this.pitchShifter) {
            this.pitchShifter.pitchSemitones = semitones;
        }
    }

    /**
     * Extract waveform peaks from an audio buffer
     * @param {AudioBuffer} audioBuffer
     * @param {number} samplesPerSecond - Number of peak samples per second of audio
     * @returns {Float32Array} - Peak values normalized to 0-1
     */
    extractPeaks(audioBuffer, samplesPerSecond = 200) {
        const channelData = audioBuffer.getChannelData(0);
        const totalSamples = channelData.length;
        
        // Compute duration explicitly from sample count and sample rate
        // This avoids precision issues with audioBuffer.duration, especially for
        // MP3 files that get resampled (e.g., 44100 Hz -> 48000 Hz)
        const duration = totalSamples / audioBuffer.sampleRate;
        
        // Calculate number of peak samples based on duration
        // Use at least 2000 samples, or 200 samples per second, whichever is greater
        const peakCount = Math.max(2000, Math.ceil(duration * samplesPerSecond));
        
        const peaks = new Float32Array(peakCount);
        
        for (let i = 0; i < peakCount; i++) {
            // Use proportional indexing to ensure peaks exactly span the full duration
            // This avoids drift caused by Math.floor(blockSize) truncation
            // Peak i represents the time range: [i/peakCount * duration, (i+1)/peakCount * duration]
            const start = Math.floor(i * totalSamples / peakCount);
            const end = Math.floor((i + 1) * totalSamples / peakCount);
            
            let max = 0;
            let min = 0;
            
            // Find both max and min for more accurate representation
            for (let j = start; j < end; j++) {
                const sample = channelData[j];
                if (sample > max) max = sample;
                if (sample < min) min = sample;
            }
            
            // Use the larger absolute value for more accurate peaks
            peaks[i] = Math.max(Math.abs(max), Math.abs(min));
        }
        
        return peaks;
    }

    /**
     * Remove a track's audio nodes (but keep AudioBuffer cached for tab switching)
     * @param {string} trackId 
     * @param {boolean} clearBuffer - If true, also clear the AudioBuffer cache
     */
    removeTrack(trackId, clearBuffer = false) {
        this.disposeTrackNodes(trackId);
        if (clearBuffer) {
            this.clearAudioBuffer(trackId);
        }
    }

    /**
     * Get AudioBuffer for a track
     */
    getTrackBuffer(trackId) {
        const nodes = this.trackNodes.get(trackId);
        return nodes ? nodes.audioBuffer : null;
    }

    /**
     * Cleanup all resources
     */
    dispose() {
        this.stop();
        
        this.trackNodes.forEach((nodes, trackId) => {
            this.disposeTrackNodes(trackId);
        });
        
        this.audioBuffers.clear();
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

// Singleton instance
let audioEngineInstance = null;

export function getAudioEngine() {
    if (!audioEngineInstance) {
        audioEngineInstance = new AudioEngine();
    }
    return audioEngineInstance;
}

// Subscribe to section mute changes to update audio in real-time
State.subscribe(State.Events.SECTION_MUTE_UPDATED, ({ trackId, sectionIndex, muted }) => {
    if (audioEngineInstance) {
        audioEngineInstance.applySectionMuteChange(trackId);
    }
});

export default AudioEngine;

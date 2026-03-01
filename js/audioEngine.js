/**
 * Audio Engine
 * Handles Web Audio API, audio loading, playback, and pitch/time stretching
 * Uses SoundTouch via AudioWorklet for high-quality independent speed/pitch control
 * 
 * Phase 8 cleanup: Removed legacy virtual sections and marker-based mutes.
 * Now uses only Phase 3 arrangement sections (time-based enable/disable)
 * and Phase 4 mute sections (time-based per-track mutes).
 */

import * as State from './state.js';
import { BASE_PIXELS_PER_SECOND } from './ui/waveformPanel.js';
import { getWaveformPanel } from './ui/waveformPanel.js';
import { getPreference } from './storage.js';

// Crossfade duration for section skipping (Phase 3)
const SECTION_SKIP_CROSSFADE_MS = 50;

class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.pitchShifter = null; // PitchShifterWorklet for tempo/pitch processing (normal tracks)
        this.bypassPitchShifter = null; // PitchShifterWorklet for pitch-exempt tracks (pitch always 0, same tempo)
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
        // trackId -> { isSectionMuted: boolean }
        this.trackSectionState = new Map();
        this.sourceStartPosition = 0;  // Source position when playback started
        this.isInCrossfade = false;    // Flag to prevent multiple crossfades
        
        // Tab visibility handling - auto-pause when tab is hidden
        this.autoPausedForVisibility = false;
        
        // Pre-scheduled event tracking for background tab support
        this.scheduledSkipTimeout = null;   // setTimeout ID for section skip
        this.scheduledLoopTimeout = null;   // setTimeout ID for loop
        this.scheduledEndTimeout = null;    // setTimeout ID for end-of-song (mashup advance)
        
        // Guard flag to prevent concurrent play() calls
        this.isPlayInProgress = false;
    }

    /**
     * Initialize the audio context and pitch shifter worklet
     * Must be called after user interaction
     */
    async init() {
        if (this.audioContext) return;
        
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Initialize the SoundTouch pitch shifter worklet for normal tracks
        // PitchShifterWorklet is loaded from soundtouch.js (global)
        this.pitchShifter = new PitchShifterWorklet(this.audioContext);
        await this.pitchShifter.init();
        
        // Initialize a second pitch shifter for pitch-exempt tracks
        // This ensures exempt tracks have the same latency as pitched tracks (staying in sync)
        // but with pitch always set to 0 semitones
        this.bypassPitchShifter = new PitchShifterWorklet(this.audioContext);
        await this.bypassPitchShifter.init();
        this.bypassPitchShifter.pitchSemitones = 0; // Always keep at 0
        
        // Create master gain node
        this.masterGain = this.audioContext.createGain();
        
        // Connect both pitch shifters to master gain -> destination
        this.pitchShifter.connect(this.masterGain);
        this.bypassPitchShifter.connect(this.masterGain);
        this.masterGain.connect(this.audioContext.destination);
        
        // Listen for tab visibility changes to pause/resume playback
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
        
        console.log('Audio engine initialized with SoundTouch worklets (primary + bypass), sample rate:', this.audioContext.sampleRate);
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
     * Handle browser tab visibility changes
     * Pauses playback when tab is hidden to prevent:
     * 1. Custom arrangements playing wrong audio (section transitions rely on requestAnimationFrame)
     * 2. Position drift when returning to tab
     * 
     * This behavior can be disabled in Preferences.
     */
    handleVisibilityChange() {
        if (document.hidden) {
            // Tab became hidden - check if pause-on-blur is enabled
            if (getPreference('pauseOnBlur')) {
                if (this.isPlaying) {
                    this.autoPausedForVisibility = true;
                    this.pause();
                    console.log('Audio auto-paused due to tab visibility change');
                }
            }
            // If pauseOnBlur is disabled, scheduled timeouts will handle skips/loops
        } else {
            // Tab became visible - cancel scheduled events, let RAF take over
            // This prevents race conditions between scheduled timeouts and RAF
            this.cancelScheduledEvents();
            
            // Auto-resume if we auto-paused
            if (this.autoPausedForVisibility) {
                this.autoPausedForVisibility = false;
                this.play();
                console.log('Audio auto-resumed due to tab visibility change');
            }
        }
    }

    // =========================================================================
    // Pre-scheduled Events (for background tab support)
    // =========================================================================

    /**
     * Cancel any pending scheduled skip or loop events
     */
    cancelScheduledEvents() {
        if (this.scheduledSkipTimeout) {
            clearTimeout(this.scheduledSkipTimeout);
            this.scheduledSkipTimeout = null;
        }
        if (this.scheduledLoopTimeout) {
            clearTimeout(this.scheduledLoopTimeout);
            this.scheduledLoopTimeout = null;
        }
        if (this.scheduledEndTimeout) {
            clearTimeout(this.scheduledEndTimeout);
            this.scheduledEndTimeout = null;
        }
    }

    /**
     * Calculate when the next section skip needs to happen
     * @param {number} currentPosition - Current virtual position
     * @returns {{ time: number, target: number|null }|null} - Skip time and target, or null if no skip needed
     */
    calculateNextSkip(currentPosition) {
        const currentSection = State.getArrangementSectionAtTime(currentPosition);
        
        if (!currentSection) return null;
        
        if (!currentSection.enabled) {
            // Already in disabled section - need immediate skip
            const nextEnabled = State.getNextEnabledArrangementSection(currentPosition);
            if (nextEnabled) {
                return { time: currentPosition, target: nextEnabled.start };
            }
            // No more enabled sections - signal stop
            return { time: currentPosition, target: null };
        }
        
        // We're in an enabled section - find when next disabled section starts
        let checkPosition = currentSection.end;
        
        while (checkPosition < State.getMaxDuration()) {
            const nextSection = State.getArrangementSectionAtTime(checkPosition + 0.001);
            
            if (!nextSection) break;
            
            if (!nextSection.enabled) {
                // Found a disabled section - we need to skip when we reach it
                const nextEnabled = State.getNextEnabledArrangementSection(checkPosition);
                if (nextEnabled) {
                    return { time: checkPosition, target: nextEnabled.start };
                } else {
                    // No more enabled sections after this - will stop
                    return { time: checkPosition, target: null };
                }
            }
            
            // This section is enabled, check the next one
            checkPosition = nextSection.end;
        }
        
        return null; // No skip needed
    }

    /**
     * Calculate where to jump when loop triggers (accounting for disabled sections)
     * @param {number} loopStart - Loop start position
     * @param {number} loopEnd - Loop end position
     * @returns {number|null} - Target position, or null if no valid target
     */
    calculateLoopTarget(loopStart, loopEnd) {
        if (!State.hasDisabledArrangementSections()) {
            return loopStart;
        }
        
        const sectionAtLoopStart = State.getArrangementSectionAtTime(loopStart);
        
        if (sectionAtLoopStart && !sectionAtLoopStart.enabled) {
            const nextEnabled = State.getEnabledArrangementSectionAtOrAfter(loopStart);
            if (nextEnabled && nextEnabled.start < loopEnd) {
                return nextEnabled.start;
            }
            return null; // No valid loop target
        }
        
        return loopStart;
    }

    /**
     * Schedule a section skip
     * @param {number} skipTime - Virtual time when skip should occur
     * @param {number|null} skipTarget - Target position to skip to, or null to stop
     * @param {number} currentPosition - Current virtual position
     */
    scheduleSkip(skipTime, skipTarget, currentPosition) {
        const timeUntilSkip = skipTime - currentPosition;
        const realTimeUntilSkip = timeUntilSkip / this._speed;
        
        // Trigger slightly early to allow for crossfade
        const delay = Math.max(0, (realTimeUntilSkip - SECTION_SKIP_CROSSFADE_MS / 1000) * 1000);
        
        this.scheduledSkipTimeout = setTimeout(() => {
            this.scheduledSkipTimeout = null;
            this.executeScheduledSkip(skipTarget);
        }, delay);
    }

    /**
     * Schedule a loop
     * @param {number} loopTime - Virtual time when loop should trigger (loopEnd)
     * @param {number} loopTarget - Target position to loop to
     * @param {number} currentPosition - Current virtual position
     */
    scheduleLoop(loopTime, loopTarget, currentPosition) {
        const timeUntilLoop = loopTime - currentPosition;
        const realTimeUntilLoop = timeUntilLoop / this._speed;
        const delay = Math.max(0, realTimeUntilLoop * 1000);
        
        this.scheduledLoopTimeout = setTimeout(() => {
            this.scheduledLoopTimeout = null;
            this.executeScheduledLoop(loopTarget);
        }, delay);
    }

    /**
     * Execute a scheduled section skip
     * @param {number|null} target - Target position, or null to stop
     */
    executeScheduledSkip(target) {
        if (!this.isPlaying) return;
        
        const song = State.getActiveSong();
        if (!song) return;
        
        const { loopEnabled, loopStart, loopEnd } = song.transport;
        const currentPosition = this.getCurrentPosition();
        
        // Check if loop end falls within the range we're about to skip
        // If so, loop back instead of skipping forward (matches RAF behavior)
        if (loopEnabled && loopEnd !== null && target !== null) {
            // loopEnd is in skip range if it's between current position and skip target
            if (loopEnd >= currentPosition && loopEnd < target) {
                const loopTarget = this.calculateLoopTarget(loopStart, loopEnd);
                if (loopTarget !== null) {
                    this.seek(loopTarget);
                    return;
                }
            }
            // Also check if loopEnd is within a disabled section we're in or about to enter
            const sectionAtLoopEnd = State.getArrangementSectionAtTime(loopEnd);
            if (sectionAtLoopEnd && !sectionAtLoopEnd.enabled && loopEnd >= currentPosition) {
                const loopTarget = this.calculateLoopTarget(loopStart, loopEnd);
                if (loopTarget !== null) {
                    this.seek(loopTarget);
                    return;
                }
            }
        }
        
        if (target === null) {
            // No more enabled sections - check mashup advance or stop
            import('./mashupController.js').then(({ tryMashupAdvance }) => {
                tryMashupAdvance().then(advanced => {
                    if (!advanced) {
                        this.stop();
                    }
                });
            });
            return;
        }
        
        this.skipToPosition(target, SECTION_SKIP_CROSSFADE_MS / 1000);
        // Note: skipToPosition will call scheduleNextEvents() after completing
    }

    /**
     * Execute a scheduled loop
     * @param {number} target - Target position to loop to
     */
    executeScheduledLoop(target) {
        if (!this.isPlaying) return;
        
        this.seek(target);
        // Note: seek() -> play() will call scheduleNextEvents()
    }

    /**
     * Schedule the next section skip and/or loop event
     * Called after play, seek, skip, speed change, or arrangement/loop change
     */
    scheduleNextEvents() {
        this.cancelScheduledEvents();
        
        if (!this.isPlaying) return;
        
        const song = State.getActiveSong();
        if (!song) return;
        
        const currentPosition = this.getCurrentPosition();
        const { loopEnabled, loopStart, loopEnd } = song.transport;
        const hasDisabledSections = State.hasDisabledArrangementSections();
        
        // Calculate next skip time (if applicable)
        let skipInfo = null;
        if (hasDisabledSections) {
            skipInfo = this.calculateNextSkip(currentPosition);
        }
        
        // Calculate next loop time (if applicable)
        let loopInfo = null;
        if (loopEnabled && loopStart !== null && loopEnd !== null && currentPosition < loopEnd) {
            const loopTarget = this.calculateLoopTarget(loopStart, loopEnd);
            if (loopTarget !== null) {
                loopInfo = { time: loopEnd, target: loopTarget };
            }
        }
        
        // Determine which event comes first and schedule it
        // Note: If loopEnd falls within a skip range or disabled section,
        // executeScheduledSkip() will handle converting the skip to a loop at execution time.
        // If a skip would happen before loop end, schedule the skip
        // If loop end comes first, schedule the loop
        
        if (skipInfo && loopInfo) {
            // Both events possible - which comes first?
            if (skipInfo.time < loopInfo.time) {
                // Skip comes first
                this.scheduleSkip(skipInfo.time, skipInfo.target, currentPosition);
            } else {
                // Loop comes first (or at same time)
                this.scheduleLoop(loopInfo.time, loopInfo.target, currentPosition);
            }
        } else if (skipInfo) {
            // Only skip needed
            this.scheduleSkip(skipInfo.time, skipInfo.target, currentPosition);
        } else if (loopInfo) {
            // Only loop needed
            this.scheduleLoop(loopInfo.time, loopInfo.target, currentPosition);
        }
        
        // Schedule end-of-song event for mashup auto-advance (background tab support)
        // Only if no loop is active (loop takes priority over end-of-song)
        if (!loopEnabled && song.mashupGroupId) {
            const maxDuration = State.getMaxDuration();
            if (currentPosition < maxDuration) {
                const timeUntilEnd = (maxDuration - currentPosition) / this._speed;
                const delayMs = timeUntilEnd * 1000;
                
                if (delayMs > 0 && delayMs < 600000) { // Cap at 10 minutes
                    this.scheduledEndTimeout = setTimeout(() => {
                        this.scheduledEndTimeout = null;
                        if (this.isPlaying) {
                            import('./mashupController.js').then(({ tryMashupAdvance }) => {
                                tryMashupAdvance().then(advanced => {
                                    if (!advanced) {
                                        this.stop();
                                    }
                                });
                            });
                        }
                    }, delayMs);
                }
            }
        }
    }

    /**
     * Reset both pitch shifters by creating fresh instances
     * This clears all internal SoundTouch buffers to prevent stale audio
     * from playing after stop/seek operations when speed != 1.0
     * 
     * Note: This method is protected by the isPlayInProgress guard in play()
     */
    async resetPitchShifter() {
        if (!this.pitchShifter || !this.audioContext) return;
        
        // Store current settings
        const currentSpeed = this._speed;
        const currentPitch = this._pitch;
        
        // Disconnect old pitch shifters from master gain
        this.pitchShifter.disconnect();
        if (this.bypassPitchShifter) {
            this.bypassPitchShifter.disconnect();
        }
        
        // Create new PitchShifterWorklet instances
        this.pitchShifter = new PitchShifterWorklet(this.audioContext);
        await this.pitchShifter.init();
        
        this.bypassPitchShifter = new PitchShifterWorklet(this.audioContext);
        await this.bypassPitchShifter.init();
        
        // Restore settings: tempo stays at 1.0 (speed handled by source.playbackRate),
        // pitch = 1/speed to compensate for playbackRate's pitch shift.
        // Primary also gets the user's pitchSemitones; bypass stays at 0.
        const pitchCorrection = 1 / currentSpeed;
        this.pitchShifter.tempo = 1.0;
        this.pitchShifter.pitch = pitchCorrection;
        this.pitchShifter.pitchSemitones = currentPitch;
        
        this.bypassPitchShifter.tempo = 1.0;
        this.bypassPitchShifter.pitch = pitchCorrection;
        this.bypassPitchShifter.pitchSemitones = 0; // Always 0 for exempt tracks
        
        // Reconnect both pitch shifters to masterGain
        this.pitchShifter.connect(this.masterGain);
        this.bypassPitchShifter.connect(this.masterGain);
        
        // Reconnect all track panNodes - respecting pitch-exempt status
        this.trackNodes.forEach((nodes, trackId) => {
            if (nodes.panNode) {
                // Disconnect from old (now defunct) pitchShifter input
                try {
                    nodes.panNode.disconnect();
                } catch (e) {}
                // Reconnect gain -> pan
                nodes.gainNode.connect(nodes.panNode);
                
                // Route based on pitch-exempt status
                const isPitchExempt = State.isTrackPitchExempt(trackId);
                if (isPitchExempt) {
                    nodes.panNode.connect(this.bypassPitchShifter.inputNode);
                } else {
                    nodes.panNode.connect(this.pitchShifter.inputNode);
                }
                nodes.isPitchExempt = isPitchExempt;
            }
        });
    }

    /**
     * Mute/unmute master output to prevent audio bursts from stale SoundTouch buffers
     * @param {boolean} muted - Whether to mute
     * @param {number} fadeTime - Fade duration in seconds (0 for immediate)
     */
    setMasterMuted(muted, fadeTime = 0) {
        if (!this.masterGain) return;
        const targetValue = muted ? 0 : 1;
        if (fadeTime > 0) {
            this.masterGain.gain.linearRampToValueAtTime(
                targetValue,
                this.audioContext.currentTime + fadeTime
            );
        } else {
            this.masterGain.gain.setValueAtTime(
                targetValue,
                this.audioContext.currentTime
            );
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
     * Serialize an AudioBuffer into a binary Blob for OPFS storage.
     * Format: 16-byte header [sampleRate(f64), numChannels(u32), length(u32)]
     *         followed by raw Float32 channel data for each channel.
     * @param {AudioBuffer} audioBuffer
     * @returns {Blob}
     */
    serializeAudioBuffer(audioBuffer) {
        const header = new ArrayBuffer(16);
        const view = new DataView(header);
        view.setFloat64(0, audioBuffer.sampleRate);
        view.setUint32(8, audioBuffer.numberOfChannels);
        view.setUint32(12, audioBuffer.length);

        const parts = [header];
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
            // getChannelData returns a Float32Array view into the AudioBuffer's internal memory.
            // We must copy it because the Blob constructor needs a stable snapshot.
            const channelData = audioBuffer.getChannelData(ch);
            parts.push(new Float32Array(channelData).buffer);
        }

        return new Blob(parts);
    }

    /**
     * Deserialize a PCM Blob back into an AudioBuffer.
     * This is much faster than decodeAudioData() since no decompression is needed.
     * @param {Blob} pcmBlob - Blob created by serializeAudioBuffer()
     * @returns {Promise<AudioBuffer>}
     */
    async deserializeAudioBuffer(pcmBlob) {
        await this.init();

        const buffer = await pcmBlob.arrayBuffer();
        const view = new DataView(buffer);
        const sampleRate = view.getFloat64(0);
        const numChannels = view.getUint32(8);
        const length = view.getUint32(12);

        const audioBuffer = this.audioContext.createBuffer(numChannels, length, sampleRate);
        let offset = 16;
        for (let ch = 0; ch < numChannels; ch++) {
            const channelData = new Float32Array(buffer, offset, length);
            audioBuffer.copyToChannel(channelData, ch);
            offset += length * 4;
        }

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

        // Connect chain: gainNode -> panNode -> [pitchShifter OR bypassPitchShifter] -> masterGain -> destination
        // Pitch-exempt tracks go through bypassPitchShifter (pitch=0) to maintain same latency as pitched tracks
        gainNode.connect(panNode);
        
        const isPitchExempt = State.isTrackPitchExempt(trackId);
        if (isPitchExempt) {
            // Route through bypass pitch shifter (pitch=0, same tempo) for consistent latency
            panNode.connect(this.bypassPitchShifter.inputNode);
        } else {
            // Normal: route through primary pitch shifter
            panNode.connect(this.pitchShifter.inputNode);
        }

        const nodes = {
            audioBuffer,
            gainNode,
            panNode,
            source: null,
            isPitchExempt // Track current routing state for updateTrackPitchRouting
        };

        this.trackNodes.set(trackId, nodes);
        return nodes;
    }

    /**
     * Update pitch routing for a track (when pitch-exempt status changes)
     * Disconnects from current destination and reconnects to the appropriate one
     * @param {string} trackId - Track ID
     */
    updateTrackPitchRouting(trackId) {
        const nodes = this.trackNodes.get(trackId);
        if (!nodes || !nodes.panNode) return;
        
        const isPitchExempt = State.isTrackPitchExempt(trackId);
        
        // Check if routing actually changed
        if (nodes.isPitchExempt === isPitchExempt) return;
        
        // Disconnect from current destination
        nodes.panNode.disconnect();
        
        // Reconnect to appropriate destination
        if (isPitchExempt) {
            // Route through bypass pitch shifter (pitch=0, same tempo) for consistent latency
            nodes.panNode.connect(this.bypassPitchShifter.inputNode);
        } else {
            // Normal: route through primary pitch shifter
            nodes.panNode.connect(this.pitchShifter.inputNode);
        }
        
        // Update tracked state
        nodes.isPitchExempt = isPitchExempt;
        
        console.log(`Track ${trackId} pitch routing: ${isPitchExempt ? 'bypass (pitch=0)' : 'primary'} pitch shifter`);
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
     * @param {number} position - Position in seconds (virtual time for arrangements)
     */
    async play(position = null) {
        // Guard against concurrent play calls
        if (this.isPlayInProgress) return;
        this.isPlayInProgress = true;
        
        try {
            const song = State.getActiveSong();
            if (!song || song.tracks.length === 0) return;

            this.resume();

            // Mute master output to prevent stale SoundTouch buffer audio from playing
            this.setMasterMuted(true, 0);

            // Reset pitch shifter to clear any stale audio in SoundTouch buffers
            // This prevents audio from old position playing when speed != 1.0
            await this.resetPitchShifter();

            // Use provided position or current position (always virtual time)
            let virtualPos = position !== null ? position : song.transport.position;
            
            // Phase 3: Check if starting in a disabled arrangement section
            // If so, skip to the next enabled section
            if (State.hasDisabledArrangementSections()) {
                const currentSection = State.getArrangementSectionAtTime(virtualPos);
                if (currentSection && !currentSection.enabled) {
                    // Find next enabled section
                    const nextEnabled = State.getNextEnabledArrangementSection(virtualPos);
                    if (nextEnabled) {
                        virtualPos = nextEnabled.start;
                        console.log(`Skipping disabled section, starting at ${virtualPos.toFixed(3)}s`);
                    } else {
                        // No more enabled sections - can't play
                        console.log('No enabled sections to play');
                        this.setMasterMuted(false, 0);
                        return;
                    }
                }
            }
            
            // Store last play position for Stop
            State.updateTransport({ lastPlayPosition: virtualPos });

            // Position is now directly the source position (no virtual timeline)
            const sourcePos = virtualPos;

            this.isPlaying = true;
            this.startTime = this.audioContext.currentTime;
            this.startPosition = sourcePos;
            this.sourceStartPosition = sourcePos;
            this.isInCrossfade = false;

            // Start all tracks at source position
            song.tracks.forEach(track => {
                this.startTrack(track.id, sourcePos);
            });

            State.setPlaybackState('playing');
            this.startPositionUpdate();
            
            // Schedule next section skip and/or loop for background tab support
            this.scheduleNextEvents();

            // Unmute after short delay to let SoundTouch pipeline flush stale data
            setTimeout(() => {
                if (this.isPlaying) {
                    this.setMasterMuted(false, 0.01); // Small fade to avoid clicks
                }
            }, 50);
        } finally {
            this.isPlayInProgress = false;
        }
    }

    /**
     * Start a single track at a source (audio) position
     * @param {string} trackId - Track ID
     * @param {number} sourcePosition - Position in source audio (not virtual time)
     */
    startTrack(trackId, sourcePosition) {
        const track = State.getTrack(trackId);
        if (!track) return;

        const nodes = this.trackNodes.get(trackId);
        if (!nodes || !nodes.audioBuffer) return;

        // Check if track should be audible
        const isTrackAudible = State.isTrackAudible(trackId);
        
        // Phase 4: Check time-based mute sections
        const timeMuteSection = State.getMuteSectionAtTime(trackId, sourcePosition);
        const isSectionMuted = timeMuteSection?.muted || false;

        // Stop existing source
        if (nodes.source) {
            try {
                nodes.source.stop();
            } catch (e) {}
        }

        // Create new source
        const source = this.audioContext.createBufferSource();
        source.buffer = nodes.audioBuffer;
        
        // Speed is handled by the source's playbackRate (native browser resampling).
        // SoundTouch worklet only handles pitch correction (compensating for the
        // pitch shift caused by playbackRate) and any user-requested pitch shift.
        source.playbackRate.value = this._speed;

        source.connect(nodes.gainNode);
        nodes.source = source;

        // Set gain based on track audibility AND section mute state
        const shouldBeMuted = !isTrackAudible || isSectionMuted;
        nodes.gainNode.gain.value = shouldBeMuted ? 0 : track.volume / 100;

        // Calculate offset, clamped to valid range
        const offset = Math.max(0, Math.min(sourcePosition, nodes.audioBuffer.duration));
        
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

        // Cancel any scheduled skip/loop events
        this.cancelScheduledEvents();

        // Mute master output to ensure clean stop
        this.setMasterMuted(true, 0);

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

        // Clear section mute tracking state
        this.trackSectionState.clear();
        this.isInCrossfade = false;

        // Return to last play position
        State.setPosition(song.transport.lastPlayPosition);
        State.setPlaybackState('stopped');
    }

    /**
     * Pause playback at current position
     */
    pause() {
        if (!this.isPlaying) return;

        // Cancel any scheduled skip/loop events
        this.cancelScheduledEvents();

        // Mute master output to ensure clean pause
        this.setMasterMuted(true, 0);

        const currentPos = this.getCurrentPosition(); // Virtual position
        
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

        // Clear section mute tracking state
        this.trackSectionState.clear();
        
        // Clear crossfade state but preserve virtual section index for resume
        this.isInCrossfade = false;

        // Keep position where we stopped (in virtual time)
        State.setPosition(currentPos);
        State.setPlaybackState('paused');
    }

    /**
     * Get current playback position (in song time)
     * Since source.playbackRate = speed, audio advances at speed * real-time.
     * Position = startPosition + elapsed * speed.
     */
    getCurrentPosition() {
        if (!this.isPlaying) {
            const song = State.getActiveSong();
            return song ? song.transport.position : 0;
        }

        // Calculate elapsed real time, scaled by speed to get song time
        const elapsed = this.audioContext.currentTime - this.startTime;
        return this.startPosition + elapsed * this._speed;
    }

    /**
     * Get current source (audio) position
     * Now the same as getCurrentPosition() since we removed virtual sections
     */
    getCurrentSourcePosition() {
        return this.getCurrentPosition();
    }

    /**
     * Seek to a position (virtual time for arrangements)
     * @param {number} virtualPosition - Target position in virtual time
     */
    seek(virtualPosition) {
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

        // Position stored in state is always virtual time
        State.setPosition(virtualPosition);

        // Scroll waveform panel to keep playhead visible
        const song = State.getActiveSong();
        if (song) {
            const zoom = song.timeline?.zoom || 1;
            const offset = song.timeline?.offset || 0;
            const pixelPosition = virtualPosition * BASE_PIXELS_PER_SECOND * zoom;
            const adjustedPosition = pixelPosition + (offset * BASE_PIXELS_PER_SECOND * zoom);
            
            // Get waveform panel and call its scroll method
            const waveformPanel = getWaveformPanel();
            if (waveformPanel) {
                waveformPanel.scrollToPlayhead(adjustedPosition);
            }
        }

        if (wasPlaying) {
            // Resume from new position (play() handles virtual-to-source conversion)
            this.play(virtualPosition);
        }
    }
    /**
     * Skip to a new position with crossfade (Phase 3)
     * Used when playback reaches a disabled arrangement section
     * @param {number} toPosition - Target position in seconds (source/virtual time - same for Phase 3)
     * @param {number} fadeDuration - Duration of crossfade in seconds
     */
    skipToPosition(toPosition, fadeDuration = 0.05) {
        if (this.isInCrossfade || !this.isPlaying) return;
        this.isInCrossfade = true;
        
        const now = this.audioContext.currentTime;
        
        // Fade out all current track gains
        this.trackNodes.forEach((nodes, trackId) => {
            if (nodes.gainNode) {
                nodes.gainNode.gain.cancelScheduledValues(now);
                nodes.gainNode.gain.setTargetAtTime(0, now, fadeDuration / 3);
            }
        });
        
        // After fade out, seek to new position
        setTimeout(() => {
            // Stop current sources
            this.trackNodes.forEach((nodes) => {
                if (nodes.source) {
                    try {
                        nodes.source.stop();
                    } catch (e) {}
                    nodes.source = null;
                }
            });
            
            // Update tracking state
            this.startTime = this.audioContext.currentTime;
            this.startPosition = toPosition;
            this.sourceStartPosition = toPosition;
            
            // Start at new position with fade in
            const song = State.getActiveSong();
            if (song) {
                song.tracks.forEach(track => {
                    this.startTrack(track.id, toPosition);
                    
                    // Fade in
                    const nodes = this.trackNodes.get(track.id);
                    if (nodes && nodes.gainNode) {
                        const isAudible = State.isTrackAudible(track.id);
                        const targetGain = isAudible ? track.volume / 100 : 0;
                        const nowFadeIn = this.audioContext.currentTime;
                        nodes.gainNode.gain.cancelScheduledValues(nowFadeIn);
                        nodes.gainNode.gain.setValueAtTime(0, nowFadeIn);
                        nodes.gainNode.gain.setTargetAtTime(targetGain, nowFadeIn, fadeDuration / 3);
                    }
                });
            }
            
            // Update state position
            State.setPosition(toPosition);
            
            this.isInCrossfade = false;
            
            // Restart the position update loop (it was stopped when we called skipToPosition)
            if (this.isPlaying) {
                this.startPositionUpdate();
                // Schedule next events after skip completes
                this.scheduleNextEvents();
            }
        }, fadeDuration * 1000);
    }

    /**
     * Start position update loop
     * Handles virtual timeline section transitions with crossfade
     * Phase 3: Also handles skipping disabled arrangement sections
     */
    startPositionUpdate() {
        const update = () => {
            if (!this.isPlaying) return;
            
            const virtualPosition = this.getCurrentPosition();
            const sourcePosition = this.getCurrentSourcePosition();
            
            const song = State.getActiveSong();
            if (!song) {
                this.animationFrame = requestAnimationFrame(update);
                return;
            }
            
            // Get loop state early - needed for disabled section checks
            const { loopEnabled, loopStart, loopEnd } = song.transport;
            
            // Phase 3: Check if entering a disabled arrangement section
            // This handles the case where playback reaches a disabled section boundary
            if (State.hasDisabledArrangementSections() && !this.isInCrossfade) {
                const currentSection = State.getArrangementSectionAtTime(virtualPosition);
                
                if (currentSection && !currentSection.enabled) {
                    // We've entered a disabled section - check if loop end is within this section
                    if (loopEnabled && loopEnd !== null && 
                        loopEnd >= currentSection.start && loopEnd <= currentSection.end) {
                        // Loop end is within this disabled section - loop back instead of skipping
                        console.log(`Loop end (${loopEnd.toFixed(3)}s) is within disabled section, looping back to start`);
                        this.seek(loopStart);
                        return;
                    }
                    
                    // Skip to next enabled section
                    const nextEnabled = State.getNextEnabledArrangementSection(virtualPosition);
                    
                    if (nextEnabled) {
                        // Check if loop end falls between current position and next enabled section
                        if (loopEnabled && loopEnd !== null &&
                            loopEnd > virtualPosition && loopEnd < nextEnabled.start) {
                            // Loop end is within the range we're about to skip - loop back instead
                            console.log(`Loop end (${loopEnd.toFixed(3)}s) is within skip range, looping back to start`);
                            this.seek(loopStart);
                            return;
                        }
                        
                        console.log(`Skipping disabled section at ${virtualPosition.toFixed(3)}s, jumping to ${nextEnabled.start.toFixed(3)}s`);
                        this.skipToPosition(nextEnabled.start, SECTION_SKIP_CROSSFADE_MS / 1000);
                        return;
                    } else {
                        // No more enabled sections - check if we should loop
                        if (loopEnabled && loopEnd !== null && loopEnd >= currentSection.start) {
                            console.log('No more enabled sections but loop end reached, looping back');
                            this.seek(loopStart);
                            return;
                        }
                        // No more enabled sections - check mashup advance or stop
                        console.log('No more enabled sections, checking mashup advance');
                        import('./mashupController.js').then(({ tryMashupAdvance }) => {
                            tryMashupAdvance().then(advanced => {
                                if (!advanced) {
                                    this.stop();
                                }
                            });
                        });
                        return;
                    }
                }
                
                // Also check if we're about to enter a disabled section (pre-emptive skip)
                // This creates a smoother transition by skipping slightly before the boundary
                if (currentSection && currentSection.enabled) {
                    const timeUntilEnd = currentSection.end - virtualPosition;
                    if (timeUntilEnd > 0 && timeUntilEnd < 0.05) { // Within 50ms of section end
                        // Check if the NEXT section is disabled
                        const nextSection = State.getArrangementSectionAtTime(currentSection.end + 0.001);
                        if (nextSection && !nextSection.enabled) {
                            // Check if loop end is within the disabled section we're about to enter
                            if (loopEnabled && loopEnd !== null &&
                                loopEnd >= nextSection.start && loopEnd <= nextSection.end) {
                                // Loop end is within the disabled section - loop back instead of skipping
                                console.log(`Pre-emptive: Loop end (${loopEnd.toFixed(3)}s) is within disabled section, looping back`);
                                this.seek(loopStart);
                                return;
                            }
                            
                            // Next section is disabled - find next enabled one
                            const nextEnabled = State.getNextEnabledArrangementSection(currentSection.end);
                            if (nextEnabled) {
                                // Check if loop end falls between current section end and next enabled section
                                if (loopEnabled && loopEnd !== null &&
                                    loopEnd > currentSection.end && loopEnd < nextEnabled.start) {
                                    // Loop end is within the range we're about to skip - loop back instead
                                    console.log(`Pre-emptive: Loop end (${loopEnd.toFixed(3)}s) is within skip range, looping back`);
                                    this.seek(loopStart);
                                    return;
                                }
                                
                                console.log(`Pre-emptive skip: section ending at ${currentSection.end.toFixed(3)}s, next enabled at ${nextEnabled.start.toFixed(3)}s`);
                                this.skipToPosition(nextEnabled.start, SECTION_SKIP_CROSSFADE_MS / 1000);
                                return;
                            } else {
                                // No more enabled sections after disabled - check if we should loop
                                if (loopEnabled && loopEnd !== null && loopEnd >= nextSection.start) {
                                    console.log('Pre-emptive: No more enabled sections but loop end in disabled, looping back');
                                    this.seek(loopStart);
                                    return;
                                }
                                // Will stop when we reach the disabled section
                            }
                        }
                    }
                }
            }
            
            // Check if loop is active and we've reached the loop end (in virtual time)
            // Note: loopEnabled, loopStart, loopEnd already extracted above for disabled section checks
            if (loopEnabled && loopStart !== null && loopEnd !== null) {
                // Only loop back if position is close to loopEnd (within 0.1s tolerance)
                // This prevents looping when user deliberately seeks past the loop
                if (virtualPosition >= loopEnd && virtualPosition < loopEnd + 0.1) {
                    // Phase 3: When looping back, find the first enabled position at or after loopStart
                    let targetPosition = loopStart;
                    
                    if (State.hasDisabledArrangementSections()) {
                        const sectionAtLoopStart = State.getArrangementSectionAtTime(loopStart);
                        
                        if (sectionAtLoopStart && !sectionAtLoopStart.enabled) {
                            // Loop start is in a disabled section, find next enabled
                            const nextEnabled = State.getEnabledArrangementSectionAtOrAfter(loopStart);
                            
                            if (nextEnabled && nextEnabled.start < loopEnd) {
                                targetPosition = nextEnabled.start;
                                console.log(`Loop start in disabled section, jumping to ${targetPosition.toFixed(3)}s`);
                            } else {
                                // No enabled section within loop range - check mashup advance or stop
                                console.log('No enabled sections within loop range, checking mashup advance');
                                import('./mashupController.js').then(({ tryMashupAdvance }) => {
                                    tryMashupAdvance().then(advanced => {
                                        if (!advanced) {
                                            this.stop();
                                        }
                                    });
                                });
                                return;
                            }
                        }
                    }
                    
                    // Loop back to target position (handles crossfade automatically via seek->play)
                    this.seek(targetPosition);
                    return; // seek() will restart position update if playing
                }
            }
            
            // Update section mutes for all tracks (Phase 4 time-based mutes)
            this.updateAllSectionMutes(sourcePosition);
            
            // Update UI with virtual position
            State.setPosition(virtualPosition);
            
            // Check if we've reached the end of the arrangement/song
            const maxDuration = State.getMaxDuration(); // Returns virtual duration for arrangements
            if (virtualPosition >= maxDuration) {
                // Check if this is a mashup entry that should auto-advance
                import('./mashupController.js').then(({ tryMashupAdvance }) => {
                    tryMashupAdvance().then(advanced => {
                        if (!advanced) {
                            this.stop();
                        }
                    });
                });
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
     * Stop all audio buffer sources without changing playback state.
     * Used by mashup controller during entry transitions.
     */
    stopAllSources() {
        this.trackNodes.forEach((nodes) => {
            if (nodes.source) {
                // Clear onended to prevent checkPlaybackComplete from firing
                nodes.source.onended = null;
                try {
                    nodes.source.stop();
                } catch (e) {}
                nodes.source = null;
            }
        });
        this.trackSectionState.clear();
        this.isInCrossfade = false;
        this.stopPositionUpdate();
        this.cancelScheduledEvents();
    }

    /**
     * Check if all tracks have finished playing
     */
    async checkPlaybackComplete() {
        const position = this.getCurrentPosition();
        const maxDuration = State.getMaxDuration();
        
        if (position >= maxDuration - 0.1) {
            // Check if this is a mashup entry that should auto-advance
            const { tryMashupAdvance } = await import('./mashupController.js');
            const advanced = await tryMashupAdvance();
            if (!advanced) {
                this.stop();
            }
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
                const sourcePosition = this.getCurrentSourcePosition();
                
                // Phase 4: Check time-based mute sections
                const timeMuteSection = State.getMuteSectionAtTime(trackId, sourcePosition);
                isSectionMuted = timeMuteSection?.muted || false;
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
     * Uses Phase 4 time-based mute sections
     * @param {string} trackId - Track ID
     * @param {number} sourceTime - Current source audio position in seconds
     */
    updateSectionMuteForTrack(trackId, sourceTime) {
        const song = State.getActiveSong();
        if (!song) return;
        
        const track = State.getTrack(trackId);
        const nodes = this.trackNodes.get(trackId);
        if (!track || !nodes || !nodes.gainNode) return;
        
        // Phase 4: Check time-based mute sections
        const timeMuteSection = State.getMuteSectionAtTime(trackId, sourceTime);
        const isSectionMuted = timeMuteSection?.muted || false;
        
        // Get previous state
        let prevState = this.trackSectionState.get(trackId);
        if (!prevState) {
            prevState = { isSectionMuted: false };
            this.trackSectionState.set(trackId, prevState);
        }
        
        // Check if section mute state has changed
        const stateChanged = prevState.isSectionMuted !== isSectionMuted;
        
        if (stateChanged) {
            // Update stored state
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
     * @param {number} sourceTime - Current source audio position in seconds
     */
    updateAllSectionMutes(sourceTime) {
        const song = State.getActiveSong();
        if (!song) return;
        
        song.tracks.forEach(track => {
            this.updateSectionMuteForTrack(track.id, sourceTime);
        });
    }

    /**
     * Force update section mute for a specific track (e.g., when user toggles mute)
     * @param {string} trackId - Track ID
     */
    applySectionMuteChange(trackId) {
        if (!this.isPlaying) return;
        
        const sourcePosition = this.getCurrentSourcePosition();
        
        // Reset the tracked state so it will be recalculated
        this.trackSectionState.delete(trackId);
        
        // Update immediately
        this.updateSectionMuteForTrack(trackId, sourcePosition);
    }

    /**
     * Set playback speed
     * Speed is applied via BufferSourceNode.playbackRate (native browser resampling).
     * SoundTouch compensates for the resulting pitch shift with pitch = 1/speed.
     */
    setSpeed(speed) {
        // Capture current position before changing speed to prevent position jump.
        // getCurrentPosition() uses this._speed, so we must snapshot before updating.
        if (this.isPlaying) {
            const currentPos = this.getCurrentPosition();
            this.startPosition = currentPos;
            this.startTime = this.audioContext.currentTime;
        }
        
        this._speed = speed;
        
        // SoundTouch: no time-stretching (tempo=1.0), only pitch correction (1/speed)
        // to cancel the pitch shift caused by the source's playbackRate.
        // User pitch adjustments are applied independently via pitchSemitones.
        const pitchCorrection = 1 / speed;
        if (this.pitchShifter) {
            this.pitchShifter.tempo = 1.0;
            this.pitchShifter.pitch = pitchCorrection;
        }
        if (this.bypassPitchShifter) {
            this.bypassPitchShifter.tempo = 1.0;
            this.bypassPitchShifter.pitch = pitchCorrection;
        }
        
        // Update playbackRate on all active source nodes
        this.trackNodes.forEach((nodes) => {
            if (nodes.source) {
                nodes.source.playbackRate.value = speed;
            }
        });
        
        // Reschedule skip/loop events with new timing
        if (this.isPlaying) {
            this.scheduleNextEvents();
        }
    }

    /**
     * Set pitch (semitones)
     * Uses SoundTouch worklet for pitch shifting without speed change
     * Note: Only affects primary pitchShifter, not bypassPitchShifter (which stays at 0)
     */
    setPitch(semitones) {
        this._pitch = semitones;
        
        // Update only the primary pitch shifter
        // bypassPitchShifter stays at 0 for pitch-exempt tracks
        if (this.pitchShifter) {
            this.pitchShifter.pitchSemitones = semitones;
        }
    }

    /**
     * Extract waveform peaks from an audio buffer
     * @param {AudioBuffer} audioBuffer
     * @param {number} samplesPerSecond - Number of peak samples per second of audio
     * @returns {{left: Float32Array, right: Float32Array|null, isStereo: boolean, maxPeak: number}} - Peak values normalized to 0-1 for each channel, plus maximum peak value across all channels
     */
    extractPeaks(audioBuffer, samplesPerSecond = 400) {
        const numChannels = audioBuffer.numberOfChannels;
        const leftChannelData = audioBuffer.getChannelData(0);
        const rightChannelData = numChannels > 1 ? audioBuffer.getChannelData(1) : null;
        const totalSamples = leftChannelData.length;
        
        // Compute duration explicitly from sample count and sample rate
        // This avoids precision issues with audioBuffer.duration, especially for
        // MP3 files that get resampled (e.g., 44100 Hz -> 48000 Hz)
        const duration = totalSamples / audioBuffer.sampleRate;
        
        // Calculate number of peak samples based on duration
        // Use at least 2000 samples, or 200 samples per second, whichever is greater
        const peakCount = Math.max(2000, Math.ceil(duration * samplesPerSecond));
        
        /**
         * Extract peaks from a single channel
         * @param {Float32Array} channelData
         * @returns {{peaks: Float32Array, maxPeak: number}}
         */
        const extractChannelPeaks = (channelData) => {
            const peaks = new Float32Array(peakCount);
            let channelMaxPeak = 0;
            
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
                const peakValue = Math.max(Math.abs(max), Math.abs(min));
                peaks[i] = peakValue;
                
                // Track maximum peak for normalization
                if (peakValue > channelMaxPeak) {
                    channelMaxPeak = peakValue;
                }
            }
            
            return { peaks, maxPeak: channelMaxPeak };
        };
        
        const leftResult = extractChannelPeaks(leftChannelData);
        const rightResult = rightChannelData ? extractChannelPeaks(rightChannelData) : null;
        
        // Maximum peak across all channels (for normalization)
        const maxPeak = rightResult 
            ? Math.max(leftResult.maxPeak, rightResult.maxPeak)
            : leftResult.maxPeak;
        
        return {
            left: leftResult.peaks,
            right: rightResult ? rightResult.peaks : null,
            isStereo: rightResult !== null,
            maxPeak: maxPeak
        };
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

// Phase 4: Subscribe to time-based mute section changes
State.subscribe(State.Events.MUTE_SECTIONS_CHANGED, ({ trackId }) => {
    if (audioEngineInstance && audioEngineInstance.isPlaying) {
        if (trackId) {
            // Single track changed
            audioEngineInstance.applySectionMuteChange(trackId);
        } else {
            // Multiple tracks changed - update all
            audioEngineInstance.updateAllTracksAudibility();
        }
    }
});

// Re-schedule skip/loop events when arrangement sections change
State.subscribe(State.Events.ARRANGEMENT_SECTIONS_CHANGED, () => {
    if (audioEngineInstance && audioEngineInstance.isPlaying) {
        audioEngineInstance.scheduleNextEvents();
    }
});

// Re-schedule skip/loop events when loop settings change
State.subscribe(State.Events.LOOP_UPDATED, () => {
    if (audioEngineInstance && audioEngineInstance.isPlaying) {
        audioEngineInstance.scheduleNextEvents();
    }
});

export default AudioEngine;

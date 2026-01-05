/**
 * Audio Engine
 * Handles Web Audio API, audio loading, playback, and pitch/time stretching
 * Uses SoundTouch via AudioWorklet for high-quality independent speed/pitch control
 */

import * as State from './state.js';
import { 
    getSectionAtTime, 
    getVirtualSectionAtTime, 
    virtualToSourcePosition,
    sourceToVirtualPosition,
    getNextVirtualSection,
    requiresSeekTransition
} from './sections.js';
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
        
        // Virtual timeline tracking for arrangements
        this.currentVirtualSectionIndex = -1; // Index in virtualSections array
        this.virtualStartPosition = 0; // Virtual position when playback started
        this.sourceStartPosition = 0;  // Source position when playback started
        this.isInCrossfade = false;    // Flag to prevent multiple crossfades
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
     * @param {number} position - Position in seconds (virtual time for arrangements)
     */
    play(position = null) {
        const song = State.getActiveSong();
        if (!song || song.tracks.length === 0) return;

        this.resume();

        // Use provided position or current position (always virtual time)
        const virtualPos = position !== null ? position : song.transport.position;
        
        // Store last play position for Stop (in virtual time)
        State.updateTransport({ lastPlayPosition: virtualPos });

        // Convert virtual position to source position for actual audio playback
        const virtualSections = song.virtualSections;
        const useVirtualTimeline = virtualSections && virtualSections.length > 0;
        
        let sourcePos;
        if (useVirtualTimeline) {
            const mapping = virtualToSourcePosition(virtualPos, virtualSections);
            if (mapping) {
                sourcePos = mapping.sourceTime;
                this.currentVirtualSectionIndex = mapping.virtualSectionIndex;
            } else {
                // Position out of range, start at beginning
                sourcePos = virtualSections[0]?.sourceStart || 0;
                this.currentVirtualSectionIndex = 0;
            }
        } else {
            sourcePos = virtualPos;
            this.currentVirtualSectionIndex = -1;
        }

        this.isPlaying = true;
        this.startTime = this.audioContext.currentTime;
        this.startPosition = sourcePos;      // Source position for audio playback
        this.virtualStartPosition = virtualPos; // Virtual position for UI
        this.sourceStartPosition = sourcePos;
        this.isInCrossfade = false;

        // Start all tracks at source position
        song.tracks.forEach(track => {
            this.startTrack(track.id, sourcePos);
        });

        State.setPlaybackState('playing');
        this.startPositionUpdate();
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
        
        // Check if current section is muted
        // For arrangements, use source index from current virtual section
        const song = State.getActiveSong();
        let isSectionMuted = false;
        
        const virtualSections = song?.virtualSections;
        if (virtualSections && virtualSections.length > 0 && this.currentVirtualSectionIndex >= 0) {
            // Using arrangement - get source index from current virtual section
            const currentVirtualSection = virtualSections[this.currentVirtualSectionIndex];
            if (currentVirtualSection) {
                isSectionMuted = State.isSectionMuted(trackId, currentVirtualSection.sourceIndex);
            }
        } else if (song && song.sections && song.sections.length > 0) {
            // No arrangement - check regular sections
            const currentSection = getSectionAtTime(song.sections, sourcePosition);
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
        
        // Clear virtual section tracking
        this.currentVirtualSectionIndex = -1;
        this.isInCrossfade = false;

        // Return to last play position (in virtual time)
        State.setPosition(song.transport.lastPlayPosition);
        State.setPlaybackState('stopped');
    }

    /**
     * Pause playback at current position
     */
    pause() {
        if (!this.isPlaying) return;

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

        // Clear pitch shifter buffers
        if (this.pitchShifter) {
            this.pitchShifter.clear();
        }

        // Clear section mute tracking state
        this.trackSectionState.clear();
        
        // Clear crossfade state but preserve virtual section index for resume
        this.isInCrossfade = false;

        // Keep position where we stopped (in virtual time)
        State.setPosition(currentPos);
        State.setPlaybackState('paused');
    }

    /**
     * Get current playback position (virtual time for arrangements)
     * Note: Since SoundTouch handles tempo, the source plays at 1.0 rate.
     * The position in the original audio advances at real-time rate.
     */
    getCurrentPosition() {
        if (!this.isPlaying) {
            const song = State.getActiveSong();
            return song ? song.transport.position : 0;
        }

        // Calculate elapsed time and current source position
        const elapsed = this.audioContext.currentTime - this.startTime;
        const currentSourcePos = this.startPosition + elapsed;
        
        // For arrangements, convert source position to virtual position
        const song = State.getActiveSong();
        const virtualSections = song?.virtualSections;
        
        if (virtualSections && virtualSections.length > 0 && this.currentVirtualSectionIndex >= 0) {
            const section = virtualSections[this.currentVirtualSectionIndex];
            if (section) {
                // Calculate position within current virtual section
                const offsetInSection = currentSourcePos - section.sourceStart;
                return section.virtualStart + offsetInSection;
            }
        }
        
        // No arrangement active, return source position directly
        return currentSourcePos;
    }

    /**
     * Get current source (audio) position
     * Use this for actual audio operations
     */
    getCurrentSourcePosition() {
        if (!this.isPlaying) {
            const song = State.getActiveSong();
            if (!song) return 0;
            
            // Convert stored virtual position to source
            const virtualSections = song.virtualSections;
            if (virtualSections && virtualSections.length > 0) {
                const mapping = virtualToSourcePosition(song.transport.position, virtualSections);
                return mapping?.sourceTime || 0;
            }
            return song.transport.position;
        }

        const elapsed = this.audioContext.currentTime - this.startTime;
        return this.startPosition + elapsed;
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

        // Clear the pitch shifter buffers to avoid stale audio
        if (this.pitchShifter) {
            this.pitchShifter.clear();
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
     * Seek with crossfade for smooth transitions between sections
     * Used internally when transitioning between non-consecutive sections in arrangements
     * @param {number} toSourcePosition - Target source position
     * @param {number} newVirtualSectionIndex - Index of the new virtual section
     * @param {number} fadeDuration - Duration of crossfade in seconds (default 0.05 = 50ms)
     */
    seekWithCrossfade(toSourcePosition, newVirtualSectionIndex, fadeDuration = 0.05) {
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
            
            // Clear pitch shifter
            if (this.pitchShifter) {
                this.pitchShifter.clear();
            }
            
            // Update tracking state
            this.startTime = this.audioContext.currentTime;
            this.startPosition = toSourcePosition;
            this.currentVirtualSectionIndex = newVirtualSectionIndex;
            
            // Start at new source position with fade in
            const song = State.getActiveSong();
            if (song) {
                song.tracks.forEach(track => {
                    this.startTrack(track.id, toSourcePosition);
                    
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
            
            this.isInCrossfade = false;
        }, fadeDuration * 1000);
    }

    /**
     * Start position update loop
     * Handles virtual timeline section transitions with crossfade
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
            
            // Check if loop is active and we've reached the loop end (in virtual time)
            const { loopEnabled, loopStart, loopEnd } = song.transport;
            
            if (loopEnabled && loopStart !== null && loopEnd !== null) {
                // Only loop back if position is close to loopEnd (within 0.1s tolerance)
                // This prevents looping when user deliberately seeks past the loop
                if (virtualPosition >= loopEnd && virtualPosition < loopEnd + 0.1) {
                    // Loop back to start (handles crossfade automatically via play())
                    this.seek(loopStart);
                    return; // seek() will restart position update if playing
                }
            }
            
            // Check for virtual section transitions (arrangements only)
            const virtualSections = song.virtualSections;
            const useVirtualTimeline = virtualSections && virtualSections.length > 0;
            
            if (useVirtualTimeline && this.currentVirtualSectionIndex >= 0 && !this.isInCrossfade) {
                const currentSection = virtualSections[this.currentVirtualSectionIndex];
                
                if (currentSection && sourcePosition >= currentSection.sourceEnd - 0.02) {
                    // About to reach end of current section, check if we need to transition
                    const nextSection = getNextVirtualSection(virtualSections, this.currentVirtualSectionIndex);
                    
                    if (nextSection) {
                        // Check if transition requires a seek (non-consecutive source positions)
                        if (requiresSeekTransition(currentSection, nextSection)) {
                            // Crossfade seek to next section's source position
                            this.seekWithCrossfade(
                                nextSection.sourceStart, 
                                nextSection.virtualIndex,
                                0.05 // 50ms crossfade
                            );
                        } else {
                            // Consecutive sections - just update tracking
                            this.currentVirtualSectionIndex = nextSection.virtualIndex;
                        }
                    } else {
                        // No next section - we're at the end of arrangement
                        // Let playback continue until stop check below
                    }
                }
            }
            
            // Update section mutes for all tracks (use source position for mute checks)
            this.updateAllSectionMutes(sourcePosition, virtualSections);
            
            // Update UI with virtual position
            State.setPosition(virtualPosition);
            
            // Check if we've reached the end of the arrangement/song
            const maxDuration = State.getMaxDuration(); // Returns virtual duration for arrangements
            if (virtualPosition >= maxDuration) {
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
     * Works with both regular sections and virtual sections (arrangements)
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
                const virtualSections = song?.virtualSections;
                
                if (virtualSections && virtualSections.length > 0 && this.currentVirtualSectionIndex >= 0) {
                    // Using arrangement - get source index from current virtual section
                    const currentVirtualSection = virtualSections[this.currentVirtualSectionIndex];
                    if (currentVirtualSection) {
                        isSectionMuted = State.isSectionMuted(trackId, currentVirtualSection.sourceIndex);
                    }
                } else if (song && song.sections && song.sections.length > 0) {
                    // No arrangement - get source index from regular sections
                    const sourcePosition = this.getCurrentSourcePosition();
                    const currentSection = getSectionAtTime(song.sections, sourcePosition);
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
     * Works with both regular sections and virtual sections (arrangements)
     * @param {string} trackId - Track ID
     * @param {number} sourceTime - Current source audio position in seconds
     * @param {Array|null} virtualSections - Virtual sections array (for arrangements)
     */
    updateSectionMuteForTrack(trackId, sourceTime, virtualSections = null) {
        const song = State.getActiveSong();
        if (!song) return;
        
        const track = State.getTrack(trackId);
        const nodes = this.trackNodes.get(trackId);
        if (!track || !nodes || !nodes.gainNode) return;
        
        // Determine the SOURCE section index for mute checking
        // For arrangements, we use the current virtual section's sourceIndex
        // Section mutes are always keyed by source index
        let sourceIndex;
        
        if (virtualSections && virtualSections.length > 0 && this.currentVirtualSectionIndex >= 0) {
            // Using arrangement - get source index from current virtual section
            const currentVirtualSection = virtualSections[this.currentVirtualSectionIndex];
            sourceIndex = currentVirtualSection?.sourceIndex ?? -1;
        } else if (song.sections && song.sections.length > 0) {
            // No arrangement - get source index from regular sections
            const currentSection = getSectionAtTime(song.sections, sourceTime);
            sourceIndex = currentSection?.index ?? -1;
        } else {
            return; // No sections to check
        }
        
        if (sourceIndex < 0) return;
        
        const isSectionMuted = State.isSectionMuted(trackId, sourceIndex);
        
        // Get previous state
        let prevState = this.trackSectionState.get(trackId);
        if (!prevState) {
            prevState = { currentSectionIndex: -1, isSectionMuted: false };
            this.trackSectionState.set(trackId, prevState);
        }
        
        // Check if section mute state has changed
        // Use virtual section index for change detection to handle repeated sections
        const effectiveIndex = virtualSections ? this.currentVirtualSectionIndex : sourceIndex;
        const stateChanged = prevState.currentSectionIndex !== effectiveIndex || 
                            prevState.isSectionMuted !== isSectionMuted;
        
        if (stateChanged) {
            // Update stored state
            prevState.currentSectionIndex = effectiveIndex;
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
     * @param {Array|null} virtualSections - Virtual sections array (for arrangements)
     */
    updateAllSectionMutes(sourceTime, virtualSections = null) {
        const song = State.getActiveSong();
        if (!song) return;
        
        song.tracks.forEach(track => {
            this.updateSectionMuteForTrack(track.id, sourceTime, virtualSections);
        });
    }

    /**
     * Force update section mute for a specific track (e.g., when user toggles mute)
     * @param {string} trackId - Track ID
     */
    applySectionMuteChange(trackId) {
        if (!this.isPlaying) return;
        
        const sourcePosition = this.getCurrentSourcePosition();
        const song = State.getActiveSong();
        const virtualSections = song?.virtualSections;
        
        // Reset the tracked state so it will be recalculated
        this.trackSectionState.delete(trackId);
        
        // Update immediately
        this.updateSectionMuteForTrack(trackId, sourcePosition, virtualSections);
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
    extractPeaks(audioBuffer, samplesPerSecond = 400) {
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

/**
 * Waveform Panel UI
 * Right panel showing waveforms and playhead
 */

import * as State from '../state.js';
import * as Waveform from '../waveform.js';

const BASE_PIXELS_PER_SECOND = 100;

class WaveformPanel {
    constructor() {
        this.container = document.getElementById('waveform-tracks');
        this.scrollArea = document.getElementById('waveform-scroll-area');
        this.emptyState = document.getElementById('waveform-empty');
        this.playhead = document.getElementById('playhead');
        this.loopRegion = null; // Will be created dynamically
        
        this.trackCanvases = new Map(); // trackId -> canvas
        this.trackWrappers = new Map(); // trackId -> wrapper element
        this.sectionMuteContainers = new Map(); // trackId -> section mute button container
        this.resizeObserver = null;
        
        this.init();
        this.attachStateListeners();
        this.createLoopRegionElement();
    }

    init() {
        // Set up resize observer
        this.resizeObserver = new ResizeObserver(() => {
            this.redrawAllWaveforms();
        });
        this.resizeObserver.observe(this.scrollArea);

        // Handle scroll sync with timeline and track controls panel
        this.scrollArea.addEventListener('scroll', () => {
            this.updatePlayheadPosition();
            // Emit scroll events for timeline and track panel sync
            State.emit('waveformScroll', this.scrollArea.scrollLeft);
            State.emit('waveformScrollVertical', this.scrollArea.scrollTop);
            // Redraw waveforms with new scroll offset (viewport-based rendering)
            this.redrawAllWaveforms();
            // Update section mute button positions
            this.updateAllSectionMuteButtonPositions();
        });

        // Listen for scroll from track panel to sync vertical scrolling
        State.subscribe('trackPanelScrollVertical', (scrollTop) => {
            if (this.scrollArea.scrollTop !== scrollTop) {
                this.scrollArea.scrollTop = scrollTop;
            }
        });
    }

    attachStateListeners() {
        State.subscribe(State.Events.TRACK_ADDED, ({ track }) => {
            this.addTrackWaveform(track);
            this.updateEmptyState();
            this.updateContainerWidth();
        });

        State.subscribe(State.Events.TRACK_REMOVED, ({ track }) => {
            this.removeTrackWaveform(track.id);
            this.updateEmptyState();
            this.updateContainerWidth();
        });

        State.subscribe(State.Events.TRACK_UPDATED, ({ track }) => {
            this.updateTrackWaveform(track.id);
        });

        State.subscribe(State.Events.SONG_SWITCHED, (song) => {
            this.renderTracks(song);
        });

        State.subscribe(State.Events.STATE_LOADED, () => {
            const song = State.getActiveSong();
            if (song) {
                this.renderTracks(song);
            }
        });

        State.subscribe(State.Events.POSITION_CHANGED, (position) => {
            this.updatePlayheadPosition(position);
        });

        State.subscribe(State.Events.ZOOM_CHANGED, () => {
            this.updateContainerWidth();
            this.redrawAllWaveforms();
            this.updateLoopRegion();
            this.updateAllSectionMuteButtonPositions();
        });

        // Update loop region when loop state changes
        State.subscribe(State.Events.LOOP_UPDATED, () => {
            this.updateLoopRegion();
        });

        // Handle timeline offset changes
        State.subscribe(State.Events.TIMELINE_UPDATED, ({ updates }) => {
            if ('offset' in updates) {
                this.redrawAllWaveforms();
            }
        });
        
        // Redraw waveforms when sections are updated (to show section dividers)
        State.subscribe(State.Events.SECTIONS_UPDATED, () => {
            this.redrawAllWaveforms();
            // Recreate section mute buttons when sections change
            this.updateAllSectionMuteButtons();
        });
        
        // Handle section mute changes
        State.subscribe(State.Events.SECTION_MUTE_UPDATED, ({ trackId, sectionIndex, muted }) => {
            // Update button state
            this.updateSectionMuteButtonState(trackId, sectionIndex, muted);
            // Redraw waveform to show muted section
            this.drawWaveform(trackId);
        });
    }

    /**
     * Render all tracks for a song
     */
    renderTracks(song) {
        this.clear();
        
        if (song && song.tracks) {
            song.tracks.forEach(track => {
                this.addTrackWaveform(track);
            });
        }
        
        this.updateEmptyState();
        this.updateContainerWidth();
        this.updateLoopRegion();
    }

    /**
     * Add waveform for a track
     */
    addTrackWaveform(track) {
        const wrapper = document.createElement('div');
        wrapper.className = 'waveform-track';
        wrapper.dataset.trackId = track.id;
        
        // Check audibility
        const isAudible = State.isTrackAudible(track.id);
        if (!isAudible) {
            wrapper.classList.add('inactive');
        }

        const canvas = document.createElement('canvas');
        canvas.className = 'waveform-canvas';
        wrapper.appendChild(canvas);
        
        // Create section mute button container
        const sectionMuteContainer = document.createElement('div');
        sectionMuteContainer.className = 'section-mute-container';
        wrapper.appendChild(sectionMuteContainer);
        
        this.container.appendChild(wrapper);
        this.trackCanvases.set(track.id, canvas);
        this.trackWrappers.set(track.id, wrapper);
        this.sectionMuteContainers.set(track.id, sectionMuteContainer);

        // Initial draw
        requestAnimationFrame(() => {
            this.drawWaveform(track.id);
            this.renderSectionMuteButtons(track.id);
        });

        // Handle click for seeking
        wrapper.addEventListener('click', (e) => {
            this.handleWaveformClick(e, track.id);
        });
    }

    /**
     * Remove waveform for a track
     */
    removeTrackWaveform(trackId) {
        const canvas = this.trackCanvases.get(trackId);
        if (canvas) {
            canvas.parentElement.remove();
            this.trackCanvases.delete(trackId);
        }
        this.trackWrappers.delete(trackId);
        this.sectionMuteContainers.delete(trackId);
    }

    /**
     * Update waveform for a track (e.g., after solo/mute change)
     */
    updateTrackWaveform(trackId) {
        const canvas = this.trackCanvases.get(trackId);
        if (!canvas) return;

        const wrapper = canvas.parentElement;
        const isAudible = State.isTrackAudible(trackId);
        wrapper.classList.toggle('inactive', !isAudible);
        
        this.drawWaveform(trackId);
    }

    /**
     * Update all waveforms' audibility visual state
     */
    updateAllWaveformsAudibility() {
        const song = State.getActiveSong();
        if (!song) return;

        song.tracks.forEach(track => {
            this.updateTrackWaveform(track.id);
        });
    }

    /**
     * Get effective zoom level (handles null = auto-fit)
     */
    getEffectiveZoom() {
        const song = State.getActiveSong();
        let zoom = song?.timeline?.zoom;
        
        if (zoom === null || zoom === undefined) {
            // Calculate fit-to-window zoom
            const maxDuration = State.getMaxDuration();
            if (maxDuration > 0) {
                const viewportWidth = this.scrollArea.clientWidth - 20;
                zoom = viewportWidth / (maxDuration * BASE_PIXELS_PER_SECOND);
                zoom = Math.max(0.1, Math.min(5, zoom));
            } else {
                zoom = 1;
            }
        }
        
        return zoom;
    }

    /**
     * Draw waveform for a track
     */
    drawWaveform(trackId) {
        const canvas = this.trackCanvases.get(trackId);
        if (!canvas) return;

        const track = State.getTrack(trackId);
        if (!track) return;

        const song = State.getActiveSong();
        const zoom = this.getEffectiveZoom();
        const offset = song?.timeline?.offset || 0;
        
        // Resize canvas to match viewport (not container) for viewport-based rendering
        // This avoids browser canvas size limits at high zoom levels
        const viewportWidth = this.scrollArea.clientWidth;
        const trackHeight = canvas.parentElement.getBoundingClientRect().height;
        canvas.width = viewportWidth;
        canvas.height = trackHeight;
        // Also set CSS width explicitly since we removed width:100% from CSS
        canvas.style.width = `${viewportWidth}px`;

        const isAudible = State.isTrackAudible(trackId);
        const color = Waveform.getTrackColor(isAudible);
        
        // Get sections and section mutes for this track
        const sections = song?.sections || null;
        const sectionMutes = State.getSectionMutesForTrack(trackId);
        
        Waveform.renderWaveformGradient(canvas, track.peaks, {
            color,
            zoom,
            scrollOffset: this.scrollArea.scrollLeft,
            duration: track.duration,
            pixelsPerSecond: BASE_PIXELS_PER_SECOND,
            offset,
            sections,
            sectionMutes
        });
        
        // Render section dividers
        if (sections && sections.length > 1) {
            const ctx = canvas.getContext('2d');
            Waveform.renderSectionDividers(ctx, canvas.width, canvas.height, sections, {
                zoom,
                scrollOffset: this.scrollArea.scrollLeft,
                pixelsPerSecond: BASE_PIXELS_PER_SECOND,
                offset
            });
        }
    }

    /**
     * Redraw all waveforms
     */
    redrawAllWaveforms() {
        this.trackCanvases.forEach((canvas, trackId) => {
            this.drawWaveform(trackId);
        });
    }

    /**
     * Update container width based on max duration and zoom
     */
    updateContainerWidth() {
        const song = State.getActiveSong();
        if (!song) return;

        const maxDuration = State.getMaxDuration();
        const zoom = this.getEffectiveZoom();
        const width = maxDuration * BASE_PIXELS_PER_SECOND * zoom;
        
        this.container.style.width = `${Math.max(width, this.scrollArea.clientWidth)}px`;
    }

    /**
     * Update playhead position
     */
    updatePlayheadPosition(position = null) {
        const song = State.getActiveSong();
        if (!song) {
            this.playhead.style.display = 'none';
            return;
        }

        if (position === null) {
            position = song.transport.position;
        }

        const zoom = this.getEffectiveZoom();
        const pixelPosition = position * BASE_PIXELS_PER_SECOND * zoom;
        
        // Account for timeline offset
        const offset = song.timeline?.offset || 0;
        const adjustedPosition = pixelPosition + (offset * BASE_PIXELS_PER_SECOND * zoom);
        
        this.playhead.style.display = 'block';
        this.playhead.style.left = `${adjustedPosition}px`;

        // Auto-scroll to keep playhead visible during playback
        if (State.state.playbackState === 'playing') {
            this.scrollToPlayhead(adjustedPosition);
        }
    }

    /**
     * Scroll to keep playhead visible
     */
    scrollToPlayhead(playheadX) {
        const viewportWidth = this.scrollArea.clientWidth;
        const scrollLeft = this.scrollArea.scrollLeft;
        const margin = 50; // Keep some margin from edges

        // If playhead is beyond right edge
        if (playheadX > scrollLeft + viewportWidth - margin) {
            this.scrollArea.scrollLeft = playheadX - margin;
        }
        // If playhead is before left edge
        else if (playheadX < scrollLeft + margin) {
            this.scrollArea.scrollLeft = Math.max(0, playheadX - margin);
        }
    }

    /**
     * Handle click on waveform for seeking
     */
    handleWaveformClick(e, trackId) {
        const song = State.getActiveSong();
        if (!song) return;

        const rect = this.container.getBoundingClientRect();
        const clickX = e.clientX - rect.left + this.scrollArea.scrollLeft;
        
        const zoom = song.timeline?.zoom || 1;
        const offset = song.timeline?.offset || 0;
        
        // Convert pixel position to time
        let position = clickX / (BASE_PIXELS_PER_SECOND * zoom);
        position -= offset;
        position = Math.max(0, position);
        
        // Seek to position
        const audioEngine = (window.audioEngine);
        if (audioEngine) {
            audioEngine.seek(position);
        } else {
            State.setPosition(position);
        }
    }

    /**
     * Update empty state visibility
     */
    updateEmptyState() {
        const song = State.getActiveSong();
        const hasTracks = song && song.tracks && song.tracks.length > 0;
        
        if (this.emptyState) {
            this.emptyState.classList.toggle('hidden', hasTracks);
        }
        
        if (this.playhead) {
            this.playhead.style.display = hasTracks ? 'block' : 'none';
        }
    }

    /**
     * Clear all waveforms
     */
    clear() {
        // Remove only track elements, preserving the playhead
        const tracks = this.container.querySelectorAll('.waveform-track');
        tracks.forEach(track => track.remove());
        this.trackCanvases.clear();
        this.trackWrappers.clear();
        this.sectionMuteContainers.clear();
    }

    /**
     * Render section mute buttons for a track
     */
    renderSectionMuteButtons(trackId) {
        const container = this.sectionMuteContainers.get(trackId);
        if (!container) return;
        
        // Clear existing buttons
        container.innerHTML = '';
        
        const song = State.getActiveSong();
        const sections = song?.sections;
        if (!sections || sections.length === 0) return;
        
        const track = State.getTrack(trackId);
        if (!track) return;
        
        // Get section mutes from top-level state (keyed by songName/trackFileName)
        const sectionMutes = State.getSectionMutesForTrack(trackId);
        
        sections.forEach((section, index) => {
            const btn = document.createElement('button');
            btn.className = 'section-mute-btn';
            btn.dataset.sectionIndex = index;
            btn.textContent = 'M';
            btn.title = `Mute ${section.name}`;
            
            // Check if muted
            if (sectionMutes[index]) {
                btn.classList.add('active');
            }
            
            // Click handler
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent waveform seek
                State.toggleSectionMute(trackId, index);
            });
            
            container.appendChild(btn);
        });
        
        // Position the buttons
        this.updateSectionMuteButtonPositions(trackId);
    }

    /**
     * Update positions of section mute buttons based on zoom and scroll
     */
    updateSectionMuteButtonPositions(trackId) {
        const container = this.sectionMuteContainers.get(trackId);
        if (!container) return;
        
        const song = State.getActiveSong();
        const sections = song?.sections;
        if (!sections || sections.length === 0) return;
        
        const zoom = this.getEffectiveZoom();
        const offset = song?.timeline?.offset || 0;
        const scrollLeft = this.scrollArea.scrollLeft;
        const pixelsPerSecondZoomed = BASE_PIXELS_PER_SECOND * zoom;
        
        const buttons = container.querySelectorAll('.section-mute-btn');
        buttons.forEach((btn, index) => {
            const section = sections[index];
            if (!section) return;
            
            // Calculate position: section start time to pixels, accounting for offset
            const worldX = (section.start + offset) * pixelsPerSecondZoomed;
            const screenX = worldX - scrollLeft;
            
            // Position button with small padding from left edge of section
            btn.style.left = `${screenX + 4}px`;
        });
    }

    /**
     * Update section mute buttons for all tracks
     */
    updateAllSectionMuteButtons() {
        const song = State.getActiveSong();
        if (!song) return;
        
        song.tracks.forEach(track => {
            this.renderSectionMuteButtons(track.id);
        });
    }

    /**
     * Update section mute button positions for all tracks
     */
    updateAllSectionMuteButtonPositions() {
        this.sectionMuteContainers.forEach((container, trackId) => {
            this.updateSectionMuteButtonPositions(trackId);
        });
    }

    /**
     * Update a single section mute button's active state
     */
    updateSectionMuteButtonState(trackId, sectionIndex, muted) {
        const container = this.sectionMuteContainers.get(trackId);
        if (!container) return;
        
        const btn = container.querySelector(`[data-section-index="${sectionIndex}"]`);
        if (btn) {
            btn.classList.toggle('active', muted);
        }
    }

    /**
     * Get scroll position
     */
    getScrollLeft() {
        return this.scrollArea.scrollLeft;
    }

    /**
     * Set scroll position
     */
    setScrollLeft(value) {
        this.scrollArea.scrollLeft = value;
    }

    /**
     * Get pixels per second
     */
    getPixelsPerSecond() {
        const zoom = this.getEffectiveZoom();
        return BASE_PIXELS_PER_SECOND * zoom;
    }

    /**
     * Create the loop region overlay element
     */
    createLoopRegionElement() {
        this.loopRegion = document.createElement('div');
        this.loopRegion.className = 'loop-region';
        this.loopRegion.style.display = 'none';
        this.scrollArea.appendChild(this.loopRegion);
    }

    /**
     * Update loop region position and visibility
     */
    updateLoopRegion() {
        if (!this.loopRegion) return;
        
        const song = State.getActiveSong();
        if (!song) {
            this.loopRegion.style.display = 'none';
            return;
        }
        
        const { loopStart, loopEnd } = song.transport;
        
        if (loopStart === null || loopEnd === null) {
            this.loopRegion.style.display = 'none';
            return;
        }
        
        const zoom = this.getEffectiveZoom();
        const offset = song.timeline?.offset || 0;
        
        // Calculate pixel positions
        const startX = (loopStart + offset) * BASE_PIXELS_PER_SECOND * zoom;
        const endX = (loopEnd + offset) * BASE_PIXELS_PER_SECOND * zoom;
        const width = endX - startX;
        
        this.loopRegion.style.display = 'block';
        this.loopRegion.style.left = `${startX}px`;
        this.loopRegion.style.width = `${width}px`;
    }
}

// Singleton instance
let waveformPanelInstance = null;

export function getWaveformPanel() {
    if (!waveformPanelInstance) {
        waveformPanelInstance = new WaveformPanel();
    }
    return waveformPanelInstance;
}

// Subscribe to track updates for audibility changes
State.subscribe(State.Events.TRACK_UPDATED, () => {
    if (waveformPanelInstance) {
        waveformPanelInstance.updateAllWaveformsAudibility();
    }
});

export { BASE_PIXELS_PER_SECOND };
export default WaveformPanel;

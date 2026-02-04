/**
 * Waveform Panel UI
 * Right panel showing waveforms and playhead
 */

import * as State from '../state.js';
import * as Waveform from '../waveform.js';
import { findNearestBeat, findNearestBeatInfo } from '../metadata.js';

const BASE_PIXELS_PER_SECOND = 100;

// Phase 4: Constants for mute section split interactions
const MIN_SPLIT_DISTANCE_PX = 10;  // Minimum pixels from existing split to allow new split
const DIVIDER_HIT_THRESHOLD = 8;   // Pixels threshold for clicking on a divider
const MIN_SECTION_BEATS = 1;       // Minimum section duration in beats

class WaveformPanel {
    constructor() {
        this.container = document.getElementById('waveform-tracks');
        this.scrollArea = document.getElementById('waveform-scroll-area');
        this.emptyState = document.getElementById('waveform-empty');
        this.playhead = document.getElementById('playhead');
        this.loopRegion = null; // Will be created dynamically
        this.disabledSectionsOverlay = null; // Phase 3: Overlay for disabled arrangement sections
        
        this.trackCanvases = new Map(); // trackId -> canvas
        this.trackWrappers = new Map(); // trackId -> wrapper element
        this.muteDividerContainers = new Map(); // trackId -> mute section divider container (Phase 4)
        this.muteSectionBtnContainers = new Map(); // trackId -> mute section button container (Phase 4)
        this.resizeObserver = null;
        
        // Phase 4: Mute section divider drag state
        this.muteDragState = {
            isDragging: false,
            trackId: null,
            splitTime: 0,         // Original split time
            splitIndex: -1,       // Index of section starting at this split
            currentTime: 0,       // Current drag position (time)
            dividerElement: null  // The DOM element being dragged
        };
        
        this.init();
        this.attachStateListeners();
        this.createLoopRegionElement();
        this.createDisabledSectionsOverlay();
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
        });

        // Listen for scroll from track panel to sync vertical scrolling
        State.subscribe('trackPanelScrollVertical', (scrollTop) => {
            if (this.scrollArea.scrollTop !== scrollTop) {
                this.scrollArea.scrollTop = scrollTop;
            }
        });

        // Handle mouse wheel for zooming (scroll wheel zooms when over waveform area)
        this.scrollArea.addEventListener('wheel', (e) => {
            this.handleWheelZoom(e);
        }, { passive: false });

        // Phase 4: Listen for Ctrl key to update cursor on waveform tracks
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Control') {
                this.updateAllWaveformCursors();
            }
        });
        
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') {
                this.updateAllWaveformCursors();
            }
        });

        // Phase 4: Global mouse handlers for mute divider dragging
        document.addEventListener('mousemove', (e) => {
            this.handleMuteDividerDragMove(e);
        });
        
        document.addEventListener('mouseup', (e) => {
            this.handleMuteDividerDragEnd(e);
        });
    }

    /**
     * Update cursors for all waveform wrappers (called when Ctrl key state changes)
     */
    updateAllWaveformCursors() {
        // Reset all wrappers to default cursor
        // The actual cursor will be updated on next mousemove
        this.trackWrappers.forEach((wrapper) => {
            wrapper.style.cursor = 'default';
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

        State.subscribe(State.Events.ZOOM_CHANGED, (newZoom) => {
            this.updateContainerWidth();
            this.redrawAllWaveforms();
            this.updateLoopRegion();
            this.updateDisabledSectionsOverlay();
            this.renderAllMuteSectionDividers(); // Phase 4: Update mute dividers
            this.renderAllMuteSectionButtons();  // Phase 4: Update mute buttons
            
            // Scroll to keep playhead visible (centered in viewport)
            const song = State.getActiveSong();
            if (song) {
                const position = song.transport.position;
                const offset = song.timeline?.offset || 0;
                const zoom = newZoom || this.getEffectiveZoom();
                const playheadPixelX = (position + offset) * BASE_PIXELS_PER_SECOND * zoom;
                const viewportWidth = this.scrollArea.clientWidth;
                
                // Center the playhead in the viewport
                this.scrollArea.scrollLeft = Math.max(0, playheadPixelX - viewportWidth / 2);
            }
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
        
        // Redraw waveforms when sections are updated
        State.subscribe(State.Events.SECTIONS_UPDATED, () => {
            this.redrawAllWaveforms();
        });
        
        // Redraw everything when arrangement changes
        State.subscribe(State.Events.ARRANGEMENT_CHANGED, () => {
            this.updateContainerWidth();
            this.redrawAllWaveforms();
            this.updateLoopRegion();
        });

        // Handle track reordering
        State.subscribe(State.Events.TRACKS_REORDERED, ({ song }) => {
            this.renderTracks(song);
        });

        // Phase 3: Update disabled section overlays when arrangement sections change
        State.subscribe(State.Events.ARRANGEMENT_SECTIONS_CHANGED, () => {
            this.updateDisabledSectionsOverlay();
        });

        // Phase 4: Update mute section dividers and buttons when mute sections change
        State.subscribe(State.Events.MUTE_SECTIONS_CHANGED, ({ trackId }) => {
            if (trackId) {
                // Single track changed
                this.renderMuteSectionDividers(trackId);
                this.renderMuteSectionButtons(trackId);
                this.drawWaveform(trackId); // Redraw to show muted state
            } else {
                // Multiple tracks or all tracks changed
                this.renderAllMuteSectionDividers();
                this.renderAllMuteSectionButtons();
                this.redrawAllWaveforms();
            }
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
        this.updateDisabledSectionsOverlay();
        this.updatePlayheadPosition();
        
        // Scroll to show the playhead for the newly switched song
        if (song) {
            const zoom = this.getEffectiveZoom();
            const offset = song.timeline?.offset || 0;
            const playheadX = (song.transport.position + offset) * BASE_PIXELS_PER_SECOND * zoom;
            const viewportWidth = this.scrollArea.clientWidth;
            // Center the playhead in the viewport
            this.scrollArea.scrollLeft = Math.max(0, playheadX - viewportWidth / 2);
        }
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
        
        // Phase 4: Create mute section divider container
        const muteDividerContainer = document.createElement('div');
        muteDividerContainer.className = 'mute-divider-container';
        wrapper.appendChild(muteDividerContainer);
        
        // Phase 4: Create mute section button container
        const muteSectionBtnContainer = document.createElement('div');
        muteSectionBtnContainer.className = 'mute-section-btn-container';
        wrapper.appendChild(muteSectionBtnContainer);
        
        this.container.appendChild(wrapper);
        this.trackCanvases.set(track.id, canvas);
        this.trackWrappers.set(track.id, wrapper);
        this.muteDividerContainers.set(track.id, muteDividerContainer);
        this.muteSectionBtnContainers.set(track.id, muteSectionBtnContainer);

        // Initial draw
        requestAnimationFrame(() => {
            this.drawWaveform(track.id);
            this.renderMuteSectionDividers(track.id);
            this.renderMuteSectionButtons(track.id);
        });

        // Handle mousedown for seeking or split interactions
        // Using mousedown (not click) so drag initiation happens before mouseup/click
        wrapper.addEventListener('mousedown', (e) => {
            this.handleWaveformClick(e, track.id);
        });
        
        // Phase 4: Handle cursor changes for split interactions
        wrapper.addEventListener('mousemove', (e) => {
            this.updateWaveformCursor(e, track.id, wrapper);
        });
        
        wrapper.addEventListener('mouseleave', () => {
            wrapper.style.cursor = 'default';
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
        this.muteDividerContainers.delete(trackId);
        this.muteSectionBtnContainers.delete(trackId);
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
            // Calculate fit-to-window zoom (same logic as timeline.js calculateFitZoom)
            const maxDuration = State.getMaxDuration();
            if (maxDuration > 0) {
                const viewportWidth = this.scrollArea.clientWidth - 20;
                // Fit entire song at ~90% of viewport width
                zoom = (viewportWidth * 0.9) / (maxDuration * BASE_PIXELS_PER_SECOND);
                // Clamp to valid range (1% to 400% = 0.01 to 4.0)
                zoom = Math.max(0.01, Math.min(4.0, zoom));
            } else {
                zoom = 1;
            }
        }
        
        return zoom;
    }

    /**
     * Draw waveform for a track
     * Uses virtual waveform rendering when an arrangement is active
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
        
        // Phase 4: Get time-based mute sections for this track
        const muteSections = State.getMuteSectionsForTrack(trackId);
        
        // Standard waveform rendering
        Waveform.renderWaveformGradient(canvas, track.peaks, {
            color,
            zoom,
            scrollOffset: this.scrollArea.scrollLeft,
            duration: track.duration,
            pixelsPerSecond: BASE_PIXELS_PER_SECOND,
            offset,
            muteSections  // Phase 4 time-based mutes
        });
        
        // Render marker lines as visual guides (from metadata)
        const markers = song?.metadata?.markers;
        if (markers && markers.length > 0) {
            const ctx = canvas.getContext('2d');
            Waveform.renderMarkerLines(ctx, canvas.width, canvas.height, markers, {
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
     * Handle mousedown on waveform for seeking or split interaction
     * Using mousedown (not click) so drag initiation happens before mouseup
     * - Ctrl+Click: Add a mute section split
     * - Alt+Click near divider: Remove the split
     * - Click near divider (no modifier): Start drag
     * - Regular click: Seek to position
     */
    handleWaveformClick(e, trackId) {
        const song = State.getActiveSong();
        if (!song) return;

        // Use scrollArea's rect, not container's, to avoid double-counting scroll offset
        // (container moves with scroll, but scrollArea stays fixed in viewport)
        const rect = this.scrollArea.getBoundingClientRect();
        const clickX = e.clientX - rect.left + this.scrollArea.scrollLeft;
        
        const zoom = this.getEffectiveZoom();
        const offset = song.timeline?.offset || 0;
        
        // Convert pixel position to time and snap to nearest beat
        let position = clickX / (BASE_PIXELS_PER_SECOND * zoom);
        position -= offset;
        position = Math.max(0, position);
        const snappedPosition = findNearestBeat(position, song.metadata?.tempos, song.metadata?.['time-sigs']);
        
        // Check if clicking near a divider (for Alt+Click remove or drag)
        const dividerInfo = this.getMuteDividerAtPosition(trackId, clickX);
        
        // Phase 4: Handle Alt+Click on divider to remove split
        if (e.altKey && dividerInfo) {
            e.preventDefault();
            e.stopPropagation();
            const success = State.removeMuteSplit(trackId, dividerInfo.splitTime);
            if (success) {
                console.log(`Removed mute split at ${dividerInfo.splitTime.toFixed(3)}s for track ${trackId}`);
            }
            return;
        }
        
        // Phase 4: Handle Ctrl+Click to add split
        if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            this.addMuteSplit(trackId, snappedPosition);
            return;
        }
        
        // Phase 4: Handle click on divider to start drag (handled in 4.6)
        if (dividerInfo && !e.altKey && !e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            this.startMuteDividerDrag(trackId, dividerInfo, clickX);
            return;
        }
        
        // Regular click: Seek to position
        const audioEngine = (window.audioEngine);
        if (audioEngine) {
            audioEngine.seek(snappedPosition);
        } else {
            State.setPosition(snappedPosition);
        }
    }

    /**
     * Add a mute section split at the specified time
     * @param {string} trackId - Track ID
     * @param {number} time - Time in seconds (already snapped to beat)
     */
    addMuteSplit(trackId, time) {
        const song = State.getActiveSong();
        if (!song) return;
        
        const track = State.getTrack(trackId);
        if (!track) return;
        
        // Check minimum distance from existing splits
        const existingSplits = State.getMuteSplitTimes(trackId);
        const zoom = this.getEffectiveZoom();
        
        for (const splitTime of existingSplits) {
            const distance = Math.abs(time - splitTime) * BASE_PIXELS_PER_SECOND * zoom;
            if (distance < MIN_SPLIT_DISTANCE_PX) {
                console.log('Split too close to existing split');
                return;
            }
        }
        
        // Check we're not at the very start or end
        const duration = track.duration;
        if (time <= 0.01 || time >= duration - 0.01) {
            console.log('Cannot split at track boundaries');
            return;
        }
        
        // Check minimum section size (MIN_SECTION_BEATS)
        const beatInfo = findNearestBeatInfo(time, song.metadata?.tempos, song.metadata?.['time-sigs']);
        const beatDuration = 60 / beatInfo.tempo; // seconds per beat
        const minSectionDuration = beatDuration * MIN_SECTION_BEATS;
        
        // Find which section this split would be in
        const sections = State.getMuteSectionsForTrack(trackId);
        const targetSection = sections?.find(s => time > s.start && time < s.end);
        
        if (targetSection) {
            // Check that both resulting sections would be at least MIN_SECTION_BEATS long
            const leftDuration = time - targetSection.start;
            const rightDuration = targetSection.end - time;
            
            if (leftDuration < minSectionDuration || rightDuration < minSectionDuration) {
                console.log(`Split would create section smaller than ${MIN_SECTION_BEATS} beat(s)`);
                return;
            }
        }
        
        // Add the split
        const success = State.addMuteSplit(trackId, time);
        if (success) {
            console.log(`Added mute split at ${time.toFixed(3)}s for track ${trackId}`);
        }
    }

    /**
     * Get the mute section divider at a pixel position for a track
     * @param {string} trackId - Track ID
     * @param {number} pixelX - X position in world coordinates (with scroll)
     * @returns {Object|null} { splitTime, element } or null if no divider found
     */
    getMuteDividerAtPosition(trackId, pixelX) {
        const container = this.muteDividerContainers.get(trackId);
        if (!container) return null;
        
        const dividers = container.querySelectorAll('.mute-section-divider');
        for (const divider of dividers) {
            const dividerX = parseFloat(divider.style.left);
            if (Math.abs(pixelX - dividerX) <= DIVIDER_HIT_THRESHOLD) {
                return {
                    splitTime: parseFloat(divider.dataset.splitTime),
                    element: divider
                };
            }
        }
        return null;
    }

    /**
     * Update cursor based on mouse position and modifier keys
     * @param {MouseEvent} e - Mouse event
     * @param {string} trackId - Track ID
     * @param {HTMLElement} wrapper - Track wrapper element
     */
    updateWaveformCursor(e, trackId, wrapper) {
        // If currently dragging, cursor is already set
        if (this.muteDragState && this.muteDragState.isDragging) {
            return;
        }
        
        // Calculate click position in world coordinates
        const rect = this.scrollArea.getBoundingClientRect();
        const clickX = e.clientX - rect.left + this.scrollArea.scrollLeft;
        
        // Check if near a divider
        const dividerInfo = this.getMuteDividerAtPosition(trackId, clickX);
        
        if (dividerInfo) {
            // Near a divider - show resize cursor
            wrapper.style.cursor = 'ew-resize';
        } else if (e.ctrlKey) {
            // Ctrl held - show crosshair for adding split
            wrapper.style.cursor = 'crosshair';
        } else {
            // Default cursor
            wrapper.style.cursor = 'default';
        }
    }

    /**
     * Start dragging a mute section divider
     * @param {string} trackId - Track ID
     * @param {Object} dividerInfo - { splitTime, element }
     * @param {number} startX - Starting X position
     */
    startMuteDividerDrag(trackId, dividerInfo, startX) {
        const sections = State.getMuteSectionsForTrack(trackId);
        if (sections.length <= 1) return;
        
        // Find the index of the section that starts at this split time
        const splitIndex = sections.findIndex(s => Math.abs(s.start - dividerInfo.splitTime) < 0.001);
        if (splitIndex <= 0) return; // Can't drag first boundary
        
        // Set drag state
        this.muteDragState = {
            isDragging: true,
            trackId: trackId,
            splitTime: dividerInfo.splitTime,
            splitIndex: splitIndex,
            currentTime: dividerInfo.splitTime,
            dividerElement: dividerInfo.element
        };
        
        // Add dragging class to divider
        dividerInfo.element.classList.add('dragging');
        
        // Set cursor
        document.body.style.cursor = 'ew-resize';
        
        console.log(`Started drag for divider at ${dividerInfo.splitTime.toFixed(3)}s`);
    }

    /**
     * Handle mouse move during mute divider drag
     * @param {MouseEvent} e - Mouse event
     */
    handleMuteDividerDragMove(e) {
        if (!this.muteDragState.isDragging) return;
        
        const song = State.getActiveSong();
        if (!song) return;
        
        const trackId = this.muteDragState.trackId;
        const track = State.getTrack(trackId);
        if (!track) return;
        
        // Calculate mouse position in world coordinates
        const rect = this.scrollArea.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + this.scrollArea.scrollLeft;
        
        const zoom = this.getEffectiveZoom();
        const offset = song.timeline?.offset || 0;
        
        // Convert to time
        let time = mouseX / (BASE_PIXELS_PER_SECOND * zoom) - offset;
        time = Math.max(0, time);
        
        // Snap to beat
        const snappedTime = findNearestBeat(time, song.metadata?.tempos, song.metadata?.['time-sigs']);
        
        // Get constraints - can't cross adjacent section boundaries
        const sections = State.getMuteSectionsForTrack(trackId);
        const splitIndex = this.muteDragState.splitIndex;
        
        const prevSection = sections[splitIndex - 1];
        const currSection = sections[splitIndex];
        
        // Constrain: must be after prevSection.start and before currSection.end
        const minTime = prevSection.start + 0.01;
        const maxTime = currSection.end - 0.01;
        
        const clampedTime = Math.max(minTime, Math.min(maxTime, snappedTime));
        
        // Update visual position of divider
        const newX = (clampedTime + offset) * BASE_PIXELS_PER_SECOND * zoom;
        this.muteDragState.dividerElement.style.left = `${newX}px`;
        
        // Store current time for use on drag end
        this.muteDragState.currentTime = clampedTime;
    }

    /**
     * Handle mouse up to end mute divider drag
     * @param {MouseEvent} e - Mouse event
     */
    handleMuteDividerDragEnd(e) {
        if (!this.muteDragState.isDragging) return;
        
        const { trackId, splitTime, currentTime, dividerElement } = this.muteDragState;
        
        // Remove dragging class
        if (dividerElement) {
            dividerElement.classList.remove('dragging');
        }
        
        // Reset cursor
        document.body.style.cursor = '';
        
        // If position changed, update the split
        if (Math.abs(currentTime - splitTime) > 0.001) {
            const success = State.moveMuteSplit(trackId, splitTime, currentTime);
            if (success) {
                console.log(`Moved mute split from ${splitTime.toFixed(3)}s to ${currentTime.toFixed(3)}s`);
            }
        }
        
        // Reset drag state
        this.muteDragState = {
            isDragging: false,
            trackId: null,
            splitTime: 0,
            splitIndex: -1,
            currentTime: 0,
            dividerElement: null
        };
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
        this.muteDividerContainers.clear();
        this.muteSectionBtnContainers.clear();
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
     * Handle mouse wheel for zooming on waveform area
     * Zooms toward the mouse cursor position (keeps point under cursor stationary)
     * @param {WheelEvent} e - Wheel event
     */
    handleWheelZoom(e) {
        const song = State.getActiveSong();
        if (!song) return;

        // Prevent default scroll behavior - we're using wheel for zoom
        e.preventDefault();

        // Get current zoom (handle auto-fit case)
        const currentZoom = this.getEffectiveZoom();

        // Calculate zoom change - scroll up = zoom in, scroll down = zoom out
        // Use a zoom factor per scroll increment (1.1x feels natural)
        const zoomFactor = 1.1;
        const delta = -e.deltaY; // Negative deltaY = scroll up = zoom in
        
        let newZoom;
        if (delta > 0) {
            // Zoom in
            newZoom = currentZoom * zoomFactor;
        } else if (delta < 0) {
            // Zoom out
            newZoom = currentZoom / zoomFactor;
        } else {
            return; // No change
        }

        // Clamp zoom to valid range (1% to 400%)
        const minZoom = 0.01;
        const maxZoom = 4.0;
        newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));

        // If zoom didn't change (hit limits), skip
        if (Math.abs(newZoom - currentZoom) < 0.0001) return;

        // Calculate the time position under the cursor (to keep it stationary)
        const rect = this.scrollArea.getBoundingClientRect();
        const cursorViewportX = e.clientX - rect.left; // Cursor X relative to viewport
        const cursorContentX = cursorViewportX + this.scrollArea.scrollLeft; // Cursor X in content coordinates
        
        const offset = song.timeline?.offset || 0;
        // Convert pixel position to time
        const cursorTime = (cursorContentX / (BASE_PIXELS_PER_SECOND * currentZoom)) - offset;

        // Update the zoom state (this triggers redraw via ZOOM_CHANGED event)
        State.updateTimeline({ zoom: newZoom });

        // Adjust scroll position to keep the cursor position stationary
        // New cursor content X should map to same time
        const newCursorContentX = (cursorTime + offset) * BASE_PIXELS_PER_SECOND * newZoom;
        const newScrollLeft = newCursorContentX - cursorViewportX;
        
        this.scrollArea.scrollLeft = Math.max(0, newScrollLeft);
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

    /**
     * Create the disabled sections overlay element (Phase 3)
     * This overlay shows which arrangement sections are disabled across all waveforms
     */
    createDisabledSectionsOverlay() {
        this.disabledSectionsOverlay = document.createElement('div');
        this.disabledSectionsOverlay.className = 'disabled-sections-overlay';
        this.disabledSectionsOverlay.style.display = 'none';
        this.container.appendChild(this.disabledSectionsOverlay);
    }

    /**
     * Update the disabled sections overlay (Phase 3)
     * Renders dark overlays for sections that are disabled in the arrangement
     */
    updateDisabledSectionsOverlay() {
        if (!this.disabledSectionsOverlay) return;
        
        // Clear existing overlays
        this.disabledSectionsOverlay.innerHTML = '';
        
        const song = State.getActiveSong();
        if (!song) {
            this.disabledSectionsOverlay.style.display = 'none';
            return;
        }
        
        const sections = song.arrangementSections || [];
        if (sections.length === 0) {
            this.disabledSectionsOverlay.style.display = 'none';
            return;
        }
        
        // Check if there are any disabled sections
        const hasDisabledSections = sections.some(s => !s.enabled);
        if (!hasDisabledSections) {
            this.disabledSectionsOverlay.style.display = 'none';
            return;
        }
        
        const zoom = this.getEffectiveZoom();
        const offset = song.timeline?.offset || 0;
        
        // Show the overlay container
        this.disabledSectionsOverlay.style.display = 'block';
        
        // Create overlay for each disabled section
        sections.forEach((section, index) => {
            if (section.enabled) return; // Skip enabled sections
            
            const startX = (section.start + offset) * BASE_PIXELS_PER_SECOND * zoom;
            const endX = (section.end + offset) * BASE_PIXELS_PER_SECOND * zoom;
            const width = endX - startX;
            
            const overlay = document.createElement('div');
            overlay.className = 'disabled-section-overlay';
            overlay.style.left = `${startX}px`;
            overlay.style.width = `${width}px`;
            overlay.dataset.sectionIndex = index;
            
            this.disabledSectionsOverlay.appendChild(overlay);
        });
    }

    // ========================================================================
    // Phase 4: Mute Section Dividers
    // ========================================================================

    /**
     * Render mute section dividers for a specific track
     * @param {string} trackId - Track ID
     */
    renderMuteSectionDividers(trackId) {
        const container = this.muteDividerContainers.get(trackId);
        if (!container) return;
        
        // Clear existing dividers
        container.innerHTML = '';
        
        const song = State.getActiveSong();
        if (!song) return;
        
        // Get split times for this track
        const splitTimes = State.getMuteSplitTimes(trackId);
        if (splitTimes.length === 0) return;
        
        const zoom = this.getEffectiveZoom();
        const offset = song.timeline?.offset || 0;
        
        // Create a divider element for each split
        splitTimes.forEach((splitTime) => {
            const x = (splitTime + offset) * BASE_PIXELS_PER_SECOND * zoom;
            
            const divider = document.createElement('div');
            divider.className = 'mute-section-divider';
            divider.style.left = `${x}px`;
            divider.dataset.splitTime = splitTime;
            divider.dataset.trackId = trackId;
            
            container.appendChild(divider);
        });
    }

    /**
     * Render mute section dividers for all tracks
     */
    renderAllMuteSectionDividers() {
        const song = State.getActiveSong();
        if (!song) return;
        
        song.tracks.forEach(track => {
            this.renderMuteSectionDividers(track.id);
        });
    }

    /**
     * Update mute section divider positions (called on zoom/scroll)
     * @param {string} trackId - Track ID
     */
    updateMuteSectionDividerPositions(trackId) {
        const container = this.muteDividerContainers.get(trackId);
        if (!container) return;
        
        const song = State.getActiveSong();
        if (!song) return;
        
        const zoom = this.getEffectiveZoom();
        const offset = song.timeline?.offset || 0;
        
        const dividers = container.querySelectorAll('.mute-section-divider');
        dividers.forEach(divider => {
            const splitTime = parseFloat(divider.dataset.splitTime);
            const x = (splitTime + offset) * BASE_PIXELS_PER_SECOND * zoom;
            divider.style.left = `${x}px`;
        });
    }

    /**
     * Update mute section divider positions for all tracks
     */
    updateAllMuteSectionDividerPositions() {
        this.muteDividerContainers.forEach((container, trackId) => {
            this.updateMuteSectionDividerPositions(trackId);
        });
    }

    // ========================================================================
    // Phase 4: Mute Section Buttons
    // ========================================================================

    /**
     * Render mute section buttons for a specific track
     * Shows a mute button in each section (only when track has multiple sections)
     * @param {string} trackId - Track ID
     */
    renderMuteSectionButtons(trackId) {
        const container = this.muteSectionBtnContainers.get(trackId);
        if (!container) return;
        
        // Clear existing buttons
        container.innerHTML = '';
        
        const song = State.getActiveSong();
        if (!song) return;
        
        // Get mute sections for this track
        const sections = State.getMuteSectionsForTrack(trackId);
        
        // Show mute button even for single section (allows muting entire track for mute sets)
        if (sections.length === 0) return;
        
        const zoom = this.getEffectiveZoom();
        const offset = song.timeline?.offset || 0;
        
        // Create a button for each section
        sections.forEach((section, index) => {
            const btn = document.createElement('button');
            btn.className = 'mute-section-btn';
            btn.dataset.sectionIndex = index;
            btn.dataset.trackId = trackId;
            btn.textContent = 'M';
            btn.title = section.muted ? 'Unmute this section' : 'Mute this section';
            
            // Apply muted class if section is muted
            if (section.muted) {
                btn.classList.add('muted');
            }
            
            // Position button at start of section (with small padding)
            const startX = (section.start + offset) * BASE_PIXELS_PER_SECOND * zoom;
            btn.style.left = `${startX + 4}px`;
            
            // Click handler
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent waveform seek
                e.preventDefault();
                const newMuted = State.toggleMuteSection(trackId, index);
                if (newMuted !== null) {
                    console.log(`Section ${index} is now ${newMuted ? 'muted' : 'unmuted'}`);
                }
            });
            
            container.appendChild(btn);
        });
    }

    /**
     * Render mute section buttons for all tracks
     */
    renderAllMuteSectionButtons() {
        const song = State.getActiveSong();
        if (!song) return;
        
        song.tracks.forEach(track => {
            this.renderMuteSectionButtons(track.id);
        });
    }

    /**
     * Update mute section button positions (called on zoom)
     * @param {string} trackId - Track ID
     */
    updateMuteSectionButtonPositions(trackId) {
        const container = this.muteSectionBtnContainers.get(trackId);
        if (!container) return;
        
        const song = State.getActiveSong();
        if (!song) return;
        
        const sections = State.getMuteSectionsForTrack(trackId);
        if (sections.length === 0) return;
        
        const zoom = this.getEffectiveZoom();
        const offset = song.timeline?.offset || 0;
        
        const buttons = container.querySelectorAll('.mute-section-btn');
        buttons.forEach((btn, index) => {
            const section = sections[index];
            if (!section) return;
            
            const startX = (section.start + offset) * BASE_PIXELS_PER_SECOND * zoom;
            btn.style.left = `${startX + 4}px`;
        });
    }

    /**
     * Update mute section button positions for all tracks
     */
    updateAllMuteSectionButtonPositions() {
        this.muteSectionBtnContainers.forEach((container, trackId) => {
            this.updateMuteSectionButtonPositions(trackId);
        });
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

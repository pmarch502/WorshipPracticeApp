/**
 * Timeline Sections UI
 * Renders arrangement sections in the arrangement bar below the timeline
 * 
 * Phase 3: Timeline-based custom arrangements
 * - Sections are displayed as horizontal regions that can be enabled/disabled
 * - Split dividers mark section boundaries
 * - Syncs with timeline zoom and scroll
 * 
 * Interactions:
 * - Ctrl+Click: Add split at that position (snaps to beat)
 * - Alt+Click on divider: Remove that split (merge sections)
 * - Drag divider: Move split position (snaps to beat)
 * - Click on section: Toggle enabled/disabled state
 */

import * as State from '../state.js';
import { findNearestBeat, findNearestBeatInfo } from '../metadata.js';
import { getModal } from './modal.js';

const BASE_PIXELS_PER_SECOND = 100;

// Minimum pixels from existing divider to allow new split
const MIN_SPLIT_DISTANCE_PX = 10;

// Hit detection threshold for dividers (pixels)
const DIVIDER_HIT_THRESHOLD = 8;

// Minimum section duration in beats (prevents too-small sections)
const MIN_SECTION_BEATS = 1;

class TimelineSections {
    constructor() {
        this.container = document.getElementById('arrangement-sections-bar');
        this.scrollOffset = 0;
        this.sectionElements = [];
        this.dividerElements = [];
        
        // Drag state
        this.isDragging = false;
        this.dragDivider = null;
        this.dragStartX = 0;
        this.dragSplitTime = 0;
        this.dragSplitIndex = -1;
        
        if (this.container) {
            this.init();
            this.attachStateListeners();
            this.attachInteractionListeners();
        }
    }

    init() {
        // Initial render will happen when song loads
    }

    attachStateListeners() {
        // Re-render when arrangement sections change
        State.subscribe(State.Events.ARRANGEMENT_SECTIONS_CHANGED, () => {
            this.render();
        });

        // Re-render when zoom changes
        State.subscribe(State.Events.ZOOM_CHANGED, () => {
            this.render();
        });

        // Sync scroll with waveform panel
        State.subscribe('waveformScroll', (scrollLeft) => {
            this.scrollOffset = scrollLeft;
            this.render();
        });

        // Re-render when song switches
        State.subscribe(State.Events.SONG_SWITCHED, (song) => {
            this.scrollOffset = 0;
            if (song) {
                // Initialize original arrangement if not already set
                if (!song.arrangementSections || song.arrangementSections.length === 0) {
                    State.initializeOriginalArrangement(song.id);
                }
            }
            // Defer render to next frame to ensure DOM/state is ready
            requestAnimationFrame(() => this.render());
        });

        // Re-render when tracks are added/removed (duration may change)
        State.subscribe(State.Events.TRACK_ADDED, () => {
            // Re-initialize if sections are empty
            const song = State.getActiveSong();
            if (song && (!song.arrangementSections || song.arrangementSections.length === 0)) {
                State.initializeOriginalArrangement(song.id);
            }
            this.render();
        });

        State.subscribe(State.Events.TRACK_REMOVED, () => {
            this.render();
        });

        // Re-render on state load
        State.subscribe(State.Events.STATE_LOADED, () => {
            const song = State.getActiveSong();
            if (song && (!song.arrangementSections || song.arrangementSections.length === 0)) {
                State.initializeOriginalArrangement(song.id);
            }
            this.render();
        });
    }

    /**
     * Attach mouse interaction listeners for the arrangement bar
     */
    attachInteractionListeners() {
        // Mouse down on container - handles Ctrl+click for splits, click on sections
        this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        
        // Global mouse events for drag handling
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        
        // Update cursor on hover
        this.container.addEventListener('mousemove', (e) => this.handleHover(e));
        this.container.addEventListener('mouseleave', () => this.resetCursor());
    }

    /**
     * Convert time in seconds to pixel X position
     */
    timeToPixel(time, zoom, offset) {
        return (time + offset) * BASE_PIXELS_PER_SECOND * zoom - this.scrollOffset;
    }

    /**
     * Convert pixel X position to time in seconds
     */
    pixelToTime(pixelX) {
        const song = State.getActiveSong();
        if (!song) return 0;
        
        const zoom = song.timeline?.zoom || 1;
        const offset = song.timeline?.offset || 0;
        
        // Account for scroll offset
        const adjustedX = pixelX + this.scrollOffset;
        const time = adjustedX / (BASE_PIXELS_PER_SECOND * zoom) - offset;
        return Math.max(0, time);
    }

    /**
     * Snap time to nearest beat
     */
    snapToBeat(time) {
        const song = State.getActiveSong();
        if (!song) return time;
        
        const tempos = song.metadata?.tempos;
        const timeSigs = song.metadata?.['time-sigs'];
        
        return findNearestBeat(time, tempos, timeSigs);
    }

    /**
     * Get effective zoom level (handles null = auto-fit)
     */
    getEffectiveZoom() {
        const song = State.getActiveSong();
        let zoom = song?.timeline?.zoom;
        
        if (zoom === null || zoom === undefined) {
            // Calculate fit-to-window zoom (same logic as timeline.js)
            const maxDuration = State.getMaxDuration();
            if (maxDuration > 0) {
                const waveformScrollArea = document.getElementById('waveform-scroll-area');
                const viewportWidth = waveformScrollArea ? waveformScrollArea.clientWidth - 20 : 800;
                zoom = (viewportWidth * 0.9) / (maxDuration * BASE_PIXELS_PER_SECOND);
                zoom = Math.max(0.01, Math.min(4.0, zoom));
            } else {
                zoom = 1;
            }
        }
        
        return zoom;
    }

    /**
     * Check if a pixel X position is near a divider
     * Returns the divider element and split time if found, null otherwise
     */
    getDividerAtPosition(pixelX) {
        for (const divider of this.dividerElements) {
            const dividerX = parseFloat(divider.style.left);
            if (Math.abs(pixelX - dividerX) <= DIVIDER_HIT_THRESHOLD) {
                return {
                    element: divider,
                    splitTime: parseFloat(divider.dataset.splitTime)
                };
            }
        }
        return null;
    }

    /**
     * Get the section at a pixel X position
     * Returns the section index if found, -1 otherwise
     */
    getSectionAtPosition(pixelX) {
        for (const sectionEl of this.sectionElements) {
            const left = parseFloat(sectionEl.style.left);
            const width = parseFloat(sectionEl.style.width);
            if (pixelX >= left && pixelX <= left + width) {
                return parseInt(sectionEl.dataset.sectionIndex, 10);
            }
        }
        return -1;
    }

    /**
     * Handle hover to update cursor
     */
    handleHover(e) {
        if (this.isDragging) return;
        
        const rect = this.container.getBoundingClientRect();
        const pixelX = e.clientX - rect.left;
        
        // Check if over a divider
        const divider = this.getDividerAtPosition(pixelX);
        if (divider) {
            this.container.style.cursor = 'ew-resize';
        } else if (e.ctrlKey) {
            // Ctrl held - show add cursor
            this.container.style.cursor = 'crosshair';
        } else {
            this.container.style.cursor = 'pointer';
        }
    }

    resetCursor() {
        this.container.style.cursor = 'default';
    }

    /**
     * Handle mouse down events
     */
    handleMouseDown(e) {
        const song = State.getActiveSong();
        if (!song) return;
        
        const rect = this.container.getBoundingClientRect();
        const pixelX = e.clientX - rect.left;
        const time = this.pixelToTime(pixelX);
        
        // Check if clicking on a divider
        const divider = this.getDividerAtPosition(pixelX);
        
        if (divider) {
            if (e.altKey) {
                // Alt+Click on divider: Remove split
                e.preventDefault();
                e.stopPropagation();
                this.removeSplit(divider.splitTime);
            } else {
                // Start dragging the divider
                e.preventDefault();
                e.stopPropagation();
                this.startDrag(divider, pixelX);
            }
            return;
        }
        
        if (e.ctrlKey) {
            // Ctrl+Click: Add split at this position
            e.preventDefault();
            e.stopPropagation();
            this.addSplit(time);
            return;
        }
        
        // Regular click on section: Toggle enabled/disabled
        const sectionIndex = this.getSectionAtPosition(pixelX);
        if (sectionIndex >= 0) {
            e.preventDefault();
            e.stopPropagation();
            this.toggleSection(sectionIndex);
        }
    }

    /**
     * Handle mouse move for dragging
     */
    handleMouseMove(e) {
        if (!this.isDragging || !this.dragDivider) return;
        
        const rect = this.container.getBoundingClientRect();
        const pixelX = e.clientX - rect.left;
        const time = this.pixelToTime(pixelX);
        const snappedTime = this.snapToBeat(time);
        
        // Get constraints for this divider (can't cross adjacent dividers)
        const sections = State.getArrangementSections();
        const splitIndex = this.dragSplitIndex;
        
        if (splitIndex < 0 || splitIndex >= sections.length) return;
        
        // The divider is between section[splitIndex-1] and section[splitIndex]
        // Min: start of section[splitIndex-1] (or 0 if first)
        // Max: end of section[splitIndex] (or duration if last)
        const prevSection = sections[splitIndex - 1];
        const currSection = sections[splitIndex];
        
        const minTime = prevSection ? prevSection.start + 0.01 : 0.01;
        const maxTime = currSection ? currSection.end - 0.01 : State.getSourceDuration() - 0.01;
        
        // Clamp to valid range
        const clampedTime = Math.max(minTime, Math.min(maxTime, snappedTime));
        
        // Update the visual position of the divider during drag
        const zoom = this.getEffectiveZoom();
        const offset = State.getActiveSong()?.timeline?.offset || 0;
        const newX = this.timeToPixel(clampedTime, zoom, offset);
        this.dragDivider.element.style.left = `${newX}px`;
        
        // Store the current drag time for use on mouse up
        this.dragCurrentTime = clampedTime;
    }

    /**
     * Handle mouse up - finalize drag or complete action
     */
    handleMouseUp(e) {
        if (!this.isDragging) return;
        
        // Finalize the split position
        if (this.dragCurrentTime !== undefined && this.dragCurrentTime !== this.dragSplitTime) {
            this.moveSplit(this.dragSplitTime, this.dragCurrentTime);
        }
        
        // Reset drag state
        this.isDragging = false;
        this.dragDivider = null;
        this.dragSplitTime = 0;
        this.dragSplitIndex = -1;
        this.dragCurrentTime = undefined;
        
        this.resetCursor();
    }

    /**
     * Start dragging a divider
     */
    startDrag(divider, startX) {
        this.isDragging = true;
        this.dragDivider = divider;
        this.dragStartX = startX;
        this.dragSplitTime = divider.splitTime;
        
        // Find the index of the section that starts at this split time
        const sections = State.getArrangementSections();
        this.dragSplitIndex = sections.findIndex(s => Math.abs(s.start - divider.splitTime) < 0.001);
        
        this.container.style.cursor = 'ew-resize';
    }

    /**
     * Add a split at the specified time (snapped to beat)
     */
    addSplit(time) {
        const song = State.getActiveSong();
        if (!song) return;
        
        // Snap to beat
        const snappedTime = this.snapToBeat(time);
        
        // Check minimum distance from existing splits
        const existingSplits = State.getArrangementSplitTimes();
        const zoom = this.getEffectiveZoom();
        
        for (const splitTime of existingSplits) {
            const distance = Math.abs(snappedTime - splitTime) * BASE_PIXELS_PER_SECOND * zoom;
            if (distance < MIN_SPLIT_DISTANCE_PX) {
                console.log('Split too close to existing split');
                return;
            }
        }
        
        // Check we're not at the very start or end
        const duration = State.getSourceDuration();
        if (snappedTime <= 0.01 || snappedTime >= duration - 0.01) {
            console.log('Cannot split at song boundaries');
            return;
        }
        
        // Check minimum section size (MIN_SECTION_BEATS)
        const beatInfo = findNearestBeatInfo(snappedTime, song.metadata?.tempos, song.metadata?.['time-sigs']);
        const beatDuration = 60 / beatInfo.tempo; // seconds per beat
        const minSectionDuration = beatDuration * MIN_SECTION_BEATS;
        
        // Find which section this split would be in
        const sections = State.getArrangementSections();
        const targetSection = sections.find(s => snappedTime > s.start && snappedTime < s.end);
        
        if (targetSection) {
            // Check that both resulting sections would be at least MIN_SECTION_BEATS long
            const leftDuration = snappedTime - targetSection.start;
            const rightDuration = targetSection.end - snappedTime;
            
            if (leftDuration < minSectionDuration || rightDuration < minSectionDuration) {
                console.log(`Split would create section smaller than ${MIN_SECTION_BEATS} beat(s)`);
                return;
            }
        }
        
        // Add the split
        const success = State.addArrangementSplit(snappedTime);
        if (success) {
            console.log(`Added split at ${snappedTime.toFixed(3)}s`);
        }
    }

    /**
     * Remove a split at the specified time
     */
    removeSplit(splitTime) {
        const success = State.removeArrangementSplit(splitTime);
        if (success) {
            console.log(`Removed split at ${splitTime.toFixed(3)}s`);
        }
    }

    /**
     * Move a split from one time to another
     */
    moveSplit(oldTime, newTime) {
        const song = State.getActiveSong();
        if (!song) return;
        
        const sections = [...song.arrangementSections];
        
        // Find the section that starts at oldTime
        const splitIndex = sections.findIndex(s => Math.abs(s.start - oldTime) < 0.001);
        if (splitIndex <= 0) return; // Can't move first boundary
        
        // Update the boundary
        sections[splitIndex - 1].end = newTime;
        sections[splitIndex].start = newTime;
        
        State.setArrangementSections(sections, true);
        console.log(`Moved split from ${oldTime.toFixed(3)}s to ${newTime.toFixed(3)}s`);
    }

    /**
     * Toggle a section's enabled/disabled state
     */
    async toggleSection(sectionIndex) {
        const sections = State.getArrangementSections();
        
        // Count enabled sections
        const enabledCount = sections.filter(s => s.enabled).length;
        
        // Don't allow disabling the last enabled section
        if (sections[sectionIndex].enabled && enabledCount <= 1) {
            const modal = getModal();
            await modal.alert({
                title: 'Cannot Disable Section',
                message: 'At least one section must remain enabled for playback.'
            });
            return;
        }
        
        const newState = State.toggleArrangementSection(sectionIndex);
        if (newState !== null) {
            console.log(`Section ${sectionIndex} is now ${newState ? 'enabled' : 'disabled'}`);
        }
    }

    /**
     * Render arrangement sections in the bar
     */
    render() {
        if (!this.container) return;

        // Clear existing elements
        this.container.innerHTML = '';
        this.sectionElements = [];
        this.dividerElements = [];

        const song = State.getActiveSong();
        if (!song) return;

        const sections = song.arrangementSections || [];
        if (sections.length === 0) return;

        const zoom = this.getEffectiveZoom();
        const offset = song.timeline?.offset || 0;

        // Render each section
        sections.forEach((section, index) => {
            const startX = this.timeToPixel(section.start, zoom, offset);
            const endX = this.timeToPixel(section.end, zoom, offset);
            const width = endX - startX;

            // Create section element
            const sectionEl = document.createElement('div');
            sectionEl.className = `arrangement-section ${section.enabled ? 'enabled' : 'disabled'}`;
            sectionEl.style.left = `${startX}px`;
            sectionEl.style.width = `${width}px`;
            sectionEl.dataset.sectionIndex = index;

            this.container.appendChild(sectionEl);
            this.sectionElements.push(sectionEl);
        });

        // Render dividers at section boundaries (except first and last)
        this.renderDividers(sections, zoom, offset);
    }

    /**
     * Render split point dividers
     */
    renderDividers(sections, zoom, offset) {
        if (sections.length <= 1) return;

        // Get split times (boundaries between sections)
        const splitTimes = State.getArrangementSplitTimes();

        splitTimes.forEach((splitTime) => {
            const x = this.timeToPixel(splitTime, zoom, offset);

            // Skip if outside visible area
            if (x < -10 || x > this.container.offsetWidth + 10) {
                return;
            }

            // Create divider element
            const dividerEl = document.createElement('div');
            dividerEl.className = 'arrangement-divider';
            dividerEl.style.left = `${x}px`;
            dividerEl.dataset.splitTime = splitTime;

            this.container.appendChild(dividerEl);
            this.dividerElements.push(dividerEl);
        });
    }

    /**
     * Force a re-render (useful when called externally)
     */
    refresh() {
        this.render();
    }
}

// Singleton instance
let timelineSectionsInstance = null;

export function getTimelineSections() {
    if (!timelineSectionsInstance) {
        timelineSectionsInstance = new TimelineSections();
    }
    return timelineSectionsInstance;
}

export default TimelineSections;

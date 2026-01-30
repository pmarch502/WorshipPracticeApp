/**
 * Timeline Sections UI
 * Renders arrangement sections in the arrangement bar below the timeline
 * 
 * Phase 3: Timeline-based custom arrangements
 * - Sections are displayed as horizontal regions that can be enabled/disabled
 * - Split dividers mark section boundaries
 * - Syncs with timeline zoom and scroll
 */

import * as State from '../state.js';

const BASE_PIXELS_PER_SECOND = 100;

class TimelineSections {
    constructor() {
        this.container = document.getElementById('arrangement-sections-bar');
        this.scrollOffset = 0;
        this.sectionElements = [];
        this.dividerElements = [];
        
        if (this.container) {
            this.init();
            this.attachStateListeners();
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
            this.render();
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
     * Convert time in seconds to pixel X position
     * @param {number} time - Time in seconds
     * @param {number} zoom - Zoom multiplier
     * @param {number} offset - Timeline offset
     * @returns {number} Pixel X position
     */
    timeToPixel(time, zoom, offset) {
        return (time + offset) * BASE_PIXELS_PER_SECOND * zoom - this.scrollOffset;
    }

    /**
     * Get the effective zoom level
     * @returns {number} Zoom multiplier
     */
    getEffectiveZoom() {
        const song = State.getActiveSong();
        return song?.timeline?.zoom || 1;
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
        const containerWidth = this.container.offsetWidth;

        // Render each section
        sections.forEach((section, index) => {
            const startX = this.timeToPixel(section.start, zoom, offset);
            const endX = this.timeToPixel(section.end, zoom, offset);
            const width = endX - startX;

            // Skip if completely outside visible area
            if (endX < 0 || startX > containerWidth + this.scrollOffset) {
                return;
            }

            // Create section element
            const sectionEl = document.createElement('div');
            sectionEl.className = `arrangement-section ${section.enabled ? 'enabled' : 'disabled'}`;
            sectionEl.style.left = `${startX}px`;
            sectionEl.style.width = `${width}px`;
            sectionEl.dataset.sectionIndex = index;

            // Click handler for toggling (Phase 3.8 - but add basic structure now)
            sectionEl.addEventListener('click', (e) => {
                // Ctrl+click will be for adding splits (Phase 3.5)
                // Alt+click on divider will be for removing splits (Phase 3.6)
                // Regular click toggles enabled state (Phase 3.8)
                if (!e.ctrlKey && !e.altKey) {
                    // For now, just toggle - full implementation in Phase 3.8
                    // State.toggleArrangementSection(index);
                }
            });

            this.container.appendChild(sectionEl);
            this.sectionElements.push(sectionEl);
        });

        // Render dividers at section boundaries (except first and last)
        this.renderDividers(sections, zoom, offset);
    }

    /**
     * Render split point dividers
     * @param {Array} sections - Arrangement sections
     * @param {number} zoom - Zoom multiplier
     * @param {number} offset - Timeline offset
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

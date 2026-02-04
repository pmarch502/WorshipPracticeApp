/**
 * Sections Module
 * 
 * Phase 2 update: Markers are now visual-only and don't define sections.
 * The default state is a single "full song" section.
 * 
 * This module provides:
 * - deriveSections() - kept for future use (loading arrangements from S3)
 * - Section boundary utilities
 */

/**
 * Derive sections from markers array
 * Each marker defines the START of a section; the section ends where the next marker begins
 * (or at the end of the song for the final section)
 * 
 * @param {Array} markers - Array of {name, start} sorted by start time
 * @param {number} totalDuration - Total song duration in seconds
 * @returns {Array} Array of section objects: {index, name, start, end, duration}
 */
export function deriveSections(markers, totalDuration) {
    if (!markers || markers.length === 0) {
        return [];
    }
    
    // Ensure markers are sorted by start time
    const sortedMarkers = [...markers].sort((a, b) => a.start - b.start);
    
    const sections = [];
    
    for (let i = 0; i < sortedMarkers.length; i++) {
        const marker = sortedMarkers[i];
        const nextMarker = sortedMarkers[i + 1];
        
        const end = nextMarker ? nextMarker.start : totalDuration;
        
        sections.push({
            index: i,
            name: marker.name || `Section ${i + 1}`,
            unlabeled: marker.unlabeled || false,
            start: marker.start,
            end: end,
            duration: end - marker.start
        });
    }
    
    return sections;
}

/**
 * Get section at a given time
 * @param {Array} sections - Derived sections array
 * @param {number} time - Time in seconds
 * @returns {Object|null} Section containing the time, or null
 */
export function getSectionAtTime(sections, time) {
    if (!sections || sections.length === 0) return null;
    
    for (const section of sections) {
        if (time >= section.start && time < section.end) {
            return section;
        }
    }
    
    // Edge case: time exactly at end of last section
    const lastSection = sections[sections.length - 1];
    if (time >= lastSection.start && time <= lastSection.end) {
        return lastSection;
    }
    
    return null;
}

/**
 * Get section by index
 * @param {Array} sections - Derived sections array
 * @param {number} index - Section index (from marker order)
 * @returns {Object|null} Section at index, or null
 */
export function getSectionByIndex(sections, index) {
    if (!sections || index < 0 || index >= sections.length) {
        return null;
    }
    return sections[index];
}

/**
 * Get all section boundary times (for rendering dividers)
 * Returns start times of all sections except the first (no divider at time 0)
 * @param {Array} sections - Derived sections array
 * @returns {Array<number>} Array of boundary times in seconds
 */
export function getSectionBoundaries(sections) {
    if (!sections || sections.length <= 1) {
        return [];
    }
    
    // Return start times of sections 1 onwards (skip first section)
    return sections.slice(1).map(section => section.start);
}

/**
 * Sections Module
 * Derives section regions from markers for arrangements and visual display
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

// ============================================================================
// Virtual Sections (Arrangements)
// ============================================================================

/**
 * Derive virtual sections from an arrangement definition
 * Virtual sections map arrangement order to source sections with virtual timeline positions
 * 
 * @param {Array} sections - Original derived sections array
 * @param {Array<number>|null} arrangementIndices - Array of section indices in arrangement order,
 *                                                   or null for default (all sections in order)
 * @returns {Array} Array of virtual section objects
 */
export function deriveVirtualSections(sections, arrangementIndices = null) {
    if (!sections || sections.length === 0) {
        return [];
    }
    
    // Default arrangement: all sections in order
    const indices = arrangementIndices || sections.map((_, i) => i);
    
    const virtualSections = [];
    let virtualTime = 0;
    
    for (let i = 0; i < indices.length; i++) {
        const sourceIndex = indices[i];
        const sourceSection = sections[sourceIndex];
        
        if (!sourceSection) {
            console.warn(`Invalid section index ${sourceIndex} in arrangement`);
            continue;
        }
        
        const duration = sourceSection.duration;
        
        virtualSections.push({
            virtualIndex: i,
            sourceIndex: sourceIndex,
            virtualStart: virtualTime,
            virtualEnd: virtualTime + duration,
            sourceStart: sourceSection.start,
            sourceEnd: sourceSection.end,
            name: sourceSection.name,
            duration: duration
        });
        
        virtualTime += duration;
    }
    
    return virtualSections;
}

/**
 * Calculate total duration of virtual sections
 * @param {Array} virtualSections - Array of virtual section objects
 * @returns {number} Total virtual duration in seconds
 */
export function getVirtualDuration(virtualSections) {
    if (!virtualSections || virtualSections.length === 0) {
        return 0;
    }
    return virtualSections[virtualSections.length - 1].virtualEnd;
}

/**
 * Get the virtual section at a given virtual time
 * @param {Array} virtualSections - Array of virtual section objects
 * @param {number} virtualTime - Time in virtual timeline (seconds)
 * @returns {Object|null} Virtual section containing the time, or null
 */
export function getVirtualSectionAtTime(virtualSections, virtualTime) {
    if (!virtualSections || virtualSections.length === 0) return null;
    
    for (const section of virtualSections) {
        if (virtualTime >= section.virtualStart && virtualTime < section.virtualEnd) {
            return section;
        }
    }
    
    // Edge case: time exactly at end of last section
    const lastSection = virtualSections[virtualSections.length - 1];
    if (virtualTime >= lastSection.virtualStart && virtualTime <= lastSection.virtualEnd) {
        return lastSection;
    }
    
    return null;
}

/**
 * Convert virtual timeline position to source audio position
 * @param {number} virtualTime - Time in virtual timeline (seconds)
 * @param {Array} virtualSections - Array of virtual section objects
 * @returns {Object|null} { sourceTime, virtualSection } or null if out of range
 */
export function virtualToSourcePosition(virtualTime, virtualSections) {
    if (!virtualSections || virtualSections.length === 0) return null;
    
    const section = getVirtualSectionAtTime(virtualSections, virtualTime);
    if (!section) return null;
    
    // Calculate offset within the virtual section
    const offsetInSection = virtualTime - section.virtualStart;
    
    // Map to source position
    const sourceTime = section.sourceStart + offsetInSection;
    
    return {
        sourceTime,
        virtualSection: section,
        virtualSectionIndex: section.virtualIndex,
        sourceIndex: section.sourceIndex
    };
}

/**
 * Convert source audio position to virtual timeline position
 * Note: This is ambiguous when sections repeat - uses virtualSectionIndex hint if provided
 * @param {number} sourceTime - Time in source audio (seconds)
 * @param {Array} virtualSections - Array of virtual section objects
 * @param {number|null} virtualSectionIndexHint - Hint for which virtual section instance to use
 * @returns {Object|null} { virtualTime, virtualSection } or null if not found
 */
export function sourceToVirtualPosition(sourceTime, virtualSections, virtualSectionIndexHint = null) {
    if (!virtualSections || virtualSections.length === 0) return null;
    
    // If we have a hint, try that section first
    if (virtualSectionIndexHint !== null) {
        const section = virtualSections[virtualSectionIndexHint];
        if (section && sourceTime >= section.sourceStart && sourceTime < section.sourceEnd) {
            const offsetInSection = sourceTime - section.sourceStart;
            return {
                virtualTime: section.virtualStart + offsetInSection,
                virtualSection: section
            };
        }
    }
    
    // Find first matching section (for cases without hint or hint was wrong)
    for (const section of virtualSections) {
        if (sourceTime >= section.sourceStart && sourceTime < section.sourceEnd) {
            const offsetInSection = sourceTime - section.sourceStart;
            return {
                virtualTime: section.virtualStart + offsetInSection,
                virtualSection: section
            };
        }
    }
    
    return null;
}

/**
 * Get the next virtual section after the given index
 * @param {Array} virtualSections - Array of virtual section objects
 * @param {number} currentVirtualIndex - Current virtual section index
 * @returns {Object|null} Next virtual section or null if at end
 */
export function getNextVirtualSection(virtualSections, currentVirtualIndex) {
    if (!virtualSections || currentVirtualIndex >= virtualSections.length - 1) {
        return null;
    }
    return virtualSections[currentVirtualIndex + 1];
}

/**
 * Check if transition between two virtual sections requires a seek
 * (i.e., source audio positions are not contiguous)
 * @param {Object} fromSection - Current virtual section
 * @param {Object} toSection - Next virtual section
 * @returns {boolean} True if seek is required
 */
export function requiresSeekTransition(fromSection, toSection) {
    if (!fromSection || !toSection) return false;
    
    // Check if the source end of current section matches source start of next
    // Use small epsilon for floating point comparison
    const epsilon = 0.001;
    return Math.abs(fromSection.sourceEnd - toSection.sourceStart) > epsilon;
}

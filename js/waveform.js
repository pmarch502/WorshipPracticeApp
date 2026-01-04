/**
 * Waveform Renderer
 * Canvas-based waveform visualization
 */

const ACTIVE_COLOR = '#00d4ff';
const INACTIVE_COLOR = '#4a4a4a';
const BACKGROUND_COLOR = '#1a1a1a';
const SECTION_DIVIDER_COLOR = 'rgba(255, 255, 0, 0.4)'; // Matches marker color

/**
 * Render waveform to a canvas
 * @deprecated Use renderWaveformGradient() instead - this function has precision issues at high zoom levels
 * @param {HTMLCanvasElement} canvas - Target canvas
 * @param {Float32Array|Array} peaks - Peak values (0-1)
 * @param {Object} options - Rendering options
 */
export function renderWaveform(canvas, peaks, options = {}) {
    const {
        color = ACTIVE_COLOR,
        backgroundColor = BACKGROUND_COLOR,
        zoom = 1,
        scrollOffset = 0,
        duration = 0,
        pixelsPerSecond = 100
    } = options;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    
    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    
    if (!peaks || peaks.length === 0) return;

    // Calculate visible region
    const totalWidth = duration * pixelsPerSecond * zoom;
    const peaksPerPixel = peaks.length / totalWidth;
    
    const startPixel = scrollOffset;
    const endPixel = Math.min(startPixel + width, totalWidth);
    
    // Draw waveform
    ctx.fillStyle = color;
    
    const centerY = height / 2;
    const amplitude = height / 2 - 2; // Leave some padding
    
    for (let x = 0; x < width; x++) {
        const sourcePixel = startPixel + x;
        if (sourcePixel >= totalWidth) break;
        
        // Get peak value for this pixel
        const peakIndex = Math.floor(sourcePixel * peaksPerPixel);
        const peak = peaks[Math.min(peakIndex, peaks.length - 1)] || 0;
        
        // Draw symmetric bar
        const barHeight = peak * amplitude;
        
        if (barHeight > 0.5) {
            ctx.fillRect(x, centerY - barHeight, 1, barHeight * 2);
        } else {
            // Draw thin line for very quiet parts
            ctx.fillRect(x, centerY - 0.5, 1, 1);
        }
    }
}

/**
 * Render waveform with gradient effect
 * Uses MAX-POOLING when zoomed out to preserve transients (important for click tracks)
 * Uses interpolation when zoomed in for smoother appearance
 */
export function renderWaveformGradient(canvas, peaks, options = {}) {
    const {
        color = ACTIVE_COLOR,
        backgroundColor = BACKGROUND_COLOR,
        zoom = 1,
        scrollOffset = 0,
        duration = 0,
        pixelsPerSecond = 100,
        offset = 0,  // Timeline offset for beat alignment
        sections = null,  // Array of section objects for muted section rendering
        sectionMutes = null  // Object { sectionIndex: true } for muted sections
    } = options;

    const ctx = canvas.getContext('2d');
    const { width: canvasWidth, height } = canvas;
    
    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, height);
    
    if (!peaks || peaks.length === 0 || duration <= 0) return;

    // VIEWPORT-BASED APPROACH: Calculate using time instead of massive pixel values
    // This avoids floating-point precision loss at high zoom levels (>64K virtual pixels)
    const pixelsPerSecondZoomed = pixelsPerSecond * zoom;
    
    const centerY = height / 2;
    const amplitude = height / 2 - 2;

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, adjustColorAlpha(color, 0.3));
    gradient.addColorStop(0.5, color);
    gradient.addColorStop(1, adjustColorAlpha(color, 0.3));
    
    ctx.fillStyle = gradient;
    
    /**
     * Get peak value for a pixel position using MAX-POOLING
     * Uses time-based conversion to avoid precision loss at high zoom levels
     * When zoomed out, takes MAX of all peaks in the range (preserves transients)
     * When zoomed in, uses the nearest peak value
     */
    const getPeakAt = (pixelX) => {
        // Convert screen pixel to time (accounting for offset like timeline does)
        const screenPixel = scrollOffset + pixelX;
        const time = (screenPixel / pixelsPerSecondZoomed) - offset;
        
        // Clamp to valid time range
        if (time < 0 || time >= duration) return 0;
        
        // Convert time to peak array index
        const timeRatio = time / duration;
        const startIndex = Math.floor(timeRatio * peaks.length);
        
        // Calculate end index for the next pixel to determine if we need max-pooling
        const nextTime = ((screenPixel + 1) / pixelsPerSecondZoomed) - offset;
        const nextTimeRatio = Math.min(nextTime / duration, 1);
        const endIndex = Math.floor(nextTimeRatio * peaks.length);
        
        // If multiple peaks map to this pixel, use MAX (preserves transients)
        if (endIndex > startIndex) {
            let maxPeak = 0;
            for (let i = startIndex; i <= endIndex && i < peaks.length; i++) {
                maxPeak = Math.max(maxPeak, peaks[i] || 0);
            }
            return maxPeak;
        }
        
        // Single peak maps to this pixel - use it directly
        return peaks[Math.min(startIndex, peaks.length - 1)] || 0;
    };
    
    /**
     * Get peak value using interpolation (for zoomed-in smooth rendering)
     * Uses time-based conversion to avoid precision loss at high zoom levels
     */
    const getPeakAtSmooth = (pixelX) => {
        // Convert screen pixel to time (accounting for offset like timeline does)
        const screenPixel = scrollOffset + pixelX;
        const time = (screenPixel / pixelsPerSecondZoomed) - offset;
        
        // Clamp to valid time range
        if (time < 0 || time >= duration) return 0;
        
        // Convert time to exact peak index with sub-index precision for interpolation
        const exactIndex = (time / duration) * peaks.length;
        const index1 = Math.floor(exactIndex);
        const index2 = Math.min(index1 + 1, peaks.length - 1);
        const fraction = exactIndex - index1;
        
        // Linear interpolation between adjacent peaks
        const peak1 = peaks[Math.min(index1, peaks.length - 1)] || 0;
        const peak2 = peaks[index2] || 0;
        
        return peak1 + (peak2 - peak1) * fraction;
    };
    
    // Choose rendering strategy based on zoom level
    // Calculate peaks per pixel using viewport-based approach
    // Use smooth curves when zoomed in (fewer than 2 peaks per pixel)
    const secondsPerPixel = 1 / pixelsPerSecondZoomed;
    const peaksPerSecond = peaks.length / duration;
    const peaksPerPixel = secondsPerPixel * peaksPerSecond;
    const useSmoothing = peaksPerPixel < 2;
    
    // Check if we need to render section-aware (with muted sections)
    const hasSectionMutes = sections && sectionMutes && 
        sections.length > 0 && Object.keys(sectionMutes).length > 0;
    
    if (hasSectionMutes) {
        // Create inactive gradient for muted sections
        const inactiveGradient = ctx.createLinearGradient(0, 0, 0, height);
        inactiveGradient.addColorStop(0, adjustColorAlpha(INACTIVE_COLOR, 0.3));
        inactiveGradient.addColorStop(0.5, INACTIVE_COLOR);
        inactiveGradient.addColorStop(1, adjustColorAlpha(INACTIVE_COLOR, 0.3));
        
        // Helper to get time from pixel X
        const getTimeAtPixel = (pixelX) => {
            const screenPixel = scrollOffset + pixelX;
            return (screenPixel / pixelsPerSecondZoomed) - offset;
        };
        
        // Helper to check if a time is in a muted section
        const isTimeInMutedSection = (time) => {
            for (const section of sections) {
                if (time >= section.start && time < section.end) {
                    return !!sectionMutes[section.index];
                }
            }
            return false;
        };
        
        // Render with section-aware coloring
        if (useSmoothing) {
            renderSmoothWaveformWithSections(ctx, canvasWidth, height, centerY, amplitude, 
                getPeakAtSmooth, zoom, gradient, inactiveGradient, getTimeAtPixel, isTimeInMutedSection);
        } else {
            renderBarWaveformWithSections(ctx, canvasWidth, height, centerY, amplitude, 
                getPeakAt, gradient, inactiveGradient, getTimeAtPixel, isTimeInMutedSection);
        }
    } else {
        // Standard rendering without section mutes
        if (useSmoothing) {
            // Zoomed in: use smooth curve rendering with interpolation
            renderSmoothWaveform(ctx, canvasWidth, height, centerY, amplitude, getPeakAtSmooth, zoom, gradient);
        } else {
            // Zoomed out: use bar rendering with max-pooling (preserves transients)
            renderBarWaveform(ctx, canvasWidth, height, centerY, amplitude, getPeakAt, gradient);
        }
    }
    
    // Draw center line
    ctx.strokeStyle = adjustColorAlpha(color, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvasWidth, centerY);
    ctx.stroke();
}

/**
 * Render waveform as smooth curves (for zoomed-in view)
 */
function renderSmoothWaveform(ctx, width, height, centerY, amplitude, getPeakAt, zoom, gradient) {
    const topPoints = [];
    const bottomPoints = [];
    
    // Sample at sub-pixel resolution for smoother curves
    const step = Math.max(1, Math.floor(1 / zoom));
    
    for (let x = 0; x <= width; x += step) {
        const peak = getPeakAt(x);
        topPoints.push({ x, y: centerY - peak * amplitude });
        bottomPoints.push({ x, y: centerY + peak * amplitude });
    }
    
    // Ensure we have the last point
    if (topPoints.length === 0 || topPoints[topPoints.length - 1].x !== width) {
        const peak = getPeakAt(width);
        topPoints.push({ x: width, y: centerY - peak * amplitude });
        bottomPoints.push({ x: width, y: centerY + peak * amplitude });
    }
    
    // Draw smooth waveform using quadratic curves
    ctx.fillStyle = gradient;
    ctx.beginPath();
    
    if (topPoints.length > 1) {
        ctx.moveTo(topPoints[0].x, topPoints[0].y);
        
        // Draw top half with smooth curves
        for (let i = 1; i < topPoints.length - 1; i++) {
            const xc = (topPoints[i].x + topPoints[i + 1].x) / 2;
            const yc = (topPoints[i].y + topPoints[i + 1].y) / 2;
            ctx.quadraticCurveTo(topPoints[i].x, topPoints[i].y, xc, yc);
        }
        ctx.lineTo(topPoints[topPoints.length - 1].x, topPoints[topPoints.length - 1].y);
        
        // Draw bottom half (reversed) with smooth curves
        for (let i = bottomPoints.length - 1; i > 0; i--) {
            const xc = (bottomPoints[i].x + bottomPoints[i - 1].x) / 2;
            const yc = (bottomPoints[i].y + bottomPoints[i - 1].y) / 2;
            ctx.quadraticCurveTo(bottomPoints[i].x, bottomPoints[i].y, xc, yc);
        }
        ctx.lineTo(bottomPoints[0].x, bottomPoints[0].y);
    }
    
    ctx.closePath();
    ctx.fill();
}

/**
 * Render waveform as vertical bars (for zoomed-out view)
 * This method preserves transients better than smooth curves
 */
function renderBarWaveform(ctx, width, height, centerY, amplitude, getPeakAt, gradient) {
    ctx.fillStyle = gradient;
    
    for (let x = 0; x < width; x++) {
        const peak = getPeakAt(x);
        const barHeight = peak * amplitude;
        
        if (barHeight > 0.5) {
            ctx.fillRect(x, centerY - barHeight, 1, barHeight * 2);
        } else {
            // Draw thin line for very quiet parts
            ctx.fillRect(x, centerY - 0.5, 1, 1);
        }
    }
}

/**
 * Render waveform as vertical bars with section-aware coloring
 * Muted sections are rendered with inactive color
 */
function renderBarWaveformWithSections(ctx, width, height, centerY, amplitude, getPeakAt, 
    activeGradient, inactiveGradient, getTimeAtPixel, isTimeInMutedSection) {
    
    let currentMuted = null;
    let segmentStart = 0;
    
    // Render in segments to minimize fill style changes
    for (let x = 0; x <= width; x++) {
        const time = getTimeAtPixel(x);
        const isMuted = isTimeInMutedSection(time);
        
        // Check if mute state changed or we're at the end
        if (isMuted !== currentMuted || x === width) {
            // Render the previous segment if there is one
            if (currentMuted !== null && x > segmentStart) {
                ctx.fillStyle = currentMuted ? inactiveGradient : activeGradient;
                
                for (let sx = segmentStart; sx < x; sx++) {
                    const peak = getPeakAt(sx);
                    const barHeight = peak * amplitude;
                    
                    if (barHeight > 0.5) {
                        ctx.fillRect(sx, centerY - barHeight, 1, barHeight * 2);
                    } else {
                        ctx.fillRect(sx, centerY - 0.5, 1, 1);
                    }
                }
            }
            
            // Start new segment
            segmentStart = x;
            currentMuted = isMuted;
        }
    }
}

/**
 * Render smooth waveform with section-aware coloring
 * Muted sections are rendered with inactive color
 */
function renderSmoothWaveformWithSections(ctx, width, height, centerY, amplitude, getPeakAt, 
    zoom, activeGradient, inactiveGradient, getTimeAtPixel, isTimeInMutedSection) {
    
    // For smooth waveforms, we'll render the entire waveform first with active color,
    // then overlay muted sections. This is simpler than trying to split the bezier curves.
    
    // First, render the full waveform
    renderSmoothWaveform(ctx, width, height, centerY, amplitude, getPeakAt, zoom, activeGradient);
    
    // Now, render muted sections on top with inactive color
    // We need to find contiguous muted regions and re-render them
    let inMutedRegion = false;
    let regionStart = 0;
    
    const step = Math.max(1, Math.floor(1 / zoom));
    
    for (let x = 0; x <= width; x += step) {
        const time = getTimeAtPixel(x);
        const isMuted = isTimeInMutedSection(time);
        
        if (isMuted && !inMutedRegion) {
            // Starting a muted region
            regionStart = x;
            inMutedRegion = true;
        } else if (!isMuted && inMutedRegion) {
            // Ending a muted region - render it
            renderSmoothWaveformRegion(ctx, regionStart, x, height, centerY, amplitude, 
                getPeakAt, zoom, inactiveGradient);
            inMutedRegion = false;
        }
    }
    
    // Handle region that extends to the end
    if (inMutedRegion) {
        renderSmoothWaveformRegion(ctx, regionStart, width, height, centerY, amplitude, 
            getPeakAt, zoom, inactiveGradient);
    }
}

/**
 * Render a region of smooth waveform (for muted section overlay)
 */
function renderSmoothWaveformRegion(ctx, startX, endX, height, centerY, amplitude, getPeakAt, zoom, gradient) {
    const topPoints = [];
    const bottomPoints = [];
    
    const step = Math.max(1, Math.floor(1 / zoom));
    
    for (let x = startX; x <= endX; x += step) {
        const peak = getPeakAt(x);
        topPoints.push({ x, y: centerY - peak * amplitude });
        bottomPoints.push({ x, y: centerY + peak * amplitude });
    }
    
    // Ensure we have the last point
    if (topPoints.length === 0 || topPoints[topPoints.length - 1].x !== endX) {
        const peak = getPeakAt(endX);
        topPoints.push({ x: endX, y: centerY - peak * amplitude });
        bottomPoints.push({ x: endX, y: centerY + peak * amplitude });
    }
    
    if (topPoints.length < 2) return;
    
    // Draw smooth waveform using quadratic curves
    ctx.fillStyle = gradient;
    ctx.beginPath();
    
    ctx.moveTo(topPoints[0].x, topPoints[0].y);
    
    // Draw top half with smooth curves
    for (let i = 1; i < topPoints.length - 1; i++) {
        const xc = (topPoints[i].x + topPoints[i + 1].x) / 2;
        const yc = (topPoints[i].y + topPoints[i + 1].y) / 2;
        ctx.quadraticCurveTo(topPoints[i].x, topPoints[i].y, xc, yc);
    }
    ctx.lineTo(topPoints[topPoints.length - 1].x, topPoints[topPoints.length - 1].y);
    
    // Draw bottom half (reversed) with smooth curves
    for (let i = bottomPoints.length - 1; i > 0; i--) {
        const xc = (bottomPoints[i].x + bottomPoints[i - 1].x) / 2;
        const yc = (bottomPoints[i].y + bottomPoints[i - 1].y) / 2;
        ctx.quadraticCurveTo(bottomPoints[i].x, bottomPoints[i].y, xc, yc);
    }
    ctx.lineTo(bottomPoints[0].x, bottomPoints[0].y);
    
    ctx.closePath();
    ctx.fill();
}

/**
 * Adjust color alpha value
 */
function adjustColorAlpha(color, alpha) {
    // Convert hex to rgba
    if (color.startsWith('#')) {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
}

/**
 * Get color for a track based on audibility
 */
export function getTrackColor(isAudible) {
    return isAudible ? ACTIVE_COLOR : INACTIVE_COLOR;
}

/**
 * Calculate pixels per second based on zoom
 */
export function getPixelsPerSecond(basePixelsPerSecond, zoom) {
    return basePixelsPerSecond * zoom;
}

/**
 * Render section divider lines on waveform
 * Draws vertical lines at section boundaries (except at position 0)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height  
 * @param {Array} sections - Derived sections array from State
 * @param {Object} options - Rendering options
 */
export function renderSectionDividers(ctx, canvasWidth, canvasHeight, sections, options = {}) {
    if (!sections || sections.length <= 1) {
        return; // No dividers needed for 0 or 1 sections
    }
    
    const {
        zoom = 1,
        scrollOffset = 0,
        pixelsPerSecond = 100,
        offset = 0
    } = options;
    
    const pixelsPerSecondZoomed = pixelsPerSecond * zoom;
    
    ctx.strokeStyle = SECTION_DIVIDER_COLOR;
    ctx.lineWidth = 1;
    
    // Draw divider at the start of each section (except the first one at time 0)
    for (let i = 1; i < sections.length; i++) {
        const section = sections[i];
        
        // Convert section start time to screen X position
        // Account for timeline offset and scroll position
        const worldX = (section.start + offset) * pixelsPerSecondZoomed;
        const screenX = worldX - scrollOffset;
        
        // Skip if outside visible range
        if (screenX < 0 || screenX > canvasWidth) {
            continue;
        }
        
        // Draw vertical line
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, canvasHeight);
        ctx.stroke();
    }
}

/**
 * Render waveform for virtual sections (arrangement mode)
 * Draws slices of the source waveform at virtual timeline positions
 * 
 * @param {HTMLCanvasElement} canvas - Target canvas
 * @param {Float32Array|Array} peaks - Source peak values (0-1)
 * @param {Array} virtualSections - Array of virtual section objects
 * @param {Object} options - Rendering options
 */
export function renderVirtualWaveform(canvas, peaks, virtualSections, options = {}) {
    const {
        color = ACTIVE_COLOR,
        backgroundColor = BACKGROUND_COLOR,
        zoom = 1,
        scrollOffset = 0,
        sourceDuration = 0,  // Duration of source audio
        virtualDuration = 0, // Duration of virtual timeline
        pixelsPerSecond = 100,
        offset = 0,
        sectionMutes = null  // Object { sourceIndex: true } for muted sections
    } = options;

    const ctx = canvas.getContext('2d');
    const { width: canvasWidth, height } = canvas;
    
    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, height);
    
    if (!peaks || peaks.length === 0 || sourceDuration <= 0 || !virtualSections || virtualSections.length === 0) {
        return;
    }

    const pixelsPerSecondZoomed = pixelsPerSecond * zoom;
    const centerY = height / 2;
    const amplitude = height / 2 - 2;

    // Create gradients
    const activeGradient = ctx.createLinearGradient(0, 0, 0, height);
    activeGradient.addColorStop(0, adjustColorAlpha(color, 0.3));
    activeGradient.addColorStop(0.5, color);
    activeGradient.addColorStop(1, adjustColorAlpha(color, 0.3));
    
    const inactiveGradient = ctx.createLinearGradient(0, 0, 0, height);
    inactiveGradient.addColorStop(0, adjustColorAlpha(INACTIVE_COLOR, 0.3));
    inactiveGradient.addColorStop(0.5, INACTIVE_COLOR);
    inactiveGradient.addColorStop(1, adjustColorAlpha(INACTIVE_COLOR, 0.3));

    /**
     * Get peak value from source audio at a given source time
     */
    const getPeakAtSourceTime = (sourceTime) => {
        if (sourceTime < 0 || sourceTime >= sourceDuration) return 0;
        const index = Math.floor((sourceTime / sourceDuration) * peaks.length);
        return peaks[Math.min(index, peaks.length - 1)] || 0;
    };

    // Render each virtual section
    for (const section of virtualSections) {
        // Calculate screen X positions for this section
        const sectionStartX = (section.virtualStart + offset) * pixelsPerSecondZoomed - scrollOffset;
        const sectionEndX = (section.virtualEnd + offset) * pixelsPerSecondZoomed - scrollOffset;
        
        // Skip if section is completely outside visible range
        if (sectionEndX < 0 || sectionStartX > canvasWidth) {
            continue;
        }
        
        // Clamp to visible range
        const visibleStartX = Math.max(0, sectionStartX);
        const visibleEndX = Math.min(canvasWidth, sectionEndX);
        
        // Check if this section is muted
        const isMuted = sectionMutes && sectionMutes[section.sourceIndex];
        ctx.fillStyle = isMuted ? inactiveGradient : activeGradient;
        
        // Draw peaks for this section
        for (let x = Math.floor(visibleStartX); x < visibleEndX; x++) {
            // Convert screen X to virtual time
            const virtualTime = ((x + scrollOffset) / pixelsPerSecondZoomed) - offset;
            
            // Convert virtual time to source time for this section
            const offsetInSection = virtualTime - section.virtualStart;
            const sourceTime = section.sourceStart + offsetInSection;
            
            // Get peak at source time
            const peak = getPeakAtSourceTime(sourceTime);
            const barHeight = peak * amplitude;
            
            if (barHeight > 0.5) {
                ctx.fillRect(x, centerY - barHeight, 1, barHeight * 2);
            } else {
                ctx.fillRect(x, centerY - 0.5, 1, 1);
            }
        }
    }
    
    // Draw center line
    ctx.strokeStyle = adjustColorAlpha(color, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvasWidth, centerY);
    ctx.stroke();
}

/**
 * Render section dividers for virtual sections
 * Draws vertical lines at the start of each virtual section (except the first)
 */
export function renderVirtualSectionDividers(ctx, canvasWidth, canvasHeight, virtualSections, options = {}) {
    if (!virtualSections || virtualSections.length <= 1) {
        return;
    }
    
    const {
        zoom = 1,
        scrollOffset = 0,
        pixelsPerSecond = 100,
        offset = 0
    } = options;
    
    const pixelsPerSecondZoomed = pixelsPerSecond * zoom;
    
    ctx.strokeStyle = SECTION_DIVIDER_COLOR;
    ctx.lineWidth = 1;
    
    // Draw divider at the start of each section (except the first)
    for (let i = 1; i < virtualSections.length; i++) {
        const section = virtualSections[i];
        
        // Convert virtual time to screen X position
        const worldX = (section.virtualStart + offset) * pixelsPerSecondZoomed;
        const screenX = worldX - scrollOffset;
        
        // Skip if outside visible range
        if (screenX < 0 || screenX > canvasWidth) {
            continue;
        }
        
        // Draw vertical line
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, canvasHeight);
        ctx.stroke();
    }
}

export { ACTIVE_COLOR, INACTIVE_COLOR, BACKGROUND_COLOR, SECTION_DIVIDER_COLOR };

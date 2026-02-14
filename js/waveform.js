/**
 * Waveform Renderer
 * Canvas-based waveform visualization
 * 
 * Phase 2 note: Section dividers are only rendered when there's more than one section.
 * With the new "full song" default, waveforms render without dividers until
 * custom arrangements (Phase 3) define splits.
 */

import { getPreference } from './storage.js';

const ACTIVE_COLOR = '#00a8cc';
const INACTIVE_COLOR = '#4a4a4a';
const BACKGROUND_COLOR = '#1a1a1a';
const SECTION_DIVIDER_COLOR = 'rgba(255, 255, 0, 0.4)'; // Matches marker color

/**
 * Render waveform to a canvas
 * @deprecated Use renderWaveformGradient() instead - this function has precision issues at high zoom levels
 * @param {HTMLCanvasElement} canvas - Target canvas
 * @param {Float32Array|Array|{left: Float32Array, right: Float32Array|null, isStereo: boolean}} peaks - Peak values (0-1)
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
    
    // Clear canvas with transparency (CSS background color shows through)
    ctx.clearRect(0, 0, width, height);
    
    // Handle stereo format - extract left channel for this deprecated function
    const peaksArray = peaks?.left !== undefined ? peaks.left : peaks;
    
    if (!peaksArray || peaksArray.length === 0) return;

    // Calculate visible region
    const totalWidth = duration * pixelsPerSecond * zoom;
    const peaksPerPixel = peaksArray.length / totalWidth;
    
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
        const peak = peaksArray[Math.min(peakIndex, peaksArray.length - 1)] || 0;
        
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
 * Supports stereo (split L/R view) and mono waveforms
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
        muteSections = null,  // Phase 4: Array of { start, end, muted } for per-track time-based muting
        maxPeak = null  // Maximum peak value for normalization (from peaks data)
    } = options;
    
    // Check if enhanced waveform visibility is enabled
    const enhancedVisibility = getPreference('enhancedWaveformVisibility');
    
    // Calculate normalization factor: if maxPeak is low, scale up to fill display
    // Only apply when enhanced visibility is enabled and maxPeak is valid
    const normalizationFactor = (enhancedVisibility && maxPeak && maxPeak > 0 && maxPeak < 0.95)
        ? (1 / maxPeak)
        : 1;

    const ctx = canvas.getContext('2d');
    const { width: canvasWidth, height } = canvas;
    
    // Clear canvas with transparency (CSS background color shows through)
    ctx.clearRect(0, 0, canvasWidth, height);
    
    // Detect stereo vs mono/legacy format
    // New format: { left: Float32Array, right: Float32Array|null, isStereo: boolean }
    // Legacy format: Float32Array or Array
    const isStereoFormat = peaks && peaks.left !== undefined;
    const leftPeaks = isStereoFormat ? peaks.left : peaks;
    const rightPeaks = isStereoFormat ? peaks.right : null;
    const isStereo = isStereoFormat && peaks.isStereo && rightPeaks;
    
    if (!leftPeaks || leftPeaks.length === 0 || duration <= 0) return;

    // VIEWPORT-BASED APPROACH: Calculate using time instead of massive pixel values
    // This avoids floating-point precision loss at high zoom levels (>64K virtual pixels)
    const pixelsPerSecondZoomed = pixelsPerSecond * zoom;
    
    // Phase 4: Check for time-based mute sections
    const hasMuteSections = muteSections && muteSections.length > 0 &&
        muteSections.some(s => s.muted);
    
    // Helper to get time from pixel X (used for mute sections)
    const getTimeAtPixel = (pixelX) => {
        const screenPixel = scrollOffset + pixelX;
        return (screenPixel / pixelsPerSecondZoomed) - offset;
    };
    
    // Helper to check if a time is in a muted section
    const isTimeInMutedSection = (time) => {
        for (const section of muteSections) {
            if (time >= section.start && time < section.end) {
                return section.muted;
            }
        }
        return false;
    };
    
    /**
     * Pre-calculate peak index ranges for each pixel to ensure NO GAPS.
     * This is critical for click tracks where missing a single peak index
     * can cause a click to disappear entirely.
     * 
     * @param {Float32Array|Array} peaksArray - The peaks array to calculate ranges for
     */
    const calculatePeakRanges = (peaksArray) => {
        const ranges = new Array(canvasWidth);
        let lastValidEnd = 0;
        
        for (let x = 0; x < canvasWidth; x++) {
            const screenPixel = scrollOffset + x;
            const time = (screenPixel / pixelsPerSecondZoomed) - offset;
            
            if (time < 0 || time >= duration) {
                ranges[x] = null; // Out of bounds
                continue;
            }
            
            const timeRatio = time / duration;
            let startIndex = Math.floor(timeRatio * peaksArray.length);
            
            // End index is based on the next pixel's time position
            const nextTime = ((screenPixel + 1) / pixelsPerSecondZoomed) - offset;
            const nextTimeRatio = Math.min(nextTime / duration, 1);
            let endIndex = Math.floor(nextTimeRatio * peaksArray.length);
            
            // FIX GAPS: If there's a gap from the last valid pixel, extend backward
            // This ensures no peak indices are skipped between pixels
            if (x > 0 && ranges[x - 1] !== null && startIndex > lastValidEnd) {
                startIndex = lastValidEnd;
            }
            
            // Ensure we cover at least one index
            if (endIndex <= startIndex) {
                endIndex = startIndex + 1;
            }
            
            ranges[x] = { start: startIndex, end: endIndex };
            lastValidEnd = endIndex;
        }
        
        return ranges;
    };
    
    /**
     * Create a getPeakAt function for a specific peaks array and pre-calculated ranges
     * @param {Float32Array|Array} peaksArray - The peaks array
     * @param {Array} peakRanges - Pre-calculated ranges from calculatePeakRanges
     */
    const createGetPeakAt = (peaksArray, peakRanges) => {
        return (pixelX) => {
            const range = peakRanges[pixelX];
            if (!range) return 0;
            
            let peakMax = 0;
            for (let i = range.start; i < range.end && i < peaksArray.length; i++) {
                const p = peaksArray[i] || 0;
                if (p > peakMax) peakMax = p;
            }
            
            // Apply normalization factor for enhanced visibility
            // Clamp to 1.0 to prevent overflow
            return Math.min(peakMax * normalizationFactor, 1.0);
        };
    };
    
    /**
     * Create a gradient for a specific vertical region
     * @param {number} topY - Top of the region
     * @param {number} bottomY - Bottom of the region
     * @param {string} baseColor - The color to use
     */
    const createRegionGradient = (topY, bottomY, baseColor) => {
        const gradient = ctx.createLinearGradient(0, topY, 0, bottomY);
        gradient.addColorStop(0, adjustColorAlpha(baseColor, 0.3));
        gradient.addColorStop(0.5, baseColor);
        gradient.addColorStop(1, adjustColorAlpha(baseColor, 0.3));
        return gradient;
    };
    
    /**
     * Render a single channel's waveform
     * @param {Float32Array|Array} peaksArray - The peaks data for this channel
     * @param {number} centerY - Vertical center for this channel
     * @param {number} amplitude - Max amplitude (half-height) for this channel
     * @param {string} baseColor - Color to use
     */
    const renderChannel = (peaksArray, centerY, amplitude, baseColor) => {
        const peakRanges = calculatePeakRanges(peaksArray);
        const getPeakAt = createGetPeakAt(peaksArray, peakRanges);
        
        // Create gradients for this channel's region
        const topY = centerY - amplitude;
        const bottomY = centerY + amplitude;
        const gradient = createRegionGradient(topY, bottomY, baseColor);
        const inactiveGradient = createRegionGradient(topY, bottomY, INACTIVE_COLOR);
        
        if (hasMuteSections) {
            renderBarWaveformWithSections(ctx, canvasWidth, height, centerY, amplitude, 
                getPeakAt, gradient, inactiveGradient, getTimeAtPixel, isTimeInMutedSection);
        } else {
            renderBarWaveform(ctx, canvasWidth, height, centerY, amplitude, getPeakAt, gradient);
        }
        
        // Draw center line for this channel
        ctx.strokeStyle = adjustColorAlpha(baseColor, 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(canvasWidth, centerY);
        ctx.stroke();
    };
    
    if (isStereo) {
        // Stereo: render left channel in top half, right channel in bottom half
        const channelHeight = height / 2;
        const channelAmplitude = channelHeight / 2 - 1;
        
        // Left channel (top half)
        const leftCenterY = channelHeight / 2;
        renderChannel(leftPeaks, leftCenterY, channelAmplitude, color);
        
        // Right channel (bottom half)
        const rightCenterY = channelHeight + channelHeight / 2;
        renderChannel(rightPeaks, rightCenterY, channelAmplitude, color);
    } else {
        // Mono: render centered at full height (original behavior)
        const centerY = height / 2;
        const amplitude = height / 2 - 2;
        renderChannel(leftPeaks, centerY, amplitude, color);
    }
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
 * Render marker lines on waveform as visual guides
 * Draws vertical lines at marker positions from metadata (purely visual, not section boundaries)
 * 
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} canvasWidth - Canvas width
 * @param {number} canvasHeight - Canvas height  
 * @param {Array} markers - Markers array from metadata.markers
 * @param {Object} options - Rendering options
 */
export function renderMarkerLines(ctx, canvasWidth, canvasHeight, markers, options = {}) {
    if (!markers || markers.length === 0) {
        return;
    }
    
    const {
        zoom = 1,
        scrollOffset = 0,
        pixelsPerSecond = 100,
        offset = 0
    } = options;
    
    const pixelsPerSecondZoomed = pixelsPerSecond * zoom;
    
    ctx.strokeStyle = SECTION_DIVIDER_COLOR; // Same yellow color as before
    ctx.lineWidth = 1;
    
    // Draw line at each marker position (skip time 0 to avoid edge clutter)
    for (const marker of markers) {
        if (marker.start <= 0) continue; // Skip marker at time 0
        
        // Convert marker time to screen X position
        const worldX = (marker.start + offset) * pixelsPerSecondZoomed;
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

/**
 * Waveform Renderer
 * Canvas-based waveform visualization
 */

const ACTIVE_COLOR = '#00d4ff';
const INACTIVE_COLOR = '#4a4a4a';
const BACKGROUND_COLOR = '#1a1a1a';

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
        offset = 0  // Timeline offset for beat alignment
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
    
    if (useSmoothing) {
        // Zoomed in: use smooth curve rendering with interpolation
        renderSmoothWaveform(ctx, canvasWidth, height, centerY, amplitude, getPeakAtSmooth, zoom, gradient);
    } else {
        // Zoomed out: use bar rendering with max-pooling (preserves transients)
        renderBarWaveform(ctx, canvasWidth, height, centerY, amplitude, getPeakAt, gradient);
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

export { ACTIVE_COLOR, INACTIVE_COLOR, BACKGROUND_COLOR };

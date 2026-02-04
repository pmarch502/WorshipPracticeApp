/**
 * Timeline Renderer
 * Displays dual timeline: Beats (M:B) on top, Time (M:SS.mmm) on bottom
 */

import * as State from './state.js';
import { getBeatPositionsInRange, findNearestBeat, findNearestBeatInfo, getTempoAtTime, getTimeSigAtTime } from './metadata.js';
import { Knob } from './ui/knob.js';

const BASE_PIXELS_PER_SECOND = 100;

const TEXT_COLOR = '#dddddd';//'#b0b0b0';
const TICK_COLOR = '#505050';
const MAJOR_TICK_COLOR = '#707070';
const BACKGROUND_COLOR = '#242424';
const LOOP_REGION_COLOR = 'rgba(0, 212, 255, 0.2)';
const LOOP_BOUNDARY_COLOR = '#00d4ff';
const MARKER_COLOR = 'rgba(255, 255, 0, 0.1)';
//const MARKER_OUTLINE_COLOR = 'rgba(255, 255, 255, 0.4)';
const MARKER_TEXT_COLOR = 'rgba(255, 255, 255, 0.4)';

// Minimum pixels of movement to distinguish drag from click
const DRAG_THRESHOLD = 5;

class Timeline {
    constructor() {
        // Support both new dual canvas and legacy single canvas
        this.beatsCanvas = document.getElementById('timeline-beats-canvas');
        this.timeCanvas = document.getElementById('timeline-time-canvas');
        this.legacyCanvas = document.getElementById('timeline-canvas');
        
        // Use dual mode if both canvases exist
        this.dualMode = this.beatsCanvas && this.timeCanvas;
        
        if (this.dualMode) {
            this.beatsCtx = this.beatsCanvas.getContext('2d');
            this.timeCtx = this.timeCanvas.getContext('2d');
        } else if (this.legacyCanvas) {
            // Fallback to legacy single canvas mode
            this.legacyCtx = this.legacyCanvas.getContext('2d');
        }
        
        // New zoom knob control
        this.zoomKnobContainer = document.getElementById('zoom-knob-container');
        this.zoomFitBtn = document.getElementById('zoom-fit');
        this.zoomValueEl = document.getElementById('zoom-value');
        this.zoomKnob = null;
        
        this.scrollOffset = 0;
        this.resizeObserver = null;
        
        // Drag state for loop selection
        this.isDragging = false;
        this.isHandleDragging = false;
        this.dragHandle = null; // 'start' or 'end'
        this.dragStartX = 0;
        this.dragStartTime = 0;
        this.dragCurrentTime = 0;
        this.mouseDownX = 0;
        this.mouseDownY = 0;
        
        // Beat time tooltip for Ctrl+hover
        this.beatTimeTooltip = document.getElementById('beat-time-tooltip');
        this.lastBeatInfo = null; // Cache for Ctrl+click
        
        this.init();
        this.attachStateListeners();
        this.attachUIListeners();
    }

    init() {
        // Set up resize observer
        const targetElement = this.dualMode 
            ? this.beatsCanvas.parentElement 
            : this.legacyCanvas?.parentElement;
            
        if (targetElement) {
            this.resizeObserver = new ResizeObserver(() => {
                this.resize();
                this.render();
                this.updateZoomControls();
            });
            this.resizeObserver.observe(targetElement);
        }

        // Initial resize
        this.resize();
    }

    resize() {
        if (this.dualMode) {
            const container = this.beatsCanvas.parentElement;
            const rect = container.getBoundingClientRect();
            const canvasHeight = Math.floor((rect.height - 1) / 2); // -1 for divider
            
            this.beatsCanvas.width = rect.width;
            this.beatsCanvas.height = canvasHeight;
            this.timeCanvas.width = rect.width;
            this.timeCanvas.height = canvasHeight;
        } else if (this.legacyCanvas) {
            const rect = this.legacyCanvas.parentElement.getBoundingClientRect();
            this.legacyCanvas.width = rect.width;
            this.legacyCanvas.height = 30;
        }
    }

    attachStateListeners() {
        State.subscribe(State.Events.SONG_SWITCHED, () => {
            // Delay zoom control update to ensure DOM layout is complete
            requestAnimationFrame(() => this.updateZoomControls());
            this.render();
        });

        State.subscribe(State.Events.TIMELINE_UPDATED, ({ updates }) => {
            if ('zoom' in updates) {
                this.updateZoomKnob(updates.zoom);
                this.updateZoomDisplay(updates.zoom);
            }
            this.render();
        });

        State.subscribe(State.Events.TRANSPORT_UPDATED, () => {
            // Re-render when tempo or time signature changes
            this.render();
        });

        State.subscribe(State.Events.TRACK_ADDED, () => {
            this.updateZoomControls();
            this.render();
        });

        State.subscribe(State.Events.TRACK_REMOVED, () => {
            this.render();
        });

        State.subscribe(State.Events.STATE_LOADED, () => {
            // Delay zoom control update to ensure DOM layout is complete
            requestAnimationFrame(() => this.updateZoomControls());
            this.render();
        });

        // Sync scroll with waveform panel
        State.subscribe('waveformScroll', (scrollLeft) => {
            this.scrollOffset = scrollLeft;
            this.render();
        });

        // Re-render when loop state changes
        State.subscribe(State.Events.LOOP_UPDATED, () => {
            this.render();
        });
        
        // Re-render when arrangement changes
        State.subscribe(State.Events.ARRANGEMENT_CHANGED, () => {
            // Delay zoom control update to ensure DOM layout is complete
            requestAnimationFrame(() => this.updateZoomControls());
            this.render();
        });
    }

    attachUIListeners() {
        // Initialize zoom knob
        this.initZoomKnob();

        // Fit to window button
        if (this.zoomFitBtn) {
            this.zoomFitBtn.addEventListener('click', () => {
                this.fitToWindow();
            });
        }

        // Mouse interaction for seeking and loop selection
        if (this.dualMode) {
            this.beatsCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
            this.timeCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
            this.beatsCanvas.addEventListener('mousemove', (e) => this.handleMouseMoveHover(e));
            this.timeCanvas.addEventListener('mousemove', (e) => this.handleMouseMoveHover(e));
            this.beatsCanvas.addEventListener('mouseleave', () => this.hideBeatTimeTooltip());
            this.timeCanvas.addEventListener('mouseleave', () => this.hideBeatTimeTooltip());
        } else if (this.legacyCanvas) {
            this.legacyCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
            this.legacyCanvas.addEventListener('mousemove', (e) => this.handleMouseMoveHover(e));
            this.legacyCanvas.addEventListener('mouseleave', () => this.hideBeatTimeTooltip());
        }

        // Global mouse events for drag handling
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        
        // Hide tooltip when Ctrl is released
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') {
                this.hideBeatTimeTooltip();
            }
        });
    }

    /**
     * Initialize the zoom knob control
     * Uses logarithmic mapping for natural zoom feel
     * Range: 1% to 400% (stored as 0.01 to 4.0 zoom multiplier)
     * Default: 100% (1.0 zoom multiplier)
     * 
     * Logarithmic mapping ensures equal knob rotation = equal perceived zoom change
     * - Knob at min (0): zoom = 1% (0.01)
     * - Knob at ~75%: zoom = 100% (1.0)  
     * - Knob at max (100): zoom = 400% (4.0)
     */
    initZoomKnob() {
        if (!this.zoomKnobContainer) return;
        
        // Knob uses 0-100 range internally, we map logarithmically to zoom
        // 100% zoom should be the default, which maps to knob value ~75
        const defaultKnobValue = this.zoomToKnobValue(1.0);
        
        this.zoomKnob = new Knob(this.zoomKnobContainer, {
            min: 0,
            max: 100,
            value: defaultKnobValue,
            step: 0.5,
            size: 28,
            bipolar: false,
            defaultValue: 50, // Double-click resets to center (displays 200%)
            onChange: (knobValue) => {
                const zoom = this.knobValueToZoom(knobValue);
                State.updateTimeline({ zoom });
                this.updateZoomDisplay(zoom);
            }
        });
    }

    /**
     * Convert knob value (0-100) to zoom multiplier (0.01-4.0) using logarithmic scale
     * This makes the knob feel natural - equal rotation = equal perceived zoom change
     */
    knobValueToZoom(knobValue) {
        // Knob range: 0 to 100
        // Zoom range: 0.01 (1%) to 4.0 (400%)
        const minZoom = 0.01;
        const maxZoom = 4.0;
        
        // Clamp knob value to valid range
        knobValue = Math.max(0, Math.min(100, knobValue));
        
        // Normalize knob value to 0-1
        const normalized = knobValue / 100;
        
        // Logarithmic mapping: zoom = minZoom * (maxZoom/minZoom)^normalized
        const zoom = minZoom * Math.pow(maxZoom / minZoom, normalized);
        
        return zoom;
    }

    /**
     * Convert zoom multiplier (0.01-4.0) to knob value (0-100) using logarithmic scale
     */
    zoomToKnobValue(zoom) {
        const minZoom = 0.01;
        const maxZoom = 4.0;
        
        // Clamp zoom to valid range
        zoom = Math.max(minZoom, Math.min(maxZoom, zoom));
        
        // Inverse of logarithmic mapping: normalized = log(zoom/minZoom) / log(maxZoom/minZoom)
        const normalized = Math.log(zoom / minZoom) / Math.log(maxZoom / minZoom);
        
        // Convert to knob range 0-100
        return normalized * 100;
    }

    /**
     * Update the zoom knob to reflect current state
     */
    updateZoomKnob(zoom) {
        if (!this.zoomKnob) return;
        
        const knobValue = this.zoomToKnobValue(zoom);
        this.zoomKnob.setValue(knobValue, false); // false = don't trigger onChange
    }

    /**
     * Convert pixel X position to time in seconds
     */
    pixelToTime(pixelX) {
        const song = State.getActiveSong();
        if (!song) return 0;
        
        const zoom = song.timeline.zoom || 1;
        const offset = song.timeline.offset || 0;
        
        let time = pixelX / (BASE_PIXELS_PER_SECOND * zoom);
        time -= offset;
        return Math.max(0, time);
    }

    /**
     * Convert time in seconds to pixel X position
     */
    timeToPixel(time) {
        const song = State.getActiveSong();
        if (!song) return 0;
        
        const zoom = song.timeline.zoom || 1;
        const offset = song.timeline.offset || 0;
        
        return (time + offset) * BASE_PIXELS_PER_SECOND * zoom - this.scrollOffset;
    }

    /**
     * Snap time to nearest beat (accounts for variable tempo and time signature)
     */
    snapToBeat(time) {
        const song = State.getActiveSong();
        if (!song) return time;
        
        const tempos = song.metadata?.tempos;
        const timeSigs = song.metadata?.['time-sigs'];
        
        return findNearestBeat(time, tempos, timeSigs);
    }

    /**
     * Check if mouse is near a loop handle
     * Returns 'start', 'end', or null
     */
    getHandleAtPosition(clientX, canvasRect) {
        const song = State.getActiveSong();
        if (!song) return null;
        
        const { loopStart, loopEnd } = song.transport;
        if (loopStart === null || loopEnd === null) return null;
        
        const mouseX = clientX - canvasRect.left;
        const startX = this.timeToPixel(loopStart);
        const endX = this.timeToPixel(loopEnd);
        
        const handleThreshold = 8; // pixels
        
        if (Math.abs(mouseX - startX) <= handleThreshold) {
            return 'start';
        }
        if (Math.abs(mouseX - endX) <= handleThreshold) {
            return 'end';
        }
        
        return null;
    }

    /**
     * Update cursor based on hover position and show beat time tooltip if Ctrl is held
     */
    handleMouseMoveHover(e) {
        const rect = e.target.getBoundingClientRect();
        const handle = this.getHandleAtPosition(e.clientX, rect);
        
        if (handle) {
            e.target.style.cursor = 'ew-resize';
        } else {
            e.target.style.cursor = 'default';
        }
        
        // Show beat time tooltip when Ctrl is held
        if (e.ctrlKey) {
            const song = State.getActiveSong();
            if (!song) return;
            
            const mouseX = e.clientX - rect.left + this.scrollOffset;
            const time = this.pixelToTime(mouseX);
            const beatInfo = findNearestBeatInfo(time, song.metadata?.tempos, song.metadata?.['time-sigs']);
            
            this.lastBeatInfo = beatInfo; // Cache for potential Ctrl+click
            this.showBeatTimeTooltip(e.clientX, e.clientY, beatInfo);
        } else {
            this.hideBeatTimeTooltip();
        }
    }

    handleMouseDown(e) {
        const song = State.getActiveSong();
        if (!song) return;
        
        const rect = e.target.getBoundingClientRect();
        this.mouseDownX = e.clientX;
        this.mouseDownY = e.clientY;
        this.activeCanvas = e.target;
        
        // Check if clicking on a loop handle
        const handle = this.getHandleAtPosition(e.clientX, rect);
        
        if (handle) {
            // Start handle dragging
            this.isHandleDragging = true;
            this.dragHandle = handle;
            e.preventDefault();
            return;
        }
        
        // Prepare for potential drag (loop selection) or click (seek)
        const clickX = e.clientX - rect.left + this.scrollOffset;
        this.dragStartTime = this.pixelToTime(clickX);
        this.dragCurrentTime = this.dragStartTime;
        
        e.preventDefault();
    }

    handleMouseMove(e) {
        if (!this.activeCanvas) return;
        
        const rect = this.activeCanvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left + this.scrollOffset;
        const currentTime = this.pixelToTime(currentX);
        
        if (this.isHandleDragging) {
            // Dragging a loop handle
            const song = State.getActiveSong();
            if (!song) return;
            
            const { loopStart, loopEnd } = song.transport;
            
            if (this.dragHandle === 'start') {
                // Can't go past end handle (leave at least a small gap)
                const newStart = Math.min(currentTime, loopEnd - 0.01);
                State.updateLoop({ start: Math.max(0, newStart) });
            } else if (this.dragHandle === 'end') {
                // Can't go before start handle
                const newEnd = Math.max(currentTime, loopStart + 0.01);
                State.updateLoop({ end: newEnd });
            }
            return;
        }
        
        // Check if we've moved enough to start dragging (loop selection)
        const distance = Math.sqrt(
            Math.pow(e.clientX - this.mouseDownX, 2) + 
            Math.pow(e.clientY - this.mouseDownY, 2)
        );
        
        if (!this.isDragging && distance > DRAG_THRESHOLD) {
            this.isDragging = true;
        }
        
        if (this.isDragging) {
            this.dragCurrentTime = currentTime;
            
            // Update loop region in real-time during drag
            const start = Math.min(this.dragStartTime, this.dragCurrentTime);
            const end = Math.max(this.dragStartTime, this.dragCurrentTime);
            
            State.updateLoop({ start, end, enabled: true });
        }
    }

    handleMouseUp(e) {
        if (!this.activeCanvas) return;
        
        const song = State.getActiveSong();
        if (!song) {
            this.resetDragState();
            return;
        }
        
        if (this.isHandleDragging) {
            // Snap the dragged handle to beat
            const { loopStart, loopEnd } = song.transport;
            
            if (this.dragHandle === 'start') {
                const snapped = this.snapToBeat(loopStart);
                // Ensure start doesn't cross end
                State.updateLoop({ start: Math.min(snapped, loopEnd - 0.01) });
            } else if (this.dragHandle === 'end') {
                const snapped = this.snapToBeat(loopEnd);
                // Ensure end doesn't cross start
                State.updateLoop({ end: Math.max(snapped, loopStart + 0.01) });
            }
            
            this.resetDragState();
            return;
        }
        
        if (this.isDragging) {
            // Finished dragging - snap both loop points to beats
            let start = Math.min(this.dragStartTime, this.dragCurrentTime);
            let end = Math.max(this.dragStartTime, this.dragCurrentTime);
            
            start = this.snapToBeat(start);
            end = this.snapToBeat(end);
            
            // Ensure they don't end up at the same position after snapping
            if (start >= end) {
                const tempos = song.metadata?.tempos;
                const tempo = getTempoAtTime(start, tempos);
                const secondsPerBeat = 60 / tempo;
                end = start + secondsPerBeat;
            }
            
            State.updateLoop({ start, end, enabled: true });
        } else {
            // It was a click (not a drag)
            const rect = this.activeCanvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left + this.scrollOffset;
            
            if (e.ctrlKey) {
                // Ctrl+click: copy exact beat time to clipboard
                const time = this.pixelToTime(clickX);
                const beatInfo = findNearestBeatInfo(time, song.metadata?.tempos, song.metadata?.['time-sigs']);
                this.copyBeatTimeToClipboard(beatInfo, e.clientX, e.clientY);
            } else {
                // Regular click: seek to position, snapped to nearest beat
                const position = this.snapToBeat(this.pixelToTime(clickX));
                
                if (window.audioEngine) {
                    window.audioEngine.seek(position);
                } else {
                    State.setPosition(position);
                }
            }
        }
        
        this.resetDragState();
    }

    resetDragState() {
        this.isDragging = false;
        this.isHandleDragging = false;
        this.dragHandle = null;
        this.activeCanvas = null;
    }

    /**
     * Format time with high precision (up to 15 decimal places, no trailing zeros)
     */
    formatExactTime(seconds) {
        // Use toPrecision(15) for max precision, then convert back to number to strip trailing zeros
        return parseFloat(seconds.toPrecision(15)).toString();
    }

    /**
     * Show beat time tooltip at cursor position
     */
    showBeatTimeTooltip(clientX, clientY, beatInfo) {
        if (!this.beatTimeTooltip) return;
        
        const timeStr = this.formatExactTime(beatInfo.time);
        const beatStr = `M${beatInfo.measure}:B${beatInfo.beat}`;
        
        this.beatTimeTooltip.innerHTML = `${timeStr}<span class="beat-position">(${beatStr})</span>`;
        this.beatTimeTooltip.classList.remove('hidden', 'copied');
        
        // Position tooltip near cursor (offset slightly to avoid covering the pointer)
        this.beatTimeTooltip.style.left = `${clientX + 12}px`;
        this.beatTimeTooltip.style.top = `${clientY - 30}px`;
    }

    /**
     * Hide beat time tooltip
     */
    hideBeatTimeTooltip() {
        if (!this.beatTimeTooltip) return;
        this.beatTimeTooltip.classList.add('hidden');
        this.lastBeatInfo = null;
    }

    /**
     * Copy beat time to clipboard and show feedback
     */
    async copyBeatTimeToClipboard(beatInfo, clientX, clientY) {
        const timeStr = this.formatExactTime(beatInfo.time);
        
        try {
            await navigator.clipboard.writeText(timeStr);
            
            // Show "Copied!" feedback in tooltip
            if (this.beatTimeTooltip) {
                this.beatTimeTooltip.innerHTML = `Copied: ${timeStr}`;
                this.beatTimeTooltip.classList.remove('hidden');
                this.beatTimeTooltip.classList.add('copied');
                this.beatTimeTooltip.style.left = `${clientX + 12}px`;
                this.beatTimeTooltip.style.top = `${clientY - 30}px`;
                
                // Hide after a short delay
                setTimeout(() => {
                    this.beatTimeTooltip.classList.add('hidden');
                    this.beatTimeTooltip.classList.remove('copied');
                }, 1500);
            }
        } catch (err) {
            console.error('Failed to copy beat time to clipboard:', err);
        }
    }

    /**
     * Update zoom controls to reflect current state
     * The knob range is fixed at 1-400%, but we clamp values to that range
     */
    updateZoomControls() {
        const song = State.getActiveSong();
        let zoom = song?.timeline?.zoom;
        
        // If zoom is null, calculate fit-to-window zoom dynamically (don't persist)
        // This allows auto-fit to respond to window resizing
        if (zoom === null) {
            const maxDuration = State.getMaxDuration();
            if (!maxDuration || maxDuration === 0) {
                return; // Don't update display yet - wait for tracks to load
            }
            zoom = this.calculateFitZoom();
        }
        
        // Clamp zoom to our fixed range (1% to 400% = 0.01 to 4.0)
        zoom = Math.max(0.01, Math.min(4.0, zoom));
        
        this.updateZoomKnob(zoom);
        this.updateZoomDisplay(zoom);
    }

    updateZoomDisplay(zoom) {
        if (this.zoomValueEl) {
            // Display a "perceptual" zoom value that's linear with knob rotation
            // This makes the numbers feel proportional to how much you turn the knob,
            // even though the actual zoom uses a logarithmic scale for smooth feel
            // Formula: 0→1, 50→200, 100→400
            const knobValue = this.zoomToKnobValue(zoom);
            const displayValue = Math.round(knobValue * 4) || 1;
            this.zoomValueEl.textContent = `${displayValue}%`;
        }
    }

    calculateFitZoom() {
        const maxDuration = State.getMaxDuration();
        if (!maxDuration || maxDuration === 0) {
            return 1; // Default zoom if no tracks
        }
        
        // Get viewport width (waveform scroll area width)
        const waveformScrollArea = document.getElementById('waveform-scroll-area');
        const viewportWidth = waveformScrollArea ? waveformScrollArea.clientWidth - 20 : 800;
        
        // Fit entire song at ~90% of viewport width
        const fitZoom = (viewportWidth * 0.9) / (maxDuration * BASE_PIXELS_PER_SECOND);
        
        // Clamp to our fixed range (1% to 400% = 0.01 to 4.0)
        return Math.max(0.01, Math.min(4.0, fitZoom));
    }

    fitToWindow() {
        const zoom = this.calculateFitZoom();
        State.updateTimeline({ zoom });
    }

    render() {
        if (this.dualMode) {
            this.renderBeatsTimeline();
            this.renderTimeTimeline();
        } else if (this.legacyCtx) {
            // Legacy single timeline - render beats mode by default
            this.renderLegacyTimeline();
        }
    }

    /**
     * Render markers on the beats timeline
     * Markers appear as upside-down triangles with labels
     * 
     * Phase 2 update: Markers are now always visual-only from metadata.
     * For custom arrangements (future), we'll render virtual section boundaries separately.
     * For now, just render the original markers from metadata as visual guides.
     */
    renderMarkers(ctx, canvas) {
        const song = State.getActiveSong();
        if (!song) return;
        
        // Phase 2: Always render markers from metadata as visual guides
        // Markers no longer define section boundaries, they're purely informational
        const markers = song.metadata?.markers;
        if (!markers || markers.length === 0) return;
        const markersToRender = markers;
        
        const triangleWidth = 20;
        const triangleHeight = 20;
        const labelPadding = 5;
        const labelGap = 2; // Gap between triangle and label
        
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        
        for (const marker of markersToRender) {
            // Skip label/triangle rendering for unlabeled markers
            if (marker.unlabeled) continue;
            
            const x = this.timeToPixel(marker.start);
            
            // Skip if outside visible range (with some margin for label)
            if (x < -100 || x > canvas.width + 10) continue;
            
            // Draw upside-down triangle (apex pointing down, touching dividing line)
            const triangleTop = canvas.height - triangleHeight;
            ctx.fillStyle = MARKER_COLOR;
            //ctx.strokeStyle = MARKER_OUTLINE_COLOR;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - triangleWidth / 2, triangleTop); // Top-left
            ctx.lineTo(x + triangleWidth / 2, triangleTop); // Top-right
            ctx.lineTo(x, canvas.height);                    // Bottom center (apex) - touches dividing line
            ctx.closePath();
            ctx.fill();
            //ctx.stroke();
            
            // Measure label text
            const label = marker.name || '';
            const textMetrics = ctx.measureText(label);
            const labelWidth = textMetrics.width + labelPadding * 2;
            const labelHeight = 15; // Approximate height for 12px font
            
            // Draw label background (to the right of triangle, aligned with triangle top)
            const labelX = x + triangleWidth / 2 + labelGap;
            const labelY = triangleTop;
            
            ctx.fillStyle = MARKER_COLOR;
            ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
            
            // Draw label text
            ctx.fillStyle = MARKER_TEXT_COLOR;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(label, labelX + labelPadding, labelY + (labelPadding * 0.5));
        }
    }

    /**
     * Render loop region on a canvas
     */
    renderLoopRegion(ctx, canvas) {
        const song = State.getActiveSong();
        if (!song) return;
        
        const { loopStart, loopEnd } = song.transport;
        if (loopStart === null || loopEnd === null) return;
        
        const startX = this.timeToPixel(loopStart);
        const endX = this.timeToPixel(loopEnd);
        
        // Only render if visible
        if (endX < 0 || startX > canvas.width) return;
        
        const visibleStartX = Math.max(0, startX);
        const visibleEndX = Math.min(canvas.width, endX);
        
        // Draw shaded region
        ctx.fillStyle = LOOP_REGION_COLOR;
        ctx.fillRect(visibleStartX, 0, visibleEndX - visibleStartX, canvas.height);
        
        // Draw boundary lines
        ctx.strokeStyle = LOOP_BOUNDARY_COLOR;
        ctx.lineWidth = 2;
        
        if (startX >= 0 && startX <= canvas.width) {
            ctx.beginPath();
            ctx.moveTo(startX, 0);
            ctx.lineTo(startX, canvas.height);
            ctx.stroke();
        }
        
        if (endX >= 0 && endX <= canvas.width) {
            ctx.beginPath();
            ctx.moveTo(endX, 0);
            ctx.lineTo(endX, canvas.height);
            ctx.stroke();
        }
        
        ctx.lineWidth = 1;
    }

    /**
     * Render the beats timeline (M:B format)
     * Shows measure:beat labels (e.g., "1:1", "4:2", "8:3")
     * Accounts for variable tempo and time signature changes from metadata
     * Uses virtual timeline when an arrangement is active
     */
    renderBeatsTimeline() {
        const canvas = this.beatsCanvas;
        const ctx = this.beatsCtx;
        
        // Clear canvas
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const song = State.getActiveSong();
        if (!song) return;
        
        const zoom = song.timeline?.zoom || 1;
        const offset = song.timeline?.offset || 0;
        const tempos = song.metadata?.tempos;
        const timeSigs = song.metadata?.['time-sigs'];
        
        const pixelsPerSecond = BASE_PIXELS_PER_SECOND * zoom;
        
        // Calculate visible time range
        const startTime = Math.max(0, this.scrollOffset / pixelsPerSecond - offset);
        const endTime = (this.scrollOffset + canvas.width) / pixelsPerSecond - offset;
        
        // Get beat positions - use pre-calculated if available, otherwise calculate in range
        let beatPositions;
        if (song.beatPositions && song.beatPositions.length > 0) {
            // Filter pre-calculated beats to visible range
            beatPositions = song.beatPositions.filter(b => b.time >= startTime && b.time <= endTime);
        } else {
            beatPositions = getBeatPositionsInRange(startTime, endTime, tempos, timeSigs);
        }
        
        // Determine labeling density based on zoom level
        // Use the tempo and time signature at the center of the view to estimate spacing
        const centerTime = (startTime + endTime) / 2;
        const centerTempo = getTempoAtTime(centerTime, tempos);
        const centerTimeSig = getTimeSigAtTime(centerTime, timeSigs);
        
        const [beatsPerMeasure] = centerTimeSig.split('/').map(Number);
        const pixelsPerBeat = pixelsPerSecond * (60 / centerTempo);
        const pixelsPerMeasure = pixelsPerBeat * beatsPerMeasure;
        
        let showSubBeats = pixelsPerBeat >= 40;
        let labelEveryNMeasures = 1;
        if (pixelsPerMeasure < 40) {
            labelEveryNMeasures = Math.ceil(40 / pixelsPerMeasure);
        }
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        
        for (const { time, measure, beat, isMeasureStart } of beatPositions) {
            const x = (time + offset) * pixelsPerSecond - this.scrollOffset;
            
            if (x < -50 || x > canvas.width + 50) continue;
            
            // Draw tick
            let tickHeight;
            if (isMeasureStart) {
                tickHeight = canvas.height * 0.6;
                ctx.strokeStyle = MAJOR_TICK_COLOR;
            } else {
                tickHeight = canvas.height * 0.3;
                ctx.strokeStyle = TICK_COLOR;
            }
            
            ctx.beginPath();
            ctx.moveTo(x, canvas.height);
            ctx.lineTo(x, canvas.height - tickHeight);
            ctx.stroke();
            
            // Draw label
            if (isMeasureStart && (measure % labelEveryNMeasures === 0 || measure === 1)) {
                ctx.fillStyle = TEXT_COLOR;
                ctx.fillText(`${measure}:1`, x, canvas.height - tickHeight - 2);
            } else if (showSubBeats && !isMeasureStart) {
                ctx.fillStyle = '#aaaaaa';//'#606060';
                ctx.fillText(`${measure}:${beat}`, x, canvas.height - tickHeight - 2);
            }
        }
        
        // Render markers
        this.renderMarkers(ctx, canvas);
        
        // Render loop region on top
        this.renderLoopRegion(ctx, canvas);
    }

    /**
     * Render the time timeline (M:SS.mmm format)
     * Shows time labels (e.g., "0:00.0", "1:30.5", "3:00.0")
     */
    renderTimeTimeline() {
        const canvas = this.timeCanvas;
        const ctx = this.timeCtx;
        
        // Clear canvas
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const song = State.getActiveSong();
        if (!song) return;
        
        const zoom = song.timeline?.zoom || 1;
        const offset = song.timeline?.offset || 0;
        
        const pixelsPerSecond = BASE_PIXELS_PER_SECOND * zoom;
        
        // Determine tick interval based on zoom
        let majorInterval, minorInterval;
        if (pixelsPerSecond >= 100) {
            majorInterval = 1; // 1 second
            minorInterval = 0.1;
        } else if (pixelsPerSecond >= 50) {
            majorInterval = 2; // 2 seconds
            minorInterval = 0.1;
        } else if (pixelsPerSecond >= 30) {
            majorInterval = 5;// 5 seconds
            minorInterval = 1;
        } else if (pixelsPerSecond >= 20) {
            majorInterval = 7;// 7 seconds
            minorInterval = 1;
        } else if (pixelsPerSecond >= 10) {
            majorInterval = 10;// 10 seconds
            minorInterval = 1;
        } else if (pixelsPerSecond >= 5) {
            majorInterval = 15;// 15 seconds
            minorInterval = 1;
        } else if (pixelsPerSecond >= 2.5) {
            majorInterval = 30;// 30 seconds
            minorInterval = 1;
        } else {
            majorInterval = 60;// 60 seconds
            minorInterval = 1;
        }
        
        // Calculate visible range
        const startTime = this.scrollOffset / pixelsPerSecond - offset;
        const endTime = (this.scrollOffset + canvas.width) / pixelsPerSecond - offset;
        
        // Round to start of interval
        const firstMajor = Math.floor(startTime / majorInterval) * majorInterval;
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        
        for (let time = firstMajor; time <= endTime + majorInterval; time += minorInterval) {
            if (time < 0) continue;
            
            const x = (time + offset) * pixelsPerSecond - this.scrollOffset;
            if (x < -50 || x > canvas.width + 50) continue;
            
            const isMajor = Math.abs(time % majorInterval) < 0.001 || 
                           Math.abs(time % majorInterval - majorInterval) < 0.001;
            
            // Draw tick
            ctx.strokeStyle = isMajor ? MAJOR_TICK_COLOR : TICK_COLOR;
            const tickHeight = isMajor ? canvas.height * 0.5 : canvas.height * 0.25;
            
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, tickHeight);
            ctx.stroke();
            
            // Draw label for major ticks
            if (isMajor) {
                ctx.fillStyle = TEXT_COLOR;
                ctx.fillText(this.formatTime(time), x, tickHeight + 2);
            }
        }
        
        // Render loop region on top
        this.renderLoopRegion(ctx, canvas);
    }

    /**
     * Legacy single timeline renderer (fallback)
     * Accounts for variable tempo and time signature changes from metadata
     */
    renderLegacyTimeline() {
        const canvas = this.legacyCanvas;
        const ctx = this.legacyCtx;
        
        ctx.fillStyle = BACKGROUND_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Just render beats mode for legacy
        const song = State.getActiveSong();
        if (!song) return;
        
        const zoom = song.timeline?.zoom || 1;
        const tempos = song.metadata?.tempos;
        const timeSigs = song.metadata?.['time-sigs'];
        
        const pixelsPerSecond = BASE_PIXELS_PER_SECOND * zoom;
        
        const startTime = Math.max(0, this.scrollOffset / pixelsPerSecond);
        const endTime = (this.scrollOffset + canvas.width) / pixelsPerSecond;
        
        // Get beat positions for visible range (accounts for variable tempo and time signature)
        const beatPositions = getBeatPositionsInRange(startTime, endTime, tempos, timeSigs);
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        
        for (const { time, measure, isMeasureStart } of beatPositions) {
            // Only render measure starts in legacy mode
            if (!isMeasureStart) continue;
            
            const x = time * pixelsPerSecond - this.scrollOffset;
            
            if (x < -50 || x > canvas.width + 50) continue;
            
            ctx.strokeStyle = MAJOR_TICK_COLOR;
            ctx.beginPath();
            ctx.moveTo(x, canvas.height);
            ctx.lineTo(x, canvas.height - 15);
            ctx.stroke();
            
            ctx.fillStyle = TEXT_COLOR;
            ctx.fillText(measure.toString(), x, 2);
        }
    }

    /**
     * Format time as M:SS.m (minutes:seconds.tenths)
     */
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const tenths = Math.floor((seconds % 1) * 10);
        
        return `${minutes}:${secs.toString().padStart(2, '0')}.${tenths}`;
    }

    setScrollOffset(offset) {
        this.scrollOffset = offset;
        this.render();
    }
}

// Singleton instance
let timelineInstance = null;

export function getTimeline() {
    if (!timelineInstance) {
        timelineInstance = new Timeline();
    }
    return timelineInstance;
}

export default Timeline;

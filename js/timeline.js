/**
 * Timeline Renderer
 * Displays dual timeline: Beats (M:B) on top, Time (M:SS.mmm) on bottom
 */

import * as State from './state.js';
import { getBeatPositionsInRange, findNearestBeat, getTempoAtTime, getTimeSigAtTime } from './metadata.js';

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
        
        this.zoomSlider = document.getElementById('zoom-slider');
        this.zoomInBtn = document.getElementById('zoom-in');
        this.zoomOutBtn = document.getElementById('zoom-out');
        this.zoomFitBtn = document.getElementById('zoom-fit');
        this.zoomValueEl = document.getElementById('zoom-value');
        
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
            this.updateZoomSlider();
            this.render();
        });

        State.subscribe(State.Events.TIMELINE_UPDATED, ({ updates }) => {
            if ('zoom' in updates) {
                this.zoomSlider.value = updates.zoom;
                this.updateZoomDisplay(updates.zoom);
            }
            this.render();
        });

        State.subscribe(State.Events.TRANSPORT_UPDATED, () => {
            // Re-render when tempo or time signature changes
            this.render();
        });

        State.subscribe(State.Events.TRACK_ADDED, () => {
            this.render();
        });

        State.subscribe(State.Events.TRACK_REMOVED, () => {
            this.render();
        });

        State.subscribe(State.Events.STATE_LOADED, () => {
            this.updateZoomSlider();
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
    }

    attachUIListeners() {
        // Zoom controls
        if (this.zoomSlider) {
            this.zoomSlider.addEventListener('input', () => {
                const zoom = parseFloat(this.zoomSlider.value);
                State.updateTimeline({ zoom });
                this.updateZoomDisplay(zoom);
            });
        }

        if (this.zoomInBtn) {
            this.zoomInBtn.addEventListener('click', () => {
                const song = State.getActiveSong();
                if (!song) return;
                const currentZoom = song.timeline.zoom || 1;
                const { maxZoom } = this.calculateZoomLimits();
                const newZoom = Math.min(maxZoom, currentZoom * 1.25);
                State.updateTimeline({ zoom: newZoom });
            });
        }

        if (this.zoomOutBtn) {
            this.zoomOutBtn.addEventListener('click', () => {
                const song = State.getActiveSong();
                if (!song) return;
                const currentZoom = song.timeline.zoom || 1;
                const { minZoom } = this.calculateZoomLimits();
                const newZoom = Math.max(minZoom, currentZoom / 1.25);
                State.updateTimeline({ zoom: newZoom });
            });
        }

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
        } else if (this.legacyCanvas) {
            this.legacyCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
            this.legacyCanvas.addEventListener('mousemove', (e) => this.handleMouseMoveHover(e));
        }

        // Global mouse events for drag handling
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
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
     * Update cursor based on hover position
     */
    handleMouseMoveHover(e) {
        const rect = e.target.getBoundingClientRect();
        const handle = this.getHandleAtPosition(e.clientX, rect);
        
        if (handle) {
            e.target.style.cursor = 'ew-resize';
        } else {
            e.target.style.cursor = 'default';
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
            // It was a click (not a drag) - seek to position
            const rect = this.activeCanvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left + this.scrollOffset;
            const position = this.pixelToTime(clickX);
            
            if (window.audioEngine) {
                window.audioEngine.seek(position);
            } else {
                State.setPosition(position);
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

    updateZoomSlider() {
        const song = State.getActiveSong();
        let zoom = song?.timeline?.zoom;
        
        // Update slider min/max based on calculated limits
        if (this.zoomSlider) {
            const { minZoom, maxZoom } = this.calculateZoomLimits();
            this.zoomSlider.min = minZoom;
            this.zoomSlider.max = maxZoom;
            this.zoomSlider.step = (maxZoom - minZoom) / 100; // 100 steps
        }
        
        // If zoom is null, calculate fit-to-window zoom
        if (zoom === null) {
            zoom = this.calculateFitZoom();
            // Apply the calculated zoom
            if (song) {
                State.updateTimeline({ zoom });
            }
        }
        
        if (this.zoomSlider) {
            this.zoomSlider.value = zoom;
        }
        this.updateZoomDisplay(zoom);
    }

    updateZoomDisplay(zoom) {
        if (this.zoomValueEl) {
            const percentage = Math.round(zoom * 100);
            this.zoomValueEl.textContent = `${percentage}%`;
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
        
        // Calculate zoom limits
        const { minZoom, maxZoom } = this.calculateZoomLimits();
        
        // Clamp to calculated range
        return Math.max(minZoom, Math.min(maxZoom, fitZoom));
    }

    /**
     * Calculate the min and max zoom levels based on song duration and tempo
     * - Min zoom: song fits at ~50% of viewport width
     * - Max zoom: ~1 measure fills viewport width
     */
    calculateZoomLimits() {
        const maxDuration = State.getMaxDuration();
        const song = State.getActiveSong();
        
        // Use first time signature from metadata, or fall back to transport time signature
        const timeSigs = song?.metadata?.['time-sigs'];
        const timeSignature = (timeSigs && timeSigs.length > 0) ? timeSigs[0].sig : (song?.transport?.timeSignature || '4/4');
        
        // Use first tempo from metadata, or fall back to transport tempo
        const tempos = song?.metadata?.tempos;
        const tempo = (tempos && tempos.length > 0) ? tempos[0].tempo : (song?.transport?.tempo || 120);
        
        // Get viewport width
        const waveformScrollArea = document.getElementById('waveform-scroll-area');
        const viewportWidth = waveformScrollArea ? waveformScrollArea.clientWidth - 20 : 800;
        
        // Calculate seconds per measure
        const [beatsPerMeasure] = timeSignature.split('/').map(Number);
        const secondsPerBeat = 60 / tempo;
        const secondsPerMeasure = secondsPerBeat * beatsPerMeasure;
        
        // Min zoom: entire song at 50% of viewport
        // zoom = desiredWidth / (duration * BASE_PIXELS_PER_SECOND)
        let minZoom = 0.01; // Absolute minimum
        if (maxDuration > 0) {
            minZoom = (viewportWidth * 0.5) / (maxDuration * BASE_PIXELS_PER_SECOND);
            minZoom = Math.max(0.01, minZoom);
        }
        
        // Max zoom: 1 measure fills viewport
        // zoom = viewportWidth / (secondsPerMeasure * BASE_PIXELS_PER_SECOND)
        let maxZoom = viewportWidth / (secondsPerMeasure * BASE_PIXELS_PER_SECOND);
        maxZoom = Math.min(50, maxZoom); // Cap at 50x
        
        // Ensure min < max
        if (minZoom >= maxZoom) {
            minZoom = maxZoom / 10;
        }
        
        return { minZoom, maxZoom };
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
     */
    renderMarkers(ctx, canvas) {
        const song = State.getActiveSong();
        if (!song) return;
        
        const markers = song.metadata?.markers;
        if (!markers || markers.length === 0) return;
        
        const triangleWidth = 20;
        const triangleHeight = 20;
        const labelPadding = 5;
        const labelGap = 2; // Gap between triangle and label
        
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        
        for (const marker of markers) {
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
        
        // Get beat positions for visible range (accounts for variable tempo and time signature)
        const beatPositions = getBeatPositionsInRange(startTime, endTime, tempos, timeSigs);
        
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

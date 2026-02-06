/**
 * Track Panel UI
 * Left panel showing track controls with manifest-based track selection
 */

import * as State from '../state.js';
import * as TrackManager from '../trackManager.js';
import * as Manifest from '../manifest.js';
import { Knob } from './knob.js';
import { getModal } from './modal.js';

class TrackPanel {
    constructor() {
        this.container = document.getElementById('track-controls-list');
        this.emptyState = document.getElementById('track-controls-empty');
        this.addTrackBtn = document.getElementById('add-track-btn');
        this.addTrackContainer = document.getElementById('add-track-container');
        this.trackElements = new Map(); // trackId -> element
        this.knobs = new Map(); // trackId -> { pan: Knob }
        
        // Drag-and-drop state
        this.draggedTrackId = null;
        
        this.init();
        this.attachStateListeners();
        this.setupScrollSync();
        this.initDragDrop();
    }

    init() {
        // Add track button
        if (this.addTrackBtn) {
            this.addTrackBtn.addEventListener('click', () => {
                this.showTrackPicker();
            });
        }
    }

    /**
     * Show track picker modal for selecting tracks to add
     */
    async showTrackPicker() {
        const song = State.getActiveSong();
        if (!song || !song.songName) {
            const modal = getModal();
            await modal.alert({
                title: 'No Song Selected',
                message: 'Please select a song first before adding tracks.'
            });
            return;
        }

        // Ensure manifest is loaded
        await Manifest.loadManifest();

        // Get available tracks from manifest
        const availableTracks = Manifest.getSongTracks(song.songName);
        if (!availableTracks || availableTracks.length === 0) {
            const modal = getModal();
            await modal.alert({
                title: 'No Tracks Available',
                message: 'No tracks found for this song in the manifest.'
            });
            return;
        }

        // Get already loaded tracks
        const loadedTracks = TrackManager.getLoadedTrackFileNames();

        // Build modal content
        const modal = getModal();
        const content = this.buildTrackPickerContent(availableTracks, loadedTracks);
        
        const result = await modal.custom({
            title: 'Add Tracks',
            content,
            confirmText: 'Add Selected',
            onConfirm: () => {
                const checkboxes = document.querySelectorAll('.track-picker-item input[type="checkbox"]:checked:not(:disabled)');
                return Array.from(checkboxes).map(cb => cb.value);
            }
        });

        if (result && result.length > 0) {
            await TrackManager.addTracksFromManifest(song.songName, result);
        }
    }

    /**
     * Build the track picker modal content HTML
     */
    buildTrackPickerContent(availableTracks, loadedTracks) {
        const allLoaded = availableTracks.every(t => loadedTracks.includes(t));
        const noneLoaded = loadedTracks.length === 0;

        let html = `
            <div class="file-select-header">
                <button class="btn btn-secondary btn-small" id="track-select-all" ${allLoaded ? 'disabled' : ''}>Select All</button>
                <button class="btn btn-secondary btn-small" id="track-select-none">Select None</button>
                <span class="file-count">${availableTracks.length} tracks available</span>
            </div>
            <div class="file-select-list">
        `;

        for (const trackFileName of availableTracks) {
            const isLoaded = loadedTracks.includes(trackFileName);
            const displayName = Manifest.getTrackDisplayName(trackFileName);
            
            html += `
                <label class="file-select-item track-picker-item ${isLoaded ? 'disabled' : ''}">
                    <input type="checkbox" value="${trackFileName}" ${isLoaded ? 'disabled checked' : ''}>
                    <span class="file-name">${displayName}</span>
                    ${isLoaded ? '<span class="file-size">Already loaded</span>' : ''}
                </label>
            `;
        }

        html += '</div>';

        // Add event listener setup after render
        setTimeout(() => {
            const selectAllBtn = document.getElementById('track-select-all');
            const selectNoneBtn = document.getElementById('track-select-none');
            
            if (selectAllBtn) {
                selectAllBtn.addEventListener('click', () => {
                    document.querySelectorAll('.track-picker-item input[type="checkbox"]:not(:disabled)').forEach(cb => {
                        cb.checked = true;
                    });
                });
            }
            
            if (selectNoneBtn) {
                selectNoneBtn.addEventListener('click', () => {
                    document.querySelectorAll('.track-picker-item input[type="checkbox"]:not(:disabled)').forEach(cb => {
                        cb.checked = false;
                    });
                });
            }
        }, 0);

        return html;
    }

    /**
     * Set up scroll synchronization with waveform panel
     */
    setupScrollSync() {
        // Listen for vertical scroll from waveform panel
        State.subscribe('waveformScrollVertical', (scrollTop) => {
            if (this.container.scrollTop !== scrollTop) {
                this.container.scrollTop = scrollTop;
            }
        });

        // Also sync in the other direction (track panel -> waveform)
        this.container.addEventListener('scroll', () => {
            State.emit('trackPanelScrollVertical', this.container.scrollTop);
        });
    }

    /**
     * Initialize drag-and-drop for track reordering
     */
    initDragDrop() {
        // Dragstart - initiate drag if not on interactive element
        this.container.addEventListener('dragstart', (e) => {
            const trackElement = e.target.closest('.track-control');
            if (!trackElement) return;
            
            // Cancel drag if started on interactive elements
            const interactiveElement = e.target.closest('button, input, .knob, .pan-knob-container');
            if (interactiveElement) {
                e.preventDefault();
                return;
            }
            
            this.draggedTrackId = trackElement.dataset.trackId;
            trackElement.classList.add('dragging');
            
            // Required for Firefox
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.draggedTrackId);
        });

        // Dragover - determine drop position and show indicator
        this.container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const trackElement = e.target.closest('.track-control');
            if (!trackElement || trackElement.dataset.trackId === this.draggedTrackId) {
                return;
            }
            
            // Clear previous indicators
            this.clearDropIndicators();
            
            // Determine if we're in the top or bottom half of the element
            const rect = trackElement.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            
            if (e.clientY < midpoint) {
                trackElement.classList.add('drag-over-top');
            } else {
                trackElement.classList.add('drag-over-bottom');
            }
        });

        // Dragleave - clean up indicators when leaving an element
        this.container.addEventListener('dragleave', (e) => {
            const trackElement = e.target.closest('.track-control');
            if (trackElement) {
                trackElement.classList.remove('drag-over-top', 'drag-over-bottom');
            }
        });

        // Drop - perform the reorder
        this.container.addEventListener('drop', (e) => {
            e.preventDefault();
            
            const targetElement = e.target.closest('.track-control');
            if (!targetElement || !this.draggedTrackId) {
                this.clearDropIndicators();
                return;
            }
            
            const targetTrackId = targetElement.dataset.trackId;
            if (targetTrackId === this.draggedTrackId) {
                this.clearDropIndicators();
                return;
            }
            
            // Get the target index
            const song = State.getActiveSong();
            if (!song) return;
            
            let targetIndex = song.tracks.findIndex(t => t.id === targetTrackId);
            
            // If dropping in bottom half, insert after the target
            const rect = targetElement.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (e.clientY >= midpoint) {
                targetIndex++;
            }
            
            // Adjust for the fact that dragged item will be removed first
            const draggedIndex = song.tracks.findIndex(t => t.id === this.draggedTrackId);
            if (draggedIndex < targetIndex) {
                targetIndex--;
            }
            
            // Perform the reorder
            State.reorderTrack(this.draggedTrackId, targetIndex);
            
            this.clearDropIndicators();
        });

        // Dragend - clean up
        this.container.addEventListener('dragend', (e) => {
            const trackElement = e.target.closest('.track-control');
            if (trackElement) {
                trackElement.classList.remove('dragging');
            }
            this.draggedTrackId = null;
            this.clearDropIndicators();
        });
    }

    /**
     * Clear all drop indicator classes
     */
    clearDropIndicators() {
        this.container.querySelectorAll('.track-control').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
    }

    attachStateListeners() {
        State.subscribe(State.Events.TRACK_ADDED, ({ track }) => {
            this.addTrackElement(track);
            this.updateEmptyState();
        });

        State.subscribe(State.Events.TRACK_REMOVED, ({ track }) => {
            this.removeTrackElement(track.id);
            this.updateEmptyState();
        });

        State.subscribe(State.Events.TRACK_UPDATED, ({ track, updates }) => {
            this.updateTrackElement(track.id, updates);
        });

        State.subscribe(State.Events.TRACK_SELECTED, (trackId) => {
            this.updateSelection(trackId);
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

        State.subscribe(State.Events.TRACKS_REORDERED, ({ song }) => {
            this.renderTracks(song);
        });
    }

    /**
     * Render all tracks for a song
     */
    renderTracks(song) {
        this.clear();
        
        if (song && song.tracks) {
            song.tracks.forEach(track => {
                this.addTrackElement(track);
            });
        }
        
        this.updateEmptyState();
    }

    /**
     * Add a track element
     */
    addTrackElement(track) {
        const element = document.createElement('div');
        element.className = 'track-control';
        element.dataset.trackId = track.id;
        element.draggable = true;
        
        // Assign track color based on position in song's track list (cycles through 6 colors)
        const song = State.getActiveSong();
        const trackIndex = song?.tracks?.findIndex(t => t.id === track.id) ?? 0;
        const colorIndex = (trackIndex % 6) + 1;
        element.classList.add(`track-color-${colorIndex}`);
        
        // Check if track is active
        const isAudible = State.isTrackAudible(track.id);
        if (!isAudible) {
            element.classList.add('inactive');
        }

        // Determine pitch-exempt status for display
        const isPitchExempt = State.isTrackPitchExempt(track.id);
        const isAutoDetected = track.pitchExempt === null || track.pitchExempt === undefined;
        const pitchExemptClasses = this.getPitchExemptClasses(isPitchExempt, isAutoDetected);
        const pitchExemptTooltip = this.getPitchExemptTooltip(isPitchExempt, isAutoDetected);

        element.innerHTML = `
            <div class="track-control-header">
                <span class="track-name" title="${track.name}">${track.name}</span>
                <button class="track-pitch-exempt-btn ${pitchExemptClasses}" title="${pitchExemptTooltip}">
                    <svg viewBox="0 0 24 24" width="14" height="14">
                        <path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                    </svg>
                    ${isPitchExempt ? '<span class="pitch-exempt-slash"></span>' : ''}
                </button>
                <button class="track-delete-btn" title="Delete track">
                    <svg viewBox="0 0 24 24" width="14" height="14">
                        <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
            </div>
            <div class="track-control-row">
                <div class="knob-group vol-group">
                    <div class="vol-knob-container"></div>
                    <span class="volume-value">${track.volume}%</span>
                </div>
                <div class="knob-group pan-group">
                    <div class="pan-knob-container"></div>
                    <span class="pan-value">${this.formatPan(track.pan)}</span>
                </div>
                <div class="track-buttons">
                    <button class="track-btn solo ${track.solo ? 'active' : ''}" title="Solo">S</button>
                    <button class="track-btn mute ${track.mute ? 'active' : ''}" title="Mute">M</button>
                </div>
            </div>
        `;

        // Create volume knob
        const volContainer = element.querySelector('.vol-knob-container');
        const volumeValue = element.querySelector('.volume-value');
        const volKnob = new Knob(volContainer, {
            min: 0,
            max: 100,
            value: track.volume,
            step: 1,
            size: 28,
            defaultValue: 100,
            onChange: (value) => {
                volumeValue.textContent = `${value}%`;
                TrackManager.setTrackVolume(track.id, value);
            }
        });

        // Create pan knob
        const panContainer = element.querySelector('.pan-knob-container');
        const panKnob = new Knob(panContainer, {
            min: -100,
            max: 100,
            value: track.pan,
            step: 1,
            size: 28,
            bipolar: true,
            onChange: (value) => {
                TrackManager.setTrackPan(track.id, value);
            }
        });
        this.knobs.set(track.id, { volume: volKnob, pan: panKnob });

        // Attach event listeners
        this.attachTrackEvents(element, track.id);

        this.container.appendChild(element);
        this.trackElements.set(track.id, element);
    }

    /**
     * Attach event listeners to a track element
     */
    attachTrackEvents(element, trackId) {
        // Select track on click
        element.addEventListener('click', (e) => {
            if (!e.target.closest('button') && !e.target.closest('input') && !e.target.closest('.knob')) {
                State.selectTrack(trackId);
            }
        });

        // Delete button
        const deleteBtn = element.querySelector('.track-delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            TrackManager.deleteTrack(trackId, false);// false = No confirmation needed
        });

        // Pitch-exempt button
        const pitchExemptBtn = element.querySelector('.track-pitch-exempt-btn');
        pitchExemptBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            TrackManager.togglePitchExempt(trackId);
        });

        // Solo button
        const soloBtn = element.querySelector('.track-btn.solo');
        soloBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            TrackManager.toggleSolo(trackId);
        });

        // Mute button
        const muteBtn = element.querySelector('.track-btn.mute');
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            TrackManager.toggleMute(trackId);
        });
    }

    /**
     * Remove a track element
     */
    removeTrackElement(trackId) {
        const element = this.trackElements.get(trackId);
        if (element) {
            element.remove();
            this.trackElements.delete(trackId);
        }
        
        // Cleanup knobs
        const knobs = this.knobs.get(trackId);
        if (knobs) {
            if (knobs.volume) knobs.volume.destroy();
            if (knobs.pan) knobs.pan.destroy();
            this.knobs.delete(trackId);
        }
    }

    /**
     * Update a track element based on state changes
     */
    updateTrackElement(trackId, updates) {
        const element = this.trackElements.get(trackId);
        if (!element) return;

        if ('volume' in updates) {
            const value = element.querySelector('.volume-value');
            value.textContent = `${updates.volume}%`;
            
            const knobs = this.knobs.get(trackId);
            if (knobs && knobs.volume) {
                knobs.volume.setValue(updates.volume, false);
            }
        }

        if ('pan' in updates) {
            const panValue = element.querySelector('.pan-value');
            panValue.textContent = this.formatPan(updates.pan);
            
            const knobs = this.knobs.get(trackId);
            if (knobs && knobs.pan) {
                knobs.pan.setValue(updates.pan, false);
            }
        }

        if ('solo' in updates) {
            const soloBtn = element.querySelector('.track-btn.solo');
            soloBtn.classList.toggle('active', updates.solo);
        }

        if ('mute' in updates) {
            const muteBtn = element.querySelector('.track-btn.mute');
            muteBtn.classList.toggle('active', updates.mute);
        }

        if ('pitchExempt' in updates) {
            this.updatePitchExemptButton(trackId, element);
        }

        // Update audibility
        this.updateTrackAudibility(trackId);
    }

    /**
     * Update the pitch-exempt button state
     */
    updatePitchExemptButton(trackId, element = null) {
        element = element || this.trackElements.get(trackId);
        if (!element) return;

        const track = State.getTrack(trackId);
        if (!track) return;

        const isPitchExempt = State.isTrackPitchExempt(trackId);
        const isAutoDetected = track.pitchExempt === null || track.pitchExempt === undefined;
        
        const btn = element.querySelector('.track-pitch-exempt-btn');
        if (!btn) return;

        // Update classes
        btn.className = `track-pitch-exempt-btn ${this.getPitchExemptClasses(isPitchExempt, isAutoDetected)}`;
        
        // Update tooltip
        btn.title = this.getPitchExemptTooltip(isPitchExempt, isAutoDetected);
        
        // Update slash indicator
        let slash = btn.querySelector('.pitch-exempt-slash');
        if (isPitchExempt && !slash) {
            slash = document.createElement('span');
            slash.className = 'pitch-exempt-slash';
            btn.appendChild(slash);
        } else if (!isPitchExempt && slash) {
            slash.remove();
        }
    }

    /**
     * Get CSS classes for pitch-exempt button
     */
    getPitchExemptClasses(isPitchExempt, isAutoDetected) {
        const classes = [];
        if (isPitchExempt) classes.push('exempt');
        if (isAutoDetected) classes.push('auto');
        return classes.join(' ');
    }

    /**
     * Get tooltip text for pitch-exempt button
     */
    getPitchExemptTooltip(isPitchExempt, isAutoDetected) {
        if (isPitchExempt) {
            if (isAutoDetected) {
                return 'Pitch exempt (auto-detected). Click to include in pitch control.';
            }
            return 'Pitch exempt (manual). Click to reset to auto-detect.';
        } else {
            if (isAutoDetected) {
                return 'Pitch applied. Click to exempt from pitch control.';
            }
            return 'Pitch applied (manual). Click to reset to auto-detect.';
        }
    }

    /**
     * Update track audibility visual state
     */
    updateTrackAudibility(trackId) {
        const element = this.trackElements.get(trackId);
        if (!element) return;

        const isAudible = State.isTrackAudible(trackId);
        element.classList.toggle('inactive', !isAudible);
    }

    /**
     * Update all tracks' audibility
     */
    updateAllTracksAudibility() {
        const song = State.getActiveSong();
        if (!song) return;

        song.tracks.forEach(track => {
            this.updateTrackAudibility(track.id);
        });
    }

    /**
     * Update selection state
     */
    updateSelection(selectedTrackId) {
        this.trackElements.forEach((element, trackId) => {
            element.classList.toggle('selected', trackId === selectedTrackId);
        });
    }

    /**
     * Format pan value for display
     */
    formatPan(pan) {
        if (pan === 0) return 'C';
        if (pan < 0) return `${Math.abs(pan)}L`;
        return `${pan}R`;
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
    }

    /**
     * Clear all track elements
     */
    clear() {
        // Cleanup knobs
        this.knobs.forEach((knobs) => {
            if (knobs.pan) knobs.pan.destroy();
        });
        this.knobs.clear();
        
        this.container.innerHTML = '';
        this.trackElements.clear();
    }
}

// Singleton instance
let trackPanelInstance = null;

export function getTrackPanel() {
    if (!trackPanelInstance) {
        trackPanelInstance = new TrackPanel();
    }
    return trackPanelInstance;
}

// Subscribe to track updates for audibility changes
State.subscribe(State.Events.TRACK_UPDATED, () => {
    if (trackPanelInstance) {
        trackPanelInstance.updateAllTracksAudibility();
    }
});

export default TrackPanel;

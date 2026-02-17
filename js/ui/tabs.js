/**
 * Tabs UI
 * Song tab bar management with manifest-based song selection
 */

import * as State from '../state.js';
import * as SongManager from '../songManager.js';
import * as Manifest from '../manifest.js';
import { getTrackPanel } from './trackPanel.js';

class TabsUI {
    constructor() {
        this.container = document.getElementById('tabs-container');
        this.addBtn = document.getElementById('add-song-btn');
        this.songPicker = document.getElementById('song-picker');
        this.songPickerList = document.getElementById('song-picker-list');
        
        this.tabElements = new Map(); // songId -> element
        this.isPickerOpen = false;
        
        // Drag-and-drop tracking
        this.draggedSongId = null;
        
        this.init();
        this.attachStateListeners();
    }

    init() {
        // Add song button - show picker dropdown
        this.addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleSongPicker();
        });

        // Close picker when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isPickerOpen && !this.songPicker.contains(e.target) && !this.addBtn.contains(e.target)) {
                this.closeSongPicker();
            }
        });

        // Close picker on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isPickerOpen) {
                    this.closeSongPicker();
                }
            }
        });
        
        // Initialize drag-and-drop for tab reordering
        this.initDragDrop();
    }

    /**
     * Initialize drag-and-drop for tab reordering
     */
    initDragDrop() {
        // Dragstart - initiate drag if not on close button
        this.container.addEventListener('dragstart', (e) => {
            const tabElement = e.target.closest('.song-tab');
            if (!tabElement) return;
            
            // Cancel drag if started on close button
            const closeBtn = e.target.closest('.song-tab-close');
            if (closeBtn) {
                e.preventDefault();
                return;
            }
            
            this.draggedSongId = tabElement.dataset.songId;
            tabElement.classList.add('dragging');
            
            // Required for Firefox
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.draggedSongId);
        });

        // Dragover - determine drop position and show indicator
        this.container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const tabElement = e.target.closest('.song-tab');
            if (!tabElement || tabElement.dataset.songId === this.draggedSongId) {
                return;
            }
            
            // Clear previous indicators
            this.clearDropIndicators();
            
            // Determine if we're in the left or right half of the element (horizontal)
            const rect = tabElement.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            
            if (e.clientX < midpoint) {
                tabElement.classList.add('drag-over-left');
            } else {
                tabElement.classList.add('drag-over-right');
            }
        });

        // Dragleave - clean up indicators when leaving an element
        this.container.addEventListener('dragleave', (e) => {
            const tabElement = e.target.closest('.song-tab');
            if (tabElement) {
                tabElement.classList.remove('drag-over-left', 'drag-over-right');
            }
        });

        // Drop - perform the reorder
        this.container.addEventListener('drop', (e) => {
            e.preventDefault();
            
            const targetElement = e.target.closest('.song-tab');
            if (!targetElement || !this.draggedSongId) {
                this.clearDropIndicators();
                return;
            }
            
            const targetSongId = targetElement.dataset.songId;
            if (targetSongId === this.draggedSongId) {
                this.clearDropIndicators();
                return;
            }
            
            // Get the target index
            let targetIndex = State.state.songs.findIndex(s => s.id === targetSongId);
            
            // If dropping in right half, insert after the target
            const rect = targetElement.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            if (e.clientX >= midpoint) {
                targetIndex++;
            }
            
            // Adjust for the fact that dragged item will be removed first
            const draggedIndex = State.state.songs.findIndex(s => s.id === this.draggedSongId);
            if (draggedIndex < targetIndex) {
                targetIndex--;
            }
            
            // Perform the reorder
            State.reorderSong(this.draggedSongId, targetIndex);
            
            this.clearDropIndicators();
        });

        // Dragend - clean up
        this.container.addEventListener('dragend', (e) => {
            const tabElement = e.target.closest('.song-tab');
            if (tabElement) {
                tabElement.classList.remove('dragging');
            }
            this.draggedSongId = null;
            this.clearDropIndicators();
        });
    }

    /**
     * Clear all drop indicator classes from tabs
     */
    clearDropIndicators() {
        this.container.querySelectorAll('.song-tab').forEach(el => {
            el.classList.remove('drag-over-left', 'drag-over-right');
        });
    }

    attachStateListeners() {
        State.subscribe(State.Events.SONG_ADDED, (song) => {
            this.addTab(song);
            this.updateActiveTab();
            this.updateEmptyState();
        });

        State.subscribe(State.Events.SONG_REMOVED, (song) => {
            this.removeTab(song.id);
            this.updateEmptyState();
        });

        State.subscribe(State.Events.SONG_SWITCHED, () => {
            this.updateActiveTab();
        });

        State.subscribe(State.Events.STATE_LOADED, () => {
            this.renderTabs();
            this.updateEmptyState();
        });
        
        // Re-render tabs when reordered
        State.subscribe(State.Events.SONGS_REORDERED, () => {
            this.renderTabs();
        });
    }

    // ========================================
    // Song Picker
    // ========================================

    /**
     * Toggle the song picker dropdown
     */
    async toggleSongPicker() {
        if (this.isPickerOpen) {
            this.closeSongPicker();
        } else {
            await this.openSongPicker();
        }
    }

    /**
     * Open the song picker dropdown
     */
    async openSongPicker() {
        // Load manifest if not already loaded
        await Manifest.loadManifest();
        
        // Get all available songs (duplicates allowed - same song can be opened multiple times)
        const allSongs = Manifest.getSongs();
        
        // Populate picker list
        this.songPickerList.innerHTML = '';
        
        if (allSongs.length === 0) {
            this.songPickerList.innerHTML = '<div class="picker-empty">No songs available</div>';
        } else {
            for (const song of allSongs) {
                const item = document.createElement('div');
                item.className = 'picker-item';
                item.textContent = song.name;
                item.addEventListener('click', () => {
                    this.selectSong(song.name);
                });
                this.songPickerList.appendChild(item);
            }
        }
        
        this.songPicker.classList.remove('hidden');
        this.isPickerOpen = true;
    }

    /**
     * Close the song picker dropdown
     */
    closeSongPicker() {
        this.songPicker.classList.add('hidden');
        this.isPickerOpen = false;
    }

    /**
     * Select a song from the picker
     */
    async selectSong(songName) {
        this.closeSongPicker();
        SongManager.openSong(songName);
        
        // Auto-open track picker for the newly opened song
        const trackPanel = getTrackPanel();
        await trackPanel.showTrackPicker();
    }

    /**
     * Update empty state visibility and control enabled states
     * Panels are always visible - only the empty state message and control states change
     */
    updateEmptyState() {
        const noSongEmptyState = document.getElementById('no-song-empty-state');
        const hasSongs = State.state.songs.length > 0;
        
        // Toggle empty state message visibility (now inside waveform container)
        if (noSongEmptyState) {
            noSongEmptyState.classList.toggle('hidden', hasSongs);
        }
        
        // Update control enabled/disabled states
        this.updateControlsEnabledState(hasSongs);
    }
    
    /**
     * Enable or disable controls based on whether songs are open
     * @param {boolean} enabled - True to enable controls, false to disable
     */
    updateControlsEnabledState(enabled) {
        // Zoom controls
        const zoomFitBtn = document.getElementById('zoom-fit');
        const zoomKnobContainer = document.getElementById('zoom-knob-container');
        const zoomValue = document.getElementById('zoom-value');
        
        if (zoomFitBtn) zoomFitBtn.disabled = !enabled;
        if (zoomKnobContainer) zoomKnobContainer.classList.toggle('disabled', !enabled);
        if (zoomValue) zoomValue.classList.toggle('disabled', !enabled);
        
        // Add track button
        const addTrackBtn = document.getElementById('add-track-btn');
        if (addTrackBtn) addTrackBtn.disabled = !enabled;
        
        // Transport controls
        const transportButtons = [
            'btn-beginning',
            'btn-stop',
            'btn-play',
            'btn-pause',
            'btn-loop'
        ];
        
        transportButtons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = !enabled;
        });
        
        // Speed knob
        const speedKnobContainer = document.getElementById('speed-knob-container');
        if (speedKnobContainer) speedKnobContainer.classList.toggle('disabled', !enabled);
        
        // Pitch select
        const pitchSelect = document.getElementById('pitch-select');
        if (pitchSelect) pitchSelect.disabled = !enabled;
    }

    // ========================================
    // Tab Management
    // ========================================

    /**
     * Render all tabs
     */
    renderTabs() {
        this.clear();
        
        for (const song of State.state.songs) {
            this.addTab(song);
        }
        
        this.applyTabColors();
        this.updateActiveTab();
    }

    /**
     * Add a tab for a song
     */
    addTab(song) {
        const tab = document.createElement('div');
        tab.className = 'song-tab';
        tab.dataset.songId = song.id;
        tab.draggable = true;
        
        tab.innerHTML = `
            <span class="song-tab-name" title="${song.name}">${song.name}</span>
            <button class="song-tab-close" title="Close song">
                <svg viewBox="0 0 24 24" width="12" height="12">
                    <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
        `;
        
        // Tab click to switch
        tab.addEventListener('click', (e) => {
            if (!e.target.closest('.song-tab-close')) {
                SongManager.switchSong(song.id);
            }
        });
        
        // Close button
        const closeBtn = tab.querySelector('.song-tab-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            SongManager.closeSong(song.id, false); // No confirmation needed for new model
        });
        
        // Assign tab color based on position (cycles through 6 colors)
        const tabIndex = this.container.children.length;
        const colorIndex = (tabIndex % 6) + 1;
        tab.classList.add(`tab-color-${colorIndex}`);
        
        this.container.appendChild(tab);
        this.tabElements.set(song.id, tab);
    }

    /**
     * Remove a tab
     */
    removeTab(songId) {
        const tab = this.tabElements.get(songId);
        if (tab) {
            tab.remove();
            this.tabElements.delete(songId);
        }
    }

    /**
     * Update active tab styling
     */
    updateActiveTab() {
        this.tabElements.forEach((tab, songId) => {
            tab.classList.toggle('active', songId === State.state.activeSongId);
        });
    }

    /**
     * Apply colors to all tabs, treating mashup groups as a single color slot.
     * Standalone songs each get the next color in the cycle (1-6).
     * All tabs in the same mashup group share one color slot.
     */
    applyTabColors() {
        let colorCounter = 0;
        const coloredGroups = new Set();
        
        for (const song of State.state.songs) {
            const tab = this.tabElements.get(song.id);
            if (!tab) continue;
            
            if (song.mashupGroupId) {
                if (!coloredGroups.has(song.mashupGroupId)) {
                    // First tab of this mashup group — advance color
                    colorCounter++;
                    coloredGroups.add(song.mashupGroupId);
                }
                // Subsequent tabs of same group reuse the same color
            } else {
                // Standalone song — advance color
                colorCounter++;
            }
            
            const colorIndex = ((colorCounter - 1) % 6) + 1;
            
            // Remove existing color classes, apply new one
            for (let i = 1; i <= 6; i++) {
                tab.classList.remove(`tab-color-${i}`);
            }
            tab.classList.add(`tab-color-${colorIndex}`);
        }
    }

    /**
     * Clear all tabs
     */
    clear() {
        this.container.innerHTML = '';
        this.tabElements.clear();
    }
}

// Singleton instance
let tabsInstance = null;

export function getTabs() {
    if (!tabsInstance) {
        tabsInstance = new TabsUI();
    }
    return tabsInstance;
}

export default TabsUI;

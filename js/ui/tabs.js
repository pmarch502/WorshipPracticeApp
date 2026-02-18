/**
 * Tabs UI
 * Song tab bar management with manifest-based song selection.
 * Mashup groups render as a single segmented tab with internal clickable segments.
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
        
        this.tabElements = new Map(); // songId -> element (for standalone songs)
        this.mashupTabElements = new Map(); // groupId -> element (for mashup group tabs)
        this.isPickerOpen = false;
        
        // Drag-and-drop tracking
        this.draggedSongId = null;
        this.draggedGroupId = null;
        
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

    // ========================================
    // Drag-and-Drop
    // ========================================

    /**
     * Initialize drag-and-drop for tab reordering.
     * Handles both standalone song tabs and mashup group tabs.
     */
    initDragDrop() {
        // Dragstart - initiate drag
        this.container.addEventListener('dragstart', (e) => {
            // Check mashup tab first
            const mashupTab = e.target.closest('.mashup-tab');
            if (mashupTab) {
                // Cancel drag if started on close button or chevron
                if (e.target.closest('.song-tab-close') || e.target.closest('.mashup-chevron')) {
                    e.preventDefault();
                    return;
                }
                this.draggedGroupId = mashupTab.dataset.groupId;
                this.draggedSongId = null;
                mashupTab.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', this.draggedGroupId);
                return;
            }
            
            // Standalone song tab
            const tabElement = e.target.closest('.song-tab');
            if (!tabElement) return;
            
            if (e.target.closest('.song-tab-close')) {
                e.preventDefault();
                return;
            }
            
            this.draggedSongId = tabElement.dataset.songId;
            this.draggedGroupId = null;
            tabElement.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.draggedSongId);
        });

        // Dragover - determine drop position and show indicator
        this.container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            // Find the drop target (could be a song-tab or mashup-tab)
            const target = e.target.closest('.song-tab') || e.target.closest('.mashup-tab');
            if (!target) return;
            
            // Don't show indicator on self
            if (this.draggedSongId && target.classList.contains('song-tab') && target.dataset.songId === this.draggedSongId) return;
            if (this.draggedGroupId && target.classList.contains('mashup-tab') && target.dataset.groupId === this.draggedGroupId) return;
            
            this.clearDropIndicators();
            
            const rect = target.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            
            if (e.clientX < midpoint) {
                target.classList.add('drag-over-left');
            } else {
                target.classList.add('drag-over-right');
            }
        });

        // Dragleave
        this.container.addEventListener('dragleave', (e) => {
            const target = e.target.closest('.song-tab') || e.target.closest('.mashup-tab');
            if (target) {
                target.classList.remove('drag-over-left', 'drag-over-right');
            }
        });

        // Drop - perform the reorder
        this.container.addEventListener('drop', (e) => {
            e.preventDefault();
            
            const targetEl = e.target.closest('.song-tab') || e.target.closest('.mashup-tab');
            if (!targetEl) {
                this.clearDropIndicators();
                return;
            }
            
            // Determine target index in state.songs
            let targetIndex;
            if (targetEl.classList.contains('mashup-tab')) {
                const targetGroupId = targetEl.dataset.groupId;
                const targetGroup = State.getMashupGroup(targetGroupId);
                if (!targetGroup) { this.clearDropIndicators(); return; }
                // Target is the index of the first song in the mashup group
                targetIndex = State.state.songs.findIndex(s => s.id === targetGroup.tabIds[0]);
            } else {
                const targetSongId = targetEl.dataset.songId;
                targetIndex = State.state.songs.findIndex(s => s.id === targetSongId);
            }
            
            // If dropping in right half, insert after
            const rect = targetEl.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            const dropAfter = e.clientX >= midpoint;
            
            if (targetEl.classList.contains('mashup-tab') && dropAfter) {
                // After a mashup tab: target index is after the last song of the group
                const targetGroupId = targetEl.dataset.groupId;
                const targetGroup = State.getMashupGroup(targetGroupId);
                if (targetGroup) {
                    const lastSongId = targetGroup.tabIds[targetGroup.tabIds.length - 1];
                    targetIndex = State.state.songs.findIndex(s => s.id === lastSongId) + 1;
                }
            } else if (dropAfter) {
                targetIndex++;
            }
            
            if (this.draggedGroupId) {
                // Dragging a mashup group
                State.reorderMashupGroup(this.draggedGroupId, targetIndex);
            } else if (this.draggedSongId) {
                // Dragging a standalone song
                const draggedIndex = State.state.songs.findIndex(s => s.id === this.draggedSongId);
                if (draggedIndex < targetIndex) {
                    targetIndex--;
                }
                State.reorderSong(this.draggedSongId, targetIndex);
            }
            
            this.clearDropIndicators();
        });

        // Dragend - clean up
        this.container.addEventListener('dragend', (e) => {
            const target = e.target.closest('.song-tab') || e.target.closest('.mashup-tab');
            if (target) {
                target.classList.remove('dragging');
            }
            this.draggedSongId = null;
            this.draggedGroupId = null;
            this.clearDropIndicators();
        });
    }

    /**
     * Clear all drop indicator classes
     */
    clearDropIndicators() {
        this.container.querySelectorAll('.song-tab, .mashup-tab').forEach(el => {
            el.classList.remove('drag-over-left', 'drag-over-right');
        });
    }

    // ========================================
    // State Listeners
    // ========================================

    attachStateListeners() {
        State.subscribe(State.Events.SONG_ADDED, (song) => {
            // Only add a standalone tab if this song is NOT part of a mashup group.
            // Mashup tabs are rendered as a group once the group is created.
            if (!song.mashupGroupId) {
                this.addTab(song);
            }
            this.updateActiveTab();
            this.updateEmptyState();
        });

        State.subscribe(State.Events.SONG_REMOVED, (song) => {
            // If it was a standalone tab, remove it directly
            if (this.tabElements.has(song.id)) {
                this.removeTab(song.id);
            }
            // Mashup tab removal is handled by closeMashupGroup which calls renderTabs
            this.updateEmptyState();
        });

        State.subscribe(State.Events.SONG_SWITCHED, () => {
            this.updateActiveTab();
            
            // Update lastActiveSongId for the mashup group of the newly active song
            const activeSong = State.getActiveSong();
            if (activeSong && activeSong.mashupGroupId) {
                State.setMashupLastActive(activeSong.mashupGroupId, activeSong.id);
            }
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

    async toggleSongPicker() {
        if (this.isPickerOpen) {
            this.closeSongPicker();
        } else {
            await this.openSongPicker();
        }
    }

    async openSongPicker() {
        await Manifest.loadManifest();
        
        const allSongs = Manifest.getSongs();
        
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

    closeSongPicker() {
        this.songPicker.classList.add('hidden');
        this.isPickerOpen = false;
    }

    async selectSong(songName) {
        this.closeSongPicker();
        SongManager.openSong(songName);
        
        const trackPanel = getTrackPanel();
        await trackPanel.showTrackPicker();
    }

    updateEmptyState() {
        const noSongEmptyState = document.getElementById('no-song-empty-state');
        const hasSongs = State.state.songs.length > 0;
        
        if (noSongEmptyState) {
            noSongEmptyState.classList.toggle('hidden', hasSongs);
        }
        
        this.updateControlsEnabledState(hasSongs);
    }
    
    updateControlsEnabledState(enabled) {
        const zoomFitBtn = document.getElementById('zoom-fit');
        const zoomKnobContainer = document.getElementById('zoom-knob-container');
        const zoomValue = document.getElementById('zoom-value');
        
        if (zoomFitBtn) zoomFitBtn.disabled = !enabled;
        if (zoomKnobContainer) zoomKnobContainer.classList.toggle('disabled', !enabled);
        if (zoomValue) zoomValue.classList.toggle('disabled', !enabled);
        
        const addTrackBtn = document.getElementById('add-track-btn');
        if (addTrackBtn) addTrackBtn.disabled = !enabled;
        
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
        
        const speedKnobContainer = document.getElementById('speed-knob-container');
        if (speedKnobContainer) speedKnobContainer.classList.toggle('disabled', !enabled);
        
        const pitchSelect = document.getElementById('pitch-select');
        if (pitchSelect) pitchSelect.disabled = !enabled;
    }

    // ========================================
    // Tab Management
    // ========================================

    /**
     * Render all tabs.
     * Mashup group members are rendered as a single segmented tab;
     * standalone songs render as individual tabs.
     */
    renderTabs() {
        this.clear();
        
        const renderedGroups = new Set();
        
        for (const song of State.state.songs) {
            if (song.mashupGroupId) {
                // Render the entire mashup group as one tab (only once, when we hit the first member)
                if (!renderedGroups.has(song.mashupGroupId)) {
                    renderedGroups.add(song.mashupGroupId);
                    this.addMashupTab(song.mashupGroupId);
                }
            } else {
                this.addTab(song);
            }
        }
        
        this.applyTabColors();
        this.updateActiveTab();
    }

    /**
     * Add a tab for a standalone (non-mashup) song
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
            SongManager.closeSong(song.id, false);
        });
        
        // Assign tab color based on position (will be corrected by applyTabColors)
        const tabIndex = this.container.children.length;
        const colorIndex = (tabIndex % 6) + 1;
        tab.classList.add(`tab-color-${colorIndex}`);
        
        this.container.appendChild(tab);
        this.tabElements.set(song.id, tab);
    }

    /**
     * Add a segmented mashup tab for an entire mashup group.
     * Structure: [chevron] [mashup name] [segment][segment]... [close]
     */
    addMashupTab(groupId) {
        const group = State.getMashupGroup(groupId);
        if (!group) return;
        
        const mashupTab = document.createElement('div');
        mashupTab.className = 'mashup-tab';
        mashupTab.dataset.groupId = groupId;
        mashupTab.draggable = true;
        
        if (group.expanded) {
            mashupTab.classList.add('expanded');
        }
        
        // Build the mashup name for display (and tooltip with full name)
        const displayName = group.name || 'Mashup';
        
        // Chevron
        const chevron = document.createElement('span');
        chevron.className = 'mashup-chevron';
        chevron.textContent = '\u25B8'; // Right-pointing triangle
        chevron.title = 'Expand/collapse';
        chevron.addEventListener('click', (e) => {
            e.stopPropagation();
            const expanded = State.toggleMashupExpanded(groupId);
            mashupTab.classList.toggle('expanded', expanded);
        });
        
        // Mashup name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'mashup-tab-name';
        nameSpan.textContent = displayName;
        nameSpan.title = displayName;
        
        // Segments container
        const segmentsContainer = document.createElement('div');
        segmentsContainer.className = 'mashup-segments';
        
        for (const songId of group.tabIds) {
            const song = State.getSong(songId);
            if (!song) continue;
            
            const segment = document.createElement('div');
            segment.className = 'mashup-segment';
            segment.dataset.songId = songId;
            
            // Build tooltip: "Song Name - Arrangement (pitch: ±N)"
            let tooltip = song.songName || song.name;
            if (song.name !== song.songName && song.name.includes(' - ')) {
                // name was set to "SongName - ArrangementName"
                tooltip = song.name;
            }
            if (song.transport && song.transport.pitch !== 0) {
                const pitchStr = song.transport.pitch > 0 ? `+${song.transport.pitch}` : `${song.transport.pitch}`;
                tooltip += ` (pitch: ${pitchStr})`;
            }
            segment.title = tooltip;
            
            // Segment click -> switch to this song
            segment.addEventListener('click', (e) => {
                e.stopPropagation();
                SongManager.switchSong(songId);
            });
            
            segmentsContainer.appendChild(segment);
        }
        
        // Close button (closes entire mashup group)
        const closeBtn = document.createElement('button');
        closeBtn.className = 'song-tab-close';
        closeBtn.title = 'Close mashup';
        closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="12" height="12">
                <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
        `;
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            SongManager.closeMashupGroup(groupId);
        });
        
        // Tab name/chevron area click -> switch to last active song in mashup
        mashupTab.addEventListener('click', (e) => {
            // Don't handle if click was on segment, chevron, or close button
            if (e.target.closest('.mashup-segment') || e.target.closest('.mashup-chevron') || e.target.closest('.song-tab-close')) {
                return;
            }
            const targetSongId = State.getMashupLastActive(groupId);
            if (targetSongId) {
                SongManager.switchSong(targetSongId);
            }
        });
        
        // Assemble
        mashupTab.appendChild(chevron);
        mashupTab.appendChild(nameSpan);
        mashupTab.appendChild(segmentsContainer);
        mashupTab.appendChild(closeBtn);
        
        this.container.appendChild(mashupTab);
        this.mashupTabElements.set(groupId, mashupTab);
    }

    /**
     * Remove a standalone tab
     */
    removeTab(songId) {
        const tab = this.tabElements.get(songId);
        if (tab) {
            tab.remove();
            this.tabElements.delete(songId);
        }
    }

    /**
     * Remove a mashup group tab
     */
    removeMashupTab(groupId) {
        const tab = this.mashupTabElements.get(groupId);
        if (tab) {
            tab.remove();
            this.mashupTabElements.delete(groupId);
        }
    }

    /**
     * Update active tab styling.
     * For standalone tabs: toggle .active on the tab element.
     * For mashup tabs: toggle .active on the mashup tab container AND the correct segment.
     */
    updateActiveTab() {
        const activeSongId = State.state.activeSongId;
        const activeSong = State.getActiveSong();
        
        // Update standalone tabs
        this.tabElements.forEach((tab, songId) => {
            tab.classList.toggle('active', songId === activeSongId);
        });
        
        // Update mashup tabs
        this.mashupTabElements.forEach((mashupTab, groupId) => {
            const group = State.getMashupGroup(groupId);
            const isGroupActive = activeSong && activeSong.mashupGroupId === groupId;
            
            mashupTab.classList.toggle('active', isGroupActive);
            
            // Update segment active states
            const segments = mashupTab.querySelectorAll('.mashup-segment');
            segments.forEach(seg => {
                seg.classList.toggle('active', seg.dataset.songId === activeSongId);
            });
        });
    }

    /**
     * Apply colors to all tabs, treating mashup groups as a single color slot.
     * Standalone songs each get the next color in the cycle (1-6).
     * Mashup group tabs get one color.
     */
    applyTabColors() {
        let colorCounter = 0;
        const coloredGroups = new Set();
        const groupColors = new Map(); // groupId -> colorIndex
        
        for (const song of State.state.songs) {
            if (song.mashupGroupId) {
                if (!coloredGroups.has(song.mashupGroupId)) {
                    colorCounter++;
                    coloredGroups.add(song.mashupGroupId);
                    groupColors.set(song.mashupGroupId, ((colorCounter - 1) % 6) + 1);
                }
            } else {
                colorCounter++;
                const colorIndex = ((colorCounter - 1) % 6) + 1;
                const tab = this.tabElements.get(song.id);
                if (tab) {
                    for (let i = 1; i <= 6; i++) tab.classList.remove(`tab-color-${i}`);
                    tab.classList.add(`tab-color-${colorIndex}`);
                }
            }
        }
        
        // Apply colors to mashup tabs
        for (const [groupId, colorIndex] of groupColors) {
            const mashupTab = this.mashupTabElements.get(groupId);
            if (mashupTab) {
                for (let i = 1; i <= 6; i++) mashupTab.classList.remove(`tab-color-${i}`);
                mashupTab.classList.add(`tab-color-${colorIndex}`);
            }
        }
    }

    /**
     * Clear all tabs
     */
    clear() {
        this.container.innerHTML = '';
        this.tabElements.clear();
        this.mashupTabElements.clear();
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

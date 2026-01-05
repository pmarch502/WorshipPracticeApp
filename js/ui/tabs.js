/**
 * Tabs UI
 * Song tab bar management with manifest-based song selection
 */

import * as State from '../state.js';
import * as SongManager from '../songManager.js';
import * as Manifest from '../manifest.js';
import { getTrackPanel } from './trackPanel.js';
import { getArrangementEditor } from './arrangementEditor.js';
import { getModal } from './modal.js';

class TabsUI {
    constructor() {
        this.container = document.getElementById('tabs-container');
        this.addBtn = document.getElementById('add-song-btn');
        this.songPicker = document.getElementById('song-picker');
        this.songPickerList = document.getElementById('song-picker-list');
        
        // Arrangement selector
        this.arrangementSelector = document.getElementById('arrangement-selector');
        this.arrangementSelect = document.getElementById('arrangement-select');
        
        this.tabElements = new Map(); // songId -> element
        this.isPickerOpen = false;
        
        this.init();
        this.attachStateListeners();
    }

    init() {
        // Add song button - show picker dropdown
        // Using mousedown instead of click to avoid Edge browser event delay issues
        this.addBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
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
            if (e.key === 'Escape' && this.isPickerOpen) {
                this.closeSongPicker();
            }
        });
        
        // Arrangement select change handler
        if (this.arrangementSelect) {
            this.arrangementSelect.addEventListener('change', () => {
                const song = State.getActiveSong();
                if (!song) return;
                
                const value = this.arrangementSelect.value;
                
                if (value === '__new_custom__') {
                    // Open editor for new custom arrangement
                    const editor = getArrangementEditor();
                    editor.open(song.id, null);
                    // Reset select to current value
                    this.updateArrangementOptions(song);
                } else if (value === '__manage_custom__') {
                    // Open management dialog
                    this.openManageCustomDialog(song);
                    // Reset select to current value
                    this.updateArrangementOptions(song);
                } else if (value.startsWith('__custom__')) {
                    // Custom arrangement selected
                    const customId = value.replace('__custom__', '');
                    const customArr = State.getCustomArrangementById(song.songName, customId);
                    if (customArr) {
                        State.setArrangement(song.id, customArr.name, customId);
                    }
                } else {
                    // Metadata arrangement (including 'Default')
                    State.setArrangement(song.id, value, null);
                }
            });
        }
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

        State.subscribe(State.Events.SONG_SWITCHED, (song) => {
            this.updateActiveTab();
            this.updateArrangementSelector(song);
        });

        State.subscribe(State.Events.STATE_LOADED, () => {
            this.renderTabs();
            this.updateEmptyState();
            const song = State.getActiveSong();
            this.updateArrangementSelector(song);
        });
        
        // Update arrangement dropdown when metadata loads (arrangements come from metadata)
        State.subscribe(State.Events.SONG_METADATA_UPDATED, ({ song }) => {
            if (song.id === State.state.activeSongId) {
                this.updateArrangementOptions(song);
            }
        });
        
        // Update arrangement dropdown selection when arrangement changes
        State.subscribe(State.Events.ARRANGEMENT_CHANGED, ({ song, arrangementName, customId }) => {
            if (song.id === State.state.activeSongId && this.arrangementSelect) {
                // Set the correct value based on whether it's custom or not
                if (customId) {
                    this.arrangementSelect.value = '__custom__' + customId;
                } else {
                    this.arrangementSelect.value = arrangementName;
                }
            }
        });
        
        // Update arrangement dropdown when custom arrangements change
        State.subscribe(State.Events.CUSTOM_ARRANGEMENTS_UPDATED, ({ songName }) => {
            const song = State.getActiveSong();
            if (song && song.songName === songName) {
                this.updateArrangementOptions(song);
            }
        });
    }

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
        
        // Get available songs (not already open)
        const openSongNames = State.state.songs.map(s => s.songName);
        const allSongs = Manifest.getSongs();
        const availableSongs = allSongs.filter(s => !openSongNames.includes(s.name));
        
        // Populate picker list
        this.songPickerList.innerHTML = '';
        
        if (availableSongs.length === 0) {
            this.songPickerList.innerHTML = '<div class="picker-empty">All songs are already open</div>';
        } else {
            for (const song of availableSongs) {
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
     * Update empty state visibility
     */
    updateEmptyState() {
        const noSongEmptyState = document.getElementById('no-song-empty-state');
        const trackControlsPanel = document.getElementById('track-controls-panel');
        const waveformPanel = document.getElementById('waveform-panel');
        
        if (State.state.songs.length === 0) {
            // No songs open - show empty state, hide arrangement selector
            if (noSongEmptyState) noSongEmptyState.classList.remove('hidden');
            if (trackControlsPanel) trackControlsPanel.classList.add('hidden');
            if (waveformPanel) waveformPanel.classList.add('hidden');
            if (this.arrangementSelector) this.arrangementSelector.classList.add('hidden');
        } else {
            // Songs open - hide empty state
            if (noSongEmptyState) noSongEmptyState.classList.add('hidden');
            if (trackControlsPanel) trackControlsPanel.classList.remove('hidden');
            if (waveformPanel) waveformPanel.classList.remove('hidden');
            // Arrangement selector visibility handled by updateArrangementSelector
        }
    }

    /**
     * Render all tabs
     */
    renderTabs() {
        this.clear();
        
        for (const song of State.state.songs) {
            this.addTab(song);
        }
        
        this.updateActiveTab();
    }

    /**
     * Add a tab for a song
     */
    addTab(song) {
        const tab = document.createElement('div');
        tab.className = 'song-tab';
        tab.dataset.songId = song.id;
        
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
     * Clear all tabs
     */
    clear() {
        this.container.innerHTML = '';
        this.tabElements.clear();
    }

    /**
     * Update arrangement selector visibility and options
     * @param {Object|null} song - Active song or null
     */
    updateArrangementSelector(song) {
        if (!this.arrangementSelector) return;
        
        if (song) {
            // Show selector when a song is open
            this.arrangementSelector.classList.remove('hidden');
            this.updateArrangementOptions(song);
        } else {
            // Hide selector when no song is open
            this.arrangementSelector.classList.add('hidden');
        }
    }

    /**
     * Update arrangement dropdown options for a song
     * @param {Object} song - Song object
     */
    updateArrangementOptions(song) {
        if (!this.arrangementSelect) return;
        
        // Get available arrangements from metadata
        const metadataArrangements = State.getAvailableArrangements(song?.id);
        const currentArrangement = song?.arrangement?.name || 'Default';
        const currentCustomId = song?.arrangement?.customId || null;
        
        // Get custom arrangements
        const customArrangements = song ? State.getCustomArrangements(song.songName) : [];
        
        // Clear existing options
        this.arrangementSelect.innerHTML = '';
        
        // Add metadata arrangements
        metadataArrangements.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name === 'Default' ? 'Original' : name;
            if (name === currentArrangement && !currentCustomId) {
                option.selected = true;
            }
            this.arrangementSelect.appendChild(option);
        });
        
        // Add custom arrangements section if there are any
        if (customArrangements.length > 0) {
            // Add divider
            const divider = document.createElement('option');
            divider.disabled = true;
            divider.textContent = '── Custom ──';
            this.arrangementSelect.appendChild(divider);
            
            // Add custom arrangements
            customArrangements.forEach(arr => {
                const option = document.createElement('option');
                option.value = '__custom__' + arr.id;
                option.textContent = arr.name;
                if (currentCustomId === arr.id) {
                    option.selected = true;
                }
                this.arrangementSelect.appendChild(option);
            });
        }
        
        // Add action divider
        const actionDivider = document.createElement('option');
        actionDivider.disabled = true;
        actionDivider.textContent = '────────────';
        this.arrangementSelect.appendChild(actionDivider);
        
        // Add "New Custom..." option
        const newOption = document.createElement('option');
        newOption.value = '__new_custom__';
        newOption.textContent = '+ New Custom...';
        this.arrangementSelect.appendChild(newOption);
        
        // Add "Manage Custom..." option (only if there are custom arrangements)
        if (customArrangements.length > 0) {
            const manageOption = document.createElement('option');
            manageOption.value = '__manage_custom__';
            manageOption.textContent = 'Manage Custom...';
            this.arrangementSelect.appendChild(manageOption);
        }
    }
    
    /**
     * Open the manage custom arrangements dialog
     * @param {Object} song - Song object
     */
    async openManageCustomDialog(song) {
        const customArrangements = State.getCustomArrangements(song.songName);
        
        if (customArrangements.length === 0) {
            return;
        }
        
        const modal = getModal();
        const editor = getArrangementEditor();
        
        const listHtml = customArrangements.map(arr => `
            <div class="manage-arrangement-item" data-id="${arr.id}">
                <span class="manage-arrangement-name">${this.escapeHtml(arr.name)}</span>
                <div class="manage-arrangement-actions">
                    <button class="btn-icon edit-custom-btn" data-id="${arr.id}" title="Edit">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                    </button>
                    <button class="btn-icon delete-custom-btn" data-id="${arr.id}" title="Delete">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
        
        const content = `
            <div class="manage-arrangements-list">
                ${listHtml}
            </div>
        `;
        
        // Show modal and attach events after a tick
        modal.show({
            title: 'Manage Custom Arrangements',
            content: content,
            confirmText: 'Close',
            showCancel: false,
            confirmClass: 'btn-secondary'
        });
        
        // Attach events
        setTimeout(() => {
            const list = document.querySelector('.manage-arrangements-list');
            if (list) {
                list.addEventListener('click', async (e) => {
                    const editBtn = e.target.closest('.edit-custom-btn');
                    const deleteBtn = e.target.closest('.delete-custom-btn');
                    
                    if (editBtn) {
                        const customId = editBtn.dataset.id;
                        modal.close(true);
                        editor.open(song.id, customId);
                    } else if (deleteBtn) {
                        const customId = deleteBtn.dataset.id;
                        const arr = State.getCustomArrangementById(song.songName, customId);
                        if (arr) {
                            const confirmed = await modal.confirmDelete(arr.name);
                            if (confirmed) {
                                State.deleteCustomArrangement(song.songName, customId);
                                // Refresh the dialog
                                this.openManageCustomDialog(song);
                            }
                        }
                    }
                });
            }
        }, 0);
    }
    
    /**
     * Escape HTML for safe insertion
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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

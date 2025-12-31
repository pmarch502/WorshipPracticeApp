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
            if (this.isPickerOpen && !this.songPicker.contains(e.target) && e.target !== this.addBtn) {
                this.closeSongPicker();
            }
        });

        // Close picker on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isPickerOpen) {
                this.closeSongPicker();
            }
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

        State.subscribe(State.Events.SONG_RENAMED, (song) => {
            this.updateTabName(song.id, song.name);
        });

        State.subscribe(State.Events.SONG_SWITCHED, () => {
            this.updateActiveTab();
        });

        State.subscribe(State.Events.STATE_LOADED, () => {
            this.renderTabs();
            this.updateEmptyState();
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
            // No songs open - show empty state
            if (noSongEmptyState) noSongEmptyState.classList.remove('hidden');
            if (trackControlsPanel) trackControlsPanel.classList.add('hidden');
            if (waveformPanel) waveformPanel.classList.add('hidden');
        } else {
            // Songs open - hide empty state
            if (noSongEmptyState) noSongEmptyState.classList.add('hidden');
            if (trackControlsPanel) trackControlsPanel.classList.remove('hidden');
            if (waveformPanel) waveformPanel.classList.remove('hidden');
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
        
        // Double-click to rename
        const nameSpan = tab.querySelector('.song-tab-name');
        nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.startEditing(song.id);
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
     * Update tab name
     */
    updateTabName(songId, name) {
        const tab = this.tabElements.get(songId);
        if (tab) {
            const nameSpan = tab.querySelector('.song-tab-name');
            nameSpan.textContent = name;
            nameSpan.title = name;
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
     * Start inline editing of tab name
     */
    startEditing(songId) {
        const tab = this.tabElements.get(songId);
        if (!tab) return;
        
        const nameSpan = tab.querySelector('.song-tab-name');
        const currentName = nameSpan.textContent;
        
        // Make editable
        nameSpan.contentEditable = true;
        nameSpan.focus();
        
        // Select all text
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(nameSpan);
        selection.removeAllRanges();
        selection.addRange(range);
        
        const finishEditing = () => {
            nameSpan.contentEditable = false;
            const newName = nameSpan.textContent.trim();
            
            if (newName && newName !== currentName) {
                SongManager.renameSong(songId, newName);
            } else {
                nameSpan.textContent = currentName;
            }
        };
        
        // Handle blur
        nameSpan.addEventListener('blur', finishEditing, { once: true });
        
        // Handle Enter key
        nameSpan.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                nameSpan.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                nameSpan.textContent = currentName;
                nameSpan.blur();
            }
        });
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

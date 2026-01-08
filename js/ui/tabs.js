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
import { deleteArrangement } from '../api.js';
import { refreshMetadata, refreshMetadataWithRetry } from '../metadata.js';

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
        this._isRefreshing = false; // Track if metadata refresh is in progress
        
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
                
                if (value === '__refresh__') {
                    // Refresh metadata for active song
                    this.refreshSongMetadata(song.id);
                    // Reset select to current value
                    this.updateArrangementOptions(song);
                } else if (value === '__new_custom__') {
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
                } else if (value === '__manage_published__') {
                    // Open published arrangements management dialog
                    this.openManagePublishedDialog(song);
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
     * Set the refreshing state and update the Refresh option text
     * @param {boolean} isRefreshing - Whether a refresh is in progress
     */
    setRefreshingState(isRefreshing) {
        this._isRefreshing = isRefreshing;
        // Update the Refresh option text if it exists
        const refreshOption = this.arrangementSelect?.querySelector('.refresh-option');
        if (refreshOption) {
            refreshOption.textContent = isRefreshing ? 'Refreshing...' : 'Refresh';
        }
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
     * Refresh metadata for a song from the server
     * @param {string} songId - Song ID
     */
    async refreshSongMetadata(songId) {
        const song = State.getSong(songId);
        if (!song) return;
        
        // Get the refresh button and add spinning class for visual feedback
        const tab = this.tabElements.get(songId);
        const refreshBtn = tab?.querySelector('.song-tab-refresh');
        if (refreshBtn) {
            refreshBtn.classList.add('refreshing');
        }
        
        try {
            const newMetadata = await refreshMetadata(song.songName);
            if (newMetadata) {
                State.updateSongMetadata(songId, newMetadata);
                
                // If current arrangement no longer exists, switch to Default
                const freshSong = State.getSong(songId);
                const availableArrangements = State.getAvailableArrangements(songId);
                const currentArrangement = freshSong?.arrangement?.name || 'Default';
                const currentCustomId = freshSong?.arrangement?.customId;
                
                // Only check metadata arrangements (not custom)
                if (!currentCustomId && !availableArrangements.includes(currentArrangement)) {
                    State.setArrangement(songId, 'Default', null);
                }
            }
        } finally {
            // Remove spinning class
            if (refreshBtn) {
                refreshBtn.classList.remove('refreshing');
            }
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
        
        // Get published arrangements (from metadata.arrangements, excluding Default)
        const publishedArrangements = this.getPublishedArrangements(song);
        
        // Clear existing options
        this.arrangementSelect.innerHTML = '';
        
        // ─────────────────────────────────────────────────────────────────
        // REFRESH OPTION (at top)
        // ─────────────────────────────────────────────────────────────────
        
        const refreshOption = document.createElement('option');
        refreshOption.value = '__refresh__';
        refreshOption.className = 'refresh-option';
        refreshOption.textContent = this._isRefreshing ? 'Refreshing...' : 'Refresh';
        this.arrangementSelect.appendChild(refreshOption);
        
        const refreshDivider = document.createElement('option');
        refreshDivider.disabled = true;
        refreshDivider.textContent = '────────────';
        this.arrangementSelect.appendChild(refreshDivider);
        
        // ─────────────────────────────────────────────────────────────────
        // PUBLISHED SECTION
        // ─────────────────────────────────────────────────────────────────
        
        // Add "── Published ──" header
        const publishedHeader = document.createElement('option');
        publishedHeader.disabled = true;
        publishedHeader.textContent = '── Published ──';
        this.arrangementSelect.appendChild(publishedHeader);
        
        // Add metadata arrangements (Original + any published)
        metadataArrangements.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name === 'Default' ? 'Original' : name;
            if (name === currentArrangement && !currentCustomId) {
                option.selected = true;
            }
            this.arrangementSelect.appendChild(option);
        });
        
        // Add "Manage Published..." option (only if there are published arrangements)
        if (publishedArrangements.length > 0) {
            const publishedDivider = document.createElement('option');
            publishedDivider.disabled = true;
            publishedDivider.textContent = '────────────';
            this.arrangementSelect.appendChild(publishedDivider);
            
            const managePublishedOption = document.createElement('option');
            managePublishedOption.value = '__manage_published__';
            managePublishedOption.textContent = 'Manage Published...';
            this.arrangementSelect.appendChild(managePublishedOption);
        }
        
        // Add blank spacer between sections (always)
        const spacer = document.createElement('option');
        spacer.disabled = true;
        spacer.textContent = '';
        this.arrangementSelect.appendChild(spacer);
        
        // ─────────────────────────────────────────────────────────────────
        // CUSTOM SECTION
        // ─────────────────────────────────────────────────────────────────
        
        // Add "── Custom ──" header (always)
        const customHeader = document.createElement('option');
        customHeader.disabled = true;
        customHeader.textContent = '── Custom ──';
        this.arrangementSelect.appendChild(customHeader);
        
        // Add custom arrangements if there are any
        if (customArrangements.length > 0) {
            customArrangements.forEach(arr => {
                const option = document.createElement('option');
                option.value = '__custom__' + arr.id;
                option.textContent = arr.name;
                if (currentCustomId === arr.id) {
                    option.selected = true;
                }
                this.arrangementSelect.appendChild(option);
            });
            
            // Add divider before actions
            const customDivider = document.createElement('option');
            customDivider.disabled = true;
            customDivider.textContent = '────────────';
            this.arrangementSelect.appendChild(customDivider);
        }
        
        // Add "+ New Custom..." option (always)
        const newOption = document.createElement('option');
        newOption.value = '__new_custom__';
        newOption.textContent = '+ New Custom...';
        this.arrangementSelect.appendChild(newOption);
        
        // Add "Manage Custom..." option (only if there are custom arrangements)
        if (customArrangements.length > 0) {
            const manageCustomOption = document.createElement('option');
            manageCustomOption.value = '__manage_custom__';
            manageCustomOption.textContent = 'Manage Custom...';
            this.arrangementSelect.appendChild(manageCustomOption);
        }
    }
    
    /**
     * Get published arrangements (from metadata, excluding Default)
     * @param {Object} song - Song object
     * @returns {Array} Array of published arrangement objects
     */
    getPublishedArrangements(song) {
        if (!song?.metadata?.arrangements) return [];
        return song.metadata.arrangements;
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
                                // Dialog closes automatically, dropdown updates via CUSTOM_ARRANGEMENTS_UPDATED event
                            }
                        }
                    }
                });
            }
        }, 0);
    }
    
    /**
     * Open the manage published arrangements dialog
     * @param {Object} song - Song object
     */
    async openManagePublishedDialog(song) {
        const publishedArrangements = this.getPublishedArrangements(song);
        
        if (publishedArrangements.length === 0) {
            return;
        }
        
        const modal = getModal();
        
        const listHtml = publishedArrangements.map(arr => `
            <div class="manage-arrangement-item" data-name="${this.escapeHtml(arr.name)}">
                <span class="manage-arrangement-name">${this.escapeHtml(arr.name)}</span>
                <div class="manage-arrangement-actions">
                    <button class="btn-icon delete-published-btn" data-name="${this.escapeHtml(arr.name)}" title="Delete">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
        
        const content = `
            <p style="margin-bottom: 12px; color: var(--text-secondary);">
                Deleting a published arrangement removes it for all users.
            </p>
            <div class="manage-arrangements-list">
                ${listHtml}
            </div>
        `;
        
        modal.show({
            title: 'Manage Published Arrangements',
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
                    const deleteBtn = e.target.closest('.delete-published-btn');
                    
                    if (deleteBtn) {
                        const arrangementName = deleteBtn.dataset.name;
                        await this.deletePublishedArrangement(song, arrangementName, modal);
                    }
                });
            }
        }, 0);
    }
    
    /**
     * Delete a published arrangement
     * @param {Object} song - Song object
     * @param {string} arrangementName - Name of the arrangement to delete
     * @param {Object} modal - Modal instance
     */
    async deletePublishedArrangement(song, arrangementName, modal) {
        // First, prompt for secret
        const secret = await this.promptForSecret('Delete Published Arrangement');
        if (!secret) {
            // User cancelled - reopen the manage dialog
            this.openManagePublishedDialog(song);
            return;
        }
        
        // Then confirm deletion
        const confirmed = await modal.confirm({
            title: 'Delete Published Arrangement',
            message: `<p>Delete arrangement "<strong>${this.escapeHtml(arrangementName)}</strong>" from "<strong>${this.escapeHtml(song.songName)}</strong>"?</p><p>This will remove it for all users. This cannot be undone.</p>`,
            confirmText: 'Delete',
            confirmClass: 'btn-danger'
        });
        
        if (!confirmed) {
            // User cancelled - reopen the manage dialog
            this.openManagePublishedDialog(song);
            return;
        }
        
        // Store song id and name for later use (song reference may become stale)
        const songId = song.id;
        const songName = song.songName;
        
        // Attempt to delete
        try {
            await deleteArrangement(songName, arrangementName, secret);
            
            // Success - refresh metadata with retry (wait for CloudFront invalidation)
            this.setRefreshingState(true);
            const newMetadata = await refreshMetadataWithRetry(
                songName,
                (meta) => !meta?.arrangements?.some(a => a.name === arrangementName)
            );
            this.setRefreshingState(false);
            
            if (newMetadata) {
                State.updateSongMetadata(songId, newMetadata);
            }
            
            // Get fresh song reference after metadata update
            const updatedSong = State.getSong(songId);
            
            // If the deleted arrangement was active, switch to Default
            if (updatedSong?.arrangement?.name === arrangementName && !updatedSong?.arrangement?.customId) {
                State.setArrangement(songId, 'Default', null);
            }
            
            // Explicitly update dropdown to reflect changes
            this.updateArrangementOptions(State.getSong(songId));
            
            // TODO: Re-enable if not interfering with UI updates
            // await modal.alert({
            //     title: 'Deleted',
            //     message: `Arrangement "${arrangementName}" has been deleted.`
            // });
            
            // Dialog closes automatically, no re-open
        } catch (error) {
            this.setRefreshingState(false);
            console.error('Delete failed:', error);
            
            if (error.status === 401) {
                await modal.alert({
                    title: 'Invalid Secret',
                    message: 'The admin secret is incorrect. Please try again.'
                });
                // Re-open manage dialog so user can try again
                this.openManagePublishedDialog(State.getSong(songId));
            } else if (error.status === 404) {
                await modal.alert({
                    title: 'Not Found',
                    message: `Arrangement "${arrangementName}" was not found. It may have already been deleted.`
                });
                // Refresh metadata anyway since it was already deleted
                const newMetadata = await refreshMetadata(songName);
                if (newMetadata) {
                    State.updateSongMetadata(songId, newMetadata);
                }
                this.updateArrangementOptions(State.getSong(songId));
                // No re-open - item is gone
            } else {
                await modal.alert({
                    title: 'Delete Failed',
                    message: `Failed to delete arrangement: ${error.message}`
                });
                // Re-open manage dialog so user can try again
                this.openManagePublishedDialog(State.getSong(songId));
            }
        }
    }
    
    /**
     * Prompt user for admin secret
     * @param {string} title - Dialog title
     * @returns {Promise<string|null>} - Secret or null if cancelled
     */
    async promptForSecret(title) {
        const modal = getModal();
        
        return new Promise((resolve) => {
            const content = `
                <p>Enter the admin secret to continue:</p>
                <input type="password" 
                       id="admin-secret-input" 
                       placeholder="Admin secret"
                       style="width: 100%; padding: 8px; margin-top: 8px; 
                              background: var(--bg-tertiary); 
                              border: 1px solid var(--border-color); 
                              border-radius: 4px; 
                              color: var(--text-primary);
                              font-size: 14px;">
            `;

            modal.show({
                title: title,
                content: content,
                confirmText: 'Continue',
                cancelText: 'Cancel',
                confirmClass: 'btn-primary',
                showCancel: true,
                onShow: () => {
                    const input = document.getElementById('admin-secret-input');
                    if (input) {
                        setTimeout(() => input.focus(), 50);
                        input.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                modal.close(true);
                            }
                        });
                    }
                },
                onConfirm: () => {
                    const input = document.getElementById('admin-secret-input');
                    resolve(input?.value || null);
                },
                onCancel: () => {
                    resolve(null);
                }
            });
        });
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

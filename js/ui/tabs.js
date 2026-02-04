/**
 * Tabs UI
 * Song tab bar management with manifest-based song selection
 * and hierarchical dropdown menu for arrangements and mute sets (Phase 6)
 */

import * as State from '../state.js';
import * as SongManager from '../songManager.js';
import * as Manifest from '../manifest.js';
import { getTrackPanel } from './trackPanel.js';
import { getModal } from './modal.js';
import { 
    listArrangements, 
    getArrangement, 
    saveArrangement, 
    deleteArrangement,
    listMuteSets,
    getMuteSet,
    saveMuteSet,
    deleteMuteSet,
    validateName,
    checkArrangementExists,
    checkMuteSetExists
} from '../api.js';

class TabsUI {
    constructor() {
        this.container = document.getElementById('tabs-container');
        this.addBtn = document.getElementById('add-song-btn');
        this.songPicker = document.getElementById('song-picker');
        this.songPickerList = document.getElementById('song-picker-list');
        
        // Dropdown elements
        this.arrangementSelector = document.getElementById('arrangement-selector');
        this.dropdownBtn = document.getElementById('arrangement-dropdown-btn');
        this.dropdownBtnText = this.dropdownBtn?.querySelector('.dropdown-btn-text');
        this.dropdownMenu = document.getElementById('arrangement-dropdown-menu');
        
        this.tabElements = new Map(); // songId -> element
        this.isPickerOpen = false;
        this.isDropdownOpen = false;
        this._isRefreshing = false;
        
        // Cache for API data
        this.arrangementCache = new Map(); // songName -> { data: string[], timestamp: number }
        this.muteSetCache = new Map(); // songName -> { data: string[], timestamp: number }
        this.CACHE_TTL = 60000; // 1 minute cache
        
        // Active submenu tracking
        this.activeSubmenu = null;
        this.submenuTimeout = null;
        
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
            
            // Close dropdown when clicking outside
            if (this.isDropdownOpen && 
                !this.dropdownMenu?.contains(e.target) && 
                !this.dropdownBtn?.contains(e.target)) {
                this.closeDropdown();
            }
        });

        // Close picker/dropdown on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isPickerOpen) {
                    this.closeSongPicker();
                }
                if (this.isDropdownOpen) {
                    this.closeDropdown();
                }
            }
        });
        
        // Dropdown button click handler
        if (this.dropdownBtn) {
            this.dropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleDropdown();
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
            this.updateDropdownSelector(song);
        });

        State.subscribe(State.Events.STATE_LOADED, () => {
            this.renderTabs();
            this.updateEmptyState();
            const song = State.getActiveSong();
            this.updateDropdownSelector(song);
        });
        
        // Update dropdown when arrangement sections change (modified indicator)
        State.subscribe(State.Events.ARRANGEMENT_SECTIONS_CHANGED, () => {
            const song = State.getActiveSong();
            if (song) {
                this.updateDropdownButtonText(song);
            }
        });
        
        // Update dropdown when mute sections change (modified indicator)
        State.subscribe(State.Events.MUTE_SECTIONS_CHANGED, () => {
            const song = State.getActiveSong();
            if (song) {
                this.updateDropdownButtonText(song);
            }
        });
    }

    // ========================================
    // Dropdown Menu Management
    // ========================================
    
    /**
     * Toggle the dropdown menu open/closed
     */
    toggleDropdown() {
        if (this.isDropdownOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }
    
    /**
     * Open the dropdown menu
     */
    openDropdown() {
        const song = State.getActiveSong();
        if (!song || !this.dropdownMenu) return;
        
        this.isDropdownOpen = true;
        this.dropdownBtn?.classList.add('open');
        this.dropdownMenu.classList.remove('hidden');
        
        // Render the main menu
        this.renderMainMenu(song);
    }
    
    /**
     * Close the dropdown menu
     */
    closeDropdown() {
        this.isDropdownOpen = false;
        this.dropdownBtn?.classList.remove('open');
        this.dropdownMenu?.classList.add('hidden');
        this.closeAllSubmenus();
    }
    
    /**
     * Update the dropdown selector visibility and button text
     * @param {Object|null} song - Active song or null
     */
    updateDropdownSelector(song) {
        if (!this.arrangementSelector) return;
        
        if (song) {
            this.arrangementSelector.classList.remove('hidden');
            this.updateDropdownButtonText(song);
        } else {
            this.arrangementSelector.classList.add('hidden');
        }
    }
    
    /**
     * Update the dropdown button text based on current state
     * @param {Object} song - Song object
     */
    updateDropdownButtonText(song) {
        if (!this.dropdownBtnText) return;
        
        const arrName = State.getCurrentArrangementDisplayName();
        const muteName = State.getCurrentMuteSetDisplayName();
        const arrModified = State.isArrangementModified();
        const muteModified = State.isMuteSetModified();
        
        // Build display text
        let text = arrName || 'Original';
        if (arrModified) text += ' *';
        
        // Add mute set info if not "None"
        if (muteName && muteName !== 'None') {
            text += ` / ${muteName}`;
            if (muteModified) text += ' *';
        }
        
        this.dropdownBtnText.textContent = text;
    }
    
    /**
     * Render the main dropdown menu
     * @param {Object} song - Song object
     */
    renderMainMenu(song) {
        if (!this.dropdownMenu) return;
        
        this.dropdownMenu.innerHTML = '';
        
        // Refresh option
        const refreshItem = this.createMenuItem('Refresh', () => this.handleRefresh(song), false);
        refreshItem.id = 'dropdown-refresh-item';
        this.dropdownMenu.appendChild(refreshItem);
        
        this.dropdownMenu.appendChild(this.createDivider());
        
        // Arrangements submenu
        const arrangementsItem = this.createSubmenuItem('Arrangements', 'arrangements-submenu');
        this.dropdownMenu.appendChild(arrangementsItem);
        
        // Mutes submenu
        const mutesItem = this.createSubmenuItem('Mutes', 'mutes-submenu');
        this.dropdownMenu.appendChild(mutesItem);
    }
    
    /**
     * Create a standard menu item
     * @param {string} label - Item label
     * @param {Function} onClick - Click handler
     * @param {boolean} showCheckmark - Whether to show checkmark space
     * @returns {HTMLElement}
     */
    createMenuItem(label, onClick, showCheckmark = true) {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        
        if (showCheckmark) {
            const checkmark = document.createElement('span');
            checkmark.className = 'checkmark hidden';
            checkmark.innerHTML = '&#10003;'; // ✓
            item.appendChild(checkmark);
        }
        
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        item.appendChild(labelSpan);
        
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
            this.closeDropdown();
        });
        
        return item;
    }
    
    /**
     * Create a submenu trigger item
     * @param {string} label - Item label
     * @param {string} submenuId - Submenu identifier
     * @returns {HTMLElement}
     */
    createSubmenuItem(label, submenuId) {
        const item = document.createElement('div');
        item.className = 'dropdown-item has-submenu';
        item.dataset.submenu = submenuId;
        
        // Arrow on left side since submenu opens to the left
        const arrow = document.createElement('span');
        arrow.className = 'submenu-arrow';
        arrow.textContent = '◀';
        item.appendChild(arrow);
        
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        item.appendChild(labelSpan);
        
        // Create submenu container
        const submenu = document.createElement('div');
        submenu.className = 'dropdown-submenu hidden';
        submenu.id = submenuId;
        item.appendChild(submenu);
        
        // Click handler for mobile support
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Toggle submenu
            if (submenu.classList.contains('hidden')) {
                this.showSubmenu(item, submenu, submenuId);
            } else {
                submenu.classList.add('hidden');
                item.classList.remove('submenu-open');
            }
        });
        
        // Hover handlers for desktop
        item.addEventListener('mouseenter', () => {
            this.showSubmenu(item, submenu, submenuId);
        });
        
        item.addEventListener('mouseleave', (e) => {
            // Check if moving to submenu
            const relatedTarget = e.relatedTarget;
            if (submenu.contains(relatedTarget)) return;
            
            this.scheduleSubmenuClose(submenu);
        });
        
        submenu.addEventListener('mouseenter', () => {
            this.cancelSubmenuClose();
        });
        
        submenu.addEventListener('mouseleave', (e) => {
            // Check if moving back to parent item
            if (item.contains(e.relatedTarget)) return;
            this.scheduleSubmenuClose(submenu);
        });
        
        // Prevent clicks inside submenu from closing it
        submenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        return item;
    }
    
    /**
     * Show a submenu
     * @param {HTMLElement} parentItem - Parent menu item
     * @param {HTMLElement} submenu - Submenu element
     * @param {string} submenuId - Submenu identifier
     */
    async showSubmenu(parentItem, submenu, submenuId) {
        this.cancelSubmenuClose();
        
        // Close other submenus
        if (this.activeSubmenu && this.activeSubmenu !== submenu) {
            this.activeSubmenu.classList.add('hidden');
            this.activeSubmenu.parentElement?.classList.remove('submenu-open');
        }
        
        this.activeSubmenu = submenu;
        parentItem.classList.add('submenu-open');
        submenu.classList.remove('hidden');
        
        // Position the submenu
        this.positionSubmenu(parentItem, submenu);
        
        // Populate submenu based on type
        const song = State.getActiveSong();
        if (!song) return;
        
        if (submenuId === 'arrangements-submenu') {
            await this.populateArrangementsSubmenu(submenu, song);
        } else if (submenuId === 'mutes-submenu') {
            await this.populateMutesSubmenu(submenu, song);
        }
    }
    
    /**
     * Position submenu to avoid going off-screen
     * Default is to open left (since dropdown is on far right)
     * @param {HTMLElement} parentItem - Parent menu item
     * @param {HTMLElement} submenu - Submenu element
     */
    positionSubmenu(parentItem, submenu) {
        // Reset positioning (default opens left)
        submenu.classList.remove('position-right');
        
        const rect = parentItem.getBoundingClientRect();
        const submenuWidth = submenu.offsetWidth || 180; // Use actual width or min-width
        
        // Check if submenu would go off LEFT edge - if so, open to the right instead
        if (rect.left - submenuWidth < 10) {
            submenu.classList.add('position-right');
        }
    }
    
    /**
     * Schedule submenu close with delay
     * @param {HTMLElement} submenu - Submenu element
     */
    scheduleSubmenuClose(submenu) {
        this.submenuTimeout = setTimeout(() => {
            submenu.classList.add('hidden');
            submenu.parentElement?.classList.remove('submenu-open');
            if (this.activeSubmenu === submenu) {
                this.activeSubmenu = null;
            }
        }, 150);
    }
    
    /**
     * Cancel scheduled submenu close
     */
    cancelSubmenuClose() {
        if (this.submenuTimeout) {
            clearTimeout(this.submenuTimeout);
            this.submenuTimeout = null;
        }
    }
    
    /**
     * Close all open submenus
     */
    closeAllSubmenus() {
        this.cancelSubmenuClose();
        const submenus = this.dropdownMenu?.querySelectorAll('.dropdown-submenu');
        submenus?.forEach(submenu => {
            submenu.classList.add('hidden');
            submenu.parentElement?.classList.remove('submenu-open');
        });
        this.activeSubmenu = null;
    }
    
    /**
     * Create a divider element
     * @returns {HTMLElement}
     */
    createDivider() {
        const divider = document.createElement('div');
        divider.className = 'dropdown-divider';
        return divider;
    }
    
    /**
     * Create a section header
     * @param {string} text - Header text
     * @returns {HTMLElement}
     */
    createSectionHeader(text) {
        const header = document.createElement('div');
        header.className = 'dropdown-section-header';
        header.textContent = text;
        return header;
    }
    
    /**
     * Create loading indicator
     * @returns {HTMLElement}
     */
    createLoadingIndicator() {
        const loading = document.createElement('div');
        loading.className = 'dropdown-loading';
        loading.textContent = 'Loading...';
        return loading;
    }
    
    /**
     * Create empty state message
     * @param {string} message - Message to display
     * @returns {HTMLElement}
     */
    createEmptyState(message) {
        const empty = document.createElement('div');
        empty.className = 'dropdown-empty';
        empty.textContent = message;
        return empty;
    }
    
    // ========================================
    // Arrangements Submenu (Chunk 6.3, 6.4, 6.5)
    // ========================================
    
    /**
     * Populate the arrangements submenu
     * @param {HTMLElement} submenu - Submenu element
     * @param {Object} song - Song object
     */
    async populateArrangementsSubmenu(submenu, song) {
        submenu.innerHTML = '';
        
        // Show loading
        submenu.appendChild(this.createLoadingIndicator());
        
        try {
            // Fetch arrangements from API (with cache)
            const arrangements = await this.fetchArrangements(song.songName);
            
            submenu.innerHTML = '';
            
            const currentArrName = State.getCurrentArrangementDisplayName();
            const arrModified = State.isArrangementModified();
            
            // "Original (Full Song)" option at the top
            const originalItem = this.createMenuItem('Original (Full Song)', () => this.selectOriginalArrangement(song));
            if (!currentArrName || currentArrName === 'Original') {
                originalItem.classList.add('active');
                const checkmark = originalItem.querySelector('.checkmark');
                if (checkmark) checkmark.classList.remove('hidden');
            }
            submenu.appendChild(originalItem);
            
            // List of saved arrangements
            if (arrangements.length > 0) {
                submenu.appendChild(this.createDivider());
                
                arrangements.forEach(name => {
                    const item = this.createMenuItem(name, () => this.selectArrangement(song, name));
                    if (currentArrName === name) {
                        item.classList.add('active');
                        const checkmark = item.querySelector('.checkmark');
                        if (checkmark) checkmark.classList.remove('hidden');
                    }
                    submenu.appendChild(item);
                });
            }
            
            // Divider and actions
            submenu.appendChild(this.createDivider());
            
            // Save option (enabled if modified and has a name)
            const saveItem = this.createMenuItem('Save', () => this.saveCurrentArrangement(song), false);
            if (!arrModified || !currentArrName || currentArrName === 'Original') {
                saveItem.classList.add('disabled');
            }
            submenu.appendChild(saveItem);
            
            // Save As option
            const saveAsItem = this.createMenuItem('Save As...', () => this.saveArrangementAs(song), false);
            submenu.appendChild(saveAsItem);
            
            // Only show Delete if there are arrangements
            if (arrangements.length > 0) {
                submenu.appendChild(this.createDivider());
                
                // Delete submenu
                const deleteItem = this.createNestedSubmenuItem('Delete', 'arr-delete-submenu', async (nestedSubmenu) => {
                    await this.populateDeleteArrangementsSubmenu(nestedSubmenu, song, arrangements);
                });
                submenu.appendChild(deleteItem);
            }
            
        } catch (error) {
            console.error('Failed to load arrangements:', error);
            submenu.innerHTML = '';
            submenu.appendChild(this.createEmptyState('Failed to load'));
        }
    }
    
    /**
     * Create a nested submenu item (for Edit/Delete submenus)
     * @param {string} label - Item label
     * @param {string} submenuId - Submenu identifier
     * @param {Function} populateFn - Function to populate the nested submenu
     * @returns {HTMLElement}
     */
    createNestedSubmenuItem(label, submenuId, populateFn) {
        const item = document.createElement('div');
        item.className = 'dropdown-item has-submenu';
        item.dataset.submenu = submenuId;
        
        // Arrow on left side since submenu opens to the left
        const arrow = document.createElement('span');
        arrow.className = 'submenu-arrow';
        arrow.textContent = '◀';
        item.appendChild(arrow);
        
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        item.appendChild(labelSpan);
        
        // Create nested submenu container
        const nestedSubmenu = document.createElement('div');
        nestedSubmenu.className = 'dropdown-submenu hidden';
        nestedSubmenu.id = submenuId;
        item.appendChild(nestedSubmenu);
        
        let populated = false;
        
        // Click handler for mobile support
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            // Toggle submenu
            if (nestedSubmenu.classList.contains('hidden')) {
                this.cancelSubmenuClose();
                nestedSubmenu.classList.remove('hidden');
                item.classList.add('submenu-open');
                this.positionSubmenu(item, nestedSubmenu);
                
                if (!populated) {
                    await populateFn(nestedSubmenu);
                    populated = true;
                }
            } else {
                nestedSubmenu.classList.add('hidden');
                item.classList.remove('submenu-open');
            }
        });
        
        // Hover handlers for desktop
        item.addEventListener('mouseenter', async () => {
            this.cancelSubmenuClose();
            nestedSubmenu.classList.remove('hidden');
            item.classList.add('submenu-open');
            this.positionSubmenu(item, nestedSubmenu);
            
            if (!populated) {
                await populateFn(nestedSubmenu);
                populated = true;
            }
        });
        
        item.addEventListener('mouseleave', (e) => {
            if (nestedSubmenu.contains(e.relatedTarget)) return;
            this.scheduleNestedSubmenuClose(nestedSubmenu, item);
        });
        
        nestedSubmenu.addEventListener('mouseenter', () => {
            this.cancelSubmenuClose();
        });
        
        nestedSubmenu.addEventListener('mouseleave', (e) => {
            if (item.contains(e.relatedTarget)) return;
            this.scheduleNestedSubmenuClose(nestedSubmenu, item);
        });
        
        // Prevent clicks inside nested submenu from closing it
        nestedSubmenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        return item;
    }
    
    /**
     * Schedule nested submenu close
     */
    scheduleNestedSubmenuClose(submenu, parentItem) {
        this.submenuTimeout = setTimeout(() => {
            submenu.classList.add('hidden');
            parentItem.classList.remove('submenu-open');
        }, 150);
    }
    
    /**
     * Populate delete arrangements submenu
     */
    async populateDeleteArrangementsSubmenu(submenu, song, arrangements) {
        submenu.innerHTML = '';
        
        arrangements.forEach(name => {
            const item = this.createMenuItem(name, () => this.deleteArrangementWithConfirm(song, name), false);
            submenu.appendChild(item);
        });
    }
    
    /**
     * Fetch arrangements with caching
     * @param {string} songName - Song name
     * @param {boolean} forceRefresh - Force refresh from server
     * @returns {Promise<string[]>}
     */
    async fetchArrangements(songName, forceRefresh = false) {
        const cached = this.arrangementCache.get(songName);
        const now = Date.now();
        
        if (!forceRefresh && cached && (now - cached.timestamp) < this.CACHE_TTL) {
            return cached.data;
        }
        
        const data = await listArrangements(songName);
        this.arrangementCache.set(songName, { data, timestamp: now });
        return data;
    }
    
    /**
     * Select Original arrangement
     */
    selectOriginalArrangement(song) {
        // Reset to original (full song, no splits)
        State.initializeOriginalArrangement();
        State.setArrangementModified(false);
        // Clear current arrangement name/id - these need to be set in state
        const activeSong = State.getActiveSong();
        if (activeSong) {
            activeSong.currentArrangementId = null;
            activeSong.currentArrangementName = null;
        }
        this.updateDropdownButtonText(song);
    }
    
    /**
     * Select a saved arrangement
     */
    async selectArrangement(song, name) {
        try {
            const arrangement = await getArrangement(song.songName, name);
            
            // Apply arrangement sections to state
            State.setArrangementSections(arrangement.sections, false);
            State.setArrangementModified(false);
            
            // Set current arrangement info
            const activeSong = State.getActiveSong();
            if (activeSong) {
                activeSong.currentArrangementId = name;
                activeSong.currentArrangementName = name;
            }
            
            this.updateDropdownButtonText(song);
        } catch (error) {
            console.error('Failed to load arrangement:', error);
            const modal = getModal();
            await modal.alert({
                title: 'Error',
                message: `Failed to load arrangement: ${error.message}`
            });
        }
    }
    
    /**
     * Save current arrangement (overwrite)
     */
    async saveCurrentArrangement(song) {
        const currentName = State.getCurrentArrangementDisplayName();
        if (!currentName || currentName === 'Original') return;
        
        const sections = State.getArrangementSections();
        
        try {
            await saveArrangement(song.songName, currentName, { sections });
            State.setArrangementModified(false);
            this.invalidateArrangementCache(song.songName);
            this.updateDropdownButtonText(song);
        } catch (error) {
            console.error('Failed to save arrangement:', error);
            const modal = getModal();
            await modal.alert({
                title: 'Error',
                message: `Failed to save arrangement: ${error.message}`
            });
        }
    }
    
    /**
     * Save arrangement as new name
     */
    async saveArrangementAs(song) {
        this.closeDropdown();
        
        const result = await this.showSaveDialog('arrangement', song);
        if (!result) return;
        
        const { name, isProtected, secret } = result;
        const sections = State.getArrangementSections();
        
        try {
            const data = { sections, protected: isProtected };
            if (secret) data.secret = secret;
            
            await saveArrangement(song.songName, name, data);
            
            // Update current arrangement info
            const activeSong = State.getActiveSong();
            if (activeSong) {
                activeSong.currentArrangementId = name;
                activeSong.currentArrangementName = name;
            }
            
            State.setArrangementModified(false);
            this.invalidateArrangementCache(song.songName);
            this.updateDropdownButtonText(song);
        } catch (error) {
            console.error('Failed to save arrangement:', error);
            const modal = getModal();
            await modal.alert({
                title: 'Error',
                message: `Failed to save arrangement: ${error.message}`
            });
        }
    }
    
    /**
     * Delete arrangement with confirmation
     */
    async deleteArrangementWithConfirm(song, name) {
        this.closeDropdown();
        
        const modal = getModal();
        
        // First check if protected
        let arrangement;
        try {
            arrangement = await getArrangement(song.songName, name);
        } catch (error) {
            await modal.alert({
                title: 'Error',
                message: `Failed to load arrangement: ${error.message}`
            });
            return;
        }
        
        let secret = null;
        if (arrangement.protected) {
            secret = await this.promptForSecret('Delete Protected Arrangement');
            if (!secret) return; // User cancelled
        }
        
        const confirmed = await modal.confirm({
            title: 'Delete Arrangement',
            message: `<p>Delete arrangement "<strong>${this.escapeHtml(name)}</strong>"?</p><p>This cannot be undone.</p>`,
            confirmText: 'Delete',
            confirmClass: 'btn-danger'
        });
        
        if (!confirmed) return;
        
        try {
            await deleteArrangement(song.songName, name, secret);
            this.invalidateArrangementCache(song.songName);
            
            // If deleted the current arrangement, reset to Original
            if (State.getCurrentArrangementDisplayName() === name) {
                this.selectOriginalArrangement(song);
            }
        } catch (error) {
            console.error('Failed to delete arrangement:', error);
            if (error.status === 403) {
                await modal.alert({
                    title: 'Invalid Secret',
                    message: 'The admin secret is incorrect.'
                });
            } else {
                await modal.alert({
                    title: 'Error',
                    message: `Failed to delete arrangement: ${error.message}`
                });
            }
        }
    }
    
    /**
     * Invalidate arrangement cache for a song
     */
    invalidateArrangementCache(songName) {
        this.arrangementCache.delete(songName);
    }
    
    // ========================================
    // Mutes Submenu (Chunk 6.6, 6.7)
    // ========================================
    
    /**
     * Populate the mutes submenu
     * @param {HTMLElement} submenu - Submenu element
     * @param {Object} song - Song object
     */
    async populateMutesSubmenu(submenu, song) {
        submenu.innerHTML = '';
        
        // Show loading
        submenu.appendChild(this.createLoadingIndicator());
        
        try {
            // Fetch mute sets from API (with cache)
            const muteSets = await this.fetchMuteSets(song.songName);
            
            submenu.innerHTML = '';
            
            const currentMuteName = State.getCurrentMuteSetDisplayName();
            const muteModified = State.isMuteSetModified();
            
            // "None" option at the top
            const noneItem = this.createMenuItem('None (All Unmuted)', () => this.selectNoneMuteSet(song));
            if (!currentMuteName || currentMuteName === 'None') {
                noneItem.classList.add('active');
                const checkmark = noneItem.querySelector('.checkmark');
                if (checkmark) checkmark.classList.remove('hidden');
            }
            submenu.appendChild(noneItem);
            
            // List of mute sets
            if (muteSets.length > 0) {
                submenu.appendChild(this.createDivider());
                
                muteSets.forEach(name => {
                    const item = this.createMenuItem(name, () => this.selectMuteSet(song, name));
                    if (currentMuteName === name) {
                        item.classList.add('active');
                        const checkmark = item.querySelector('.checkmark');
                        if (checkmark) checkmark.classList.remove('hidden');
                    }
                    submenu.appendChild(item);
                });
            }
            
            // Divider and actions
            submenu.appendChild(this.createDivider());
            
            // Save option (enabled if modified and has a name)
            const saveItem = this.createMenuItem('Save', () => this.saveCurrentMuteSet(song), false);
            if (!muteModified || !currentMuteName || currentMuteName === 'None') {
                saveItem.classList.add('disabled');
            }
            submenu.appendChild(saveItem);
            
            // Save As option
            const saveAsItem = this.createMenuItem('Save As...', () => this.saveMuteSetAs(song), false);
            submenu.appendChild(saveAsItem);
            
            // Only show Delete if there are mute sets
            if (muteSets.length > 0) {
                submenu.appendChild(this.createDivider());
                
                // Delete submenu
                const deleteItem = this.createNestedSubmenuItem('Delete', 'mute-delete-submenu', async (nestedSubmenu) => {
                    await this.populateDeleteMuteSetsSubmenu(nestedSubmenu, song, muteSets);
                });
                submenu.appendChild(deleteItem);
            }
            
        } catch (error) {
            console.error('Failed to load mute sets:', error);
            submenu.innerHTML = '';
            submenu.appendChild(this.createEmptyState('Failed to load'));
        }
    }
    
    /**
     * Populate delete mute sets submenu
     */
    async populateDeleteMuteSetsSubmenu(submenu, song, muteSets) {
        submenu.innerHTML = '';
        
        muteSets.forEach(name => {
            const item = this.createMenuItem(name, () => this.deleteMuteSetWithConfirm(song, name), false);
            submenu.appendChild(item);
        });
    }
    
    /**
     * Fetch mute sets with caching
     */
    async fetchMuteSets(songName, forceRefresh = false) {
        const cached = this.muteSetCache.get(songName);
        const now = Date.now();
        
        if (!forceRefresh && cached && (now - cached.timestamp) < this.CACHE_TTL) {
            return cached.data;
        }
        
        const data = await listMuteSets(songName);
        this.muteSetCache.set(songName, { data, timestamp: now });
        return data;
    }
    
    /**
     * Select None (clear mutes)
     */
    selectNoneMuteSet(song) {
        // Reset all mute sections to default unmuted state
        State.resetAllMuteSections();
        State.setMuteSetModified(false);
        
        // Clear current mute set info
        const activeSong = State.getActiveSong();
        if (activeSong) {
            activeSong.currentMuteSetId = null;
            activeSong.currentMuteSetName = null;
        }
        
        this.updateDropdownButtonText(song);
    }
    
    /**
     * Select a saved mute set
     */
    async selectMuteSet(song, name) {
        try {
            const muteSet = await getMuteSet(song.songName, name);
            
            // Apply mute sections to state - need to map filenames to track IDs
            this.applyMuteSetToState(song, muteSet);
            State.setMuteSetModified(false);
            
            // Set current mute set info
            const activeSong = State.getActiveSong();
            if (activeSong) {
                activeSong.currentMuteSetId = name;
                activeSong.currentMuteSetName = name;
            }
            
            this.updateDropdownButtonText(song);
        } catch (error) {
            console.error('Failed to load mute set:', error);
            const modal = getModal();
            await modal.alert({
                title: 'Error',
                message: `Failed to load mute set: ${error.message}`
            });
        }
    }
    
    /**
     * Apply mute set data to state (mapping filenames to track IDs)
     */
    applyMuteSetToState(song, muteSet) {
        const activeSong = State.getActiveSong();
        if (!activeSong) return;
        
        // Initialize muteSections object (without emitting event)
        activeSong.muteSections = {};
        
        // Set default unmuted section for all tracks
        activeSong.tracks.forEach(track => {
            if (track.duration > 0) {
                activeSong.muteSections[track.id] = [{
                    start: 0,
                    end: track.duration,
                    muted: false
                }];
            }
        });
        
        // Apply the mute set data (overwriting defaults)
        if (muteSet.tracks) {
            for (const [filename, sections] of Object.entries(muteSet.tracks)) {
                // Find the track with this filename
                const track = song.tracks?.find(t => {
                    const parts = t.filePath.split('/');
                    return parts[parts.length - 1] === filename;
                });
                
                if (track) {
                    activeSong.muteSections[track.id] = sections;
                }
            }
        }
        
        // Single emit after all data is applied
        State.emit(State.Events.MUTE_SECTIONS_CHANGED, { trackId: null });
    }
    
    /**
     * Save current mute set (overwrite)
     */
    async saveCurrentMuteSet(song) {
        const currentName = State.getCurrentMuteSetDisplayName();
        if (!currentName || currentName === 'None') return;
        
        const tracks = this.buildMuteSetTracksData(song);
        
        try {
            await saveMuteSet(song.songName, currentName, { tracks });
            State.setMuteSetModified(false);
            this.invalidateMuteSetCache(song.songName);
            this.updateDropdownButtonText(song);
        } catch (error) {
            console.error('Failed to save mute set:', error);
            const modal = getModal();
            await modal.alert({
                title: 'Error',
                message: `Failed to save mute set: ${error.message}`
            });
        }
    }
    
    /**
     * Save mute set as new name
     */
    async saveMuteSetAs(song) {
        this.closeDropdown();
        
        const result = await this.showSaveDialog('mute', song);
        if (!result) return;
        
        const { name, isProtected, secret } = result;
        const tracks = this.buildMuteSetTracksData(song);
        
        try {
            const data = { tracks, protected: isProtected };
            if (secret) data.secret = secret;
            
            await saveMuteSet(song.songName, name, data);
            
            // Update current mute set info
            const activeSong = State.getActiveSong();
            if (activeSong) {
                activeSong.currentMuteSetId = name;
                activeSong.currentMuteSetName = name;
            }
            
            State.setMuteSetModified(false);
            this.invalidateMuteSetCache(song.songName);
            this.updateDropdownButtonText(song);
        } catch (error) {
            console.error('Failed to save mute set:', error);
            const modal = getModal();
            await modal.alert({
                title: 'Error',
                message: `Failed to save mute set: ${error.message}`
            });
        }
    }
    
    /**
     * Build mute set tracks data from current state
     * Only includes tracks that have at least one muted section
     */
    buildMuteSetTracksData(song) {
        const tracks = {};
        const activeSong = State.getActiveSong();
        
        if (!activeSong?.tracks || !activeSong?.muteSections) {
            return tracks;
        }
        
        for (const track of activeSong.tracks) {
            const sections = activeSong.muteSections[track.id];
            // Only include tracks that have at least one muted section
            if (sections && sections.some(s => s.muted)) {
                const parts = track.filePath.split('/');
                const filename = parts[parts.length - 1];
                tracks[filename] = sections;
            }
        }
        
        return tracks;
    }
    
    /**
     * Delete mute set with confirmation
     */
    async deleteMuteSetWithConfirm(song, name) {
        this.closeDropdown();
        
        const modal = getModal();
        
        // First check if protected
        let muteSet;
        try {
            muteSet = await getMuteSet(song.songName, name);
        } catch (error) {
            await modal.alert({
                title: 'Error',
                message: `Failed to load mute set: ${error.message}`
            });
            return;
        }
        
        let secret = null;
        if (muteSet.protected) {
            secret = await this.promptForSecret('Delete Protected Mute Set');
            if (!secret) return; // User cancelled
        }
        
        const confirmed = await modal.confirm({
            title: 'Delete Mute Set',
            message: `<p>Delete mute set "<strong>${this.escapeHtml(name)}</strong>"?</p><p>This cannot be undone.</p>`,
            confirmText: 'Delete',
            confirmClass: 'btn-danger'
        });
        
        if (!confirmed) return;
        
        try {
            await deleteMuteSet(song.songName, name, secret);
            this.invalidateMuteSetCache(song.songName);
            
            // If deleted the current mute set, reset to None
            if (State.getCurrentMuteSetDisplayName() === name) {
                this.selectNoneMuteSet(song);
            }
        } catch (error) {
            console.error('Failed to delete mute set:', error);
            if (error.status === 403) {
                await modal.alert({
                    title: 'Invalid Secret',
                    message: 'The admin secret is incorrect.'
                });
            } else {
                await modal.alert({
                    title: 'Error',
                    message: `Failed to delete mute set: ${error.message}`
                });
            }
        }
    }
    
    /**
     * Invalidate mute set cache for a song
     */
    invalidateMuteSetCache(songName) {
        this.muteSetCache.delete(songName);
    }
    
    // ========================================
    // Save Dialog (Chunk 6.8)
    // ========================================
    
    /**
     * Show save dialog for arrangement or mute set
     * @param {string} type - 'arrangement' or 'mute'
     * @param {Object} song - Song object
     * @returns {Promise<{name: string, isProtected: boolean, secret?: string}|null>}
     */
    async showSaveDialog(type, song) {
        const modal = getModal();
        const typeLabel = type === 'arrangement' ? 'Arrangement' : 'Mute Set';
        
        return new Promise((resolve) => {
            const content = `
                <div class="save-dialog">
                    <div class="save-dialog-field">
                        <label for="save-name-input">Name</label>
                        <input type="text" id="save-name-input" placeholder="Enter a name..." maxlength="100">
                        <div id="save-name-error" class="save-dialog-error hidden"></div>
                    </div>
                    <div class="save-dialog-field save-dialog-checkbox">
                        <label>
                            <input type="checkbox" id="save-protected-checkbox">
                            Mark as protected (requires secret to edit/delete)
                        </label>
                    </div>
                    <div id="save-secret-field" class="save-dialog-field hidden">
                        <label for="save-secret-input">Admin Secret</label>
                        <input type="password" id="save-secret-input" placeholder="Enter admin secret...">
                    </div>
                </div>
            `;
            
            modal.show({
                title: `Save ${typeLabel} As`,
                content: content,
                confirmText: 'Save',
                cancelText: 'Cancel',
                confirmClass: 'btn-primary',
                showCancel: true,
                onShow: () => {
                    const nameInput = document.getElementById('save-name-input');
                    const protectedCheckbox = document.getElementById('save-protected-checkbox');
                    const secretField = document.getElementById('save-secret-field');
                    
                    // Focus name input
                    setTimeout(() => nameInput?.focus(), 50);
                    
                    // Toggle secret field visibility
                    protectedCheckbox?.addEventListener('change', () => {
                        if (protectedCheckbox.checked) {
                            secretField?.classList.remove('hidden');
                        } else {
                            secretField?.classList.add('hidden');
                        }
                    });
                    
                    // Enter key to submit
                    nameInput?.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            modal.close(true);
                        }
                    });
                },
                onConfirm: async () => {
                    const nameInput = document.getElementById('save-name-input');
                    const protectedCheckbox = document.getElementById('save-protected-checkbox');
                    const secretInput = document.getElementById('save-secret-input');
                    const errorDiv = document.getElementById('save-name-error');
                    
                    const name = nameInput?.value?.trim() || '';
                    const isProtected = protectedCheckbox?.checked || false;
                    const secret = secretInput?.value || '';
                    
                    // Validate name
                    const validation = validateName(name);
                    if (!validation.valid) {
                        if (errorDiv) {
                            errorDiv.textContent = validation.error;
                            errorDiv.classList.remove('hidden');
                        }
                        // Don't close modal
                        return false;
                    }
                    
                    // Check for name collision
                    try {
                        const exists = type === 'arrangement' 
                            ? await checkArrangementExists(song.songName, name)
                            : await checkMuteSetExists(song.songName, name);
                        
                        if (exists) {
                            // Ask to overwrite
                            const overwrite = await modal.confirm({
                                title: 'Name Already Exists',
                                message: `<p>A ${type} named "${this.escapeHtml(name)}" already exists.</p><p>Do you want to overwrite it?</p>`,
                                confirmText: 'Overwrite',
                                confirmClass: 'btn-danger'
                            });
                            
                            if (!overwrite) {
                                resolve(null);
                                return;
                            }
                        }
                    } catch (error) {
                        console.error('Failed to check name existence:', error);
                    }
                    
                    resolve({ name, isProtected, secret: isProtected ? secret : undefined });
                },
                onCancel: () => {
                    resolve(null);
                }
            });
        });
    }
    
    // ========================================
    // Refresh (Chunk 6.10)
    // ========================================
    
    /**
     * Handle refresh button click
     */
    async handleRefresh(song) {
        // Invalidate caches
        this.invalidateArrangementCache(song.songName);
        this.invalidateMuteSetCache(song.songName);
        
        // Close dropdown - user can reopen to see refreshed data
        this.closeDropdown();
        
        // Update button to show we're refreshing
        this._isRefreshing = true;
        this.updateDropdownButtonText(song);
        
        // Brief delay to show refreshing state
        setTimeout(() => {
            this._isRefreshing = false;
            this.updateDropdownButtonText(song);
        }, 500);
    }
    
    // ========================================
    // Helper Methods
    // ========================================
    
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

    // ========================================
    // Song Picker (unchanged from before)
    // ========================================

    /**
     * Set the refreshing state and update the Refresh option text
     * @param {boolean} isRefreshing - Whether a refresh is in progress
     */
    setRefreshingState(isRefreshing) {
        this._isRefreshing = isRefreshing;
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
            // Arrangement selector visibility handled by updateDropdownSelector
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

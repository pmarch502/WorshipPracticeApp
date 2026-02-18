/**
 * MenuBar UI
 * Set List, Arrangement, and Mute Set dropdown menus in the menu bar.
 * Each dropdown opens directly to its content (no nested submenu layer).
 * Delete actions use a nested submenu within each dropdown.
 */

import * as State from '../state.js';
import { getModal } from './modal.js';
import * as SongManager from '../songManager.js';
import { getTransport } from '../transport.js';
import { 
    listArrangements, 
    getArrangement, 
    saveArrangement, 
    deleteArrangement,
    listMuteSets,
    getMuteSet,
    saveMuteSet,
    deleteMuteSet,
    listSetLists,
    getSetList,
    saveSetList,
    deleteSetList,
    listMashups,
    getMashup,
    saveMashup,
    deleteMashup,
    validateName
} from '../api.js';
import * as Manifest from '../manifest.js';
import * as Metadata from '../metadata.js';
import * as TrackManager from '../trackManager.js';

class MenuBarUI {
    constructor() {
        // Arrangement dropdown elements
        this.arrangementSelector = document.getElementById('arrangement-selector');
        this.arrangementBtn = document.getElementById('arrangement-dropdown-btn');
        this.arrangementBtnText = this.arrangementBtn?.querySelector('.dropdown-btn-text');
        this.arrangementMenu = document.getElementById('arrangement-dropdown-menu');
        
        // Mute dropdown elements
        this.muteSelector = document.getElementById('mute-selector');
        this.muteBtn = document.getElementById('mute-dropdown-btn');
        this.muteBtnText = this.muteBtn?.querySelector('.dropdown-btn-text');
        this.muteMenu = document.getElementById('mute-dropdown-menu');
        
        // Set List dropdown elements
        this.setlistSelector = document.getElementById('setlist-selector');
        this.setlistBtn = document.getElementById('setlist-dropdown-btn');
        this.setlistBtnText = this.setlistBtn?.querySelector('.dropdown-btn-text');
        this.setlistMenu = document.getElementById('setlist-dropdown-menu');
        
        // Mashup dropdown elements
        this.mashupSelector = document.getElementById('mashup-selector');
        this.mashupBtn = document.getElementById('mashup-dropdown-btn');
        this.mashupMenu = document.getElementById('mashup-dropdown-menu');
        
        // Dropdown state
        this.isArrangementOpen = false;
        this.isMuteOpen = false;
        this.isSetListOpen = false;
        this.isMashupOpen = false;
        this._isRefreshing = false;
        
        // Cache for API data
        this.arrangementCache = new Map(); // songName -> { data: string[], timestamp: number }
        this.muteSetCache = new Map(); // songName -> { data: string[], timestamp: number }
        this.setlistCache = null; // { data: string[], timestamp: number } (global, not per-song)
        this.mashupCache = null; // { data: string[], timestamp: number } (global)
        this.CACHE_TTL = 60000; // 1 minute cache
        
        // Active submenu tracking (for Delete nested submenus)
        this.activeSubmenu = null;
        this.submenuTimeout = null;
        
        this.init();
        this.attachStateListeners();
    }

    init() {
        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isArrangementOpen && 
                !this.arrangementMenu?.contains(e.target) && 
                !this.arrangementBtn?.contains(e.target)) {
                this.closeArrangementDropdown();
            }
            if (this.isMuteOpen && 
                !this.muteMenu?.contains(e.target) && 
                !this.muteBtn?.contains(e.target)) {
                this.closeMuteDropdown();
            }
            if (this.isSetListOpen && 
                !this.setlistMenu?.contains(e.target) && 
                !this.setlistBtn?.contains(e.target)) {
                this.closeSetListDropdown();
            }
            if (this.isMashupOpen && 
                !this.mashupMenu?.contains(e.target) && 
                !this.mashupBtn?.contains(e.target)) {
                this.closeMashupDropdown();
            }
        });

        // Close dropdowns on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isArrangementOpen) this.closeArrangementDropdown();
                if (this.isMuteOpen) this.closeMuteDropdown();
                if (this.isSetListOpen) this.closeSetListDropdown();
                if (this.isMashupOpen) this.closeMashupDropdown();
            }
        });
        
        // Arrangement dropdown button click
        if (this.arrangementBtn) {
            this.arrangementBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleArrangementDropdown();
            });
        }
        
        // Mute dropdown button click
        if (this.muteBtn) {
            this.muteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMuteDropdown();
            });
        }
        
        // Set List dropdown button click
        if (this.setlistBtn) {
            this.setlistBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSetListDropdown();
            });
        }
        
        // Mashup dropdown button click
        if (this.mashupBtn) {
            this.mashupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMashupDropdown();
            });
        }
    }

    attachStateListeners() {
        State.subscribe(State.Events.SONG_SWITCHED, (song) => {
            this.updateDropdownSelector(song);
        });

        State.subscribe(State.Events.STATE_LOADED, () => {
            const song = State.getActiveSong();
            this.updateDropdownSelector(song);
        });
        
        // Show/hide selectors based on whether songs exist
        State.subscribe(State.Events.SONG_ADDED, () => {
            this.updateSelectorVisibility();
        });
        
        State.subscribe(State.Events.SONG_REMOVED, () => {
            this.updateSelectorVisibility();
        });
        
        // Update arrangement button when arrangement sections change
        State.subscribe(State.Events.ARRANGEMENT_SECTIONS_CHANGED, () => {
            const song = State.getActiveSong();
            if (song) {
                this.updateArrangementButtonText(song);
            }
        });
        
        // Update mute button when mute sections change
        State.subscribe(State.Events.MUTE_SECTIONS_CHANGED, () => {
            const song = State.getActiveSong();
            if (song) {
                this.updateMuteButtonText(song);
            }
        });
        
        // Update set list button when set list changes
        State.subscribe(State.Events.SET_LIST_CHANGED, () => {
            this.updateSetListButtonText();
        });
    }

    // ========================================
    // Selector Visibility
    // ========================================
    
    /**
     * Update both selectors' visibility based on whether songs are open
     */
    updateSelectorVisibility() {
        const hasSongs = State.state.songs.length > 0;
        this.arrangementSelector?.classList.toggle('hidden', !hasSongs);
        this.muteSelector?.classList.toggle('hidden', !hasSongs);
    }

    // ========================================
    // Arrangement Dropdown
    // ========================================
    
    toggleArrangementDropdown() {
        if (this.isArrangementOpen) {
            this.closeArrangementDropdown();
        } else {
            this.openArrangementDropdown();
        }
    }
    
    openArrangementDropdown() {
        const song = State.getActiveSong();
        if (!song || !this.arrangementMenu) return;
        
        // Close other dropdowns if open
        if (this.isMuteOpen) this.closeMuteDropdown();
        if (this.isSetListOpen) this.closeSetListDropdown();
        if (this.isMashupOpen) this.closeMashupDropdown();
        
        this.isArrangementOpen = true;
        this.arrangementBtn?.classList.add('open');
        this.arrangementMenu.classList.remove('hidden');
        
        this.renderArrangementMenu(song);
    }
    
    closeArrangementDropdown() {
        this.isArrangementOpen = false;
        this.arrangementBtn?.classList.remove('open');
        this.arrangementMenu?.classList.add('hidden');
        this.closeAllSubmenus(this.arrangementMenu);
    }
    
    // ========================================
    // Mute Dropdown
    // ========================================
    
    toggleMuteDropdown() {
        if (this.isMuteOpen) {
            this.closeMuteDropdown();
        } else {
            this.openMuteDropdown();
        }
    }
    
    openMuteDropdown() {
        const song = State.getActiveSong();
        if (!song || !this.muteMenu) return;
        
        // Close other dropdowns if open
        if (this.isArrangementOpen) this.closeArrangementDropdown();
        if (this.isSetListOpen) this.closeSetListDropdown();
        if (this.isMashupOpen) this.closeMashupDropdown();
        
        this.isMuteOpen = true;
        this.muteBtn?.classList.add('open');
        this.muteMenu.classList.remove('hidden');
        
        this.renderMuteMenu(song);
    }
    
    closeMuteDropdown() {
        this.isMuteOpen = false;
        this.muteBtn?.classList.remove('open');
        this.muteMenu?.classList.add('hidden');
        this.closeAllSubmenus(this.muteMenu);
    }
    
    // ========================================
    // Close any open dropdown (used by save/delete handlers)
    // ========================================
    
    closeAllDropdowns() {
        if (this.isArrangementOpen) this.closeArrangementDropdown();
        if (this.isMuteOpen) this.closeMuteDropdown();
        if (this.isSetListOpen) this.closeSetListDropdown();
        if (this.isMashupOpen) this.closeMashupDropdown();
    }

    // ========================================
    // Button Text Updates
    // ========================================
    
    /**
     * Update both dropdown selectors' visibility and text
     * @param {Object|null} song - Active song or null
     */
    updateDropdownSelector(song) {
        if (song) {
            this.arrangementSelector?.classList.remove('hidden');
            this.muteSelector?.classList.remove('hidden');
            this.updateArrangementButtonText(song);
            this.updateMuteButtonText(song);
        } else {
            this.arrangementSelector?.classList.add('hidden');
            this.muteSelector?.classList.add('hidden');
        }
        // Set list selector is always visible - just update text
        this.updateSetListButtonText();
    }
    
    /**
     * Update the arrangement dropdown button text
     * @param {Object} song - Song object
     */
    updateArrangementButtonText(song) {
        if (!this.arrangementBtnText) return;
        
        const arrName = State.getCurrentArrangementDisplayName();
        const arrModified = State.isArrangementModified();
        
        let text = arrName || 'Original';
        if (arrModified) text += ' *';
        
        this.arrangementBtnText.textContent = text;
    }
    
    /**
     * Update the mute dropdown button text
     * @param {Object} song - Song object
     */
    updateMuteButtonText(song) {
        if (!this.muteBtnText) return;
        
        const muteName = State.getCurrentMuteSetDisplayName();
        const muteModified = State.isMuteSetModified();
        
        let text = muteName || 'None';
        if (muteModified) text += ' *';
        
        this.muteBtnText.textContent = text;
    }

    // Keep legacy method name for any external callers
    updateDropdownButtonText(song) {
        this.updateArrangementButtonText(song);
        this.updateMuteButtonText(song);
    }
    
    /**
     * Update the set list dropdown button text
     */
    updateSetListButtonText() {
        if (!this.setlistBtnText) return;
        this.setlistBtnText.textContent = State.getCurrentSetListDisplayName();
    }

    // ========================================
    // Arrangement Menu Rendering
    // ========================================
    
    /**
     * Render the arrangement dropdown menu content directly
     * @param {Object} song - Song object
     */
    async renderArrangementMenu(song) {
        if (!this.arrangementMenu) return;
        
        this.arrangementMenu.innerHTML = '';
        
        // Refresh option
        const refreshItem = this.createMenuItem('Refresh', () => this.handleArrangementRefresh(song), false);
        refreshItem.id = 'arrangement-refresh-item';
        this.arrangementMenu.appendChild(refreshItem);
        
        this.arrangementMenu.appendChild(this.createDivider());
        
        // Show loading indicator for the list
        const loadingEl = this.createLoadingIndicator();
        this.arrangementMenu.appendChild(loadingEl);
        
        try {
            const arrangements = await this.fetchArrangements(song.songName);
            
            // Remove loading indicator
            loadingEl.remove();
            
            const currentArrName = State.getCurrentArrangementDisplayName();
            const arrModified = State.isArrangementModified();
            
            // "Original (Full Song)" option
            const originalItem = this.createMenuItem('Original (Full Song)', () => this.selectOriginalArrangement(song));
            if (!currentArrName || currentArrName === 'Original') {
                originalItem.classList.add('active');
                const checkmark = originalItem.querySelector('.checkmark');
                if (checkmark) checkmark.classList.remove('hidden');
            }
            this.arrangementMenu.appendChild(originalItem);
            
            // List of saved arrangements
            if (arrangements.length > 0) {
                this.arrangementMenu.appendChild(this.createDivider());
                
                arrangements.forEach(name => {
                    const item = this.createMenuItem(name, () => this.selectArrangement(song, name));
                    if (currentArrName === name) {
                        item.classList.add('active');
                        const checkmark = item.querySelector('.checkmark');
                        if (checkmark) checkmark.classList.remove('hidden');
                    }
                    this.arrangementMenu.appendChild(item);
                });
            } else {
                this.arrangementMenu.appendChild(this.createDivider());
                this.arrangementMenu.appendChild(this.createEmptyState('No saved arrangements'));
            }
            
            // Divider and actions
            this.arrangementMenu.appendChild(this.createDivider());
            
            // Save option (enabled if modified and has a name)
            const saveItem = this.createMenuItem('Save', () => this.saveCurrentArrangement(song), false);
            if (!arrModified || !currentArrName || currentArrName === 'Original') {
                saveItem.classList.add('disabled');
            }
            this.arrangementMenu.appendChild(saveItem);
            
            // Save As option
            const saveAsItem = this.createMenuItem('Save As...', () => this.saveArrangementAs(song), false);
            this.arrangementMenu.appendChild(saveAsItem);
            
            // Only show Delete if there are arrangements
            if (arrangements.length > 0) {
                this.arrangementMenu.appendChild(this.createDivider());
                
                const deleteItem = this.createNestedSubmenuItem('Delete', 'arr-delete-submenu', async (nestedSubmenu) => {
                    await this.populateDeleteArrangementsSubmenu(nestedSubmenu, song, arrangements);
                });
                this.arrangementMenu.appendChild(deleteItem);
            }
            
        } catch (error) {
            console.error('Failed to load arrangements:', error);
            loadingEl.remove();
            this.arrangementMenu.appendChild(this.createEmptyState('Failed to load'));
        }
    }

    // ========================================
    // Mute Menu Rendering
    // ========================================
    
    /**
     * Render the mute set dropdown menu content directly
     * @param {Object} song - Song object
     */
    async renderMuteMenu(song) {
        if (!this.muteMenu) return;
        
        this.muteMenu.innerHTML = '';
        
        // Refresh option
        const refreshItem = this.createMenuItem('Refresh', () => this.handleMuteRefresh(song), false);
        refreshItem.id = 'mute-refresh-item';
        this.muteMenu.appendChild(refreshItem);
        
        this.muteMenu.appendChild(this.createDivider());
        
        // Show loading indicator for the list
        const loadingEl = this.createLoadingIndicator();
        this.muteMenu.appendChild(loadingEl);
        
        try {
            const muteSets = await this.fetchMuteSets(song.songName);
            
            // Remove loading indicator
            loadingEl.remove();
            
            const currentMuteName = State.getCurrentMuteSetDisplayName();
            const muteModified = State.isMuteSetModified();
            
            // "None (All Unmuted)" option
            const noneItem = this.createMenuItem('None (All Unmuted)', () => this.selectNoneMuteSet(song));
            if (!currentMuteName || currentMuteName === 'None') {
                noneItem.classList.add('active');
                const checkmark = noneItem.querySelector('.checkmark');
                if (checkmark) checkmark.classList.remove('hidden');
            }
            this.muteMenu.appendChild(noneItem);
            
            // List of mute sets
            if (muteSets.length > 0) {
                this.muteMenu.appendChild(this.createDivider());
                
                muteSets.forEach(name => {
                    const item = this.createMenuItem(name, () => this.selectMuteSet(song, name));
                    if (currentMuteName === name) {
                        item.classList.add('active');
                        const checkmark = item.querySelector('.checkmark');
                        if (checkmark) checkmark.classList.remove('hidden');
                    }
                    this.muteMenu.appendChild(item);
                });
            } else {
                this.muteMenu.appendChild(this.createDivider());
                this.muteMenu.appendChild(this.createEmptyState('No saved mute sets'));
            }
            
            // Divider and actions
            this.muteMenu.appendChild(this.createDivider());
            
            // Save option (enabled if modified and has a name)
            const saveItem = this.createMenuItem('Save', () => this.saveCurrentMuteSet(song), false);
            if (!muteModified || !currentMuteName || currentMuteName === 'None') {
                saveItem.classList.add('disabled');
            }
            this.muteMenu.appendChild(saveItem);
            
            // Save As option
            const saveAsItem = this.createMenuItem('Save As...', () => this.saveMuteSetAs(song), false);
            this.muteMenu.appendChild(saveAsItem);
            
            // Only show Delete if there are mute sets
            if (muteSets.length > 0) {
                this.muteMenu.appendChild(this.createDivider());
                
                const deleteItem = this.createNestedSubmenuItem('Delete', 'mute-delete-submenu', async (nestedSubmenu) => {
                    await this.populateDeleteMuteSetsSubmenu(nestedSubmenu, song, muteSets);
                });
                this.muteMenu.appendChild(deleteItem);
            }
            
        } catch (error) {
            console.error('Failed to load mute sets:', error);
            loadingEl.remove();
            this.muteMenu.appendChild(this.createEmptyState('Failed to load'));
        }
    }

    // ========================================
    // Shared Menu Item Creators
    // ========================================
    
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
            checkmark.innerHTML = '&#10003;'; // checkmark
            item.appendChild(checkmark);
        }
        
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        item.appendChild(labelSpan);
        
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
            this.closeAllDropdowns();
        });
        
        return item;
    }
    
    /**
     * Create a nested submenu trigger item (used for Delete submenus)
     * @param {string} label - Item label
     * @param {string} submenuId - Submenu identifier
     * @param {Function} populateFn - Function to populate the nested submenu
     * @returns {HTMLElement}
     */
    createNestedSubmenuItem(label, submenuId, populateFn) {
        const item = document.createElement('div');
        item.className = 'dropdown-item has-submenu';
        item.dataset.submenu = submenuId;
        
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        item.appendChild(labelSpan);
        
        const arrow = document.createElement('span');
        arrow.className = 'submenu-arrow';
        arrow.textContent = '\u25B6';
        item.appendChild(arrow);
        
        // Create nested submenu container
        const nestedSubmenu = document.createElement('div');
        nestedSubmenu.className = 'dropdown-submenu hidden';
        nestedSubmenu.id = submenuId;
        item.appendChild(nestedSubmenu);
        
        let populated = false;
        
        // Click handler for mobile support
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            
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
            this.scheduleSubmenuClose(nestedSubmenu, item);
        });
        
        nestedSubmenu.addEventListener('mouseenter', () => {
            this.cancelSubmenuClose();
        });
        
        nestedSubmenu.addEventListener('mouseleave', (e) => {
            if (item.contains(e.relatedTarget)) return;
            this.scheduleSubmenuClose(nestedSubmenu, item);
        });
        
        // Prevent clicks inside nested submenu from closing it
        nestedSubmenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        return item;
    }
    
    /**
     * Position submenu to avoid going off-screen
     * @param {HTMLElement} parentItem - Parent menu item
     * @param {HTMLElement} submenu - Submenu element
     */
    positionSubmenu(parentItem, submenu) {
        submenu.classList.remove('position-left');
        
        const rect = parentItem.getBoundingClientRect();
        const submenuWidth = submenu.offsetWidth || 180;
        
        if (rect.right + submenuWidth > window.innerWidth - 10) {
            submenu.classList.add('position-left');
        }
    }
    
    /**
     * Schedule submenu close with delay
     */
    scheduleSubmenuClose(submenu, parentItem) {
        this.submenuTimeout = setTimeout(() => {
            submenu.classList.add('hidden');
            parentItem?.classList.remove('submenu-open');
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
     * Close all open submenus within a dropdown menu
     * @param {HTMLElement} menu - The dropdown menu container
     */
    closeAllSubmenus(menu) {
        this.cancelSubmenuClose();
        const submenus = menu?.querySelectorAll('.dropdown-submenu');
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
    // Arrangements: Selection, Save, Delete
    // ========================================
    
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
     * Select Original arrangement (with unsaved changes check)
     */
    async selectOriginalArrangement(song) {
        if (State.hasUnsavedArrangementChanges()) {
            const currentName = State.getCurrentArrangementDisplayName() || 'Original';
            const modal = getModal();
            const result = await modal.unsavedChangesWarning('arrangement', currentName);
            
            if (result === 'cancel') return;
            if (result === 'save') {
                await this.saveCurrentArrangement(song);
            }
        }
        
        State.initializeOriginalArrangement();
        State.setArrangementModified(false);
        const activeSong = State.getActiveSong();
        if (activeSong) {
            activeSong.currentArrangementId = null;
            activeSong.currentArrangementName = null;
            activeSong.currentArrangementProtected = false;
        }
        this.updateArrangementButtonText(song);
    }
    
    /**
     * Select a saved arrangement (with unsaved changes check)
     */
    async selectArrangement(song, name) {
        if (State.hasUnsavedArrangementChanges()) {
            const currentName = State.getCurrentArrangementDisplayName() || 'Original';
            const modal = getModal();
            const result = await modal.unsavedChangesWarning('arrangement', currentName);
            
            if (result === 'cancel') return;
            if (result === 'save') {
                await this.saveCurrentArrangement(song);
            }
        }
        
        try {
            const arrangement = await getArrangement(song.songName, name);
            
            State.setArrangementSections(arrangement.sections, false);
            State.setArrangementModified(false);
            
            const activeSong = State.getActiveSong();
            if (activeSong) {
                activeSong.currentArrangementId = name;
                activeSong.currentArrangementName = name;
                activeSong.currentArrangementProtected = arrangement.protected || false;
            }
            
            this.updateArrangementButtonText(song);
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
        
        const currentlyProtected = State.getCurrentArrangementProtected();
        
        const dialogResult = await this.showSaveCurrentDialog('arrangement', currentlyProtected);
        if (!dialogResult) return;
        
        const { isProtected, secret } = dialogResult;
        const sections = State.getArrangementSections();
        
        try {
            const data = { sections, protected: isProtected };
            if (secret) data.secret = secret;
            
            await saveArrangement(song.songName, currentName, data);
            
            State.setArrangementModified(false);
            State.setCurrentArrangementProtected(isProtected);
            this.invalidateArrangementCache(song.songName);
            this.updateArrangementButtonText(song);
        } catch (error) {
            console.error('Failed to save arrangement:', error);
            const modal = getModal();
            const errorMessage = error.status === 403 
                ? 'Invalid admin secret. The arrangement is protected and cannot be saved without the correct secret.'
                : `Failed to save arrangement: ${error.message}`;
            await modal.alert({
                title: 'Error',
                message: errorMessage
            });
        }
    }
    
    /**
     * Save arrangement as new name
     */
    async saveArrangementAs(song) {
        this.closeArrangementDropdown();
        
        const result = await this.showSaveDialog('arrangement', song);
        if (!result) return;
        
        const { name, isProtected, secret } = result;
        const sections = State.getArrangementSections();
        
        try {
            const data = { sections, protected: isProtected };
            if (secret) data.secret = secret;
            
            await saveArrangement(song.songName, name, data);
            
            const activeSong = State.getActiveSong();
            if (activeSong) {
                activeSong.currentArrangementId = name;
                activeSong.currentArrangementName = name;
                activeSong.currentArrangementProtected = isProtected;
            }
            
            State.setArrangementModified(false);
            this.invalidateArrangementCache(song.songName);
            this.updateArrangementButtonText(song);
        } catch (error) {
            console.error('Failed to save arrangement:', error);
            const modal = getModal();
            const errorMessage = error.status === 403 
                ? 'Invalid admin secret. The arrangement is protected and cannot be overwritten without the correct secret.'
                : `Failed to save arrangement: ${error.message}`;
            await modal.alert({
                title: 'Error',
                message: errorMessage
            });
        }
    }
    
    /**
     * Delete arrangement with confirmation
     */
    async deleteArrangementWithConfirm(song, name) {
        this.closeArrangementDropdown();
        
        const modal = getModal();
        
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
            if (!secret) return;
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
    // Mutes: Selection, Save, Delete
    // ========================================
    
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
     * Select None (clear mutes) (with unsaved changes check)
     */
    async selectNoneMuteSet(song) {
        if (State.hasUnsavedMuteChanges()) {
            const currentName = State.getCurrentMuteSetDisplayName() || 'None';
            const modal = getModal();
            const result = await modal.unsavedChangesWarning('mute set', currentName);
            
            if (result === 'cancel') return;
            if (result === 'save') {
                await this.saveCurrentMuteSet(song);
            }
        }
        
        State.resetAllMuteSections();
        State.setMuteSetModified(false);
        
        const activeSong = State.getActiveSong();
        if (activeSong) {
            activeSong.currentMuteSetId = null;
            activeSong.currentMuteSetName = null;
            activeSong.currentMuteSetProtected = false;
        }
        
        this.updateMuteButtonText(song);
    }
    
    /**
     * Select a saved mute set (with unsaved changes check)
     */
    async selectMuteSet(song, name) {
        if (State.hasUnsavedMuteChanges()) {
            const currentName = State.getCurrentMuteSetDisplayName() || 'None';
            const modal = getModal();
            const result = await modal.unsavedChangesWarning('mute set', currentName);
            
            if (result === 'cancel') return;
            if (result === 'save') {
                await this.saveCurrentMuteSet(song);
            }
        }
        
        try {
            const muteSet = await getMuteSet(song.songName, name);
            
            this.applyMuteSetToState(song, muteSet);
            State.setMuteSetModified(false);
            
            const activeSong = State.getActiveSong();
            if (activeSong) {
                activeSong.currentMuteSetId = name;
                activeSong.currentMuteSetName = name;
                activeSong.currentMuteSetProtected = muteSet.protected || false;
            }
            
            this.updateMuteButtonText(song);
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
        
        activeSong.muteSections = {};
        
        activeSong.tracks.forEach(track => {
            if (track.duration > 0) {
                activeSong.muteSections[track.id] = [{
                    start: 0,
                    end: track.duration,
                    muted: false
                }];
            }
        });
        
        if (muteSet.tracks) {
            for (const [filename, sections] of Object.entries(muteSet.tracks)) {
                const track = song.tracks?.find(t => {
                    const parts = t.filePath.split('/');
                    return parts[parts.length - 1] === filename;
                });
                
                if (track) {
                    activeSong.muteSections[track.id] = sections;
                }
            }
        }
        
        State.emit(State.Events.MUTE_SECTIONS_CHANGED, { trackId: null });
    }
    
    /**
     * Save current mute set (overwrite)
     */
    async saveCurrentMuteSet(song) {
        const currentName = State.getCurrentMuteSetDisplayName();
        if (!currentName || currentName === 'None') return;
        
        const currentlyProtected = State.getCurrentMuteSetProtected();
        
        const dialogResult = await this.showSaveCurrentDialog('mute', currentlyProtected);
        if (!dialogResult) return;
        
        const { isProtected, secret } = dialogResult;
        const tracks = this.buildMuteSetTracksData(song);
        
        try {
            const data = { tracks, protected: isProtected };
            if (secret) data.secret = secret;
            
            await saveMuteSet(song.songName, currentName, data);
            
            State.setMuteSetModified(false);
            State.setCurrentMuteSetProtected(isProtected);
            this.invalidateMuteSetCache(song.songName);
            this.updateMuteButtonText(song);
        } catch (error) {
            console.error('Failed to save mute set:', error);
            const modal = getModal();
            const errorMessage = error.status === 403 
                ? 'Invalid admin secret. The mute set is protected and cannot be saved without the correct secret.'
                : `Failed to save mute set: ${error.message}`;
            await modal.alert({
                title: 'Error',
                message: errorMessage
            });
        }
    }
    
    /**
     * Save mute set as new name
     */
    async saveMuteSetAs(song) {
        this.closeMuteDropdown();
        
        const result = await this.showSaveDialog('mute', song);
        if (!result) return;
        
        const { name, isProtected, secret } = result;
        const tracks = this.buildMuteSetTracksData(song);
        
        try {
            const data = { tracks, protected: isProtected };
            if (secret) data.secret = secret;
            
            await saveMuteSet(song.songName, name, data);
            
            const activeSong = State.getActiveSong();
            if (activeSong) {
                activeSong.currentMuteSetId = name;
                activeSong.currentMuteSetName = name;
                activeSong.currentMuteSetProtected = isProtected;
            }
            
            State.setMuteSetModified(false);
            this.invalidateMuteSetCache(song.songName);
            this.updateMuteButtonText(song);
        } catch (error) {
            console.error('Failed to save mute set:', error);
            const modal = getModal();
            const errorMessage = error.status === 403 
                ? 'Invalid admin secret. The mute set is protected and cannot be overwritten without the correct secret.'
                : `Failed to save mute set: ${error.message}`;
            await modal.alert({
                title: 'Error',
                message: errorMessage
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
        this.closeMuteDropdown();
        
        const modal = getModal();
        
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
            if (!secret) return;
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
    // Set List Dropdown
    // ========================================
    
    toggleSetListDropdown() {
        if (this.isSetListOpen) {
            this.closeSetListDropdown();
        } else {
            this.openSetListDropdown();
        }
    }
    
    openSetListDropdown() {
        if (!this.setlistMenu) return;
        
        // Close other dropdowns if open
        if (this.isArrangementOpen) this.closeArrangementDropdown();
        if (this.isMuteOpen) this.closeMuteDropdown();
        if (this.isMashupOpen) this.closeMashupDropdown();
        
        this.isSetListOpen = true;
        this.setlistBtn?.classList.add('open');
        this.setlistMenu.classList.remove('hidden');
        
        this.renderSetListMenu();
    }
    
    closeSetListDropdown() {
        this.isSetListOpen = false;
        this.setlistBtn?.classList.remove('open');
        this.setlistMenu?.classList.add('hidden');
        this.closeAllSubmenus(this.setlistMenu);
    }

    // ========================================
    // Set List Menu Rendering
    // ========================================
    
    /**
     * Render the set list dropdown menu content
     */
    async renderSetListMenu() {
        if (!this.setlistMenu) return;
        
        this.setlistMenu.innerHTML = '';
        
        // Refresh option
        const refreshItem = this.createMenuItem('Refresh', () => this.handleSetListRefresh(), false);
        refreshItem.id = 'setlist-refresh-item';
        this.setlistMenu.appendChild(refreshItem);
        
        this.setlistMenu.appendChild(this.createDivider());
        
        // Show loading indicator for the list
        const loadingEl = this.createLoadingIndicator();
        this.setlistMenu.appendChild(loadingEl);
        
        try {
            const setLists = await this.fetchSetLists();
            
            // Remove loading indicator
            loadingEl.remove();
            
            const currentSetListName = State.getCurrentSetListDisplayName();
            
            // "None" option -- just clears the active set list without closing songs
            const noneItem = this.createMenuItem('None', () => this.selectNoneSetList());
            if (!currentSetListName || currentSetListName === 'None') {
                noneItem.classList.add('active');
                const checkmark = noneItem.querySelector('.checkmark');
                if (checkmark) checkmark.classList.remove('hidden');
            }
            this.setlistMenu.appendChild(noneItem);
            
            // List of saved set lists
            if (setLists.length > 0) {
                this.setlistMenu.appendChild(this.createDivider());
                
                setLists.forEach(name => {
                    const item = this.createMenuItem(name, () => this.selectSetList(name));
                    if (currentSetListName === name) {
                        item.classList.add('active');
                        const checkmark = item.querySelector('.checkmark');
                        if (checkmark) checkmark.classList.remove('hidden');
                    }
                    this.setlistMenu.appendChild(item);
                });
            } else {
                this.setlistMenu.appendChild(this.createDivider());
                this.setlistMenu.appendChild(this.createEmptyState('No saved set lists'));
            }
            
            // Divider and actions
            this.setlistMenu.appendChild(this.createDivider());
            
            // Save Current As option (only if songs are open)
            const hasSongs = State.state.songs.length > 0;
            const saveAsItem = this.createMenuItem('Save Current As...', () => this.saveSetListAs(), false);
            if (!hasSongs) {
                saveAsItem.classList.add('disabled');
            }
            this.setlistMenu.appendChild(saveAsItem);
            
            // Only show Delete if there are set lists
            if (setLists.length > 0) {
                this.setlistMenu.appendChild(this.createDivider());
                
                const deleteItem = this.createNestedSubmenuItem('Delete', 'setlist-delete-submenu', async (nestedSubmenu) => {
                    await this.populateDeleteSetListsSubmenu(nestedSubmenu, setLists);
                });
                this.setlistMenu.appendChild(deleteItem);
            }
            
        } catch (error) {
            console.error('Failed to load set lists:', error);
            loadingEl.remove();
            this.setlistMenu.appendChild(this.createEmptyState('Failed to load'));
        }
    }

    // ========================================
    // Set Lists: Selection, Save, Delete
    // ========================================
    
    /**
     * Populate delete set lists submenu
     */
    async populateDeleteSetListsSubmenu(submenu, setLists) {
        submenu.innerHTML = '';
        
        setLists.forEach(name => {
            const item = this.createMenuItem(name, () => this.deleteSetListWithConfirm(name), false);
            submenu.appendChild(item);
        });
    }
    
    /**
     * Fetch set lists with caching
     * @param {boolean} forceRefresh - Force refresh from server
     * @returns {Promise<string[]>}
     */
    async fetchSetLists(forceRefresh = false) {
        const now = Date.now();
        
        if (!forceRefresh && this.setlistCache && (now - this.setlistCache.timestamp) < this.CACHE_TTL) {
            return this.setlistCache.data;
        }
        
        const data = await listSetLists();
        this.setlistCache = { data, timestamp: now };
        return data;
    }
    
    /**
     * Select "None" -- just clear the active set list without closing any songs
     */
    selectNoneSetList() {
        State.clearCurrentSetList();
        this.updateSetListButtonText();
    }
    
    /**
     * Select a saved set list -- close all songs and load the set list
     */
    async selectSetList(name) {
        // Check for unsaved changes in any open song
        if (State.hasAnyUnsavedChanges()) {
            const modal = getModal();
            let itemType, itemName;
            if (State.hasUnsavedArrangementChanges()) {
                itemType = 'arrangement';
                itemName = State.getCurrentArrangementDisplayName() || 'Original';
            } else {
                itemType = 'mute set';
                itemName = State.getCurrentMuteSetDisplayName() || 'None';
            }
            
            const result = await modal.unsavedChangesWarning(itemType, itemName);
            if (result === 'cancel') return;
            if (result === 'save') {
                const song = State.getActiveSong();
                if (song) {
                    if (State.hasUnsavedArrangementChanges()) {
                        await this.saveCurrentArrangement(song);
                    }
                    if (State.hasUnsavedMuteChanges()) {
                        await this.saveCurrentMuteSet(song);
                    }
                }
            }
        }
        
        const modal = getModal();
        
        try {
            State.setLoading(true, `Loading set list "${name}"...`);
            
            // Fetch the set list
            const setList = await getSetList(name);
            
            if (!setList.items || setList.items.length === 0) {
                State.setLoading(false);
                await modal.alert({
                    title: 'Empty Set List',
                    message: 'This set list contains no items.'
                });
                return;
            }
            
            // Close all currently open songs
            await SongManager.closeAllSongs();
            
            // Open each item in the set list
            const warnings = [];
            let firstSongId = null;
            
            for (let i = 0; i < setList.items.length; i++) {
                const entry = setList.items[i];
                
                if (entry.type === 'mashup') {
                    // Load a mashup -- fetch its data and open as a mashup group
                    State.setLoading(true, `Loading mashup "${entry.mashupName}" (${i + 1}/${setList.items.length})...`);
                    
                    try {
                        const mashupSongId = await this._openMashupForSetList(entry.mashupName, warnings);
                        if (mashupSongId && !firstSongId) {
                            firstSongId = mashupSongId;
                        }
                    } catch (error) {
                        console.warn(`Failed to load mashup "${entry.mashupName}":`, error);
                        warnings.push(`Mashup "${entry.mashupName}": ${error.message}`);
                    }
                } else {
                    // Load a song
                    State.setLoading(true, `Loading "${entry.songName}" (${i + 1}/${setList.items.length})...`);
                    
                    try {
                        // Open the song with auto-loaded click/reference tracks
                        const song = await SongManager.openSongWithAutoTracks(entry.songName);
                        
                        if (!firstSongId) {
                            firstSongId = song.id;
                        }
                        
                        // Wait for metadata to load (needed for arrangement initialization)
                        await SongManager.waitForMetadata(song.id, 5000);
                        
                        // Apply pitch
                        if (entry.pitch && entry.pitch !== 0) {
                            song.transport.pitch = entry.pitch;
                        }
                        
                        // Apply arrangement if specified
                        if (entry.arrangementName) {
                            try {
                                const arrangement = await getArrangement(entry.songName, entry.arrangementName);
                                State.setArrangementSections(arrangement.sections, false);
                                State.setArrangementModified(false);
                                song.currentArrangementId = entry.arrangementName;
                                song.currentArrangementName = entry.arrangementName;
                                song.currentArrangementProtected = arrangement.protected || false;
                            } catch (arrError) {
                                console.warn(`Arrangement "${entry.arrangementName}" not found for "${entry.songName}", using Original`);
                                warnings.push(`"${entry.songName}": arrangement "${entry.arrangementName}" not found, using Original`);
                            }
                        }
                        
                    } catch (error) {
                        console.warn(`Failed to open song "${entry.songName}":`, error);
                        warnings.push(`"${entry.songName}": ${error.message}`);
                    }
                }
            }
            
            // Switch to the first song
            if (firstSongId && State.state.activeSongId !== firstSongId) {
                await SongManager.switchSong(firstSongId);
            }
            
            // Apply pitch for the active song's transport
            const activeSong = State.getActiveSong();
            if (activeSong) {
                const transport = getTransport();
                transport.setPitch(activeSong.transport.pitch);
                transport.setSpeed(activeSong.transport.speed);
            }
            
            // Update set list state
            State.setCurrentSetList(name);
            this.updateSetListButtonText();
            
            State.setLoading(false);
            
            // Show warnings if any items couldn't be loaded
            if (warnings.length > 0) {
                await modal.alert({
                    title: 'Set List Loaded with Warnings',
                    message: `<p>Some items could not be loaded:</p><ul>${warnings.map(w => `<li>${this.escapeHtml(w)}</li>`).join('')}</ul>`
                });
            }
            
        } catch (error) {
            State.setLoading(false);
            console.error('Failed to load set list:', error);
            await modal.alert({
                title: 'Error',
                message: `Failed to load set list: ${error.message}`
            });
        }
    }
    
    /**
     * Save current open songs as a new set list
     */
    async saveSetListAs() {
        this.closeSetListDropdown();
        
        if (State.state.songs.length === 0) return;
        
        const result = await this.showSetListSaveDialog();
        if (!result) return;
        
        const { name, isProtected, secret } = result;
        const items = this.buildSetListData();
        
        try {
            const data = { items, protected: isProtected };
            if (secret) data.secret = secret;
            
            await saveSetList(name, data);
            
            State.setCurrentSetList(name);
            this.invalidateSetListCache();
            this.updateSetListButtonText();
        } catch (error) {
            console.error('Failed to save set list:', error);
            const modal = getModal();
            const errorMessage = error.status === 403 
                ? 'Invalid admin secret. The set list is protected and cannot be overwritten without the correct secret.'
                : `Failed to save set list: ${error.message}`;
            await modal.alert({
                title: 'Error',
                message: errorMessage
            });
        }
    }
    
    /**
     * Build set list data from currently open songs/mashups
     * @returns {Array} Array of { type: "song", songName, arrangementName, pitch } or { type: "mashup", mashupName } objects
     */
    buildSetListData() {
        const items = [];
        const processedMashupGroups = new Set();
        
        for (const song of State.state.songs) {
            // Check if this song belongs to a saved mashup group
            if (song.mashupGroupId) {
                const group = State.getMashupGroup(song.mashupGroupId);
                if (group?.name && !processedMashupGroups.has(song.mashupGroupId)) {
                    // Emit a single mashup reference for the entire group
                    items.push({ type: 'mashup', mashupName: group.name });
                    processedMashupGroups.add(song.mashupGroupId);
                } else if (!group?.name) {
                    // Ad-hoc mashup group without a saved name -- save as individual song
                    items.push({
                        type: 'song',
                        songName: song.songName,
                        arrangementName: song.currentArrangementName || null,
                        pitch: song.transport.pitch || 0
                    });
                }
                // If group has a name and was already processed, skip (don't duplicate)
            } else {
                // Standalone song
                items.push({
                    type: 'song',
                    songName: song.songName,
                    arrangementName: song.currentArrangementName || null,
                    pitch: song.transport.pitch || 0
                });
            }
        }
        
        return items;
    }
    
    /**
     * Delete set list with confirmation
     */
    async deleteSetListWithConfirm(name) {
        this.closeSetListDropdown();
        
        const modal = getModal();
        
        let setListData;
        try {
            setListData = await getSetList(name);
        } catch (error) {
            await modal.alert({
                title: 'Error',
                message: `Failed to load set list: ${error.message}`
            });
            return;
        }
        
        let secret = null;
        if (setListData.protected) {
            secret = await this.promptForSecret('Delete Protected Set List');
            if (!secret) return;
        }
        
        const confirmed = await modal.confirm({
            title: 'Delete Set List',
            message: `<p>Delete set list "<strong>${this.escapeHtml(name)}</strong>"?</p><p>This cannot be undone.</p>`,
            confirmText: 'Delete',
            confirmClass: 'btn-danger'
        });
        
        if (!confirmed) return;
        
        try {
            await deleteSetList(name, secret);
            this.invalidateSetListCache();
            
            // If the deleted set list was the active one, clear it
            if (State.getCurrentSetListDisplayName() === name) {
                State.clearCurrentSetList();
                this.updateSetListButtonText();
            }
        } catch (error) {
            console.error('Failed to delete set list:', error);
            if (error.status === 403) {
                await modal.alert({
                    title: 'Invalid Secret',
                    message: 'The admin secret is incorrect.'
                });
            } else {
                await modal.alert({
                    title: 'Error',
                    message: `Failed to delete set list: ${error.message}`
                });
            }
        }
    }
    
    /**
     * Invalidate set list cache
     */
    invalidateSetListCache() {
        this.setlistCache = null;
    }
    
    /**
     * Handle set list refresh
     */
    async handleSetListRefresh() {
        this.invalidateSetListCache();
        this.closeSetListDropdown();
        
        this._isRefreshing = true;
        this.updateSetListButtonText();
        
        setTimeout(() => {
            this._isRefreshing = false;
            this.updateSetListButtonText();
        }, 500);
    }
    
    /**
     * Show save dialog specifically for set lists
     * (Set lists are global, not per-song, so the dialog is slightly different)
     * @returns {Promise<{name: string, isProtected: boolean, secret?: string}|null>}
     */
    async showSetListSaveDialog() {
        const modal = getModal();
        
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
                </div>
            `;
            
            modal.show({
                title: 'Save Set List As',
                content: content,
                confirmText: 'Save',
                cancelText: 'Cancel',
                confirmClass: 'btn-primary',
                showCancel: true,
                onShow: () => {
                    const nameInput = document.getElementById('save-name-input');
                    
                    setTimeout(() => nameInput?.focus(), 50);
                    
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
                    const errorDiv = document.getElementById('save-name-error');
                    
                    const name = nameInput?.value?.trim() || '';
                    let isProtected = protectedCheckbox?.checked || false;
                    let secret = undefined;
                    
                    const validation = validateName(name);
                    if (!validation.valid) {
                        if (errorDiv) {
                            errorDiv.textContent = validation.error;
                            errorDiv.classList.remove('hidden');
                        }
                        return false;
                    }
                    
                    try {
                        let existingItem = null;
                        try {
                            existingItem = await getSetList(name);
                        } catch (fetchError) {
                            if (fetchError.status !== 404) {
                                throw fetchError;
                            }
                        }
                        
                        if (existingItem) {
                            if (existingItem.protected) {
                                const overwriteResult = await this.showProtectedOverwriteDialog('set list', name);
                                
                                if (!overwriteResult) {
                                    resolve(null);
                                    return;
                                }
                                
                                secret = overwriteResult.secret;
                                isProtected = overwriteResult.isProtected;
                            } else {
                                const overwrite = await modal.confirm({
                                    title: 'Name Already Exists',
                                    message: `<p>A set list named "${this.escapeHtml(name)}" already exists.</p><p>Do you want to overwrite it?</p>`,
                                    confirmText: 'Overwrite',
                                    confirmClass: 'btn-danger'
                                });
                                
                                if (!overwrite) {
                                    resolve(null);
                                    return;
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Failed to check name existence:', error);
                    }
                    
                    resolve({ name, isProtected, secret });
                },
                onCancel: () => {
                    resolve(null);
                }
            });
        });
    }
    
    // ========================================
    // Save Dialogs
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
                    
                    setTimeout(() => nameInput?.focus(), 50);
                    
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
                    const errorDiv = document.getElementById('save-name-error');
                    
                    const name = nameInput?.value?.trim() || '';
                    let isProtected = protectedCheckbox?.checked || false;
                    let secret = undefined;
                    
                    const validation = validateName(name);
                    if (!validation.valid) {
                        if (errorDiv) {
                            errorDiv.textContent = validation.error;
                            errorDiv.classList.remove('hidden');
                        }
                        return false;
                    }
                    
                    try {
                        let existingItem = null;
                        try {
                            existingItem = type === 'arrangement' 
                                ? await getArrangement(song.songName, name)
                                : await getMuteSet(song.songName, name);
                        } catch (fetchError) {
                            if (fetchError.status !== 404) {
                                throw fetchError;
                            }
                        }
                        
                        if (existingItem) {
                            if (existingItem.protected) {
                                const overwriteResult = await this.showProtectedOverwriteDialog(type, name);
                                
                                if (!overwriteResult) {
                                    resolve(null);
                                    return;
                                }
                                
                                secret = overwriteResult.secret;
                                isProtected = overwriteResult.isProtected;
                            } else {
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
                        }
                    } catch (error) {
                        console.error('Failed to check name existence:', error);
                    }
                    
                    resolve({ name, isProtected, secret });
                },
                onCancel: () => {
                    resolve(null);
                }
            });
        });
    }
    
    /**
     * Show dialog for overwriting a protected item (includes secret input and protection checkbox)
     * @param {string} type - 'arrangement' or 'mute'
     * @param {string} name - Name of the existing item
     * @returns {Promise<{secret: string, isProtected: boolean}|null>}
     */
    async showProtectedOverwriteDialog(type, name) {
        const modal = getModal();
        const typeLabel = type === 'arrangement' ? 'arrangement' : 'mute set';
        
        return new Promise((resolve) => {
            const content = `
                <p>A ${typeLabel} named "<strong>${this.escapeHtml(name)}</strong>" already exists and is <strong>protected</strong>.</p>
                <p>Enter the admin secret to overwrite it:</p>
                <div class="save-dialog-field save-dialog-checkbox" style="margin: 16px 0;">
                    <label>
                        <input type="checkbox" id="overwrite-protected-checkbox" checked>
                        Mark as protected (requires secret to edit/delete)
                    </label>
                </div>
                <div class="save-dialog-field">
                    <label for="overwrite-secret-input">Admin Secret</label>
                    <input type="password" 
                           id="overwrite-secret-input" 
                           placeholder="Admin secret"
                           style="width: 100%; padding: 8px; margin-top: 4px; 
                                  background: var(--bg-tertiary); 
                                  border: 1px solid var(--border-color); 
                                  border-radius: 4px; 
                                  color: var(--text-primary);
                                  font-size: 14px;">
                </div>
            `;
            
            modal.show({
                title: 'Protected Item',
                content: content,
                confirmText: 'Overwrite',
                cancelText: 'Cancel',
                confirmClass: 'btn-danger',
                showCancel: true,
                onShow: () => {
                    const secretInput = document.getElementById('overwrite-secret-input');
                    setTimeout(() => secretInput?.focus(), 50);
                    
                    secretInput?.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            modal.close(true);
                        }
                    });
                },
                onConfirm: () => {
                    const protectedCheckbox = document.getElementById('overwrite-protected-checkbox');
                    const secretInput = document.getElementById('overwrite-secret-input');
                    const isProtected = protectedCheckbox?.checked || false;
                    const secret = secretInput?.value || '';
                    resolve({ secret, isProtected });
                },
                onCancel: () => {
                    resolve(null);
                }
            });
        });
    }
    
    /**
     * Show dialog for saving current arrangement/mute set (with protection option)
     * @param {string} type - 'arrangement' or 'mute'
     * @param {boolean} currentlyProtected - Whether the item is currently protected
     * @returns {Promise<{isProtected: boolean, secret?: string}|null>}
     */
    async showSaveCurrentDialog(type, currentlyProtected) {
        const modal = getModal();
        const typeLabel = type === 'arrangement' ? 'Arrangement' : 'Mute Set';
        
        return new Promise((resolve) => {
            let content = '';
            
            if (currentlyProtected) {
                content = `
                    <p>This ${typeLabel.toLowerCase()} is protected. Enter the admin secret to save changes.</p>
                    <div class="save-dialog-field save-dialog-checkbox" style="margin: 16px 0;">
                        <label>
                            <input type="checkbox" id="save-current-protected-checkbox" checked>
                            Mark as protected (requires secret to edit/delete)
                        </label>
                    </div>
                    <div class="save-dialog-field">
                        <label for="save-current-secret-input">Admin Secret</label>
                        <input type="password" id="save-current-secret-input" placeholder="Enter admin secret..."
                               style="width: 100%; padding: 8px; margin-top: 4px; 
                                      background: var(--bg-tertiary); 
                                      border: 1px solid var(--border-color); 
                                      border-radius: 4px; 
                                      color: var(--text-primary);
                                      font-size: 14px;">
                    </div>
                `;
            } else {
                content = `
                    <div class="save-dialog-field save-dialog-checkbox">
                        <label>
                            <input type="checkbox" id="save-current-protected-checkbox">
                            Mark as protected (requires secret to edit/delete)
                        </label>
                    </div>
                `;
            }
            
            modal.show({
                title: `Save ${typeLabel}`,
                content: content,
                confirmText: 'Save',
                cancelText: 'Cancel',
                confirmClass: 'btn-primary',
                showCancel: true,
                onShow: () => {
                    const secretInput = document.getElementById('save-current-secret-input');
                    if (secretInput) {
                        setTimeout(() => secretInput.focus(), 50);
                        secretInput.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                modal.close(true);
                            }
                        });
                    }
                },
                onConfirm: () => {
                    const protectedCheckbox = document.getElementById('save-current-protected-checkbox');
                    const secretInput = document.getElementById('save-current-secret-input');
                    
                    const isProtected = protectedCheckbox?.checked || false;
                    const secret = secretInput?.value || undefined;
                    
                    resolve({ isProtected, secret });
                },
                onCancel: () => {
                    resolve(null);
                }
            });
        });
    }
    
    // ========================================
    // Refresh
    // ========================================
    
    /**
     * Handle arrangement refresh - only invalidates arrangement cache
     */
    async handleArrangementRefresh(song) {
        this.invalidateArrangementCache(song.songName);
        this.closeArrangementDropdown();
        
        this._isRefreshing = true;
        this.updateArrangementButtonText(song);
        
        setTimeout(() => {
            this._isRefreshing = false;
            this.updateArrangementButtonText(song);
        }, 500);
    }
    
    /**
     * Handle mute refresh - only invalidates mute set cache
     */
    async handleMuteRefresh(song) {
        this.invalidateMuteSetCache(song.songName);
        this.closeMuteDropdown();
        
        this._isRefreshing = true;
        this.updateMuteButtonText(song);
        
        setTimeout(() => {
            this._isRefreshing = false;
            this.updateMuteButtonText(song);
        }, 500);
    }
    
    // ========================================
    // Helper Methods
    // ========================================
    
    /**
     * Set the refreshing state
     * @param {boolean} isRefreshing - Whether a refresh is in progress
     */
    setRefreshingState(isRefreshing) {
        this._isRefreshing = isRefreshing;
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
    
    // ========================================
    // Mashup Dropdown
    // ========================================
    
    toggleMashupDropdown() {
        if (this.isMashupOpen) {
            this.closeMashupDropdown();
        } else {
            this.openMashupDropdown();
        }
    }
    
    openMashupDropdown() {
        if (!this.mashupMenu) return;
        
        // Close other dropdowns if open
        if (this.isArrangementOpen) this.closeArrangementDropdown();
        if (this.isMuteOpen) this.closeMuteDropdown();
        if (this.isSetListOpen) this.closeSetListDropdown();
        
        this.isMashupOpen = true;
        this.mashupBtn?.classList.add('open');
        this.mashupMenu.classList.remove('hidden');
        
        this.renderMashupMenu();
    }
    
    closeMashupDropdown() {
        this.isMashupOpen = false;
        this.mashupBtn?.classList.remove('open');
        this.mashupMenu?.classList.add('hidden');
        this.closeAllSubmenus(this.mashupMenu);
    }

    // ========================================
    // Mashup Menu Rendering
    // ========================================
    
    async renderMashupMenu() {
        if (!this.mashupMenu) return;
        
        this.mashupMenu.innerHTML = '';
        
        // Open submenu
        const openItem = this.createNestedSubmenuItem('Open', 'mashup-open-submenu', async (submenu) => {
            submenu.innerHTML = '';
            submenu.appendChild(this.createLoadingIndicator());
            
            try {
                const mashups = await this.fetchMashups();
                submenu.innerHTML = '';
                
                if (mashups.length === 0) {
                    submenu.appendChild(this.createEmptyState('No mashups saved'));
                    return;
                }
                
                for (const name of mashups) {
                    const item = document.createElement('div');
                    item.className = 'dropdown-item';
                    item.textContent = name;
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.closeAllDropdowns();
                        this.openMashup(name);
                    });
                    submenu.appendChild(item);
                }
            } catch (error) {
                submenu.innerHTML = '';
                submenu.appendChild(this.createEmptyState('Failed to load'));
            }
        });
        this.mashupMenu.appendChild(openItem);
        
        this.mashupMenu.appendChild(this.createDivider());
        
        // New mashup
        const newItem = this.createMenuItem('New...', () => {
            this.showMashupEditor(null);
        }, false);
        this.mashupMenu.appendChild(newItem);
        
        // Edit mashup
        const editItem = this.createMenuItem('Edit...', () => {
            this.showMashupEditor('edit');
        }, false);
        this.mashupMenu.appendChild(editItem);
        
        this.mashupMenu.appendChild(this.createDivider());
        
        // Delete submenu
        const deleteItem = this.createNestedSubmenuItem('Delete', 'mashup-delete-submenu', async (submenu) => {
            submenu.innerHTML = '';
            submenu.appendChild(this.createLoadingIndicator());
            
            try {
                const mashups = await this.fetchMashups();
                submenu.innerHTML = '';
                
                if (mashups.length === 0) {
                    submenu.appendChild(this.createEmptyState('No mashups saved'));
                    return;
                }
                
                for (const name of mashups) {
                    const item = document.createElement('div');
                    item.className = 'dropdown-item';
                    item.textContent = name;
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.closeAllDropdowns();
                        this.deleteMashupWithConfirm(name);
                    });
                    submenu.appendChild(item);
                }
            } catch (error) {
                submenu.innerHTML = '';
                submenu.appendChild(this.createEmptyState('Failed to load'));
            }
        });
        this.mashupMenu.appendChild(deleteItem);
    }
    
    // ========================================
    // Mashup API Helpers
    // ========================================
    
    async fetchMashups() {
        if (this.mashupCache && (Date.now() - this.mashupCache.timestamp < this.CACHE_TTL)) {
            return this.mashupCache.data;
        }
        
        const mashups = await listMashups();
        this.mashupCache = { data: mashups, timestamp: Date.now() };
        return mashups;
    }
    
    invalidateMashupCache() {
        this.mashupCache = null;
    }
    
    // ========================================
    // Mashup Delete
    // ========================================
    
    async deleteMashupWithConfirm(name) {
        const modal = getModal();
        
        let mashupData;
        try {
            mashupData = await getMashup(name);
        } catch (error) {
            await modal.alert({
                title: 'Error',
                message: `Failed to load mashup: ${error.message}`
            });
            return;
        }
        
        let secret = null;
        if (mashupData.protected) {
            secret = await this.promptForSecret('Delete Protected Mashup');
            if (!secret) return;
        }
        
        const confirmed = await modal.confirm({
            title: 'Delete Mashup',
            message: `<p>Delete mashup "<strong>${this.escapeHtml(name)}</strong>"?</p><p>This cannot be undone.</p>`,
            confirmText: 'Delete',
            confirmClass: 'btn-danger'
        });
        
        if (!confirmed) return;
        
        try {
            await deleteMashup(name, secret);
            this.invalidateMashupCache();
        } catch (error) {
            console.error('Failed to delete mashup:', error);
            if (error.status === 403) {
                await modal.alert({
                    title: 'Invalid Secret',
                    message: 'The admin secret is incorrect.'
                });
            } else {
                await modal.alert({
                    title: 'Error',
                    message: `Failed to delete mashup: ${error.message}`
                });
            }
        }
    }
    
    // ========================================
    // Mashup Editor Modal
    // ========================================
    
    /**
     * Show the mashup editor modal
     * @param {string|null} mode - null for new, 'edit' for edit mode
     */
    async showMashupEditor(mode) {
        const modal = getModal();
        const isEditMode = mode === 'edit';
        
        // Load songs list from manifest
        await Manifest.loadManifest();
        const allSongs = Manifest.getSongs();
        
        // Build song options HTML
        const songOptionsHtml = allSongs.map(s => 
            `<option value="${this.escapeHtml(s.name)}">${this.escapeHtml(s.name)}</option>`
        ).join('');
        
        // Pitch options HTML
        const pitchOptionsHtml = this._buildPitchOptionsHtml();
        
        // Build the load dropdown for edit mode
        const loadDropdownHtml = isEditMode ? `
            <div class="mashup-editor-load">
                <label for="mashup-load-select">Load:</label>
                <select id="mashup-load-select">
                    <option value="">-- Select a mashup --</option>
                </select>
            </div>
        ` : '';
        
        const content = `
            <div class="mashup-editor">
                ${loadDropdownHtml}
                <div class="save-dialog-field">
                    <label for="mashup-name-input">Name</label>
                    <input type="text" id="mashup-name-input" placeholder="Enter mashup name..." maxlength="100">
                    <div id="mashup-name-error" class="save-dialog-error hidden"></div>
                </div>
                <div class="save-dialog-field save-dialog-checkbox">
                    <label>
                        <input type="checkbox" id="mashup-protected-checkbox">
                        Mark as protected
                    </label>
                </div>
                <div id="mashup-entries-container" class="mashup-editor-entries">
                    <div class="mashup-editor-empty">Click "+ Add Entry" to add songs</div>
                </div>
                <button type="button" id="mashup-add-entry-btn" class="mashup-editor-add-btn">+ Add Entry</button>
            </div>
        `;
        
        // Track the loaded mashup name for Save vs Save As
        let loadedMashupName = null;
        let loadedMashupProtected = false;
        
        // Store references for reuse
        const editorState = {
            songOptionsHtml,
            pitchOptionsHtml,
            allSongs,
            metadataCache: {}, // songName -> metadata
            defaultTargetBpm: null // BPM from first entry's song, used to auto-fill new entries
        };
        
        return new Promise((resolve) => {
            modal.show({
                title: isEditMode ? 'Edit Mashup' : 'New Mashup',
                content: content,
                confirmText: isEditMode ? 'Save' : 'Save As...',
                cancelText: 'Cancel',
                confirmClass: 'btn-primary',
                showCancel: true,
                modalClass: 'modal-mashup-editor',
                onShow: async () => {
                    const container = document.getElementById('mashup-entries-container');
                    const addBtn = document.getElementById('mashup-add-entry-btn');
                    const nameInput = document.getElementById('mashup-name-input');
                    const dialog = document.getElementById('modal-dialog');
                    
                    dialog?.classList.add('modal-mashup-editor');
                    
                    // Add entry button
                    addBtn?.addEventListener('click', () => {
                        this._addMashupEntryRow(container, editorState);
                    });
                    
                    // Initialize drag-and-drop on the entries container
                    this._initMashupEntryDragDrop(container);
                    
                    // If edit mode, populate the load dropdown
                    if (isEditMode) {
                        const loadSelect = document.getElementById('mashup-load-select');
                        if (loadSelect) {
                            try {
                                const mashups = await this.fetchMashups();
                                for (const name of mashups) {
                                    const opt = document.createElement('option');
                                    opt.value = name;
                                    opt.textContent = name;
                                    loadSelect.appendChild(opt);
                                }
                            } catch (err) {
                                console.error('Failed to load mashup list:', err);
                            }
                            
                            loadSelect.addEventListener('change', async () => {
                                const selectedName = loadSelect.value;
                                if (!selectedName) return;
                                
                                try {
                                    const mashupData = await getMashup(selectedName);
                                    loadedMashupName = selectedName;
                                    loadedMashupProtected = mashupData.protected || false;
                                    
                                    // Populate form
                                    nameInput.value = mashupData.name || selectedName;
                                    document.getElementById('mashup-protected-checkbox').checked = mashupData.protected || false;
                                    
                                    // Clear entries and add from mashup data
                                    container.innerHTML = '';
                                    // Set defaultTargetBpm from first entry so new entries get this value
                                    editorState.defaultTargetBpm = mashupData.entries[0]?.targetBpm ?? null;
                                    for (const entry of mashupData.entries) {
                                        this._addMashupEntryRow(container, editorState, entry);
                                    }
                                    
                                    // Update button text
                                    const confirmBtn = document.getElementById('modal-confirm');
                                    if (confirmBtn) confirmBtn.textContent = 'Save';
                                } catch (err) {
                                    console.error('Failed to load mashup:', err);
                                    const errModal = getModal();
                                    await errModal.alert({
                                        title: 'Error',
                                        message: `Failed to load mashup: ${err.message}`
                                    });
                                }
                            });
                        }
                    }
                    
                    // Add an initial empty entry for new mashups
                    if (!isEditMode) {
                        this._addMashupEntryRow(container, editorState);
                        setTimeout(() => nameInput?.focus(), 50);
                    }
                },
                onConfirm: async () => {
                    const nameInput = document.getElementById('mashup-name-input');
                    const protectedCheckbox = document.getElementById('mashup-protected-checkbox');
                    const errorDiv = document.getElementById('mashup-name-error');
                    const container = document.getElementById('mashup-entries-container');
                    
                    // Gather entries
                    const entries = this._gatherMashupEntries(container);
                    
                    if (entries.length === 0) {
                        if (errorDiv) {
                            errorDiv.textContent = 'At least one entry with a song is required';
                            errorDiv.classList.remove('hidden');
                        }
                        return false;
                    }
                    
                    // Validate that every entry has a target BPM
                    if (entries.some(e => e.targetBpm === null)) {
                        if (errorDiv) {
                            errorDiv.textContent = 'Each entry must have a target BPM';
                            errorDiv.classList.remove('hidden');
                        }
                        return false;
                    }
                    
                    const isProtected = protectedCheckbox?.checked || false;
                    
                    // If this is a Save (not Save As) on a loaded mashup
                    if (isEditMode && loadedMashupName) {
                        const name = nameInput?.value?.trim() || loadedMashupName;
                        
                        // If name changed, treat as Save As
                        if (name !== loadedMashupName) {
                            return await this._handleMashupSaveAs(name, entries, isProtected, errorDiv, resolve);
                        }
                        
                        // Save (overwrite)
                        try {
                            let secret = undefined;
                            if (loadedMashupProtected) {
                                secret = await this.promptForSecret('Save Protected Mashup');
                                if (!secret) return false;
                            }
                            
                            await saveMashup(name, { entries, protected: isProtected, secret });
                            this.invalidateMashupCache();
                            const dlg = document.getElementById('modal-dialog');
                            dlg?.classList.remove('modal-mashup-editor');
                            resolve({ name, entries });
                            return; // close modal
                        } catch (error) {
                            console.error('Failed to save mashup:', error);
                            if (error.status === 403) {
                                if (errorDiv) {
                                    errorDiv.textContent = 'Invalid admin secret';
                                    errorDiv.classList.remove('hidden');
                                }
                            } else {
                                if (errorDiv) {
                                    errorDiv.textContent = `Save failed: ${error.message}`;
                                    errorDiv.classList.remove('hidden');
                                }
                            }
                            return false;
                        }
                    }
                    
                    // Save As flow (for new mashups or when name changed)
                    const name = nameInput?.value?.trim() || '';
                    return await this._handleMashupSaveAs(name, entries, isProtected, errorDiv, resolve);
                },
                onCancel: () => {
                    const dialog = document.getElementById('modal-dialog');
                    dialog?.classList.remove('modal-mashup-editor');
                    resolve(null);
                }
            });
        });
    }
    
    /**
     * Handle the Save As flow for mashups
     */
    async _handleMashupSaveAs(name, entries, isProtected, errorDiv, resolve) {
        const validation = validateName(name);
        if (!validation.valid) {
            if (errorDiv) {
                errorDiv.textContent = validation.error;
                errorDiv.classList.remove('hidden');
            }
            return false;
        }
        
        try {
            // Check if name already exists
            let existingMashup = null;
            try {
                existingMashup = await getMashup(name);
            } catch (fetchError) {
                if (fetchError.status !== 404) throw fetchError;
            }
            
            let secret = undefined;
            if (existingMashup) {
                if (existingMashup.protected) {
                    const overwriteResult = await this.showProtectedOverwriteDialog('mashup', name);
                    if (!overwriteResult) {
                        resolve(null);
                        return;
                    }
                    secret = overwriteResult.secret;
                    isProtected = overwriteResult.isProtected;
                } else {
                    const modal = getModal();
                    const overwrite = await modal.confirm({
                        title: 'Name Already Exists',
                        message: `<p>A mashup named "${this.escapeHtml(name)}" already exists.</p><p>Do you want to overwrite it?</p>`,
                        confirmText: 'Overwrite',
                        confirmClass: 'btn-danger'
                    });
                    if (!overwrite) {
                        resolve(null);
                        return;
                    }
                }
            }
            
            await saveMashup(name, { entries, protected: isProtected, secret });
            this.invalidateMashupCache();
            
            const dialog = document.getElementById('modal-dialog');
            dialog?.classList.remove('modal-mashup-editor');
            resolve({ name, entries });
            return; // close modal
        } catch (error) {
            console.error('Failed to save mashup:', error);
            if (errorDiv) {
                errorDiv.textContent = `Save failed: ${error.message}`;
                errorDiv.classList.remove('hidden');
            }
            return false;
        }
    }
    
    /**
     * Build pitch options HTML for mashup editor
     */
    _buildPitchOptionsHtml(originalKey) {
        const KEYS = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];
        let html = '';
        for (let i = -6; i <= 6; i++) {
            let label = `${i >= 0 ? '+' : ''}${i}`;
            if (originalKey) {
                const keyIndex = KEYS.indexOf(originalKey);
                if (keyIndex !== -1) {
                    const transposed = KEYS[((keyIndex + i) % 12 + 12) % 12];
                    label += ` (${transposed})`;
                }
            }
            const selected = i === 0 ? ' selected' : '';
            html += `<option value="${i}"${selected}>${label}</option>`;
        }
        return html;
    }
    
    /**
     * Add an entry row to the mashup editor
     * @param {HTMLElement} container - Entries container
     * @param {Object} editorState - Shared editor state
     * @param {Object} [prefill] - Optional prefill data { songName, arrangementName, pitch, targetBpm }
     */
    _addMashupEntryRow(container, editorState, prefill = null) {
        // Remove empty state message if present
        const emptyMsg = container.querySelector('.mashup-editor-empty');
        if (emptyMsg) emptyMsg.remove();
        
        const row = document.createElement('div');
        row.className = 'mashup-entry-row';
        row.draggable = true;
        
        const rowIndex = container.querySelectorAll('.mashup-entry-row').length + 1;
        
        row.innerHTML = `
            <span class="mashup-entry-drag" title="Drag to reorder">&#x2630;</span>
            <span class="mashup-entry-num">${rowIndex}</span>
            <select class="mashup-entry-song" title="Song">
                <option value="">-- Song --</option>
                ${editorState.songOptionsHtml}
            </select>
            <select class="mashup-entry-arrangement" title="Arrangement">
                <option value="">Original</option>
            </select>
            <select class="mashup-entry-pitch" title="Pitch">
                ${editorState.pitchOptionsHtml}
            </select>
            <input type="number" class="mashup-entry-bpm" title="Target BPM" placeholder="BPM" min="1" step="any">
            <button type="button" class="mashup-entry-remove" title="Remove entry">&times;</button>
        `;
        
        const songSelect = row.querySelector('.mashup-entry-song');
        const arrangementSelect = row.querySelector('.mashup-entry-arrangement');
        const pitchSelect = row.querySelector('.mashup-entry-pitch');
        const bpmInput = row.querySelector('.mashup-entry-bpm');
        const removeBtn = row.querySelector('.mashup-entry-remove');
        
        // Promise that resolves when the song change handler finishes loading arrangements
        let songChangePromise = Promise.resolve();
        
        // Song change handler - update arrangement dropdown and pitch key names
        songSelect.addEventListener('change', async () => {
            const songName = songSelect.value;
            arrangementSelect.innerHTML = '<option value="">Original</option>';
            
            if (!songName) return;
            
            let resolveChange;
            songChangePromise = new Promise(r => { resolveChange = r; });
            
            // Fetch arrangements for this song
            try {
                const arrangements = await listArrangements(songName);
                for (const arrName of arrangements) {
                    const opt = document.createElement('option');
                    opt.value = arrName;
                    opt.textContent = arrName;
                    arrangementSelect.appendChild(opt);
                }
            } catch (err) {
                console.warn('Failed to fetch arrangements for', songName, err);
            }
            
            // Load metadata for key info and BPM
            try {
                if (!editorState.metadataCache[songName]) {
                    const metadata = await Metadata.loadMetadata(songName);
                    editorState.metadataCache[songName] = metadata;
                }
                const metadata = editorState.metadataCache[songName];
                if (metadata?.key) {
                    pitchSelect.innerHTML = this._buildPitchOptionsHtml(metadata.key);
                    // Restore pitch value if prefilled
                    if (prefill?.pitch !== undefined) {
                        pitchSelect.value = String(prefill.pitch);
                    }
                }
                
                // BPM: set placeholder to this song's native BPM
                const nativeBpm = metadata?.tempos?.[0]?.tempo;
                if (nativeBpm && nativeBpm > 0) {
                    bpmInput.placeholder = String(nativeBpm);
                    bpmInput.dataset.nativeBpm = String(nativeBpm);
                    
                    // If this is the first entry and no defaultTargetBpm yet, establish it
                    const isFirstEntry = row === container.querySelector('.mashup-entry-row');
                    if (isFirstEntry && editorState.defaultTargetBpm === null) {
                        editorState.defaultTargetBpm = nativeBpm;
                        
                        // Propagate to all existing rows with empty BPM inputs
                        container.querySelectorAll('.mashup-entry-row .mashup-entry-bpm').forEach(input => {
                            if (!input.value) {
                                input.value = nativeBpm;
                            }
                        });
                    } else if (!bpmInput.value && editorState.defaultTargetBpm !== null) {
                        // Non-first entry with no value: fill with the mashup's default target BPM
                        bpmInput.value = editorState.defaultTargetBpm;
                    }
                }
            } catch (err) {
                console.warn('Failed to load metadata for', songName, err);
            }
            
            resolveChange();
        });
        
        // Remove button
        removeBtn.addEventListener('click', () => {
            row.remove();
            this._updateMashupEntryNumbers(container);
            // Show empty state if no entries
            if (container.querySelectorAll('.mashup-entry-row').length === 0) {
                const empty = document.createElement('div');
                empty.className = 'mashup-editor-empty';
                empty.textContent = 'Click "+ Add Entry" to add songs';
                container.appendChild(empty);
            }
        });
        
        container.appendChild(row);
        
        // Apply prefill data
        if (prefill) {
            // Set BPM before triggering song change so the handler sees it as non-empty
            if (prefill.targetBpm !== undefined && prefill.targetBpm !== null) {
                bpmInput.value = prefill.targetBpm;
            }
            if (prefill.songName) {
                songSelect.value = prefill.songName;
                // Trigger change to load arrangements, then set values after it completes
                songSelect.dispatchEvent(new Event('change'));
                songChangePromise.then(() => {
                    if (prefill.arrangementName) {
                        arrangementSelect.value = prefill.arrangementName;
                    }
                    if (prefill.pitch !== undefined) {
                        pitchSelect.value = String(prefill.pitch);
                    }
                });
            }
            if (prefill.pitch !== undefined) {
                pitchSelect.value = String(prefill.pitch);
            }
        } else if (editorState.defaultTargetBpm !== null) {
            // New entry with no prefill: pre-fill with the mashup's default target BPM
            bpmInput.value = editorState.defaultTargetBpm;
        }
    }
    
    /**
     * Update entry row numbers after reorder/delete
     */
    _updateMashupEntryNumbers(container) {
        const rows = container.querySelectorAll('.mashup-entry-row');
        rows.forEach((row, i) => {
            const num = row.querySelector('.mashup-entry-num');
            if (num) num.textContent = String(i + 1);
        });
    }
    
    /**
     * Initialize drag-and-drop for mashup entry rows
     */
    _initMashupEntryDragDrop(container) {
        let draggedRow = null;
        
        container.addEventListener('dragstart', (e) => {
            const row = e.target.closest('.mashup-entry-row');
            if (!row) return;
            draggedRow = row;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!draggedRow) return;
            
            const target = e.target.closest('.mashup-entry-row');
            if (!target || target === draggedRow) return;
            
            const rect = target.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            
            if (e.clientY < midY) {
                container.insertBefore(draggedRow, target);
            } else {
                container.insertBefore(draggedRow, target.nextSibling);
            }
        });
        
        container.addEventListener('dragend', () => {
            if (draggedRow) {
                draggedRow.classList.remove('dragging');
                draggedRow = null;
                this._updateMashupEntryNumbers(container);
            }
        });
    }
    
    /**
     * Gather entry data from the editor
     */
    _gatherMashupEntries(container) {
        const rows = container.querySelectorAll('.mashup-entry-row');
        const entries = [];
        
        rows.forEach(row => {
            const songName = row.querySelector('.mashup-entry-song')?.value;
            if (!songName) return; // Skip entries with no song selected
            
            const arrangementName = row.querySelector('.mashup-entry-arrangement')?.value || null;
            const pitch = parseInt(row.querySelector('.mashup-entry-pitch')?.value || '0', 10);
            const targetBpmRaw = parseFloat(row.querySelector('.mashup-entry-bpm')?.value);
            const targetBpm = isNaN(targetBpmRaw) || targetBpmRaw <= 0 ? null : targetBpmRaw;
            
            entries.push({ songName, arrangementName: arrangementName || null, pitch, targetBpm });
        });
        
        return entries;
    }
    
    // ========================================
    // Mashup Loading (Open a Mashup)
    // ========================================
    
    /**
     * Open a mashup - load all entries as tabs
     * @param {string} name - Mashup name
     */
    async openMashup(name) {
        const modal = getModal();
        
        let mashupData;
        try {
            mashupData = await getMashup(name);
        } catch (error) {
            await modal.alert({
                title: 'Error',
                message: `Failed to load mashup: ${error.message}`
            });
            return;
        }
        
        if (!mashupData.entries || mashupData.entries.length === 0) {
            await modal.alert({
                title: 'Empty Mashup',
                message: 'This mashup has no entries.'
            });
            return;
        }
        
        const createdSongIds = [];
        const warnings = [];
        
        // Show loading overlay
        State.setLoading(true, `Opening mashup "${name}"...`);
        
        try {
            for (let i = 0; i < mashupData.entries.length; i++) {
                const entry = mashupData.entries[i];
                
                State.setLoading(true, `Loading "${entry.songName}" (${i + 1}/${mashupData.entries.length})...`);
                
                // Open the song without closing existing tabs or unloading current tracks
                const song = await this._openSongForMashup(entry.songName);
                
                if (!song) {
                    warnings.push(`Song "${entry.songName}" not found in manifest`);
                    continue;
                }
                
                createdSongIds.push(song.id);
                
                // Set display name: "Song Name - Arrangement" or just "Song Name"
                if (entry.arrangementName) {
                    song.name = `${entry.songName} - ${entry.arrangementName}`;
                }
                
                // Wait for metadata
                await SongManager.waitForMetadata(song.id, 5000);
                
                // Apply pitch
                if (entry.pitch && entry.pitch !== 0) {
                    song.transport.pitch = entry.pitch;
                }
                
                // Apply speed from target BPM
                const nativeBpm = song.metadata?.tempos?.[0]?.tempo;
                if (nativeBpm && nativeBpm > 0) {
                    song.transport.speed = Math.max(0.5, Math.min(2.0, entry.targetBpm / nativeBpm));
                }
                
                // Apply arrangement if specified
                if (entry.arrangementName) {
                    try {
                        // Ensure this song is the active one so State methods operate on it
                        State.switchSong(song.id);
                        const arrangement = await getArrangement(entry.songName, entry.arrangementName);
                        if (arrangement?.sections) {
                            State.setArrangementSections(arrangement.sections, false);
                            State.setArrangementModified(false);
                            song.currentArrangementId = entry.arrangementName;
                            song.currentArrangementName = entry.arrangementName;
                            song.currentArrangementProtected = arrangement.protected || false;
                        }
                    } catch (arrErr) {
                        if (arrErr.status === 404) {
                            warnings.push(`Arrangement "${entry.arrangementName}" not found for "${entry.songName}"`);
                        } else {
                            warnings.push(`Failed to load arrangement for "${entry.songName}": ${arrErr.message}`);
                        }
                    }
                }
                
                // Load click/reference tracks
                await Manifest.loadManifest();
                const manifestSong = Manifest.getSong(entry.songName);
                if (manifestSong) {
                    const matchingTracks = manifestSong.tracks.filter(trackName =>
                        ['click', 'reference'].some(kw => trackName.toLowerCase().includes(kw.toLowerCase()))
                    );
                    if (matchingTracks.length > 0) {
                        // Make this the active song temporarily so tracks get added to it
                        State.switchSong(song.id);
                        await TrackManager.addTracksFromManifest(entry.songName, matchingTracks);
                    }
                }
            }
            
            // Create mashup group with the saved mashup name
            if (createdSongIds.length > 0) {
                const groupId = State.createMashupGroup(createdSongIds, name);
                
                // Re-render tabs: replaces individual song tabs with segmented mashup tab
                const { getTabs } = await import('./tabs.js');
                const tabs = getTabs();
                tabs.renderTabs();
                
                // Switch to the first mashup tab
                const firstId = createdSongIds[0];
                await SongManager.switchSong(firstId);
                
                // Apply the first song's pitch and speed
                const firstSong = State.getSong(firstId);
                if (firstSong) {
                    const transport = getTransport();
                    transport.setPitch(firstSong.transport.pitch);
                    transport.setSpeed(firstSong.transport.speed);
                }
            }
        } finally {
            State.setLoading(false);
        }
        
        // Show any warnings
        if (warnings.length > 0) {
            const warningList = warnings.map(w => `<li>${this.escapeHtml(w)}</li>`).join('');
            await modal.alert({
                title: 'Mashup Loaded with Warnings',
                message: `<ul>${warningList}</ul>`
            });
        }
    }
    
    /**
     * Open a song for a mashup - does NOT close existing tabs or unload current song
     * @param {string} songName - Song name from manifest
     * @returns {Object|null} - Created song object, or null if song not found
     */
    async _openSongForMashup(songName) {
        await Manifest.loadManifest();
        const manifestSong = Manifest.getSong(songName);
        
        if (!manifestSong) {
            console.warn(`Song '${songName}' not found in manifest`);
            return null;
        }
        
        // Create the song in state (this will set it as active and emit events)
        // But we do NOT stop playback or unload current tracks
        const song = State.addSong(State.createDefaultSong(songName));
        
        // Load metadata (fire-and-forget)
        Metadata.loadMetadata(songName).then(metadata => {
            if (metadata) {
                State.updateSongMetadata(song.id, metadata);
            }
        });
        
        return song;
    }

    /**
     * Open a mashup as part of loading a set list.
     * Fetches the mashup data, opens all its entries as a mashup group with auto-advance and tab coloring.
     * Does NOT manage loading overlay or close existing songs (the caller handles that).
     * @param {string} mashupName - Name of the saved mashup
     * @param {string[]} warnings - Array to push warning messages into
     * @returns {Promise<string|null>} The first song ID in the mashup, or null if mashup failed to load
     */
    async _openMashupForSetList(mashupName, warnings) {
        let mashupData;
        try {
            mashupData = await getMashup(mashupName);
        } catch (error) {
            if (error.status === 404) {
                warnings.push(`Mashup "${mashupName}" not found (may have been deleted)`);
            } else {
                warnings.push(`Mashup "${mashupName}": ${error.message}`);
            }
            return null;
        }
        
        if (!mashupData.entries || mashupData.entries.length === 0) {
            warnings.push(`Mashup "${mashupName}" has no entries`);
            return null;
        }
        
        const createdSongIds = [];
        
        for (let j = 0; j < mashupData.entries.length; j++) {
            const mashupEntry = mashupData.entries[j];
            
            try {
                const song = await this._openSongForMashup(mashupEntry.songName);
                
                if (!song) {
                    warnings.push(`Mashup "${mashupName}": song "${mashupEntry.songName}" not found in manifest`);
                    continue;
                }
                
                createdSongIds.push(song.id);
                
                // Set display name: "Song Name - Arrangement" or just "Song Name"
                if (mashupEntry.arrangementName) {
                    song.name = `${mashupEntry.songName} - ${mashupEntry.arrangementName}`;
                }
                
                // Wait for metadata
                await SongManager.waitForMetadata(song.id, 5000);
                
                // Apply pitch
                if (mashupEntry.pitch && mashupEntry.pitch !== 0) {
                    song.transport.pitch = mashupEntry.pitch;
                }
                
                // Apply speed from target BPM
                const nativeBpm = song.metadata?.tempos?.[0]?.tempo;
                if (nativeBpm && nativeBpm > 0) {
                    song.transport.speed = Math.max(0.5, Math.min(2.0, mashupEntry.targetBpm / nativeBpm));
                }
                
                // Apply arrangement if specified
                if (mashupEntry.arrangementName) {
                    try {
                        State.switchSong(song.id);
                        const arrangement = await getArrangement(mashupEntry.songName, mashupEntry.arrangementName);
                        if (arrangement?.sections) {
                            State.setArrangementSections(arrangement.sections, false);
                            State.setArrangementModified(false);
                            song.currentArrangementId = mashupEntry.arrangementName;
                            song.currentArrangementName = mashupEntry.arrangementName;
                            song.currentArrangementProtected = arrangement.protected || false;
                        }
                    } catch (arrErr) {
                        if (arrErr.status === 404) {
                            warnings.push(`Mashup "${mashupName}": arrangement "${mashupEntry.arrangementName}" not found for "${mashupEntry.songName}"`);
                        } else {
                            warnings.push(`Mashup "${mashupName}": failed to load arrangement for "${mashupEntry.songName}": ${arrErr.message}`);
                        }
                    }
                }
                
                // Load click/reference tracks
                await Manifest.loadManifest();
                const manifestSong = Manifest.getSong(mashupEntry.songName);
                if (manifestSong) {
                    const matchingTracks = manifestSong.tracks.filter(trackName =>
                        ['click', 'reference'].some(kw => trackName.toLowerCase().includes(kw.toLowerCase()))
                    );
                    if (matchingTracks.length > 0) {
                        State.switchSong(song.id);
                        await TrackManager.addTracksFromManifest(mashupEntry.songName, matchingTracks);
                    }
                }
            } catch (error) {
                warnings.push(`Mashup "${mashupName}": failed to load song "${mashupEntry.songName}": ${error.message}`);
            }
        }
        
        // Create mashup group with the saved name
        if (createdSongIds.length > 0) {
            State.createMashupGroup(createdSongIds, mashupName);
            
            // Re-render tabs: replaces individual song tabs with segmented mashup tab
            const { getTabs } = await import('./tabs.js');
            const tabs = getTabs();
            tabs.renderTabs();
            
            return createdSongIds[0];
        }
        
        return null;
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
let menuBarInstance = null;

export function getMenuBar() {
    if (!menuBarInstance) {
        menuBarInstance = new MenuBarUI();
    }
    return menuBarInstance;
}

export default MenuBarUI;

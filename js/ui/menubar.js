/**
 * MenuBar UI
 * Separate Arrangement and Mute Set dropdown menus in the menu bar.
 * Each dropdown opens directly to its content (no nested submenu layer).
 * Delete actions use a nested submenu within each dropdown.
 */

import * as State from '../state.js';
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
    validateName
} from '../api.js';

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
        
        // Dropdown state
        this.isArrangementOpen = false;
        this.isMuteOpen = false;
        this._isRefreshing = false;
        
        // Cache for API data
        this.arrangementCache = new Map(); // songName -> { data: string[], timestamp: number }
        this.muteSetCache = new Map(); // songName -> { data: string[], timestamp: number }
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
        });

        // Close dropdowns on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.isArrangementOpen) this.closeArrangementDropdown();
                if (this.isMuteOpen) this.closeMuteDropdown();
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
        
        // Close mute dropdown if open
        if (this.isMuteOpen) this.closeMuteDropdown();
        
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
        
        // Close arrangement dropdown if open
        if (this.isArrangementOpen) this.closeArrangementDropdown();
        
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

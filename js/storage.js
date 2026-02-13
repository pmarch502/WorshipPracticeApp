/**
 * Storage Module
 * Handles LocalStorage for application state (metadata only)
 * Note: Peaks are stored in IndexedDB, audio blobs in OPFS
 */

const STATE_KEY = 'worshipPracticeApp_state';
const PREFS_KEY = 'worshipPracticeApp_prefs';

/**
 * Default preferences
 */
const DEFAULT_PREFS = {
    pauseOnBlur: true  // Pause playback when tab loses focus
};

/**
 * Initialize storage (no-op, kept for compatibility)
 */
export async function initDatabase() {
    console.log('Storage initialized (LocalStorage only)');
    return Promise.resolve();
}

/**
 * Prepare state for storage by removing peaks from tracks
 * Peaks are stored separately in IndexedDB to avoid localStorage quota issues
 * @param {Object} state - State object to prepare
 * @returns {Object} - State object without peaks data
 */
function prepareStateForStorage(state) {
    return {
        ...state,
        songs: state.songs.map(song => ({
            ...song,
            tracks: song.tracks.map(track => {
                // Create a copy without peaks
                const { peaks, ...trackWithoutPeaks } = track;
                return trackWithoutPeaks;
            })
        }))
    };
}

/**
 * Save application state to LocalStorage
 * Peaks are excluded to avoid quota issues - they're stored in IndexedDB
 * @param {Object} state - State object to save
 */
export function saveState(state) {
    try {
        // Remove peaks from tracks before saving (they're in IndexedDB)
        const stateWithoutPeaks = prepareStateForStorage(state);
        const stateToSave = JSON.stringify(stateWithoutPeaks);
        localStorage.setItem(STATE_KEY, stateToSave);
    } catch (error) {
        console.error('Failed to save state:', error);
        
        // If storage is full, try to clear old data
        if (error.name === 'QuotaExceededError') {
            console.warn('LocalStorage quota exceeded, attempting cleanup');
            cleanupOldData();
        }
    }
}

/**
 * Load application state from LocalStorage
 * @returns {Object|null}
 */
export function loadState() {
    try {
        const stateJson = localStorage.getItem(STATE_KEY);
        if (stateJson) {
            return JSON.parse(stateJson);
        }
    } catch (error) {
        console.error('Failed to load state:', error);
    }
    return null;
}

/**
 * Clear all saved state
 */
export function clearState() {
    localStorage.removeItem(STATE_KEY);
}

/**
 * Cleanup old data when storage is full
 */
function cleanupOldData() {
    // For now, just log a warning
    // In a more complete implementation, we could remove old songs or tracks
    console.warn('Storage cleanup needed - consider removing unused songs/tracks');
}

/**
 * Get storage usage statistics
 */
export async function getStorageStats() {
    const stats = {
        localStorageUsed: 0
    };
    
    // LocalStorage usage
    try {
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                stats.localStorageUsed += localStorage[key].length * 2; // UTF-16
            }
        }
    } catch (e) {
        console.error('Failed to calculate LocalStorage usage:', e);
    }
    
    return stats;
}

/**
 * Debounced save function to prevent too many writes
 */
let saveTimeout = null;
export function debouncedSaveState(state, delay = 1000) {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    
    saveTimeout = setTimeout(() => {
        saveState(state);
        saveTimeout = null;
    }, delay);
}

/**
 * Load application preferences from LocalStorage
 * @returns {Object} Preferences object with defaults applied
 */
export function loadPreferences() {
    try {
        const prefsJson = localStorage.getItem(PREFS_KEY);
        if (prefsJson) {
            const saved = JSON.parse(prefsJson);
            // Merge with defaults to handle new preferences added in future versions
            return { ...DEFAULT_PREFS, ...saved };
        }
    } catch (error) {
        console.error('Failed to load preferences:', error);
    }
    return { ...DEFAULT_PREFS };
}

/**
 * Save application preferences to LocalStorage
 * @param {Object} prefs - Preferences object to save
 */
export function savePreferences(prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (error) {
        console.error('Failed to save preferences:', error);
    }
}

/**
 * Get a single preference value
 * @param {string} key - Preference key
 * @returns {*} Preference value or default
 */
export function getPreference(key) {
    const prefs = loadPreferences();
    return prefs[key];
}

/**
 * Set a single preference value
 * @param {string} key - Preference key
 * @param {*} value - Preference value
 */
export function setPreference(key, value) {
    const prefs = loadPreferences();
    prefs[key] = value;
    savePreferences(prefs);
}

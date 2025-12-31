/**
 * Peaks Cache - IndexedDB wrapper for storing waveform peaks data
 * 
 * Stores Float32Array peaks data by key (songName/trackFileName) for fast retrieval
 * without re-computing from audio on every load.
 */

const DB_NAME = 'worship-practice-peaks';
const DB_VERSION = 1;
const STORE_NAME = 'peaks';

let db = null;
let initialized = false;

/**
 * Check if IndexedDB is supported
 * @returns {boolean}
 */
export function isSupported() {
    return 'indexedDB' in window;
}

/**
 * Initialize the IndexedDB database
 * @returns {Promise<boolean>} True if initialization succeeded
 */
export async function init() {
    if (initialized) return true;
    
    if (!isSupported()) {
        console.warn('IndexedDB is not supported in this browser');
        return false;
    }
    
    return new Promise((resolve) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (event) => {
            console.error('Failed to open peaks database:', event.target.error);
            resolve(false);
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            initialized = true;
            console.log('Peaks cache initialized');
            resolve(true);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            
            // Create peaks object store if it doesn't exist
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'trackId' });
                console.log('Created peaks object store');
            }
        };
    });
}

/**
 * Store peaks data for a track
 * @param {string} trackId - Unique track identifier
 * @param {Float32Array|number[]} peaks - Peaks data
 * @returns {Promise<boolean>} True if stored successfully
 */
export async function store(trackId, peaks) {
    if (!initialized || !db) {
        throw new Error('Peaks cache not initialized');
    }
    
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // Convert Float32Array to regular array for storage
        const peaksArray = peaks instanceof Float32Array ? Array.from(peaks) : peaks;
        
        const request = store.put({
            trackId,
            peaks: peaksArray,
            timestamp: Date.now()
        });
        
        request.onsuccess = () => {
            console.log(`Cached peaks for track: ${trackId} (${peaksArray.length} samples)`);
            resolve(true);
        };
        
        request.onerror = (event) => {
            console.error(`Failed to cache peaks for ${trackId}:`, event.target.error);
            resolve(false);
        };
    });
}

/**
 * Retrieve peaks data for a track
 * @param {string} trackId - Unique track identifier
 * @returns {Promise<Float32Array|null>} Peaks data or null if not found
 */
export async function retrieve(trackId) {
    if (!initialized || !db) {
        throw new Error('Peaks cache not initialized');
    }
    
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(trackId);
        
        request.onsuccess = (event) => {
            const result = event.target.result;
            if (result && result.peaks) {
                console.log(`Retrieved peaks for track: ${trackId}`);
                // Convert back to Float32Array
                resolve(new Float32Array(result.peaks));
            } else {
                resolve(null);
            }
        };
        
        request.onerror = (event) => {
            console.error(`Failed to retrieve peaks for ${trackId}:`, event.target.error);
            resolve(null);
        };
    });
}

/**
 * Delete peaks data for a track
 * @param {string} trackId - Unique track identifier
 * @returns {Promise<boolean>} True if deleted successfully
 */
export async function deleteTrack(trackId) {
    if (!initialized || !db) {
        return false;
    }
    
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(trackId);
        
        request.onsuccess = () => {
            console.log(`Deleted peaks for track: ${trackId}`);
            resolve(true);
        };
        
        request.onerror = (event) => {
            console.error(`Failed to delete peaks for ${trackId}:`, event.target.error);
            resolve(false);
        };
    });
}

/**
 * Delete peaks for multiple tracks
 * @param {string[]} trackIds - Array of track identifiers
 * @returns {Promise<boolean>} True if all deleted successfully
 */
export async function deleteByTrackIds(trackIds) {
    if (!initialized || !db || trackIds.length === 0) {
        return false;
    }
    
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        let completed = 0;
        let success = true;
        
        for (const trackId of trackIds) {
            const request = store.delete(trackId);
            
            request.onsuccess = () => {
                completed++;
                if (completed === trackIds.length) {
                    console.log(`Deleted peaks for ${trackIds.length} tracks`);
                    resolve(success);
                }
            };
            
            request.onerror = () => {
                success = false;
                completed++;
                if (completed === trackIds.length) {
                    resolve(success);
                }
            };
        }
    });
}

/**
 * Clear all peaks data
 * @returns {Promise<boolean>} True if cleared successfully
 */
export async function clear() {
    if (!initialized || !db) {
        return false;
    }
    
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();
        
        request.onsuccess = () => {
            console.log('Cleared all peaks cache');
            resolve(true);
        };
        
        request.onerror = (event) => {
            console.error('Failed to clear peaks cache:', event.target.error);
            resolve(false);
        };
    });
}

/**
 * Get count of cached peaks entries
 * @returns {Promise<number>}
 */
export async function getCount() {
    if (!initialized || !db) {
        return 0;
    }
    
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();
        
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        
        request.onerror = () => {
            resolve(0);
        };
    });
}

/**
 * Check if peaks exist for a track
 * @param {string} trackId 
 * @returns {Promise<boolean>}
 */
export async function has(trackId) {
    if (!initialized || !db) {
        return false;
    }
    
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getKey(trackId);
        
        request.onsuccess = (event) => {
            resolve(event.target.result !== undefined);
        };
        
        request.onerror = () => {
            resolve(false);
        };
    });
}

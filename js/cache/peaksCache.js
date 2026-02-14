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
 * @param {{left: Float32Array, right: Float32Array|null, isStereo: boolean, maxPeak?: number}} peaks - Stereo peaks data
 * @returns {Promise<boolean>} True if stored successfully
 */
export async function store(trackId, peaks) {
    if (!initialized || !db) {
        throw new Error('Peaks cache not initialized');
    }
    
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // Convert Float32Arrays to regular arrays for storage
        const peaksData = {
            left: peaks.left instanceof Float32Array ? Array.from(peaks.left) : peaks.left,
            right: peaks.right ? (peaks.right instanceof Float32Array ? Array.from(peaks.right) : peaks.right) : null,
            isStereo: peaks.isStereo,
            maxPeak: peaks.maxPeak !== undefined ? peaks.maxPeak : null
        };
        
        const request = store.put({
            trackId,
            peaks: peaksData,
            timestamp: Date.now()
        });
        
        request.onsuccess = () => {
            console.log(`Cached peaks for track: ${trackId} (${peaksData.left.length} samples, stereo: ${peaksData.isStereo}, maxPeak: ${peaksData.maxPeak})`);
            resolve(true);
        };
        
        request.onerror = (event) => {
            console.error(`Failed to cache peaks for ${trackId}:`, event.target.error);
            resolve(false);
        };
    });
}

/**
 * Calculate maxPeak from peaks arrays (for legacy cached data without maxPeak)
 * @param {Float32Array} leftPeaks
 * @param {Float32Array|null} rightPeaks
 * @returns {number}
 */
function calculateMaxPeak(leftPeaks, rightPeaks) {
    let maxPeak = 0;
    for (let i = 0; i < leftPeaks.length; i++) {
        if (leftPeaks[i] > maxPeak) maxPeak = leftPeaks[i];
    }
    if (rightPeaks) {
        for (let i = 0; i < rightPeaks.length; i++) {
            if (rightPeaks[i] > maxPeak) maxPeak = rightPeaks[i];
        }
    }
    return maxPeak;
}

/**
 * Retrieve peaks data for a track
 * @param {string} trackId - Unique track identifier
 * @returns {Promise<{left: Float32Array, right: Float32Array|null, isStereo: boolean, maxPeak: number}|null>} Peaks data or null if not found
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
                // Convert back to Float32Arrays (handle new stereo format)
                const peaks = result.peaks;
                if (peaks.left !== undefined) {
                    // New stereo format
                    const leftPeaks = new Float32Array(peaks.left);
                    const rightPeaks = peaks.right ? new Float32Array(peaks.right) : null;
                    
                    // Use stored maxPeak or calculate from peaks (for legacy cached data)
                    const maxPeak = peaks.maxPeak !== undefined && peaks.maxPeak !== null
                        ? peaks.maxPeak
                        : calculateMaxPeak(leftPeaks, rightPeaks);
                    
                    resolve({
                        left: leftPeaks,
                        right: rightPeaks,
                        isStereo: peaks.isStereo,
                        maxPeak: maxPeak
                    });
                } else {
                    // Legacy mono format - convert to new format
                    const leftPeaks = new Float32Array(peaks);
                    const maxPeak = calculateMaxPeak(leftPeaks, null);
                    resolve({
                        left: leftPeaks,
                        right: null,
                        isStereo: false,
                        maxPeak: maxPeak
                    });
                }
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

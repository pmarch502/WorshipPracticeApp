/**
 * Peaks Cache - IndexedDB wrapper for storing waveform peaks data
 *
 * Stores Float32Array peaks data by key (songName/trackFileName) for fast retrieval
 * without re-computing from audio on every load.
 *
 * Resilient to stale IndexedDB connections caused by Safari's aggressive tab
 * freezing/bfcache — withTransaction() detects stale handles and reconnects.
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
 * Reset initialized state so init() will re-open the IndexedDB connection.
 * Called when recovering from bfcache restoration (Safari tab freeze).
 */
export function resetInitialized() {
    initialized = false;
    db = null;
}

/**
 * Execute a callback that uses an IndexedDB transaction.
 * If the transaction fails due to a stale connection (e.g. Safari bfcache),
 * resets and re-initializes the database, then retries once.
 *
 * @param {IDBTransactionMode} mode - 'readonly' or 'readwrite'
 * @param {function(IDBObjectStore): IDBRequest} callback - receives the object store, returns a request
 * @param {*} defaultValue - value to return on failure
 * @returns {Promise<*>}
 */
async function withTransaction(mode, callback, defaultValue) {
    for (let attempt = 0; attempt < 2; attempt++) {
        if (!initialized || !db) {
            const ok = await init();
            if (!ok) return defaultValue;
        }

        try {
            const result = await new Promise((resolve, reject) => {
                let transaction;
                try {
                    transaction = db.transaction([STORE_NAME], mode);
                } catch (err) {
                    // Stale connection — db.transaction() itself throws
                    reject(err);
                    return;
                }

                const objectStore = transaction.objectStore(STORE_NAME);
                const request = callback(objectStore);

                request.onsuccess = (event) => resolve(event.target.result);
                request.onerror = (event) => reject(event.target.error);

                // Also catch transaction-level errors (e.g. connection lost mid-transaction)
                transaction.onerror = (event) => reject(event.target.error);
            });
            return result;
        } catch (err) {
            if (attempt === 0) {
                console.warn('IndexedDB transaction failed (stale connection?), reinitializing...', err);
                initialized = false;
                db = null;
                // Loop will retry after re-init
            } else {
                console.error('IndexedDB transaction failed after reinit:', err);
                return defaultValue;
            }
        }
    }
    return defaultValue;
}

/**
 * Store peaks data for a track
 * @param {string} trackId - Unique track identifier
 * @param {{left: Float32Array, right: Float32Array|null, isStereo: boolean, maxPeak?: number}} peaks - Stereo peaks data
 * @returns {Promise<boolean>} True if stored successfully
 */
export async function store(trackId, peaks) {
    if (!initialized || !db) {
        // Try to initialize instead of throwing — handles stale state gracefully
        const ok = await init();
        if (!ok) return false;
    }

    // Convert Float32Arrays to regular arrays for storage
    const peaksData = {
        left: peaks.left instanceof Float32Array ? Array.from(peaks.left) : peaks.left,
        right: peaks.right ? (peaks.right instanceof Float32Array ? Array.from(peaks.right) : peaks.right) : null,
        isStereo: peaks.isStereo,
        maxPeak: peaks.maxPeak !== undefined ? peaks.maxPeak : null
    };

    const result = await withTransaction('readwrite', (objectStore) => {
        return objectStore.put({
            trackId,
            peaks: peaksData,
            timestamp: Date.now()
        });
    }, null);

    if (result !== null) {
        console.log(`Cached peaks for track: ${trackId} (${peaksData.left.length} samples, stereo: ${peaksData.isStereo}, maxPeak: ${peaksData.maxPeak})`);
        return true;
    }
    return false;
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
        // Try to initialize instead of throwing — handles stale state gracefully
        const ok = await init();
        if (!ok) return null;
    }

    const raw = await withTransaction('readonly', (objectStore) => {
        return objectStore.get(trackId);
    }, null);

    if (raw && raw.peaks) {
        console.log(`Retrieved peaks for track: ${trackId}`);
        const peaks = raw.peaks;
        if (peaks.left !== undefined) {
            // New stereo format
            const leftPeaks = new Float32Array(peaks.left);
            const rightPeaks = peaks.right ? new Float32Array(peaks.right) : null;

            // Use stored maxPeak or calculate from peaks (for legacy cached data)
            const maxPeak = peaks.maxPeak !== undefined && peaks.maxPeak !== null
                ? peaks.maxPeak
                : calculateMaxPeak(leftPeaks, rightPeaks);

            return {
                left: leftPeaks,
                right: rightPeaks,
                isStereo: peaks.isStereo,
                maxPeak: maxPeak
            };
        } else {
            // Legacy mono format - convert to new format
            const leftPeaks = new Float32Array(peaks);
            const maxPeak = calculateMaxPeak(leftPeaks, null);
            return {
                left: leftPeaks,
                right: null,
                isStereo: false,
                maxPeak: maxPeak
            };
        }
    }
    return null;
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

    const result = await withTransaction('readwrite', (objectStore) => {
        return objectStore.delete(trackId);
    }, null);

    if (result !== null) {
        console.log(`Deleted peaks for track: ${trackId}`);
        return true;
    }
    return false;
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

    // Use withTransaction for the first delete to test the connection,
    // then batch the rest in the same retry-aware pattern
    for (let attempt = 0; attempt < 2; attempt++) {
        if (!initialized || !db) {
            const ok = await init();
            if (!ok) return false;
        }

        try {
            return await new Promise((resolve, reject) => {
                let transaction;
                try {
                    transaction = db.transaction([STORE_NAME], 'readwrite');
                } catch (err) {
                    reject(err);
                    return;
                }

                const objectStore = transaction.objectStore(STORE_NAME);
                let completed = 0;
                let success = true;

                for (const trackId of trackIds) {
                    const request = objectStore.delete(trackId);

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

                transaction.onerror = (event) => reject(event.target.error);
            });
        } catch (err) {
            if (attempt === 0) {
                console.warn('IndexedDB batch delete failed (stale connection?), reinitializing...', err);
                initialized = false;
                db = null;
            } else {
                console.error('IndexedDB batch delete failed after reinit:', err);
                return false;
            }
        }
    }
    return false;
}

/**
 * Clear all peaks data
 * @returns {Promise<boolean>} True if cleared successfully
 */
export async function clear() {
    if (!initialized || !db) {
        return false;
    }

    const result = await withTransaction('readwrite', (objectStore) => {
        return objectStore.clear();
    }, null);

    if (result !== null) {
        console.log('Cleared all peaks cache');
        return true;
    }
    return false;
}

/**
 * Get count of cached peaks entries
 * @returns {Promise<number>}
 */
export async function getCount() {
    if (!initialized || !db) {
        return 0;
    }

    const result = await withTransaction('readonly', (objectStore) => {
        return objectStore.count();
    }, 0);

    return typeof result === 'number' ? result : 0;
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

    const result = await withTransaction('readonly', (objectStore) => {
        return objectStore.getKey(trackId);
    }, undefined);

    return result !== undefined;
}

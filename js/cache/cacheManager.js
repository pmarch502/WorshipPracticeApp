/**
 * Cache Manager - Unified cache coordinator
 * 
 * Coordinates OPFS (audio blobs) and IndexedDB (peaks) caches.
 * Provides a single API for all caching operations.
 */

import * as opfsCache from './opfsCache.js';
import * as peaksCache from './peaksCache.js';

let initialized = false;
let supported = false;

// Event for UI updates
const cacheUpdateEvent = new CustomEvent('cacheUpdated');

/**
 * Generate a deterministic peaks key from song and track names
 * This ensures peaks can be retrieved across sessions (trackId changes each time)
 * @param {string} songName 
 * @param {string} trackName 
 * @returns {string}
 */
function getPeaksKey(songName, trackName) {
    return `${songName}/${trackName}`;
}

/**
 * Check if all required caching APIs are supported
 * @returns {boolean}
 */
export function isSupported() {
    return opfsCache.isSupported() && peaksCache.isSupported();
}

/**
 * Initialize both caches
 * @returns {Promise<{supported: boolean, opfs: boolean, peaks: boolean}>}
 */
export async function init() {
    if (initialized) {
        return { supported, opfs: true, peaks: true };
    }
    
    const opfsOk = await opfsCache.init();
    const peaksOk = await peaksCache.init();
    
    supported = opfsOk && peaksOk;
    initialized = true;
    
    console.log(`Cache manager initialized - OPFS: ${opfsOk}, Peaks: ${peaksOk}`);
    
    return { supported, opfs: opfsOk, peaks: peaksOk };
}

/**
 * Cache a track's audio blob and peaks data
 * @param {string} songName - Song name (for OPFS directory)
 * @param {string} trackName - Track filename
 * @param {Blob} blob - Audio blob
 * @param {Float32Array} peaks - Peaks data
 * @returns {Promise<boolean>}
 */
export async function cacheTrack(songName, trackName, blob, peaks) {
    if (!initialized) {
        throw new Error('Cache manager not initialized');
    }
    
    // Use deterministic key for peaks (not trackId which changes each session)
    const peaksKey = getPeaksKey(songName, trackName);
    
    const results = await Promise.all([
        opfsCache.store(songName, trackName, blob),
        peaksCache.store(peaksKey, peaks)
    ]);
    
    // Notify UI of cache update
    notifyCacheUpdate();
    
    return results.every(r => r);
}

/**
 * Get cached audio blob for a track
 * @param {string} songName 
 * @param {string} trackName 
 * @returns {Promise<Blob|null>}
 */
export async function getAudioBlob(songName, trackName) {
    if (!initialized) return null;
    return await opfsCache.retrieve(songName, trackName);
}

/**
 * Get cached peaks for a track
 * @param {string} songName 
 * @param {string} trackName 
 * @returns {Promise<Float32Array|null>}
 */
export async function getPeaks(songName, trackName) {
    if (!initialized) return null;
    const peaksKey = getPeaksKey(songName, trackName);
    return await peaksCache.retrieve(peaksKey);
}

/**
 * Check if audio blob is cached
 * @param {string} songName 
 * @param {string} trackName 
 * @returns {Promise<boolean>}
 */
export async function hasAudioBlob(songName, trackName) {
    if (!initialized) return false;
    return await opfsCache.has(songName, trackName);
}

/**
 * Check if peaks are cached
 * @param {string} songName 
 * @param {string} trackName 
 * @returns {Promise<boolean>}
 */
export async function hasPeaks(songName, trackName) {
    if (!initialized) return false;
    const peaksKey = getPeaksKey(songName, trackName);
    return await peaksCache.has(peaksKey);
}

/**
 * Invalidate (delete) cache for a song and its tracks
 * @param {string} songName - Song name
 * @param {string[]} trackNames - Array of track filenames to delete peaks for
 * @returns {Promise<boolean>}
 */
export async function invalidateSong(songName, trackNames) {
    if (!initialized) return false;
    
    // Generate peaks keys from song/track names
    const peaksKeys = trackNames.map(trackName => getPeaksKey(songName, trackName));
    
    const results = await Promise.all([
        opfsCache.deleteSong(songName),
        peaksCache.deleteByTrackIds(peaksKeys)
    ]);
    
    // Notify UI of cache update
    notifyCacheUpdate();
    
    console.log(`Invalidated cache for song: ${songName}`);
    return results.every(r => r);
}

/**
 * Invalidate a single track
 * @param {string} songName 
 * @param {string} trackName 
 * @returns {Promise<boolean>}
 */
export async function invalidateTrack(songName, trackName) {
    if (!initialized) return false;
    
    const peaksKey = getPeaksKey(songName, trackName);
    
    const results = await Promise.all([
        opfsCache.deleteTrack(songName, trackName),
        peaksCache.deleteTrack(peaksKey)
    ]);
    
    notifyCacheUpdate();
    
    return results.every(r => r);
}

/**
 * Clear all caches
 * @returns {Promise<boolean>}
 */
export async function clearAll() {
    if (!initialized) return false;
    
    const results = await Promise.all([
        opfsCache.clear(),
        peaksCache.clear()
    ]);
    
    notifyCacheUpdate();
    
    console.log('Cleared all caches');
    return results.every(r => r);
}

/**
 * Get storage statistics
 * @returns {Promise<{used: number, quota: number, percent: number, usedFormatted: string, quotaFormatted: string}>}
 */
export async function getStorageStats() {
    const { used, quota, percent } = await opfsCache.getUsage();
    
    return {
        used,
        quota,
        percent,
        usedFormatted: formatBytes(used),
        quotaFormatted: formatBytes(quota)
    };
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Notify listeners that cache has been updated
 */
function notifyCacheUpdate() {
    window.dispatchEvent(new CustomEvent('cacheUpdated'));
}

/**
 * Subscribe to cache update events
 * @param {Function} callback 
 * @returns {Function} Unsubscribe function
 */
export function onCacheUpdate(callback) {
    const handler = () => callback();
    window.addEventListener('cacheUpdated', handler);
    return () => window.removeEventListener('cacheUpdated', handler);
}

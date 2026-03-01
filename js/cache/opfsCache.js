/**
 * OPFS Cache - Origin Private File System wrapper for audio blob storage
 * 
 * File structure:
 * /audio-cache/
 *   /{songName}/
 *     /{trackFileName}          (compressed MP3 blob)
 *     /{trackFileName}.pcm      (decoded PCM data, when cachePCMToDisk preference is enabled)
 */

const CACHE_ROOT = 'audio-cache';

let rootDirectory = null;
let initialized = false;

/**
 * Check if OPFS is supported in this browser
 * @returns {boolean}
 */
export function isSupported() {
    return 'storage' in navigator && 'getDirectory' in navigator.storage;
}

/**
 * Initialize OPFS access
 * @returns {Promise<boolean>} True if initialization succeeded
 */
export async function init() {
    if (initialized) return true;
    
    if (!isSupported()) {
        console.warn('OPFS is not supported in this browser');
        return false;
    }
    
    try {
        rootDirectory = await navigator.storage.getDirectory();
        initialized = true;
        console.log('OPFS cache initialized');
        return true;
    } catch (error) {
        console.error('Failed to initialize OPFS:', error);
        return false;
    }
}

/**
 * Get or create the cache root directory
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function getCacheRoot() {
    if (!rootDirectory) {
        throw new Error('OPFS not initialized');
    }
    return await rootDirectory.getDirectoryHandle(CACHE_ROOT, { create: true });
}

/**
 * Get or create a song directory
 * @param {string} songName 
 * @param {boolean} create 
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
async function getSongDirectory(songName, create = false) {
    const cacheRoot = await getCacheRoot();
    const safeName = sanitizeName(songName);
    
    try {
        return await cacheRoot.getDirectoryHandle(safeName, { create });
    } catch (error) {
        if (error.name === 'NotFoundError') {
            return null;
        }
        throw error;
    }
}

/**
 * Sanitize a name for use as a directory/file name
 * @param {string} name 
 * @returns {string}
 */
function sanitizeName(name) {
    // Replace problematic characters with underscores
    return name.replace(/[<>:"/\\|?*]/g, '_');
}

/**
 * Store an audio blob in OPFS
 * @param {string} songName - Song name (used as directory)
 * @param {string} trackName - Track filename
 * @param {Blob} blob - Audio blob to store
 * @returns {Promise<boolean>} True if stored successfully
 */
export async function store(songName, trackName, blob) {
    if (!initialized) {
        throw new Error('OPFS not initialized');
    }
    
    try {
        const songDir = await getSongDirectory(songName, true);
        const safeTrackName = sanitizeName(trackName);
        
        const fileHandle = await songDir.getFileHandle(safeTrackName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        
        console.log(`Cached audio: ${songName}/${trackName} (${formatBytes(blob.size)})`);
        return true;
    } catch (error) {
        console.error(`Failed to cache audio ${songName}/${trackName}:`, error);
        return false;
    }
}

/**
 * Retrieve an audio blob from OPFS
 * @param {string} songName - Song name
 * @param {string} trackName - Track filename
 * @returns {Promise<Blob|null>} The blob or null if not found
 */
export async function retrieve(songName, trackName) {
    if (!initialized) {
        throw new Error('OPFS not initialized');
    }
    
    try {
        const songDir = await getSongDirectory(songName, false);
        if (!songDir) return null;
        
        const safeTrackName = sanitizeName(trackName);
        const fileHandle = await songDir.getFileHandle(safeTrackName);
        const file = await fileHandle.getFile();
        
        console.log(`Retrieved from cache: ${songName}/${trackName} (${formatBytes(file.size)})`);
        return file;
    } catch (error) {
        if (error.name === 'NotFoundError') {
            return null;
        }
        console.error(`Failed to retrieve ${songName}/${trackName}:`, error);
        return null;
    }
}

/**
 * Store decoded PCM data in OPFS
 * @param {string} songName - Song name (used as directory)
 * @param {string} trackName - Track filename
 * @param {Blob} pcmBlob - Serialized PCM blob from audioEngine.serializeAudioBuffer()
 * @returns {Promise<boolean>} True if stored successfully
 */
export async function storePCM(songName, trackName, pcmBlob) {
    if (!initialized) {
        throw new Error('OPFS not initialized');
    }
    
    try {
        const songDir = await getSongDirectory(songName, true);
        const safeTrackName = sanitizeName(trackName) + '.pcm';
        
        const fileHandle = await songDir.getFileHandle(safeTrackName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(pcmBlob);
        await writable.close();
        
        console.log(`Cached PCM: ${songName}/${trackName} (${formatBytes(pcmBlob.size)})`);
        return true;
    } catch (error) {
        console.error(`Failed to cache PCM ${songName}/${trackName}:`, error);
        return false;
    }
}

/**
 * Retrieve decoded PCM data from OPFS
 * @param {string} songName - Song name
 * @param {string} trackName - Track filename
 * @returns {Promise<Blob|null>} The PCM blob or null if not found
 */
export async function retrievePCM(songName, trackName) {
    if (!initialized) {
        throw new Error('OPFS not initialized');
    }
    
    try {
        const songDir = await getSongDirectory(songName, false);
        if (!songDir) return null;
        
        const safeTrackName = sanitizeName(trackName) + '.pcm';
        const fileHandle = await songDir.getFileHandle(safeTrackName);
        const file = await fileHandle.getFile();
        
        console.log(`Retrieved PCM from cache: ${songName}/${trackName} (${formatBytes(file.size)})`);
        return file;
    } catch (error) {
        if (error.name === 'NotFoundError') {
            return null;
        }
        console.error(`Failed to retrieve PCM ${songName}/${trackName}:`, error);
        return null;
    }
}

/**
 * Check if a track is cached
 * @param {string} songName 
 * @param {string} trackName 
 * @returns {Promise<boolean>}
 */
export async function has(songName, trackName) {
    if (!initialized) return false;
    
    try {
        const songDir = await getSongDirectory(songName, false);
        if (!songDir) return false;
        
        const safeTrackName = sanitizeName(trackName);
        await songDir.getFileHandle(safeTrackName);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Delete a single track from cache
 * @param {string} songName 
 * @param {string} trackName 
 * @returns {Promise<boolean>}
 */
export async function deleteTrack(songName, trackName) {
    if (!initialized) return false;
    
    try {
        const songDir = await getSongDirectory(songName, false);
        if (!songDir) return false;
        
        const safeTrackName = sanitizeName(trackName);
        await songDir.removeEntry(safeTrackName);
        console.log(`Deleted from cache: ${songName}/${trackName}`);
        return true;
    } catch (error) {
        if (error.name === 'NotFoundError') {
            return true; // Already deleted
        }
        console.error(`Failed to delete ${songName}/${trackName}:`, error);
        return false;
    }
}

/**
 * Delete all cached tracks for a song
 * @param {string} songName 
 * @returns {Promise<boolean>}
 */
export async function deleteSong(songName) {
    if (!initialized) return false;
    
    try {
        const cacheRoot = await getCacheRoot();
        const safeName = sanitizeName(songName);
        
        await cacheRoot.removeEntry(safeName, { recursive: true });
        console.log(`Deleted song cache: ${songName}`);
        return true;
    } catch (error) {
        if (error.name === 'NotFoundError') {
            return true; // Already deleted
        }
        console.error(`Failed to delete song cache ${songName}:`, error);
        return false;
    }
}

/**
 * Clear all cached audio
 * @returns {Promise<boolean>}
 */
export async function clear() {
    if (!initialized) return false;
    
    try {
        await rootDirectory.removeEntry(CACHE_ROOT, { recursive: true });
        console.log('Cleared all audio cache');
        return true;
    } catch (error) {
        if (error.name === 'NotFoundError') {
            return true; // Already empty
        }
        console.error('Failed to clear cache:', error);
        return false;
    }
}

/**
 * Get storage usage information
 * @returns {Promise<{used: number, quota: number, percent: number}>}
 */
export async function getUsage() {
    try {
        const estimate = await navigator.storage.estimate();
        const used = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const percent = quota > 0 ? Math.round((used / quota) * 100) : 0;
        
        return { used, quota, percent };
    } catch (error) {
        console.error('Failed to get storage estimate:', error);
        return { used: 0, quota: 0, percent: 0 };
    }
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
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get formatted usage string
 * @returns {Promise<string>}
 */
export async function getUsageString() {
    const { used, quota, percent } = await getUsage();
    return `${formatBytes(used)} / ${formatBytes(quota)} (${percent}%)`;
}

/**
 * Metadata Loader Module
 * Handles loading song metadata from metadata.json files
 */

// Cache for loaded metadata
const metadataCache = new Map();

/**
 * Load metadata for a song
 * @param {string} songName - Song name (directory name)
 * @returns {Promise<Object|null>} Metadata object or null if not found
 */
export async function loadMetadata(songName) {
    // Return cached if available
    if (metadataCache.has(songName)) {
        return metadataCache.get(songName);
    }
    
    try {
        const path = `audio/${encodeURIComponent(songName)}/metadata.json`;
        const response = await fetch(path);
        if (!response.ok) {
            console.warn(`No metadata found for ${songName}`);
            return null;
        }
        const metadata = await response.json();
        metadataCache.set(songName, metadata);
        return metadata;
    } catch (error) {
        console.warn(`Failed to load metadata for ${songName}:`, error);
        return null;
    }
}

/**
 * Get cached metadata for a song (sync)
 * @param {string} songName - Song name
 * @returns {Object|null} Cached metadata or null
 */
export function getMetadata(songName) {
    return metadataCache.get(songName) || null;
}

/**
 * Clear metadata cache
 */
export function clearCache() {
    metadataCache.clear();
}

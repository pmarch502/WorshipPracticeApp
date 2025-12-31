/**
 * Manifest Loader Module
 * Handles loading and caching the audio manifest
 */

let manifest = null;
let loadPromise = null;

/**
 * Load the manifest from the server
 * @returns {Promise<Object>} The manifest object
 */
export async function loadManifest() {
    // Return cached manifest if available
    if (manifest) {
        return manifest;
    }
    
    // If already loading, return the existing promise
    if (loadPromise) {
        return loadPromise;
    }
    
    // Load manifest
    loadPromise = fetch('audio/manifest.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load manifest: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            manifest = data;
            loadPromise = null;
            console.log(`Manifest loaded: ${manifest.songs.length} songs available`);
            return manifest;
        })
        .catch(error => {
            loadPromise = null;
            console.error('Error loading manifest:', error);
            throw error;
        });
    
    return loadPromise;
}

/**
 * Get all available songs
 * @returns {Array} Array of song objects
 */
export function getSongs() {
    return manifest?.songs || [];
}

/**
 * Get a song by name
 * @param {string} songName - The song name
 * @returns {Object|null} The song object or null
 */
export function getSong(songName) {
    return manifest?.songs.find(s => s.name === songName) || null;
}

/**
 * Get tracks for a specific song
 * @param {string} songName - The song name
 * @returns {Array} Array of track filenames
 */
export function getSongTracks(songName) {
    const song = getSong(songName);
    return song?.tracks || [];
}

/**
 * Get the file path for a track
 * @param {string} songName - The song name
 * @param {string} trackFileName - The track filename
 * @returns {string} The full path to the track file
 */
export function getTrackPath(songName, trackFileName) {
    return `audio/${encodeURIComponent(songName)}/${encodeURIComponent(trackFileName)}`;
}

/**
 * Get display name for a track (filename without extension)
 * @param {string} trackFileName - The track filename
 * @returns {string} The display name
 */
export function getTrackDisplayName(trackFileName) {
    return trackFileName.replace(/\.[^/.]+$/, '');
}

/**
 * Check if manifest is loaded
 * @returns {boolean}
 */
export function isLoaded() {
    return manifest !== null;
}

/**
 * Clear cached manifest (useful for testing)
 */
export function clearCache() {
    manifest = null;
    loadPromise = null;
}

/**
 * Song Manager
 * Handles multi-song management with manifest-based songs
 */

import * as State from './state.js';
import * as TrackManager from './trackManager.js';
import { getModal } from './ui/modal.js';
import { getAudioEngine } from './audioEngine.js';
import { getTransport } from './transport.js';
import * as cacheManager from './cache/cacheManager.js';
import * as Metadata from './metadata.js';
import * as Manifest from './manifest.js';

/**
 * Open a song from the manifest
 * @param {string} songName - Song name from manifest
 * @returns {Object} - Created song object
 */
export function openSong(songName) {
    // Stop any current playback
    const audioEngine = getAudioEngine();
    if (State.state.playbackState === 'playing') {
        audioEngine.stop();
    }
    
    // Unload current song's tracks
    const currentSong = State.getActiveSong();
    if (currentSong) {
        TrackManager.unloadTracksForSong(currentSong);
    }
    
    // Create new song (no tracks loaded initially)
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
 * Switch to a different song
 * @param {string} songId - Song ID to switch to
 * @returns {Promise<boolean>} - true if switch succeeded, false if cancelled
 */
export async function switchSong(songId) {
    const currentSong = State.getActiveSong();
    const targetSong = State.getSong(songId);
    
    if (!targetSong || (currentSong && currentSong.id === songId)) {
        return false;
    }
    
    // Check for unsaved changes before switching (Phase 7)
    if (State.hasAnyUnsavedChanges()) {
        const modal = getModal();
        
        // Determine what has changes
        let itemType, itemName;
        if (State.hasUnsavedArrangementChanges()) {
            itemType = 'arrangement';
            itemName = State.getCurrentArrangementDisplayName() || 'Original';
        } else {
            itemType = 'mute set';
            itemName = State.getCurrentMuteSetDisplayName() || 'None';
        }
        
        const result = await modal.unsavedChangesWarning(itemType, itemName);
        
        if (result === 'cancel') {
            return false;
        }
        
        if (result === 'save') {
            // Import menubar dynamically to avoid circular dependency
            const { getMenuBar } = await import('./ui/menubar.js');
            const menubar = getMenuBar();
            
            // Save the current changes
            if (State.hasUnsavedArrangementChanges()) {
                await menubar.saveCurrentArrangement(currentSong);
            }
            if (State.hasUnsavedMuteChanges()) {
                await menubar.saveCurrentMuteSet(currentSong);
            }
        }
        // 'discard' - continue without saving
    }
    
    // Stop any current playback
    const audioEngine = getAudioEngine();
    if (State.state.playbackState === 'playing') {
        audioEngine.stop();
    }
    
    // Unload current song's tracks
    if (currentSong) {
        TrackManager.unloadTracksForSong(currentSong);
    }
    
    // Switch to new song
    State.switchSong(songId);
    
    // Apply the target song's pitch and speed to the audio engine
    const transport = getTransport();
    transport.setSpeed(targetSong.transport.speed);
    transport.setPitch(targetSong.transport.pitch);
    
    // Load new song's tracks
    if (targetSong.tracks.length > 0) {
        State.setLoading(true, 'Loading tracks...');
        try {
            await TrackManager.loadTracksForSong(targetSong);
        } finally {
            State.setLoading(false);
        }
    }
    
    return true;
}

/**
 * Close a song
 * @param {string} songId - Song ID to close
 * @param {boolean} confirm - Whether to show confirmation (not used in new model)
 */
export async function closeSong(songId, confirm = false) {
    const song = State.getSong(songId);
    if (!song) return false;
    
    const audioEngine = getAudioEngine();
    
    // Stop playback if this is the active song
    if (State.state.activeSongId === songId) {
        if (State.state.playbackState === 'playing') {
            audioEngine.stop();
        }
        TrackManager.unloadTracksForSong(song);
    }
    
    // Clear caches for this song (OPFS audio blobs, IndexedDB peaks, memory AudioBuffers)
    const trackIds = song.tracks.map(t => t.id);
    const trackFileNames = song.tracks.map(t => {
        // Extract filename from path
        const parts = t.filePath.split('/');
        return decodeURIComponent(parts[parts.length - 1]);
    });
    
    // Clear in-memory AudioBuffer cache
    audioEngine.clearAudioBuffers(trackIds);
    
    // Only invalidate persistent caches if no other open song shares the same songName
    // (the same song can be opened multiple times with different arrangements/pitch)
    const otherInstanceExists = State.state.songs.some(
        s => s.id !== songId && s.songName === song.songName
    );
    if (!otherInstanceExists) {
        // Clear OPFS and IndexedDB caches (in background, don't wait)
        cacheManager.invalidateSong(song.songName, trackFileNames)
            .catch(err => console.warn('Failed to invalidate song cache:', err));
    }
    
    // Remove from mashup group if applicable
    State.removeSongFromMashupGroup(songId);
    
    // Remove song from state
    State.removeSong(songId);
    
    // If there's a new active song, load its tracks
    const newActiveSong = State.getActiveSong();
    if (newActiveSong && newActiveSong.tracks.length > 0) {
        State.setLoading(true, 'Loading tracks...');
        try {
            await TrackManager.loadTracksForSong(newActiveSong);
        } finally {
            State.setLoading(false);
        }
    }
    
    return true;
}

/**
 * Check if a song is already open
 * @param {string} songName - Song name from manifest
 * @returns {boolean}
 */
export function isSongOpen(songName) {
    return State.state.songs.some(s => s.songName === songName);
}

/**
 * Get song count
 */
export function getSongCount() {
    return State.state.songs.length;
}

/**
 * Get all songs
 */
export function getAllSongs() {
    return State.state.songs;
}

/**
 * Close all open songs
 * Stops playback, unloads tracks, clears caches, and removes all songs from state.
 */
export async function closeAllSongs() {
    const audioEngine = getAudioEngine();
    
    // Stop any current playback
    if (State.state.playbackState === 'playing') {
        audioEngine.stop();
    }
    
    // Collect all song IDs first (iterate copy to avoid mutation issues)
    const songIds = State.state.songs.map(s => s.id);
    
    for (const songId of songIds) {
        const song = State.getSong(songId);
        if (!song) continue;
        
        // Unload tracks from audio engine if this is the active song
        if (State.state.activeSongId === songId) {
            TrackManager.unloadTracksForSong(song);
        }
        
        // Clear in-memory AudioBuffer cache
        const trackIds = song.tracks.map(t => t.id);
        audioEngine.clearAudioBuffers(trackIds);
        
        // Invalidate persistent caches (only if no other instance of same song remains)
        const trackFileNames = song.tracks.map(t => {
            const parts = t.filePath.split('/');
            return decodeURIComponent(parts[parts.length - 1]);
        });
        const otherInstanceExists = State.state.songs.some(
            s => s.id !== songId && s.songName === song.songName
        );
        if (!otherInstanceExists && trackFileNames.length > 0) {
            cacheManager.invalidateSong(song.songName, trackFileNames)
                .catch(err => console.warn('Failed to invalidate song cache:', err));
        }
        
        // Remove from state
        State.removeSong(songId);
    }
}

/**
 * Open a song and automatically load tracks matching given keywords
 * Used by set list loading to auto-load click and reference tracks.
 * @param {string} songName - Song name from manifest
 * @param {string[]} trackKeywords - Keywords to match track filenames (case-insensitive)
 * @returns {Promise<Object>} - Created song object
 */
export async function openSongWithAutoTracks(songName, trackKeywords = ['click', 'reference']) {
    // Open the song (creates it in state, starts metadata load)
    const song = openSong(songName);
    
    // Ensure manifest is loaded
    await Manifest.loadManifest();
    const manifestSong = Manifest.getSong(songName);
    
    if (!manifestSong) {
        console.warn(`Song '${songName}' not found in manifest, skipping auto-track load`);
        return song;
    }
    
    // Filter tracks whose filename contains any of the keywords (case-insensitive)
    const matchingTracks = manifestSong.tracks.filter(trackName =>
        trackKeywords.some(kw => trackName.toLowerCase().includes(kw.toLowerCase()))
    );
    
    if (matchingTracks.length > 0) {
        // Switch to this song to make it active before loading tracks
        // (addTracksFromManifest operates on the active song)
        State.setLoading(true, `Loading tracks for "${songName}"...`);
        try {
            await TrackManager.addTracksFromManifest(songName, matchingTracks);
        } finally {
            State.setLoading(false);
        }
    }
    
    return song;
}

/**
 * Wait for metadata to be loaded for a song
 * @param {string} songId - Song ID
 * @param {number} timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns {Promise<Object|null>} - Metadata or null if timeout
 */
export function waitForMetadata(songId, timeoutMs = 5000) {
    return new Promise((resolve) => {
        const song = State.getSong(songId);
        if (song?.metadata) {
            resolve(song.metadata);
            return;
        }
        
        const timeout = setTimeout(() => {
            unsubscribe();
            resolve(null);
        }, timeoutMs);
        
        const unsubscribe = State.subscribe(State.Events.SONG_METADATA_UPDATED, (data) => {
            if (data?.song?.id === songId) {
                clearTimeout(timeout);
                unsubscribe();
                resolve(data.metadata || null);
            }
        });
    });
}

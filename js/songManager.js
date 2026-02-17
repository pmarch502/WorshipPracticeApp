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
    
    // Clear OPFS and IndexedDB caches (in background, don't wait)
    cacheManager.invalidateSong(song.songName, trackFileNames)
        .catch(err => console.warn('Failed to invalidate song cache:', err));
    
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

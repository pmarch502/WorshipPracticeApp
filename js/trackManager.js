/**
 * Track Manager
 * Handles track creation, deletion, and updates
 * Loads tracks from static audio files via manifest
 * Uses OPFS cache for audio blobs and IndexedDB for peaks
 */

import * as State from './state.js';
import * as Manifest from './manifest.js';
import { getAudioEngine } from './audioEngine.js';
import { getModal } from './ui/modal.js';
import * as cacheManager from './cache/cacheManager.js';

/**
 * Extract filename from a file path
 * @param {string} filePath 
 * @returns {string}
 */
function getFileNameFromPath(filePath) {
    const parts = filePath.split('/');
    return decodeURIComponent(parts[parts.length - 1]);
}

/**
 * Add a track from the manifest (static audio file)
 * Uses cache-first strategy: OPFS for audio blobs, IndexedDB for peaks
 * @param {string} songName - Song name from manifest
 * @param {string} trackFileName - Track filename (e.g., "Click Track.mp3")
 * @returns {Promise<Object>} - Created track object
 */
export async function addTrackFromManifest(songName, trackFileName) {
    const trackPath = Manifest.getTrackPath(songName, trackFileName);
    const trackName = Manifest.getTrackDisplayName(trackFileName);

    State.setLoading(true, `Loading "${trackName}"...`);

    try {
        const audioEngine = getAudioEngine();
        await audioEngine.init();

        let blob = null;
        let audioBuffer = null;
        let peaks = null;
        let fromCache = false;

        // 1. Try to get audio blob from OPFS cache
        const cachedBlob = await cacheManager.getAudioBlob(songName, trackFileName);
        
        if (cachedBlob) {
            blob = cachedBlob;
            fromCache = true;
            console.log(`Loaded audio from cache: ${songName}/${trackFileName}`);
        } else {
            // 2. Fetch from server
            State.setLoading(true, `Downloading "${trackName}"...`);
            const response = await fetch(trackPath);
            if (!response.ok) {
                throw new Error(`Failed to load audio file: ${response.status}`);
            }
            blob = await response.blob();
            console.log(`Downloaded audio from server: ${songName}/${trackFileName}`);
        }

        // 3. Decode audio
        audioBuffer = await audioEngine.decodeAudio(blob);
        
        // Compute duration explicitly from sample count and sample rate
        const computedDuration = audioBuffer.length / audioBuffer.sampleRate;

        // 4. Try to get peaks from cache (keyed by songName/trackFileName, not trackId)
        const cachedPeaks = await cacheManager.getPeaks(songName, trackFileName);
        
        if (cachedPeaks) {
            peaks = cachedPeaks;
            console.log(`Loaded peaks from cache: ${songName}/${trackFileName}`);
        } else {
            // 5. Extract peaks for waveform (200 samples per second, min 2000 total)
            peaks = audioEngine.extractPeaks(audioBuffer, 200);
            console.log(`Extracted peaks: ${songName}/${trackFileName}`);
        }

        // 6. Create track with peaks (peaks is now {left, right, isStereo} object)
        const track = State.createDefaultTrack(trackName, trackPath, computedDuration, peaks);

        // 7. Add to state
        State.addTrack(track);

        // 8. Cache audio blob and peaks if not from cache
        if (!fromCache) {
            // Cache in background - don't wait
            cacheManager.cacheTrack(songName, trackFileName, blob, peaks)
                .catch(err => console.warn('Failed to cache track:', err));
        } else if (!cachedPeaks) {
            // Audio was cached but peaks weren't - cache peaks
            cacheManager.cacheTrack(songName, trackFileName, blob, peaks)
                .catch(err => console.warn('Failed to cache peaks:', err));
        }

        // 9. Store AudioBuffer in audioEngine memory cache
        audioEngine.audioBuffers.set(track.id, audioBuffer);

        // 10. Create audio nodes
        audioEngine.createTrackNodes(track.id, audioBuffer);

        State.setLoading(false);
        return track;
    } catch (error) {
        State.setLoading(false);
        console.error('Failed to add track:', error);
        throw error;
    }
}

/**
 * Add multiple tracks from the manifest
 * @param {string} songName - Song name from manifest
 * @param {string[]} trackFileNames - Array of track filenames
 */
export async function addTracksFromManifest(songName, trackFileNames) {
    const errors = [];

    for (const trackFileName of trackFileNames) {
        try {
            await addTrackFromManifest(songName, trackFileName);
        } catch (error) {
            errors.push({ file: trackFileName, error: error.message });
        }
    }

    // Derive sections now that all tracks are loaded (need duration from tracks)
    const song = State.getActiveSong();
    if (song) {
        State.updateSongSections(song.id);
    }

    if (errors.length > 0) {
        const modal = getModal();
        const errorList = errors.map(e => `<li><strong>${e.file}</strong>: ${e.error}</li>`).join('');
        await modal.alert({
            title: 'Some tracks could not be loaded',
            message: `<ul>${errorList}</ul>`
        });
    }
}

/**
 * Delete a track
 * @param {string} trackId - Track ID
 * @param {boolean} confirm - Whether to show confirmation dialog
 */
export async function deleteTrack(trackId, confirm = true) {
    const track = State.getTrack(trackId);
    if (!track) return false;

    if (confirm) {
        const modal = getModal();
        const confirmed = await modal.confirmDelete(track.name);
        if (!confirmed) return false;
    }

    // Remove from audio engine
    const audioEngine = getAudioEngine();
    audioEngine.removeTrack(trackId);

    // Remove from state
    State.removeTrack(trackId);

    return true;
}

/**
 * Update track volume
 * @param {string} trackId - Track ID
 * @param {number} volume - Volume (0-100)
 */
export function setTrackVolume(trackId, volume) {
    State.updateTrack(trackId, { volume });
    
    const audioEngine = getAudioEngine();
    audioEngine.setTrackVolume(trackId, volume);
}

/**
 * Update track pan
 * @param {string} trackId - Track ID
 * @param {number} pan - Pan (-100 to 100)
 */
export function setTrackPan(trackId, pan) {
    State.updateTrack(trackId, { pan });
    
    const audioEngine = getAudioEngine();
    audioEngine.setTrackPan(trackId, pan);
}

/**
 * Toggle track solo
 * @param {string} trackId - Track ID
 */
export function toggleSolo(trackId) {
    const track = State.getTrack(trackId);
    if (!track) return;

    State.updateTrack(trackId, { solo: !track.solo });
    
    // Update all tracks' audibility
    const audioEngine = getAudioEngine();
    audioEngine.updateAllTracksAudibility();
}

/**
 * Toggle track mute
 * @param {string} trackId - Track ID
 */
export function toggleMute(trackId) {
    const track = State.getTrack(trackId);
    if (!track) return;

    State.updateTrack(trackId, { mute: !track.mute });
    
    // Update all tracks' audibility
    const audioEngine = getAudioEngine();
    audioEngine.updateAllTracksAudibility();
}

/**
 * Toggle track pitch-exempt status
 * Cycles through: auto-detected state -> opposite of auto -> back to auto (null)
 * @param {string} trackId - Track ID
 */
export function togglePitchExempt(trackId) {
    const track = State.getTrack(trackId);
    if (!track) return;
    
    // Get current effective state
    const currentEffective = State.isTrackPitchExempt(trackId);
    const isAutoDetected = track.pitchExempt === null || track.pitchExempt === undefined;
    const autoDetectedValue = State.isPitchExemptByName(track.name);
    
    let newValue;
    if (isAutoDetected) {
        // Currently auto-detected, switch to manual opposite
        newValue = !autoDetectedValue;
    } else if (track.pitchExempt !== autoDetectedValue) {
        // Manual override that differs from auto, reset to auto (null)
        newValue = null;
    } else {
        // Manual value same as auto would be, toggle to opposite
        newValue = !currentEffective;
    }
    
    State.updateTrack(trackId, { pitchExempt: newValue });
    
    // Update audio routing for this track
    const audioEngine = getAudioEngine();
    audioEngine.updateTrackPitchRouting(trackId);
}

/**
 * Load tracks for a song from their file paths
 * Used when switching back to a song that already has tracks loaded
 * Uses cache-first strategy: memory -> OPFS -> server
 */
export async function loadTracksForSong(song) {
    const audioEngine = getAudioEngine();
    await audioEngine.init();

    for (const track of song.tracks) {
        try {
            let audioBuffer = null;
            const trackFileName = getFileNameFromPath(track.filePath);
            
            // 1. Check in-memory AudioBuffer cache first (fastest)
            if (audioEngine.hasAudioBuffer(track.id)) {
                audioBuffer = audioEngine.getAudioBuffer(track.id);
                console.log(`Using memory-cached AudioBuffer: ${track.name}`);
            } else {
                // 2. Try OPFS cache
                const cachedBlob = await cacheManager.getAudioBlob(song.songName, trackFileName);
                
                if (cachedBlob) {
                    audioBuffer = await audioEngine.loadTrackAudio(track.id, cachedBlob);
                    console.log(`Loaded from OPFS cache: ${track.name}`);
                } else {
                    // 3. Fetch from server
                    console.log(`Fetching from server: ${track.name}`);
                    const response = await fetch(track.filePath);
                    if (!response.ok) {
                        console.warn(`Audio file not found for track: ${track.name}`);
                        continue;
                    }
                    const blob = await response.blob();
                    audioBuffer = await audioEngine.loadTrackAudio(track.id, blob);
                    
                    // Cache for future use (in background)
                    // peaks is now {left, right, isStereo} object
                    const peaks = track.peaks?.left ? track.peaks : audioEngine.extractPeaks(audioBuffer, 200);
                    cacheManager.cacheTrack(song.songName, trackFileName, blob, peaks)
                        .catch(err => console.warn('Failed to cache track:', err));
                }
                
                // 4. Load peaks from cache if track doesn't have them
                // peaks is now {left, right, isStereo} object
                if (!track.peaks || !track.peaks.left) {
                    const cachedPeaks = await cacheManager.getPeaks(song.songName, trackFileName);
                    if (cachedPeaks) {
                        track.peaks = cachedPeaks;
                        State.updateTrack(track.id, { peaks: track.peaks });
                    } else {
                        // Extract and cache peaks
                        const peaks = audioEngine.extractPeaks(audioBuffer, 200);
                        track.peaks = peaks;
                        State.updateTrack(track.id, { peaks: track.peaks });
                    }
                }
            }

            // Create audio nodes
            audioEngine.createTrackNodes(track.id, audioBuffer);
        } catch (error) {
            console.error(`Failed to load track ${track.name}:`, error);
        }
    }
    
    // Derive sections now that all tracks are loaded
    State.updateSongSections(song.id);
}

/**
 * Unload tracks for a song (when switching songs)
 */
export function unloadTracksForSong(song) {
    const audioEngine = getAudioEngine();
    
    for (const track of song.tracks) {
        audioEngine.removeTrack(track.id);
    }
}

/**
 * Get list of track filenames already loaded for the active song
 * @returns {string[]} Array of track filenames
 */
export function getLoadedTrackFileNames() {
    const song = State.getActiveSong();
    if (!song) return [];
    
    return song.tracks.map(track => getFileNameFromPath(track.filePath));
}

/**
 * Check if a track is already loaded
 * @param {string} trackFileName - Track filename
 * @returns {boolean}
 */
export function isTrackLoaded(trackFileName) {
    return getLoadedTrackFileNames().includes(trackFileName);
}

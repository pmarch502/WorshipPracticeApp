/**
 * Mashup Controller
 * Handles auto-continue playback between mashup tabs.
 * When a song finishes playing and it belongs to a mashup group,
 * automatically switches to the next tab and resumes playback.
 */

import * as State from './state.js';
import * as TrackManager from './trackManager.js';
import { getAudioEngine } from './audioEngine.js';
import { getTransport } from './transport.js';

// Guard against concurrent advance calls (RAF loop + scheduled timeout + source.onended)
let isAdvancing = false;

/**
 * Check if the active song is part of a mashup and has a next entry.
 * Called by the audio engine when playback reaches the end of a song.
 * @returns {boolean} True if mashup advance was triggered
 */
export async function tryMashupAdvance() {
    if (isAdvancing) return true; // Already advancing, don't trigger again
    const song = State.getActiveSong();
    if (!song || !song.mashupGroupId) return false;
    
    const nextSongId = State.getNextMashupSongId(song.id);
    
    if (nextSongId) {
        // There is a next entry - advance to it
        isAdvancing = true;
        try {
            await advanceToNextEntry(song, nextSongId);
        } catch (err) {
            console.error('Mashup advance failed:', err);
            // On failure, stop cleanly
            const audioEngine = getAudioEngine();
            audioEngine.setMasterMuted(false, 0);
            audioEngine.stop();
            isAdvancing = false;
            return false;
        }
        isAdvancing = false;
        return true;
    } else {
        // Last entry in mashup - stop and switch to first tab
        const firstSongId = State.getFirstMashupSongId(song.mashupGroupId);
        if (firstSongId && firstSongId !== song.id) {
            // Switch to first tab after stopping
            // The audio engine will call stop() after we return false
            // We schedule the tab switch for after the stop completes
            setTimeout(() => {
                switchToSongQuiet(firstSongId).catch(err => 
                    console.error('Failed to switch to first mashup tab:', err));
            }, 0);
        }
        return false; // Let the audio engine stop normally
    }
}

/**
 * Advance playback to the next mashup entry
 * @param {Object} currentSong - The currently playing song
 * @param {string} nextSongId - The next song's ID
 */
async function advanceToNextEntry(currentSong, nextSongId) {
    const audioEngine = getAudioEngine();
    const transport = getTransport();
    const nextSong = State.getSong(nextSongId);
    
    if (!nextSong) {
        console.warn('Mashup advance: next song not found in state');
        return;
    }
    
    // 1. Mute master to prevent audio artifacts
    audioEngine.setMasterMuted(true, 0);
    
    // 2. Stop current playback sources (but don't change playback state)
    audioEngine.stopAllSources();
    audioEngine.cancelScheduledEvents();
    
    // 3. Reset the departing song's position to 0 (mimics normal stop-at-end behavior)
    currentSong.transport.lastPlayPosition = 0;
    
    // 4. Unload current song's track nodes (not AudioBuffers - those stay cached)
    TrackManager.unloadTracksForSong(currentSong);
    
    // 5. Switch to the next song
    State.switchSong(nextSongId);
    
    // 6. Apply the next song's pitch and speed
    transport.setPitch(nextSong.transport.pitch);
    transport.setSpeed(nextSong.transport.speed);
    
    // 7. Load the next song's track nodes (AudioBuffers already in memory cache - this is fast)
    if (nextSong.tracks.length > 0) {
        await TrackManager.loadTracksForSong(nextSong);
    }
    
    // 8. Reset pitch shifter (needed if pitch changed between entries)
    await audioEngine.resetPitchShifter();
    
    // 9. Find the starting position - first enabled section or 0
    let startPos = 0;
    if (State.hasDisabledArrangementSections()) {
        const firstEnabled = State.getEnabledArrangementSectionAtOrAfter(0);
        if (firstEnabled) {
            startPos = firstEnabled.start;
        }
    }
    
    // 10. Start playback at the beginning of the next entry
    //     We directly set engine state and start tracks to avoid the full play() ceremony
    //     (which includes guards, muting, pitch shifter reset we already did)
    audioEngine.isPlaying = true;
    audioEngine.startTime = audioEngine.audioContext.currentTime;
    audioEngine.startPosition = startPos;
    audioEngine.sourceStartPosition = startPos;
    audioEngine.isInCrossfade = false;
    
    State.updateTransport({ lastPlayPosition: startPos });
    
    nextSong.tracks.forEach(track => {
        audioEngine.startTrack(track.id, startPos);
    });
    
    State.setPosition(startPos);
    State.setPlaybackState('playing');
    audioEngine.startPositionUpdate();
    audioEngine.scheduleNextEvents();
    
    // 11. Unmute after short delay to let SoundTouch pipeline settle
    setTimeout(() => {
        if (audioEngine.isPlaying) {
            audioEngine.setMasterMuted(false, 0.01);
        }
    }, 50);
    
    console.log(`Mashup advance: switched to "${nextSong.songName}" at position ${startPos.toFixed(3)}s`);
}

/**
 * Switch to a song without affecting playback or loading tracks.
 * Used to switch to the first tab at end of mashup.
 * @param {string} songId - Song ID to switch to
 */
async function switchToSongQuiet(songId) {
    const currentSong = State.getActiveSong();
    if (currentSong) {
        // Reset the last song's position to 0 before leaving it
        currentSong.transport.lastPlayPosition = 0;
        TrackManager.unloadTracksForSong(currentSong);
    }
    
    State.switchSong(songId);
    
    const targetSong = State.getSong(songId);
    if (targetSong) {
        const transport = getTransport();
        transport.setPitch(targetSong.transport.pitch);
        transport.setSpeed(targetSong.transport.speed);
        
        if (targetSong.tracks.length > 0) {
            await TrackManager.loadTracksForSong(targetSong);
        }
        
        // Reset position to 0 for the first song
        State.setPosition(0);
        State.updateTransport({ lastPlayPosition: 0 });
    }
}

/**
 * State Management
 * Central state store with event-based updates
 */

// Generate unique IDs
export function generateId() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
}

// Create default song
// songName links to the manifest song name
export function createDefaultSong(songName) {
    return {
        id: generateId(),
        songName: songName, // Links to manifest
        name: songName, // Display name (same as songName initially)
        tracks: [],
        metadata: null, // Will hold parsed metadata.json contents
        transport: {
            position: 0,
            lastPlayPosition: 0,
            speed: 1.0,
            pitch: 0,
            tempo: 120,
            timeSignature: '4/4',
            loopEnabled: false,
            loopStart: null,  // seconds (null = no loop set)
            loopEnd: null     // seconds
        },
        timeline: {
            mode: 'beats', // 'time' or 'beats'
            zoom: null, // null = auto-fit to window, otherwise zoom multiplier
            offset: 0 // Timeline offset in seconds
        }
    };
}

// Create default track
// filePath is the path to the static audio file
// peaks can be null initially - they'll be loaded from IndexedDB cache or extracted
export function createDefaultTrack(name, filePath, duration, peaks = null) {
    return {
        id: generateId(),
        name: name,
        filePath: filePath, // Path to audio file (e.g., "audio/SongName/Track.mp3")
        duration: duration,
        peaks: peaks, // Stored in IndexedDB, not localStorage
        volume: 80,
        pan: 0,
        solo: false,
        mute: false
    };
}

// Initial state
const initialState = {
    songs: [],
    activeSongId: null,
    playbackState: 'stopped', // 'stopped', 'playing', 'paused'
    ui: {
        selectedTrackId: null,
        isLoading: false,
        loadingMessage: ''
    }
};

// State store
export const state = { ...initialState };

// Event listeners
const listeners = new Map();

/**
 * Subscribe to state changes
 * @param {string} event - Event name
 * @param {Function} callback - Callback function
 * @returns {Function} Unsubscribe function
 */
export function subscribe(event, callback) {
    if (!listeners.has(event)) {
        listeners.set(event, new Set());
    }
    listeners.get(event).add(callback);
    
    return () => {
        listeners.get(event).delete(callback);
    };
}

/**
 * Emit an event
 * @param {string} event - Event name
 * @param {*} data - Event data
 */
export function emit(event, data = null) {
    if (listeners.has(event)) {
        listeners.get(event).forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in event listener for ${event}:`, error);
            }
        });
    }
    
    // Also emit a general 'stateChanged' event for auto-save
    if (event !== 'stateChanged') {
        emit('stateChanged', { event, data });
    }
}

// Event types
export const Events = {
    // Song events
    SONG_ADDED: 'songAdded',
    SONG_REMOVED: 'songRemoved',
    SONG_RENAMED: 'songRenamed',
    SONG_SWITCHED: 'songSwitched',
    SONG_METADATA_UPDATED: 'songMetadataUpdated',
    
    // Track events
    TRACK_ADDED: 'trackAdded',
    TRACK_REMOVED: 'trackRemoved',
    TRACK_UPDATED: 'trackUpdated',
    TRACK_SELECTED: 'trackSelected',
    
    // Transport events
    TRANSPORT_UPDATED: 'transportUpdated',
    PLAYBACK_STATE_CHANGED: 'playbackStateChanged',
    POSITION_CHANGED: 'positionChanged',
    LOOP_UPDATED: 'loopUpdated',
    
    // Timeline events
    TIMELINE_UPDATED: 'timelineUpdated',
    ZOOM_CHANGED: 'zoomChanged',
    
    // UI events
    LOADING_STATE_CHANGED: 'loadingStateChanged',
    
    // General
    STATE_CHANGED: 'stateChanged',
    STATE_LOADED: 'stateLoaded'
};

/**
 * Get the currently active song
 */
export function getActiveSong() {
    return state.songs.find(s => s.id === state.activeSongId) || null;
}

/**
 * Get a song by ID
 */
export function getSong(songId) {
    return state.songs.find(s => s.id === songId) || null;
}

/**
 * Get a track from the active song
 */
export function getTrack(trackId) {
    const song = getActiveSong();
    if (!song) return null;
    return song.tracks.find(t => t.id === trackId) || null;
}

/**
 * Add a new song
 */
export function addSong(song = null) {
    const newSong = song || createDefaultSong();
    state.songs.push(newSong);
    state.activeSongId = newSong.id;
    emit(Events.SONG_ADDED, newSong);
    emit(Events.SONG_SWITCHED, newSong);
    return newSong;
}

/**
 * Remove a song
 */
export function removeSong(songId) {
    const index = state.songs.findIndex(s => s.id === songId);
    if (index === -1) return false;
    
    const removed = state.songs.splice(index, 1)[0];
    
    // If we removed the active song, switch to another
    if (state.activeSongId === songId) {
        if (state.songs.length > 0) {
            // Switch to previous song or first song
            const newIndex = Math.max(0, index - 1);
            state.activeSongId = state.songs[newIndex].id;
            emit(Events.SONG_SWITCHED, state.songs[newIndex]);
        } else {
            state.activeSongId = null;
        }
    }
    
    emit(Events.SONG_REMOVED, removed);
    return true;
}

/**
 * Rename a song
 */
export function renameSong(songId, newName) {
    const song = getSong(songId);
    if (!song) return false;
    
    song.name = newName;
    emit(Events.SONG_RENAMED, song);
    return true;
}

/**
 * Switch to a different song
 */
export function switchSong(songId) {
    const song = getSong(songId);
    if (!song) return false;
    
    state.activeSongId = songId;
    emit(Events.SONG_SWITCHED, song);
    return true;
}

/**
 * Update metadata for a song
 * @param {string} songId - Song ID
 * @param {Object} metadata - Metadata object from metadata.json
 */
export function updateSongMetadata(songId, metadata) {
    const song = getSong(songId);
    if (!song) return false;
    
    song.metadata = metadata;
    emit(Events.SONG_METADATA_UPDATED, { song, metadata });
    return true;
}

/**
 * Add a track to the active song
 */
export function addTrack(track) {
    const song = getActiveSong();
    if (!song) return null;
    
    song.tracks.push(track);
    emit(Events.TRACK_ADDED, { song, track });
    return track;
}

/**
 * Remove a track from the active song
 */
export function removeTrack(trackId) {
    const song = getActiveSong();
    if (!song) return false;
    
    const index = song.tracks.findIndex(t => t.id === trackId);
    if (index === -1) return false;
    
    const removed = song.tracks.splice(index, 1)[0];
    
    // Clear selection if needed
    if (state.ui.selectedTrackId === trackId) {
        state.ui.selectedTrackId = null;
    }
    
    emit(Events.TRACK_REMOVED, { song, track: removed });
    return true;
}

/**
 * Update a track property
 */
export function updateTrack(trackId, updates) {
    const track = getTrack(trackId);
    if (!track) return false;
    
    Object.assign(track, updates);
    emit(Events.TRACK_UPDATED, { track, updates });
    return true;
}

/**
 * Select a track
 */
export function selectTrack(trackId) {
    state.ui.selectedTrackId = trackId;
    emit(Events.TRACK_SELECTED, trackId);
}

/**
 * Update transport settings for the active song
 */
export function updateTransport(updates) {
    const song = getActiveSong();
    if (!song) return false;
    
    Object.assign(song.transport, updates);
    emit(Events.TRANSPORT_UPDATED, { song, updates });
    return true;
}

/**
 * Set playback state
 */
export function setPlaybackState(newState) {
    const oldState = state.playbackState;
    state.playbackState = newState;
    emit(Events.PLAYBACK_STATE_CHANGED, { oldState, newState });
}

/**
 * Update playhead position
 */
export function setPosition(position) {
    const song = getActiveSong();
    if (!song) return;
    
    song.transport.position = position;
    emit(Events.POSITION_CHANGED, position);
}

/**
 * Update timeline settings for the active song
 */
export function updateTimeline(updates) {
    const song = getActiveSong();
    if (!song) return false;
    
    Object.assign(song.timeline, updates);
    emit(Events.TIMELINE_UPDATED, { song, updates });
    
    if ('zoom' in updates) {
        emit(Events.ZOOM_CHANGED, updates.zoom);
    }
    
    return true;
}

/**
 * Set loading state
 */
export function setLoading(isLoading, message = 'Loading...') {
    state.ui.isLoading = isLoading;
    state.ui.loadingMessage = message;
    emit(Events.LOADING_STATE_CHANGED, { isLoading, message });
}

/**
 * Check if a track is audible based on solo/mute state
 */
export function isTrackAudible(trackId) {
    const song = getActiveSong();
    if (!song) return false;
    
    const track = song.tracks.find(t => t.id === trackId);
    if (!track) return false;
    
    const anySoloed = song.tracks.some(t => t.solo);
    
    if (anySoloed) {
        // If any track is soloed, only soloed tracks are audible
        return track.solo;
    }
    
    // No solos: respect mute state
    return !track.mute;
}

/**
 * Get the maximum duration of all tracks in the active song
 */
export function getMaxDuration() {
    const song = getActiveSong();
    if (!song || song.tracks.length === 0) return 0;
    
    return Math.max(...song.tracks.map(t => t.duration));
}

/**
 * Load state from storage
 */
export function loadState(savedState) {
    Object.assign(state, savedState);
    emit(Events.STATE_LOADED, state);
}

/**
 * Get serializable state (for storage)
 */
export function getSerializableState() {
    return {
        songs: state.songs,
        activeSongId: state.activeSongId
    };
}

/**
 * Reset state to initial
 */
export function resetState() {
    Object.assign(state, initialState);
    state.songs = [];
    state.activeSongId = null;
}

/**
 * Update loop settings for the active song
 * @param {Object} updates - { enabled?, start?, end? }
 */
export function updateLoop(updates) {
    const song = getActiveSong();
    if (!song) return false;
    
    if ('enabled' in updates) {
        song.transport.loopEnabled = updates.enabled;
    }
    if ('start' in updates) {
        song.transport.loopStart = updates.start;
    }
    if ('end' in updates) {
        song.transport.loopEnd = updates.end;
    }
    
    emit(Events.LOOP_UPDATED, {
        enabled: song.transport.loopEnabled,
        start: song.transport.loopStart,
        end: song.transport.loopEnd
    });
    
    return true;
}

/**
 * Get loop state for the active song
 */
export function getLoopState() {
    const song = getActiveSong();
    if (!song) return { enabled: false, start: null, end: null };
    
    return {
        enabled: song.transport.loopEnabled,
        start: song.transport.loopStart,
        end: song.transport.loopEnd
    };
}

/**
 * Clear loop points for the active song
 */
export function clearLoop() {
    return updateLoop({ enabled: false, start: null, end: null });
}

/**
 * Toggle loop enabled state
 */
export function toggleLoop() {
    const song = getActiveSong();
    if (!song) return false;
    
    return updateLoop({ enabled: !song.transport.loopEnabled });
}

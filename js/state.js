/**
 * State Management
 * Central state store with event-based updates
 */

import { deriveSections, deriveVirtualSections, getVirtualDuration } from './sections.js';

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
        sections: [], // Derived from markers - array of {index, name, start, end, duration}
        // Arrangement support
        arrangement: {
            name: 'Default', // Selected arrangement name ('Default' = all sections in order)
            customId: null   // If set, this is a custom arrangement ID from state.customArrangements
        },
        virtualSections: [], // Derived from arrangement - maps virtual timeline to source sections
        virtualDuration: 0,  // Total duration of virtual timeline
        // Note: Section mutes are stored at top-level state.sectionMutes keyed by songName
        // Note: Custom arrangements are stored at top-level state.customArrangements keyed by songName
        transport: {
            position: 0,
            lastPlayPosition: 0,
            speed: 1.0,
            pitch: 0,
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
    // Section mutes stored by songName (persists across song close/reopen)
    // Structure: { "songName": { "trackFileName": { sectionIndex: true } } }
    sectionMutes: {},
    // Custom arrangements stored by songName (persists across song close/reopen)
    // Structure: { "songName": [ { id, name, sections: [sectionIndices] }, ... ] }
    customArrangements: {},
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
    SONG_SWITCHED: 'songSwitched',
    SONG_METADATA_UPDATED: 'songMetadataUpdated',
    SECTIONS_UPDATED: 'sectionsUpdated',
    
    // Track events
    TRACK_ADDED: 'trackAdded',
    TRACK_REMOVED: 'trackRemoved',
    TRACK_UPDATED: 'trackUpdated',
    TRACK_SELECTED: 'trackSelected',
    TRACKS_REORDERED: 'tracksReordered',
    SECTION_MUTE_UPDATED: 'sectionMuteUpdated',
    
    // Arrangement events
    ARRANGEMENT_CHANGED: 'arrangementChanged',
    CUSTOM_ARRANGEMENTS_UPDATED: 'customArrangementsUpdated',
    
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
    
    // Re-derive sections now that we have metadata
    updateSongSections(songId);
    
    return true;
}

/**
 * Update derived sections for a song
 * Call this when metadata or track durations change
 * @param {string} songId - Song ID
 */
export function updateSongSections(songId) {
    const song = getSong(songId);
    if (!song) return false;
    
    const markers = song.metadata?.markers;
    if (!markers || markers.length === 0) {
        song.sections = [];
        return true;
    }
    
    // Get max duration from tracks
    const maxDuration = song.tracks.length > 0 
        ? Math.max(...song.tracks.map(t => t.duration || 0))
        : 0;
    
    // If we don't have duration yet, we can't properly derive sections
    // (the last section wouldn't have a valid end time)
    if (maxDuration <= 0) {
        song.sections = [];
        return true;
    }
    
    song.sections = deriveSections(markers, maxDuration);
    
    // Also update virtual sections based on current arrangement
    updateVirtualSections(songId);
    
    // Emit event so UI can update (e.g., waveform section dividers)
    emit(Events.SECTIONS_UPDATED, { song, sections: song.sections });
    
    return true;
}

/**
 * Update virtual sections for a song based on current arrangement
 * Call this when sections change or arrangement changes
 * @param {string} songId - Song ID
 */
export function updateVirtualSections(songId) {
    const song = getSong(songId);
    if (!song) return false;
    
    // Get arrangement definition
    const arrangementName = song.arrangement?.name || 'Default';
    const customId = song.arrangement?.customId || null;
    const arrangementDef = getArrangementDefinition(song, arrangementName, customId);
    
    // Derive virtual sections
    song.virtualSections = deriveVirtualSections(song.sections, arrangementDef);
    song.virtualDuration = getVirtualDuration(song.virtualSections);
    
    return true;
}

/**
 * Get arrangement definition (section indices array) for a given arrangement name
 * @param {Object} song - Song object
 * @param {string} arrangementName - Arrangement name
 * @param {string|null} customId - Custom arrangement ID (if custom)
 * @returns {Array<number>|null} Array of section indices, or null for default
 */
function getArrangementDefinition(song, arrangementName, customId = null) {
    if (arrangementName === 'Default' || !arrangementName) {
        return null; // Default = all sections in order
    }
    
    // Check for custom arrangement first
    if (customId) {
        const customArr = getCustomArrangementById(song.songName, customId);
        return customArr?.sections || null;
    }
    
    const arrangements = song.metadata?.arrangements;
    if (!arrangements) return null;
    
    const arrangement = arrangements.find(a => a.name === arrangementName);
    return arrangement?.sections || null;
}

/**
 * Get available arrangements for a song
 * @param {string} songId - Song ID
 * @returns {Array<string>} Array of arrangement names (always includes 'Default')
 */
export function getAvailableArrangements(songId) {
    const song = getSong(songId);
    if (!song) return ['Default'];
    
    const arrangements = song.metadata?.arrangements || [];
    const names = arrangements.map(a => a.name).filter(Boolean);
    
    // Always include Default first
    return ['Default', ...names];
}

/**
 * Set the active arrangement for a song
 * @param {string} songId - Song ID
 * @param {string} arrangementName - Arrangement name
 * @param {string|null} customId - Custom arrangement ID (null for metadata arrangements)
 * @returns {boolean} Success
 */
export function setArrangement(songId, arrangementName, customId = null) {
    const song = getSong(songId);
    if (!song) return false;
    
    const previousName = song.arrangement?.name || 'Default';
    const previousCustomId = song.arrangement?.customId || null;
    
    // Validate arrangement exists (unless it's a custom one we're setting)
    if (!customId) {
        const available = getAvailableArrangements(songId);
        if (!available.includes(arrangementName)) {
            console.warn(`Arrangement "${arrangementName}" not found, using Default`);
            arrangementName = 'Default';
        }
    }
    
    // Update arrangement
    if (!song.arrangement) {
        song.arrangement = {};
    }
    song.arrangement.name = arrangementName;
    song.arrangement.customId = customId;
    
    // Recalculate virtual sections
    updateVirtualSections(songId);
    
    // Clear loop points when arrangement changes (they're in virtual time)
    if (previousName !== arrangementName || previousCustomId !== customId) {
        song.transport.loopStart = null;
        song.transport.loopEnd = null;
        song.transport.loopEnabled = false;
    }
    
    // Emit event
    emit(Events.ARRANGEMENT_CHANGED, { 
        song, 
        arrangementName,
        customId,
        virtualSections: song.virtualSections,
        virtualDuration: song.virtualDuration
    });
    
    return true;
}

/**
 * Get the current arrangement name for a song
 * @param {string} songId - Song ID
 * @returns {string} Arrangement name
 */
export function getCurrentArrangement(songId) {
    const song = getSong(songId);
    return song?.arrangement?.name || 'Default';
}

// ============================================================================
// Custom Arrangements
// ============================================================================

/**
 * Get all custom arrangements for a song
 * @param {string} songName - Song name (from manifest)
 * @returns {Array} Array of custom arrangement objects
 */
export function getCustomArrangements(songName) {
    return state.customArrangements?.[songName] || [];
}

/**
 * Get a custom arrangement by ID
 * @param {string} songName - Song name
 * @param {string} customId - Custom arrangement ID
 * @returns {Object|null} Custom arrangement object or null
 */
export function getCustomArrangementById(songName, customId) {
    const arrangements = getCustomArrangements(songName);
    return arrangements.find(a => a.id === customId) || null;
}

/**
 * Add a new custom arrangement for a song
 * @param {string} songName - Song name
 * @param {string} name - Arrangement name
 * @param {Array<number>} sections - Array of section indices
 * @returns {string} The new arrangement's ID
 */
export function addCustomArrangement(songName, name, sections) {
    if (!state.customArrangements) {
        state.customArrangements = {};
    }
    if (!state.customArrangements[songName]) {
        state.customArrangements[songName] = [];
    }
    
    const id = generateId();
    const arrangement = { id, name, sections: [...sections] };
    state.customArrangements[songName].push(arrangement);
    
    emit(Events.CUSTOM_ARRANGEMENTS_UPDATED, { songName, arrangements: state.customArrangements[songName] });
    
    return id;
}

/**
 * Update an existing custom arrangement
 * @param {string} songName - Song name
 * @param {string} customId - Custom arrangement ID
 * @param {string} name - New name
 * @param {Array<number>} sections - New sections array
 * @returns {boolean} Success
 */
export function updateCustomArrangement(songName, customId, name, sections) {
    const arrangements = state.customArrangements?.[songName];
    if (!arrangements) return false;
    
    const arrangement = arrangements.find(a => a.id === customId);
    if (!arrangement) return false;
    
    arrangement.name = name;
    arrangement.sections = [...sections];
    
    emit(Events.CUSTOM_ARRANGEMENTS_UPDATED, { songName, arrangements });
    
    // If this arrangement is currently active, update virtual sections
    const song = state.songs.find(s => s.songName === songName);
    if (song && song.arrangement?.customId === customId) {
        updateVirtualSections(song.id);
        emit(Events.ARRANGEMENT_CHANGED, {
            song,
            arrangementName: name,
            customId,
            virtualSections: song.virtualSections,
            virtualDuration: song.virtualDuration
        });
    }
    
    return true;
}

/**
 * Delete a custom arrangement
 * @param {string} songName - Song name
 * @param {string} customId - Custom arrangement ID
 * @returns {boolean} Success
 */
export function deleteCustomArrangement(songName, customId) {
    const arrangements = state.customArrangements?.[songName];
    if (!arrangements) return false;
    
    const index = arrangements.findIndex(a => a.id === customId);
    if (index === -1) return false;
    
    arrangements.splice(index, 1);
    
    // Clean up empty arrays
    if (arrangements.length === 0) {
        delete state.customArrangements[songName];
    }
    
    emit(Events.CUSTOM_ARRANGEMENTS_UPDATED, { songName, arrangements: state.customArrangements[songName] || [] });
    
    // If this arrangement was active, switch to Default
    const song = state.songs.find(s => s.songName === songName);
    if (song && song.arrangement?.customId === customId) {
        setArrangement(song.id, 'Default', null);
    }
    
    return true;
}

/**
 * Check if a custom arrangement is currently active
 * @param {string} songId - Song ID
 * @returns {boolean} True if a custom arrangement is active
 */
export function isCustomArrangementActive(songId) {
    const song = getSong(songId);
    return !!song?.arrangement?.customId;
}

/**
 * Get the currently active custom arrangement object
 * @param {string} songId - Song ID
 * @returns {Object|null} Custom arrangement object or null
 */
export function getActiveCustomArrangement(songId) {
    const song = getSong(songId);
    if (!song?.arrangement?.customId) return null;
    
    return getCustomArrangementById(song.songName, song.arrangement.customId);
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
 * Reorder a track within the active song
 * Note: Does NOT persist to storage - order resets when song is closed/reopened
 * @param {string} trackId - Track ID to move
 * @param {number} newIndex - New index position
 */
export function reorderTrack(trackId, newIndex) {
    const song = getActiveSong();
    if (!song) return false;
    
    const currentIndex = song.tracks.findIndex(t => t.id === trackId);
    if (currentIndex === -1) return false;
    
    // Clamp newIndex to valid range
    newIndex = Math.max(0, Math.min(newIndex, song.tracks.length - 1));
    
    // No change needed
    if (currentIndex === newIndex) return false;
    
    // Remove from current position and insert at new position
    const [track] = song.tracks.splice(currentIndex, 1);
    song.tracks.splice(newIndex, 0, track);
    
    // Emit event but do NOT save state - order is temporary
    emit(Events.TRACKS_REORDERED, { song, trackId, fromIndex: currentIndex, toIndex: newIndex });
    
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
 * Returns virtual duration if an arrangement is active with virtual sections
 */
export function getMaxDuration() {
    const song = getActiveSong();
    if (!song || song.tracks.length === 0) return 0;
    
    // If we have virtual sections, use virtual duration
    if (song.virtualSections && song.virtualSections.length > 0) {
        return song.virtualDuration;
    }
    
    return Math.max(...song.tracks.map(t => t.duration));
}

/**
 * Get the raw source duration (ignoring arrangements)
 * Use this when you need the actual audio file duration
 */
export function getSourceDuration() {
    const song = getActiveSong();
    if (!song || song.tracks.length === 0) return 0;
    
    return Math.max(...song.tracks.map(t => t.duration));
}

/**
 * Load state from storage
 * Includes migration for arrangement property added in Phase 3
 */
export function loadState(savedState) {
    // Migrate songs to include arrangement property if missing
    if (savedState.songs) {
        savedState.songs.forEach(song => {
            // Add arrangement property if missing (for backward compatibility)
            if (!song.arrangement) {
                song.arrangement = { name: 'Default', customId: null };
            }
            // Ensure customId exists (migration for older states)
            if (song.arrangement && song.arrangement.customId === undefined) {
                song.arrangement.customId = null;
            }
            // Initialize derived properties (will be recalculated when metadata loads)
            song.virtualSections = song.virtualSections || [];
            song.virtualDuration = song.virtualDuration || 0;
        });
    }
    
    // Ensure customArrangements exists
    if (!savedState.customArrangements) {
        savedState.customArrangements = {};
    }
    
    Object.assign(state, savedState);
    emit(Events.STATE_LOADED, state);
}

/**
 * Get serializable state (for storage)
 * Note: virtualSections and virtualDuration are derived and will be recalculated on load
 */
export function getSerializableState() {
    // Create a copy of songs without derived properties
    const serializableSongs = state.songs.map(song => {
        const { virtualSections, virtualDuration, ...rest } = song;
        return rest;
    });
    
    return {
        songs: serializableSongs,
        activeSongId: state.activeSongId,
        sectionMutes: state.sectionMutes,
        customArrangements: state.customArrangements
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

/**
 * Get track filename from track's filePath
 * @param {Object} track - Track object
 * @returns {string} Track filename (e.g., "Click Track.mp3")
 */
function getTrackFileName(track) {
    if (!track || !track.filePath) return null;
    const parts = track.filePath.split('/');
    return decodeURIComponent(parts[parts.length - 1]);
}

/**
 * Toggle section mute for a track
 * Stores mutes at top-level state.sectionMutes keyed by songName and track filename
 * This ensures mutes persist across song close/reopen cycles
 * @param {string} trackId - Track ID
 * @param {number} sectionIndex - Section index (from original marker order)
 * @returns {boolean} New mute state
 */
export function toggleSectionMute(trackId, sectionIndex) {
    const song = getActiveSong();
    const track = getTrack(trackId);
    if (!song || !track) return false;
    
    const songName = song.songName;
    const trackFileName = getTrackFileName(track);
    if (!songName || !trackFileName) return false;
    
    // Initialize sectionMutes structure if needed
    if (!state.sectionMutes) {
        state.sectionMutes = {};
    }
    if (!state.sectionMutes[songName]) {
        state.sectionMutes[songName] = {};
    }
    if (!state.sectionMutes[songName][trackFileName]) {
        state.sectionMutes[songName][trackFileName] = {};
    }
    
    // Toggle the mute state
    const currentMutes = state.sectionMutes[songName][trackFileName];
    const newMuteState = !currentMutes[sectionIndex];
    
    if (newMuteState) {
        currentMutes[sectionIndex] = true;
    } else {
        delete currentMutes[sectionIndex];
    }
    
    // Clean up empty objects
    if (Object.keys(currentMutes).length === 0) {
        delete state.sectionMutes[songName][trackFileName];
    }
    if (Object.keys(state.sectionMutes[songName]).length === 0) {
        delete state.sectionMutes[songName];
    }
    
    emit(Events.SECTION_MUTE_UPDATED, { trackId, sectionIndex, muted: newMuteState });
    
    return newMuteState;
}

/**
 * Check if a section is muted for a track
 * @param {string} trackId - Track ID
 * @param {number} sectionIndex - Section index
 * @returns {boolean} True if muted
 */
export function isSectionMuted(trackId, sectionIndex) {
    const song = getActiveSong();
    const track = getTrack(trackId);
    if (!song || !track) return false;
    
    const songName = song.songName;
    const trackFileName = getTrackFileName(track);
    if (!songName || !trackFileName) return false;
    
    const trackMutes = state.sectionMutes?.[songName]?.[trackFileName];
    return !!trackMutes?.[sectionIndex];
}

/**
 * Get all section mutes for a track
 * @param {string} trackId - Track ID
 * @returns {Object} Section mutes object { sectionIndex: true }
 */
export function getSectionMutesForTrack(trackId) {
    const song = getActiveSong();
    const track = getTrack(trackId);
    if (!song || !track) return {};
    
    const songName = song.songName;
    const trackFileName = getTrackFileName(track);
    if (!songName || !trackFileName) return {};
    
    return state.sectionMutes?.[songName]?.[trackFileName] || {};
}

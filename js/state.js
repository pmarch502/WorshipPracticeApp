/**
 * State Management
 * Central state store with event-based updates
 */

// Note: deriveSections kept for Phase 3 (custom arrangements from S3)
import { deriveSections, deriveVirtualSections, getVirtualDuration } from './sections.js';
import { calculateAllBeatPositions } from './metadata.js';

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
        // Arrangement support (legacy index-based)
        arrangement: {
            name: 'Default', // Selected arrangement name ('Default' = all sections in order)
            customId: null   // If set, this is a custom arrangement ID from state.customArrangements
        },
        virtualSections: [], // Derived from arrangement - maps virtual timeline to source sections
        virtualDuration: 0,  // Total duration of virtual timeline
        // Phase 3: Timeline-based arrangement sections
        // Array of { start, end, enabled } where start/end are in seconds
        arrangementSections: [],
        arrangementModified: false,    // True if user has made unsaved changes
        currentArrangementId: null,    // null = "Original" arrangement
        currentArrangementName: null,  // Display name (null = "Original")
        // Note: Section mutes are stored at top-level state.sectionMutes keyed by songName
        // Note: Custom arrangements are stored at top-level state.customArrangements keyed by songName
        // Phase 4: Waveform-based mute sections (per-track time-based muting)
        // Structure: { trackId: [{ start, end, muted }, ...] }
        muteSections: {},
        muteSetModified: false,      // True if user has made unsaved changes to mute sections
        currentMuteSetId: null,      // null = "None" (no mute set loaded)
        currentMuteSetName: null,    // Display name (null = "None")
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
    ARRANGEMENT_SECTIONS_CHANGED: 'arrangementSectionsChanged',
    
    // Mute set events (Phase 4)
    MUTE_SECTIONS_CHANGED: 'muteSectionsChanged',
    
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
 * 
 * Phase 2 change: Default to "full song" single section instead of deriving from markers.
 * Markers are now visual-only and don't create section boundaries.
 * Section splits will come from user-defined arrangements in Phase 3.
 * 
 * @param {string} songId - Song ID
 */
export function updateSongSections(songId) {
    const song = getSong(songId);
    if (!song) return false;
    
    // Get max duration from tracks
    const maxDuration = song.tracks.length > 0 
        ? Math.max(...song.tracks.map(t => t.duration || 0))
        : 0;
    
    // If we don't have duration yet, we can't create sections
    if (maxDuration <= 0) {
        song.sections = [];
        return true;
    }
    
    // Phase 2: Default to single "full song" section
    // Markers are now visual-only and don't define section boundaries
    // Custom arrangements (Phase 3) will define their own splits
    song.sections = [{
        index: 0,
        name: 'Full Song',
        unlabeled: false,
        start: 0,
        end: maxDuration,
        duration: maxDuration
    }];
    
    // Phase 3: Initialize arrangement sections if empty
    // This ensures the arrangement bar has something to render
    if (!song.arrangementSections || song.arrangementSections.length === 0) {
        song.arrangementSections = [{
            start: 0,
            end: maxDuration,
            enabled: true
        }];
        song.arrangementModified = false;
        song.currentArrangementId = null;
        song.currentArrangementName = null;
        
        emit(Events.ARRANGEMENT_SECTIONS_CHANGED, {
            song,
            sections: song.arrangementSections,
            modified: false
        });
    }
    
    // Phase 4: Initialize mute sections for any tracks that don't have them
    // Each track gets a single full-duration unmuted section by default
    if (!song.muteSections) {
        song.muteSections = {};
    }
    
    let muteSectionsInitialized = false;
    song.tracks.forEach(track => {
        if (!song.muteSections[track.id] && track.duration > 0) {
            song.muteSections[track.id] = [{
                start: 0,
                end: track.duration,
                muted: false
            }];
            muteSectionsInitialized = true;
        }
    });
    
    if (muteSectionsInitialized) {
        emit(Events.MUTE_SECTIONS_CHANGED, {
            song,
            trackId: null,
            sections: null,
            modified: false
        });
    }
    
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
    
    // Pre-calculate all beat positions for the virtual timeline
    // This uses multiplication from tempo change points to avoid floating-point drift
    song.beatPositions = calculateAllBeatPositions(
        song.virtualDuration,
        song.virtualSections,
        song.metadata?.tempos,
        song.metadata?.['time-sigs']
    );
    
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

// ============================================================================
// Phase 3: Timeline-Based Arrangement Sections
// ============================================================================

/**
 * Get arrangement sections for the active song
 * @returns {Array} Array of { start, end, enabled } objects
 */
export function getArrangementSections() {
    const song = getActiveSong();
    return song?.arrangementSections || [];
}

/**
 * Set arrangement sections for the active song
 * @param {Array} sections - Array of { start, end, enabled } objects
 * @param {boolean} markModified - Whether to mark arrangement as modified (default true)
 */
export function setArrangementSections(sections, markModified = true) {
    const song = getActiveSong();
    if (!song) return false;
    
    song.arrangementSections = sections;
    if (markModified) {
        song.arrangementModified = true;
    }
    
    emit(Events.ARRANGEMENT_SECTIONS_CHANGED, {
        song,
        sections,
        modified: song.arrangementModified
    });
    
    return true;
}

/**
 * Initialize the "Original" arrangement for a song
 * Creates a single full-song section with all enabled
 * Call this when a song loads and we know the duration
 * @param {string} songId - Song ID (optional, defaults to active song)
 */
export function initializeOriginalArrangement(songId = null) {
    const song = songId ? getSong(songId) : getActiveSong();
    if (!song) return false;
    
    // Get duration from tracks
    const maxDuration = song.tracks.length > 0
        ? Math.max(...song.tracks.map(t => t.duration || 0))
        : 0;
    
    if (maxDuration <= 0) {
        song.arrangementSections = [];
        return true;
    }
    
    // Create single "full song" section
    song.arrangementSections = [{
        start: 0,
        end: maxDuration,
        enabled: true
    }];
    
    // Reset to original state
    song.arrangementModified = false;
    song.currentArrangementId = null;
    song.currentArrangementName = null;
    
    emit(Events.ARRANGEMENT_SECTIONS_CHANGED, {
        song,
        sections: song.arrangementSections,
        modified: false
    });
    
    return true;
}

/**
 * Check if the arrangement has unsaved changes
 * @returns {boolean} True if arrangement has been modified
 */
export function isArrangementModified() {
    const song = getActiveSong();
    return song?.arrangementModified || false;
}

/**
 * Set the arrangement modified flag
 * @param {boolean} modified - Modified state
 */
export function setArrangementModified(modified) {
    const song = getActiveSong();
    if (!song) return false;
    
    song.arrangementModified = modified;
    
    emit(Events.ARRANGEMENT_SECTIONS_CHANGED, {
        song,
        sections: song.arrangementSections,
        modified
    });
    
    return true;
}

/**
 * Get the current arrangement name
 * @returns {string} Arrangement name or "Original"
 */
export function getCurrentArrangementDisplayName() {
    const song = getActiveSong();
    return song?.currentArrangementName || 'Original';
}

/**
 * Add a split to the arrangement at a specific time
 * Splits the section containing that time into two sections
 * @param {number} splitTime - Time in seconds where to add the split
 * @returns {boolean} Success
 */
export function addArrangementSplit(splitTime) {
    const song = getActiveSong();
    if (!song || !song.arrangementSections || song.arrangementSections.length === 0) {
        return false;
    }
    
    // Find the section that contains this time
    const sections = [...song.arrangementSections];
    let sectionIndex = -1;
    
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (splitTime > section.start && splitTime < section.end) {
            sectionIndex = i;
            break;
        }
    }
    
    if (sectionIndex === -1) {
        // Split time is at a boundary or outside sections
        return false;
    }
    
    const section = sections[sectionIndex];
    
    // Create two new sections from the split
    const firstSection = {
        start: section.start,
        end: splitTime,
        enabled: section.enabled
    };
    
    const secondSection = {
        start: splitTime,
        end: section.end,
        enabled: section.enabled
    };
    
    // Replace the original section with the two new ones
    sections.splice(sectionIndex, 1, firstSection, secondSection);
    
    return setArrangementSections(sections, true);
}

/**
 * Remove a split from the arrangement (merge two sections)
 * @param {number} splitTime - Time of the split to remove
 * @returns {boolean} Success
 */
export function removeArrangementSplit(splitTime) {
    const song = getActiveSong();
    if (!song || !song.arrangementSections || song.arrangementSections.length <= 1) {
        return false;
    }
    
    const sections = [...song.arrangementSections];
    
    // Find the section that starts at this time (the split boundary)
    const splitIndex = sections.findIndex(s => Math.abs(s.start - splitTime) < 0.001);
    
    if (splitIndex <= 0) {
        // Can't remove the first boundary (time 0) or not found
        return false;
    }
    
    // Merge with previous section
    const prevSection = sections[splitIndex - 1];
    const currSection = sections[splitIndex];
    
    const mergedSection = {
        start: prevSection.start,
        end: currSection.end,
        enabled: prevSection.enabled // Keep the state of the first section
    };
    
    // Replace both sections with merged one
    sections.splice(splitIndex - 1, 2, mergedSection);
    
    return setArrangementSections(sections, true);
}

/**
 * Toggle a section's enabled state
 * @param {number} sectionIndex - Index of section to toggle
 * @returns {boolean} New enabled state, or null on failure
 */
export function toggleArrangementSection(sectionIndex) {
    const song = getActiveSong();
    if (!song || !song.arrangementSections || sectionIndex >= song.arrangementSections.length) {
        return null;
    }
    
    const sections = [...song.arrangementSections];
    sections[sectionIndex] = {
        ...sections[sectionIndex],
        enabled: !sections[sectionIndex].enabled
    };
    
    setArrangementSections(sections, true);
    return sections[sectionIndex].enabled;
}

/**
 * Get the section boundaries (split times) for rendering dividers
 * Excludes start (0) and end (duration) boundaries
 * @returns {Array<number>} Array of split times in seconds
 */
export function getArrangementSplitTimes() {
    const song = getActiveSong();
    if (!song || !song.arrangementSections || song.arrangementSections.length <= 1) {
        return [];
    }
    
    // Return the start time of each section except the first
    return song.arrangementSections.slice(1).map(s => s.start);
}

/**
 * Get the arrangement section at a given time
 * @param {number} time - Time in seconds
 * @returns {Object|null} Section object { start, end, enabled, index } or null
 */
export function getArrangementSectionAtTime(time) {
    const song = getActiveSong();
    if (!song || !song.arrangementSections) return null;
    
    for (let i = 0; i < song.arrangementSections.length; i++) {
        const section = song.arrangementSections[i];
        if (time >= section.start && time < section.end) {
            return { ...section, index: i };
        }
    }
    
    // Edge case: exactly at end of last section
    const lastIndex = song.arrangementSections.length - 1;
    const lastSection = song.arrangementSections[lastIndex];
    if (lastSection && time >= lastSection.start && time <= lastSection.end) {
        return { ...lastSection, index: lastIndex };
    }
    
    return null;
}

/**
 * Get the next enabled arrangement section after a given time
 * @param {number} time - Current time in seconds
 * @returns {Object|null} Next enabled section { start, end, enabled, index } or null if none
 */
export function getNextEnabledArrangementSection(time) {
    const song = getActiveSong();
    if (!song || !song.arrangementSections) return null;
    
    // Find sections that start after the given time and are enabled
    for (let i = 0; i < song.arrangementSections.length; i++) {
        const section = song.arrangementSections[i];
        if (section.start > time && section.enabled) {
            return { ...section, index: i };
        }
    }
    
    return null;
}

/**
 * Get the first enabled arrangement section at or after a given time
 * Used for finding where to start/resume playback
 * @param {number} time - Current time in seconds  
 * @returns {Object|null} Enabled section { start, end, enabled, index } or null if none
 */
export function getEnabledArrangementSectionAtOrAfter(time) {
    const song = getActiveSong();
    if (!song || !song.arrangementSections) return null;
    
    for (let i = 0; i < song.arrangementSections.length; i++) {
        const section = song.arrangementSections[i];
        // Section contains the time or starts after it
        if (section.end > time && section.enabled) {
            return { ...section, index: i };
        }
    }
    
    return null;
}

/**
 * Check if arrangement sections feature is active (has custom splits)
 * @returns {boolean} True if there are multiple arrangement sections
 */
export function hasArrangementSections() {
    const song = getActiveSong();
    return song?.arrangementSections && song.arrangementSections.length > 1;
}

/**
 * Check if any arrangement section is disabled
 * @returns {boolean} True if at least one section is disabled
 */
export function hasDisabledArrangementSections() {
    const song = getActiveSong();
    if (!song?.arrangementSections) return false;
    return song.arrangementSections.some(s => !s.enabled);
}

// ============================================================================
// Phase 4: Waveform-Based Mute Sections
// ============================================================================

/**
 * Get mute sections for a specific track
 * @param {string} trackId - Track ID
 * @returns {Array} Array of { start, end, muted } objects
 */
export function getMuteSectionsForTrack(trackId) {
    const song = getActiveSong();
    if (!song || !song.muteSections) return [];
    return song.muteSections[trackId] || [];
}

/**
 * Set mute sections for a specific track
 * @param {string} trackId - Track ID
 * @param {Array} sections - Array of { start, end, muted } objects
 * @param {boolean} markModified - Whether to mark mute set as modified (default true)
 */
export function setMuteSectionsForTrack(trackId, sections, markModified = true) {
    const song = getActiveSong();
    if (!song) return false;
    
    if (!song.muteSections) {
        song.muteSections = {};
    }
    
    song.muteSections[trackId] = sections;
    if (markModified) {
        song.muteSetModified = true;
    }
    
    emit(Events.MUTE_SECTIONS_CHANGED, {
        song,
        trackId,
        sections,
        modified: song.muteSetModified
    });
    
    return true;
}

/**
 * Check if the mute set has unsaved changes
 * @returns {boolean} True if mute set has been modified
 */
export function isMuteSetModified() {
    const song = getActiveSong();
    return song?.muteSetModified || false;
}

/**
 * Set the mute set modified flag
 * @param {boolean} modified - Modified state
 */
export function setMuteSetModified(modified) {
    const song = getActiveSong();
    if (!song) return false;
    
    song.muteSetModified = modified;
    
    emit(Events.MUTE_SECTIONS_CHANGED, {
        song,
        trackId: null,
        sections: null,
        modified
    });
    
    return true;
}

/**
 * Get the current mute set display name
 * @returns {string} Mute set name or "None"
 */
export function getCurrentMuteSetDisplayName() {
    const song = getActiveSong();
    return song?.currentMuteSetName || 'None';
}

/**
 * Initialize mute sections for a single track with full duration, unmuted
 * @param {string} trackId - Track ID
 * @param {number} duration - Track duration in seconds
 * @param {boolean} markModified - Whether to mark as modified (default false for initialization)
 */
export function initializeMuteSectionsForTrack(trackId, duration, markModified = false) {
    if (!trackId || duration <= 0) return false;
    
    const sections = [{
        start: 0,
        end: duration,
        muted: false
    }];
    
    return setMuteSectionsForTrack(trackId, sections, markModified);
}

/**
 * Initialize mute sections for all tracks in the active song
 * Only initializes tracks that don't already have mute sections
 * @param {string} songId - Song ID (optional, defaults to active song)
 */
export function initializeAllMuteSections(songId = null) {
    const song = songId ? getSong(songId) : getActiveSong();
    if (!song) return false;
    
    if (!song.muteSections) {
        song.muteSections = {};
    }
    
    let initialized = false;
    
    song.tracks.forEach(track => {
        // Only initialize if track doesn't have mute sections and has a duration
        if (!song.muteSections[track.id] && track.duration > 0) {
            song.muteSections[track.id] = [{
                start: 0,
                end: track.duration,
                muted: false
            }];
            initialized = true;
        }
    });
    
    if (initialized) {
        emit(Events.MUTE_SECTIONS_CHANGED, {
            song,
            trackId: null, // null indicates multiple tracks changed
            sections: null,
            modified: false
        });
    }
    
    return true;
}

/**
 * Reset all mute sections to default unmuted state for all tracks
 * Unlike initializeAllMuteSections, this FORCES reset even if sections exist
 * @param {string} songId - Song ID (optional, defaults to active song)
 */
export function resetAllMuteSections(songId = null) {
    const song = songId ? getSong(songId) : getActiveSong();
    if (!song) return false;
    
    song.muteSections = {};
    
    song.tracks.forEach(track => {
        if (track.duration > 0) {
            song.muteSections[track.id] = [{
                start: 0,
                end: track.duration,
                muted: false
            }];
        }
    });
    
    emit(Events.MUTE_SECTIONS_CHANGED, {
        song,
        trackId: null,
        sections: null,
        modified: false
    });
    
    return true;
}

/**
 * Add a split to a track's mute sections at a specific time
 * @param {string} trackId - Track ID
 * @param {number} splitTime - Time in seconds where to add the split
 * @returns {boolean} Success
 */
export function addMuteSplit(trackId, splitTime) {
    const song = getActiveSong();
    if (!song || !trackId) return false;
    
    const sections = getMuteSectionsForTrack(trackId);
    if (sections.length === 0) return false;
    
    // Find the section that contains this time
    let sectionIndex = -1;
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (splitTime > section.start && splitTime < section.end) {
            sectionIndex = i;
            break;
        }
    }
    
    if (sectionIndex === -1) {
        // Split time is at a boundary or outside sections
        return false;
    }
    
    const section = sections[sectionIndex];
    const newSections = [...sections];
    
    // Create two new sections from the split
    const firstSection = {
        start: section.start,
        end: splitTime,
        muted: section.muted
    };
    
    const secondSection = {
        start: splitTime,
        end: section.end,
        muted: section.muted
    };
    
    // Replace the original section with the two new ones
    newSections.splice(sectionIndex, 1, firstSection, secondSection);
    
    return setMuteSectionsForTrack(trackId, newSections, true);
}

/**
 * Remove a split from a track's mute sections (merge two sections)
 * @param {string} trackId - Track ID
 * @param {number} splitTime - Time of the split to remove
 * @returns {boolean} Success
 */
export function removeMuteSplit(trackId, splitTime) {
    const song = getActiveSong();
    if (!song || !trackId) return false;
    
    const sections = getMuteSectionsForTrack(trackId);
    if (sections.length <= 1) return false;
    
    // Find the section that starts at this time (the split boundary)
    const splitIndex = sections.findIndex(s => Math.abs(s.start - splitTime) < 0.001);
    
    if (splitIndex <= 0) {
        // Can't remove the first boundary (time 0) or not found
        return false;
    }
    
    const newSections = [...sections];
    
    // Merge with previous section
    const prevSection = newSections[splitIndex - 1];
    const currSection = newSections[splitIndex];
    
    const mergedSection = {
        start: prevSection.start,
        end: currSection.end,
        muted: prevSection.muted // Keep the mute state of the first section
    };
    
    // Replace both sections with merged one
    newSections.splice(splitIndex - 1, 2, mergedSection);
    
    return setMuteSectionsForTrack(trackId, newSections, true);
}

/**
 * Move a split in a track's mute sections from one time to another
 * @param {string} trackId - Track ID
 * @param {number} oldTime - Current split time
 * @param {number} newTime - New split time
 * @returns {boolean} Success
 */
export function moveMuteSplit(trackId, oldTime, newTime) {
    const song = getActiveSong();
    if (!song || !trackId) return false;
    
    const sections = getMuteSectionsForTrack(trackId);
    if (sections.length <= 1) return false;
    
    // Find the section that starts at oldTime
    const splitIndex = sections.findIndex(s => Math.abs(s.start - oldTime) < 0.001);
    if (splitIndex <= 0) return false; // Can't move first boundary
    
    const newSections = [...sections];
    
    // Update the boundary
    newSections[splitIndex - 1] = {
        ...newSections[splitIndex - 1],
        end: newTime
    };
    newSections[splitIndex] = {
        ...newSections[splitIndex],
        start: newTime
    };
    
    return setMuteSectionsForTrack(trackId, newSections, true);
}

/**
 * Get the split times for a track (for rendering dividers)
 * Excludes start (0) and end (duration) boundaries
 * @param {string} trackId - Track ID
 * @returns {Array<number>} Array of split times in seconds
 */
export function getMuteSplitTimes(trackId) {
    const sections = getMuteSectionsForTrack(trackId);
    if (sections.length <= 1) return [];
    
    // Return the start time of each section except the first
    return sections.slice(1).map(s => s.start);
}

/**
 * Check if a track has multiple mute sections (has been split)
 * @param {string} trackId - Track ID
 * @returns {boolean} True if track has multiple sections
 */
export function hasMuteSections(trackId) {
    const sections = getMuteSectionsForTrack(trackId);
    return sections.length > 1;
}

/**
 * Toggle a mute section's muted state
 * @param {string} trackId - Track ID
 * @param {number} sectionIndex - Index of the section to toggle
 * @returns {boolean|null} New muted state, or null on failure
 */
export function toggleMuteSection(trackId, sectionIndex) {
    const song = getActiveSong();
    if (!song || !trackId) return null;
    
    const sections = getMuteSectionsForTrack(trackId);
    if (sectionIndex < 0 || sectionIndex >= sections.length) return null;
    
    const newSections = [...sections];
    newSections[sectionIndex] = {
        ...newSections[sectionIndex],
        muted: !newSections[sectionIndex].muted
    };
    
    setMuteSectionsForTrack(trackId, newSections, true);
    return newSections[sectionIndex].muted;
}

/**
 * Get the mute section at a given time for a track
 * @param {string} trackId - Track ID
 * @param {number} time - Time in seconds
 * @returns {Object|null} Section object { start, end, muted, index } or null
 */
export function getMuteSectionAtTime(trackId, time) {
    const sections = getMuteSectionsForTrack(trackId);
    if (sections.length === 0) return null;
    
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (time >= section.start && time < section.end) {
            return { ...section, index: i };
        }
    }
    
    // Edge case: exactly at end of last section
    const lastIndex = sections.length - 1;
    const lastSection = sections[lastIndex];
    if (lastSection && time >= lastSection.start && time <= lastSection.end) {
        return { ...lastSection, index: lastIndex };
    }
    
    return null;
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
            
            // Phase 3: Timeline-based arrangement sections migration
            if (!song.arrangementSections) {
                song.arrangementSections = [];
            }
            if (song.arrangementModified === undefined) {
                song.arrangementModified = false;
            }
            if (song.currentArrangementId === undefined) {
                song.currentArrangementId = null;
            }
            if (song.currentArrangementName === undefined) {
                song.currentArrangementName = null;
            }
            
            // Phase 4: Waveform-based mute sections migration
            if (!song.muteSections) {
                song.muteSections = {};
            }
            if (song.muteSetModified === undefined) {
                song.muteSetModified = false;
            }
            if (song.currentMuteSetId === undefined) {
                song.currentMuteSetId = null;
            }
            if (song.currentMuteSetName === undefined) {
                song.currentMuteSetName = null;
            }
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

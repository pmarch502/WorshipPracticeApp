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

// ============================================================================
// Tempo Utility Functions
// ============================================================================

/**
 * Get the tempo at a specific time position
 * @param {number} timeSeconds - Position in seconds
 * @param {Array|null} tempos - Array of {tempo, start} where start is in seconds
 * @returns {number} - Tempo in BPM (defaults to 120 if no tempo data)
 */
export function getTempoAtTime(timeSeconds, tempos) {
    if (!tempos || tempos.length === 0) {
        return 120;
    }
    
    // Find the last tempo entry where start <= timeSeconds
    let activeTempo = 120;
    for (const entry of tempos) {
        if (entry.start <= timeSeconds) {
            activeTempo = entry.tempo;
        } else {
            break; // Assuming tempos are sorted by start time
        }
    }
    return activeTempo;
}

/**
 * Get the time signature at a specific time position
 * @param {number} timeSeconds - Position in seconds
 * @param {Array|null} timeSigs - Array of {sig, start} where start is in seconds
 * @returns {string} - Time signature string (defaults to "4/4" if no data)
 */
export function getTimeSigAtTime(timeSeconds, timeSigs) {
    if (!timeSigs || timeSigs.length === 0) {
        return '4/4';
    }
    
    // Find the last time sig entry where start <= timeSeconds
    let activeSig = '4/4';
    for (const entry of timeSigs) {
        if (entry.start <= timeSeconds) {
            activeSig = entry.sig;
        } else {
            break; // Assuming time sigs are sorted by start time
        }
    }
    return activeSig;
}

/**
 * Generate beat positions for a time range (for timeline rendering)
 * Accounts for variable tempo and time signature changes throughout the song.
 * @param {number} startTime - Start of visible range (seconds)
 * @param {number} endTime - End of visible range (seconds)
 * @param {Array|null} tempos - Tempo data array [{tempo, start}, ...]
 * @param {Array|null} timeSigs - Time signature data array [{sig, start}, ...]
 * @returns {Array} - Array of {time, measure, beat, isMeasureStart, tempo}
 */
export function getBeatPositionsInRange(startTime, endTime, tempos, timeSigs) {
    const beats = [];
    const effectiveTempos = (tempos && tempos.length > 0) ? tempos : [{ tempo: 120, start: 0 }];
    const effectiveTimeSigs = (timeSigs && timeSigs.length > 0) ? timeSigs : [{ sig: '4/4', start: 0 }];
    
    // Parse the first time signature to get initial beatsPerMeasure
    const parseTimeSig = (sig) => {
        const [num] = sig.split('/').map(Number);
        return num || 4;
    };
    
    // Start from time 0 to calculate correct measure/beat numbers
    let currentTime = 0;
    let measure = 1;
    let beat = 1;
    let tempoIndex = 0;
    let timeSigIndex = 0;
    let beatsPerMeasure = parseTimeSig(effectiveTimeSigs[0].sig);
    
    // Safety limit to prevent infinite loops
    const maxIterations = 100000;
    let iterations = 0;
    
    while (currentTime <= endTime && iterations < maxIterations) {
        iterations++;
        
        // Get current tempo - advance to next tempo if we've passed its start time
        while (tempoIndex < effectiveTempos.length - 1 && 
               effectiveTempos[tempoIndex + 1].start <= currentTime) {
            tempoIndex++;
        }
        const currentTempo = effectiveTempos[tempoIndex].tempo;
        const secondsPerBeat = 60 / currentTempo;
        
        // Check for time signature change - advance to next time sig if we've passed its start time
        while (timeSigIndex < effectiveTimeSigs.length - 1 && 
               effectiveTimeSigs[timeSigIndex + 1].start <= currentTime) {
            timeSigIndex++;
            beatsPerMeasure = parseTimeSig(effectiveTimeSigs[timeSigIndex].sig);
        }
        
        // Only add beats that are in the visible range
        if (currentTime >= startTime) {
            beats.push({
                time: currentTime,
                measure,
                beat,
                isMeasureStart: beat === 1,
                tempo: currentTempo
            });
        }
        
        // Advance to next beat
        currentTime += secondsPerBeat;
        beat++;
        if (beat > beatsPerMeasure) {
            beat = 1;
            measure++;
        }
    }
    
    return beats;
}

/**
 * Find the nearest beat to a given time (for snap-to-beat functionality)
 * @param {number} timeSeconds - Target time in seconds
 * @param {Array|null} tempos - Tempo data array
 * @param {Array|null} timeSigs - Time signature data array
 * @returns {number} - Time of nearest beat in seconds
 */
export function findNearestBeat(timeSeconds, tempos, timeSigs) {
    if (timeSeconds < 0) return 0;
    
    // Get beats around the target time (with some margin)
    const tempo = getTempoAtTime(timeSeconds, tempos);
    const margin = (60 / tempo) * 2; // 2 beats worth of margin
    
    const beats = getBeatPositionsInRange(
        Math.max(0, timeSeconds - margin),
        timeSeconds + margin,
        tempos,
        timeSigs
    );
    
    if (beats.length === 0) return timeSeconds;
    
    // Find closest beat
    let closest = beats[0];
    let minDiff = Math.abs(beats[0].time - timeSeconds);
    
    for (const beat of beats) {
        const diff = Math.abs(beat.time - timeSeconds);
        if (diff < minDiff) {
            minDiff = diff;
            closest = beat;
        }
    }
    
    return closest.time;
}

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

/**
 * Clear cached metadata for a specific song
 * @param {string} songName - Song name
 */
export function clearCacheForSong(songName) {
    metadataCache.delete(songName);
}

/**
 * Refresh metadata for a song (bypasses cache)
 * @param {string} songName - Song name (directory name)
 * @returns {Promise<Object|null>} Fresh metadata object or null if not found
 */
export async function refreshMetadata(songName) {
    // Clear the cache for this song to force a fresh fetch
    clearCacheForSong(songName);
    
    // Add cache-busting query parameter to bypass CDN cache
    // (CloudFront invalidation may take a moment to propagate)
    try {
        const path = `audio/${encodeURIComponent(songName)}/metadata.json?_=${Date.now()}`;
        const response = await fetch(path);
        if (!response.ok) {
            console.warn(`No metadata found for ${songName}`);
            return null;
        }
        const metadata = await response.json();
        metadataCache.set(songName, metadata);
        return metadata;
    } catch (error) {
        console.warn(`Failed to refresh metadata for ${songName}:`, error);
        return null;
    }
}

/**
 * Refresh metadata with retry logic, waiting for expected changes to propagate
 * Use this after publish/delete operations when CloudFront invalidation may be in progress
 * @param {string} songName - Song name (directory name)
 * @param {Function} expectedChange - Predicate function (metadata) => boolean, returns true when expected change is present
 * @param {number} maxRetries - Maximum number of retry attempts (default 5)
 * @param {number} delayMs - Delay between retries in milliseconds (default 1000)
 * @returns {Promise<Object|null>} Fresh metadata object or null if not found
 */
export async function refreshMetadataWithRetry(songName, expectedChange, maxRetries = 20, delayMs = 1500) {
    for (let i = 0; i < maxRetries; i++) {
        const metadata = await refreshMetadata(songName);
        if (expectedChange(metadata)) {
            return metadata; // Success - change is present
        }
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    // Return last fetched metadata even if change not detected
    return await refreshMetadata(songName);
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
    
    // Parse time signature to get beats per measure and beat unit denominator
    // Returns { numerator, denominator } - e.g., "6/8" -> { numerator: 6, denominator: 8 }
    const parseTimeSig = (sig) => {
        const [num, denom] = sig.split('/').map(Number);
        return { numerator: num || 4, denominator: denom || 4 };
    };
    
    // Start from time 0 to calculate correct measure/beat numbers
    let currentTime = 0;
    let measure = 1;
    let beat = 1;
    let tempoIndex = 0;
    let timeSigIndex = 0;
    let { numerator: beatsPerMeasure, denominator } = parseTimeSig(effectiveTimeSigs[0].sig);
    
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
        // BPM is always in quarter notes, so adjust for beat unit denominator
        // 4/4: denominator=4, multiply by 4/4=1 (quarter note beat)
        // 6/8: denominator=8, multiply by 4/8=0.5 (eighth note beat)
        const secondsPerBeat = (60 / currentTempo) * (4 / denominator);
        
        // Check for time signature change - advance to next time sig if we've passed its start time
        while (timeSigIndex < effectiveTimeSigs.length - 1 && 
               effectiveTimeSigs[timeSigIndex + 1].start <= currentTime) {
            timeSigIndex++;
            ({ numerator: beatsPerMeasure, denominator } = parseTimeSig(effectiveTimeSigs[timeSigIndex].sig));
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
    const timeSig = getTimeSigAtTime(timeSeconds, timeSigs);
    const [, denom] = timeSig.split('/').map(Number);
    const denominator = denom || 4;
    // Adjust margin for beat unit (e.g., eighth notes in 6/8)
    const margin = (60 / tempo) * (4 / denominator) * 2; // 2 beats worth of margin
    
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

/**
 * Pre-calculate all beat positions for a virtual timeline
 * Iterates sequentially from time=0, properly tracking measure/beat numbers
 * through time signature changes.
 * 
 * @param {number} duration - Total duration in seconds (virtual duration for arrangements)
 * @param {Array} virtualSections - Virtual sections array (maps virtual time to source time)
 * @param {Array} tempos - Tempo array [{tempo, start}, ...] in source time
 * @param {Array} timeSigs - Time signature array [{sig, start}, ...] in source time
 * @returns {Array} Array of {time, measure, beat, isMeasureStart, tempo}
 */
export function calculateAllBeatPositions(duration, virtualSections, tempos, timeSigs) {
    const beats = [];
    
    if (!virtualSections || virtualSections.length === 0 || duration <= 0) {
        return beats;
    }
    
    const effectiveTempos = (tempos && tempos.length > 0) ? tempos : [{ tempo: 120, start: 0 }];
    const effectiveTimeSigs = (timeSigs && timeSigs.length > 0) ? timeSigs : [{ sig: '4/4', start: 0 }];
    
    // Parse time signature helper
    const parseTimeSig = (sig) => {
        const [num, denom] = sig.split('/').map(Number);
        return { numerator: num || 4, denominator: denom || 4 };
    };
    
    // Helper to map virtual time to source time
    const virtualToSource = (virtualTime) => {
        for (const section of virtualSections) {
            if (virtualTime >= section.virtualStart && virtualTime < section.virtualEnd) {
                const offsetInSection = virtualTime - section.virtualStart;
                return section.sourceStart + offsetInSection;
            }
        }
        // If past all sections, use the last section's mapping
        const lastSection = virtualSections[virtualSections.length - 1];
        const offsetInSection = virtualTime - lastSection.virtualStart;
        return lastSection.sourceStart + offsetInSection;
    };
    
    // Small epsilon for floating point comparisons
    const EPSILON = 0.001;
    
    // =================================================================
    // Build a set of authoritative beat times from tempo changes
    // Tempo changes always happen on beat boundaries, so these times
    // are exact and should be used to avoid floating point drift
    // =================================================================
    
    // Map source tempo change times to virtual times
    const tempoChangeTimes = new Map(); // virtualTime -> tempo
    for (const section of virtualSections) {
        for (const t of effectiveTempos) {
            // Check if this tempo change falls within this section's source range
            if (t.start >= section.sourceStart && t.start < section.sourceEnd) {
                const offsetInSource = t.start - section.sourceStart;
                const virtualTime = section.virtualStart + offsetInSource;
                if (virtualTime < duration) {
                    tempoChangeTimes.set(virtualTime, t.tempo);
                }
            }
        }
    }
    
    // =================================================================
    // Simple iterative approach: walk through virtual time beat by beat,
    // tracking measure and beat numbers properly through time sig changes.
    // Snap to tempo change times when close to avoid floating point drift.
    // =================================================================
    
    let currentTime = 0;
    let measure = 1;
    let beat = 1;
    
    // Safety limit to prevent infinite loops
    const maxBeats = 10000;
    
    while (currentTime < duration && beats.length < maxBeats) {
        // Check if we're close to a tempo change time and snap to it
        // This avoids floating point drift accumulation
        for (const [tempoChangeTime, _] of tempoChangeTimes) {
            if (Math.abs(currentTime - tempoChangeTime) < EPSILON) {
                currentTime = tempoChangeTime;
                break;
            }
        }
        
        // Map virtual time to source time for tempo/time-sig lookup
        const sourceTime = virtualToSource(currentTime);
        
        // Get tempo and time signature at this source time
        const tempo = getTempoAtTime(sourceTime, effectiveTempos);
        const timeSig = getTimeSigAtTime(sourceTime, effectiveTimeSigs);
        const { numerator: beatsPerMeasure, denominator } = parseTimeSig(timeSig);
        
        // Calculate seconds per beat based on tempo and beat unit
        // BPM is always in quarter notes, so adjust for denominator
        // 4/4: denominator=4, multiply by 4/4=1 (quarter note beat)
        // 6/8: denominator=8, multiply by 4/8=0.5 (eighth note beat)
        const secondsPerBeat = (60 / tempo) * (4 / denominator);
        
        // Add this beat
        beats.push({
            time: currentTime,
            measure,
            beat,
            isMeasureStart: beat === 1,
            tempo
        });
        
        // Advance to next beat
        currentTime += secondsPerBeat;
        beat++;
        
        // Check if we've completed a measure
        if (beat > beatsPerMeasure) {
            beat = 1;
            measure++;
        }
    }
    
    return beats;
}

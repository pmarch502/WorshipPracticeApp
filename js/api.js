/**
 * API Client Module
 * Handles communication with the arrangements and mute sets Lambda API
 */

const API_BASE_URL = 'https://g1pan67cc9.execute-api.us-east-2.amazonaws.com/prod';

// ============ Arrangement API Functions ============

/**
 * List all arrangements for a song
 * @param {string} songName - Name of the song
 * @returns {Promise<string[]>} - Array of arrangement names
 * @throws {Error} - On network or API errors
 */
export async function listArrangements(songName) {
    const response = await fetch(
        `${API_BASE_URL}/arrangements/${encodeURIComponent(songName)}`,
        {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        }
    );

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.error || 'Failed to list arrangements');
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data.arrangements;
}

/**
 * Get a specific arrangement
 * @param {string} songName - Name of the song
 * @param {string} name - Name of the arrangement
 * @returns {Promise<Object>} - Arrangement object with name, sections, protected, createdAt, modifiedAt
 * @throws {Error} - On network or API errors
 */
export async function getArrangement(songName, name) {
    const response = await fetch(
        `${API_BASE_URL}/arrangements/${encodeURIComponent(songName)}/${encodeURIComponent(name)}`,
        {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        }
    );

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.error || 'Failed to get arrangement');
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

/**
 * Save an arrangement (create or update)
 * @param {string} songName - Name of the song
 * @param {string} name - Name of the arrangement
 * @param {Object} data - Arrangement data
 * @param {Array} data.sections - Array of { start, end, enabled } objects
 * @param {boolean} [data.protected=false] - Whether to protect this arrangement
 * @param {string} [data.secret] - Required if overwriting a protected arrangement
 * @returns {Promise<Object>} - Response with success, message, and saved arrangement
 * @throws {Error} - On network or API errors
 */
export async function saveArrangement(songName, name, data) {
    const response = await fetch(
        `${API_BASE_URL}/arrangements/${encodeURIComponent(songName)}/${encodeURIComponent(name)}`,
        {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        }
    );

    const responseData = await response.json();

    if (!response.ok) {
        const error = new Error(responseData.error || 'Failed to save arrangement');
        error.status = response.status;
        error.data = responseData;
        throw error;
    }

    return responseData;
}

/**
 * Delete an arrangement
 * @param {string} songName - Name of the song
 * @param {string} name - Name of the arrangement
 * @param {string} [secret] - Required if deleting a protected arrangement
 * @returns {Promise<Object>} - Response with success and message
 * @throws {Error} - On network or API errors
 */
export async function deleteArrangement(songName, name, secret = null) {
    const body = secret ? { secret } : {};
    
    const response = await fetch(
        `${API_BASE_URL}/arrangements/${encodeURIComponent(songName)}/${encodeURIComponent(name)}`,
        {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        }
    );

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.error || 'Failed to delete arrangement');
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

/**
 * Check if an arrangement with the given name already exists
 * @param {string} songName - Name of the song
 * @param {string} name - Name to check
 * @returns {Promise<boolean>} - True if arrangement exists
 * @throws {Error} - On network or API errors
 */
export async function checkArrangementExists(songName, name) {
    const arrangements = await listArrangements(songName);
    return arrangements.some(a => a.toLowerCase() === name.toLowerCase());
}

// ============ Mute Set API Functions ============

/**
 * List all mute sets for a song
 * @param {string} songName - Name of the song
 * @returns {Promise<string[]>} - Array of mute set names
 * @throws {Error} - On network or API errors
 */
export async function listMuteSets(songName) {
    const response = await fetch(
        `${API_BASE_URL}/mutes/${encodeURIComponent(songName)}`,
        {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        }
    );

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.error || 'Failed to list mute sets');
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data.muteSets;
}

/**
 * Get a specific mute set
 * @param {string} songName - Name of the song
 * @param {string} name - Name of the mute set
 * @returns {Promise<Object>} - Mute set object with name, tracks, protected, createdAt, modifiedAt
 * @throws {Error} - On network or API errors
 */
export async function getMuteSet(songName, name) {
    const response = await fetch(
        `${API_BASE_URL}/mutes/${encodeURIComponent(songName)}/${encodeURIComponent(name)}`,
        {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        }
    );

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.error || 'Failed to get mute set');
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

/**
 * Save a mute set (create or update)
 * @param {string} songName - Name of the song
 * @param {string} name - Name of the mute set
 * @param {Object} data - Mute set data
 * @param {Object} data.tracks - Map of track filename to array of { start, end, muted } objects
 * @param {boolean} [data.protected=false] - Whether to protect this mute set
 * @param {string} [data.secret] - Required if overwriting a protected mute set
 * @returns {Promise<Object>} - Response with success, message, and saved mute set
 * @throws {Error} - On network or API errors
 */
export async function saveMuteSet(songName, name, data) {
    const response = await fetch(
        `${API_BASE_URL}/mutes/${encodeURIComponent(songName)}/${encodeURIComponent(name)}`,
        {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        }
    );

    const responseData = await response.json();

    if (!response.ok) {
        const error = new Error(responseData.error || 'Failed to save mute set');
        error.status = response.status;
        error.data = responseData;
        throw error;
    }

    return responseData;
}

/**
 * Delete a mute set
 * @param {string} songName - Name of the song
 * @param {string} name - Name of the mute set
 * @param {string} [secret] - Required if deleting a protected mute set
 * @returns {Promise<Object>} - Response with success and message
 * @throws {Error} - On network or API errors
 */
export async function deleteMuteSet(songName, name, secret = null) {
    const body = secret ? { secret } : {};
    
    const response = await fetch(
        `${API_BASE_URL}/mutes/${encodeURIComponent(songName)}/${encodeURIComponent(name)}`,
        {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        }
    );

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.error || 'Failed to delete mute set');
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

/**
 * Check if a mute set with the given name already exists
 * @param {string} songName - Name of the song
 * @param {string} name - Name to check
 * @returns {Promise<boolean>} - True if mute set exists
 * @throws {Error} - On network or API errors
 */
export async function checkMuteSetExists(songName, name) {
    const muteSets = await listMuteSets(songName);
    return muteSets.some(m => m.toLowerCase() === name.toLowerCase());
}

// ============ Validation Utilities ============

/**
 * Validate an arrangement or mute set name
 * @param {string} name - Name to validate
 * @returns {{ valid: boolean, error?: string }} - Validation result
 */
export function validateName(name) {
    // Check if empty or not a string
    if (!name || typeof name !== 'string') {
        return { valid: false, error: 'Name is required' };
    }
    
    // Trim and check if empty
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return { valid: false, error: 'Name cannot be empty or only whitespace' };
    }
    
    // Check max length
    if (trimmed.length > 100) {
        return { valid: false, error: 'Name must be 100 characters or less' };
    }
    
    // Check allowed characters: letters, numbers, spaces, hyphens, underscores
    const allowedPattern = /^[a-zA-Z0-9 _-]+$/;
    if (!allowedPattern.test(trimmed)) {
        return { valid: false, error: 'Name can only contain letters, numbers, spaces, hyphens, and underscores' };
    }
    
    return { valid: true };
}

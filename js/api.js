/**
 * API Client Module
 * Handles communication with the arrangements Lambda API
 */

const API_BASE_URL = 'https://g1pan67cc9.execute-api.us-east-2.amazonaws.com/prod';

/**
 * Publish an arrangement to make it permanently available
 * @param {string} songName - Name of the song
 * @param {Object} arrangement - Arrangement object with name and sections
 * @param {string} arrangement.name - Name of the arrangement
 * @param {number[]} arrangement.sections - Array of section indices
 * @param {string} secret - Admin secret for authorization
 * @returns {Promise<Object>} - Response with success status and message
 * @throws {Error} - On network or API errors
 */
export async function publishArrangement(songName, arrangement, secret) {
    const response = await fetch(`${API_BASE_URL}/arrangements`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            secret,
            songName,
            arrangement
        })
    });

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.error || 'Failed to publish arrangement');
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

/**
 * Delete a published arrangement
 * @param {string} songName - Name of the song
 * @param {string} arrangementName - Name of the arrangement to delete
 * @param {string} secret - Admin secret for authorization
 * @returns {Promise<Object>} - Response with success status and message
 * @throws {Error} - On network or API errors
 */
export async function deleteArrangement(songName, arrangementName, secret) {
    const response = await fetch(
        `${API_BASE_URL}/arrangements/${encodeURIComponent(songName)}/${encodeURIComponent(arrangementName)}`,
        {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ secret })
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

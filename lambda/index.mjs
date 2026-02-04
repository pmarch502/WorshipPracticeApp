import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
const s3 = new S3Client({ region: process.env.AWS_REGION });
const cloudfront = new CloudFrontClient({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET;
const DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
// CORS headers for all responses
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};
export const handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }
    // Handle GET /manifest (public, no auth required)
    if (event.httpMethod === 'GET' && event.resource === '/manifest') {
        try {
            return await handleGetManifest();
        } catch (err) {
            console.error('Error in handleGetManifest:', err);
            return response(500, { error: 'Internal server error', details: err.message });
        }
    }

    // Handle GET /arrangements/{songName} - list arrangements (public, no auth required)
    if (event.httpMethod === 'GET' && event.resource === '/arrangements/{songName}') {
        try {
            const { songName } = event.pathParameters;
            return await handleListArrangements(decodeURIComponent(songName));
        } catch (err) {
            console.error('Error in handleListArrangements:', err);
            return response(500, { error: 'Internal server error', details: err.message });
        }
    }

    // Handle GET /arrangements/{songName}/{name} - get specific arrangement (public, no auth required)
    if (event.httpMethod === 'GET' && event.resource === '/arrangements/{songName}/{name}') {
        try {
            const { songName, name } = event.pathParameters;
            return await handleGetArrangement(
                decodeURIComponent(songName),
                decodeURIComponent(name)
            );
        } catch (err) {
            console.error('Error in handleGetArrangement:', err);
            return response(500, { error: 'Internal server error', details: err.message });
        }
    }

    // Handle PUT /arrangements/{songName}/{name} - save arrangement
    if (event.httpMethod === 'PUT' && event.resource === '/arrangements/{songName}/{name}') {
        try {
            const { songName, name } = event.pathParameters;
            const body = JSON.parse(event.body || '{}');
            return await handleSaveArrangement(
                decodeURIComponent(songName),
                decodeURIComponent(name),
                body
            );
        } catch (err) {
            console.error('Error in handleSaveArrangement:', err);
            return response(500, { error: 'Internal server error', details: err.message });
        }
    }

    // Handle DELETE /arrangements/{songName}/{name} - delete arrangement
    if (event.httpMethod === 'DELETE' && event.resource === '/arrangements/{songName}/{name}') {
        try {
            const { songName, name } = event.pathParameters;
            const body = JSON.parse(event.body || '{}');
            const { secret } = body;
            return await handleDeleteArrangement(
                decodeURIComponent(songName),
                decodeURIComponent(name),
                secret
            );
        } catch (err) {
            console.error('Error in handleDeleteArrangement:', err);
            return response(500, { error: 'Internal server error', details: err.message });
        }
    }

    // Handle GET /mutes/{songName} - list mute sets (public, no auth required)
    if (event.httpMethod === 'GET' && event.resource === '/mutes/{songName}') {
        try {
            const { songName } = event.pathParameters;
            return await handleListMuteSets(decodeURIComponent(songName));
        } catch (err) {
            console.error('Error in handleListMuteSets:', err);
            return response(500, { error: 'Internal server error', details: err.message });
        }
    }

    // Handle GET /mutes/{songName}/{name} - get specific mute set (public, no auth required)
    if (event.httpMethod === 'GET' && event.resource === '/mutes/{songName}/{name}') {
        try {
            const { songName, name } = event.pathParameters;
            return await handleGetMuteSet(
                decodeURIComponent(songName),
                decodeURIComponent(name)
            );
        } catch (err) {
            console.error('Error in handleGetMuteSet:', err);
            return response(500, { error: 'Internal server error', details: err.message });
        }
    }

    // Handle PUT /mutes/{songName}/{name} - save mute set
    if (event.httpMethod === 'PUT' && event.resource === '/mutes/{songName}/{name}') {
        try {
            const { songName, name } = event.pathParameters;
            const body = JSON.parse(event.body || '{}');
            return await handleSaveMuteSet(
                decodeURIComponent(songName),
                decodeURIComponent(name),
                body
            );
        } catch (err) {
            console.error('Error in handleSaveMuteSet:', err);
            return response(500, { error: 'Internal server error', details: err.message });
        }
    }

    // Handle DELETE /mutes/{songName}/{name} - delete mute set
    if (event.httpMethod === 'DELETE' && event.resource === '/mutes/{songName}/{name}') {
        try {
            const { songName, name } = event.pathParameters;
            const body = JSON.parse(event.body || '{}');
            const { secret } = body;
            return await handleDeleteMuteSet(
                decodeURIComponent(songName),
                decodeURIComponent(name),
                secret
            );
        } catch (err) {
            console.error('Error in handleDeleteMuteSet:', err);
            return response(500, { error: 'Internal server error', details: err.message });
        }
    }

    // No matching route
    return response(400, { error: 'Invalid request' });
};
async function handleGetManifest() {
    console.log('handleGetManifest called, bucket:', BUCKET);
    
    // Collect all objects with pagination support
    const allObjects = [];
    let continuationToken = undefined;
    
    do {
        const command = new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: 'audio/',
            ContinuationToken: continuationToken
        });
        const result = await s3.send(command);
        
        if (result.Contents) {
            allObjects.push(...result.Contents);
        }
        
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);
    
    // Parse objects into songs and tracks
    // Key format: audio/{songName}/{trackFileName}
    const songMap = new Map();
    
    for (const obj of allObjects) {
        const key = obj.Key;
        
        // Skip if not under audio/ prefix or is the audio/ folder itself
        if (!key.startsWith('audio/') || key === 'audio/') {
            continue;
        }
        
        // Remove 'audio/' prefix and split
        const relativePath = key.slice(6); // Remove 'audio/'
        const parts = relativePath.split('/');
        
        // Must have exactly 2 parts: songName/trackFileName
        if (parts.length !== 2) {
            continue;
        }
        
        const [songName, trackFileName] = parts;
        
        // Skip if not an mp3 file
        if (!trackFileName.toLowerCase().endsWith('.mp3')) {
            continue;
        }
        
        // Skip empty song names or track names
        if (!songName || !trackFileName) {
            continue;
        }
        
        // Add to song map
        if (!songMap.has(songName)) {
            songMap.set(songName, []);
        }
        songMap.get(songName).push(trackFileName);
    }
    
    // Convert to array and sort
    const songs = [];
    for (const [name, tracks] of songMap) {
        // Sort tracks alphabetically
        tracks.sort((a, b) => a.localeCompare(b));
        songs.push({ name, tracks });
    }
    
    // Sort songs alphabetically
    songs.sort((a, b) => a.name.localeCompare(b.name));
    
    // Build manifest response
    const manifest = {
        generated: new Date().toISOString(),
        songs
    };
    
    console.log(`Manifest generated: ${songs.length} songs`);
    
    return response(200, manifest);
}

async function handleGetArrangement(songName, name) {
    console.log('handleGetArrangement called for:', songName, name);
    
    const key = `audio/${songName}/Arrangements/${name}.json`;
    
    try {
        const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const result = await s3.send(command);
        const bodyString = await result.Body.transformToString();
        const arrangement = JSON.parse(bodyString);
        
        return response(200, arrangement);
    } catch (err) {
        if (err.name === 'NoSuchKey') {
            return response(404, { error: `Arrangement '${name}' not found for song '${songName}'` });
        }
        console.error('Error getting arrangement:', err);
        return response(500, { error: 'Failed to get arrangement', details: err.message });
    }
}

async function handleSaveArrangement(songName, name, body) {
    console.log('handleSaveArrangement called for:', songName, name);
    
    const { sections, protected: isProtected, secret } = body;
    
    // Validate required fields
    if (!sections || !Array.isArray(sections) || sections.length === 0) {
        return response(400, { error: 'Missing or invalid sections array' });
    }
    
    // Validate sections have required fields
    for (const section of sections) {
        if (typeof section.start !== 'number' || 
            typeof section.end !== 'number' || 
            typeof section.enabled !== 'boolean') {
            return response(400, { error: 'Each section must have start (number), end (number), and enabled (boolean)' });
        }
    }
    
    // Validate at least one section is enabled
    if (!sections.some(s => s.enabled)) {
        return response(400, { error: 'At least one section must be enabled' });
    }
    
    const key = `audio/${songName}/Arrangements/${name}.json`;
    
    // Check if arrangement already exists
    let existingArrangement = null;
    try {
        const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const result = await s3.send(getCommand);
        const bodyString = await result.Body.transformToString();
        existingArrangement = JSON.parse(bodyString);
    } catch (err) {
        if (err.name !== 'NoSuchKey') {
            throw err; // Unexpected error
        }
        // NoSuchKey means it's a new arrangement - that's fine
    }
    
    // If existing arrangement is protected, require secret
    if (existingArrangement?.protected) {
        if (secret !== ADMIN_SECRET) {
            return response(403, { error: 'This arrangement is protected. Valid secret required to overwrite.' });
        }
    }
    
    // Build the arrangement object
    const now = new Date().toISOString();
    const arrangement = {
        name: name,
        sections: sections,
        protected: isProtected || false,
        createdAt: existingArrangement?.createdAt || now,
        modifiedAt: now
    };
    
    // Save to S3
    const putCommand = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(arrangement, null, '\t'),
        ContentType: 'application/json'
    });
    await s3.send(putCommand);
    
    // Invalidate CloudFront cache
    await invalidateCache(`/audio/${encodeURIComponent(songName)}/Arrangements/${encodeURIComponent(name)}.json`);
    
    return response(200, { 
        success: true, 
        message: existingArrangement ? `Arrangement '${name}' updated` : `Arrangement '${name}' created`,
        arrangement: arrangement
    });
}

async function handleListArrangements(songName) {
    console.log('handleListArrangements called for:', songName);
    
    const prefix = `audio/${songName}/Arrangements/`;
    
    try {
        const command = new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix
        });
        
        const result = await s3.send(command);
        
        // If no Contents, folder doesn't exist or is empty - return empty array
        if (!result.Contents || result.Contents.length === 0) {
            return response(200, { arrangements: [] });
        }
        
        // Extract arrangement names from keys
        // Key format: audio/{songName}/Arrangements/{name}.json
        const arrangements = [];
        
        for (const obj of result.Contents) {
            const key = obj.Key;
            
            // Skip if not a .json file
            if (!key.endsWith('.json')) {
                continue;
            }
            
            // Extract filename from key
            const filename = key.slice(prefix.length); // Remove prefix
            
            // Skip if empty or contains subdirectories
            if (!filename || filename.includes('/')) {
                continue;
            }
            
            // Remove .json extension and URL-decode the name
            const name = decodeURIComponent(filename.slice(0, -5));
            arrangements.push(name);
        }
        
        // Sort alphabetically
        arrangements.sort((a, b) => a.localeCompare(b));
        
        return response(200, { arrangements });
    } catch (err) {
        console.error('Error listing arrangements:', err);
        return response(500, { error: 'Failed to list arrangements', details: err.message });
    }
}

async function handleDeleteArrangement(songName, name, secret) {
    console.log('handleDeleteArrangement called for:', songName, name);
    
    const key = `audio/${songName}/Arrangements/${name}.json`;
    
    // First, check if arrangement exists and if it's protected
    let existingArrangement = null;
    try {
        const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const result = await s3.send(getCommand);
        const bodyString = await result.Body.transformToString();
        existingArrangement = JSON.parse(bodyString);
    } catch (err) {
        if (err.name === 'NoSuchKey') {
            return response(404, { error: `Arrangement '${name}' not found for song '${songName}'` });
        }
        throw err;
    }
    
    // If arrangement is protected, require secret
    if (existingArrangement.protected) {
        if (secret !== ADMIN_SECRET) {
            return response(403, { error: 'This arrangement is protected. Valid secret required to delete.' });
        }
    }
    
    // Delete from S3
    const deleteCommand = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
    await s3.send(deleteCommand);
    
    // Invalidate CloudFront cache
    await invalidateCache(`/audio/${encodeURIComponent(songName)}/Arrangements/${encodeURIComponent(name)}.json`);
    
    return response(200, { 
        success: true, 
        message: `Arrangement '${name}' deleted from '${songName}'`
    });
}

// ============ Mute Set Handlers ============

async function handleListMuteSets(songName) {
    console.log('handleListMuteSets called for:', songName);
    
    const prefix = `audio/${songName}/Mutes/`;
    
    try {
        const command = new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: prefix
        });
        
        const result = await s3.send(command);
        
        // If no Contents, folder doesn't exist or is empty - return empty array
        if (!result.Contents || result.Contents.length === 0) {
            return response(200, { muteSets: [] });
        }
        
        // Extract mute set names from keys
        // Key format: audio/{songName}/Mutes/{name}.json
        const muteSets = [];
        
        for (const obj of result.Contents) {
            const key = obj.Key;
            
            // Skip if not a .json file
            if (!key.endsWith('.json')) {
                continue;
            }
            
            // Extract filename from key
            const filename = key.slice(prefix.length); // Remove prefix
            
            // Skip if empty or contains subdirectories
            if (!filename || filename.includes('/')) {
                continue;
            }
            
            // Remove .json extension and URL-decode the name
            const name = decodeURIComponent(filename.slice(0, -5));
            muteSets.push(name);
        }
        
        // Sort alphabetically
        muteSets.sort((a, b) => a.localeCompare(b));
        
        return response(200, { muteSets });
    } catch (err) {
        console.error('Error listing mute sets:', err);
        return response(500, { error: 'Failed to list mute sets', details: err.message });
    }
}

async function handleGetMuteSet(songName, name) {
    console.log('handleGetMuteSet called for:', songName, name);
    
    const key = `audio/${songName}/Mutes/${name}.json`;
    
    try {
        const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const result = await s3.send(command);
        const bodyString = await result.Body.transformToString();
        const muteSet = JSON.parse(bodyString);
        
        return response(200, muteSet);
    } catch (err) {
        if (err.name === 'NoSuchKey') {
            return response(404, { error: `Mute set '${name}' not found for song '${songName}'` });
        }
        console.error('Error getting mute set:', err);
        return response(500, { error: 'Failed to get mute set', details: err.message });
    }
}

async function handleSaveMuteSet(songName, name, body) {
    console.log('handleSaveMuteSet called for:', songName, name);
    
    const { tracks, protected: isProtected, secret } = body;
    
    // Validate required fields
    if (!tracks || typeof tracks !== 'object' || Object.keys(tracks).length === 0) {
        return response(400, { error: 'Missing or invalid tracks object' });
    }
    
    // Validate each track's sections
    for (const [trackName, sections] of Object.entries(tracks)) {
        if (!Array.isArray(sections) || sections.length === 0) {
            return response(400, { error: `Track '${trackName}' must have at least one section` });
        }
        for (const section of sections) {
            if (typeof section.start !== 'number' || 
                typeof section.end !== 'number' || 
                typeof section.muted !== 'boolean') {
                return response(400, { error: `Each section in track '${trackName}' must have start (number), end (number), and muted (boolean)` });
            }
        }
    }
    
    const key = `audio/${songName}/Mutes/${name}.json`;
    
    // Check if mute set already exists
    let existingMuteSet = null;
    try {
        const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const result = await s3.send(getCommand);
        const bodyString = await result.Body.transformToString();
        existingMuteSet = JSON.parse(bodyString);
    } catch (err) {
        if (err.name !== 'NoSuchKey') {
            throw err; // Unexpected error
        }
        // NoSuchKey means it's a new mute set - that's fine
    }
    
    // If existing mute set is protected, require secret
    if (existingMuteSet?.protected) {
        if (secret !== ADMIN_SECRET) {
            return response(403, { error: 'This mute set is protected. Valid secret required to overwrite.' });
        }
    }
    
    // Build the mute set object
    const now = new Date().toISOString();
    const muteSet = {
        name: name,
        tracks: tracks,
        protected: isProtected || false,
        createdAt: existingMuteSet?.createdAt || now,
        modifiedAt: now
    };
    
    // Save to S3
    const putCommand = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(muteSet, null, '\t'),
        ContentType: 'application/json'
    });
    await s3.send(putCommand);
    
    // Invalidate CloudFront cache
    await invalidateCache(`/audio/${encodeURIComponent(songName)}/Mutes/${encodeURIComponent(name)}.json`);
    
    return response(200, { 
        success: true, 
        message: existingMuteSet ? `Mute set '${name}' updated` : `Mute set '${name}' created`,
        muteSet: muteSet
    });
}

async function handleDeleteMuteSet(songName, name, secret) {
    console.log('handleDeleteMuteSet called for:', songName, name);
    
    const key = `audio/${songName}/Mutes/${name}.json`;
    
    // First, check if mute set exists and if it's protected
    let existingMuteSet = null;
    try {
        const getCommand = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const result = await s3.send(getCommand);
        const bodyString = await result.Body.transformToString();
        existingMuteSet = JSON.parse(bodyString);
    } catch (err) {
        if (err.name === 'NoSuchKey') {
            return response(404, { error: `Mute set '${name}' not found for song '${songName}'` });
        }
        throw err;
    }
    
    // If mute set is protected, require secret
    if (existingMuteSet.protected) {
        if (secret !== ADMIN_SECRET) {
            return response(403, { error: 'This mute set is protected. Valid secret required to delete.' });
        }
    }
    
    // Delete from S3
    const deleteCommand = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
    await s3.send(deleteCommand);
    
    // Invalidate CloudFront cache
    await invalidateCache(`/audio/${encodeURIComponent(songName)}/Mutes/${encodeURIComponent(name)}.json`);
    
    return response(200, { 
        success: true, 
        message: `Mute set '${name}' deleted from '${songName}'`
    });
}

async function invalidateCache(path) {
    const command = new CreateInvalidationCommand({
        DistributionId: DISTRIBUTION_ID,
        InvalidationBatch: {
            CallerReference: `${Date.now()}`,
            Paths: {
                Quantity: 1,
                Items: [path]
            }
        }
    });
    await cloudfront.send(command);
}
function response(statusCode, body) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify(body)
    };
}
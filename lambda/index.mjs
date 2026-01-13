import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
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
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS'
};
export const handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }
    try {
        const body = JSON.parse(event.body || '{}');
        const { secret } = body;
        // Validate secret
        if (secret !== ADMIN_SECRET) {
            return response(401, { error: 'Invalid secret' });
        }
        if (event.httpMethod === 'POST' && event.resource === '/arrangements') {
            return await handlePublish(body);
        }
        if (event.httpMethod === 'DELETE' && event.resource === '/arrangements/{songName}/{arrangementName}') {
            const { songName, arrangementName } = event.pathParameters;
            return await handleDelete(decodeURIComponent(songName), decodeURIComponent(arrangementName));
        }
        return response(400, { error: 'Invalid request' });
    } catch (err) {
        console.error('Error:', err);
        return response(500, { error: 'Internal server error', details: err.message });
    }
};
async function handlePublish({ songName, arrangement }) {
    console.log('handlePublish called with:', { songName, arrangement });
    // Validate input
    if (!songName || !arrangement || !arrangement.name || !Array.isArray(arrangement.sections)) {
        return response(400, { error: 'Missing required fields: songName, arrangement.name, arrangement.sections' });
    }
    if (arrangement.sections.length === 0) {
        return response(400, { error: 'Arrangement must have at least one section' });
    }
    // Fetch current metadata
    const metadataKey = `audio/${songName}/metadata.json`;
    let metadata;
    
    try {
        metadata = await getMetadata(metadataKey);
    } catch (err) {
        console.log('getMetadata error:', err.name, err.Code, err.message);
        if (err.name === 'NoSuchKey') {
            return response(404, { error: `Song '${songName}' not found` });
        }
        throw err;
    }
    // Ensure arrangements array exists
    if (!metadata.arrangements) {
        metadata.arrangements = [];
    }
    // Check for name conflict
    const existingIndex = metadata.arrangements.findIndex(
        a => a.name.toLowerCase() === arrangement.name.toLowerCase()
    );
    if (existingIndex !== -1) {
        return response(409, { error: `Arrangement '${arrangement.name}' already exists for '${songName}'` });
    }
    // Validate section indices (must be valid marker indices)
    const maxSectionIndex = (metadata.markers?.length || 0) - 1;
    for (const idx of arrangement.sections) {
        if (!Number.isInteger(idx) || idx < 0 || idx > maxSectionIndex) {
            return response(400, { 
                error: `Invalid section index: ${idx}. Must be between 0 and ${maxSectionIndex}` 
            });
        }
    }
    // Add the new arrangement
    metadata.arrangements.push({
        name: arrangement.name,
        sections: arrangement.sections
    });
    // Write back to S3
    await putMetadata(metadataKey, metadata);
    // Invalidate CloudFront cache
    await invalidateCache(`/audio/${songName}/metadata.json`);
    return response(200, { 
        success: true, 
        message: `Arrangement '${arrangement.name}' published to '${songName}'` 
    });
}
async function handleDelete(songName, arrangementName) {
    // Fetch current metadata
    const metadataKey = `audio/${songName}/metadata.json`;
    let metadata;
    
    try {
        metadata = await getMetadata(metadataKey);
    } catch (err) {
        if (err.name === 'NoSuchKey') {
            return response(404, { error: `Song '${songName}' not found` });
        }
        throw err;
    }
    if (!metadata.arrangements || metadata.arrangements.length === 0) {
        return response(404, { error: `No arrangements found for '${songName}'` });
    }
    // Find the arrangement
    const index = metadata.arrangements.findIndex(
        a => a.name.toLowerCase() === arrangementName.toLowerCase()
    );
    if (index === -1) {
        return response(404, { error: `Arrangement '${arrangementName}' not found in '${songName}'` });
    }
    // Remove it
    metadata.arrangements.splice(index, 1);
    // Write back to S3
    await putMetadata(metadataKey, metadata);
    // Invalidate CloudFront cache
    await invalidateCache(`/audio/${songName}/metadata.json`);
    return response(200, { 
        success: true, 
        message: `Arrangement '${arrangementName}' deleted from '${songName}'` 
    });
}
async function getMetadata(key) {
    console.log('getMetadata called with key:', key, 'bucket:', BUCKET);
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const result = await s3.send(command);
    const bodyString = await result.Body.transformToString();
    return JSON.parse(bodyString);
}
async function putMetadata(key, metadata) {
    const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(metadata, null, '\t'),
        ContentType: 'application/json'
    });
    await s3.send(command);
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
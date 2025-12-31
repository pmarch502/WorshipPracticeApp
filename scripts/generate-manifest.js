/**
 * Generate Manifest Script
 * 
 * This Node.js script scans the /audio directory and generates a manifest.json
 * file that lists all available songs and their tracks.
 * 
 * Run with: node scripts/generate-manifest.js
 */

const fs = require('fs');
const path = require('path');

// Supported audio extensions
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'];

// Paths
const audioDir = path.join(__dirname, '..', 'audio');
const outputFile = path.join(audioDir, 'manifest.json');

function isAudioFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
}

function generateManifest() {
    console.log('Scanning audio directory:', audioDir);
    
    // Check if audio directory exists
    if (!fs.existsSync(audioDir)) {
        console.error('Error: Audio directory not found:', audioDir);
        process.exit(1);
    }

    const manifest = {
        generated: new Date().toISOString(),
        songs: []
    };

    // Read first-level directories (song names)
    const entries = fs.readdirSync(audioDir, { withFileTypes: true });
    const songDirs = entries.filter(entry => entry.isDirectory());

    console.log(`Found ${songDirs.length} song directories`);

    for (const songDir of songDirs) {
        const songName = songDir.name;
        const songPath = path.join(audioDir, songName);
        
        // Read audio files in song directory
        const files = fs.readdirSync(songPath);
        const tracks = files
            .filter(file => isAudioFile(file))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        if (tracks.length > 0) {
            manifest.songs.push({
                name: songName,
                tracks: tracks
            });
            console.log(`  - ${songName}: ${tracks.length} tracks`);
        } else {
            console.log(`  - ${songName}: No audio files found (skipping)`);
        }
    }

    // Sort songs alphabetically
    manifest.songs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    // Write manifest file
    fs.writeFileSync(outputFile, JSON.stringify(manifest, null, 2));
    console.log('\nManifest generated successfully:', outputFile);
    console.log(`Total: ${manifest.songs.length} songs`);
}

// Run the script
generateManifest();

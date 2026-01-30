/**
 * Main Entry Point
 * Initializes all modules and handles global events
 */

import * as State from './state.js';
import * as Storage from './storage.js';
import * as TrackManager from './trackManager.js';
import * as SongManager from './songManager.js';
import * as Metadata from './metadata.js';
import { getAudioEngine } from './audioEngine.js';
import { getTransport } from './transport.js';
import { getTrackPanel } from './ui/trackPanel.js';
import { getWaveformPanel } from './ui/waveformPanel.js';
import { getTransportBar } from './ui/transportBar.js';
import { getTabs } from './ui/tabs.js';
import { getTimeline } from './timeline.js';
import { getTimelineSections } from './ui/timelineSections.js';
import { initDragDrop } from './ui/dragDrop.js';
import { getModal } from './ui/modal.js';
import { getSongLoader } from './ui/songLoader.js';
import * as Manifest from './manifest.js';
import * as cacheManager from './cache/cacheManager.js';

class App {
    constructor() {
        this.initialized = false;
    }

    async init() {
        console.log('Initializing Worship Practice App...');

        try {
            // Check browser support for required APIs (OPFS, IndexedDB)
            if (!cacheManager.isSupported()) {
                this.showUnsupportedBrowser();
                return;
            }
            
            // Initialize cache system (OPFS for audio, IndexedDB for peaks)
            const cacheStatus = await cacheManager.init();
            if (!cacheStatus.supported) {
                console.warn('Cache initialization incomplete:', cacheStatus);
            }
            
            // Initialize storage
            await Storage.initDatabase();
            
            // Load manifest for song/track information
            await Manifest.loadManifest();
            
            // Initialize UI components
            this.initUI();
            
            // Initialize audio engine
            const transport = getTransport();
            await transport.init();
            
            // Load saved state
            await this.loadSavedState();
            
            // Set up keyboard shortcuts
            this.setupKeyboardShortcuts();
            
            // Set up auto-save
            this.setupAutoSave();
            
            // Set up loading overlay
            this.setupLoadingOverlay();
            
            // Set up cache indicator
            this.setupCacheIndicator();
            
            // Update empty states
            this.updateEmptyStates();
            
            this.initialized = true;
            console.log('App initialized successfully');
            
        } catch (error) {
            console.error('Failed to initialize app:', error);
            this.showInitError(error);
        }
    }

    initUI() {
        // Initialize UI modules
        getTrackPanel();
        getWaveformPanel();
        getTransportBar();
        getTabs();
        getTimeline();
        getTimelineSections(); // Phase 3: Timeline-based arrangement sections
        initDragDrop();
        getModal();
        getSongLoader();
        
        // Help button
        const helpBtn = document.getElementById('help-btn');
        if (helpBtn) {
            helpBtn.addEventListener('click', () => {
                const modal = getModal();
                modal.showHelp();
            });
        }
    }

    async loadSavedState() {
        const savedState = Storage.loadState();
        
        // Migrate section mutes to top-level state.sectionMutes structure
        if (savedState) {
            // Ensure top-level sectionMutes exists
            if (!savedState.sectionMutes) {
                savedState.sectionMutes = {};
            }
            
            // Migrate from old song.trackSectionMutes to top-level sectionMutes
            savedState.songs?.forEach(song => {
                const songName = song.songName;
                
                // Migrate song.trackSectionMutes if present
                if (song.trackSectionMutes && Object.keys(song.trackSectionMutes).length > 0) {
                    if (!savedState.sectionMutes[songName]) {
                        savedState.sectionMutes[songName] = {};
                    }
                    // Merge song-level mutes into top-level (song-level takes precedence)
                    Object.entries(song.trackSectionMutes).forEach(([trackFileName, mutes]) => {
                        savedState.sectionMutes[songName][trackFileName] = {
                            ...savedState.sectionMutes[songName][trackFileName],
                            ...mutes
                        };
                    });
                    delete song.trackSectionMutes;
                }
                
                // Also migrate old track.sectionMutes if present (legacy format)
                song.tracks?.forEach(track => {
                    if (track.sectionMutes && Object.keys(track.sectionMutes).length > 0) {
                        const parts = track.filePath?.split('/');
                        const trackFileName = parts ? decodeURIComponent(parts[parts.length - 1]) : null;
                        
                        if (trackFileName && songName) {
                            if (!savedState.sectionMutes[songName]) {
                                savedState.sectionMutes[songName] = {};
                            }
                            savedState.sectionMutes[songName][trackFileName] = {
                                ...savedState.sectionMutes[songName][trackFileName],
                                ...track.sectionMutes
                            };
                        }
                        delete track.sectionMutes;
                    }
                });
            });
        }
        
        if (savedState && savedState.songs && savedState.songs.length > 0) {
            console.log('Restoring saved state...');
            State.setLoading(true, 'Restoring session...');
            
            try {
                // Load state
                State.loadState(savedState);
                
                // Load metadata for all restored songs (needed for sections, timeline markers, etc.)
                // Do this before loading tracks so sections can be derived properly
                for (const song of State.state.songs) {
                    const metadata = await Metadata.loadMetadata(song.songName);
                    if (metadata) {
                        State.updateSongMetadata(song.id, metadata);
                    }
                }
                
                // Load tracks for active song
                const activeSong = State.getActiveSong();
                if (activeSong) {
                    await TrackManager.loadTracksForSong(activeSong);
                }
                
                // Note: cleanupOrphanedBlobs removed - no longer storing blobs
                
            } catch (error) {
                console.error('Failed to restore state:', error);
                // Start fresh - show empty state, let user select a song
                State.resetState();
            } finally {
                State.setLoading(false);
            }
        } else {
            // No saved state - show empty state, let user select a song from manifest
            console.log('No saved state, showing empty state...');
        }
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in inputs
            if (e.target.tagName === 'INPUT' || 
                e.target.tagName === 'TEXTAREA' || 
                e.target.contentEditable === 'true') {
                return;
            }

            const transport = getTransport();

            // Space: Play/Stop toggle
            if (e.code === 'Space' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                transport.togglePlayStop();
            }

            // Ctrl+Space: Pause toggle
            if (e.code === 'Space' && e.ctrlKey) {
                e.preventDefault();
                transport.pause();
            }

            // Delete: Delete selected track
            if (e.code === 'Delete' || e.code === 'Backspace') {
                const selectedTrackId = State.state.ui.selectedTrackId;
                if (selectedTrackId) {
                    e.preventDefault();
                    TrackManager.deleteTrack(selectedTrackId);
                }
            }

            // Ctrl+N: New song
            if (e.code === 'KeyN' && e.ctrlKey) {
                e.preventDefault();
                SongManager.createSong();
            }

            // Ctrl+W: Close current song
            if (e.code === 'KeyW' && e.ctrlKey) {
                e.preventDefault();
                const activeSong = State.getActiveSong();
                if (activeSong) {
                    SongManager.closeSong(activeSong.id);
                }
            }

            // Home: Go to start
            if (e.code === 'Home') {
                e.preventDefault();
                transport.seek(0);
            }

            // Arrow keys for transport
            if (e.code === 'ArrowLeft' && !e.ctrlKey) {
                e.preventDefault();
                const song = State.getActiveSong();
                if (song) {
                    const step = e.shiftKey ? 10 : 1;
                    transport.seek(Math.max(0, song.transport.position - step));
                }
            }

            if (e.code === 'ArrowRight' && !e.ctrlKey) {
                e.preventDefault();
                const song = State.getActiveSong();
                if (song) {
                    const step = e.shiftKey ? 10 : 1;
                    transport.seek(song.transport.position + step);
                }
            }

            // Escape: Clear loop points (only if no modal is open)
            // Clears loop regardless of whether looping is enabled
            if (e.code === 'Escape') {
                const modalOverlay = document.getElementById('modal-overlay');
                const isModalOpen = modalOverlay && !modalOverlay.classList.contains('hidden');
                
                // Check if there are any loop points to clear
                const loopState = State.getLoopState();
                const hasLoopPoints = loopState.start !== null || loopState.end !== null;
                
                if (!isModalOpen && hasLoopPoints) {
                    e.preventDefault();
                    State.clearLoop();
                }
            }
        });
    }

    setupAutoSave() {
        // Save on any state change (debounced)
        State.subscribe(State.Events.STATE_CHANGED, () => {
            this.saveState();
        });

        // Save before page unload
        window.addEventListener('beforeunload', () => {
            this.saveStateImmediate();
        });
    }

    saveState() {
        Storage.debouncedSaveState(State.getSerializableState());
    }

    saveStateImmediate() {
        Storage.saveState(State.getSerializableState());
    }

    setupLoadingOverlay() {
        const overlay = document.getElementById('loading-overlay');
        const message = document.getElementById('loading-message');

        State.subscribe(State.Events.LOADING_STATE_CHANGED, ({ isLoading, message: msg }) => {
            overlay.classList.toggle('hidden', !isLoading);
            message.textContent = msg;
        });
    }

    updateEmptyStates() {
        const trackEmpty = document.getElementById('track-controls-empty');
        const waveformEmpty = document.getElementById('waveform-empty');
        
        const updateVisibility = () => {
            const song = State.getActiveSong();
            const hasTracks = song && song.tracks && song.tracks.length > 0;
            
            if (trackEmpty) trackEmpty.classList.toggle('hidden', hasTracks);
            if (waveformEmpty) waveformEmpty.classList.toggle('hidden', hasTracks);
        };

        // Update on track changes
        State.subscribe(State.Events.TRACK_ADDED, updateVisibility);
        State.subscribe(State.Events.TRACK_REMOVED, updateVisibility);
        State.subscribe(State.Events.SONG_SWITCHED, updateVisibility);
        State.subscribe(State.Events.STATE_LOADED, updateVisibility);

        // Initial update
        updateVisibility();
    }

    showInitError(error) {
        const modal = getModal();
        modal.alert({
            title: 'Initialization Error',
            message: `<p>Failed to initialize the application:</p><p><code>${error.message}</code></p><p>Please refresh the page to try again.</p>`
        });
    }

    showUnsupportedBrowser() {
        // Hide loading overlay if visible
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.add('hidden');
        
        // Show unsupported browser message
        const app = document.getElementById('app');
        app.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 20px; text-align: center; background: var(--bg-primary); color: var(--text-primary);">
                <svg viewBox="0 0 24 24" width="64" height="64" style="margin-bottom: 20px; opacity: 0.5;">
                    <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                <h1 style="margin-bottom: 10px; font-size: 24px;">Browser Not Supported</h1>
                <p style="margin-bottom: 20px; max-width: 400px; color: var(--text-secondary);">
                    This app requires a modern browser with file system support for caching audio files.
                </p>
                <p style="color: var(--text-tertiary); font-size: 14px;">
                    Please use one of the following browsers:
                </p>
                <ul style="list-style: none; padding: 0; margin-top: 10px; color: var(--text-secondary);">
                    <li>Chrome 86+</li>
                    <li>Edge 86+</li>
                    <li>Firefox 111+</li>
                    <li>Safari 15.2+</li>
                </ul>
            </div>
        `;
    }

    setupCacheIndicator() {
        const indicator = document.getElementById('cache-indicator');
        const usageText = document.getElementById('cache-usage');
        
        if (!indicator || !usageText) return;
        
        const updateUsage = async () => {
            try {
                const stats = await cacheManager.getStorageStats();
                usageText.textContent = `${stats.usedFormatted} / ${stats.quotaFormatted}`;
            } catch (error) {
                console.warn('Failed to update cache indicator:', error);
            }
        };
        
        // Initial update
        updateUsage();
        
        // Update on cache changes
        cacheManager.onCacheUpdate(updateUsage);
        
        // Also update periodically (every 30 seconds)
        setInterval(updateUsage, 30000);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});

// Handle user gesture for audio context
document.addEventListener('click', async () => {
    const audioEngine = getAudioEngine();
    await audioEngine.resume();
}, { once: true });

export default App;

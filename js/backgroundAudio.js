/**
 * Background Audio Support
 * Enables audio playback on iOS/Safari when the screen is locked or app is backgrounded.
 *
 * Two subsystems:
 * 1. Media Session API - lock screen controls and metadata
 * 2. Screen Wake Lock API - prevents screen dimming during playback
 *
 * Background audio privileges are provided by the AudioEngine's MediaStreamDestination
 * routing real audio through an <audio> element (see audioEngine.js).
 */

import * as State from './state.js';
import { getTransport } from './transport.js';
import { getAudioEngine } from './audioEngine.js';

class BackgroundAudioSupport {
    constructor() {
        this.wakeLock = null;
        this.positionInterval = null;
    }

    init() {
        this.initMediaSession();
        this.attachStateListeners();
        console.log('Background audio support initialized');
    }

    // ── 1. Media Session API ─────────────────────────────────────────

    initMediaSession() {
        if (!('mediaSession' in navigator)) return;

        const transport = getTransport();
        const audioEngine = getAudioEngine();

        const handlers = {
            play: () => transport.play(),
            pause: () => audioEngine.pause(),   // Direct pause, no toggle
            stop: () => transport.stop(),
            seekforward: () => {
                const song = State.getActiveSong();
                if (song) transport.seek(song.transport.position + 10);
            },
            seekbackward: () => {
                const song = State.getActiveSong();
                if (song) transport.seek(Math.max(0, song.transport.position - 10));
            },
        };

        for (const [action, handler] of Object.entries(handlers)) {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (e) {
                // Action not supported on this browser
            }
        }
    }

    updateMediaMetadata(songName) {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: songName || 'Worship Practice',
            artist: 'Worship Practice App',
        });
    }

    updatePositionState() {
        if (!('mediaSession' in navigator)) return;
        const song = State.getActiveSong();
        if (!song || !song.tracks.length) return;

        const duration = Math.max(...song.tracks.map(t => t.duration || 0));
        if (duration <= 0) return;

        try {
            navigator.mediaSession.setPositionState({
                duration,
                playbackRate: song.transport.speed || 1,
                position: Math.min(song.transport.position || 0, duration),
            });
        } catch (e) {
            // Can throw if position > duration due to timing
        }
    }

    startPositionUpdates() {
        this.stopPositionUpdates();
        this.positionInterval = setInterval(() => this.updatePositionState(), 1000);
    }

    stopPositionUpdates() {
        if (this.positionInterval) {
            clearInterval(this.positionInterval);
            this.positionInterval = null;
        }
    }

    // ── 2. Screen Wake Lock API ──────────────────────────────────────

    async requestWakeLock() {
        if (!('wakeLock' in navigator)) return;
        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.wakeLock.addEventListener('release', () => {
                this.wakeLock = null;
            });
        } catch (e) {
            // Can fail on low battery or if not visible
        }
    }

    async releaseWakeLock() {
        if (this.wakeLock) {
            try { await this.wakeLock.release(); } catch (e) {}
            this.wakeLock = null;
        }
    }

    // ── State Integration ────────────────────────────────────────────

    attachStateListeners() {
        State.subscribe(State.Events.PLAYBACK_STATE_CHANGED, ({ newState }) => {
            if (newState === 'playing') {
                this.updateMediaMetadata(State.getActiveSong()?.name);
                this.updatePositionState();
                this.startPositionUpdates();
                this.requestWakeLock();
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'playing';
                }
            } else {
                this.stopPositionUpdates();
                this.releaseWakeLock();
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = newState === 'paused' ? 'paused' : 'none';
                }
            }
        });

        State.subscribe(State.Events.SONG_SWITCHED, (song) => {
            if (song) {
                this.updateMediaMetadata(song.name);
            }
        });

        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden) {
                // Re-acquire wake lock (auto-released when backgrounded)
                if (State.state.playbackState === 'playing') {
                    this.requestWakeLock();
                }
                // Resume audio context if suspended
                const audioEngine = getAudioEngine();
                await audioEngine.resume();
            }
        });
    }
}

// Singleton
let instance = null;

export function getBackgroundAudioSupport() {
    if (!instance) {
        instance = new BackgroundAudioSupport();
    }
    return instance;
}

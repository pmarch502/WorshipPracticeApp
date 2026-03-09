/**
 * Background Audio Support
 * Enables audio playback on iOS/Safari when the screen is locked or app is backgrounded.
 *
 * Three subsystems:
 * 1. Silent <audio> element keepalive - tricks iOS into granting background audio privileges
 * 2. Media Session API - lock screen controls and metadata
 * 3. Screen Wake Lock API - prevents screen dimming during playback
 */

import * as State from './state.js';
import { getTransport } from './transport.js';
import { getAudioEngine } from './audioEngine.js';

// Tiny silent WAV (44 bytes of audio data, ~100ms)
const SILENT_WAV_BASE64 = 'data:audio/wav;base64,' +
    'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

class BackgroundAudioSupport {
    constructor() {
        this.silentAudio = null;
        this.primed = false;
        this.wakeLock = null;
        this.positionInterval = null;
    }

    init() {
        this.createSilentAudio();
        this.primeOnUserGesture();
        this.initMediaSession();
        this.attachStateListeners();
        console.log('Background audio support initialized');
    }

    // ── 1. Silent <audio> Keepalive ──────────────────────────────────

    createSilentAudio() {
        this.silentAudio = document.createElement('audio');
        this.silentAudio.src = SILENT_WAV_BASE64;
        this.silentAudio.loop = true;
        // Prevent iOS from showing native player UI
        this.silentAudio.setAttribute('playsinline', '');
    }

    primeOnUserGesture() {
        const prime = () => {
            if (this.primed) return;
            const p = this.silentAudio.play();
            if (p && p.then) {
                p.then(() => {
                    this.silentAudio.pause();
                    this.primed = true;
                }).catch(() => {
                    // Priming failed — will retry on next gesture via playSilent
                });
            } else {
                this.silentAudio.pause();
                this.primed = true;
            }
        };
        document.addEventListener('click', prime, { once: true });
        document.addEventListener('touchend', prime, { once: true });
    }

    playSilent() {
        if (!this.silentAudio) return;
        const p = this.silentAudio.play();
        if (p && p.then) {
            p.then(() => { this.primed = true; }).catch(() => {});
        }
    }

    pauseSilent() {
        if (!this.silentAudio) return;
        this.silentAudio.pause();
    }

    // ── 2. Media Session API ─────────────────────────────────────────

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

    // ── 3. Screen Wake Lock API ──────────────────────────────────────

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
                this.playSilent();
                this.updateMediaMetadata(State.getActiveSong()?.name);
                this.updatePositionState();
                this.startPositionUpdates();
                this.requestWakeLock();
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'playing';
                }
            } else {
                this.pauseSilent();
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

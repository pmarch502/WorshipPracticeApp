/**
 * SoundTouch JS - Audio time-stretching and pitch-shifting library
 * 
 * This module provides the PitchShifterWorklet class that wraps the
 * SoundTouchJS AudioWorklet for real-time pitch shifting and time stretching.
 * 
 * Uses the production-quality SoundTouchJS library:
 * https://github.com/cutterbl/soundtouchjs-audio-worklet
 */

(function(global) {
    'use strict';

    /**
     * PitchShifterWorklet - Modern AudioWorklet-based pitch shifter
     * 
     * Uses the SoundTouchJS AudioWorklet for high-quality time stretching
     * and pitch shifting with the WSOLA algorithm including correlation search.
     * 
     * Parameters are controlled via AudioParam for real-time automation:
     * - tempo: Time stretching factor (0.25 to 4.0, default 1.0)
     * - pitch: Pitch multiplier (0.25 to 4.0, default 1.0)
     * - pitchSemitones: Pitch shift in semitones (-24 to +24, default 0)
     * - rate: Combined rate (rarely used directly)
     */
    class PitchShifterWorklet {
        constructor(audioContext) {
            this.audioContext = audioContext;
            this.node = null;
            this._tempo = 1.0;
            this._pitch = 1.0;
            this._pitchSemitones = 0;
            this._ready = false;
            this._initPromise = null;
        }

        /**
         * Initialize the AudioWorklet
         * Must be called before using the pitch shifter
         */
        async init() {
            if (this._initPromise) {
                return this._initPromise;
            }
            
            this._initPromise = this._doInit();
            return this._initPromise;
        }

        async _doInit() {
            try {
                // Load the SoundTouchJS worklet processor module
                await this.audioContext.audioWorklet.addModule('js/lib/soundtouch-worklet.js');
                
                // Create the worklet node
                // The SoundTouchJS worklet registers as 'soundtouch-processor'
                this.node = new AudioWorkletNode(this.audioContext, 'soundtouch-processor', {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [2]
                });
                
                this._ready = true;
                console.log('PitchShifterWorklet initialized with SoundTouchJS');
                
                return true;
            } catch (error) {
                console.error('Failed to initialize PitchShifterWorklet:', error);
                throw error;
            }
        }

        get ready() {
            return this._ready;
        }

        get inputNode() {
            return this.node;
        }

        get outputNode() {
            return this.node;
        }

        /**
         * Tempo (time stretch factor)
         * 1.0 = normal speed
         * < 1.0 = slower (e.g., 0.75 = 75% speed)
         * > 1.0 = faster (e.g., 1.5 = 150% speed)
         */
        get tempo() {
            return this._tempo;
        }

        set tempo(value) {
            this._tempo = value;
            if (this.node) {
                this.node.parameters.get('tempo').value = value;
            }
        }

        /**
         * Pitch multiplier
         * 1.0 = normal pitch
         * < 1.0 = lower pitch
         * > 1.0 = higher pitch
         */
        get pitch() {
            return this._pitch;
        }

        set pitch(value) {
            this._pitch = value;
            if (this.node) {
                this.node.parameters.get('pitch').value = value;
            }
        }

        /**
         * Pitch shift in semitones
         * 0 = normal pitch
         * Positive = higher pitch (e.g., +2 = up a whole step)
         * Negative = lower pitch (e.g., -2 = down a whole step)
         */
        get pitchSemitones() {
            return this._pitchSemitones;
        }

        set pitchSemitones(semitones) {
            this._pitchSemitones = semitones;
            // Convert semitones to pitch multiplier for internal tracking
            this._pitch = Math.pow(2, semitones / 12);
            if (this.node) {
                // The SoundTouchJS worklet has a pitchSemitones parameter
                this.node.parameters.get('pitchSemitones').value = semitones;
            }
        }

        /**
         * Clear internal buffers
         * Note: The SoundTouchJS worklet manages its own buffers internally.
         * This method is kept for API compatibility but the worklet handles
         * buffer management automatically.
         */
        clear() {
            // SoundTouchJS worklet handles buffer management internally
            // No explicit clear needed - the worklet processes in real-time
        }

        /**
         * Connect the output to a destination
         */
        connect(destination) {
            if (this.node) {
                this.node.connect(destination);
            }
        }

        /**
         * Disconnect the output
         */
        disconnect() {
            if (this.node) {
                this.node.disconnect();
            }
        }
    }

    // Export to global scope
    global.PitchShifterWorklet = PitchShifterWorklet;

})(typeof window !== 'undefined' ? window : global);

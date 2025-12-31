/**
 * Song Loader - DEPRECATED
 * This module is no longer used. Songs are now loaded from the manifest system.
 */

export function getSongLoader() {
    // No-op: return a stub object
    console.log('Song loader disabled - use manifest-based loading');
    return {
        show: () => {},
        hide: () => {}
    };
}

# Sections & Arrangements Feature - Progress Tracker

## Overview
Adding section-based features to the Worship Practice App:
1. **Phase 1**: Derive sections from markers + visual section dividers on waveforms
2. **Phase 2**: Per-section muting (per track, per user - stored in IndexedDB)
3. **Phase 3**: Arrangements (reorder sections, defined in metadata.json)

## Current Phase: Phase 1 - Section Derivation & Visual Dividers (COMPLETE)

### Data Model

**Sections** (derived at runtime from markers):
```javascript
song.sections = [
  { index: 0, name: "Count", start: 0, end: 4.5, duration: 4.5 },
  { index: 1, name: "Intro", start: 4.5, end: 12.3, duration: 7.8 },
  // ...
]
```

**Future - Arrangements** (in metadata.json):
```javascript
arrangements: [
  {
    name: "Default",
    sections: null  // use markers in order
  },
  {
    name: "Short Version",
    sections: [
      { marker: 0 },  // Count
      { marker: 1 },  // Intro
      { marker: 3 },  // Chorus 1 (skip Verse 1)
      // ...
    ]
  }
]
```

**Future - Section Mutes** (in IndexedDB per-user state):
```javascript
track.sectionMutes = { 2: true, 5: true }  // mute sections by marker index
```

---

## Implementation Tasks

### Phase 1 Tasks

- [x] **Task 1**: Create `js/sections.js` - section derivation module
  - `deriveSections(markers, totalDuration)` - returns sections array
  - `getSectionAtTime(sections, time)` - utility for later phases
  - `getSectionByIndex(sections, index)` - utility
  - `getSectionBoundaries(sections)` - returns start times for divider rendering

- [x] **Task 2**: Integrate into `js/state.js` and `js/trackManager.js`
  - Added `sections: []` to `createDefaultSong()`
  - Added `updateSongSections(songId)` function to state.js
  - Called from `updateSongMetadata()` when metadata loads
  - Called from `trackManager.addTracksFromManifest()` after all tracks loaded
  - Called from `trackManager.loadTracksForSong()` after all tracks loaded
  - NOT called from `addTrack()` (avoids N calls when loading N tracks)

- [x] **Task 3**: Add `renderSectionDividers()` to `js/waveform.js`
  - Draw vertical lines at section boundaries
  - Color: `rgba(255, 255, 0, 0.4)` (matches marker color, more visible)
  - Skip first section (no divider at position 0)

- [x] **Task 4**: Call dividers from `js/ui/waveformPanel.js`
  - In `drawWaveform()`, after rendering waveform gradient
  - Pass sections, zoom, scroll offset, etc.

- [x] **Task 5**: Fix timing/state restoration issues
  - Added `SECTIONS_UPDATED` event to state.js
  - `updateSongSections()` now emits the event when sections are derived
  - `waveformPanel.js` subscribes to `SECTIONS_UPDATED` and redraws waveforms
  - `main.js loadSavedState()` now loads metadata for all restored songs before loading tracks

- [ ] **Task 6**: Test with a song that has markers

---

## Design Decisions

1. **Section divider style**: Simple vertical line, no gaps, no rounded corners (keep it simple for now)
2. **Divider color**: `rgba(255, 255, 0, 0.4)` - yellow to match markers, 40% opacity
3. **Muted sections**: Will be grayed out (same as muted tracks) - consistent visual language
4. **No section names on waveforms**: Timeline marker labels are sufficient
5. **Arrangements in metadata, mutes in IndexedDB**: Arrangements are shared (band-level), mutes are personal (user-level)
6. **First marker always at time 0**: No implicit "pre-marker" section

---

## Files Modified/Created

| File | Status | Notes |
|------|--------|-------|
| `js/sections.js` | Created | New module for section derivation |
| `js/state.js` | Modified | Added sections array, updateSongSections(), SECTIONS_UPDATED event |
| `js/trackManager.js` | Modified | Call updateSongSections() after batch track loading |
| `js/waveform.js` | Modified | Added renderSectionDividers(), SECTION_DIVIDER_COLOR |
| `js/ui/waveformPanel.js` | Modified | Call section dividers in drawWaveform(), subscribe to SECTIONS_UPDATED |
| `js/main.js` | Modified | Load metadata for all songs during state restoration |

---

## Session Notes

### Session 1 (Current)
- Brainstormed feature requirements
- Decided on data model (sections derived from markers, arrangements in metadata, mutes in IndexedDB)
- Phase 1 implementation complete:
  - Created `js/sections.js` with section derivation functions
  - Integrated section derivation into state management (triggered on metadata load and track add)
  - Added visual section dividers to waveform rendering
- **Next step**: Test with a song that has markers to verify dividers appear correctly

### Key Implementation Details
- Sections are derived when EITHER metadata loads OR tracks are added (whichever provides the necessary data last)
- Section dividers render at `section.start` for all sections except index 0 (no divider at time 0)
- Divider color matches marker color family (yellow) but more visible (0.4 alpha vs 0.1)

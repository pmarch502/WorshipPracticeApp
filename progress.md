# Sections & Arrangements Feature - Progress Tracker

## Overview
Adding section-based features to the Worship Practice App:
1. **Phase 1**: Derive sections from markers + visual section dividers on waveforms
2. **Phase 2**: Per-section muting (per track, per user - stored in localStorage)
3. **Phase 3**: Arrangements (reorder sections, defined in metadata.json)

## Current Phase: Phase 3 - Arrangements (COMPLETE)

### Data Model

**Sections** (derived at runtime from markers):
```javascript
song.sections = [
  { index: 0, name: "Count", start: 0, end: 4.5, duration: 4.5 },
  { index: 1, name: "Intro", start: 4.5, end: 12.3, duration: 7.8 },
  // ...
]
```

**Section Mutes** (in localStorage at top-level state):
```javascript
// Stored at state.sectionMutes (not on song object)
// Keyed by songName -> trackFileName -> sectionIndex
state.sectionMutes = {
  "Trust In God": {
    "reference.mp3": { 2: true, 5: true }
  }
}
```

**Arrangements** (in metadata.json):
```javascript
// "Default" is always available (plays all sections in order)
// Only define arrangements for custom orderings
"arrangements": [
  {"name": "Shortened", "sections": [0,1,2,3,4,5,6,7,8,9,10,11,12,13,22,23,24]}
]
// Sections can repeat: [0,1,2,3,2,3,14,15] plays sections 2 and 3 twice
```

**Virtual Sections** (derived at runtime from arrangement):
```javascript
song.virtualSections = [
  { virtualIndex: 0, sourceIndex: 0, virtualStart: 0, virtualEnd: 4.5, sourceStart: 0, sourceEnd: 4.5, name: "Count", duration: 4.5 },
  { virtualIndex: 1, sourceIndex: 1, virtualStart: 4.5, virtualEnd: 12.3, sourceStart: 4.5, sourceEnd: 12.3, name: "Intro", duration: 7.8 },
  // If sections repeat, they appear as separate virtual sections
  { virtualIndex: 4, sourceIndex: 2, virtualStart: 25.0, virtualEnd: 35.5, sourceStart: 10.0, sourceEnd: 20.5, name: "Verse 1", duration: 10.5 },
  // ...
]
song.virtualDuration = 180.5; // Total duration of virtual timeline
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

- [x] **Task 6**: Test with a song that has markers

---

### Phase 2 Tasks

- [x] **Task 1**: State & Data Model
  - Added `sectionMutes: {}` to top-level `initialState` in state.js
  - Added `SECTION_MUTE_UPDATED` event
  - Added helper functions: `toggleSectionMute()`, `isSectionMuted()`, `getSectionMutesForTrack()`

- [x] **Task 2**: Storage
  - `sectionMutes` stored at top-level state (keyed by songName)
  - Added `sectionMutes` to `getSerializableState()`
  - Migration code in `main.js` handles old `song.trackSectionMutes` and `track.sectionMutes` formats

- [x] **Task 3**: Audio Engine Integration
  - Added `trackSectionState` Map to track section mute state per track
  - Added `updateSectionMuteForTrack()` - applies gain changes with 50ms fade ramps
  - Added `updateAllSectionMutes()` - called in position update loop
  - Added `applySectionMuteChange()` - called when user toggles section mute
  - Modified `startTrack()` to check section mutes on initial play
  - Modified `updateTrackAudibility()` to consider section mutes
  - Clears section state on stop/pause

- [x] **Task 4**: Waveform Rendering
  - Modified `renderWaveformGradient()` to accept `sections` and `sectionMutes` options
  - Added `renderBarWaveformWithSections()` for section-aware bar rendering
  - Added `renderSmoothWaveformWithSections()` for section-aware smooth rendering
  - Muted sections render with INACTIVE_COLOR gradient

- [x] **Task 5**: Section Mute Buttons (DOM)
  - Added `sectionMuteContainers` Map to waveformPanel.js
  - Created `.section-mute-container` inside each `.waveform-track`
  - Added `renderSectionMuteButtons()` - creates M buttons for each section
  - Added `updateSectionMuteButtonPositions()` - positions buttons based on zoom/scroll
  - Buttons are repositioned on scroll and zoom changes

- [x] **Task 6**: CSS Styling
  - Added `.section-mute-container` - positioned absolute, pointer-events: none
  - Added `.section-mute-btn` - 18x18px, opacity: 0 by default
  - Shows on `.waveform-track:hover` with opacity: 0.7
  - Active state: red background matching track mute button
  - Always visible when active (muted)

- [x] **Task 7**: Event Wiring
  - Button clicks call `State.toggleSectionMute()`
  - `SECTION_MUTE_UPDATED` event triggers:
    - Waveform redraw (grays out section)
    - Button state update (active class)
    - Audio engine gain update (with fade)
  - `SECTIONS_UPDATED` recreates all section mute buttons

- [x] **Task 8**: Fix persistence across song close/reopen (Session 3)

---

### Phase 3 Tasks

- [x] **Task 1**: State & Data Model
  - Added `arrangement: { name: 'Default' }` to `createDefaultSong()`
  - Added `virtualSections: []` and `virtualDuration: 0` to song object
  - Added `ARRANGEMENT_CHANGED` event
  - Added functions: `setArrangement()`, `getAvailableArrangements()`, `updateVirtualSections()`, `getCurrentArrangement()`
  - `updateSongSections()` now also calls `updateVirtualSections()`

- [x] **Task 2**: Position Mapping Utilities (in sections.js)
  - `deriveVirtualSections(sections, arrangementIndices)` - creates virtual timeline mapping
  - `getVirtualDuration(virtualSections)` - total virtual timeline length
  - `getVirtualSectionAtTime(virtualSections, virtualTime)` - find section at time
  - `virtualToSourcePosition(virtualTime, virtualSections)` - convert virtual to source time
  - `sourceToVirtualPosition(sourceTime, virtualSections, hint)` - convert source to virtual time
  - `getNextVirtualSection(virtualSections, index)` - get next section for transitions
  - `requiresSeekTransition(fromSection, toSection)` - check if crossfade needed

- [x] **Task 3**: Arrangement Dropdown UI
  - Added `<select id="arrangement-select">` in transport bar (far right)
  - Always shows "Default" option + any arrangements from metadata
  - Dropdown updates when song switches or metadata loads
  - On change: calls `State.setArrangement()`

- [x] **Task 4**: Waveform Rendering
  - Added `renderVirtualWaveform()` - draws slices of source waveform at virtual positions
  - Added `renderVirtualSectionDividers()` - draws dividers between virtual sections
  - `drawWaveform()` uses virtual rendering when arrangement active
  - Section mute buttons positioned at virtual section starts

- [x] **Task 5**: Timeline Rendering
  - Added `getVirtualBeatPositions()` - generates beats for virtual timeline with continuous measure numbers
  - `renderBeatsTimeline()` uses virtual beat positions when arrangement active
  - `renderMarkers()` shows markers at virtual section positions (repeated sections show multiple markers)
  - Subscribed to `ARRANGEMENT_CHANGED` to re-render

- [x] **Task 6**: Playhead & Seeking
  - Playhead positioned using virtual time (already works via state.position)
  - Click-to-seek converts to virtual time (audio engine handles conversion to source)

- [x] **Task 7**: Audio Engine
  - Tracks `currentVirtualSectionIndex` during playback
  - `play()` converts virtual position to source position
  - `getCurrentPosition()` returns virtual time (for UI)
  - `getCurrentSourcePosition()` returns source time (for audio operations)
  - `seek()` accepts virtual position, converts internally
  - `seekWithCrossfade()` for smooth transitions between non-consecutive sections
  - Position update loop detects section boundaries and triggers crossfade when needed
  - Section mute checking uses `virtualSection.sourceIndex`

- [x] **Task 8**: Loop Behavior
  - Loop start/end are in virtual time
  - Looping triggers seek (with crossfade if needed)
  - Loop clears when arrangement changes

- [x] **Task 9**: Section Mutes Integration
  - Mutes still keyed by source section index
  - All instances of a muted section appear muted in arrangement
  - Buttons show per virtual instance but toggle source section

- [x] **Task 10**: Persistence
  - `arrangement.name` included in serialized state
  - Migration adds `arrangement` property to old saved states
  - Virtual sections recalculated when metadata loads

---

## Design Decisions

1. **Section divider style**: Simple vertical line, no gaps, no rounded corners (keep it simple for now)
2. **Divider color**: `rgba(255, 255, 0, 0.4)` - yellow to match markers, 40% opacity
3. **Muted sections**: Will be grayed out (same as muted tracks) - consistent visual language
4. **No section names on waveforms**: Timeline marker labels are sufficient
5. **Arrangements in metadata, mutes in localStorage**: Arrangements are shared (band-level), mutes are personal (user-level)
6. **First marker always at time 0**: No implicit "pre-marker" section
7. **Section mutes tied to marker index**: Mute is per-section identity (e.g., "Chorus 1"), not per-arrangement position. If Chorus 1 is muted, it's muted every time it appears in any arrangement.
8. **Section mute button visibility**: Visible on hover over track row, always visible when active (muted)
9. **Audio fade**: 50ms smooth fade for section mute transitions to avoid clicks
10. **Section mutes at top-level state**: Stored at `state.sectionMutes[songName][trackFileName]` to survive song close/reopen cycles
11. **Virtual timeline for arrangements**: UI always shows virtual time; audio engine converts to source time internally
12. **Crossfade on non-consecutive sections**: 50ms crossfade when transitioning between sections that aren't contiguous in source audio
13. **Measure numbers continue across sections**: No restart when sections repeat; measure 1, 2, 3... continues incrementally
14. **Arrangement dropdown always visible**: Shows "Default" even when no custom arrangements defined
15. **No gaps between sections**: Virtual timeline is seamless edge-to-edge

---

## Files Modified/Created

| File | Status | Notes |
|------|--------|-------|
| `js/sections.js` | Created | New module for section derivation |
| `js/state.js` | Modified | Added sections array, top-level sectionMutes, section mute helpers, events |
| `js/trackManager.js` | Modified | Call updateSongSections() after batch track loading |
| `js/waveform.js` | Modified | Added renderSectionDividers(), section-aware waveform rendering |
| `js/ui/waveformPanel.js` | Modified | Section dividers, section mute buttons, event subscriptions |
| `js/audioEngine.js` | Modified | Section-aware gain control with fade ramps |
| `js/main.js` | Modified | Load metadata for all songs during state restoration, migration code |
| `js/storage.js` | Modified | No changes needed (sectionMutes serialized via getSerializableState) |
| `css/styles.css` | Modified | Section mute button styles |
| `js/ui/transportBar.js` | Modified | Arrangement dropdown UI |
| `js/timeline.js` | Modified | Virtual beat positions, arrangement-aware markers |
| `index.html` | Modified | Added arrangement dropdown |

---

## Session Notes

### Session 1
- Brainstormed feature requirements
- Decided on data model (sections derived from markers, arrangements in metadata, mutes in localStorage)
- Phase 1 implementation complete:
  - Created `js/sections.js` with section derivation functions
  - Integrated section derivation into state management (triggered on metadata load and track add)
  - Added visual section dividers to waveform rendering

### Session 2
- Tested Phase 1 - section dividers working correctly
- Phase 2 implementation complete:
  - Added `sectionMutes` property to tracks
  - Small mute buttons (18x18px) at top-left of each section on waveform
  - Buttons visible on hover over track row, always visible when muted (active)
  - Audio fades smoothly (50ms) when entering/exiting muted sections
  - Muted sections render with inactive (gray) waveform color
- **BUG FOUND**: Section mutes not persisting across app reload
  - Root cause: Track objects are recreated via `createDefaultTrack()` when reopening songs
  - This loses the `track.sectionMutes` data
- **REFACTOR**: Moved section mutes to song level, keyed by track filename
  - Added `song.trackSectionMutes = { "filename.mp3": { sectionIndex: true } }`
  - Updated helper functions to use filename-based lookup
  - Added migration for old track-level data
- **STILL FAILING**: Section mutes still not persisting when closing/reopening song tabs

### Session 3
- **ROOT CAUSE IDENTIFIED**: When closing a song tab and reopening from manifest:
  - `closeSong()` removes the song from state entirely
  - `openSong()` creates a brand new song via `createDefaultSong()` 
  - The `song.trackSectionMutes` data was lost because it was stored on the song object
- **FIX IMPLEMENTED**: Moved section mutes to top-level state
  - Added `state.sectionMutes = {}` at top level (not on song objects)
  - Structure: `state.sectionMutes[songName][trackFileName][sectionIndex] = true`
  - Mutes now keyed by `songName` (stable) instead of song ID (regenerated)
  - Updated `toggleSectionMute()`, `isSectionMuted()`, `getSectionMutesForTrack()` to use new location
  - Added `sectionMutes` to `getSerializableState()` for persistence
  - Added migration code in `main.js` to handle old `song.trackSectionMutes` format
- **VERIFIED**: Section mutes now persist across:
  - Browser reload
  - Song tab close/reopen

### Key Implementation Details
- Sections are derived when EITHER metadata loads OR tracks are added (whichever provides the necessary data last)
- Section dividers render at `section.start` for all sections except index 0 (no divider at time 0)
- Divider color matches marker color family (yellow) but more visible (0.4 alpha vs 0.1)
- Section mutes are tied to original marker index, not arrangement position
- Audio gain uses `setTargetAtTime` with timeConstant 0.015 for ~50ms fade
- **Section mutes stored at top-level state** (`state.sectionMutes[songName][trackFileName]`) - this ensures mutes survive song close/reopen since they're not tied to the song object lifecycle

### Session 4 (Phase 3)
- Implemented Arrangements feature (virtual timeline)
- Key architecture: **Two position spaces**
  - Virtual position: Time in the arrangement timeline (0 to virtualDuration)
  - Source position: Time in the actual audio file (0 to track duration)
  - UI shows virtual position; audio engine manages source position internally
- Arrangement format in metadata.json: `{"name": "Shortened", "sections": [0,1,2,3,22,23,24]}`
  - "Default" is implicit (all sections in order)
  - Sections can repeat: `[0,1,2,3,2,3,14]` plays sections 2 and 3 twice
- Virtual waveform rendering: Each virtual section shows its portion of source peaks
- Beat positions generated per-section with tempo from source positions
- Crossfade seeks (50ms) between non-consecutive sections
- Section mutes work with source index (muting a section mutes all its instances)

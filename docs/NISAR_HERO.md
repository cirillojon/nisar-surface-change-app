# NISAR home hero

The home page shows a time-lapse of NISAR L-band radar imagery from the Sylhet haor basin in Bangladesh. The date and open-water estimate appear below the map. The timeline bars show the relative open-water estimates, and selecting a pass pauses playback. The site link opens Sylhet in the Workspace.

`frontend/src/platform/HeroObservatory.jsx` loads the pass imagery and observations through the site API. The map reserves its space on refresh. During playback, the current image and date stay together until the next image finishes loading. If a pass image fails, the map shows an unavailable message and the timeline remains usable.

Playback suspends while the figure is offscreen or the tab is hidden. The time-lapse starts paused for users who prefer reduced motion.

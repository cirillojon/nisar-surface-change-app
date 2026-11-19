# Hero Earth

The hero uses the approved full-world Earth renderer, with raised NASA/GEBCO
terrain and the reduced atmospheric glow. `HeroEarth.jsx` loads Three.js on the
home page, supports pointer/keyboard rotation, and disposes GPU resources on
navigation. Rotation takes about 7.5 minutes per revolution; it pauses while
dragging, offscreen, or in a hidden tab. Reduced motion starts paused.

The live globe fades in only after its first complete frame. The reference
photograph is neither loaded nor shown during normal startup; it is reserved
for a WebGL/texture failure or lost GPU context. Six radar cards share the same
drag/collision behavior on desktop and phones; empty sky remains scrollable on
touch devices.

`hero-globe-layout.js` is the source of truth for the camera, CSS hit area, and
radar-card obstacle. Change its horizon/radius together; do not independently
move the canvas with CSS. `globe-obstacle.js` handles the rotated cards' bounding
boxes and clear return paths around both the globe and headline.

Runtime textures are local at `public/earth`. The phone uses a single WebGL pass
with its own baked surface palette and cloud density, a canvas capped at 1.25×,
and pre-uploaded regional detail. During the descent it draws the globe in the
same animation callback as the heading and fade. Earth is illustrative artwork.

Regenerate `public/earth/mobile` from the shipped world maps with
`python scripts/build_mobile_globe.py` from the repository root (NumPy and
Pillow). The original authoring pack remains in the sibling `nisar-earth-hero`
project. The runtime texture folders include attribution and source manifests.

Checks: `npx tsc --noEmit`, `npm run build`, `npm run lint`, `npm test`.

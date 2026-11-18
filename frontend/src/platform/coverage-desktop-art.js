const webps = import.meta.glob("./media/coverage/desktop/*.webp", {
  eager: true,
  import: "default",
  query: "?url",
});

// Desktop pack exports, ordered for cover-based selection.
const tiers = [
  { name: "1080p", width: 2300, height: 1840 },
  { name: "1440p", width: 2700, height: 2160 },
  { name: "4k", width: 4000, height: 3200 },
  { name: "4500master", width: 4500, height: 3600 },
];

function scene(name, position, focalY) {
  return {
    position,
    focalY,
    sources: tiers.map(({ name: tier, width, height }) => ({
      src: webps[`./media/coverage/desktop/${name}-${tier}.webp`],
      width,
      height,
    })),
  };
}

export default {
  // Use the vertical slack on wide screens to keep the observation footprint in view.
  ice: scene("glaciers", "56% 0%"),
  crops: scene("crops", "52% 0%"),
  floods: scene("wetlands", "54% 0%"),
  volcano: scene("volcanoes", "50% 35%"),
  landslides: scene("landslides", "55% 0%"),
  ground: scene("ground_motion", "50% 0%", 0.606),
};

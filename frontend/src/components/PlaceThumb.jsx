import { assetUrl } from "../services/api.js";

/**
 * A place's own NISAR pass, small, so a list row can be recognized at a
 * glance. The row's text already names the place, so the image is left out
 * of the accessible name; its date is in the tooltip.
 */
export default function PlaceThumb({ url, date }) {
  if (!url) return <span className="place-thumb place-thumb-empty" aria-hidden="true" />;
  return (
    <img
      className="place-thumb"
      src={assetUrl(url)}
      alt=""
      aria-hidden="true"
      title={date ? `NISAR image, ${date}` : "NISAR image"}
      width="44"
      height="44"
      loading="lazy"
      decoding="async"
    />
  );
}

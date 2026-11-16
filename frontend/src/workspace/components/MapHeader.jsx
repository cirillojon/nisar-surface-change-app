import { Icon } from "../../platform/icons.jsx";

/**
 * The bar above the map: the selection's title (the map's accessible name),
 * a story's question while its panel is closed, and the panel, Save view
 * and Tour buttons. The refs let the workspace move focus back here.
 */
export default function MapHeader({
  title,
  question,
  titleRef,
  panelButtonRef,
  tourButtonRef,
  panelOpen,
  showPanelLabel,
  onTogglePanel,
  canSaveView,
  onSaveView,
  touring,
  onTourClick,
}) {
  return (
    <section className="map-header" aria-label="Map controls">
      <div className="map-heading">
        <h1
          id="map-title"
          ref={titleRef}
          tabIndex={-1}
          className={title ? undefined : "visually-hidden"}
          title={title ?? undefined}
        >
          {title ?? "NISAR map"}
        </h1>
        {/* With the story panel closed, its question stays with the map. */}
        {question && <p title={question}>{question}</p>}
      </div>
      <div className="map-actions">
        <button
          type="button"
          ref={panelButtonRef}
          className="btn btn-secondary map-action panel-action"
          aria-label={panelOpen ? "Hide panel" : showPanelLabel}
          aria-controls="workspace-panel"
          aria-expanded={panelOpen}
          onClick={onTogglePanel}
        >
          <span className="panel-action-full">{panelOpen ? "Hide panel" : showPanelLabel}</span>
          <span className="panel-action-short" aria-hidden="true">Panel</span>
        </button>
        {/* Save what is on the map: a place on a date and layer, a drawn area or line. */}
        {canSaveView && (
          <button
            type="button"
            className="btn btn-secondary map-action"
            data-tour="save-view"
            title="Save what is on the map, with your own notes, to My findings"
            onClick={onSaveView}
          >
            Save view
          </button>
        )}
        <button
          type="button"
          ref={tourButtonRef}
          className="btn btn-secondary map-action tour-button"
          title={touring ? "End the guided tour" : "Take the guided tour (about 3 minutes)"}
          onClick={onTourClick}
        >
          <Icon name="compass" size={16} strokeWidth={2} />
          <span className="map-action-label">{touring ? "End tour" : "Tour"}</span>
        </button>
      </div>
    </section>
  );
}

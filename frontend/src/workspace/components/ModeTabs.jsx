import { MODES } from "../navigation.js";

/**
 * The sidebar's tabs (Stories, Investigate, My findings). Arrow keys, Home
 * and End move between them and switch to the tab reached (roving tabindex).
 */
export default function ModeTabs({ mode, onSwitch, findingsCount }) {
  const onKeyDown = (event, index) => {
    const count = MODES.length;
    const destinations = {
      ArrowLeft: (index + count - 1) % count,
      ArrowRight: (index + 1) % count,
      Home: 0,
      End: count - 1,
    };
    if (!Object.hasOwn(destinations, event.key)) return;
    event.preventDefault();
    const nextIndex = destinations[event.key];
    event.currentTarget.parentElement.children[nextIndex]?.focus({ preventScroll: true });
    onSwitch(MODES[nextIndex].id);
  };

  return (
    <div className="sidebar-tabs">
      <div className="mode-switch" role="tablist" aria-label="Workspace mode">
        {MODES.map((m, index) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            id={`mode-${m.id}`}
            className="mode-tab"
            tabIndex={mode === m.id ? 0 : -1}
            aria-selected={mode === m.id}
            aria-controls="workspace-panel"
            title={m.hint}
            onClick={() => onSwitch(m.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {m.label}
            {m.id === "mine" && findingsCount > 0 && <span className="mode-count">{findingsCount}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

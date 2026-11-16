import { useId, useLayoutEffect, useRef } from "react";

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="m4 4 8 8m0-8-8 8" />
    </svg>
  );
}

/**
 * The card over the map that holds the NISAR record. It can be closed to a
 * button and reopened (Escape closes it), and focus follows to whichever
 * of the two is left showing.
 */
export default function EvidenceCard({ heading, passDate, passLabel, reading, open, onOpenChange, children }) {
  const id = useId();
  const closeRef = useRef(null);
  const reopenRef = useRef(null);
  const moveFocus = useRef(false);
  const changeOpen = (next) => {
    moveFocus.current = true;
    onOpenChange(next);
  };
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (open ? closeRef : reopenRef).current?.focus({ preventScroll: true });
  }, [open]);
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    changeOpen(false);
  };

  return (
    <>
      {!open && (
        <button
          ref={reopenRef}
          type="button"
          className="btn btn-secondary chain-reopen"
          aria-controls={id}
          aria-expanded={false}
          onClick={() => changeOpen(true)}
        >
          {heading}
        </button>
      )}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape closes the card from any of its controls. */}
      <section
        id={id}
        className="panel chain"
        aria-label="NISAR story"
        aria-hidden={open ? undefined : true}
        inert={!open}
        data-open={open}
        onKeyDown={onOpenChange ? onKeyDown : undefined}
      >
        <header className="chain-head">
          <h3 className="chain-title">{heading}</h3>
          {passLabel && <time className="chain-pass-date" dateTime={passDate}>{passLabel}</time>}
          {onOpenChange && (
            <button ref={closeRef} type="button" className="chain-close" aria-label="Close NISAR card" onClick={() => changeOpen(false)}>
              <CloseIcon />
            </button>
          )}
        </header>
        {reading}
        {children}
      </section>
    </>
  );
}

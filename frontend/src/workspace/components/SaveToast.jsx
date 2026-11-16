/** The note after a save, with a link to My findings when it isn't showing. */
export default function SaveToast({ title, onOpen }) {
  return (
    <div className="save-toast" role="status">
      Saved “{title}” to My findings.
      {onOpen && (
        <button type="button" className="btn btn-link" onClick={onOpen}>Open</button>
      )}
    </div>
  );
}

import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="pf-notfound">
      <p className="pf-eyebrow">404</p>
      <h1>This page drifted out of the radar swath.</h1>
      <p>It doesn’t exist, or it moved.</p>
      <p>
        <Link to="/" className="pf-btn pf-btn-primary">Go home</Link>{" "}
        <Link to="/docs/get-started/what-is-nisar" className="pf-btn">Read the docs</Link>
      </p>
    </div>
  );
}

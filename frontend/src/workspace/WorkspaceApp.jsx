import WorkspaceLayout from "./components/WorkspaceLayout.jsx";
import { useWorkspace } from "./useWorkspace.js";

/**
 * The map workspace. The platform keeps it mounted while docs pages are
 * shown (platform/WorkspaceHost.jsx) so the map and selection survive a
 * trip to the docs. `active` says whether it is the visible route; only
 * then does it read and write `?site=<slug>&date=<YYYY-MM-DD>` in the URL.
 *
 * Its state and behaviour are in useWorkspace.js (and the files it names);
 * its layout in components/WorkspaceLayout.jsx.
 */
export default function WorkspaceApp({ active = true }) {
  const ws = useWorkspace(active);
  return <WorkspaceLayout ws={ws} />;
}

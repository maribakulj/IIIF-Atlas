import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">◎</span> IIIF Atlas
        </Link>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/collections/new">New collection</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="sidebar-footer">
          <small>Visual Zotero for IIIF</small>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

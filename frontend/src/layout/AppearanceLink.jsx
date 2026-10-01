import React from "react";
import { Link } from "react-router-dom";
import { APPEARANCE_COPY } from "../themePresentation";
import { useAuth } from "../AuthContext";

export default function AppearanceLink({ menu = false, onClick }) {
  const { authenticated } = useAuth();
  if (!authenticated) return null;
  return <Link to="/account#appearance" className={menu ? "app-mobile-sheet-item appearance-link" : "btn-ghost appearance-link"} onClick={onClick}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.5-3.3 1.5 1.5 0 0 1 1.1-2.5H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10" cy="6.8" r="1"/><circle cx="14" cy="6.8" r="1"/><circle cx="17" cy="10" r="1"/></svg>
    <span>{APPEARANCE_COPY.title}</span>
  </Link>;
}

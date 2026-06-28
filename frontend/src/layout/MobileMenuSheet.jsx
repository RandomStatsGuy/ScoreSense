import React from "react";
import MobileBottomSheet from "./MobileBottomSheet";
import LegalLinks from "../LegalLinks";
import { STUDIO_NAME } from "../brand";

export default function MobileMenuSheet({
  open,
  onClose,
  authReady,
  authenticated,
  user,
  openSignIn,
  authLogout,
  showDataRefresh,
  dataRefreshLoading,
  onRefresh,
  refreshStatus,
  view,
  isAdmin,
  onGoToModel,
  onGoToAdmin,
  onGoToAccount,
  termsUrl,
  privacyUrl,
}) {
  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="Menu"
      className="app-mobile-sheet-menu"
    >
      <div className="app-mobile-sheet-list">
        {authReady && !authenticated ? (
          <button
            type="button"
            className="app-mobile-sheet-item app-mobile-sheet-item-action"
            onClick={() => {
              onClose();
              openSignIn();
            }}
          >
            Sign in with Patreon
          </button>
        ) : null}
        {authReady && authenticated ? (
          <div className="app-mobile-sheet-user">
            <span>{user?.name || user?.email || "Signed in"}</span>
            <button
              type="button"
              className="app-mobile-sheet-item app-mobile-sheet-item-action"
              onClick={() => {
                onClose();
                onGoToAccount();
              }}
            >
              Account settings
            </button>
            <button
              type="button"
              className="app-mobile-sheet-item app-mobile-sheet-item-action"
              onClick={() => {
                onClose();
                authLogout();
              }}
            >
              Log out
            </button>
          </div>
        ) : null}
        {showDataRefresh ? (
          <button
            type="button"
            className="app-mobile-sheet-item app-mobile-sheet-item-action"
            onClick={() => {
              onClose();
              onRefresh();
            }}
            disabled={dataRefreshLoading}
          >
            {dataRefreshLoading ? "Refreshing…" : "Refresh data"}
          </button>
        ) : null}
        {refreshStatus?.completed_at ? (
          <p className="app-mobile-sheet-meta">
            Updated {new Date(refreshStatus.completed_at).toLocaleString()}
          </p>
        ) : null}
        <p className="app-mobile-sheet-group">Info</p>
        <button
          type="button"
          className={`app-mobile-sheet-item app-mobile-sheet-item-subdued${view === "model" ? " active" : ""}`}
          onClick={() => {
            onClose();
            onGoToModel();
          }}
        >
          Model accuracy
        </button>
        {isAdmin ? (
          <button
            type="button"
            className={`app-mobile-sheet-item app-mobile-sheet-item-subdued${view === "admin" ? " active" : ""}`}
            onClick={() => {
              onClose();
              onGoToAdmin();
            }}
          >
            Admin portal
          </button>
        ) : null}
      </div>
      <LegalLinks termsUrl={termsUrl} privacyUrl={privacyUrl} compact className="app-mobile-sheet-legal" />
      <p className="app-mobile-sheet-studio">{STUDIO_NAME}</p>
    </MobileBottomSheet>
  );
}

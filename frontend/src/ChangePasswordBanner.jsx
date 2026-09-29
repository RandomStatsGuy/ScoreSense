import React from "react";

/**
 * Shown while an admin-set temporary password is still in place. The account
 * holder keeps this until they choose their own; Draft Hub stays closed to
 * them until then, so the banner names where to fix it.
 */
export default function ChangePasswordBanner({ user, onGoToAccount }) {
  if (!user || user.auth_type !== "native" || user.must_change_password !== true) {
    return null;
  }
  return (
    <div className="verify-email-banner panel" role="status">
      <p>
        An administrator set a temporary password on your account. Choose your own password to
        finish signing in — Fantasy stays closed until you do.
      </p>
      {onGoToAccount && (
        <button type="button" className="btn-primary" onClick={onGoToAccount}>
          Change password
        </button>
      )}
    </div>
  );
}

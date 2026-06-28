import React, { createContext, useContext } from "react";

export const AuthContext = createContext({
  ready: false,
  authenticated: false,
  user: null,
  hubAuthRequired: true,
  patreonConfigured: false,
  termsUrl: "",
  privacyUrl: "",
  openSignIn: () => {},
  closeSignIn: () => {},
  signInOpen: false,
  refreshAuth: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

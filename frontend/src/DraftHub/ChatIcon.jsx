import React from "react";

const paths = {
  chat: <><path d="M5 5h14v10H9l-4 4V5Z"/><path d="M9 9h6M9 12h4"/></>,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
  minimize: <path d="m6 9 6 6 6-6"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  send: <path d="m5 12 7-7 7 7M12 5v15"/>,
  smile: <><circle cx="12" cy="12" r="9"/><path d="M8 14s1 3 4 3 4-3 4-3M8 9h.01M16 9h.01"/></>,
};
export default function ChatIcon({ name="chat" }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.chat}</svg>;
}

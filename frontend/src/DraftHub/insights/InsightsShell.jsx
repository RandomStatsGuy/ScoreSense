import { HubSegmentNav } from "../HubUILayout";

/** Tab shell for Insights — shared nav + loading chrome. */
export default function InsightsShell({
  tabs,
  activeTab,
  onTabChange,
  tabLoading,
  children,
}) {
  return (
    <>
      <HubSegmentNav
        tabs={tabs}
        active={activeTab}
        onChange={onTabChange}
      />
      {tabLoading && (
        <p className="hub-muted hub-tab-loading" role="status">
          Updating…
        </p>
      )}
      {children}
    </>
  );
}

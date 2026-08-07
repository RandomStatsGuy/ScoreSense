/** Explains the three data layers behind Contracts (cap sheet vs Sleeper vs draft). */
export default function ContractDataSourcesBanner({ draftSources, sleeperLinked }) {
  return (
    <div className="hub-contract-sources-banner chart-note hub-insights-callout">
      <strong>Three data layers</strong>
      <ul className="hub-contract-sources-list">
        <li>
          <strong>Cap sheet (this table)</strong> — Salaries and who held each player at{' '}
          <em>season end</em>. From commissioner Excel/PDF import. This is what you edit here.
        </li>
        <li>
          <strong>Sleeper transactions</strong>
          {sleeperLinked
            ? " — Trades/waivers with dates and from→to owners. Used to auto-tag Acquired and resolve owner changes."
            : " — Link Sleeper on Setup to auto-match trades and waivers."}
        </li>
        <li>
          <strong>Draft results</strong>
          {draftSources?.["2022"]
            ? " — Auction wins from spreadsheet (2022–2025) + 2021 PDF. Tags Acquired = Auction."
            : " — Import draft spreadsheet to tag auction wins."}
        </li>
      </ul>
      <p className="hub-contract-sources-tip">
        <strong>Rule of thumb:</strong> set Acquired (trade / auction / waiver) on the{' '}
        <em>season they joined that owner</em>. Renewal rows (same owner next year) leave Acquired blank.
        Click a player name for the combined timeline.
      </p>
    </div>
  );
}

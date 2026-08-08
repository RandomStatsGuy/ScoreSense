/** Explains Historic / contract data in plain language. */
export default function ContractDataSourcesBanner({ draftSources, sleeperLinked }) {
  return (
    <div className="hub-contract-sources-banner chart-note hub-insights-callout">
      <p className="hub-contract-sources-tip" style={{ margin: 0 }}>
        <strong>Year sheet</strong> = Sleeper week-1 roster (+ your $).{" "}
        <strong>Sleeper</strong>
        {sleeperLinked ? " = live / in-season moves." : " = link on Setup for live roster."}{" "}
        <strong>Draft log</strong>
        {draftSources?.["2022"] ? " tags auction wins." : " — import drafts to tag auction wins."}{" "}
        Set Acquired only in the year they joined; keepers can stay blank.
      </p>
    </div>
  );
}

/** Only explicit schedule evidence establishes a bye; missing opponents stay unknown. */
export function isByeWeek(row) {
  if (!row) return false;
  if (row.is_bye === true || row.isBye === true) return true;
  const opponent = String(row.Opponent ?? row.opponent ?? '').trim().toUpperCase();
  return opponent === 'BYE' || opponent === 'BYE WEEK';
}

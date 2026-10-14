import {projectionPosition} from './projectionTiers.js';

/** UI positions are independent of the shared WR/TE prediction artifact key. */
export const projectionModelPosition = position => position === 'te' ? 'wr' : position;

export function filterProjectionPosition(rows, position) {
  if (!['wr', 'te'].includes(position)) return rows || [];
  const wanted=position.toUpperCase();
  return (rows || []).filter(row => {
    const actual=projectionPosition(row);
    // A receiver pool without trustworthy identity stays visible as Untiered.
    return !actual || actual === wanted;
  });
}

/** Unknown receiver identities stay on the board, but cannot claim a position rank or lead signal. */
export function hasProjectionPosition(row, position) {
  return !['wr','te'].includes(position) || projectionPosition(row) === position.toUpperCase();
}

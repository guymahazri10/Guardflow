/**
 * rosterEditorUtils.ts
 *
 * Pure TypeScript helpers for editing roster board structure.
 *
 * Rules:
 *   - No mutations — every function returns new arrays / objects.
 *   - No React, no Supabase, no browser APIs, no side effects.
 *   - Safe to call from RosterEditorPage, tests, or any non-React context.
 */

import type { RosterBoardRow } from './rosterBoards';

// ─── Shared return type for functions that touch both cols and rows ────────────

export interface ColRowResult {
  cols: string[];
  rows: RosterBoardRow[];
}

// ─── 1. canPublishRosterBoard ─────────────────────────────────────────────────

/**
 * Returns true only when the board has at least one column AND at least one
 * time row. An empty board must never be published — guards would see nothing.
 */
export function canPublishRosterBoard(input: {
  cols: string[];
  rows: RosterBoardRow[];
}): boolean {
  return input.cols.length > 0 && input.rows.length > 0;
}

// ─── 2. addColumn ─────────────────────────────────────────────────────────────

/**
 * Adds a new column to the board.
 *
 * - Trims the name. Ignores empty strings after trimming.
 * - Prevents exact-match duplicates (case-sensitive).
 * - Appends the column to the end of cols.
 * - Seeds every existing row's cells with { [newColumn]: '' } so the grid
 *   stays rectangular.
 */
export function addColumn(
  cols: string[],
  rows: RosterBoardRow[],
  columnName: string,
): ColRowResult {
  const name = columnName.trim();

  // Guard: empty or duplicate
  if (!name || cols.includes(name)) {
    return { cols, rows };
  }

  const newCols = [...cols, name];

  const newRows = rows.map((row) => ({
    ...row,
    cells: { ...row.cells, [name]: '' },
  }));

  return { cols: newCols, rows: newRows };
}

// ─── 3. removeColumn ─────────────────────────────────────────────────────────

/**
 * Removes a column from the board.
 *
 * - Filters columnName out of cols.
 * - Deletes the matching key from every row's cells.
 * - If the column does not exist, returns the input unchanged.
 */
export function removeColumn(
  cols: string[],
  rows: RosterBoardRow[],
  columnName: string,
): ColRowResult {
  // Nothing to remove
  if (!cols.includes(columnName)) {
    return { cols, rows };
  }

  const newCols = cols.filter((c) => c !== columnName);

  const newRows = rows.map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [columnName]: _dropped, ...remainingCells } = row.cells;
    return { ...row, cells: remainingCells };
  });

  return { cols: newCols, rows: newRows };
}

// ─── 4. renameColumn ─────────────────────────────────────────────────────────

/**
 * Renames an existing column.
 *
 * - Trims newName. Ignores empty new names.
 * - No-ops when newName equals oldName (already correct).
 * - Prevents renaming to a name that already exists elsewhere in cols.
 * - No-ops when oldName is not found in cols.
 * - Replaces the key in every row's cells in the same insertion position
 *   so display order in the grid is preserved.
 * - Cell values are preserved under the new key.
 */
export function renameColumn(
  cols: string[],
  rows: RosterBoardRow[],
  oldName: string,
  newName: string,
): ColRowResult {
  const trimmedNew = newName.trim();

  // Guards
  if (!trimmedNew) return { cols, rows };
  if (trimmedNew === oldName) return { cols, rows };
  if (!cols.includes(oldName)) return { cols, rows };
  if (cols.includes(trimmedNew)) return { cols, rows };

  // Replace in cols, preserving position
  const newCols = cols.map((c) => (c === oldName ? trimmedNew : c));

  // Replace key in each row's cells, preserving insertion order
  const newRows = rows.map((row) => {
    const newCells: Record<string, string> = {};

    for (const key of Object.keys(row.cells)) {
      if (key === oldName) {
        newCells[trimmedNew] = row.cells[key] ?? '';
      } else {
        newCells[key] = row.cells[key];
      }
    }

    // If oldName was never seeded into this row's cells, add the new key
    if (!(oldName in row.cells) && !(trimmedNew in newCells)) {
      newCells[trimmedNew] = '';
    }

    return { ...row, cells: newCells };
  });

  return { cols: newCols, rows: newRows };
}

// ─── 5. addTimeRow ────────────────────────────────────────────────────────────

/**
 * Appends a new time block row to the board.
 *
 * - Trims time. Ignores empty strings.
 * - Prevents duplicate time values (exact string match).
 * - New row starts with cells: {}. Call ensureRowsHaveAllColumns() afterward
 *   if you need all column keys pre-seeded.
 */
export function addTimeRow(rows: RosterBoardRow[], time: string): RosterBoardRow[] {
  const trimmedTime = time.trim();

  if (!trimmedTime) return rows;
  if (rows.some((r) => r.time === trimmedTime)) return rows;

  return [...rows, { time: trimmedTime, cells: {} }];
}

// ─── 6. removeTimeRow ─────────────────────────────────────────────────────────

/**
 * Removes the time block row that exactly matches `time`.
 * Returns the input unchanged if no match is found.
 */
export function removeTimeRow(rows: RosterBoardRow[], time: string): RosterBoardRow[] {
  return rows.filter((r) => r.time !== time);
}

// ─── 7. updateCell ────────────────────────────────────────────────────────────

/**
 * Sets the value of a single cell identified by (rowTime, columnName).
 *
 * - Finds the row by exact time match.
 * - Sets cells[columnName] = value (creates the key if it was missing).
 * - Returns all rows unchanged if no row matches rowTime.
 * - Passing an empty string is valid — it clears the cell.
 */
export function updateCell(
  rows: RosterBoardRow[],
  rowTime: string,
  columnName: string,
  value: string,
): RosterBoardRow[] {
  return rows.map((row) => {
    if (row.time !== rowTime) return row;

    return {
      ...row,
      cells: { ...row.cells, [columnName]: value },
    };
  });
}

// ─── 8. ensureRowsHaveAllColumns ─────────────────────────────────────────────

/**
 * Normalizes every row so its cells exactly mirror the current cols:
 *
 * - Missing column keys are added with an empty string value.
 * - Extra keys not present in cols are removed.
 * - Key order in the resulting cells object follows the order of cols,
 *   making iteration in the grid consistent.
 *
 * Call this after addColumn, removeColumn, or renameColumn to guarantee
 * the grid is always rectangular before saving.
 */
export function ensureRowsHaveAllColumns(
  cols: string[],
  rows: RosterBoardRow[],
): RosterBoardRow[] {
  return rows.map((row) => {
    const normalizedCells: Record<string, string> = {};

    for (const col of cols) {
      normalizedCells[col] = row.cells[col] ?? '';
    }

    // Keys not in cols are intentionally omitted (implicit removal)

    return { ...row, cells: normalizedCells };
  });
}

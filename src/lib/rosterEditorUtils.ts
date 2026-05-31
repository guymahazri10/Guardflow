import type { RosterBoardRow } from './rosterBoards'

export interface ColRowResult {
  cols: string[]
  rows: RosterBoardRow[]
}

type PublishableRosterBoard = {
  cols: string[]
  rows: RosterBoardRow[]
}

export function canPublishRosterBoard(input: PublishableRosterBoard) {
  return input.cols.length > 0 && input.rows.length > 0
}

export function addColumn(
  cols: string[],
  rows: RosterBoardRow[],
  columnName: string,
): ColRowResult {
  const trimmedColumnName = columnName.trim()

  if (!trimmedColumnName || cols.includes(trimmedColumnName)) {
    return { cols, rows }
  }

  return {
    cols: [...cols, trimmedColumnName],
    rows: rows.map((row) => ({
      ...row,
      cells: {
        ...row.cells,
        [trimmedColumnName]: '',
      },
    })),
  }
}

export function removeColumn(
  cols: string[],
  rows: RosterBoardRow[],
  columnName: string,
): ColRowResult {
  return {
    cols: cols.filter((col) => col !== columnName),
    rows: rows.map((row) => ({
      ...row,
      cells: Object.fromEntries(Object.entries(row.cells).filter(([col]) => col !== columnName)),
    })),
  }
}

export function renameColumn(
  cols: string[],
  rows: RosterBoardRow[],
  oldName: string,
  newName: string,
): ColRowResult {
  const trimmedNewName = newName.trim()

  if (!trimmedNewName || !cols.includes(oldName) || (trimmedNewName !== oldName && cols.includes(trimmedNewName))) {
    return { cols, rows }
  }

  return {
    cols: cols.map((col) => (col === oldName ? trimmedNewName : col)),
    rows: rows.map((row) => {
      const { [oldName]: oldValue = '', ...remainingCells } = row.cells

      return {
        ...row,
        cells: {
          ...remainingCells,
          [trimmedNewName]: oldValue,
        },
      }
    }),
  }
}

export function addTimeRow(rows: RosterBoardRow[], time: string) {
  const trimmedTime = time.trim()

  if (!trimmedTime || rows.some((row) => row.time === trimmedTime)) {
    return rows
  }

  return [
    ...rows,
    {
      time: trimmedTime,
      cells: {},
    },
  ]
}

export function removeTimeRow(rows: RosterBoardRow[], time: string) {
  return rows.filter((row) => row.time !== time)
}

export function updateCell(
  rows: RosterBoardRow[],
  rowTime: string,
  columnName: string,
  value: string,
) {
  return rows.map((row) => {
    if (row.time !== rowTime) {
      return row
    }

    return {
      ...row,
      cells: {
        ...row.cells,
        [columnName]: value,
      },
    }
  })
}

export function ensureRowsHaveAllColumns(cols: string[], rows: RosterBoardRow[]) {
  return rows.map((row) => ({
    ...row,
    cells: cols.reduce<Record<string, string>>((cells, col) => {
      return {
        ...cells,
        [col]: row.cells[col] ?? '',
      }
    }, {}),
  }))
}

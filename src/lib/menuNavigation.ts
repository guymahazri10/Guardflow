/** Keyboard movement inside a small menu of options: arrows move (wrapping), Home / End jump. */
export function nextMenuIndex(current: number, key: string, length: number): number {
  if (length <= 0) return -1
  switch (key) {
    case 'ArrowDown':
      return (current + 1 + length) % length
    case 'ArrowUp':
      return (current - 1 + length) % length
    case 'Home':
      return 0
    case 'End':
      return length - 1
    default:
      return current
  }
}

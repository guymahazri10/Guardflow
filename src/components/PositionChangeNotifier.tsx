import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useActiveBoard } from '../hooks/useActiveBoard'
import { getCurrentBlock, getNextBlock, minutesUntilBlockStart } from '../lib/shiftBlocks'
import type { RosterBoard } from '../lib/rosterBoards'

const NOTIFY_WINDOW_MINUTES = 5
const CHECK_INTERVAL_MS = 30 * 1000

/** Prefer the user_id link; fall back to matching the guard's own display
 *  name for roles someone typed in without linking an account. */
function findMyRole(board: RosterBoard, userId: string, fullName: string | null): string | null {
  const entries = Object.entries(board.guard_names)

  const byUserId = entries.find(([, assignment]) => assignment.user_id === userId)
  if (byUserId) return byUserId[0]

  if (fullName) {
    const byName = entries.find(([, assignment]) => assignment.name === fullName)
    if (byName) return byName[0]
  }

  return null
}

/** Background watcher: notifies the logged-in guard ~5 minutes before their assigned
 *  task changes to a different position within the currently active board. */
export function PositionChangeNotifier() {
  const { isGuard, user, profile } = useAuth()
  const { board, category } = useActiveBoard()
  const notifiedForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isGuard) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
    void Notification.requestPermission()
  }, [isGuard])

  useEffect(() => {
    if (!isGuard || !user || !board) return

    function check() {
      if (!user || !board) return

      const now = new Date()
      const isNight = category === 'night'
      const rows = board.rows ?? []
      const currentBlock = getCurrentBlock(rows, now, isNight)
      const nextBlock = getNextBlock(rows, currentBlock, isNight)
      if (!currentBlock || !nextBlock) return

      const myRole = findMyRole(board, user.id, profile?.full_name ?? null)
      if (!myRole) return

      const currentTask = currentBlock.cells?.[myRole]
      const nextTask = nextBlock.cells?.[myRole]
      if (!nextTask || nextTask === currentTask) return

      const minutesUntil = minutesUntilBlockStart(nextBlock, now, isNight)
      if (minutesUntil < 0 || minutesUntil > NOTIFY_WINDOW_MINUTES) return

      const notifyKey = `${board.id}:${nextBlock.time}:${nextTask}`
      if (notifiedForRef.current === notifyKey) return
      notifiedForRef.current = notifyKey

      const title = '⚠️ שינוי עמדה קרוב'
      const body = `בעוד ${Math.max(minutesUntil, 0)} דקות עובר/ת לעמדה: ${nextTask}`

      toast(`${title} — ${body}`, { duration: 10000 })

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body, tag: notifyKey })
      }
    }

    check()
    const interval = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [isGuard, user, profile, board, category])

  return null
}

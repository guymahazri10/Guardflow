import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useActiveBoard } from '../hooks/useActiveBoard'
import { getCurrentBlock, getNextBlock, minutesUntilBlockStart } from '../lib/shiftBlocks'
import type { RosterBoard } from '../lib/rosterBoards'

const NOTIFY_WINDOW_MINUTES = 5
const CHECK_INTERVAL_MS = 30 * 1000

/** Only a linked user_id counts — a role typed in as free text without picking
 *  a registered account shouldn't notify anyone, matching the server-side push logic. */
function findMyRole(board: RosterBoard, userId: string): string | null {
  const entries = Object.entries(board.guard_names)
  const byUserId = entries.find(([, assignment]) => assignment.user_id === userId)
  return byUserId ? byUserId[0] : null
}

/** Background watcher: notifies the logged-in guard ~5 minutes before their assigned
 *  task changes to a different position within the currently active board. */
export function PositionChangeNotifier() {
  const { isGuard, user } = useAuth()
  const { board, category } = useActiveBoard()
  const notifiedForRef = useRef<string | null>(null)

  // Permission is requested from a direct user click on <NotificationBell />,
  // not silently here — browsers increasingly ignore or auto-mute a
  // permission prompt that isn't tied to a real user gesture.

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

      const myRole = findMyRole(board, user.id)
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
  }, [isGuard, user, board, category])

  return null
}

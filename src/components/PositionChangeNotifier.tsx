import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import { useActiveBoard } from '../hooks/useActiveBoard'
import { useClock } from '../hooks/useClock'
import { getCurrentBlock, getNextBlock, minutesUntilBlockStart } from '../lib/shiftBlocks'
import type { RosterBoard } from '../lib/rosterBoards'

const NOTIFY_WINDOW_MINUTES = 5

function findMyRole(board: RosterBoard, userId: string): string | null {
  const entry = Object.entries(board.guard_names).find(([, assignment]) => assignment.user_id === userId)
  return entry ? entry[0] : null
}

/** Background watcher: notifies the logged-in guard ~5 minutes before their assigned
 *  task changes to a different position within the currently active board. */
export function PositionChangeNotifier() {
  const { isGuard, user } = useAuth()
  const { board, category } = useActiveBoard()
  const now = useClock()
  const notifiedForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isGuard) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
    void Notification.requestPermission()
  }, [isGuard])

  useEffect(() => {
    if (!isGuard || !user || !board) return

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

    const message = `בעוד ${Math.max(minutesUntil, 0)} דקות אתה עובר לעמדה: ${nextTask}`

    toast(message, { icon: '📍', duration: 8000 })

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('שינוי עמדה', { body: message })
    }
  }, [isGuard, user, board, category, now])

  return null
}

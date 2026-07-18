import { Outlet } from 'react-router-dom'
import BottomNav from './layout/BottomNav'
import { PositionChangeNotifier } from './PositionChangeNotifier'

export function AppShell() {
  return (
    <div dir="rtl" className="min-h-screen bg-background text-text-primary flex flex-col">
      <PositionChangeNotifier />

      <div className="mx-auto flex flex-1 w-full max-w-mobile flex-col pb-20">
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  )
}

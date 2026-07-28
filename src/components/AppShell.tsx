import { Outlet } from 'react-router-dom'
import BottomNav from './layout/BottomNav'
import Sidebar from './layout/Sidebar'
import { PositionChangeNotifier } from './PositionChangeNotifier'

export function AppShell() {
  return (
    <div dir="rtl" className="min-h-screen bg-background text-text-primary flex flex-col lg:flex-row">
      <PositionChangeNotifier />

      <Sidebar />

      <div className="mx-auto flex flex-1 w-full max-w-mobile flex-col pb-20 lg:max-w-none lg:pb-8 lg:px-8 lg:py-8">
        <main className="flex flex-1 flex-col">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  )
}

import { Outlet } from 'react-router-dom'

const tabs = ['הגדרה', 'משמרת חיה', 'ניהול', 'פרופיל']

export function AppShell() {
  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-24 pt-4">
        <header className="mb-4 rounded-xl bg-primary p-4 text-white shadow">
          <h1 className="text-lg font-bold">GuardFlow</h1>
          <p className="text-sm opacity-90">תשתית שלב 1</p>
        </header>

        <main className="flex-1 rounded-xl bg-white p-4 shadow-sm">
          <Outlet />
        </main>

        <nav className="fixed bottom-0 left-0 right-0 border-t bg-white/95 backdrop-blur">
          <div className="mx-auto grid w-full max-w-md grid-cols-4 px-2 py-2 text-center text-xs text-slate-600">
            {tabs.map((tab) => (
              <span key={tab} className="rounded-md px-2 py-1">
                {tab}
              </span>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}

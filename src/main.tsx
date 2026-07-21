import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AppRouter } from './app/router'
import { AuthProvider } from './contexts/AuthContext'
import './index.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRouter />
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                fontFamily: 'Heebo, sans-serif',
                fontSize: '13px',
                fontWeight: 600,
                borderRadius: '16px',
                border: '1px solid #D9DEE5',
                color: '#15171A',
              },
              success: { iconTheme: { primary: '#2F7D4A', secondary: '#ffffff' } },
              error: { iconTheme: { primary: '#B63A32', secondary: '#ffffff' } },
            }}
          />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)

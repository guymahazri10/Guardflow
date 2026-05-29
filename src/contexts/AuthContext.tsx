import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const APP_ROLES = ['מנהל', 'אחמ"ש', 'מאבטח'] as const

export type AppRole = (typeof APP_ROLES)[number]

export type Profile = {
  id: string
  email: string | null
  full_name: string | null
  app_role: AppRole
  created_at: string | null
  updated_at: string | null
}

type AuthContextValue = {
  session: Session | null
  user: User | null
  profile: Profile | null
  appRole: AppRole | null
  isAdmin: boolean
  isCommander: boolean
  isGuard: boolean
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, app_role, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data as Profile | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(false)
  const authRequestRef = useRef(0)

  const resolveAuthState = useCallback(async (nextSession: Session | null) => {
    const requestId = authRequestRef.current + 1
    authRequestRef.current = requestId

    if (mountedRef.current) {
      setLoading(true)
      setSession(nextSession)
    }

    const nextUser = nextSession?.user ?? null

    if (!nextUser) {
      if (mountedRef.current && authRequestRef.current === requestId) {
        setProfile(null)
        setLoading(false)
      }
      return
    }

    try {
      const nextProfile = await fetchProfile(nextUser.id)

      if (mountedRef.current && authRequestRef.current === requestId) {
        setProfile(nextProfile)
      }
    } catch (error) {
      console.error('Failed to load profile', error)

      if (mountedRef.current && authRequestRef.current === requestId) {
        setProfile(null)
      }
    } finally {
      if (mountedRef.current && authRequestRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    const loadInitialSession = async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error('Failed to load Supabase session', error)
        await resolveAuthState(null)
        return
      }

      await resolveAuthState(data.session)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void resolveAuthState(nextSession)
    })

    void loadInitialSession()

    return () => {
      mountedRef.current = false
      subscription.unsubscribe()
    }
  }, [resolveAuthState])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      throw error
    }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      throw error
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null
    const appRole = profile?.app_role ?? null

    return {
      session,
      user,
      profile,
      appRole,
      isAdmin: appRole === 'מנהל',
      isCommander: appRole === 'אחמ"ש',
      isGuard: appRole === 'מאבטח',
      loading,
      signIn,
      signOut,
    }
  }, [loading, profile, session, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  return context
}

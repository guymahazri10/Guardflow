import { createClient } from '@supabase/supabase-js';
import type { Profile, RosterBoard, ShiftStaffing } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[GuardFlow] Supabase env vars not set. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local');
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at'>;
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>;
      };
      roster_boards: {
        Row: RosterBoard;
        Insert: Omit<RosterBoard, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<RosterBoard, 'id' | 'created_at'>>;
      };
      shift_staffing: {
        Row: ShiftStaffing;
        Insert: Omit<ShiftStaffing, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ShiftStaffing, 'id' | 'created_at'>>;
      };
    };
  };
};

export const supabase = createClient<Database>(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);

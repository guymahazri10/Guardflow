export type AppRole = 'מנהל' | 'אחמ"ש' | 'מאבטח';
export type PlatformRole = 'admin' | 'user';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  app_role: AppRole | null;
  created_at: string;
}

export interface RosterRow {
  time: string;
  cells: Record<string, string>;
}

export interface RosterBoard {
  id: string;
  shift_id: string;
  shift_type: string | null;
  cols: string[];
  rows: RosterRow[];
  notes: string | null;
  published: boolean;
  guard_names: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface ShiftStaffing {
  id: string;
  shift_id: string;
  shift_date: string;
  guard_names: Record<string, string>;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

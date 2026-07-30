import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShiftTemplates } from '../hooks/useShiftTemplates'
import { getShiftFullTitle, getShiftHoursLabel, getShiftShortLabel, SHIFT_CATEGORIES, type ShiftCategory } from '../constants/shifts'
import { useShiftTypes, useCreateShiftTypeVariant, useDeleteShiftTypeVariant } from '../hooks/useShiftTypes'

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : 'הפעולה נכשלה. נסה שוב.'
}

export function ShiftTemplatesPage() {
  const navigate = useNavigate()
  const templatesQuery = useShiftTemplates()
  const shiftTypesQuery = useShiftTypes()

  const createVariantMutation = useCreateShiftTypeVariant()
  const deleteVariantMutation = useDeleteShiftTypeVariant()

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createCategory, setCreateCategory] = useState<ShiftCategory>('morning')
  const [createGuardCount, setCreateGuardCount] = useState('')
  const [createCloneFromId, setCreateCloneFromId] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const allShifts = shiftTypesQuery.data ?? []
  const categoryVariants = allShifts.filter((s) => s.category === createCategory)

  function handleOpenCreateForm() {
    setCreateError(null)
    setCreateGuardCount('')
    setCreateCloneFromId(allShifts.find((s) => s.category === createCategory)?.id ?? null)
    setShowCreateForm(true)
  }

  function handleCreateCategoryPick(cat: ShiftCategory) {
    setCreateCategory(cat)
    setCreateCloneFromId(allShifts.find((s) => s.category === cat)?.id ?? null)
  }

  async function handleCreateSubmit() {
    const guardCountNum = Number(createGuardCount)

    if (!Number.isInteger(guardCountNum) || guardCountNum <= 0) {
      setCreateError('מספר מאבטחים חייב להיות מספר שלם חיובי.')
      return
    }

    if (!createCloneFromId) {
      setCreateError('יש לבחור וריאנט לשכפול.')
      return
    }

    setCreateError(null)

    try {
      const newShiftId = await createVariantMutation.mutateAsync({
        category: createCategory,
        guardCount: guardCountNum,
        cloneFromShiftId: createCloneFromId,
      })
      setShowCreateForm(false)
      navigate(`/shift-templates?shiftId=${encodeURIComponent(newShiftId)}`)
    } catch (error) {
      setCreateError(getReadableError(error))
    }
  }

  async function handleDeleteVariant(shiftId: string, event: React.MouseEvent) {
    event.stopPropagation()

    if (!window.confirm('האם אתה בטוח שברצונך למחוק את הווריאנט? לא ניתן לשחזר.')) {
      return
    }

    setListError(null)

    try {
      await deleteVariantMutation.mutateAsync(shiftId)
    } catch (error) {
      setListError(getReadableError(error))
    }
  }

  return (
    <div className="flex flex-col flex-1 max-w-mobile mx-auto w-full">
      <div className="bg-white border-b border-border px-4 pt-5 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">תבניות משמרת</h1>
          <p className="text-text-secondary text-sm mt-0.5">בחר תבנית כדי לערוך את תוכן הלוח שלה</p>
        </div>
        <button
          onClick={handleOpenCreateForm}
          className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold text-primary bg-primary-light border border-primary/20 rounded-xl active:opacity-80 transition-opacity"
        >
          <span className="text-base leading-none">+</span> הוסף תבנית
        </button>
      </div>

      {listError && (
        <div className="mx-4 mt-3 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
          {listError}
        </div>
      )}

      {(templatesQuery.isError || shiftTypesQuery.isError) && (
        <div className="mx-4 mt-3 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
          טעינת התבניות נכשלה. נסה לרענן את העמוד.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2.5 pb-6">
        {templatesQuery.isLoading || shiftTypesQuery.isLoading ? (
          <ListSkeleton />
        ) : (shiftTypesQuery.data ?? []).length === 0 ? (
          <div className="card p-6 text-center text-sm text-text-secondary">אין תבניות משמרת עדיין.</div>
        ) : (
          (shiftTypesQuery.data ?? []).map((shift) => {
            const template = templatesQuery.data?.find((t) => t.shift_id === shift.id)
            const isDeleting = deleteVariantMutation.isPending && deleteVariantMutation.variables === shift.id

            return (
              <button
                key={shift.id}
                onClick={() => navigate(`/shift-templates?shiftId=${encodeURIComponent(shift.id)}`)}
                className="card p-3.5 text-right flex items-center gap-3 transition-all active:scale-[0.98]"
              >
                <div className="flex-1 text-right min-w-0">
                  <p className="text-sm font-bold text-text-primary">{getShiftFullTitle(shift)}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {getShiftShortLabel(shift)} · {getShiftHoursLabel(shift)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-[11px] text-text-muted">
                    {template ? `${template.cols.length} תפקידים` : '—'}
                  </span>
                  <span
                    role="button"
                    onClick={(event) => {
                      void handleDeleteVariant(shift.id, event)
                    }}
                    className={`text-[11px] font-medium text-danger active:opacity-70 ${
                      isDeleting ? 'pointer-events-none opacity-40' : ''
                    }`}
                  >
                    מחק
                  </span>
                </div>
              </button>
            )
          })
        )}
      </div>

      {showCreateForm && (
        <div
          onClick={() => setShowCreateForm(false)}
          className="fixed inset-0 bg-black/45 z-[100] flex items-end"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-mobile mx-auto bg-white rounded-t-[20px] safe-bottom p-5 flex flex-col gap-4 max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-text-primary">הוסף וריאנט משמרת</span>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-text-muted p-1 active:opacity-70"
                aria-label="סגור"
              >
                ✕
              </button>
            </div>

            {createError && (
              <div className="rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
                {createError}
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-text-muted mb-1.5">קטגוריה</p>
              <div className="flex gap-2">
                {(Object.keys(SHIFT_CATEGORIES) as ShiftCategory[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => handleCreateCategoryPick(cat)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                      createCategory === cat ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary'
                    }`}
                  >
                    {SHIFT_CATEGORIES[cat].label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-text-muted mb-1.5">מספר מאבטחים</p>
              <input
                type="number"
                min="1"
                value={createGuardCount}
                onChange={(event) => setCreateGuardCount(event.target.value)}
                placeholder="לדוגמה: 7"
                className="w-full h-11 rounded-xl border border-border px-3 text-sm"
              />
            </div>

            <div>
              <p className="text-xs font-medium text-text-muted mb-1.5">שכפל תוכן מ</p>
              {categoryVariants.length === 0 ? (
                <p className="text-sm text-text-secondary">אין וריאנט קיים בקטגוריה זו לשכפול.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {categoryVariants.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setCreateCloneFromId(s.id)}
                      className={`text-right px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                        createCloneFromId === s.id
                          ? 'border-primary ring-1 ring-primary text-primary font-bold'
                          : 'border-border text-text-primary'
                      }`}
                    >
                      {getShiftFullTitle(s)} · {getShiftShortLabel(s)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                void handleCreateSubmit()
              }}
              disabled={createVariantMutation.isPending || categoryVariants.length === 0}
              className="btn-primary w-full h-14 rounded-[14px] text-[15px] disabled:opacity-40"
            >
              {createVariantMutation.isPending ? 'יוצר...' : 'צור וריאנט'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[1, 2, 3].map((i) => (
        <div key={i} className="card p-3.5 flex items-center gap-3 animate-pulse">
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3.5 w-24 bg-border rounded" />
            <div className="h-3 w-32 bg-border rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

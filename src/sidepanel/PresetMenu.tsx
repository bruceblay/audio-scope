import { useEffect, useRef, useState } from 'react'
import { isFactoryPreset, type Preset } from './presets'

/** Everything the panel is doing, as clipboard JSON, for tuning by hand. */
export interface ExportedSetup {
  mode: string
  scope: unknown
  analyzer: unknown
  userPresets: Preset[]
}

/**
 * The preset popover, following browser-fx's menu: saving never overwrites,
 * Update is the only path that replaces a preset and only exists for a user
 * preset you have modified, factory and user presets sit in labeled sections,
 * and rename/delete appear on hover with an inline delete confirm.
 */

type Editing = { mode: 'new' | 'rename'; id?: string }

/**
 * The JSON-export row was the loop for tuning the factory presets: dial a look
 * in by eye, copy it out, pin the values verbatim in presets.ts. Hidden now
 * that the tuning phase is done, kept for the next one. Flip to true to bring
 * the row back.
 */
const SHOW_EXPORT = false

export function PresetMenu({
  userPresets,
  factoryPresets,
  activeId,
  dirty,
  suggestedName,
  onLoad,
  onSaveNew,
  onUpdate,
  onRename,
  onDelete,
  onExport,
  onClose,
}: {
  userPresets: Preset[]
  factoryPresets: Preset[]
  activeId: string | null
  dirty: boolean
  suggestedName: string
  onLoad: (p: Preset) => void
  onSaveNew: (name: string) => void
  onUpdate: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  /** Returns the JSON that was copied, so the row can confirm. */
  onExport: () => Promise<void>
  onClose: () => void
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Enter commits and then blurs, Escape cancels and then blurs. Without this
  // latch the trailing blur would save a second copy.
  const settled = useRef(false)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const active = [...factoryPresets, ...userPresets].find((p) => p.id === activeId)
  const activeIsUser = active && !isFactoryPreset(active.id)

  const startNew = () => {
    setConfirmId(null)
    setDraft(suggestedName)
    settled.current = false
    setEditing({ mode: 'new' })
  }

  const startRename = (p: Preset) => {
    setConfirmId(null)
    setDraft(p.name)
    settled.current = false
    setEditing({ mode: 'rename', id: p.id })
  }

  const settle = (save: boolean) => {
    if (settled.current) return
    settled.current = true
    const name = draft.trim()
    if (save && editing && name) {
      if (editing.mode === 'new') onSaveNew(name)
      else if (editing.id) onRename(editing.id, name)
    }
    setEditing(null)
  }

  const nameInput = (
    <div className="preset-row preset-row-static">
      <input
        ref={inputRef}
        className="preset-input"
        value={draft}
        maxLength={40}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') settle(true)
          if (e.key === 'Escape') settle(false)
        }}
        onBlur={() => settle(true)}
      />
    </div>
  )

  const row = (p: Preset) => {
    if (editing?.mode === 'rename' && editing.id === p.id) return <div key={p.id}>{nameInput}</div>

    if (confirmId === p.id) {
      return (
        <div key={p.id} className="preset-row preset-row-static preset-confirm">
          <span className="preset-name">delete "{p.name}"?</span>
          <button
            type="button"
            className="preset-micro is-danger"
            onClick={() => {
              onDelete(p.id)
              setConfirmId(null)
            }}
          >
            yes
          </button>
          <button type="button" className="preset-micro" onClick={() => setConfirmId(null)}>
            no
          </button>
        </div>
      )
    }

    return (
      <div
        key={p.id}
        className="preset-row"
        role="button"
        tabIndex={0}
        title={`Load ${p.name}`}
        onClick={() => onLoad(p)}
        onKeyDown={(e) => e.key === 'Enter' && onLoad(p)}
      >
        <span className="preset-name" data-active={p.id === activeId}>
          {p.name}
          {p.id === activeId && dirty ? ' *' : ''}
        </span>
        {!isFactoryPreset(p.id) && (
          <span className="preset-actions">
            <button
              type="button"
              className="preset-micro"
              title="Rename"
              onClick={(e) => {
                e.stopPropagation()
                startRename(p)
              }}
            >
              ✎
            </button>
            <button
              type="button"
              className="preset-micro"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmId(p.id)
              }}
            >
              ×
            </button>
          </span>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Click-catcher: anywhere outside the panel dismisses it. */}
      <div className="preset-catcher" onClick={onClose} />

      <div className="preset-menu" role="menu" aria-label="Presets">
        {editing?.mode === 'new' ? (
          nameInput
        ) : (
          <div
            className="preset-row preset-action-row"
            role="button"
            tabIndex={0}
            title="Save the current settings as a new preset"
            onClick={startNew}
            onKeyDown={(e) => e.key === 'Enter' && startNew()}
          >
            <span className="preset-glyph">+</span>save as new
          </div>
        )}

        {SHOW_EXPORT && (
        <div
          className="preset-row preset-action-row"
          role="button"
          tabIndex={0}
          title="Copy current settings and all user presets as JSON"
          onClick={() => {
            onExport().then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1200)
            })
          }}
          onKeyDown={(e) => e.key === 'Enter' && onExport()}
        >
          <span className="preset-glyph">{copied ? '✓' : '⎘'}</span>
          {copied ? 'copied to clipboard' : 'copy setup as JSON'}
        </div>
        )}

        {activeIsUser && dirty && (
          <div
            className="preset-row preset-action-row"
            role="button"
            tabIndex={0}
            title={`Overwrite ${active.name} with the current settings`}
            onClick={onUpdate}
            onKeyDown={(e) => e.key === 'Enter' && onUpdate()}
          >
            <span className="preset-glyph">↻</span>
            <span className="preset-name">update "{active.name}"</span>
          </div>
        )}

        <div className="preset-list">
          <div className="preset-section">Factory</div>
          {factoryPresets.map(row)}
          <div className="preset-section preset-section-divided">User</div>
          {userPresets.length === 0 ? (
            <div className="preset-row preset-row-static preset-empty">nothing saved yet</div>
          ) : (
            userPresets.map(row)
          )}
        </div>
      </div>
    </>
  )
}

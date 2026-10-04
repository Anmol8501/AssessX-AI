import { useEffect, useRef } from 'react'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { python } from '@codemirror/lang-python'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { basicSetup } from 'codemirror'

/**
 * The code editor (CodeMirror 6, MIT): syntax highlighting, line numbers, bracket matching, indentation,
 * search and replace, keyword completion and undo history. Tab indents (Escape, then Tab, moves focus on).
 * Nothing here runs code — Run and Submit go to the server.
 */

const LANGUAGE: Record<string, () => Extension> = {
  python: () => python(),
  c: () => cpp(),
  cpp: () => cpp(),
  java: () => java(),
}

const languageExtension = (id: string): Extension => (LANGUAGE[id] ?? python)()

export function CodeEditor({
  value,
  language,
  dark,
  fontSize,
  readOnly,
  onChange,
  label,
}: {
  value: string
  language: string
  dark: boolean
  fontSize: number
  readOnly?: boolean
  onChange(value: string): void
  label: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const changed = useRef(onChange)
  const compartments = useRef({ language: new Compartment(), theme: new Compartment(), size: new Compartment(), readOnly: new Compartment() })

  useEffect(() => {
    changed.current = onChange
  })

  // Created once; later prop changes reconfigure it rather than rebuilding it (which would lose undo).
  useEffect(() => {
    if (!host.current) return
    const c = compartments.current
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          c.language.of(languageExtension(language)),
          c.theme.of(dark ? oneDark : []),
          c.size.of(EditorView.theme({ '&': { fontSize: `${fontSize}px`, height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, Consolas, monospace' } })),
          c.readOnly.of(EditorState.readOnly.of(Boolean(readOnly))),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // Created once per mount; see the effects below for changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.language.reconfigure(languageExtension(language)) })
  }, [language])

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.theme.reconfigure(dark ? oneDark : []) })
  }, [dark])

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.current.size.reconfigure(EditorView.theme({ '&': { fontSize: `${fontSize}px`, height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, Consolas, monospace' } })),
    })
  }, [fontSize])

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.readOnly.reconfigure(EditorState.readOnly.of(Boolean(readOnly))) })
  }, [readOnly])

  // An outside change (a reset, a restored draft, a language switch) replaces the text.
  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
    }
  }, [value])

  return <div ref={host} className="h-full min-h-0 overflow-hidden" data-testid="code-editor" />
}

import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Renders markdown with a per-document Rendered | Raw toggle in the top-right.
// `defaultMode` may be 'rendered' (default) or 'raw'. `actions` renders extra
// controls (e.g. an Edit button) to the left of the toggle.
export function MarkdownDoc({ source, actions = null, defaultMode = 'rendered' }) {
  const [mode, setMode] = useState(defaultMode)
  return (
    <div>
      <div className="row md-toolbar">
        <span className="md-spacer" />
        {actions}
        <div className="seg">
          <button className={'view-btn' + (mode === 'rendered' ? ' active' : '')} onClick={() => setMode('rendered')}>Rendered</button>
          <button className={'view-btn' + (mode === 'raw' ? ' active' : '')} onClick={() => setMode('raw')}>Raw</button>
        </div>
      </div>
      {mode === 'rendered'
        ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{source || ''}</ReactMarkdown></div>
        : <pre className="prose">{source}</pre>}
    </div>
  )
}

// Inline rendered markdown (no toggle) — for compact previews.
export function MarkdownView({ source }) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{source || ''}</ReactMarkdown></div>
}

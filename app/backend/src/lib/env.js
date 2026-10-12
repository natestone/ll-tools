import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* Loads app/backend/.env into process.env.
 *
 * Node's own --env-file does this, but only from 20.6.0 onward; on anything
 * older node exits immediately with "bad option: --env-file". Rather than pin
 * the whole deployment to a Node release, read the file ourselves. It is a few
 * lines, adds no dependency, and behaves the same everywhere.
 *
 * IMPORTED FOR ITS SIDE EFFECT, AND IT MUST BE THE FIRST IMPORT IN index.js.
 * ES modules evaluate the whole import graph before the importing module's own
 * body runs, so calling a loader from inside index.js would be too late:
 * lib/mailer.js, lib/unsubscribe.js and lib/prisma.js all read process.env
 * while they are being evaluated, and would have captured undefined.
 *
 * Values already present in the real environment win, so PM2, systemd or a
 * one-off `PORT=4000 npm start` can still override the file.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PATH = path.resolve(here, '../../.env')

export function loadEnv(file = process.env.ENV_FILE || DEFAULT_PATH) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    // Not an error: in production the environment may be supplied directly.
    return { file, loaded: 0, found: false }
  }

  let loaded = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue

    const key = m[1]
    let val = m[2].trim()

    const quoted = val.length > 1
      && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
    if (quoted) {
      val = val.slice(1, -1)
    } else {
      // Only strip an inline comment from an UNQUOTED value. A quoted one may
      // legitimately contain '#' -- a percent-encoded password, for instance.
      const hash = val.indexOf(' #')
      if (hash !== -1) val = val.slice(0, hash).trim()
    }

    if (!(key in process.env)) {
      process.env[key] = val
      loaded += 1
    }
  }
  return { file, loaded, found: true }
}

loadEnv()

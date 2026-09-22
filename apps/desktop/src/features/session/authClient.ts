import { HttpAuthClient } from './httpAuthClient'
import type { AuthClient } from './types'

/** The one place that decides which authentication implementation the app uses. */
export const authClient: AuthClient = new HttpAuthClient()

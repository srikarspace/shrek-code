/** Why a turn ended. The first three are the real engine's names. */
export type TurnCompleteReason = 'answer' | 'aborted' | 'error' | 'max_steps'

/** Everything the loop announces. `turnId` is on all of them, minted once at the start. */
export type AgentEvent =
  | { type: 'turn.start'; turnId: string; text: string }
  | { type: 'turn.step'; turnId: string; step: number; kind: 'text'; text: string }
  | { type: 'turn.step'; turnId: string; step: number; kind: 'tool'; id: string; name: string; line: string }
  | { type: 'turn.step'; turnId: string; step: number; kind: 'result'; id: string; output: string }
  | { type: 'turn.abort'; turnId: string }
  | {
      type: 'turn.complete'
      turnId: string
      answer: string
      durationMs: number
      isAborted: boolean
      reason: TurnCompleteReason
    }
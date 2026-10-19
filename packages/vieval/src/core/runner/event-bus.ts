import type { RunEventDefinition, RunEventEmitter, RunEventEnvelope, RunEventScope } from '../../events'

import { createContext, defineEventa, matchBy } from '@moeru/eventa'

import { RUN_EVENT_SCHEMA_VERSION } from '../../events'

/**
 * In-process bus for one run: emitters plus subscriptions.
 */
export interface RunEventBus extends RunEventEmitter {
  /**
   * Subscribes to one event. Returns an unsubscribe function.
   */
  on: <TData>(definition: RunEventDefinition<TData>, listener: (envelope: RunEventEnvelope<TData>) => unknown) => () => void
  /**
   * Subscribes to every event, after the listeners of that event. Returns an unsubscribe function.
   */
  onAny: (listener: (envelope: RunEventEnvelope) => unknown) => () => void
}

/**
 * Run-wide identity stamped on every event.
 */
export interface RunEventIdentity {
  attemptId: string
  /** Comparison the run belongs to, when a comparison started it. */
  comparisonId?: string
  experimentId: string
  /** Id shared by every run of one `vieval run` invocation. */
  invocationId?: string
  runId: string
  workspaceId: string
}

/**
 * Creates the event bus of one run.
 *
 * Use when:
 * - `runVievalCli` starts a run and needs one source of truth for terminal output, the event log, and reporters
 *
 * Expects:
 * - subscribers are registered before the events they need are emitted
 *
 * Returns:
 * - a bus whose `emit` stamps the envelope (`seq`, `time`, run identity, scope ids) and never rejects
 *
 * Call stack:
 *
 * runVievalCli (../../cli/run)
 *   -> {@link createRunEventBus}
 *     -> {@link RunEventEmitter.scope} per project, task, and case
 *       -> {@link RunEventEmitter.emit}
 *         -> listeners from {@link RunEventBus.on} (in subscription order), then {@link RunEventBus.onAny}
 */
export function createRunEventBus(identity: RunEventIdentity): RunEventBus {
  const context = createContext()
  let seq = 0

  // NOTICE:
  // The Eventa context transports whole envelopes, keyed by the definition id. Dispatch matches events by
  // id only, so an envelope-typed definition with the same id reaches every listener of that id, and the
  // public definitions stay typed by their payload alone (no casts, plain `defineEventa<Data>()` for plugins).
  // Source: `@moeru/eventa` `createContext().dispatch`, which looks listeners up by `event.id`.
  function envelopeDefinition<TData>(definition: RunEventDefinition<TData>): RunEventDefinition<RunEventEnvelope<TData>> {
    return defineEventa<RunEventEnvelope<TData>>(definition.id)
  }

  function createEmitter(scope: RunEventScope): RunEventEmitter {
    return {
      emit<TData>(definition: RunEventDefinition<TData>, data: TData) {
        seq += 1
        const envelope: RunEventEnvelope<TData> = {
          attemptId: identity.attemptId,
          caseId: scope.caseId,
          ...(identity.comparisonId == null ? {} : { comparisonId: identity.comparisonId }),
          data,
          event: definition.id,
          experimentId: identity.experimentId,
          ...(identity.invocationId == null ? {} : { invocationId: identity.invocationId }),
          projectId: scope.projectId,
          runId: identity.runId,
          schemaVersion: RUN_EVENT_SCHEMA_VERSION,
          seq,
          taskId: scope.taskId,
          time: new Date().toISOString(),
          workspaceId: identity.workspaceId,
        }

        // Eventa calls every listener synchronously, each in its own try/catch, and rejects the returned
        // promise when any listener threw. Unhandled, that rejection would end the Node process.
        return context.emit(envelopeDefinition(definition), envelope).catch(() => {
          // Subscribers must never affect task scoring.
        })
      },
      scope(nested) {
        return createEmitter({ ...scope, ...nested })
      },
    }
  }

  const rootEmitter = createEmitter({})

  return {
    ...rootEmitter,
    on(definition, listener) {
      return context.on(envelopeDefinition(definition), (event) => {
        if (event.body != null) {
          return listener(event.body)
        }
      })
    },
    onAny(listener) {
      return context.on(matchBy<RunEventEnvelope>(() => true), (event) => {
        if (event.body != null) {
          return listener(event.body)
        }
      })
    },
  }
}

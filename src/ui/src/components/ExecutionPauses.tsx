import { useFlowStore } from '../store';
import { sendToRunner } from '../socket';

/** A pause stays in the normal test view; resume is an explicit action for its own ID. */
export const ExecutionPauses = () => {
  const pauses = useFlowStore(state => state.pendingPauses);
  const activeHistoricalRunId = useFlowStore(state => state.activeHistoricalRunId);
  if (activeHistoricalRunId || Object.keys(pauses).length === 0) return null;
  return (
    <div aria-label="Paused executions" style={{ padding: '10px 16px', background: '#231d35', borderBottom: '1px solid #6d4ab1', flexShrink: 0, maxHeight: '32vh', overflowY: 'auto' }}>
      {Object.values(pauses).map(pause => (
        <div key={pause.id} data-execution-pause={pause.id} role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '6px 0' }}>
          <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <strong style={{ color: '#ddd0ff', fontSize: '13px' }}>Execution paused</strong>
            <div data-pause-message style={{ color: '#fff', fontSize: '13px', whiteSpace: 'pre-wrap', marginTop: '4px' }}>{pause.message}</div>
            <div style={{ color: '#b3a8c8', fontSize: '12px', marginTop: '4px' }}>
              {pause.fileName}{pause.sourceLine ? `:${pause.sourceLine}` : ''}
              {pause.scenario ? ` · ${pause.scenario}` : ''}
              {pause.profile ? ` · Profile: ${pause.profile}` : ''}
              {pause.attempt ? ` · Attempt: ${pause.attempt}` : ''}
            </div>
          </div>
          <button type="button" aria-label={`Resume ${pause.fileName || 'execution'}`} onClick={() => sendToRunner('RESUME_EXECUTION', { pauseId: pause.id })} style={{ background: '#7c3aed', border: '1px solid #a78bfa', borderRadius: '5px', color: '#fff', padding: '7px 14px', cursor: 'pointer', flexShrink: 0 }}>Resume</button>
        </div>
      ))}
    </div>
  );
};

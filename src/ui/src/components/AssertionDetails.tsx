import type { AssertionCheck, AssertionResult } from '../../../reporting/assertion_result';

/** All observations render as text; recorded application data is never HTML. */
export function AssertionDetails({ result, light = false }: { result?: AssertionResult | null; light?: boolean }) {
  if (!result) return null;
  const color = (status: string) => status === 'passed' ? (light ? '#047857' : '#34d399') : status === 'failed' ? (light ? '#b91c1c' : '#f87171') : (light ? '#64748b' : '#94a3b8');
  const check = (item: AssertionCheck) => <div key={item.key} data-assertion-check={item.key} data-check-status={item.status} style={{ marginLeft: 10, marginTop: 5 }}>
    <div style={{ color: color(item.status) }}>{item.status === 'passed' ? '✔' : item.status === 'failed' ? '✖' : '○'} {item.label}{item.status === 'not_evaluated' ? ' — Not evaluated' : ''}</div>
    {item.status === 'failed' && <div style={{ marginLeft: 16 }}>
      {item.expected !== undefined && <div>Expected: {item.expected}</div>}
      {item.actual !== undefined && <div>Actual: {item.actual}</div>}
    </div>}
    {item.reason && item.status !== 'passed' && <div style={{ marginLeft: 16 }}>Reason: {item.reason}</div>}
    {item.children?.map(check)}
  </div>;
  return <div data-assertion-result={result.status} style={{ whiteSpace:'pre-wrap', overflowWrap:'anywhere', fontFamily:'monospace', fontSize:11, textAlign:'left', color:light?'#334155':'#cbd5e1', padding:'6px 4px', minWidth:0 }}>
    {result.checks.map(check)}
    {result.status === 'failed' && result.reason && <div>Reason: {result.reason}</div>}
    {result.timeout !== undefined && <div>Timeout: {result.timeout} ms; elapsed: {result.elapsed || 0} ms</div>}
    {result.sourceFile && <div>Location: {result.sourceFile}{result.sourceLine ? ':'+result.sourceLine : ''}</div>}
    {result.profile && <div>Profile: {result.profile}</div>}
  </div>;
}

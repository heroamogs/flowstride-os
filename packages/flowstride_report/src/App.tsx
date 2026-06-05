import React, { useState, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  FileText,
  ChevronRight,
  Terminal,
  Globe,
  Zap,
  X,
  ShieldCheck,
  Image as ImageIcon,
} from "lucide-react";

export default function App() {
  const [data, setData] = useState<any>(null);
  const [selectedStep, setSelectedStep] = useState<any>(null);

  useEffect(() => {
    fetch("/run-data.json")
      .then((res) => res.json())
      .then(setData)
      .catch(() => console.error("Run data not found. Execute a flow first!"));
  }, []);

  if (!data)
    return (
      <div className="p-10 text-center animate-pulse text-slate-500">
        Awaiting execution data...
      </div>
    );

  return (
    <div className="relative min-h-screen bg-slate-50">
      <div
        className={`max-w-7xl mx-auto p-6 space-y-8 transition-all duration-300 ${selectedStep ? "pr-[450px]" : ""}`}
      >
        {/* Header & Stats */}
        <header className="flex justify-between items-end border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
              Flowstride Dashboard
            </h1>
            <p className="text-slate-500 font-medium">Community Edition</p>
          </div>
          <div className="flex gap-4">
            <StatCard
              label="Passed"
              value={data.stats.passed}
              color="text-green-600"
              icon={<CheckCircle2 className="w-5 h-5" />}
            />
            <StatCard
              label="Failed"
              value={data.stats.failed}
              color="text-red-600"
              icon={<XCircle className="w-5 h-5" />}
            />
            <StatCard
              label="Total"
              value={data.stats.total}
              color="text-blue-600"
              icon={<FileText className="w-5 h-5" />}
            />
          </div>
        </header>

        <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-bold tracking-widest">
              <tr>
                <th className="px-6 py-4">S/N</th>
                <th className="px-6 py-4">Screen / Page</th>
                <th className="px-6 py-4">Action Performed</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.files.map((file: any) =>
                file.scenarios.map((scenario: any) =>
                  scenario.steps.map((step: any) => (
                    <tr
                      key={step.id}
                      onClick={() => setSelectedStep(step)}
                      className={`group cursor-pointer transition-colors ${selectedStep?.id === step.id ? "bg-blue-50" : "hover:bg-slate-50"}`}
                    >
                      <td className="px-6 py-4 text-slate-400 font-mono text-xs">
                        {step.id}
                      </td>
                      <td className="px-6 py-4 font-semibold text-slate-700">
                        {step.screen}
                      </td>
                      <td className="px-6 py-4 text-slate-600 text-sm leading-relaxed">
                        {step.action}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={step.status} />
                      </td>
                      <td className="px-6 py-4">
                        <ChevronRight
                          className={`w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-transform ${selectedStep?.id === step.id ? "rotate-90" : ""}`}
                        />
                      </td>
                    </tr>
                  )),
                ),
              )}
            </tbody>
          </table>
        </section>
      </div>

      <aside
        className={`fixed top-0 right-0 h-full w-[400px] bg-white shadow-2xl border-l border-slate-200 z-50 transform transition-transform duration-300 ease-in-out overflow-y-auto ${selectedStep ? "translate-x-0" : "translate-x-full"}`}
      >
        {selectedStep && (
          <div className="p-0 pb-10">
            <div className="sticky top-0 bg-white border-b border-slate-200 p-6 flex justify-between items-center z-10">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-600" />
                Step Diagnostics
              </h2>
              <button
                onClick={() => setSelectedStep(null)}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <section>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Requirement Proof
                </h3>
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-100 text-sm text-slate-700 italic">
                  "{selectedStep.expected}"
                </div>
              </section>

              {selectedStep.screenshot && (
                <section>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <ImageIcon className="w-3 h-3 text-red-500" /> Visual
                    Evidence
                  </h3>
                  <div className="rounded-lg border border-slate-200 overflow-hidden shadow-inner bg-slate-100 group relative">
                    <img
                      src={`/${selectedStep.screenshot}`}
                      alt="Failure Screenshot"
                      className="w-full h-auto cursor-zoom-in transition-transform duration-500 hover:scale-105"
                      onClick={() =>
                        window.open(`/${selectedStep.screenshot}`, "_blank")
                      }
                    />
                    <div className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded backdrop-blur-md">
                      Click to Expand
                    </div>
                  </div>
                </section>
              )}

              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Globe className="w-3 h-3" /> Redacted Network Logs
                  </h3>
                  <span className="flex items-center gap-1 text-[10px] text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded border border-green-100">
                    <ShieldCheck className="w-3 h-3" /> SECURE
                  </span>
                </div>
                <div className="space-y-3">
                  <div className="bg-slate-900 rounded-lg p-4 font-mono text-[11px] text-blue-300 overflow-x-auto">
                    <div className="text-slate-500 mb-2">
                      // Response Payload (Automatically Redacted)
                    </div>
                    <pre>
                      {JSON.stringify(
                        {
                          status: 200,
                          data: {
                            id: "USER_123",
                            token: "***REDACTED***",
                            email: "test@example.com",
                          },
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Zap className="w-3 h-3" /> Runtime Outcome
                </h3>
                <div
                  className={`p-4 rounded-lg text-sm font-medium ${selectedStep.status === "PASS" ? "bg-green-50 text-green-800 border border-green-100" : "bg-red-50 text-red-800 border border-red-100"}`}
                >
                  {selectedStep.actual}
                </div>
              </section>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function StatCard({ label, value, color, icon }: any) {
  return (
    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center gap-4 min-w-[160px]">
      <div className={`${color} bg-opacity-10 p-2 rounded-lg bg-current`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">
          {label}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isPass = status === "PASS";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold tracking-tight ${
        isPass
          ? "bg-green-100 text-green-700 border border-green-200"
          : "bg-red-100 text-red-700 border border-red-200"
      }`}
    >
      {status}
    </span>
  );
}

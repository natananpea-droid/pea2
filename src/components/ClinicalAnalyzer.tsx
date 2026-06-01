import React, { useState } from "react";

interface ClinicalAnalyzerProps {
  onAnalysisCompleted: (priority: string, reason: string) => void;
}

export default function ClinicalAnalyzer({ onAnalysisCompleted }: ClinicalAnalyzerProps) {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ priority: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/analyze-priority", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "เกิดข้อผิดพลาดในการวิเคราะห์ลักษณะอาการป่วย");
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "ไม่สามารถเชื่อมต่อเครื่องมืออัจฉริยะวิเคราะห์ได้");
    } finally {
      setLoading(false);
    }
  };

  const priorityColors: Record<string, string> = {
    CRITICAL: "bg-rose-950 text-rose-400 border-rose-800/80 ring-red-500/20",
    HIGH: "bg-amber-950 text-amber-400 border-amber-800/80 ring-amber-500/20",
    MEDIUM: "bg-yellow-950 text-yellow-300 border-yellow-800/80 ring-yellow-400/20",
    LOW: "bg-slate-900 text-teal-400 border-slate-800 ring-teal-500/10",
  };

  const priorityThai: Record<string, string> = {
    CRITICAL: "⚠️ วิกฤตสูงสุด (CRITICAL) - ต้องใข้งานเครืองช่วยหายใจ",
    HIGH: "🚨 เร่งด่วนสูง (HIGH) - ต้องใช้งานเครื่องดูดเสมหะ/ผลิตออกซิเจน",
    MEDIUM: "🏥 ปานกลาง (MEDIUM) - ต้องการเตียงพยาบาลไฟฟ้า/ที่นอนลม",
    LOW: "👤 พื้นฐาน (LOW) - ผู้ป่วยติดเตียงดูแลประคองทั่วไป",
  };

  return (
    <div className="bg-slate-950/20 border border-slate-100 rounded-xl p-4 shadow-sm">
      <div className="flex items-center space-x-2 mb-2">
        <span className="text-xl">🤖</span>
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">ระบบตรวจคัดกรองจัดกลุ่มแพทย์อัจฉริยะ (Gemini AI Assessor)</h3>
          <p className="text-[11px] text-slate-500 mb-1">
            ระบุอธิบายความต้องการ หรือระบุรุ่นอุปกรณ์ของแพทย์เพื่อประเมินระดับความสำคัญอัตโนมัติ
          </p>
        </div>
      </div>

      <form onSubmit={handleAnalyze} className="space-y-3">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="พิมพ์ข้อความรายละเอียด เช่น 'ผู้ป่วยติดเตียงใช้เครื่องช่วยหายใจชนิดมีท่อหลอดลมเจาะคอนอนติดเตียงตลอดเวลา หรือใช้เครื่องผลิตออกซิเจนกระแสไฟหลัก'"
          className="w-full text-xs font-sans p-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 min-h-[70px] resize-y placeholder:text-slate-400"
          disabled={loading}
        />

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading || !description.trim()}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 text-xs text-white font-medium rounded-lg transition hover:shadow active:scale-95 cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <span className="animate-spin text-sm">🔄</span>
                <span>กำลังทำงานประเมินผ่านระบบ AI คลาวด์...</span>
              </>
            ) : (
              <>
                <span>✨</span>
                <span>วิเคราะห์ระบุระดับความฉุกเฉิน (AI Diagnostic)</span>
              </>
            )}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-3 p-2.5 bg-rose-50 text-rose-700 text-xs border border-rose-200 rounded-lg">
          ⚠️ {error}
        </div>
      )}

      {result && (
        <div className="mt-3 bg-white border border-slate-200 rounded-lg p-3 shadow-sm text-xs animate-fadeIn">
          <p className="font-semibold text-slate-800 text-[11px] uppercase tracking-wider mb-1.5 border-b border-slate-100 pb-1">
            ผลการวิเคราะห์ระดับความเร่งด่วนทางการแพทย์:
          </p>
          
          <div className="flex flex-col space-y-2">
            <div className={`p-2 rounded-md border font-bold text-center ${priorityColors[result.priority] || priorityColors.LOW}`}>
              {priorityThai[result.priority] || result.priority}
            </div>
            
            <div className="text-slate-600 leading-relaxed font-sans text-[11px] bg-slate-50 p-2 rounded border border-slate-100 italic">
              <b>เหตุผลสนับสนุน:</b> {result.reason}
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  onAnalysisCompleted(result.priority, result.reason);
                  setDescription("");
                  setResult(null);
                }}
                className="px-2.5 py-1 bg-teal-500 hover:bg-teal-600 text-white font-medium rounded text-[11px] transition hover:shadow active:scale-95 cursor-pointer"
              >
                📥 สังเคราะห์ลงทะเบียนผู้ป่วยและนำชั้นความสำคัญไปใช้งาน
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

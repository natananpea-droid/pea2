import React, { useState, useEffect } from "react";
import { Patient } from "../types";

interface PatientFormProps {
  initialPatient?: Patient | null;
  onSubmitSuccess: () => void;
  onCancel: () => void;
  mapSelectedCoords?: { lat: number; lng: number } | null;
}

export default function PatientForm({
  initialPatient,
  onSubmitSuccess,
  onCancel,
  mapSelectedCoords,
}: PatientFormProps) {
  const [pin, setPin] = useState("");
  const [showPinError, setShowPinError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // AI Risk assessment states
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<{ priority: string; reason: string } | null>(null);

  // Form State Fields
  const [formData, setFormData] = useState({
    owner_name: "",
    caregiver_name: "",
    ca_number: "",
    pea_number: "", // Keep it hidden or empty for database compatibility
    address_number: "",
    soi: "",
    road: "",
    sub_distric: "",
    distric: "",
    province: "ระยอง",
    postcode: "21000",
    latitude: "",
    longtitude: "",
    emergency_type: "LOW",
    emergency_description: "",
    status: "ACTIVE",
    telephone_number: "",
  });

  // Load initial patient if in edit mode
  useEffect(() => {
    if (initialPatient) {
      setFormData({
        owner_name: initialPatient.owner_name || "",
        caregiver_name: initialPatient.caregiver_name || "",
        ca_number: initialPatient.ca_number ? String(initialPatient.ca_number) : "",
        pea_number: initialPatient.pea_number ? String(initialPatient.pea_number) : "",
        address_number: initialPatient.address_number || "",
        soi: initialPatient.soi || "",
        road: initialPatient.road || "",
        sub_distric: initialPatient.sub_distric || "",
        distric: initialPatient.distric || "",
        province: initialPatient.province || "ระยอง",
        postcode: initialPatient.postcode ? String(initialPatient.postcode) : "21000",
        latitude: initialPatient.latitude || "",
        longtitude: initialPatient.longtitude || "",
        emergency_type: initialPatient.emergency_type || "LOW",
        emergency_description: initialPatient.emergency_description || "",
        status: initialPatient.status || "ACTIVE",
        telephone_number: initialPatient.telephone_number || "",
      });
    }
  }, [initialPatient]);

  // Handle clicked coordinates from parent map
  useEffect(() => {
    if (mapSelectedCoords) {
      setFormData((prev) => ({
        ...prev,
        latitude: mapSelectedCoords.lat.toFixed(6),
        longtitude: mapSelectedCoords.lng.toFixed(6),
      }));
    }
  }, [mapSelectedCoords]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAIAnalyze = async () => {
    if (!formData.emergency_description.trim()) {
      setErrorMsg("กรุณากรอกรายละเอียดรายละเอียดยี่ห้อ อุปกรณ์ทางการแพทย์ที่ต้องใช้ หรือภาวะครรภ์/อาการของผู้ป่วยติดเตียง ก่อนทำการให้ AI ช่วยประเมิน");
      return;
    }
    setErrorMsg(null);
    setAiAnalyzing(true);
    setAiResult(null);

    try {
      const res = await fetch("/api/analyze-priority", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description: formData.emergency_description }),
      });

      if (!res.ok) {
        let errMsg = "ล้มเหลวในการส่งข้อมูลวิเคราะห์ระดับเตียงไปยังระบบอัจฉริยะ";
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {
          try {
            const rawText = await res.text();
            if (rawText) {
              const cleaned = rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
              errMsg = cleaned.substring(0, 150) || errMsg;
            }
          } catch {}
        }
        throw new Error(errMsg);
      }

      let data;
      try {
        data = await res.json();
      } catch (jsonErr: any) {
        throw new Error("ระบบวิเคราะห์ผลลัพธ์ผิดพลาดเนื่องจากคำตอบไม่ได้อยู่ในรูปแบบ JSON: " + jsonErr.message);
      }

      setAiResult({
        priority: data.priority,
        reason: data.reason,
      });

      // Automatically update emergency priority level dynamically
      setFormData((prev) => ({
        ...prev,
        emergency_type: data.priority,
      }));
    } catch (err: any) {
      setErrorMsg("เกิดข้อผิดพลาดในการเชื่อมต่อคอร์สมอง AI: " + err.message);
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowPinError(false);

    // Thai Form validation checks
    if (!formData.owner_name.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุชื่อ-นามสกุลของผู้ป่วย");
      return;
    }
    if (!formData.caregiver_name.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุชื่อผู้ดูแลหลักหรือชื่อบนบิลค่าไฟ");
      return;
    }
    if (!formData.ca_number.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุหมายเลขผู้ใช้ไฟ CA Number");
      return;
    }
    if (!formData.telephone_number.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุเบอร์โทรศัพท์ติดต่อฉุกเฉิน");
      return;
    }
    if (!formData.address_number.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุบ้านเลขที่");
      return;
    }
    if (!formData.sub_distric.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุตำบล");
      return;
    }
    if (!formData.distric.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุอำเภอ");
      return;
    }
    if (!formData.postcode.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุรหัสไปรษณีย์");
      return;
    }
    if (!formData.latitude.trim() || !formData.longtitude.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุพิกัดละติจูดและลองจิจูด (คลิกเลือกพิกัดได้ง่ายๆ บนแผนที่แถบข้าง)");
      return;
    }
    if (!formData.emergency_description.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุรายละเอียดอาการผู้ป่วยและอุปกรณ์แพทย์ที่ใช้");
      return;
    }

    // Security PIN constraints must match h02101
    if (pin !== "h02101") {
      setShowPinError(true);
      setErrorMsg("รหัส PIN เจ้าหน้าที่ผู้ดูแลระบบเพื่อแก้ไขความปลอดภัยไม่ถูกต้อง! กรุณาลองใหม่อีกครั้ง");
      return;
    }

    setLoading(true);

    try {
      const url = initialPatient
        ? `/api/patients/${initialPatient.emer_house_id}`
        : "/api/patients";
      const method = initialPatient ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Admin-PIN": pin,
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        let errMsg = "ไม่สามารถลงทะเบียนบันทึกข้อมูลเข้าระบบพิกัดภัยพิบัติได้";
        try {
          const data = await res.json();
          errMsg = data.error || errMsg;
        } catch {
          try {
            const rawText = await res.text();
            if (rawText) {
              const cleaned = rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
              errMsg = cleaned.substring(0, 150) || errMsg;
            }
          } catch {}
        }
        throw new Error(errMsg);
      }

      setSuccessMsg("✓ ลงทะเบียนบันทึกข้อมูลประวัติผู้ป่วยพิกัดความปลอดภัยสำเร็จเรียบร้อยแล้ว");
      setTimeout(() => {
        onSubmitSuccess();
      }, 1500);
    } catch (err: any) {
      setErrorMsg("ข้อผิดพลาดในการเซฟฐานข้อมูล: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm leading-relaxed">
      <div className="flex border-b border-slate-200 pb-3 mb-4 justify-between items-center bg-violet-50/50 p-3 rounded-xl border border-violet-100">
        <h3 className="font-extrabold text-slate-800 text-sm flex items-center space-x-2">
          <span className="text-xl">🩺</span>
          <span className="font-sans text-slate-900">
            {initialPatient ? "แก้ไขประวัติทะเบียนผู้ป่วยเปราะบาง" : "แบบฟอร์มลงทะเบียนผู้ป่วยเข้าฐานพิกัดคุ้มครองไฟดับ"}
          </span>
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-800 bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg shadow-sm transition hover:scale-105"
        >
          ยกเลิก
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {/* Name details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-700 font-extrabold mb-1">ชื่อ-นามสกุล (ผู้ป่วย) *</label>
            <input
              type="text"
              name="owner_name"
              value={formData.owner_name}
              onChange={handleChange}
              required
              placeholder="กรอกชื่อ-นามสกุลของผู้ป่วยจริง"
              className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-violet-500/30"
            />
          </div>
          <div>
            <label className="block text-slate-700 font-extrabold mb-1">ชื่อตามบิลค่าไฟ (หรือผู้ดูแล) *</label>
            <input
              type="text"
              name="caregiver_name"
              value={formData.caregiver_name}
              onChange={handleChange}
              required
              placeholder="ระบุนามบนบิลค่าไฟฟ้า หรือชื่อ-นามสกุลผู้ดูแลหลักเพื่อใช้อ้างอิงสิทธิ"
              className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-violet-500/30"
            />
          </div>
        </div>

        {/* Electricity bill CA number and emergency telephone */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-700 font-extrabold mb-1">หมายเลขผู้ใช้ไฟ (CA Number) *</label>
            <input
              type="text"
              name="ca_number"
              value={formData.ca_number}
              onChange={handleChange}
              required
              placeholder="ระบุหมายเลข CA 12 หลัก บนหัวบิลค่าไฟฟ้า"
              className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-violet-500/30 font-mono tracking-wide"
            />
          </div>
          <div>
            <label className="block text-slate-700 font-extrabold mb-1">เบอร์โทรศัพท์ที่ไว้ติดต่อฉุกเฉิน *</label>
            <input
              type="tel"
              name="telephone_number"
              value={formData.telephone_number}
              onChange={handleChange}
              required
              placeholder="กรอกเบอร์โทรหลักสำหรับเตือนภัยอัตโนมัติ เช่น 08xxxxxxxx"
              className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-violet-500/30 font-mono tracking-wide"
            />
          </div>
        </div>

        {/* Address form block */}
        <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2 shadow-sm">
          <p className="font-extrabold text-[10px] text-violet-850 uppercase tracking-wider flex items-center space-x-1">
            <span>📍</span>
            <span>ที่อยู่ในการลงทะเบียนบิลไฟฟ้าเพื่อรับบริการตรวจจับไฟดับ</span>
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">บ้านเลขที่ *</label>
              <input
                type="text"
                name="address_number"
                value={formData.address_number}
                onChange={handleChange}
                placeholder="บ้านเลขที่และหมู่ที่"
                className="w-full p-1.5 border border-slate-300 rounded text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">ซอย</label>
              <input
                type="text"
                name="soi"
                value={formData.soi}
                onChange={handleChange}
                placeholder="ชื่อซอย (หากไม่มีใส่ -)"
                className="w-full p-1.5 border border-slate-300 rounded text-slate-800"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">ถนน</label>
              <input
                type="text"
                name="road"
                value={formData.road}
                onChange={handleChange}
                placeholder="ชื่อถนนหลัก"
                className="w-full p-1.5 border border-slate-300 rounded text-slate-800"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">ตำบล (Subdistrict) *</label>
              <input
                type="text"
                name="sub_distric"
                value={formData.sub_distric}
                onChange={handleChange}
                placeholder="เช่น เนินพระ, คลองปูน"
                className="w-full p-1.5 border border-slate-300 rounded text-slate-800"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">อำเภอ (District) *</label>
              <input
                type="text"
                name="distric"
                value={formData.distric}
                onChange={handleChange}
                placeholder="เช่น เมืองระยอง, แกลง"
                className="w-full p-1.5 border border-slate-300 rounded text-slate-800"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">จังหวัด *</label>
              <input
                type="text"
                name="province"
                value={formData.province}
                onChange={handleChange}
                className="w-full p-1.5 border border-slate-300 rounded bg-slate-50 text-slate-500 font-bold"
                required
                readOnly
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">รหัสไปรษณีย์ *</label>
              <input
                type="text"
                name="postcode"
                value={formData.postcode}
                onChange={handleChange}
                className="w-full p-1.5 border border-slate-300 rounded font-mono font-bold"
                required
              />
            </div>
          </div>
        </div>

        {/* Location / Coordinate Inputs taken directly from Map Click on Home view */}
        <div className="bg-slate-900 text-slate-100 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex justify-between items-center text-[10px] font-bold">
            <span className="text-slate-300">พิกัดทางภูมิศาสตร์ละติจูด/ลองจิจูด *</span>
            <span className="text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
              💡 คลิกเลือกตำแหน่งใดตำแหน่งหนึ่งบนแผนหน้าจอใหญ่เพื่อดึงพิกัดอัตโนมัติ
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] text-slate-400">ละติจูด (Lat)</label>
              <input
                type="text"
                name="latitude"
                value={formData.latitude}
                onChange={handleChange}
                required
                placeholder="12.682xxx"
                className="w-full p-1.5 bg-slate-800 border border-slate-700 text-white font-mono rounded text-center text-xs"
              />
            </div>
            <div>
              <label className="block text-[9px] text-slate-400">ลองจิจูด (Lng)</label>
              <input
                type="text"
                name="longtitude"
                value={formData.longtitude}
                onChange={handleChange}
                required
                placeholder="101.275xxx"
                className="w-full p-1.5 bg-slate-800 border border-slate-700 text-white font-mono rounded text-center text-xs"
              />
            </div>
          </div>
        </div>

        {/* Medical Devices Description Input (Required to type, then evaluated by AI Risk engine) */}
        <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200/60 p-4 rounded-xl space-y-3.5 shadow-inner">
          <div>
            <label className="block text-slate-800 font-extrabold mb-1.5 flex items-center space-x-1.5 text-xs">
              <span>🏥</span>
              <span>อุปกรณ์การแพทย์ที่ต้องใช้ และรายละเอียดอาการผู้ป่วย (กรอกเอง) *</span>
            </label>
            <textarea
              name="emergency_description"
              value={formData.emergency_description}
              onChange={handleChange}
              required
              placeholder="พิมพ์รายละเอียดด้วยลายมือท่านเอง เช่น 'ผู้ป่วยรักษาตัวมะเร็งระยะประคองชีพ ต้องต่อท่อผลิตออกซิเจนพยุงชีพและอัดเสมหะด้วยเครื่อง Suct-A ตลอด 24 ชม.'"
              className="w-full p-2.5 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-violet-500/30 font-sans text-xs text-slate-800 placeholder-slate-400 min-h-[70px] resize-y"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-lg border border-slate-200">
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">ระดับความเสี่ยงภัยพิบัติ (ความเร่งด่วนการพยาบาล):</span>
              <span
                className={`text-[11px] font-black uppercase px-2.5 py-1 rounded-full border inline-block ${
                  formData.emergency_type === "CRITICAL"
                    ? "bg-red-500 text-white border-red-600"
                    : formData.emergency_type === "HIGH"
                    ? "bg-amber-500 text-slate-950 border-amber-600"
                    : formData.emergency_type === "MEDIUM"
                    ? "bg-sky-500 text-white border-sky-600"
                    : "bg-emerald-500 text-white border-emerald-600"
                }`}
              >
                {formData.emergency_type === "CRITICAL"
                  ? "🚨 CRITICAL (เสี่ยงวิกฤตสูงสุด)"
                  : formData.emergency_type === "HIGH"
                  ? "⚠️ HIGH (เสี่ยงสูงมาก)"
                  : formData.emergency_type === "MEDIUM"
                  ? "🏥 MEDIUM (เสี่ยงปานกลาง)"
                  : "👤 LOW (เสี่ยงน้อย/ทั่วไป)"}
              </span>
            </div>

            <button
              type="button"
              onClick={handleAIAnalyze}
              disabled={aiAnalyzing}
              className="flex items-center justify-center space-x-1 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-300 text-white font-extrabold rounded-lg cursor-pointer transition active:scale-95 text-xs shadow-sm shadow-indigo-100"
            >
              <span>{aiAnalyzing ? "⏳ AI กำลังอ่านข้อมูลและวินิจฉัย..." : "🤖 ส่งให้ AI ประเมินความเสี่ยงสุภาพ (Auto)"}</span>
            </button>
          </div>

          {/* AI Result indicator details panel */}
          {aiResult && (
            <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg space-y-1 animate-fadeIn">
              <span className="text-[10px] text-indigo-900 font-extrabold block">⚡ ผลสรุปคำนวณสภาวะเร่งด่วนโดยระบบ AI อัจฉริยะ:</span>
              <p className="text-[11px] text-slate-700 font-medium leading-relaxed">{aiResult.reason}</p>
            </div>
          )}
        </div>

        {/* Security / Admin Verification Code input */}
        <div className="border border-violet-200 bg-violet-50/50 p-3.5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <label className="block text-slate-800 font-extrabold">รหัสผ่านแอดมินสำหรับเซฟข้อมูล (PIN Code) *</label>
            <p className="text-[10.5px] text-violet-600 font-medium">ระบุ PIN ความปลอดภัยแอดมินผู้ดูแลระบบเพื่ออนุญาตอัปเดตไฟล์ข้อมูลเข้าสู่คลังฐานข้อมูลระยอง</p>
          </div>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="ระบุรหัส PIN แอดมิน"
            maxLength={10}
            required
            className="w-full md:w-36 p-2 border border-violet-300 rounded-lg text-center text-xs font-mono font-bold bg-white"
          />
        </div>

        {showPinError && (
          <div className="p-2.5 bg-rose-100 text-rose-800 font-bold rounded-lg text-center">
            ❌ รหัสผ่านแอดมินเจ้าหน้าที่คุมระบบผิดพลาด! กรุณากรอกรหัสผ่านที่ถูกต้อง
          </div>
        )}

        {errorMsg && (
          <div className="p-2.5 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-100 font-medium">
            ⚠️ {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-2.5 bg-teal-50 text-teal-800 font-black rounded-lg text-center border border-teal-100 text-xs">
            {successMsg}
          </div>
        )}

        {/* Control Actions buttons */}
        <div className="flex justify-end space-x-2.5 pt-2 mb-1 border-t border-slate-200">
          <button
            type="button"
            onClick={onCancel}
            className="px-4.5 py-2 hover:bg-slate-100 text-slate-700 font-semibold border border-slate-200 bg-white rounded-lg transition"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-violet-700 hover:bg-violet-800 disabled:bg-slate-300 text-white font-extrabold rounded-lg transition shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-95 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? "💾 กำลังบันทึก..." : initialPatient ? "💾 อัปเดตประวัติสิทธิ" : "💾 ลงทะเบียนพิกัดผู้ป่วย"}
          </button>
        </div>
      </form>
    </div>
  );
}
export { PatientForm };

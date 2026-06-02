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

  // Form State Fields
  const [formData, setFormData] = useState({
    owner_name: "",
    ca_number: "",
    pea_number: "",
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

  // Handle map clicked coordinates
  useEffect(() => {
    if (mapSelectedCoords) {
      setFormData((prev) => ({
        ...prev,
        latitude: mapSelectedCoords.lat.toFixed(6),
        longtitude: mapSelectedCoords.lng.toFixed(6),
      }));
    }
  }, [mapSelectedCoords]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleApplyAIPress = (priority: string, reason: string) => {
    setFormData((prev) => ({
      ...prev,
      emergency_type: priority,
      emergency_description: `${prev.emergency_description}\n[AI ประเมินระดับ ${priority}]: ${reason}`.trim(),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowPinError(false);

    // Strict security request: PIN code must be h02101
    if (pin !== "h02101") {
      setShowPinError(true);
      setErrorMsg("รหัส PIN แอดมินสำหรับการแก้ไขฐานข้อมูลไม่ถูกต้อง! กรุณาลองใหม่อีกครั้ง");
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
          "X-Admin-PIN": pin, // Validate on server-side as well
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "เกิดข้อผิดพลาดในการบันทึกข้อมูลผู้ป่วย");
      }

      const reply = await res.json();
      setSuccessMsg(reply.message || "บันทึกข้อมูลผู้ป่วยเสร็จเรียบร้อยแล้ว");
      
      setTimeout(() => {
        onSubmitSuccess();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || "ไม่สามารถติดต่อเซิร์ฟเวอร์ระบบรักษาระดับชีวิตได้");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-inner leading-relaxed">
      <div className="flex border-b border-slate-200 pb-2 mb-4 justify-between items-center bg-violet-50 p-2.5 rounded-lg">
        <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-1">
          <span>🩺</span>
          <span>{initialPatient ? "แก้ไขประวัติทะเบียนผู้ป่วยเปราะบาง" : "เพิ่มทะเบียนลงทะเบียนผู้ป่วยใหม่"}</span>
        </h3>
        <button
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-800 bg-slate-200 px-2 py-1 rounded transition hover:scale-105"
        >
          ยกเลิก
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
        {/* Name and Phone */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-700 font-bold mb-1">ชื่อ-นามสกุล ผู้ดูแลผู้ป่วย (Bedridden Patient Owner)</label>
            <input
              type="text"
              name="owner_name"
              value={formData.owner_name}
              onChange={handleChange}
              required
              placeholder="นาย สมชาย รักชีวิต"
              className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-violet-500/30"
            />
          </div>
          <div>
            <label className="block text-slate-700 font-bold mb-1">เบอร์โทรศัพท์ติดต่อ (Telephone Number)</label>
            <input
              type="text"
              name="telephone_number"
              value={formData.telephone_number}
              onChange={handleChange}
              required
              placeholder="เช่น 081-234-5678"
              className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-violet-500/30"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-700 font-bold mb-1">หมายเลขคำรับคำขอ / บัญชี (CA Number)</label>
            <input
              type="text"
              name="ca_number"
              value={formData.ca_number}
              onChange={handleChange}
              placeholder="เฉพาะตัวเลข เช่น 0200012345"
              className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-violet-500/30"
            />
          </div>
          <div>
            <label className="block text-slate-700 font-bold mb-1">หมายเลขเครื่องวัด PEA (PEA Meter ID)</label>
            <input
              type="text"
              name="pea_number"
              value={formData.pea_number}
              onChange={handleChange}
              placeholder="กรอกหมายเลขมิเตอร์ประจําบ้านผู้รับสิทธิ์"
              className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-violet-500/30"
            />
          </div>
        </div>

        <div>
          <label className="block text-slate-700 font-bold mb-1">ระดับประเภทความเร่งด่วนทางด่วนการแพทย์</label>
          <select
            name="emergency_type"
            value={formData.emergency_type}
            onChange={handleChange}
            className="w-full p-2 bg-white border border-slate-300 rounded font-bold text-violet-800"
          >
            <option value="CRITICAL">🚨 CRITICAL (วิกฤต: เครื่องช่วยหายใจ)</option>
            <option value="HIGH">⚠️ HIGH (สูง: ดูดเสมหะ/ผลิตออกซิเจน)</option>
            <option value="MEDIUM">🏥 MEDIUM (กลาง: เตียงไฟฟ้า/ที่นอนลม)</option>
            <option value="LOW">👤 LOW (ธรรมดา: ติดเตียงพยุงประคองทั่วไป)</option>
          </select>
        </div>

        {/* Address group */}
        <div className="bg-white/80 p-3 rounded-lg border border-slate-200 space-y-2">
          <p className="font-semibold text-[11px] text-slate-500 uppercase tracking-wide">ข้อมูลภูมิศาสตร์จริงใน อ.เมืองระยอง</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">บ้านเลขที่</label>
              <input
                type="text"
                name="address_number"
                value={formData.address_number}
                onChange={handleChange}
                placeholder="999/99"
                className="w-full p-1.5 border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">ซอย</label>
              <input
                type="text"
                name="soi"
                value={formData.soi}
                onChange={handleChange}
                placeholder="ซอยสุขใจ"
                className="w-full p-1.5 border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">ถนน</label>
              <input
                type="text"
                name="road"
                value={formData.road}
                onChange={handleChange}
                placeholder="ถ.สุขุมวิท"
                className="w-full p-1.5 border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">ตำบล (sub-district)</label>
              <input
                type="text"
                name="sub_distric"
                value={formData.sub_distric}
                onChange={handleChange}
                placeholder="ท่าประดู่"
                className="w-full p-1.5 border border-slate-300 rounded"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">อำเภอ (district)</label>
              <input
                type="text"
                name="distric"
                value={formData.distric}
                onChange={handleChange}
                placeholder="เมืองระยอง"
                className="w-full p-1.5 border border-slate-300 rounded"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">จังหวัด</label>
              <input
                type="text"
                name="province"
                value={formData.province}
                onChange={handleChange}
                className="w-full p-1.5 border border-slate-300 rounded bg-slate-50 text-slate-500"
                required
                readOnly
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">รหัสไปรษณีย์</label>
              <input
                type="text"
                name="postcode"
                value={formData.postcode}
                onChange={handleChange}
                className="w-full p-1.5 border border-slate-300 rounded"
                required
              />
            </div>
          </div>
        </div>

        {/* GIS Lat/Lng selection */}
        <div className="bg-slate-900 text-slate-100 p-3 rounded-lg border border-slate-700 space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="block text-[10px] text-slate-300 font-bold">พิกัดทางภูมิศาสตร์จริง (Real GIS Coordinates)</label>
            <span className="text-[10px] text-amber-400 font-bold">💡 ดึงค่าอัตโนมัติจากการจิ้มพิกัดบนแผนที่</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[9px] text-slate-400">ละติจูด (Latitude)</label>
              <input
                type="text"
                name="latitude"
                value={formData.latitude}
                onChange={handleChange}
                required
                placeholder="12.682xxx"
                className="w-full p-1.5 bg-slate-800 border border-slate-700 text-white rounded font-mono text-[11px]"
              />
            </div>
            <div>
              <label className="block text-[9px] text-slate-400">ลองจิจูด (Longitude)</label>
              <input
                type="text"
                name="longtitude"
                value={formData.longtitude}
                onChange={handleChange}
                required
                placeholder="101.275xxx"
                className="w-full p-1.5 bg-slate-800 border border-slate-700 text-white rounded font-mono text-[11px]"
              />
            </div>
          </div>
        </div>

        {/* Medical Devices Description */}
        <div>
          <label className="block text-slate-700 font-bold mb-1">รายละเอียดเครื่องมือแพทย์ อาการหรือความจำเป็นในการใช้ไฟ</label>
          <textarea
            name="emergency_description"
            value={formData.emergency_description}
            onChange={handleChange}
            placeholder="รายละเอียดและวิธีพยุงชีพกรณีวิกฤต เช่น 'ผู้ป่วยรักษาตัวกรณีปอดอุดกั้นเรื้อรัง ต้องอัดพ่นออกซิเจนผ่านเครื่อง EverFlo ตลอดช่วงดับกระแสไฟ'"
            className="w-full p-2 bg-white border border-slate-300 rounded focus:ring-1 focus:ring-violet-500/30 font-sans min-h-[50px] resize-y"
          />
        </div>

        {/* Admin PIN Block */}
        <div className="border border-violet-200 bg-violet-50/50 p-3 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-2.5">
          <div>
            <label className="block text-slate-800 font-black mb-0.5">กรอกคีย์ความปลอดภัยแอดมิน (PIN สำหรับเซฟข้อมูล)</label>
            <p className="text-[10px] text-violet-600 font-semibold mb-0.5">สําหรับผู้ดูแลเท่านั้น บันทึก/ลบพิกัดป้องกันด้วย PIN</p>
          </div>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="กรอก PIN แอดมิน"
            maxLength={10}
            required
            className="w-full md:w-32 p-1.5 border border-violet-400 rounded text-center text-xs font-mono font-bold bg-white"
          />
        </div>

        {showPinError && (
          <div className="p-2 bg-rose-100 text-rose-800 font-medium rounded text-center">
            ❌ รหัสผ่านแอดมินไม่ถูกต้อง! กรุณากรอกรหัสผ่านแอดมินที่ถูกต้องเพื่อแก้ไขฐานข้อมูล
          </div>
        )}

        {errorMsg && (
          <div className="p-2 bg-rose-50 text-rose-700 text-[11px] rounded border border-rose-100">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-2 bg-teal-50 text-teal-800 font-medium rounded text-center border border-teal-100">
            ✅ {successMsg}
          </div>
        )}

        <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 font-medium text-slate-800 rounded transition"
          >
            ยกเลิก
          </button>
          
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 bg-violet-700 hover:bg-violet-800 disabled:bg-slate-300 text-white font-bold rounded transition hover:shadow-lg active:scale-95 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? "กำลังปรับปรุงฐานข้อมูล..." : initialPatient ? "อัปเดตประวัติ" : "เพิ่มผู้ป่วยเข้าพิกัดคุ้มครอง"}
          </button>
        </div>
      </form>
    </div>
  );
}
export { PatientForm };

import React, { useState, useEffect } from "react";

interface OutageFormProps {
  reporterPhone: string;
  onReportSuccess: () => void;
  mapSelectedCoords?: { lat: number; lng: number } | null;
}

export default function OutageForm({
  reporterPhone,
  onReportSuccess,
  mapSelectedCoords,
}: OutageFormProps) {
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    reporter_telephone_number: reporterPhone,
    reporter_name: "",
    report_type: "",
    address_number: "",
    soi: "",
    road: "",
    sub_distric: "",
    distric: "เมืองระยอง",
    province: "ระยอง",
    postcode: "21000",
    latitude: "",
    longtitude: "",
  });

  // Keep phone sync
  useEffect(() => {
    setFormData((prev) => ({ ...prev, reporter_telephone_number: reporterPhone }));
  }, [reporterPhone]);

  // Sync clicked coordinates on the map
  useEffect(() => {
    if (mapSelectedCoords) {
      setFormData((prev) => ({
        ...prev,
        latitude: mapSelectedCoords.lat.toFixed(6),
        longtitude: mapSelectedCoords.lng.toFixed(6),
      }));
    }
  }, [mapSelectedCoords]);

  // Attempt to load client GPS coordinates immediately on mount helper
  const tryFetchDeviceGPS = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setFormData((prev) => ({
            ...prev,
            latitude: pos.coords.latitude.toFixed(6),
            longtitude: pos.coords.longitude.toFixed(6),
          }));
        },
        (err) => {
          console.warn("Could not retrieve GPS coordinate:", err);
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  };

  useEffect(() => {
    tryFetchDeviceGPS();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(null);
    setErrorMsg(null);

    // Thai Form validation checks
    if (!formData.reporter_name.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุชื่อผู้แจ้งรายงาน");
      return;
    }
    if (!formData.reporter_telephone_number.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุเบอร์โทรศัพท์ติดต่อกลับ");
      return;
    }
    if (!formData.report_type.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุรายละเอียดอาการ/สาเหตุของปัญหาไฟตกดับ");
      return;
    }
    if (!formData.address_number.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุรายละเอียดบ้านเลขที่/พิกัดสถานที่");
      return;
    }
    if (!formData.sub_distric.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุตำบลผู้รับเหตุ");
      return;
    }
    if (!formData.latitude.trim() || !formData.longtitude.trim()) {
      setErrorMsg("กรุณากรอกข้อมูลให้ครบถ้วน: ระบุพิกัดละติจูดและลองจิจูด (คุณสามารถจิ้มตำแหน่งง่ายๆ บนแผนที่แถบข้าง)");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        let errMsg = "ไม่สามารถขอรับส่งแจ้งเหตุการณ์ได้ในขณะนี้";
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

      setSuccessMsg("แจ้งเหตุการณ์ไฟฟ้าขัดข้องสำเร็จ! ขอบคุณที่ร่วมปกป้องผู้ป่วยกลุ่มเปราะบาง");
      
      // Reset form fields
      setFormData({
        reporter_telephone_number: reporterPhone,
        reporter_name: "",
        report_type: "",
        address_number: "",
        soi: "",
        road: "",
        sub_distric: "",
        distric: "เมืองระยอง",
        province: "ระยอง",
        postcode: "21000",
        latitude: "",
        longtitude: "",
      });

      setTimeout(() => {
        onReportSuccess();
        setSuccessMsg(null);
      }, 1500);

    } catch (err: any) {
      setErrorMsg(err.message || "ล้มเหลวในการเชื่อมต่อเซิร์ฟเวอร์");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="border-b border-slate-200 pb-2 mb-3 bg-teal-50 p-2.5 rounded-lg">
        <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-1.5">
          <span>📢</span>
          <span>แจ้งเหตุการณ์ไฟฟ้าดับ / ภัยพิบัติในพื้นที่</span>
        </h3>
        <p className="text-[10px] text-teal-700 font-semibold">
          ข้อมูลร้องเรียนจะปรากฏบนแผนที่เฝ้าระวังทันทีเพื่อแจ้งเตือนอาสาสมัครคุ้มครองชีวิต
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-slate-700 font-bold mb-1">ชื่อผู้รายงาน (หรือเขียน ไม่ประสงค์บอกนาม)</label>
            <input
              type="text"
              name="reporter_name"
              value={formData.reporter_name}
              onChange={handleChange}
              required
              placeholder="สมศักดิ์ รักถิ่นระยอง"
              className="w-full p-2 bg-white border border-slate-300 rounded"
            />
          </div>
          <div>
            <label className="block text-slate-700 font-bold mb-1">เบอร์โทรศัพท์ติดต่อดำเนินงานกลับ</label>
            <input
              type="tel"
              name="reporter_telephone_number"
              value={formData.reporter_telephone_number}
              onChange={handleChange}
              required
              placeholder="081XXXXXXX"
              className="w-full p-2 bg-slate-100 border border-slate-300 rounded text-slate-500 font-mono"
              readOnly
            />
          </div>
        </div>

        <div>
          <label className="block text-slate-700 font-bold mb-1">ระบุรายละเอียด/สาเหตุของปัญหาไฟตกดับ (กรอกข้อมูลเอง)</label>
          <input
            type="text"
            name="report_type"
            value={formData.report_type}
            onChange={handleChange}
            required
            placeholder="เช่น หม้อแปลงระเบิดหน้าปากซอย, ไฟตกตลอดทั้งบ่าย, หรือสายไฟขาดเป็นอันตราย"
            className="w-full p-2 bg-white border border-slate-300 rounded"
          />
        </div>

        {/* Address sub-form */}
        <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-2">
          <p className="font-semibold text-[10px] text-slate-400 uppercase tracking-wider">รายละเอียดสถานที่สบเหตุใน ระยอง</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">บ้านเลขที่/สถานที่</label>
              <input
                type="text"
                name="address_number"
                value={formData.address_number}
                onChange={handleChange}
                placeholder="20/4"
                className="w-full p-1.5 border border-slate-300 rounded"
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
                placeholder="เลี่ยงเมือง 3"
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
                placeholder="ถ.ท่าประดู่"
                className="w-full p-1.5 border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">ตำบล/แขวง</label>
              <input
                type="text"
                name="sub_distric"
                value={formData.sub_distric}
                onChange={handleChange}
                placeholder="เชิงเนิน"
                className="w-full p-1.5 border border-slate-300 rounded"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-slate-600 font-bold">อำเภอ/เขต</label>
              <input
                type="text"
                name="distric"
                value={formData.distric}
                onChange={handleChange}
                placeholder="เมืองระยอง"
                className="w-full p-1.5 border border-slate-300 rounded bg-slate-50 text-slate-500"
                required
                readOnly
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

        {/* Location selectors */}
        <div className="bg-slate-900 text-slate-100 p-3 rounded-lg border border-slate-700 space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-slate-300 font-bold">พิกัดอุบัติภัย (Auto Lat/Lng)</span>
            <button
              type="button"
              onClick={tryFetchDeviceGPS}
              className="text-[9px] bg-sky-600 hover:bg-sky-500 text-white font-bold px-2 py-0.5 rounded transition cursor-pointer"
            >
              🔄 จับพิกัด GPS อุปกรณ์ในมือ
            </button>
          </div>
          <p className="text-[9px] text-amber-300">💡 คุณสามารถเปลี่ยนพิกัดได้ง่ายๆ โดยการคลิกตำแหน่งพิกัดดั่งกล่าวบนแผนที่ด้านขวามือ</p>
          
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

        {errorMsg && (
          <div className="p-2 bg-rose-50 text-rose-700 border border-rose-100 rounded text-center">
            ⚠️ {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-2.5 bg-teal-500 text-white font-bold rounded text-center animate-pulse">
            {successMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !formData.latitude || !formData.longtitude}
          className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white font-bold rounded-lg transition hover:shadow-md hover:scale-[1.01] active:scale-95 disabled:cursor-not-allowed cursor-pointer text-xs"
        >
          {loading ? "กำลังบันทึกข้อมูลเข้าระบบเตือนภัย..." : "🚀 ยืนยันแจ้งเหตุและรวบรวมข้อมูลหน่วยกู้ชีพระยอง"}
        </button>
      </form>
    </div>
  );
}
export { OutageForm };

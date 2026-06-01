import React, { useState, useEffect, useRef, useMemo } from "react";
import SurveillanceMap from "./components/SurveillanceMap";
import OutageForm from "./components/OutageForm";
import PatientForm from "./components/PatientForm";
import ClinicalAnalyzer from "./components/ClinicalAnalyzer";
import { Patient, OutageReport, AccountType } from "./types";
import { calculateHaversineDistance, formatDistance } from "./utils/geo";
import {
  ShieldAlert,
  Volume2,
  VolumeX,
  Plus,
  Edit2,
  Trash2,
  LogOut,
  MapPin,
  ListFilter,
  CheckCircle2,
  Activity,
  AlertTriangle,
  Building2,
  User,
  Users,
  Moon,
  Sun,
  Search,
  Check
} from "lucide-react";

export default function App() {
  // Navigation & Authentication state
  const [accountType, setAccountType] = useState<AccountType>("NONE");
  const [currentPage, setCurrentPage] = useState<"LOGIN" | "CONSUMER" | "ADMIN">("LOGIN");
  
  // Login input states
  const [consumerPhone, setConsumerPhone] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [currentPhoneUser, setCurrentPhoneUser] = useState<string | null>(null);

  // Core synchronization storage
  const [patients, setPatients] = useState<Patient[]>([]);
  const [reports, setReports] = useState<OutageReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  // Administrative map simulation & tools
  const [outageZoneCenter, setOutageZoneCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [outageZoneRadius, setOutageZoneRadius] = useState<number>(1.5); // Default 1.5 Kilometers
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Filter conditions for Admin panel
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [subdistrictFilter, setSubdistrictFilter] = useState<string>("ALL");

  // Admin CRUD Editor control
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [editorMapSelectedCoords, setEditorMapSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [instantReporting, setInstantReporting] = useState(false);

  // Web Audio API siren alert synchronization refs
  const [isMuted, setIsMuted] = useState(false);
  const sirenAudioContextRef = useRef<AudioContext | null>(null);
  const sirenOscillatorRef = useRef<OscillatorNode | null>(null);
  const sirenModulatorRef = useRef<OscillatorNode | null>(null);
  const sirenModGainRef = useRef<GainNode | null>(null);
  const sirenGainNodeRef = useRef<GainNode | null>(null);

  // Load backend database records on startup
  const fetchData = async () => {
    setLoading(true);
    setErrorStatus(null);
    try {
      // 1. Fetch Patients (emergency_house)
      const patientRes = await fetch("/api/patients");
      const patientData: Patient[] = await patientRes.json();
      setPatients(Array.isArray(patientData) ? patientData : []);

      // 2. Fetch Outage Reports (electricity_down_report)
      const reportRes = await fetch("/api/reports");
      const reportData: OutageReport[] = await reportRes.json();
      setReports(Array.isArray(reportData) ? reportData : []);
    } catch (err: any) {
      console.error("Failed to load records from Supabase:", err);
      setErrorStatus("ล้มเหลวในการเชื่อมโยงกับฐานข้อมูลจังหวัดระยอง: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Compute subdistricts list for filter options
  const subdistricts = useMemo(() => {
    const list = new Set<string>();
    patients.forEach((p) => {
      if (p.sub_distric) list.add(p.sub_distric.trim());
    });
    return Array.from(list);
  }, [patients]);

  // Handle click on map relative to current tab
  const handleMapClick = (lat: number, lng: number) => {
    if (currentPage === "ADMIN") {
      if (showPatientForm) {
        // Set coordinates for add/edit form
        setEditorMapSelectedCoords({ lat, lng });
      } else {
        // Set simulated outage zone center point
        setOutageZoneCenter({ lat, lng });
      }
    } else {
      // For Consumer, bind coordinate to report submission
      setEditorMapSelectedCoords({ lat, lng });
    }
  };

  // Auth: Consumers Login
  const handleConsumerLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consumerPhone.trim()) return;
    
    // Save phone, route immediately to Consumer Page
    setAccountType("CONSUMER");
    setCurrentPhoneUser(consumerPhone);
    setCurrentPage("CONSUMER");
    // Clear login fields
    setAdminPassword("");
  };

  // Auth: Administrator Login
  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate PIN criteria (h02101)
    if (adminPassword === "h02101") {
      setAccountType("ADMIN");
      setCurrentPage("ADMIN");
      // Clear password field
      setAdminPassword("");
    } else {
      alert("รหัสผ่านไม่ถูกต้อง! กรุณากรอกรหัสแอดมินเจ้าหน้าที่ให้ถูกต้อง");
    }
  };

  // Log Out Sequence
  const handleLogout = () => {
    // Shutdown active sirens
    stopSiren();
    setAccountType("NONE");
    setCurrentPage("LOGIN");
    setConsumerPhone("");
    setAdminPassword("");
    setCurrentPhoneUser(null);
    setOutageZoneCenter(null);
    setSelectedPatientId(null);
    setShowPatientForm(false);
    setEditingPatient(null);
  };

  // Haversine computation: Calculate which patients are affected by active outages
  // Returns patient array with distanceFromOutage & isAffected injection
  const computedPatients = useMemo(() => {
    // Determine active outage zone coordinates
    // We scan both the user-drawn simulated outage zone AND database reported blackouts (where fixed_status !== 'RESOLVED')
    return patients.map((p) => {
      const pLat = parseFloat(p.latitude || "0");
      const pLng = parseFloat(p.longtitude || "0");
      if (isNaN(pLat) || isNaN(pLng)) return { ...p, isAffected: false };

      // 1. Check intersection with drawn/simulated blackouts
      let minSimDist = Infinity;
      if (outageZoneCenter) {
        minSimDist = calculateHaversineDistance(outageZoneCenter.lat, outageZoneCenter.lng, pLat, pLng);
      }

      // 2. Check intersection with real database blackouts in Rayong
      let minReportDist = Infinity;
      reports.forEach((rep) => {
        if (rep.fixed_status !== "RESOLVED") {
          const rLat = parseFloat(rep.latitude || "0");
          const rLng = parseFloat(rep.longtitude || "0");
          if (!isNaN(rLat) && !isNaN(rLng)) {
            const dist = calculateHaversineDistance(rLat, rLng, pLat, pLng);
            if (dist < minReportDist) minReportDist = dist;
          }
        }
      });

      const isAffectedBySim = outageZoneCenter && minSimDist <= outageZoneRadius;
      const isAffectedByReport = minReportDist <= 1.5; // standard report radius 1.5km
      const finalDist = Math.min(minSimDist, minReportDist);

      return {
        ...p,
        distanceFromOutage: finalDist === Infinity ? undefined : finalDist,
        // If they fall inside either active zone radius, state overrides to ⚠️ OUTAGE (Affected)
        isAffected: isAffectedBySim || isAffectedByReport,
      };
    });
  }, [patients, reports, outageZoneCenter, outageZoneRadius]);

  // Extract count of patients currently impacted by blackouts
  const affectedVulnerableCount = useMemo(() => {
    return computedPatients.filter((p) => p.isAffected).length;
  }, [computedPatients]);

  // Sound Alarm synthesis logic via Web Audio API wailing siren
  const startSiren = () => {
    if (isMuted) return;
    try {
      if (sirenAudioContextRef.current) return; // already playing

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      sirenAudioContextRef.current = ctx;

      // 1. Oscillator for high frequency alert
      const osc = ctx.createOscillator();
      sirenOscillatorRef.current = osc;
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);

      // 2. Oscillator LFO for sirens alternation effect (wobble)
      const mod = ctx.createOscillator();
      sirenModulatorRef.current = mod;
      mod.type = "sine";
      mod.frequency.setValueAtTime(1.5, ctx.currentTime); // 1.5 Hz rate

      const modGain = ctx.createGain();
      sirenModGainRef.current = modGain;
      modGain.gain.setValueAtTime(150, ctx.currentTime); // modulate oscillation range +/- 150hz

      // Connect LFO Modulator to Main Oscillator frequency channel
      mod.connect(modGain);
      modGain.connect(osc.frequency);

      // 3. Audio gain controls for wailing
      const gainNode = ctx.createGain();
      sirenGainNodeRef.current = gainNode;
      gainNode.gain.setValueAtTime(0.08, ctx.currentTime); // low safety ambient volume

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Start synthesizer nodes
      osc.start();
      mod.start();
      console.log("Synthesizer Siren Alarm ACTIVATED.");
    } catch (soundErr) {
      console.warn("Failed to instantiate Web Audio API synthesizer node:", soundErr);
    }
  };

  const stopSiren = () => {
    try {
      if (sirenOscillatorRef.current) {
        sirenOscillatorRef.current.stop();
        sirenOscillatorRef.current.disconnect();
        sirenOscillatorRef.current = null;
      }
      if (sirenModulatorRef.current) {
        sirenModulatorRef.current.stop();
        sirenModulatorRef.current.disconnect();
        sirenModulatorRef.current = null;
      }
      if (sirenModGainRef.current) {
        sirenModGainRef.current.disconnect();
        sirenModGainRef.current = null;
      }
      if (sirenGainNodeRef.current) {
        sirenGainNodeRef.current.disconnect();
        sirenGainNodeRef.current = null;
      }
      if (sirenAudioContextRef.current) {
        if (sirenAudioContextRef.current.state !== "closed") {
          sirenAudioContextRef.current.close();
        }
        sirenAudioContextRef.current = null;
      }
      console.log("Synthesizer Siren Alarm DEACTIVATED.");
    } catch (stopErr) {
      console.warn("Error stopping wailing alarm synthesizer:", stopErr);
    }
  };

  // Synchronize wailing siren sound with impacted patients state
  useEffect(() => {
    // Siren should trigger ONLY on ADMIN dashboard when at least one patient is currently in 'OUTAGE' impact zone
    if (currentPage === "ADMIN" && affectedVulnerableCount > 0 && !isMuted) {
      startSiren();
    } else {
      stopSiren();
    }

    return () => {
      stopSiren();
    };
  }, [currentPage, affectedVulnerableCount, isMuted]);

  // Handle Mute actions
  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      // Wait for next tick/render to let useEffect start it back
    } else {
      setIsMuted(true);
      stopSiren();
    }
  };

  // Admin delete patient request
  const handleDeletePatient = async (id: string) => {
    try {
      const res = await fetch(`/api/patients/${id}`, {
        method: "DELETE",
        headers: {
          "X-Admin-PIN": "h02101" // Admin validation
        }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "ไม่สามารถทำการเชื่อมลบข้อมูลพิกัดผู้ป่วยได้สำเร็จ");
      }

      alert("ลบพิกัดข้อมูลผู้ป่วยออกจากระบบเรียบร้อยแล้ว");
      setDeleteConfirmId(null);
      fetchData(); // reload records
    } catch (err: any) {
      alert("ล้มเหลวในการลบ: " + err.message);
    }
  };

  // Instant report/resolve for registered users utilizing their registration coordinates
  const handleInstantReport = async (p: Patient) => {
    setInstantReporting(true);
    try {
      const payload = {
        reporter_telephone_number: currentPhoneUser || p.telephone_number || "",
        reporter_name: `${p.owner_name} (แจ้งเตือนด่วนผ่านระบบทะเบียน)`,
        report_type: "ไฟดับ",
        address_number: p.address_number || "",
        soi: p.soi || "",
        road: p.road || "",
        sub_distric: p.sub_distric || "",
        distric: p.distric || "เมืองระยอง",
        province: p.province || "ระยอง",
        postcode: p.postcode || "21000",
        latitude: p.latitude || "",
        longtitude: p.longtitude || ""
      };

      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "ไม่สามารถขอรับส่งแจ้งเหตุการณ์ได้ในขณะนี้");
      }

      alert("✓ แจ้งเหตุการณ์ไฟฟ้าดับฉุกเฉินสำเร็จแล้ว! ระบบเริ่มเฝ้าระวังเตือนภัยทันที");
      fetchData(); // reload records
    } catch (err: any) {
      alert("❌ ล้มเหลวในการแจ้งข้อมูลไฟฟ้าดับ: " + err.message);
    } finally {
      setInstantReporting(false);
    }
  };

  const handleInstantResolve = async (p: Patient) => {
    setInstantReporting(true);
    try {
      const payload = {
        latitude: p.latitude || "",
        longtitude: p.longtitude || "",
        telephone_number: currentPhoneUser || p.telephone_number || "",
        pea_number: p.pea_number || "",
        ca_number: p.ca_number || ""
      };

      const res = await fetch("/api/reports/resolve-instant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "ไม่สามารถปรับสถานะกระแสไฟฟ้ากลับเป็นปกติได้");
      }

      const data = await res.json();
      alert(`✓ อัปเดตสถานะกระแสไฟฟ้าปกติสมบูรณ์! และปรับปรุงพื้นที่พิกัดคุ้มครองเรียบร้อยแล้ว` + (data.resolvedCount > 0 ? ` (ปิดรายงานแจ้งเตือนสีแดง ${data.resolvedCount} รายการในพื้นที่เรียบร้อยแล้ว)` : ""));
      fetchData(); // reload records
    } catch (err: any) {
      alert("❌ ล้มเหลวในการส่งข้อมูลกระแสไฟปกติ: " + err.message);
    } finally {
      setInstantReporting(false);
    }
  };

  // Filter computing for Patients grid/table
  const filteredPatients = useMemo(() => {
    return computedPatients.filter((p) => {
      // 1. Text Search query
      const matchesSearch =
        (p.owner_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.pea_number || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.emergency_description || "").toLowerCase().includes(searchQuery.toLowerCase());

      // 2. Priority Selection Filter
      const matchesPriority = priorityFilter === "ALL" || p.emergency_type === priorityFilter;

      // 3. Sub-district Filter
      const matchesSubdistrict = subdistrictFilter === "ALL" || p.sub_distric === subdistrictFilter;

      return matchesSearch && matchesPriority && matchesSubdistrict;
    });
  }, [computedPatients, searchQuery, priorityFilter, subdistrictFilter]);

  // Determine current active blackout occurrences (database records that are PENDING)
  const pendingOutagesCount = useMemo(() => {
    return reports.filter((r) => r.fixed_status !== "RESOLVED").length;
  }, [reports]);

  // Admin Toggle Outage Report status to RESOLVED
  const handleResolveOutage = async (reportId: string) => {
    try {
      const res = await fetch(`/api/reports/${reportId}/resolve`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-PIN": "h02101",
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }

      alert("แก้ไขรายงานไฟดับในเขตระยองเสร็จสมบูรณ์");
      fetchData(); // Reload records
    } catch (error: any) {
      alert("ล้มเหลวเรียบเรียง: " + error.message);
    }
  };

  // Admin Delete Outage Report Completely
  const handleDeleteReport = async (reportId: number) => {
    const isConfirmed = window.confirm("คุณแน่ใจหรือไม่ที่จะลบรายการแจ้งนี้ออกจากระบบถาวร?");
    if (!isConfirmed) return;

    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-PIN": "h02101",
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }

      alert("ลบข้อมูลรายงานสำเร็จแล้ว");
      fetchData(); // Reload records
    } catch (error: any) {
      alert("ล้มเหลวในการลบรายการขัดข้อง: " + error.message);
    }
  };

  // Export Reports List to Excel (as UTF-8 BOM CSV)
  const handleExportReportsToExcel = () => {
    const headers = [
      "รายงาน ID",
      "วันเวลาที่แจ้ง",
      "ประเภทเหตุการณ์",
      "บ้านเลขที่",
      "ซอย",
      "ถนน",
      "ตำบล",
      "อำเภอ",
      "จังหวัด",
      "รหัสไปรษณีย์",
      "ชื่อผู้แจ้ง",
      "เบอร์โทรผู้แจ้ง",
      "ละติจูด",
      "ลองจิจูด",
      "สถานะการแก้ไข"
    ];

    const rows = reports.map((rep) => [
      rep.report_id,
      new Date(rep.created_at).toLocaleString("th-TH"),
      rep.report_type,
      rep.address_number || "-",
      rep.soi || "-",
      rep.road || "-",
      rep.sub_distric || "-",
      rep.distric || "-",
      rep.province || "-",
      rep.postcode || "-",
      rep.reporter_name || "ไม่ระบุตัวตน",
      rep.reporter_telephone_number || "-",
      rep.latitude || "-",
      rep.longtitude || "-",
      rep.fixed_status === "RESOLVED" ? "แก้ไขแล้ว" : "รอดำเนินการ"
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `รายงานแจ้งไฟดับ_ระยอง_${new Date().toLocaleDateString("th-TH").replace(/\//g, "-")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={`min-h-screen bg-slate-100 flex flex-col text-slate-800 ${theme === "dark" ? "dark-theme-active" : ""}`}>
      {/* 
        COMPULSORY VIOLET BRAND HEADER 
        All pages must display this header containing exact requested texts.
      */}
      <header className="bg-violet-900 text-white py-4 px-6 md:px-12 shadow-md shrink-0 border-b border-violet-800">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded bg-white flex items-center justify-center text-xl font-bold shadow text-violet-900">
              ⚡
            </div>
            <div>
              <h1 className="font-bold text-lg md:text-xl tracking-tight leading-snug">
                การไฟฟ้าส่วนภูมิภาคจังหวัดระยอง
              </h1>
              <p className="text-xs text-violet-200 mt-0.5 font-medium">
                ระบบเฝ้าระวังภัยพิบัติและไฟฟ้าดับผู้ป่วยกลุ่มเปราะบาง (ระบบซิงค์เจ้าหน้าที่และผู้ป่วยสด)
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3.5">
            <span className="text-xs bg-violet-800/80 px-3 py-1.5 rounded-full border border-violet-700/60 font-medium">
              🏷️ ประเภทบัญชี: {" "}
              <b className="text-yellow-400 font-bold ml-1.5 uppercase">
                {accountType === "ADMIN" ? "👨‍💼 บัญชีผู้ดูแลระบบ (Admin)" : accountType === "CONSUMER" ? "🔋 บัญชีผู้ใช้ไฟฟ้าหลัก" : "Guest (ยังไม่ได้เข้าสู่ระบบ)"}
              </b>
            </span>

            {accountType !== "NONE" && (
              <button
                onClick={handleLogout}
                className="flex items-center space-x-1 py-1.5 px-3 bg-rose-600 hover:bg-rose-700 font-semibold text-white rounded-lg text-xs leading-none transition"
              >
                <LogOut className="h-3 w-3" />
                <span>ออกจากระบบ</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 
        MAIN CONTENT BODY (WHITE BACKGROUND IN THE CENTRAL SECTION)
        ตรงส่วนกลางจะเป็นรายละเอียดของแต่ละหน้า มีพื้นหลังเป็นสีขาว
      */}
      <main className="grow bg-white max-w-7xl mx-auto w-full p-4 md:p-8 flex flex-col space-y-6">
        
        {/* =======================================
            PAGE 1: LOGIN COMPONENT 
            ======================================= */}
        {currentPage === "LOGIN" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 grow items-stretch animate-fadeIn">
            {/* Left Column: Logins Selection */}
            <div className="lg:col-span-5 flex flex-col justify-center space-y-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-slate-950 tracking-tight flex items-center space-x-2">
                  <span>🏥</span>
                  <span>กรุณาเลือกช่องทางการเข้าสู่ระบบ</span>
                </h2>
                <p className="text-xs text-slate-500">
                  ระบบนี้จัดทำเพื่อการไฟฟ้าส่วนภูมิภาคระยอง สมาชิกอาสาสมัครร่วมรายงาน และบุคลากรทางการแพทย์เพื่อปกป้องผู้รับรักษางานเครื่องช่วยชีวิต
                </p>
              </div>

              {/* Box 1: Consumer Phone login */}
              <div className="bg-slate-50 border border-slate-200 hover:border-violet-300 p-6 rounded-xl shadow-sm transition hover:shadow-md">
                <span className="text-2xl">⚡</span>
                <h3 className="font-bold text-slate-900 text-sm mt-2">สำหรับประชาชน / ผู้แจ้งเหตุไฟฟ้าดับ</h3>
                <p className="text-[11px] text-slate-500 mb-4 h-9">
                  เข้าระบบเพื่อรายงานไฟฟ้าดับ เสากริ่งชำรุด หรือพื้นที่อันตราย และดูประวัติรายงานของตนเอง
                </p>
                <form onSubmit={handleConsumerLogin} className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] text-slate-600 font-bold uppercase">ระบุหมายเลขโทรศัพท์ติดต่อ</label>
                    <input
                      type="tel"
                      value={consumerPhone}
                      onChange={(e) => setConsumerPhone(e.target.value)}
                      required
                      placeholder="เช่น 0812345678"
                      className="w-full p-2 bg-white border border-slate-200 rounded font-mono text-sm tracking-wide text-slate-800"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 bg-violet-700 hover:bg-violet-800 text-white font-bold rounded text-xs transition cursor-pointer"
                  >
                    เข้าใช้งานฐานบัญชีผู้ใช้ไฟฟ้า 🔓
                  </button>
                </form>
              </div>

              {/* Box 2: Admin PIN login */}
              <div className="bg-slate-50 border border-slate-200 hover:border-rose-300 p-6 rounded-xl shadow-sm transition hover:shadow-md">
                <span className="text-2xl">👨‍💼</span>
                <h3 className="font-bold text-slate-900 text-sm mt-2">สำหรับผู้ดูแลระบบและอาสาสมัครคู่ช่วย</h3>
                <p className="text-[11px] text-slate-500 mb-4 h-9">
                  สำหรับเจ้าหน้าที่ PEA ระยอง เข้าควบคุม แนะนำ และบริหารจัดการพิกัดคุ้มครองพร้อมสิทธิ์แก้ไข
                </p>
                <form onSubmit={handleAdminLogin} className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] text-slate-600 font-bold uppercase">รหัสแอดมินจำนงแก้ไข (Admin PIN)</label>
                    <input
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      required
                      placeholder="ระบุรหัสผ่านแอดมินผู้ดูแล"
                      className="w-full p-2 bg-white border border-slate-200 rounded text-sm text-slate-800"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded text-xs transition cursor-pointer"
                  >
                    ยืนยันตัวตนเจ้าหน้าคลังคุมภัย 📡
                  </button>
                </form>
              </div>
            </div>

            {/* Right Column: Outages Map only (Vulnerable patients are hidden!) */}
            <div className="lg:col-span-7 flex flex-col space-y-3 shrink-0">
              <div className="flex justify-between items-center border-b border-slate-200 pb-2 bg-slate-50 p-3 rounded-lg">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-1.5">
                    <span className="text-red-500 animate-pulse">●</span>
                    <span>รายงานพื้นที่พลังงานไฟฟ้าดับขัดข้องในอ.เมืองระยองขณะนี้</span>
                  </h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    แสดงเฉพาะพิกัดจุดแจ้งเหตุ และรัศมีความขัดข้อง (ห้ามเปิดเผยระบบข้อมูลผู้ป่วยเปราะบางเพื่อความเป็นส่วนตัวทางการแพทย์)
                  </p>
                </div>
                <span className="text-xs bg-red-100 text-red-800 py-1 px-2 rounded-full font-bold">
                  {pendingOutagesCount} จุดที่กำลังดำเนินการอยู่
                </span>
              </div>

              {/* Surveillance Map rendering (patients hidden!) */}
              <div className="grow rounded-xl overflow-hidden shadow-sm h-[450px]">
                <SurveillanceMap
                  patients={[]} // ABSOLUTELY HIDDEN FOR PRIVACY
                  reports={reports}
                  showPatients={false} // GUARD ACTIVATED
                  outageZoneCenter={null}
                  outageZoneRadius={1.5}
                  selectedPatientId={null}
                  theme={theme}
                />
              </div>

              {/* Inline layout help list */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                <p className="font-bold text-xs text-slate-800">📋 เหตุขัดข้องทางโครงข่ายไฟฟ้าจังหวัดระยอง:</p>
                {reports.filter(r => r.fixed_status !== "RESOLVED").length === 0 ? (
                  <p className="text-xs text-slate-500 italic text-center p-2">🎉 เขตเมืองระยองไม่มีเหตุไฟฟ้าขัดข้องคงค้างในขณะนี้ ระบบจ่ายไฟทำงานปกติ</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[140px] overflow-y-auto">
                    {reports
                      .filter(r => r.fixed_status !== "RESOLVED")
                      .map((rep) => (
                        <div key={rep.report_id} className="p-2 bg-white rounded border border-slate-100 text-[11px] flex gap-2">
                          <span className="text-rose-500">⚡</span>
                          <div>
                            <p className="font-bold text-slate-800">
                              {rep.report_type} พิกัด ม.{rep.address_number} ต.{rep.sub_distric}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              ผู้แจ้ง: {rep.reporter_name} ({new Date(rep.created_at).toLocaleTimeString("th-TH")})
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =======================================
            PAGE 2: CONSUMER PORTAL COMPONENTS
            ======================================= */}
        {currentPage === "CONSUMER" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch animate-fadeIn">
            {/* Left column: Outage Form and registration profiles info */}
            <div className="lg:col-span-5 flex flex-col space-y-5">
              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-3.5">
                <div className="flex border-b border-slate-200 pb-2 justify-between items-center bg-violet-50 p-2.5 rounded hover:border-violet-100">
                  <div className="flex items-center space-x-1.5">
                    <User className="text-violet-600 h-5 w-5" />
                    <div>
                      <h3 className="font-bold text-slate-900 text-xs">ข้อมูลทะเบียนเบอร์โทรศัพท์ของท่าน</h3>
                      <p className="text-[10px] text-violet-700 font-bold">{currentPhoneUser}</p>
                    </div>
                  </div>
                  <span className="text-[10px] bg-green-100 text-green-800 py-0.5 px-2.5 rounded-full font-bold">
                    เข้าตรวจสอบข้อมูลแล้ว
                  </span>
                </div>

                {/* Inspect if patient is registered on this telephone number */}
                {(() => {
                  const matchedUserPatients = patients.filter((p) => {
                    if (!currentPhoneUser) return false;
                    const cleanUser = currentPhoneUser.trim().replace(/[-\s]/g, "");
                    const cleanTel = (p.telephone_number || "").trim().replace(/[-\s]/g, "");
                    const cleanPEA = (p.pea_number || "").toString().trim().replace(/[-\s]/g, "");
                    const cleanCA = (p.ca_number || "").toString().trim().replace(/[-\s]/g, "");
                    
                    return (
                      (cleanTel && cleanTel === cleanUser) ||
                      (cleanPEA && cleanPEA === cleanUser) ||
                      (cleanCA && cleanCA === cleanUser) ||
                      p.telephone_number === currentPhoneUser ||
                      String(p.pea_number) === currentPhoneUser ||
                      String(p.ca_number) === currentPhoneUser
                    );
                  });

                  return matchedUserPatients.length > 0 ? (
                    <div className="p-3.5 bg-green-50 border border-green-200 rounded-lg text-xs leading-relaxed text-green-800 bg-white">
                      <p className="font-bold flex items-center space-x-1">
                        <span>✓</span>
                        <span>ข้อมูลบริการไฟฟ้า/เบอร์โทรศัพท์ของท่าน มีประวัติลงทะเบียนแล้ว</span>
                      </p>
                      {matchedUserPatients.map((p) => (
                        <div key={p.emer_house_id} className="mt-2 bg-white/90 p-2.5 rounded border border-green-200 text-slate-700">
                          <p><b>ชื่อผู้ป่วยหลัก:</b> {p.owner_name}</p>
                          <p><b>เบอร์ติดต่อฉุกเฉิน:</b> {p.telephone_number || "ไม่ได้ลงทะเบียนเบอร์โทรศัพท์"}</p>
                          <p><b>ความสำคัญสูงสุด:</b> <span className="text-red-600 font-bold">{p.emergency_type}</span></p>
                          <p><b>อุปกรณ์ทางการแพทย์:</b> {p.emergency_description || "ไม่ระบุอุปกรณ์"}</p>
                          <p className="text-[10px] text-slate-500 mt-1">ที่อยู่จดทะเบียน: บ้านเลขที่ {p.address_number} ต.{p.sub_distric} จ.ระยอง</p>
                          
                          {/* Instant Reporting Quick Action Panel */}
                          <div className="mt-4 pt-3.5 border-t border-dashed border-green-200 bg-violet-50/70 p-3 rounded-lg space-y-2">
                            <p className="font-extrabold text-xs text-violet-950 flex items-center space-x-1">
                              <span>⚡</span>
                              <span>ปุ่มด่วน: แจ้งสถานะกระแสไฟฟ้าที่บ้านของท่านทันที</span>
                            </p>
                            <p className="text-[9px] text-slate-500 leading-normal">
                              คลิกปุ่มด้านล่างเพื่ออัปเดตสถานะกระแสไฟฟ้าตามสิทธิ์ผู้ป่วย โดยระบบจะดึงพิกัดละติจูด/ลองจิจูด ({p.latitude}, {p.longtitude}) และที่อยู่ในการลงทะเบียนของคุณทันทีโดยที่คุณไม่ต้องพิมพ์กรอกฟอร์มใดๆ
                            </p>
                            <div className="grid grid-cols-2 gap-2 pt-1.5">
                              <button
                                type="button"
                                disabled={instantReporting}
                                onClick={() => handleInstantReport(p)}
                                className="w-full py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white font-extrabold rounded-md shadow hover:shadow-md cursor-pointer text-center text-[10px] md:text-xs transition active:scale-95 uppercase flex items-center justify-center space-x-1"
                              >
                                <span>⚠️</span>
                                <span>{instantReporting ? "กำลังประมวล..." : "ยืนยันแจ้งไฟดับ"}</span>
                              </button>
                              <button
                                type="button"
                                disabled={instantReporting}
                                onClick={() => handleInstantResolve(p)}
                                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold rounded-md shadow hover:shadow-md cursor-pointer text-center text-[10px] md:text-xs transition active:scale-95 uppercase flex items-center justify-center space-x-1"
                              >
                                <span>✅</span>
                                <span>{instantReporting ? "กำลังประมวล..." : "ยืนยันไฟปกติ"}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 rounded-lg text-[11px] text-amber-800 border border-amber-200 leading-relaxed font-sans">
                      🐾 <b>คำแนะนำสแกนช่วยเหลือ:</b> บัญชีของท่านไม่จัดอยู่ในทะเบียนบ้านผู้ป่วยกลุ่มเปราะบาง
                      หากคนในบ้านของท่านเป็นผู้ป่วยต้องประทังชีวิตด้วยเครื่องช่วยหายใจหรือเครื่องมือแพทย์ใช้ไฟฟ้าสามารถติดต่อประสานลงทะเบียนกับอาสาสมัครแอดมินเพื่อจดบันทึกพิกัดช่วยเหลือชีวิตได้ทันที
                    </div>
                  );
                })()}
              </div>

              {/* Submit blackout form component in Rayong */}
              <OutageForm
                reporterPhone={currentPhoneUser || ""}
                onReportSuccess={fetchData}
                mapSelectedCoords={editorMapSelectedCoords}
              />
            </div>

            {/* Right column: Interactive Map for consumer (patients hidden!) */}
            <div className="lg:col-span-7 flex flex-col space-y-3">
              <div className="border-b border-slate-200 pb-2 bg-slate-50 p-3 rounded-lg flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-1.5">
                    <span className="text-teal-600">●</span>
                    <span>พิกัดภัยพิบัติและดับไฟ (Citizen Surveillance Display)</span>
                  </h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    เลือกและคลิกจุดขัดข้องบนแผนที่โดยตรง เพื่อป้อนพิกัดแจ้งเหตุอัตโนมัติ (ห้ามเปิดเผยเรือนพักผู้ป่วยทั่วไป)
                  </p>
                </div>
                <div className="flex items-center space-x-1">
                  <span className="text-[11px] text-slate-600 font-medium bg-slate-200 px-2 py-1 rounded">
                    พิกัด Rayong Center
                  </span>
                </div>
              </div>

              {/* Map implementation (Patients HIDDEN FOR PRIVACY!) */}
              <div className="grow rounded-xl overflow-hidden shadow-sm h-[450px]">
                <SurveillanceMap
                  patients={[]} // EMPTY ARRAY (SECURE PRIVACY GATES)
                  reports={reports}
                  showPatients={false} // GUARD IN FULL ACTION
                  onMapClick={handleMapClick} // support click coordinates
                  outageZoneCenter={null}
                  outageZoneRadius={1.5}
                  selectedPatientId={null}
                  theme={theme}
                />
              </div>

              {/* List of active blackout/complaints records recorded */}
              <div className="bg-slate-50 p-4 border border-slate-200 rounded-xl space-y-2">
                <p className="font-bold text-xs text-slate-800">📊 บันทึกเหตุรายงานอุทกภัยและระบบดับไฟ เมืองระยอง:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[140px] overflow-y-auto">
                  {reports.map((rep) => (
                    <div
                      key={rep.report_id}
                      className={`p-2.5 rounded border text-[11px] flex justify-between items-start ${
                        rep.fixed_status === "RESOLVED"
                          ? "bg-green-50 border-green-200 text-green-800"
                          : "bg-orange-50 border-orange-200 text-orange-900"
                      }`}
                    >
                      <div>
                        <p className="font-bold">
                          {rep.report_type} | บ.เลขที่ {rep.address_number || "-"} ต.{rep.sub_distric || "-"}
                        </p>
                        <p className="text-[9px] text-slate-500 font-mono mt-0.5">
                          {new Date(rep.created_at).toLocaleString("th-TH")}
                        </p>
                      </div>
                      
                      <span className={`text-[9px] font-bold py-0.5 px-2 rounded-full uppercase ${
                        rep.fixed_status === "RESOLVED" ? "bg-green-200 text-green-900" : "bg-orange-200 text-orange-950 animate-pulse"
                      }`}>
                        {rep.fixed_status === "RESOLVED" ? "แก้ไขแล้ว" : "รอดำเนินงาน"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =======================================
            PAGE 3: ADMIN COMMAND POST Dashboard
            ======================================= */}
        {currentPage === "ADMIN" && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-stretch grow animate-fadeIn">
            
            {/* Left section: Metrics, clinical lists, forms, AI analyzer */}
            <div className="xl:col-span-5 flex flex-col space-y-6">
              
              {/* Alert Warning Box (When vulnerable patients are in disaster ring) */}
              {affectedVulnerableCount > 0 && (
                <div className="bg-rose-50 border-2 border-rose-600 rounded-xl p-4 shadow-lg text-rose-950 space-y-2 animate-shake">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <ShieldAlert className="text-rose-600 h-6 w-6 animate-pulse" />
                      <p className="font-black text-xs md:text-sm tracking-tight text-rose-800">
                        🚨 สัญญาณภัยพิบัติฉุกเฉิน: ตรวจพบผู้ป่วยเปราะบางในบริเวณไฟดับ!
                      </p>
                    </div>

                    <button
                      onClick={toggleMute}
                      className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-slate-900 text-white hover:bg-slate-800 text-[10px] font-bold rounded-lg cursor-pointer transition active:scale-95 shadow shrink-0"
                    >
                      {isMuted ? <VolumeX className="h-3 w-3 text-rose-400" /> : <Volume2 className="h-3 w-3 text-green-400 animate-bounce" />}
                      <span>{isMuted ? "เปิดเสียงเตือน" : "ปิดเสียงชั่วคราว"}</span>
                    </button>
                  </div>

                  <div className="p-3 bg-rose-600 text-white rounded-lg text-xs leading-relaxed font-sans shadow-inner">
                    🛡️ พบการขัดแย้งของกระแสไฟ! อุปโภคพยุงชีพของ <b>{affectedVulnerableCount}</b> รายการคนไข้อยู่ในพื้นที่วงจรพินาศดับไฟ กรุณาประสานรถกำเนิดไฟฟ้าเคลื่อนที่หรือทีมกู้ชีพระยองด่วนที่สุด!
                  </div>

                  {/* Micro list of impacted patients who are in blackout circles */}
                  <div className="max-h-[140px] overflow-y-auto space-y-1.5 pt-1">
                    {computedPatients
                      .filter((p) => p.isAffected)
                      .map((p) => (
                        <div
                          key={p.emer_house_id}
                          className="bg-white hover:bg-rose-100 p-2.5 rounded border border-rose-300 text-[11px] font-medium text-rose-900 flex justify-between items-center transition cursor-pointer"
                          onClick={() => {
                            setSelectedPatientId(p.emer_house_id);
                            // Clear previous selected marker, center on map
                          }}
                        >
                          <div className="space-y-0.5">
                            <p className="font-bold text-slate-900">👤 {p.owner_name} - <span className="text-red-600 font-bold capitalize">{p.emergency_type}</span></p>
                            <p className="text-[10px] text-slate-500 font-mono">
                              📍 ละติจูด: {p.latitude}, ลองจิจูด: {p.longtitude} (ห่างจากจุดขัดข้อง {p.distanceFromOutage ? formatDistance(p.distanceFromOutage) : "0 กม."})
                            </p>
                          </div>
                          <span className="text-[10px] bg-red-600 text-white py-0.5 px-2.5 rounded font-black uppercase animate-pulse">
                            Outage
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Administrative Stats Center */}
              <div className="bg-slate-950 text-white rounded-xl p-4.5 border border-slate-800 shadow-md flex justify-between items-center gap-4 flex-wrap">
                <div className="flex items-center space-x-2.5">
                  <Activity className="text-emerald-400 h-5 w-5 hover:scale-110 transition" />
                  <div>
                    <h4 className="font-bold text-xs tracking-wider uppercase text-slate-400 font-mono">Rayong Active Survelliance</h4>
                    <p className="text-[10px] text-slate-500">ระบบประมวลข้อมูลสดพิกัดพยุงชีพ</p>
                  </div>
                </div>

                <div className="flex space-x-3 text-xs">
                  <div className="bg-slate-900 p-2 rounded border border-slate-800 text-center">
                    <span className="block text-rose-500 font-extrabold text-sm">{patients.length}</span>
                    <span className="text-[9px] text-slate-400">ทะเบียนเปราะบาง</span>
                  </div>
                  <div className="bg-slate-900 p-2 rounded border border-slate-800 text-center">
                    <span className="block text-yellow-400 font-extrabold text-sm">
                      {patients.filter(p => p.emergency_type === "CRITICAL").length}
                    </span>
                    <span className="text-[9px] text-slate-400">เครื่องช่วยหายใจ</span>
                  </div>
                  <div className="bg-slate-900 p-2 rounded border border-slate-800 text-center">
                    <span className="block text-red-500 font-extrabold text-sm">{pendingOutagesCount}</span>
                    <span className="text-[9px] text-slate-400">จุดแจ้งไฟดับคาอยู่</span>
                  </div>
                </div>
              </div>

              {/* Add / Edit Patient CRUD Form controller */}
              {showPatientForm ? (
                <div className="animate-slideUp">
                  {/* AI Smart Analyzer tool integrated directly ontop of patient registration inside form overlay! */}
                  <div className="mb-4">
                    <ClinicalAnalyzer
                      onAnalysisCompleted={(priority, reason) => {
                        // Autofill values in the child component form data!
                        // In React, we pass down dynamic handles
                        if (editorMapSelectedCoords) {
                          // Trigger update inside form
                        }
                        const btn = document.getElementById("clinical-trigger");
                        // We use ref interaction or simply provide state binding!
                        alert(`วิเคราะห์ผลสำเร็จ: จัดกลุ่มในประเภท ${priority}\nคำสนับสนุน: ${reason}\n\nระบบจดจำพารามิเตอร์แล้ว โปรดระบุชื่อผู้ดูแลเพื่อบันทึกพิกัดลงฐานข้อมูล`);
                        
                        // Set fields dynamically via internal function
                        const target = document.getElementsByName("emergency_type")[0] as HTMLSelectElement;
                        if (target) {
                          target.value = priority;
                          // trigger event handler trigger
                          const event = new Event('change', { bubbles: true });
                          target.dispatchEvent(event);
                        }
                        const desc = document.getElementsByName("emergency_description")[0] as HTMLTextAreaElement;
                        if (desc) {
                          desc.value = `[ประเมินระดับอัจฉริยะแบบ ${priority}]: ${reason}`;
                          const event = new Event('change', { bubbles: true });
                          desc.dispatchEvent(event);
                        }
                      }}
                    />
                  </div>

                  <PatientForm
                    initialPatient={editingPatient}
                    onSubmitSuccess={() => {
                      setShowPatientForm(false);
                      setEditingPatient(null);
                      setEditorMapSelectedCoords(null);
                      fetchData(); // Reload raw data
                    }}
                    onCancel={() => {
                      setShowPatientForm(false);
                      setEditingPatient(null);
                      setEditorMapSelectedCoords(null);
                    }}
                    mapSelectedCoords={editorMapSelectedCoords}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Quick Patient list manager with custom filter headers */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4 shadow-sm">
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 border-b border-secondary-200 pb-2 mb-2">
                      <div className="space-y-0.5">
                        <h3 className="font-extrabold text-slate-900 text-xs flex items-center space-x-1">
                          <span>📋</span>
                          <span>ทะเบียนผู้ป่วยกลุ่มเสี่ยงทางภูมิศาสตร์ทั้งหมด</span>
                        </h3>
                        <p className="text-[10px] text-slate-500">จัดการข้อมูล ปักหมุด หรือตรวจสอบสถานะอุปกรณ์รักษาระดับชีวิต</p>
                      </div>

                      <button
                        onClick={() => {
                          setEditingPatient(null);
                          setEditorMapSelectedCoords(null);
                          setShowPatientForm(true);
                        }}
                        className="flex items-center space-x-1 bg-violet-700 hover:bg-violet-800 text-white text-xs font-bold py-1.5 px-3 rounded-lg shadow cursor-pointer transition transform active:scale-95 leading-none"
                      >
                        <Plus className="h-3 w-3" />
                        <span>เพิ่มลงทะเบียนผู้ป่วยคู่เสี่ยงใหม่</span>
                      </button>
                    </div>

                    {/* Integrated Quick Filter Row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                      {/* Subdistrict selection */}
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-0.5">ฟิลเตอร์ตำบล (Subdistrict)</label>
                        <select
                          value={subdistrictFilter}
                          onChange={(e) => setSubdistrictFilter(e.target.value)}
                          className="w-full p-2 bg-white border border-slate-300 rounded font-bold"
                        >
                          <option value="ALL">📍 แสดงทุกตำบล (ALL)</option>
                          {subdistricts.map((sub, i) => (
                            <option key={i} value={sub}>{sub}</option>
                          ))}
                        </select>
                      </div>

                      {/* Priority level filter selector */}
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-0.5">คัดกรองระดับความสำคัญ (Priority)</label>
                        <select
                          value={priorityFilter}
                          onChange={(e) => setPriorityFilter(e.target.value)}
                          className="w-full p-2 bg-white border border-slate-300 rounded font-bold"
                        >
                          <option value="ALL">⚠️ แสดงความสำคัญทุกระดับ (ALL)</option>
                          <option value="CRITICAL">🚨 วิกฤตสูงสุด (CRITICAL)</option>
                          <option value="HIGH">⚠️ เร่งด่วนสูง (HIGH)</option>
                          <option value="MEDIUM">🏥 ปานกลาง (MEDIUM)</option>
                          <option value="LOW">👤 ธรรมดาพยุงชีพ (LOW)</option>
                        </select>
                      </div>

                      {/* Text Search query matching */}
                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-0.5">ค้นหาผู้ดูแล / เครื่องแพทย์</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="พิมพ์คำค้นหา..."
                            className="w-full p-2 pl-7 border border-slate-300 rounded text-slate-800 font-sans"
                          />
                          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-2.5" />
                        </div>
                      </div>
                    </div>

                    {/* Patients List Grid with flyTo animations */}
                    <div className="max-h-[300px] overflow-y-auto divide-y divide-slate-150 border border-slate-200 rounded-lg bg-white shadow-inner">
                      {filteredPatients.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-8 italic p-2.5">ไม่พบรายชื่อผู้ดูแลและคนไข้ที่ตรงกับเงื่อนไขตัวกรองดั่งกล่าว</p>
                      ) : (
                        filteredPatients.map((p) => (
                          <div
                            key={p.emer_house_id}
                            className={`p-3 hover:bg-slate-50 transition flex justify-between items-center ${
                              selectedPatientId === p.emer_house_id ? "bg-violet-50/70 border-l-4 border-l-violet-600" : ""
                            }`}
                          >
                            <div
                              onClick={() => {
                                setSelectedPatientId(p.emer_house_id);
                                // Centering coordinates smooth scroll on camera map as requested
                              }}
                              className="grow cursor-pointer space-y-0.5"
                            >
                              <div className="flex items-center space-x-1.5 flex-wrap">
                                <span className={`text-[9px] font-black py-0.5 px-1.5 rounded uppercase ${
                                  p.emergency_type === "CRITICAL"
                                    ? "bg-red-100 text-red-800"
                                    : p.emergency_type === "HIGH"
                                    ? "bg-orange-100 text-orange-800"
                                    : p.emergency_type === "MEDIUM"
                                    ? "bg-yellow-100 text-yellow-800"
                                    : "bg-teal-50 text-teal-800"
                                }`}>
                                  {p.emergency_type}
                                </span>
                                {p.isAffected && (
                                  <span className="text-[9px] bg-red-600 text-white font-extrabold py-0.5 px-1.5 rounded-full animate-pulse uppercase">
                                    ⚠️ OUTAGE
                                  </span>
                                )}
                                <span className="font-bold text-slate-900 text-xs">
                                  คุณ {p.owner_name}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-600 font-sans line-clamp-1 italic">
                                "{p.emergency_description || "ไม่มีบริการแนะนําเครื่องพยุงชีพกรณีฟื้นคืนจิต"}"
                              </p>
                              <div className="text-[9px] text-slate-600 font-bold flex items-center space-x-1.5 py-0.5 flex-wrap">
                                <span className="bg-slate-100 px-1 rounded text-slate-700">📞 เบอร์ติดต่อ: {p.telephone_number || "-"}</span>
                                <span className="text-slate-300 font-normal">|</span>
                                <span className="text-slate-500 font-mono">PEA/Meter: {p.pea_number || "-"} (CA: {p.ca_number || "-"})</span>
                              </div>
                              <p className="text-[9px] text-slate-500 font-mono">
                                บ้านเลขที่ {p.address_number || "-"} ซอย {p.soi || "-"} ต. {p.sub_distric || "-"} จ.ระยอง
                              </p>
                            </div>

                            {/* CRUD buttons with pin logic */}
                            <div className="flex space-x-1 shrink-0 ml-3.5">
                              <button
                                onClick={() => {
                                  setEditingPatient(p);
                                  setShowPatientForm(true);
                                }}
                                className="p-1 text-violet-600 hover:text-white hover:bg-violet-600 rounded border border-violet-200 cursor-pointer transition shadow-sm bg-white"
                                title="แก้ไขพิกัดประวัติผู้ป่วย"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                              {deleteConfirmId === p.emer_house_id ? (
                                <div className="flex items-center space-x-1">
                                  <button
                                    onClick={() => handleDeletePatient(p.emer_house_id)}
                                    className="px-2 py-1 text-[10px] text-white bg-rose-600 hover:bg-rose-700 rounded transition font-bold cursor-pointer"
                                    title="ยืนยันลบข้อมูลผู้ป่วยตัวจริง"
                                  >
                                    ยืนยันลบ
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmId(null)}
                                    className="px-1.5 py-1 text-[10px] text-slate-500 bg-slate-100 hover:bg-slate-200 rounded transition cursor-pointer"
                                  >
                                    ยกเลิก
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirmId(p.emer_house_id)}
                                  className="p-1 text-rose-600 hover:text-white hover:bg-rose-600 rounded border border-rose-200 cursor-pointer transition shadow-sm bg-white"
                                  title="ระงับหรือลบพิกัดสคริปต์"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right section: Command center Map controls and blackout zone configuration */}
            <div className="xl:col-span-7 flex flex-col space-y-4">
              
              {/* GIS Interactive Control Overlay and Blackout Zone simulator */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4.5 space-y-4 shadow-sm">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 border-b border-slate-200 pb-2">
                  <div className="space-y-0.5">
                    <h3 className="font-extrabold text-slate-900 text-sm flex items-center space-x-1.5">
                      <span>🎯</span>
                      <span>พื้นที่ประกาศดับไฟ / เหตุการณ์ไฟฟ้าดับ (Zone controller)</span>
                    </h3>
                    <p className="text-[10px] text-slate-500">
                      คลิกใดๆ บนแผนที่เพื่อโยนพิกัดศูนย์กลางไฟดับ และขยายรัศมีการประมวล Haversine GIS Realtime
                    </p>
                  </div>
                  
                  {outageZoneCenter && (
                    <button
                      onClick={() => setOutageZoneCenter(null)}
                      className="text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold py-1 px-2.5 rounded cursor-pointer border border-amber-300 shadow-sm leading-none transition"
                    >
                      ลบจุดจำลองไฟดับออก 🗑️
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Outage coordinate summary details */}
                  <div className="space-y-1 bg-white p-3 rounded-lg border border-slate-200 flex flex-col justify-center">
                    <p className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">ศูนย์กลางไฟฟ้าขัดข้องจำลอง:</p>
                    {outageZoneCenter ? (
                      <div className="font-mono text-slate-600 text-[11px] leading-relaxed">
                        <p>📍 ละติจูด: <b className="text-slate-900">{outageZoneCenter.lat.toFixed(6)}</b></p>
                        <p>📍 ลองจิจูด: <b className="text-slate-900">{outageZoneCenter.lng.toFixed(6)}</b></p>
                        <p className="text-[10px] text-emerald-600 font-bold mt-1">✓ รัศมีทำการประสานคำนวณแบบสแกนชีพ</p>
                      </div>
                    ) : (
                      <p className="text-slate-400 italic font-medium leading-normal">
                        กรุณาคลิกเลือกหรือแตะจุดใดๆ บนแผนที่ระยองด้านล่างนี้ เพื่อเริ่มประมวลรัศมีคำนวณผู้เคราะห์ร้ายทันที
                      </p>
                    )}
                  </div>

                  {/* Range Slider for Blackout Radius (Radius in Km) as requested */}
                  <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col justify-center space-y-1.5 font-sans">
                    <div className="flex justify-between items-center text-xs font-bold text-slate-700">
                      <span>ปรับรัศมีพื้นที่ประกาศดับไฟวงกลม (Radius Circle)</span>
                      <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-300 font-mono">
                        {outageZoneRadius.toFixed(1)} กิโลเมตร
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0.5"
                      max="6.0"
                      step="0.1"
                      value={outageZoneRadius}
                      onChange={(e) => setOutageZoneRadius(parseFloat(e.target.value))}
                      className="w-full accent-rose-600 cursor-pointer"
                    />

                    <div className="flex justify-between text-[10px] text-slate-400 font-medium font-mono">
                      <span>0.5 กม.</span>
                      <span>3.0 กม. (ขนาดมาตรฐาน)</span>
                      <span>6.0 กม.</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Main Map Block */}
              <div className="grow rounded-xl overflow-hidden shadow-sm h-[480px]">
                <SurveillanceMap
                  patients={patients}
                  reports={reports}
                  showPatients={true} // ADMIN HAS EXPLICIT ACCESS TO DETECT DISASTERS
                  onMapClick={handleMapClick}
                  outageZoneCenter={outageZoneCenter}
                  outageZoneRadius={outageZoneRadius}
                  selectedPatientId={selectedPatientId}
                  theme={theme}
                />
              </div>

              {/* Manage Outages Complaints (Enable admins to resolve active outage reports directly from command center) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 shadow-sm">
                <div className="flex justify-between items-center border-b border-slate-200 pb-1.5">
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-xs flex items-center space-x-1">
                      <span>⚡</span>
                      <span>รายการแจ้งไฟดับ</span>
                    </h3>
                    <p className="text-[10px] text-slate-500">
                      แอดมินเจ้าหน้าที่สามารถคุมงาน กดแก้ปัญหาสำเร็จ หรือลบประวัติเพื่อล้างจุดแจ้งเตือน
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleExportReportsToExcel}
                      className="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-1 px-2.5 rounded cursor-pointer shadow-sm transition flex items-center space-x-1"
                      title="ส่งออกรายการแจ้งไฟดับเป็นไฟล์ Excel/CSV"
                    >
                      <span>📥</span>
                      <span>ส่งออก Excel</span>
                    </button>
                    <span className="text-xs bg-violet-100 text-violet-800 font-bold py-1 px-2.5 rounded-full shrink-0">
                      {reports.length} รายการรวม
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[160px] overflow-y-auto">
                  {reports.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center col-span-2 py-4 bg-white rounded border border-slate-100 p-2">ไม่มีข้อมูลข้อมูลรายงานไฟดับค้างในฐานขณะนี้</p>
                  ) : (
                    reports.map((rep) => (
                      <div
                        key={rep.report_id}
                        className={`p-3 rounded-lg border text-xs flex justify-between items-center transition ${
                          rep.fixed_status === "RESOLVED"
                            ? "bg-slate-100/70 border-slate-200 text-slate-500"
                            : "bg-white border-rose-200 shadow-sm text-slate-800"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <p className="font-bold text-slate-800 flex items-center space-x-1">
                            <span>{rep.fixed_status === "RESOLVED" ? "✓" : "⚡"}</span>
                            <span>{rep.report_type} - ม.{rep.address_number} ต.{rep.sub_distric}</span>
                          </p>
                          <p className="text-[10px] text-slate-500">ผู้แจ้ง: {rep.reporter_name || "ไม่ประสงค์ออกนาม"} ({rep.reporter_telephone_number})</p>
                          <p className="text-[9px] text-slate-400 font-mono">{new Date(rep.created_at).toLocaleString("th-TH")}</p>
                        </div>

                        <div className="flex items-center space-x-1.5 shrink-0">
                          {rep.fixed_status !== "RESOLVED" && (
                            <button
                              onClick={() => handleResolveOutage(rep.report_id)}
                              className="text-[10px] font-bold py-1 px-2 bg-green-500 hover:bg-green-600 text-white rounded shadow-sm border border-green-500 cursor-pointer hover:scale-105 active:scale-95 transition flex items-center space-x-1 shrink-0"
                              title="ยืนยันแก้ไขสถานะไฟฟ้าปกติ"
                            >
                              <Check className="h-3 w-3" />
                              <span>แก้สำเร็จ</span>
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteReport(rep.report_id)}
                            className="p-1 px-2 text-rose-600 hover:text-white hover:bg-rose-600 rounded border border-rose-200 cursor-pointer transition shadow-sm bg-white shrink-0"
                            title="ลบข้อมูลรายงานนี้ออกจากระบบ"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* FOOTER SECTION */}
      <footer className="bg-slate-900 border-t border-slate-850 py-4 px-6 md:px-12 text-slate-400 text-center text-xs shrink-0 mt-auto flex flex-col md:flex-row justify-between items-center gap-3">
        <div className="font-medium text-slate-500">
          © 2026 LifeLine ElectriGuard - Rayong Provinical Electricity Authority Dashboard. All rights reserved.
        </div>
        <div className="flex items-center space-x-3 text-[10px] border border-slate-700/60 bg-slate-950 px-3 py-1 rounded font-mono text-slate-500/80">
          <span>PORT INGRESS: BIND 3000</span>
          <span>●</span>
          <span>DATABASE SSL: SECURE</span>
        </div>
      </footer>
    </div>
  );
}

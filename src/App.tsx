import React, { useState, useEffect, useRef, useMemo } from "react";
import SurveillanceMap from "./components/SurveillanceMap";
import OutageForm from "./components/OutageForm";
import PatientForm from "./components/PatientForm";
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
  Check,
  Phone,
  Lock
} from "lucide-react";

async function parseResponseError(res: Response, defaultMsg: string): Promise<string> {
  try {
    const clonedRes = res.clone();
    const data = await clonedRes.json();
    return data.error || defaultMsg;
  } catch {
    try {
      const rawText = await res.text();
      if (rawText) {
        const cleaned = rawText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return cleaned.substring(0, 150) || defaultMsg;
      }
    } catch {}
    return defaultMsg;
  }
}

export default function App() {
  // Navigation & Authentication state
  const [accountType, setAccountType] = useState<AccountType>("NONE");
  const [currentPage, setCurrentPage] = useState<"LOGIN" | "CONSUMER" | "ADMIN">("LOGIN");
  const [showAdminEntry, setShowAdminEntry] = useState(false);
  const [adminTab, setAdminTab] = useState<"MAP" | "ANALYTICS">("MAP");
  const [newOutageAlert, setNewOutageAlert] = useState<OutageReport | null>(null);
  const lastFetchedReportsRef = useRef<OutageReport[]>([]);
  
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

  const syncDataSilently = async () => {
    try {
      const patientRes = await fetch("/api/patients");
      const patientData: Patient[] = await patientRes.json();
      if (Array.isArray(patientData)) {
        setPatients(patientData);
      }

      const reportRes = await fetch("/api/reports");
      const reportData: OutageReport[] = await reportRes.json();
      if (Array.isArray(reportData)) {
        if (lastFetchedReportsRef.current && lastFetchedReportsRef.current.length > 0) {
          const previousIds = new Set(lastFetchedReportsRef.current.map(r => r.report_id));
          const newPendingReport = reportData.find(
            r => r.fixed_status === "PENDING" && !previousIds.has(r.report_id)
          );
          if (newPendingReport) {
            setNewOutageAlert(newPendingReport);
            // Auto start sound alert
            setIsMuted(false);
            startSiren();
            setTimeout(() => {
              stopSiren();
            }, 5000);
          }
        }
        setReports(reportData);
        lastFetchedReportsRef.current = reportData;
      }
    } catch (err) {
      console.warn("Silent sync failed in background:", err);
    }
  };

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
      const loadedReports = Array.isArray(reportData) ? reportData : [];
      setReports(loadedReports);
      lastFetchedReportsRef.current = loadedReports;
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

  // Periodic background polling (sync) for Admin dashboard
  useEffect(() => {
    let interval: any = null;
    if (currentPage === "ADMIN") {
      interval = setInterval(() => {
        syncDataSilently();
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentPage]);

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

  // Synchronize wailing siren sound with impacted patients state (Auto stop after 5 seconds)
  useEffect(() => {
    let timer: any = null;
    // Siren should trigger ONLY on ADMIN dashboard when at least one patient is currently in 'OUTAGE' impact zone
    if (currentPage === "ADMIN" && affectedVulnerableCount > 0 && !isMuted) {
      startSiren();
      // Auto silence after 5 seconds to prevent user annoyance
      timer = setTimeout(() => {
        stopSiren();
      }, 5000);
    } else {
      stopSiren();
    }

    return () => {
      stopSiren();
      if (timer) clearTimeout(timer);
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
      const res = await fetch(`/api/patients/${id}?pin=h02101`, {
        method: "DELETE",
        headers: {
          "x-admin-pin": "h02101",
          "X-Admin-PIN": "h02101" // Admin validation
        }
      });

      if (!res.ok) {
        const errorMsg = await parseResponseError(res, "ไม่สามารถทำการเชื่อมลบข้อมูลพิกัดผู้ป่วยได้สำเร็จ");
        throw new Error(errorMsg);
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
        const errorMsg = await parseResponseError(res, "ไม่สามารถขอรับส่งแจ้งเหตุการณ์ได้ในขณะนี้");
        throw new Error(errorMsg);
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
        const errorMsg = await parseResponseError(res, "ไม่สามารถปรับสถานะกระแสไฟฟ้ากลับเป็นปกติได้");
        throw new Error(errorMsg);
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

  const isToday = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const today = new Date();
      return (
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear()
      );
    } catch {
      return false;
    }
  };

  const todayReports = useMemo(() => {
    return reports.filter((r) => isToday(r.created_at));
  }, [reports]);

  // Admin Toggle Outage Report status to RESOLVED
  const handleResolveOutage = async (reportId: string) => {
    try {
      const res = await fetch(`/api/reports/${reportId}/resolve?pin=h02101`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-pin": "h02101",
          "X-Admin-PIN": "h02101",
        },
      });

      if (!res.ok) {
        const errorMsg = await parseResponseError(res, "ล้มเหลวในการปรับตามคำสั่งของระบบควบคุมหลัก");
        throw new Error(errorMsg);
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
      const res = await fetch(`/api/reports/${reportId}?pin=h02101`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-admin-pin": "h02101",
          "X-Admin-PIN": "h02101",
        },
      });

      if (!res.ok) {
        const errorMsg = await parseResponseError(res, "ล้มเหลวในการลบลบข้อมูลรายงานภัยพิบัติ");
        throw new Error(errorMsg);
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
            {/* Left Column: Centered, Beautiful Mockup Card */}
            <div className="lg:col-span-5 flex flex-col justify-center items-center">
              <div className="w-full max-w-md bg-white border border-slate-100/80 p-8 rounded-3xl shadow-xl shadow-slate-100/50 space-y-6 text-center animate-fadeIn">
                
                {!showAdminEntry ? (
                  /* Box 1: Caregiver/Consumer phone login */
                  <form onSubmit={handleConsumerLogin} className="space-y-6">
                    {/* Phone blue circle icon */}
                    <div className="flex justify-center">
                      <div className="p-4.5 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center shadow-inner">
                        <Phone className="h-6 w-6 stroke-[2.5]" />
                      </div>
                    </div>

                    {/* Titles */}
                    <div className="space-y-2">
                      <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
                        เข้าสู่ระบบผู้สิทธิ์ดูแล
                      </h2>
                      <p className="text-[11.5px] text-slate-550 text-slate-500 font-medium px-4 leading-relaxed">
                        กรุณาระบุเบอร์โทรศัพท์มือถือที่ได้รับการลงทะเบียนจองเตียงผู้ป่วย เพื่อใช้บริการระยองมอนิเตอร์ไฟตกดับ
                      </p>
                    </div>

                    {/* Numeric Input */}
                    <div className="space-y-2 text-left">
                      <label className="block text-[10px] text-slate-400 font-extrabold tracking-wider text-center uppercase font-mono">
                        MOBILE PHONE NUMBER
                      </label>
                      <input
                        type="tel"
                        value={consumerPhone}
                        onChange={(e) => setConsumerPhone(e.target.value)}
                        required
                        placeholder="เช่น 0812345678"
                        className="w-full p-4 bg-slate-50 border border-slate-150 rounded-2xl text-center text-slate-800 text-lg md:text-xl font-extrabold tracking-widest placeholder:text-slate-300 placeholder:font-bold focus:ring-2 focus:ring-blue-500/20 focus:bg-white outline-none font-mono transition"
                      />
                    </div>

                    {/* Action Button */}
                    <button
                      type="submit"
                      className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl shadow-lg shadow-blue-100 hover:shadow-xl hover:shadow-blue-200 hover:scale-[1.01] active:scale-[0.99] transition duration-150 cursor-pointer text-xs uppercase tracking-wide"
                    >
                      ยืนยันตัวตนตรวจสอบพิกัด
                    </button>

                    {/* Splitter Divider */}
                    <div className="relative flex py-2 items-center">
                      <div className="flex-grow border-t border-slate-100"></div>
                      <span className="flex-shrink mx-4 text-[10px] text-slate-300 font-extrabold tracking-widest uppercase font-mono">
                        OR STAFF PORTAL
                      </span>
                      <div className="flex-grow border-t border-slate-100"></div>
                    </div>

                    {/* Admin Toggle button */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAdminEntry(true);
                        setAdminPassword("");
                      }}
                      className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl shadow-md active:scale-95 transition text-xs flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      <Lock className="h-3.5 w-3.5 mr-1" />
                      <span>ลงชื่อเข้าใช้ด้วยบัญชีแอดมิน (Admin)</span>
                    </button>
                  </form>
                ) : (
                  /* Box 2: Admin PIN entering */
                  <form onSubmit={handleAdminLogin} className="space-y-6">
                    {/* Admin Lock circle icon */}
                    <div className="flex justify-center">
                      <div className="p-4.5 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center shadow-inner animate-pulse">
                        <Lock className="h-6 w-6 stroke-[2.5]" />
                      </div>
                    </div>

                    {/* Titles */}
                    <div className="space-y-2">
                      <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
                        ลงชื่อเข้าใช้งานสำหรับแอดมิน
                      </h2>
                      <p className="text-[11.5px] text-slate-500 font-medium px-4 leading-relaxed">
                        สำหรับเจ้าหน้าที่ PEA ระยอง เข้าควบคุมและจัดการสิทธิ์แก้ไข ทะเบียนผู้ป่วยเปราะบางในพิกัดภัยพิบัติ
                      </p>
                    </div>

                    {/* PIN input */}
                    <div className="space-y-2 text-left">
                      <label className="block text-[10px] text-slate-400 font-extrabold tracking-wider text-center uppercase font-mono">
                        ADMIN SECURITY PIN
                      </label>
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        required
                        placeholder="กรอกรหัสผ่านแอดมิน"
                        className="w-full p-4 bg-slate-50 border border-slate-150 rounded-2xl text-center text-slate-800 text-lg md:text-xl font-extrabold tracking-widest placeholder:text-slate-300 placeholder:font-bold focus:ring-2 focus:ring-rose-500/20 focus:bg-white outline-none font-mono transition"
                      />
                    </div>

                    {/* Sign in Admin action button */}
                    <button
                      type="submit"
                      className="w-full py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-2xl shadow-lg shadow-rose-100 hover:shadow-xl hover:shadow-rose-200 hover:scale-[1.01] active:scale-[0.99] transition duration-150 cursor-pointer text-xs uppercase tracking-wide"
                    >
                      ยืนยันตัวตนเจ้าหน้าที่ 📡
                    </button>

                    {/* Splitter Divider */}
                    <div className="relative flex py-2 items-center">
                      <div className="flex-grow border-t border-slate-100"></div>
                      <span className="flex-shrink mx-4 text-[10px] text-slate-300 font-extrabold tracking-widest uppercase font-mono">
                        OR CAREGIVER PORTAL
                      </span>
                      <div className="flex-grow border-t border-slate-100"></div>
                    </div>

                    {/* Back button */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAdminEntry(false);
                      }}
                      className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl active:scale-95 transition text-xs flex items-center justify-center space-x-1 cursor-pointer"
                    >
                      <Phone className="h-3.5 w-3.5 mr-1" />
                      <span>กลับไปหน้าเข้าสู่ระบบประชาชน (Caregiver)</span>
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* Right Column: Outages Map only (Vulnerable patients are hidden!) */}
            <div className="lg:col-span-7 flex flex-col space-y-3 shrink-0">
              <div className="flex justify-between items-center border-b border-slate-200 pb-2 bg-slate-50 p-3 rounded-lg">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-1.5">
                    <span className="text-rose-500 animate-pulse">●</span>
                    <span>รายงานพื้นที่พลังงานไฟฟ้าดับขัดข้องในอ.เมืองระยองขณะนี้ (Live Maps)</span>
                  </h3>
                  <p className="text-[10px] text-slate-550 text-slate-500 mt-0.5">
                    แสดงเฉพาะพิกัดจุดแจ้งเหตุ และรัศมีความขัดข้อง (ห้ามเปิดเผยระบบข้อมูลผู้ป่วยเปราะบางเพื่อความเป็นส่วนตัวทางการแพทย์)
                  </p>
                </div>
                <span className="text-xs bg-rose-100 text-rose-800 py-1 px-2.5 rounded-full font-bold">
                  {reports.filter(r => r.fixed_status !== "RESOLVED").length} จุดขัดข้องสะสมค้างอยู่
                </span>
              </div>

              {/* Surveillance Map rendering (patients are hidden, reports are visible!) */}
              <div className="grow rounded-xl overflow-hidden shadow-sm h-[450px]">
                <SurveillanceMap
                  patients={[]} // ABSOLUTELY HIDDEN FOR PRIVACY
                  reports={reports} // FULLY VISIBLE TO SHOW GENERAL DISASTER LOCATIONS
                  showPatients={false} // GUARD ACTIVATED
                  outageZoneCenter={null}
                  outageZoneRadius={1.5}
                  selectedPatientId={null}
                  theme={theme}
                />
              </div>

              {/* Locked details placeholder because not logged in */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-center py-5 space-y-1">
                <p className="font-bold text-xs text-slate-800 flex items-center justify-center space-x-1">
                  <span>🔒</span>
                  <span>ข้อมูลประวัติและสถานที่รายงานพลังงานไฟฟ้าขัดข้องเชิงลึก</span>
                </p>
                <p className="text-[10.5px] text-slate-550 text-slate-500">
                  กรุณาเข้าสู่ระบบประชาชน (Caregiver) หรือระบบเจ้าหน้าที่ (Admin) ในกล่องด้านซ้ายเพื่อเปิดข้อมูลรายละเอียดพิกัดเชิงลึก
                </p>
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
                      {matchedUserPatients.map((p) => {
                        const hasActiveOutageReport = reports.some((r) => {
                          if (r.fixed_status !== "PENDING") return false;
                          const reporterPhoneClean = (r.reporter_telephone_number || "").trim().replace(/[-\s]/g, "");
                          const patientPhoneClean = (p.telephone_number || "").trim().replace(/[-\s]/g, "");
                          const userPhoneClean = (currentPhoneUser || "").trim().replace(/[-\s]/g, "");
                          
                          const matchesPhone = (reporterPhoneClean && (reporterPhoneClean === patientPhoneClean || reporterPhoneClean === userPhoneClean));
                          const matchesCoords = (r.latitude === p.latitude && r.longtitude === p.longtitude);
                          return matchesPhone || matchesCoords;
                        });

                        return (
                          <div key={p.emer_house_id} className="mt-2 bg-white/90 p-2.5 rounded border border-green-200 text-slate-700">
                            <p><b>ชื่อผู้ป่วยหลัก:</b> {p.owner_name}</p>
                            <p><b>เบอร์ติดต่อฉุกเฉิน:</b> {p.telephone_number || "ไม่ได้ลงทะเบียนเบอร์โทรศัพท์"}</p>
                            <p><b>ความสำคัญสูงสุด:</b> <span className="text-red-600 font-bold">{p.emergency_type}</span></p>
                            <p><b>อุปกรณ์ทางการแพทย์:</b> {p.emergency_description || "ไม่ระบุอุปกรณ์"}</p>
                            <p className="text-[10px] text-slate-500 mt-1">ที่อยู่จดทะเบียน: บ้านเลขที่ {p.address_number} ต.{p.sub_distric} จ.ระยอง</p>
                            
                            {/* Real-time status badge */}
                            <div className="mt-3 p-2.5 rounded-xl border flex items-center justify-between bg-slate-50 border-slate-200 shadow-inner">
                              <span className="font-extrabold text-[11px] text-slate-600">สถานะกระแสไฟฟ้าที่บ้านท่าน:</span>
                              {hasActiveOutageReport ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800 animate-pulse border border-rose-300">
                                  🔴 ไฟดับ (แจ้งเหตุเปิดงานเข้าระบบแล้ว)
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300 animate-none">
                                  🟢 ปกติ (ไม่พบรายงานไฟฟ้าขัดข้อง)
                                </span>
                              )}
                            </div>

                            {/* Instant Reporting Quick Action Panel */}
                            <div className="mt-4 pt-3.5 border-t border-dashed border-green-200 bg-violet-50/70 p-3 rounded-lg space-y-2">
                              <p className="font-extrabold text-xs text-violet-950 flex items-center space-x-1">
                                <span>⚡</span>
                                <span>ปุ่มด่วน: แจ้งสถานะกระแสไฟฟ้าที่บ้านของท่านทันที</span>
                              </p>
                              <p className="text-[9px] text-slate-500 leading-normal">
                                วันใดกระแสไฟฟ้าขัดข้องหรือกลับมาเป็นปกติ คุณสามารถส่งอัปเดตแจ้ง PEA ผ่านปุ่มด่วนได้ทันทีโดยไม่ต้องสับสน ระบบจะพิจารณาพิกัดจองเตียงผู้ป่วยโดยอัตโนมัติ
                              </p>
                              <div className="grid grid-cols-2 gap-2 pt-1.5">
                                <button
                                  type="button"
                                  disabled={instantReporting}
                                  onClick={() => handleInstantReport(p)}
                                  className={`w-full py-2 disabled:bg-slate-300 text-white font-extrabold rounded-md shadow hover:shadow-md cursor-pointer text-center text-[10px] md:text-xs transition active:scale-95 uppercase flex items-center justify-center space-x-1 ${
                                    hasActiveOutageReport ? "bg-rose-400 opacity-60 hover:bg-rose-500 cursor-not-allowed" : "bg-rose-600 hover:bg-rose-700"
                                  }`}
                                >
                                  <span>⚠️</span>
                                  <span>{instantReporting ? "กำลังประมวล..." : hasActiveOutageReport ? "แจ้งไฟดับซ้ำ" : "ยืนยันแจ้งไฟดับ"}</span>
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
                        );
                      })}
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
                <p className="font-bold text-xs text-slate-800">📊 รายการแจ้งไฟดับ เมืองระยอง:</p>
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
          <div className="space-y-6 flex flex-col grow animate-fadeIn">
            
            {/* Admin tab switcher */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-100 p-2 rounded-xl gap-2 shadow-inner border border-slate-200">
              <div className="flex space-x-1.5 w-full sm:w-auto">
                <button
                  onClick={() => setAdminTab("MAP")}
                  className={`flex-grow sm:flex-grow-0 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg text-xs font-bold transition duration-200 cursor-pointer ${
                    adminTab === "MAP"
                      ? "bg-white text-violet-950 shadow-md scale-102 font-extrabold border border-violet-100"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <span>🕹️</span>
                  <span>แผงควบคุมหลัก & แผนที่ (Live Control Map)</span>
                </button>
                <button
                  onClick={() => setAdminTab("ANALYTICS")}
                  className={`flex-grow sm:flex-grow-0 flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg text-xs font-bold transition duration-200 cursor-pointer ${
                    adminTab === "ANALYTICS"
                      ? "bg-white text-violet-950 shadow-md scale-102 font-extrabold border border-violet-100"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <span>📊</span>
                  <span>รวมข้อมูลหลังบ้าน & สถิติสะสม ({reports.length})</span>
                </button>
              </div>

              <div className="text-[11px] font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-lg font-mono flex items-center space-x-2 w-full sm:w-auto justify-center sm:justify-start">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>เชื่อมโยงระบบ GIS ทั่วประเทศ</span>
              </div>
            </div>

            {adminTab === "MAP" ? (
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
                          <span>ทะเบียนผู้ป่วยติดเตียง หรือ กลุ่มเปราะบาง</span>
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
                        <span>ลงทะเบียนผู้ป่วยใหม่ / กลุ่มเปราะบาง</span>
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
                                
                                {p.isAffected ? (
                                  <div className="flex items-center space-x-1 flex-wrap">
                                    <span className="text-[9px] bg-red-100 text-red-800 border border-red-300 font-extrabold py-0.5 px-1.5 rounded-full animate-pulse uppercase flex items-center space-x-0.5">
                                      <span>🔴</span>
                                      <span>ไฟดับ</span>
                                    </span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleInstantResolve(p);
                                      }}
                                      disabled={instantReporting}
                                      className="text-[9px] bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold py-0.5 px-1.5 rounded-full cursor-pointer hover:scale-105 active:scale-95 transition flex items-center space-x-0.5 shadow-sm"
                                      title="กดเพื่อบันทึกงานแก้ไฟสำเร็จ"
                                    >
                                      <span>✅</span>
                                      <span>แก้ไฟสำเร็จ</span>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center space-x-1 flex-wrap">
                                    <span className="text-[9px] bg-green-50 text-green-700 border border-green-200 font-extrabold py-0.5 px-1.5 rounded-full uppercase flex items-center space-x-0.5">
                                      <span>🟢</span>
                                      <span>จ่ายไฟปกติ</span>
                                    </span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleInstantReport(p);
                                      }}
                                      disabled={instantReporting}
                                      className="text-[9px] bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white font-extrabold py-0.5 px-1.5 rounded-full cursor-pointer hover:scale-105 active:scale-95 transition flex items-center space-x-0.5 shadow-sm"
                                      title="กดเพื่อส่งรายงานสถานะไฟดับ"
                                    >
                                      <span>⚠️</span>
                                      <span>แจ้งไฟดับ</span>
                                    </button>
                                  </div>
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
                  patients={computedPatients}
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
                      <span>รายการแจ้งไฟดับเฉพาะวันนี้ (วันต่อวัน)</span>
                    </h3>
                    <p className="text-[10px] text-slate-500">
                      พิจารณาดูแลและสั่งลบประวัติงานซ่อมบำรุงเฉพาะวันปัจจุบันเพื่อให้หน้าจอแผนที่กระชับ
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
                    <span className="text-xs bg-violet-150 text-violet-800 font-black py-1 px-2.5 rounded-full shrink-0">
                      {todayReports.length} รายการวันนี้
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[160px] overflow-y-auto">
                  {todayReports.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center col-span-2 py-4 bg-white rounded border border-slate-100 p-2 leading-relaxed">
                      ไม่มีจุดผู้บริโภครายงานกระแสไฟฟ้าขัดข้องของวันนี้ (ประวติทั่วไปถูกซ่อนแล้ว)
                    </p>
                  ) : (
                    todayReports.map((rep) => (
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
        ) : (
          /* ========================================================
             📊 SYSTEM SUB-PAGE: BACKEND HISTORIC COMPILATION & STATISTICS
             ======================================================== */
          <div className="space-y-6 animate-fadeIn grow flex flex-col">
            
            {/* Header info bar */}
            <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl p-6 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="space-y-1">
                <h2 className="text-lg md:text-xl font-black flex items-center space-x-2 text-white">
                  <span className="text-yellow-400">📊</span>
                  <span>ระบบรวบรวมข้อมูลหลังบ้านและสถิติสะสม เมืองระยอง</span>
                </h2>
                <p className="text-slate-400 text-xs font-medium">
                  สรุปผลรายละเอียดความถี่ จำนวนประวัติการดับไฟและระดับความเปราะบางของผู้ป่วยสะสมสำหรับผู้บริหาร PEA
                </p>
              </div>
              
              <button
                onClick={handleExportReportsToExcel}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow hover:scale-[1.03] active:scale-95 transition cursor-pointer flex items-center space-x-1.5"
              >
                <span>📥 ส่งออกรายงานสารสนเทศหมดประวัติ (.CSV)</span>
              </button>
            </div>

            {/* Metrics cards grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              <div className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 shadow-sm text-slate-800 space-y-2 relative overflow-hidden transition-all duration-200">
                <div className="absolute right-3 top-3 h-10 w-10 bg-violet-50 rounded-full flex items-center justify-center text-violet-500 font-bold text-lg">💡</div>
                <p className="text-slate-400 font-black text-[10px] uppercase tracking-wider">จำนวนผู้แจ้งไฟดับสะสมทั้งหมด</p>
                <p className="text-3xl font-black text-slate-800">{reports.length} <span className="text-xs text-slate-500 font-normal">ครั้ง</span></p>
                <div className="flex items-center space-x-1 text-[10px] text-emerald-600 font-semibold progress-green">
                  <span>✓ รวมบันทึกฐานข้อมูลระบบความคุม</span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 shadow-sm text-slate-800 space-y-2 relative overflow-hidden transition-all duration-200">
                <div className="absolute right-3 top-3 h-10 w-10 bg-rose-50 rounded-full flex items-center justify-center text-rose-600 font-bold text-lg">⚡</div>
                <p className="text-slate-400 font-black text-[10px] uppercase tracking-wider">อยู่ระหว่างซ่อมบำรุงในระบบ</p>
                <p className="text-3xl font-black text-rose-600">
                  {reports.filter(r => r.fixed_status !== "RESOLVED").length} <span className="text-xs text-slate-500 font-normal">งาน</span>
                </p>
                <div className="flex items-center space-x-1 text-[10px] text-rose-500 font-bold">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                  <span>รอทีมงานเข้าทำการซ่อมบำรุงกู้ภัย</span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 shadow-sm text-slate-800 space-y-2 relative overflow-hidden transition-all duration-200">
                <div className="absolute right-3 top-3 h-10 w-10 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 font-bold text-lg">✓</div>
                <p className="text-slate-400 font-black text-[10px] uppercase tracking-wider">จ่ายไฟฟ้าคืนกระแสสำเร็จแล้ว</p>
                <p className="text-3xl font-black text-emerald-600">
                  {reports.filter(r => r.fixed_status === "RESOLVED").length} <span className="text-xs text-slate-500 font-normal">งาน</span>
                </p>
                <div className="flex items-center space-x-1 text-[10px] text-emerald-600 font-semibold">
                  <span>✓ คิดเป็นอัตราความสำเร็จแผ่ขยายดีเยี่ยม</span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 shadow-sm text-slate-800 space-y-2 relative overflow-hidden transition-all duration-200">
                <div className="absolute right-3 top-3 h-10 w-10 bg-teal-50 rounded-full flex items-center justify-center text-teal-600 font-bold text-lg">👵</div>
                <p className="text-slate-400 font-black text-[10px] uppercase tracking-wider">ทะเบียนผู้ป่วยกลุ่มเปราะบางรวม</p>
                <p className="text-3xl font-black text-violet-750">{patients.length} <span className="text-xs text-slate-500 font-normal">ชีวิต</span></p>
                <div className="flex items-center space-x-1 text-[10px] text-slate-500 font-semibold">
                  <span>คุ้มครอง 24 ชั่วโมง ตลอดพิกัด</span>
                </div>
              </div>

            </div>

            {/* Layout division charts & list logs database and subdistricts */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              
              {/* Tambon density distributions */}
              <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col space-y-4">
                <div className="pb-2 border-b border-rose-100">
                  <h3 className="font-extrabold text-slate-900 text-sm flex items-center space-x-1 bg-rose-50 text-rose-900 p-2 rounded">
                    <span>🏢</span>
                    <span>รายงานประมวลไฟฟ้าดับแบ่งรายตำบล (Sub-districts)</span>
                  </h3>
                  <p className="text-[10px] text-slate-500 mt-1">สัดส่วนเหตุการณ์ไฟดับที่เคยป้อนเข้าระบบ (สะสมทุกวัน) เพื่อตรวจหาสายป้อนย่อยที่เปราะบาง</p>
                </div>

                <div className="space-y-3.5 max-h-[350px] overflow-y-auto pr-1 grow flex flex-col justify-center">
                  {(() => {
                    const tambonDensities: { [key: string]: number } = {};
                    reports.forEach((r) => {
                      const name = (r.sub_distric || "ไม่ระบุตำบล").trim();
                      tambonDensities[name] = (tambonDensities[name] || 0) + 1;
                    });
                    const sortedTambons = Object.entries(tambonDensities).sort((a, b) => b[1] - a[1]);
                    const maxVal = Math.max(...Object.values(tambonDensities), 1);

                    if (sortedTambons.length === 0) {
                      return (
                        <p className="text-slate-400 italic font-mono text-center py-10">ไม่มีรายละเอียดการพังเสียหายในระบบ</p>
                      );
                    }

                    return sortedTambons.map(([tName, tCount]) => {
                      const percentage = Math.round((tCount / maxVal) * 100);
                      return (
                        <div key={tName} className="space-y-1">
                          <div className="flex justify-between text-xs font-black text-slate-700">
                            <span>ตำบล{tName}</span>
                            <span className="text-rose-600 bg-rose-100/50 px-2 rounded font-black">{tCount} ครั้ง</span>
                          </div>
                          <div className="w-full bg-slate-200 h-3.5 rounded-full overflow-hidden border border-slate-300">
                            <div
                              className="bg-gradient-to-r from-violet-600 to-rose-500 h-full rounded-full transition-all duration-300"
                              style={{ width: `${percentage}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Comprehensive historic log table of all outages ever recorded */}
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 flex flex-col space-y-4 shadow-sm">
                <div className="pb-2 border-b border-slate-100 flex justify-between items-center bg-slate-50 p-2.5 rounded-xl">
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-xs flex items-center space-x-1.5">
                      <span>👁️‍🗨️</span>
                      <span>ประวัติบันทึกสารสนเทศกระแสไฟดับลึก (Historical Log)</span>
                    </h3>
                    <p className="text-[10px] text-slate-500">รวมรวมทุกประวัติเหตุการณ์ไฟฟ้าดับสะสมทั้งหมดเพื่อประโยชน์ทางสถิติวิศวกรรม</p>
                  </div>
                  <span className="text-xs bg-slate-900 text-amber-400 font-mono px-3 py-1 rounded shadow">
                    สะสม {reports.length} รายการ
                  </span>
                </div>

                <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1 grow">
                  {reports.length === 0 ? (
                    <p className="text-xs text-slate-400 italic text-center py-20">ไม่มีข้อมูลบันทึกในระบบศูนย์ควบคุมความเสียหาย</p>
                  ) : (
                    reports.map((rep) => (
                      <div
                        key={rep.report_id}
                        className={`p-3 rounded-xl border text-xs flex justify-between items-start transition hover:border-slate-300 ${
                          rep.fixed_status === "RESOLVED"
                            ? "bg-slate-50 border-slate-200 text-slate-500 opacity-80"
                            : "bg-white border-rose-200 shadow-sm text-slate-800"
                        }`}
                      >
                        <div className="space-y-1">
                          <p className="font-black text-slate-800 text-[12.5px] flex items-center space-x-1.5">
                            <span>{rep.fixed_status === "RESOLVED" ? "✓" : "⚡"}</span>
                            <span>{rep.report_type} - ม.{rep.address_number} ต.{rep.sub_distric}</span>
                          </p>
                          <p className="text-[10.5px] font-medium text-slate-600">
                            <b>📞 ผู้ร้องขอ:</b> {rep.reporter_name || "ไม่ประสงค์ออกนาม"} (เบอร์โทร: <span className="text-violet-900 font-bold">{rep.reporter_telephone_number}</span>)
                          </p>
                          <p className="text-[9.5px] text-slate-400 font-mono">วันที่รับเรื่อง: {new Date(rep.created_at).toLocaleString("th-TH")}</p>
                        </div>

                        <div className="flex flex-col items-end space-y-2 shrink-0 ml-2">
                          <span className={`text-[9.5px] font-black py-1 px-2.5 rounded-full uppercase leading-none border ${
                            rep.fixed_status === "RESOLVED"
                              ? "bg-green-100 text-green-800 border-green-200"
                              : "bg-rose-100 text-rose-800 border-rose-200 animate-pulse"
                          }`}>
                            {rep.fixed_status === "RESOLVED" ? "ปิดเคสสำเร็จ" : "ไฟดับค้างงาน"}
                          </span>
                          
                          <div className="flex items-center space-x-1">
                            {rep.fixed_status !== "RESOLVED" && (
                              <button
                                onClick={() => handleResolveOutage(rep.report_id)}
                                className="text-[10px] font-bold text-green-600 hover:text-white hover:bg-green-600 border border-green-200 p-1 rounded-md transition duration-150 flex items-center space-x-0.5 whitespace-nowrap cursor-pointer"
                                title="ยืนยันแก้เคสนี้ไฟปกติ"
                              >
                                <span>✅</span>
                                <span>แก้สำเร็จ</span>
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteReport(rep.report_id)}
                              className="text-[10px] text-rose-600 hover:text-rose-105 hover:bg-rose-100 border border-transparent hover:border-rose-200 p-1 rounded-md transition duration-150 flex items-center space-x-0.5"
                              title="ลบรายงานนี้ออกจากคลังถาวร"
                            >
                              <span>🗑️</span>
                              <span>ลบประวัติ</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    )}

        {/* New Outage Warning Popup Modal */}
        {newOutageAlert && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white border-2 border-rose-600 rounded-2xl p-6 max-w-md w-full shadow-2xl relative space-y-4 animate-scaleUp">
              <div className="flex items-center space-x-2 text-rose-600">
                <span className="text-3xl animate-bounce">🚨</span>
                <h3 className="text-lg font-black tracking-tight text-slate-900">ตรวจพบผู้แจ้งไฟดับใหม่ล่าสุด!</h3>
              </div>
              
              <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl space-y-2 text-xs text-slate-700 font-sans">
                <p><b>📍 สถานที่/พิกัด:</b> ต.{newOutageAlert.sub_distric} อ.{newOutageAlert.distric} จ.ระยอง</p>
                <p><b>📋 ปัญหาขัดข้อง:</b> <span className="text-red-700 font-black">{newOutageAlert.report_type}</span></p>
                {newOutageAlert.address_number && <p><b>🏠 รายละเอียดบ้านพัก:</b> {newOutageAlert.address_number}</p>}
                <p><b>👤 ผู้แจ้ง:</b> {newOutageAlert.reporter_name || "ไม่ประสงค์ออกนาม"} ({newOutageAlert.reporter_telephone_number})</p>
                <p><b>⏰ เวลาที่รับเรื่อง:</b> {new Date(newOutageAlert.created_at).toLocaleString("th-TH")}</p>
              </div>

              <div className="text-[10px] text-amber-600 font-bold bg-amber-50 p-2.5 rounded border border-amber-200 font-sans">
                ⚠️ เสียงสัญญาณเตือนร้องยาว 5 วินาทีเรียบร้อยแล้ว กรุณาสั่งจัดการทีมช่างเข้าพื้นที่จุดแจ้งเหตุแก้ไขโดยเร็ว
              </div>

              <div className="flex space-x-2 font-sans">
                <button
                  type="button"
                  onClick={() => {
                    setNewOutageAlert(null);
                    stopSiren();
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg text-xs transition cursor-pointer"
                >
                  รับทราบ & ปิดกล่อง
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (newOutageAlert.latitude && newOutageAlert.longtitude) {
                      setOutageZoneCenter({
                        lat: parseFloat(newOutageAlert.latitude),
                        lng: parseFloat(newOutageAlert.longtitude)
                      });
                    }
                    setNewOutageAlert(null);
                    stopSiren();
                  }}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs transition cursor-pointer animate-pulse"
                >
                  ส่องจุดเกิดเหตุ 📌
                </button>
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

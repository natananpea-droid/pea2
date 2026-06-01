import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Patient, OutageReport } from "../types";

interface SurveillanceMapProps {
  patients: Patient[];
  reports: OutageReport[];
  showPatients: boolean; // privacy guard: hide patient homes on login/consumer screens
  onMapClick?: (lat: number, lng: number) => void;
  outageZoneCenter: { lat: number; lng: number } | null;
  outageZoneRadius: number; // in kilometers
  selectedPatientId: string | null;
  theme: "light" | "dark";
}

export default function SurveillanceMap({
  patients,
  reports,
  showPatients,
  onMapClick,
  outageZoneCenter,
  outageZoneRadius,
  selectedPatientId,
  theme,
}: SurveillanceMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const circleGroupRef = useRef<L.LayerGroup | null>(null);
  const clickHandlerRef = useRef<((lat: number, lng: number) => void) | undefined>(onMapClick);

  // Focus map to Rayong City center
  const rayongCenter: [number, number] = [12.682, 101.275];

  // Update clicking handler ref so we don't have stale closures in leaflet callback
  useEffect(() => {
    clickHandlerRef.current = onMapClick;
  }, [onMapClick]);

  // 1. Initialize Map Instance once
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Create the map
    const map = L.map(mapContainerRef.current, {
      center: rayongCenter,
      zoom: 13,
      zoomControl: false, // Disabling native controls for Premium Custom Zoom
    });

    mapRef.current = map;
    markersGroupRef.current = L.layerGroup().addTo(map);
    circleGroupRef.current = L.layerGroup().addTo(map);

    // Register click event on map
    map.on("click", (e) => {
      if (clickHandlerRef.current) {
        clickHandlerRef.current(e.latlng.lat, e.latlng.lng);
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 2. Adjust Tiles dynamically based on Theme
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove any existing tile layers
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        map.removeLayer(layer);
      }
    });

    let tileUrl = "";
    let attribution = "";

    if (theme === "light") {
      // Beautiful minimal dashboard tiles from CartoDB Positron
      tileUrl = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
      attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
    } else {
      // Dark / Detailed terrain tiles from standard OpenStreetMap (OSM) as requested
      tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
      attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    }

    L.tileLayer(tileUrl, {
      maxZoom: 19,
      attribution,
    }).addTo(map);
  }, [theme]);

  // 3. Render Markers and active circles
  useEffect(() => {
    const map = mapRef.current;
    const markersGroup = markersGroupRef.current;
    const circleGroup = circleGroupRef.current;

    if (!map || !markersGroup || !circleGroup) return;

    // Clear previous elements
    markersGroup.clearLayers();
    circleGroup.clearLayers();

    // A. Render Outage Zones (either current draft circles, or reported outages)
    // Draw circles around pending (not solved) reports
    reports.forEach((rep) => {
      const lat = parseFloat(rep.latitude || "");
      const lng = parseFloat(rep.longtitude || "");
      if (!isNaN(lat) && !isNaN(lng) && rep.fixed_status !== "RESOLVED") {
        // Red glowing warning zone represent blackouts
        const isSelected = outageZoneCenter && Math.abs(outageZoneCenter.lat - lat) < 0.0001 && Math.abs(outageZoneCenter.lng - lng) < 0.0001;
        
        L.circle([lat, lng], {
          radius: (isSelected ? outageZoneRadius : 1.5) * 1000, // standard default 1.5km unless adjusted
          color: "#ef4444",
          fillColor: "#f87171",
          fillOpacity: 0.18,
          weight: 1.5,
          dashArray: "4 4",
        }).addTo(circleGroup);

        // Marker for outage center
        const outageIcon = L.divIcon({
          html: `<div class="relative flex items-center justify-center">
            <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-red-500 opacity-60"></span>
            <div class="relative rounded-full h-6 w-6 bg-red-700 border border-white text-white flex items-center justify-center shadow-lg font-mono text-xs font-bold ring-2 ring-red-300">
              ⚡
            </div>
          </div>`,
          className: "custom-outage-icon",
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });

        const popupText = `
          <div class="p-1 font-sans">
            <h3 class="font-bold text-red-600 border-b border-red-100 pb-1 mb-1">⚡ ตรวจพบเหตุไฟฟ้าขัดข้อง (${rep.report_type})</h3>
            <p class="text-xs text-slate-700 mt-1"><b>ผู้รายงาน:</b> ${rep.reporter_name || "ไม่ประสงค์ออกนาม"}</p>
            <p class="text-xs text-slate-700"><b>ที่อยู่:</b> เลขที่ ${rep.address_number || "-"} ซอย ${rep.soi || "-"} ถนน ${rep.road || "-"}</p>
            <p class="text-xs text-slate-700"><b>ตำบล/อำเภอ:</b> ต. ${rep.sub_distric || "-"} อ. ${rep.distric || "-"}</p>
            <p class="text-xs text-slate-500 text-[10px] mt-1 font-mono">${new Date(rep.created_at).toLocaleString("th-TH")}</p>
          </div>
        `;

        L.marker([lat, lng], { icon: outageIcon }).bindPopup(popupText).addTo(markersGroup);
      }
    });

    // B. Render Outage Radius interactive zone creator
    if (outageZoneCenter) {
      L.circle([outageZoneCenter.lat, outageZoneCenter.lng], {
        radius: outageZoneRadius * 1000,
        color: "#d97706", // Amber 600
        fillColor: "#fbbf24", // Amber 400
        fillOpacity: 0.22,
        weight: 2,
      }).addTo(circleGroup);

      const targetAmberIcon = L.divIcon({
        html: `<div class="relative flex items-center justify-center">
          <span class="animate-ping absolute inline-flex h-10 w-10 rounded-full bg-amber-500 opacity-40"></span>
          <div class="h-4 w-4 bg-amber-500 rounded-full border border-white max-h-4 shadow-lg ring-4 ring-amber-300 flex items-center justify-center">
            <span class="h-2 w-2 bg-slate-900 rounded-full"></span>
          </div>
        </div>`,
        className: "custom-outage-target-icon",
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      L.marker([outageZoneCenter.lat, outageZoneCenter.lng], { icon: targetAmberIcon })
        .bindPopup(`<p class="text-xs font-sans font-bold text-amber-800">🎯 จุดจำลองไฟฟ้าดับ (รัศมี ${outageZoneRadius} กม.)</p>`)
        .addTo(markersGroup);
    }

    // C. Render Bedridden Patient Pins (PRIVACY GUARD)
    if (showPatients) {
      patients.forEach((p) => {
        const pLat = parseFloat(p.latitude || "");
        const pLng = parseFloat(p.longtitude || "");
        if (isNaN(pLat) || isNaN(pLng)) return;

        // Custom priority icons
        let colorClass = "bg-emerald-500 ring-emerald-300";
        let priorityLabel = "ระดับต่ำ (เตียงทั่วไป)";
        let pulseAnim = "";

        if (p.emergency_type === "CRITICAL") {
          colorClass = "bg-red-600 ring-red-400";
          priorityLabel = "⚠️ วิกฤต (เครื่องช่วยหายใจ)";
          if (p.isAffected) {
            pulseAnim = "<span class='animate-ping absolute inline-flex h-8 w-8 rounded-full bg-red-500 opacity-75'></span>";
          }
        } else if (p.emergency_type === "HIGH") {
          colorClass = "bg-orange-500 ring-orange-300";
          priorityLabel = "เร่งด่วนสูง (เครื่องผลิตออกซิเจน/ดูดเสมหะ)";
          if (p.isAffected) {
            pulseAnim = "<span class='animate-ping absolute inline-flex h-6 w-6 rounded-full bg-orange-400 opacity-70'></span>";
          }
        } else if (p.emergency_type === "MEDIUM") {
          colorClass = "bg-yellow-500 ring-yellow-300";
          priorityLabel = "ปานกลาง (เตียงไฟฟ้า/ที่นอนลม)";
          if (p.isAffected) {
            pulseAnim = "<span class='animate-pulse absolute inline-flex h-5 w-5 rounded-full bg-yellow-400 opacity-60'></span>";
          }
        } else {
          if (p.isAffected) {
            pulseAnim = "<span class='animate-pulse absolute inline-flex h-5 w-5 rounded-full bg-emerald-400 opacity-60'></span>";
          }
        }

        // Small indicator of power status on the map icon itself for easy tracking!
        const statusBadge = p.isAffected 
          ? `<span class="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-600 border border-white text-[9px] shadow animate-bounce">🔴</span>`
          : `<span class="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-600 border border-white text-[9px] shadow">🟢</span>`;

        const patientIcon = L.divIcon({
          html: `<div class="relative flex items-center justify-center text-white">
            ${pulseAnim}
            <div class="relative flex items-center justify-center rounded-full h-7 w-7 text-[10px] font-bold ${colorClass} text-center shadow-lg border border-white font-mono scale-110">
              👶
              ${statusBadge}
            </div>
          </div>`,
          className: "custom-patient-icon",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        // Popup content with clear power status display
        const electricityStatusHtml = p.isAffected
          ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 animate-pulse">🔴 ไฟฟ้าขัดข้อง / ไฟดับ</span>`
          : `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">🟢 ระบบไฟฟ้าปกติ</span>`;

        const popupHtml = `
          <div class="p-1 font-sans text-xs min-w-[200px]">
            <div class="flex items-center justify-between mb-1.5 border-b border-slate-100 pb-1.5">
              <div class="flex items-center space-x-1">
                <span class="text-base">👤</span>
                <p class="font-bold text-slate-800 text-sm">${p.owner_name}</p>
              </div>
            </div>
            <div class="mb-2">
              ${electricityStatusHtml}
            </div>
            <p class="text-xs text-slate-600 mt-1"><b>ระดับความเสี่ยง:</b> <span class="font-bold text-slate-800">${priorityLabel}</span></p>
            <p class="text-xs text-slate-600 mt-0.5"><b>รหัสบ้านเลขที่:</b> ${p.address_number || "-"}</p>
            <p class="text-xs text-slate-600"><b>หมายเลขผู้ใช้ไฟ (PEA):</b> ${p.pea_number || "-"}</p>
            <p class="text-xs text-slate-600"><b>เบอร์โทรศัพท์:</b> ${p.telephone_number || "-"}</p>
            <p class="text-xs text-slate-600 block mt-1.5 line-clamp-2 italic bg-slate-50 p-1 rounded">"${p.emergency_description || "ไม่มีรายละเอียดอุปกรณ์พิเศษ"}"</p>
          </div>
        `;

        L.marker([pLat, pLng], { icon: patientIcon }).bindPopup(popupHtml).addTo(markersGroup);
      });
    }
  }, [patients, reports, showPatients, outageZoneCenter, outageZoneRadius, theme]);

  // 4. Handle smooth camera panning
  useEffect(() => {
    if (!selectedPatientId || !mapRef.current) return;

    const findPatient = patients.find((p) => p.emer_house_id === selectedPatientId);
    if (findPatient) {
      const lat = parseFloat(findPatient.latitude || "");
      const lng = parseFloat(findPatient.longtitude || "");
      if (!isNaN(lat) && !isNaN(lng)) {
        mapRef.current.flyTo([lat, lng], 16, {
          duration: 1.5,
          easeLinearity: 0.25,
        });
      }
    }
  }, [selectedPatientId, patients]);

  // Helper actions for Custom Zoom Overlay
  const zoomIn = () => {
    if (mapRef.current) mapRef.current.zoomIn();
  };

  const zoomOut = () => {
    if (mapRef.current) mapRef.current.zoomOut();
  };

  const resetView = () => {
    if (mapRef.current) {
      mapRef.current.setView(rayongCenter, 13, { animate: true });
    }
  };

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden border border-slate-200 shadow-inner">
      {/* Actual Map DOM */}
      <div ref={mapContainerRef} className="w-full h-full" style={{ zIndex: 10 }} />

      {/* Premium Dashboard Floating Control Panel */}
      <div className="absolute bottom-4 right-4 flex flex-col space-y-2 z-[1000] bg-white/95 backdrop-blur-md p-2 rounded-lg shadow-xl border border-slate-200">
        <button
          onClick={zoomIn}
          id="btn-zoom-in"
          className="h-10 w-10 flex items-center justify-center bg-slate-100 hover:bg-violet-600 text-slate-800 hover:text-white rounded-md font-bold text-lg shadow-sm transition hover:scale-105 active:scale-95 cursor-pointer"
          title="ซูมเข้า"
        >
          ＋
        </button>
        <button
          onClick={zoomOut}
          id="btn-zoom-out"
          className="h-10 w-10 flex items-center justify-center bg-slate-100 hover:bg-violet-600 text-slate-800 hover:text-white rounded-md font-bold text-lg shadow-sm transition hover:scale-105 active:scale-95 cursor-pointer"
          title="ซูมออก"
        >
          －
        </button>
        <button
          onClick={resetView}
          id="btn-zoom-reset"
          className="h-10 w-10 flex items-center justify-center bg-slate-100 hover:bg-violet-600 text-slate-800 hover:text-white rounded-md text-xs font-semibold shadow-sm transition hover:scale-105 active:scale-95 cursor-pointer"
          title="คืนค่าตำแหน่งเดิม"
        >
          รีเซ็ต
        </button>
      </div>

      {/* Floating coordinates indicator (informational, clean layout helper) */}
      <div className="absolute top-4 left-4 bg-slate-900/90 text-white font-mono text-[10px] py-1 px-2.5 rounded shadow z-[1000] border border-slate-700/50 backdrop-blur-sm">
        CENTRAL GIS: Rayong, TH
      </div>
    </div>
  );
}

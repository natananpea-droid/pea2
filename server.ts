import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import postgres from "postgres";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize postgres client
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:WZZ9XK2pI12FoQDQ@db.zbvsmsbejemblvycsycx.supabase.co:5432/postgres";
console.log("Connecting database via URL...");

const sql = postgres(dbUrl, {
  ssl: "require", // Supabase requires SSL
});

// Auto-migrate database to add telephone_number and caregiver_name if they are missing
async function runMigrations() {
  try {
    await sql`ALTER TABLE emergency_house ADD COLUMN IF NOT EXISTS telephone_number VARCHAR(255)`;
    await sql`ALTER TABLE emergency_house ADD COLUMN IF NOT EXISTS caregiver_name VARCHAR(255)`;
    console.log("Migration: 'telephone_number' and 'caregiver_name' columns on emergency_house checked/added successfully.");
  } catch (err) {
    console.warn("Migration warning (might be lack of alter permissions, or column already exists):", err);
  }

  try {
    // Delete flood and pole reports from history as requested by user
    await sql`
      DELETE FROM electricity_down_report 
      WHERE report_type LIKE '%อุทกภัย%' 
         OR report_type LIKE '%น้ำท่วม%' 
         OR report_type LIKE '%เสาไฟฟ้า%' 
         OR report_type LIKE '%เสาไฟฟ้าขัดข้อง%';
    `;
    console.log("Cleaned up flood/pole outage reports from DB as requested.");
  } catch (err) {
    console.warn("Clean-up warning:", err);
  }
}
runMigrations();

// Initialize Gemini
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey
  ? new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

console.log("Gemini API Status on server:", ai ? "READY" : "NOT READY (Missing key)");

// PIN Verification Middleware for Admin-write endpoints
function verifyAdminPin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const incomingPIN = req.headers["x-admin-pin"] || (req.body ? req.body.pin : undefined) || req.query.pin;
  if (incomingPIN === "h02101") {
    next();
  } else {
    res.status(403).json({ error: "ไม่อนุญาตให้ดำเนินการ: กรุณาระบุรหัส PIN แอดมินที่ถูกต้องสำหรับการทำงานควบคุมระบบ" });
  }
}

// ==========================================
// 1. Outage Reports (electricity_down_report)
// ==========================================

// Get all outage/disaster reports
app.get("/api/reports", async (req, res) => {
  try {
    const reports = await sql`
      SELECT * FROM electricity_down_report 
      ORDER BY created_at DESC;
    `;
    res.json(reports);
  } catch (err: any) {
    console.error("GET /api/reports error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Submit a new outage report
app.post("/api/reports", async (req, res) => {
  try {
    const nextIdRes = await sql`SELECT COALESCE(MAX(report_id), 0) + 1 as next_id FROM electricity_down_report`;
    const report_id = nextIdRes[0].next_id;

    const {
      reporter_telephone_number,
      reporter_name,
      report_type,
      address_number,
      soi,
      road,
      sub_distric,
      distric,
      province,
      postcode,
      latitude,
      longtitude,
    } = req.body;

    await sql`
      INSERT INTO electricity_down_report (
        report_id,
        created_at,
        reporter_telephone_number,
        reporter_name,
        report_type,
        address_number,
        soi,
        road,
        sub_distric,
        distric,
        province,
        postcode,
        latitude,
        longtitude,
        fixed_status
      ) VALUES (
        ${report_id},
        NOW(),
        ${reporter_telephone_number || null},
        ${reporter_name || null},
        ${report_type || 'ไฟดับ'},
        ${address_number || null},
        ${soi || null},
        ${road || null},
        ${sub_distric || null},
        ${distric || null},
        ${province || null},
        ${postcode ? Number(postcode) : null},
        ${latitude ? String(latitude) : null},
        ${longtitude ? String(longtitude) : null},
        'PENDING'
      )
    `;

    res.status(201).json({ success: true, message: "บันทึกรายงานเหตุการณ์ไฟฟ้าขัดข้องสำเร็จ", report_id });
  } catch (err: any) {
    console.error("POST /api/reports error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Mark an outage/disaster report as resolved
app.put("/api/reports/:id/resolve", verifyAdminPin, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`
      UPDATE electricity_down_report 
      SET fixed_status = 'RESOLVED' 
      WHERE report_id = ${id};
    `;
    res.json({ success: true, message: "ปรับปรุงสถานะเป็นแก้ไขเรียบร้อยแล้ว" });
  } catch (err: any) {
    console.error("PUT /api/reports/:id/resolve error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete an outage report completely (PIN-PROTECTED)
app.delete("/api/reports/:id", verifyAdminPin, async (req, res) => {
  try {
    const { id } = req.params;
    try {
      await sql`
        DELETE FROM electricity_down_report 
        WHERE report_id = ${Number(id)};
      `;
    } catch {
      await sql`
        DELETE FROM electricity_down_report 
        WHERE report_id = ${String(id)};
      `;
    }
    res.json({ success: true, message: "ลบรายงานผู้รับแจ้งเรียบร้อยแล้ว" });
  } catch (err: any) {
    console.error("DELETE /api/reports/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. Vulnerable Bedridden Patients (emergency_house)
// ==========================================

// Get all patient records
app.get("/api/patients", async (req, res) => {
  try {
    const patients = await sql`
      SELECT * FROM emergency_house 
      ORDER BY emer_house_id DESC;
    `;
    res.json(patients);
  } catch (err: any) {
    console.error("GET /api/patients error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create a patient record (PIN-PROTECTED)
app.post("/api/patients", verifyAdminPin, async (req, res) => {
  try {
    const nextIdRes = await sql`SELECT COALESCE(MAX(emer_house_id), 0) + 1 as next_id FROM emergency_house`;
    const emer_house_id = nextIdRes[0].next_id;

    const {
      ca_number,
      pea_number,
      owner_name,
      address_number,
      soi,
      road,
      sub_distric,
      distric,
      province,
      postcode,
      latitude,
      longtitude,
      emergency_type,
      emergency_description,
      status,
      telephone_number,
      caregiver_name,
    } = req.body;

    await sql`
      INSERT INTO emergency_house (
        emer_house_id,
        ca_number,
        pea_number,
        owner_name,
        address_number,
        soi,
        road,
        sub_distric,
        distric,
        province,
        postcode,
        latitude,
        longtitude,
        emergency_type,
        emergency_description,
        status,
        telephone_number,
        caregiver_name
      ) VALUES (
        ${emer_house_id},
        ${ca_number ? Number(ca_number) : null},
        ${pea_number ? Number(pea_number) : null},
        ${owner_name || null},
        ${address_number || null},
        ${soi || null},
        ${road || null},
        ${sub_distric || null},
        ${distric || null},
        ${province || null},
        ${postcode ? Number(postcode) : null},
        ${latitude ? String(latitude) : null},
        ${longtitude ? String(longtitude) : null},
        ${emergency_type || 'LOW'},
        ${emergency_description || null},
        ${status || 'ACTIVE'},
        ${telephone_number || null},
        ${caregiver_name || null}
      )
    `;

    res.status(201).json({ success: true, message: "เพิ่มข้อมูลผู้ป่วยกลุ่มสแกนเสี่ยงภัยสำเร็จ", emer_house_id });
  } catch (err: any) {
    console.error("POST /api/patients error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update a patient record (PIN-PROTECTED)
app.put("/api/patients/:id", verifyAdminPin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      ca_number,
      pea_number,
      owner_name,
      address_number,
      soi,
      road,
      sub_distric,
      distric,
      province,
      postcode,
      latitude,
      longtitude,
      emergency_type,
      emergency_description,
      status,
      telephone_number,
      caregiver_name,
    } = req.body;

    await sql`
      UPDATE emergency_house SET
        ca_number = ${ca_number ? Number(ca_number) : null},
        pea_number = ${pea_number ? Number(pea_number) : null},
        owner_name = ${owner_name || null},
        address_number = ${address_number || null},
        soi = ${soi || null},
        road = ${road || null},
        sub_distric = ${sub_distric || null},
        distric = ${distric || null},
        province = ${province || null},
        postcode = ${postcode ? Number(postcode) : null},
        latitude = ${latitude ? String(latitude) : null},
        longtitude = ${longtitude ? String(longtitude) : null},
        emergency_type = ${emergency_type || 'LOW'},
        emergency_description = ${emergency_description || null},
        status = ${status || 'ACTIVE'},
        telephone_number = ${telephone_number || null},
        caregiver_name = ${caregiver_name || null}
      WHERE emer_house_id = ${Number(id)}
    `;

    res.json({ success: true, message: "อัปเดตข้อมูลผู้ป่วยเรียบร้อยแล้ว" });
  } catch (err: any) {
    console.error("PUT /api/patients/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a patient record (PIN-PROTECTED)
app.delete("/api/patients/:id", verifyAdminPin, async (req, res) => {
  try {
    const { id } = req.params;
    try {
      await sql`
        DELETE FROM emergency_house 
        WHERE emer_house_id = ${Number(id)};
      `;
    } catch {
      await sql`
        DELETE FROM emergency_house 
        WHERE emer_house_id = ${String(id)};
      `;
    }
    res.json({ success: true, message: "ลบข้อมูลผู้ป่วยกลุ่มเปราะบางเรียบร้อยแล้ว" });
  } catch (err: any) {
    console.error("DELETE /api/patients/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. AI Smart Classifier (Google Gemini)
// ==========================================
app.post("/api/analyze-priority", async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || description.trim() === "") {
      return res.status(400).json({ error: "กรุณาระบุคำอธิบายอาการหรือเครื่องมือทางการแพทย์" });
    }

    if (!ai) {
      console.log("No Gemini API key available. Falling back to simple keyword matching pattern.");
      // Fallback matching logic on server to avoid crash if API key is not ready yet
      const descLower = description.toLowerCase();
      let priority = "LOW";
      let reason = "ประเมินโดยใช้อัลกอริทึมจำแนกตามคำสำคัญของอุปกรณ์แพทย์:";

      if (descLower.includes("เครื่องช่วยหายใจ") || descLower.includes("ventilator") || descLower.includes("ช่วยหายใจ")) {
        priority = "CRITICAL";
        reason += " ตรวจพบคำว่า 'เครื่องช่วยหายใจ' ซึ่งมีความเสี่ยงสูงสุดต่อชีวิตเมื่อไม่มีไฟฟ้าใช้งาน";
      } else if (descLower.includes("ดูดเสมหะ") || descLower.includes("suction") || descLower.includes("ผลิตออกซิเจน") || descLower.includes("oxygen")) {
        priority = "HIGH";
        reason += " ตรวจพบอุปกรณ์พยุงชีพไฟฟ้าระดับสูง (เครื่องผลิตออกซิเจน หรือ เครื่องดูดเสมหะ)";
      } else if (descLower.includes("เตียงไฟฟ้า") || descLower.includes("ที่นอนลม") || descLower.includes("ลม") || descLower.includes("เตียงพยาบาล")) {
        priority = "MEDIUM";
        reason += " ตรวจพบอุปกรณ์ไฟฟ้าอำนวยความสะดวกป้องกันแผลกดทับ (เตียงพยาบาลไฟฟ้า หรือ ที่นอนลม)";
      } else {
        priority = "LOW";
        reason += " เป็นผู้ป่วยติดเตียงดูแลประคับประคองทั่วไป ไม่พบประวัติใช้อุปกรณ์พยุงชีพไฟฟ้าสำคัญในข้อมูล";
      }

      return res.json({ priority, reason: reason + " (ระบบเซิร์ฟเวอร์จำลองอัจฉริยะเนื่องจากไม่มี API Key)" });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Analyze the following patient condition details or medical equipment description. Your task is to recommend one of four Medical Priority Levels:
- CRITICAL: User relies on a Ventilator (เครื่องช่วยหายใจ) or life-support machine that cannot stop for even a short period without high mortality risk.
- HIGH: User relies on a Suction machine (เครื่องดูดเสมหะ) or a mainline Oxygen Concentrator (เครื่องผลิตออกซิเจน) which is essential but handles temporary breaks slightly better.
- MEDIUM: User relies on an Electric hospital bed (เตียงพยาบาลไฟฟ้า) or Anti-bedsore Air Mattress (ที่นอนลมป้องกันแผลกดทับ).
- LOW: Bedridden patient with general physical support, but who does not require a highly sensitive main electrical medical instrument.

Text to analyze: "${description}"
Respond with a JSON object containing keys "priority" (must be strictly one of "CRITICAL", "HIGH", "MEDIUM", "LOW" as a string) and "reason" (a brief explanation in Thai stating why this priority was chosen and which device triggered it).`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            priority: {
              type: Type.STRING,
              description: "Must be CRITICAL, HIGH, MEDIUM, or LOW",
            },
            reason: {
              type: Type.STRING,
              description: "Explanation in Thai language mentioning identified devices and clinical relevance",
            },
          },
          required: ["priority", "reason"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    res.json(parsed);
  } catch (err: any) {
    console.error("Gemini Priority analysis error:", err);
    res.status(500).json({ error: `ไม่สามารถเชื่อมต่อพลังวิเคราะห์ AI ได้: ${err.message}` });
  }
});

// Route for immediate blackout resolution by patient's phone/coordinates
app.post("/api/reports/resolve-instant", async (req, res) => {
  try {
    const { latitude, longtitude, telephone_number, pea_number, ca_number } = req.body;
    
    // 1. Get all pending reports
    const pendingReports = await sql`
      SELECT * FROM electricity_down_report 
      WHERE fixed_status != 'RESOLVED';
    `;
    
    const idsToResolve: number[] = [];
    
    // Helper to calculate distance
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371; // km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };

    const cleanUserPhone = telephone_number ? telephone_number.trim().replace(/[-\s]/g, "") : "";
    const cleanUserPEA = pea_number ? String(pea_number).trim().replace(/[-\s]/g, "") : "";
    const cleanUserCA = ca_number ? String(ca_number).trim().replace(/[-\s]/g, "") : "";

    for (const rep of pendingReports) {
      let shouldResolve = false;

      // Check by reporter phone
      if (rep.reporter_telephone_number) {
        const cleanRepPhone = rep.reporter_telephone_number.trim().replace(/[-\s]/g, "");
        if (cleanUserPhone && cleanRepPhone === cleanUserPhone) {
          shouldResolve = true;
        }
      }

      // Check by distance if patient coordinates are available
      if (!shouldResolve && latitude && longtitude && rep.latitude && rep.longtitude) {
        const pLat = parseFloat(latitude);
        const pLng = parseFloat(longtitude);
        const rLat = parseFloat(rep.latitude);
        const rLng = parseFloat(rep.longtitude);
        if (!isNaN(pLat) && !isNaN(pLng) && !isNaN(rLat) && !isNaN(rLng)) {
          const dist = getDistance(pLat, pLng, rLat, rLng);
          if (dist <= 1.5) { // within 1.5km
            shouldResolve = true;
          }
        }
      }

      if (shouldResolve) {
        idsToResolve.push(Number(rep.report_id));
      }
    }

    if (idsToResolve.length > 0) {
      await sql`
        UPDATE electricity_down_report 
        SET fixed_status = 'RESOLVED' 
        WHERE report_id IN (${idsToResolve});
      `;
    }

    res.json({ 
      success: true, 
      message: "ปรับปรุงสถานะกระแสไฟปกติเรียบร้อยแล้ว",
      resolvedCount: idsToResolve.length
    });
  } catch (err: any) {
    console.error("POST /api/reports/resolve-instant error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. Serve Vite SPA
// ==========================================
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupVite();

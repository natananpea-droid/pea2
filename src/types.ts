export interface Patient {
  emer_house_id: string; // bigint on server, comes as string in JSON
  ca_number: string | null;
  pea_number: string | null;
  owner_name: string | null;
  address_number: string | null;
  soi: string | null;
  road: string | null;
  sub_distric: string | null;
  distric: string | null;
  province: string | null;
  postcode: string | null;
  latitude: string | null;
  longtitude: string | null; // note the database spelling 'longtitude'
  emergency_type: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string;
  emergency_description: string | null;
  status: string | null; // e.g. ACTIVE or INACTIVE
  telephone_number: string | null; // Patient/caregiver phone number
  caregiver_name: string | null; // Name on electricity bill or caregiver name
  
  // Computed field for UI
  distanceFromOutage?: number; // in km
  isAffected?: boolean; 
}

export interface OutageReport {
  report_id: string; // bigint on server, comes as string in JSON
  created_at: string;
  reporter_telephone_number: string | null;
  reporter_name: string | null;
  report_type: string | null; // 'ไฟดับ' | 'ไฟตก' | 'หม้อแปลงชำรุด' | 'น้ำท่วม' etc
  address_number: string | null;
  soi: string | null;
  road: string | null;
  sub_distric: string | null;
  distric: string | null;
  province: string | null;
  postcode: string | null;
  latitude: string | null;
  longtitude: string | null; // note the database spelling 'longtitude'
  fixed_status: string | null; // 'PENDING' | 'RESOLVED'
}

export type AccountType = 'NONE' | 'CONSUMER' | 'ADMIN';

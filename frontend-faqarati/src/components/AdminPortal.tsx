/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from "react";
import { 
  Building2, Users, UserCheck, Calendar, FileText, MessageSquare, 
  LifeBuoy, ShieldAlert, Activity, Search, Plus, CheckCircle, 
  AlertCircle, Database, Clock, CreditCard, Sparkles, Key, Check, 
  X, ShieldCheck, ArrowRightLeft, Lock, Trash2, HelpCircle, Eye
} from "lucide-react";

// Types for our local relational database simulation
interface Clinic {
  id: string;
  name: string;
  contactEmail: string;
  createdAt: string;
  tier: "Starter Bronze" | "Pro Gold" | "Platform Enterprise";
  status: "active" | "suspend";
}

interface SimulatedUser {
  id: string;
  clinicId: string;
  role: "Clinic Admin" | "PT Specialist" | "Patient";
  fullName: string;
  email: string;
  diagnosisNotes?: string;
  specialty?: string;
  isVerified?: boolean; // PT verification state by Super Admin
}

interface Assignment {
  id: string;
  patientId: string;
  ptId: string;
  assignedDate: string;
  status: "Active" | "Discharged";
}

interface SimulatedAppointment {
  id: string;
  patientId: string;
  ptId: string;
  startTime: string;
  endTime: string;
  status: "Scheduled" | "Completed" | "Canceled";
}

interface MedicalRecord {
  id: string;
  patientId: string;
  ptId: string;
  diagnosisNotes: string;
  treatmentPlan: string;
  createdAt: string;
}

interface ClinicalMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  sentAt: string;
  readStatus: boolean;
}

interface SupportTicket {
  id: string;
  reporterId: string;
  assignedAdminId?: string;
  subject: string;
  description: string;
  status: "Open" | "In Progress" | "Resolved";
  priority: "High" | "Medium" | "Low";
  createdAt: string;
}

interface SimulatedAuditLog {
  id: string;
  timestamp: string;
  actor: string;
  roles: string;
  action: string;
  tenantId: string;
  complianceHash: string;
}

import AdminPipelineConsole from "./admin/AdminPipelineConsole";
import ExerciseLibraryCMS from "./admin/ExerciseLibraryCMS";

interface AdminPortalProps {
  activePath?: string;
}

export default function AdminPortal({ activePath = "/admin/dashboard" }: AdminPortalProps) {
  // -------------------------------------------------------------
  // 1. Relational Database States
  // -------------------------------------------------------------
  const [clinics, setClinics] = useState<Clinic[]>([
    { id: "c1", name: "مستشفى غسان فرعون للتأهيل (جدة)", contactEmail: "gpf@faqarati-saas.com", createdAt: "2026-01-10", tier: "Platform Enterprise", status: "active" },
    { id: "c2", name: "مستشفى الملك فيصل التخصصي (الرياض)", contactEmail: "kfsh@faqarati-saas.com", createdAt: "2025-11-15", tier: "Platform Enterprise", status: "active" },
    { id: "c3", name: "مركز ذرّة للتأهيل المتكامل (الخير والدمام)", contactEmail: "tharra@faqarati-saas.com", createdAt: "2026-03-22", tier: "Pro Gold", status: "active" }
  ]);

  const [users, setUsers] = useState<SimulatedUser[]>([
    // Clinic 1 (GHF - c1) Patients and PTs
    { id: "usr-ca1", clinicId: "c1", role: "Clinic Admin", fullName: "م. بندر بن نايف", email: "bandar.n@faqarati-saas.com" },
    { id: "usr-pt1", clinicId: "c1", role: "PT Specialist", fullName: "د. أحمد الرويلي", email: "ahmed.ruwaili@faqarati.com", specialty: "آلام العمود الفقري والانزلاق", isVerified: true },
    { id: "usr-pt2", clinicId: "c1", role: "PT Specialist", fullName: "أخصائي حازم العجلان", email: "hazem@faqarati.com", specialty: "تأهيل الجزء القطني والفقرات", isVerified: false }, // Pending Admin approval
    { id: "usr-p1", clinicId: "c1", role: "Patient", fullName: "فاطمة محمد الأحمد", email: "fatemah.it@gmail.com", diagnosisNotes: "انزلاق غضروفي بالفقرتين L4-L5" },
    { id: "usr-p2", clinicId: "c1", role: "Patient", fullName: "خالد بن فيصل", email: "khaled.f@gmail.com", diagnosisNotes: "تصلب الفقرات القطنية السفلى" },

    // Clinic 2 (KFSH - c2) Patients and PTs
    { id: "usr-ca2", clinicId: "c2", role: "Clinic Admin", fullName: "د. سلمان الشلهوب", email: "shalhoub@kfsh.com" },
    { id: "usr-pt3", clinicId: "c2", role: "PT Specialist", fullName: "د. هدى الدوسري", email: "hoda@kfsh.com", specialty: "تأهيل الركبة وإصابات الملاعب", isVerified: true },
    { id: "usr-pt4", clinicId: "c2", role: "PT Specialist", fullName: "أ. طارق الودعاني", email: "tarek@kfsh.com", specialty: "أعصاب وفقرات عنقية", isVerified: true },
    { id: "usr-p3", clinicId: "c2", role: "Patient", fullName: "ياسر الحربي", email: "yasser.h@gmail.com", diagnosisNotes: "تمزق رباط صليبي أمامي جزئي بالركبة" },
    { id: "usr-p4", clinicId: "c2", role: "Patient", fullName: "نورة العتيبي", email: "noura.otb@gmail.com", diagnosisNotes: "ألم الديسك العنقي وشد عضلي بالرقبة" },

    // Clinic 3 (Tharra - c3)
    { id: "usr-ca3", clinicId: "c3", role: "Clinic Admin", fullName: "أ. ماجد السهلي", email: "majed@tharra.com" },
    { id: "usr-pt5", clinicId: "c3", role: "PT Specialist", fullName: "أ. مازن المقرن", email: "mazen@tharra.com", specialty: "التأهيل الرياضي المتقدم", isVerified: true },
    { id: "usr-p5", clinicId: "c3", role: "Patient", fullName: "خلود العتيبي", email: "kholoud.otb@gmail.com", diagnosisNotes: "شد وتشنج الفقرات العنقية الأكتاف" }
  ]);

  const [assignments, setAssignments] = useState<Assignment[]>([
    { id: "asg-1", patientId: "usr-p1", ptId: "usr-pt1", assignedDate: "2026-06-12 09:00", status: "Active" },
    { id: "asg-2", patientId: "usr-p2", ptId: "usr-pt1", assignedDate: "2026-06-15 11:30", status: "Active" },
    { id: "asg-3", patientId: "usr-p3", ptId: "usr-pt3", assignedDate: "2026-06-18 10:00", status: "Active" },
    { id: "asg-4", patientId: "usr-p4", ptId: "usr-pt4", assignedDate: "2026-06-20 14:00", status: "Active" },
    { id: "asg-5", patientId: "usr-p5", ptId: "usr-pt5", assignedDate: "2026-06-22 12:00", status: "Active" }
  ]);

  const [appointments, setAppointments] = useState<SimulatedAppointment[]>([
    { id: "appt-1", patientId: "usr-p1", ptId: "usr-pt1", startTime: "2026-06-25 10:30", endTime: "2026-06-25 11:15", status: "Scheduled" },
    { id: "appt-2", patientId: "usr-p2", ptId: "usr-pt1", startTime: "2026-06-26 14:30", endTime: "2026-06-26 15:15", status: "Scheduled" },
    { id: "appt-3", patientId: "usr-p3", ptId: "usr-pt3", startTime: "2026-06-24 16:00", endTime: "2026-06-24 16:45", status: "Scheduled" }
  ]);

  const [medicalRecords, setMedicalRecords] = useState<MedicalRecord[]>([
    { id: "rec-1", patientId: "usr-p1", ptId: "usr-pt1", diagnosisNotes: "انزلاق غضروفي بالفقرتين L4-L5 مع شد عضلي حاد ومستوى ألم 7/10", treatmentPlan: "تمديد العمود الفقري بزاوية 145-175 درجة مع ثبات 5 ثوانٍ، 3 مجموعات يومياً", createdAt: "2026-06-12 09:45" },
    { id: "rec-2", patientId: "usr-p3", ptId: "usr-pt3", diagnosisNotes: "تأهيل ما بعد الرباط الصليبي، محدودية زاوية ثني الركبة", treatmentPlan: "قرفصاء تأهيلية للركبة بزاوية تماثل هدف 90 درجة لتفادي تآكل الغضروف", createdAt: "2026-06-18 10:30" }
  ]);

  const [messages, setMessages] = useState<ClinicalMessage[]>([
    { id: "msg-1", senderId: "usr-pt1", receiverId: "usr-p1", content: "يرجى الحفاظ على هدوء الحركة في تمرين القطنية والنزول ببطء دون جهد فجائي.", sentAt: "أمس 08:30 ص", readStatus: true },
    { id: "msg-2", senderId: "usr-p1", receiverId: "usr-pt1", content: "دكتور أحمد، هل أستمر بنفس عدد المجموعات في حال تراجع الألم لـ 3/10؟", sentAt: "أمس 09:12 ص", readStatus: true },
    { id: "msg-3", senderId: "usr-pt1", receiverId: "usr-p1", content: "نعم يا فاطمة، استمري لتثبيت دعم الفقرات وسنزيد الصعوبة تدريجياً الأسبوع المقبل.", sentAt: "أمس 10:15 ص", readStatus: false }
  ]);

  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([
    { id: "tkt-1", reporterId: "usr-p1", assignedAdminId: "admin-1", subject: "لا تظهر إشارة استشعار الكاميرا الخضراء", description: "عند تشغيل وضع الذكاء الاصطناعي لتأهيل الركبة المتطور لا يستطيع هاتفي التقاط إحداثيات المشط بوضوح.", status: "In Progress", priority: "High", createdAt: "2026-06-21 21:12" },
    { id: "tkt-2", reporterId: "usr-ca3", subject: "فشل تفعيل الفوترة المشتركة لـ Stripe", description: "نريد ترقية خزان الحوسبة السحابية لمركز ذرة من starter إلى Pro لتغطية 20 ممارس إضافي.", status: "Open", priority: "Medium", createdAt: "2026-06-22 11:00" }
  ]);

  const [auditLogs, setAuditLogs] = useState<SimulatedAuditLog[]>([
    { id: "aud-01", timestamp: "14:22:15", actor: "د. أحمد الرويلي", roles: "PT Specialist", action: "تعديل المخطط السلوكي وتحديث زوايا ثبوت الكاميرا في تمرين ديسك L4-L5 للمريضة فاطمة الأحمد", tenantId: "c1", complianceHash: "SHA256:d8a923cebfa10" },
    { id: "aud-02", timestamp: "14:24:30", actor: "م. بندر بن نايف", roles: "Clinic Admin", action: "ربط وتعيين ملف المريض خالد بن فيصل بالأخصائي المعالج حازم العجلان", tenantId: "c1", complianceHash: "SHA256:06eb184bc2fe1" },
    { id: "aud-03", timestamp: "14:31:02", actor: "المشرف العام (بوابة SaaS)", roles: "Super Admin", action: "اعتماد وترخيص الطبيب د. أحمد الرويلي لممارسة الرياضة الطبية بعد مطابقة الشهادات", tenantId: "c1", complianceHash: "SHA256:49ab31fde0cc9" }
  ]);

  // -------------------------------------------------------------
  // 2. Multi-Tenant Simulation Configurations
  // -------------------------------------------------------------
  const [selectedSimClinicId, setSelectedSimClinicId] = useState<string>("c1");
  const [selectedSimRole, setSelectedSimRole] = useState<"Super Admin" | "Clinic Admin" | "PT Specialist" | "Patient">("Clinic Admin");
  
  // Under Super Admin view, select a secondary tab
  const [superAdminTab, setSuperAdminTab] = useState<"billing" | "tickets" | "clinics" | "verifications">("billing");
  
  // UI Tabs
  const [mainPortalTab, setMainPortalTab] = useState<"workspace" | "schema" | "privacy">("workspace");

  useEffect(() => {
    // Every sidebar route must land on real content — unmapped paths used
    // to leave the previous view (or a blank page) behind, which read as
    // "admin pages don't work".
    if (activePath === "/admin/verifications") {
      setMainPortalTab("workspace");
      setSuperAdminTab("verifications");
    } else if (activePath === "/admin/clinics" || activePath === "/admin/users") {
      setMainPortalTab("workspace");
      setSuperAdminTab("clinics");
    } else if (activePath === "/admin/settings") {
      setMainPortalTab("schema");
    } else if (activePath === "/admin/dashboard" || activePath === "/admin/audit") {
      setMainPortalTab("workspace");
    }
  }, [activePath]);

  if (activePath === "/admin/pipeline") {
    return <AdminPipelineConsole />;
  }

  if (activePath === "/admin/exercise-library") {
    return <ExerciseLibraryCMS />;
  }

  // Onboarding clinical states
  const [newPtName, setNewPtName] = useState("");
  const [newPtEmail, setNewPtEmail] = useState("");
  const [newPtSpecialty, setNewPtSpecialty] = useState("");

  // Assignment states
  const [assignPatientId, setAssignPatientId] = useState("");
  const [assignPtId, setAssignPtId] = useState("");

  // Support ticket addition
  const [newTicketSubject, setNewTicketSubject] = useState("");
  const [newTicketDesc, setNewTicketDesc] = useState("");
  const [newTicketPriority, setNewTicketPriority] = useState<"High" | "Medium" | "Low">("Medium");

  // Schema selected table for visualizer
  const [selectedTable, setSelectedTable] = useState<string>("Clinics");

  // Active simulated therapist id (filter patients of this therapist in PT Workspace)
  const currentSimulatedPTId = useMemo(() => {
    const pt = users.find(u => u.clinicId === selectedSimClinicId && u.role === "PT Specialist" && u.isVerified);
    return pt ? pt.id : "";
  }, [selectedSimClinicId, users]);

  // Active simulated patient in workspace
  const currentSimulatedPatientId = useMemo(() => {
    const patient = users.find(u => u.clinicId === selectedSimClinicId && u.role === "Patient");
    return patient ? patient.id : "";
  }, [selectedSimClinicId, users]);

  const activeClinic = useMemo(() => {
    return clinics.find(c => c.id === selectedSimClinicId) || clinics[0];
  }, [clinics, selectedSimClinicId]);

  // Logs helper
  const addAuditLog = (actor: string, role: string, action: string, tenantId: string) => {
    const newLog: SimulatedAuditLog = {
      id: `aud-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString("ar-SA"),
      actor,
      roles: role,
      action,
      tenantId,
      complianceHash: `SHA256:${Math.random().toString(16).substr(2, 13)}`
    };
    setAuditLogs(prev => [newLog, ...prev]);
  };

  // -------------------------------------------------------------
  // 3. Simulated Administrative Functions
  // -------------------------------------------------------------
  
  // For Clinic Admin: Onboard/add new Specialist to active clinic
  const handleOnboardPT = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPtName.trim() || !newPtEmail.trim()) return;

    const newPT: SimulatedUser = {
      id: `usr-pt-${Date.now()}`,
      clinicId: selectedSimClinicId,
      role: "PT Specialist",
      fullName: newPtName,
      email: newPtEmail,
      specialty: newPtSpecialty || "العلاج الطبيعي العام وتحريك المفاصل",
      isVerified: false // Requires super-admin approval
    };

    setUsers(prev => [...prev, newPT]);
    
    // Add transaction audit log
    addAuditLog(
      selectedSimRole === "Clinic Admin" ? "مشرف العيادة المحلي" : "المشرف العام",
      selectedSimRole,
      `تسجيل واستقطاب المعالج الجديد: ${newPtName} (بانتظار التحقق من ترخيص الهيئة الطبية وبوابة MOH)`,
      selectedSimClinicId
    );

    setNewPtName("");
    setNewPtEmail("");
    setNewPtSpecialty("");
    alert(`تم إدراج المعالج بنجاح! يرجى التبديل لـ "Super Admin" للموافقة الفورية والتحقق من ترخيصه الطبي.`);
  };

  // For Super Admin: Approve pending PT licenses
  const handleVerifyPTLicense = (id: string) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, isVerified: true } : u));
    const pt = users.find(u => u.id === id);
    if (pt) {
      addAuditLog(
        "المشرف العام (منصة فقراتي)",
        "Super Admin",
        `تم مطابقة وترخيص المعالج ${pt.fullName} عبر بوابة الهيئة الرقمية وتحويل حالته إلى نشط بالكامل`,
        pt.clinicId
      );
    }
  };

  // For Clinic Admin: Create assignment Patient PT
  const handleCreateAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignPatientId || !assignPtId) return;

    // Check if assignment already exists
    const exists = assignments.some(a => a.patientId === assignPatientId && a.ptId === assignPtId);
    if (exists) {
      alert("هذا المريض مخصص بالفعل لهذا الأخصائي.");
      return;
    }

    const newAsg: Assignment = {
      id: `asg-${Date.now()}`,
      patientId: assignPatientId,
      ptId: assignPtId,
      assignedDate: new Date().toISOString().replace('T', ' ').substring(0, 16),
      status: "Active"
    };

    setAssignments(prev => [...prev, newAsg]);

    const pName = users.find(u => u.id === assignPatientId)?.fullName || "غير محدد";
    const ptName = users.find(u => u.id === assignPtId)?.fullName || "غير محدد";

    addAuditLog(
      "مشرف عيادة " + activeClinic.name,
      "Clinic Admin",
      `ربط رسمي وتفويض ملف المريض: [${pName}] ببرنامج الأخصائي المعالج: [${ptName}] (تأسيس مسار care-loop)`,
      selectedSimClinicId
    );

    setAssignPatientId("");
    setAssignPtId("");
  };

  // For Patients: Create platform Support IT Ticket
  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicketSubject.trim() || !newTicketDesc.trim()) return;

    const patient = users.find(u => u.id === currentSimulatedPatientId);
    const newTkt: SupportTicket = {
      id: `tkt-${Date.now()}`,
      reporterId: currentSimulatedPatientId,
      subject: newTicketSubject,
      description: newTicketDesc,
      status: "Open",
      priority: newTicketPriority,
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
    };

    setSupportTickets(prev => [...prev, newTkt]);

    addAuditLog(
      patient?.fullName || "المريض المحاكي",
      "Patient",
      `إنشاء تذكرة دعم فني جديدة للشبكة: "${newTicketSubject}" (تصنيف غير طبي - IT Ticket)`,
      selectedSimClinicId
    );

    setNewTicketSubject("");
    setNewTicketDesc("");
    alert("تم تقديم تذكرة الدعم IT بنجاح إلى المشرفين الفنيين بالمنصة!");
  };

  // Resolve ticket by admin
  const handleResolveTicket = (id: string) => {
    setSupportTickets(prev => prev.map(t => t.id === id ? { ...t, status: "Resolved" } : t));
    const tkt = supportTickets.find(t => t.id === id);
    if (tkt) {
      addAuditLog(
        "مشرف الدعم (Super Admin)",
        "Super Admin",
        `حل مشكلة وإغلاق تذكرة الدعم الفني: "${tkt.subject}" للمستفيد المالك`,
        selectedSimClinicId
      );
    }
  };

  // PT Update Patient medical record notes
  const [newClinicalNote, setNewClinicalNote] = useState("");
  const [newClinicalTreatment, setNewClinicalTreatment] = useState("");

  const handleCreateClinicalLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClinicalNote.trim() || !newClinicalTreatment.trim()) return;

    const newRec: MedicalRecord = {
      id: `rec-${Date.now()}`,
      patientId: currentSimulatedPatientId,
      ptId: currentSimulatedPTId,
      diagnosisNotes: newClinicalNote,
      treatmentPlan: newClinicalTreatment,
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
    };

    setMedicalRecords(prev => [...prev, newRec]);

    const pObj = users.find(u => u.id === currentSimulatedPatientId);
    const ptObj = users.find(u => u.id === currentSimulatedPTId);

    addAuditLog(
      ptObj?.fullName || "المعالج",
      "PT Specialist",
      `إضافة وتشفير سجل طبي سريري جديد للمريض ${pObj?.fullName}: التشخيص [${newClinicalNote}] والوصفة [${newClinicalTreatment}]`,
      selectedSimClinicId
    );

    setNewClinicalNote("");
    setNewClinicalTreatment("");
    alert("تم تدوين وتخزين السجل السريري للمريض بمأمن ووفق بروتوكولات HIPAA المستهدفة.");
  };

  // -------------------------------------------------------------
  // Data Filtered based on Tenant Isolation Rules (ClinicID)
  // -------------------------------------------------------------
  // "The system must ensure that Clinic A cannot access Patient records, PT schedules, or tickets belonging to Clinic B."
  const clinicIsolator = {
    // Current clinic users table isolation
    users: users.filter(u => u.clinicId === selectedSimClinicId),
    
    // PTs filtered for current clinic
    pts: users.filter(u => u.clinicId === selectedSimClinicId && u.role === "PT Specialist"),
    
    // Patients of this clinic
    patients: users.filter(u => u.clinicId === selectedSimClinicId && u.role === "Patient"),

    // Assignments in current clinic
    assignments: assignments.filter(a => {
      const patient = users.find(u => u.id === a.patientId);
      return patient && patient.clinicId === selectedSimClinicId;
    }),

    // Appointments allocated to current clinic
    appointments: appointments.filter(appt => {
      const patient = users.find(u => u.id === appt.patientId);
      return patient && patient.clinicId === selectedSimClinicId;
    }),

    // Medical records specific to this clinic
    medicalRecords: medicalRecords.filter(rec => {
      const patient = users.find(u => u.id === rec.patientId);
      return patient && patient.clinicId === selectedSimClinicId;
    }),

    // Clinically encrypted private chat messages
    clinicalMessages: messages.filter(m => {
      const sender = users.find(u => u.id === m.senderId);
      return sender && sender.clinicId === selectedSimClinicId;
    }),

    // Local IT tickets belonging to reporters from this clinic
    supportTickets: supportTickets.filter(tkt => {
      const reporter = users.find(u => u.id === tkt.reporterId);
      // Some tickets (like superadmin general ones) can be unlinked, but we filter by current tenant
      return reporter && reporter.clinicId === selectedSimClinicId;
    })
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-right font-sans" dir="rtl">
      
      {/* 1. Header Banner & Big Simulation Switcher Frame */}
      <div className="bg-slate-950 text-white rounded-3xl p-6 sm:p-8 border border-slate-850 shadow-2xl space-y-6">
        
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="space-y-1.5 text-right">
            <div className="bg-emerald-500/15 text-emerald-400 font-mono text-[10px] font-bold border border-emerald-500/25 px-3 py-1 rounded-lg w-max mb-1.5 inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>B2B MULTI-TENANT HEALTHCARE ENGINE</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-black text-white">
              محاكي ومستودع SaaS لإدارة المصحات شريكة "فقراتي (.Faqarati)" 🩺
            </h2>
            <p className="text-slate-400 text-xs sm:text-sm">
              مرحلة تخطيط وتحقق تفاعلية تبرهن على عزل البيانات، وصلاحيات الأمان (RBAC)، وترابط الجداول الطبية (FK/PK)، ومسارات الفوترة الاستثمارية للمصحات.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setMainPortalTab("workspace")}
              className={`px-4.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                mainPortalTab === "workspace" ? "bg-white text-slate-950" : "bg-slate-900 text-slate-400 font-medium hover:text-white"
              }`}
            >
              <Key className="w-4 h-4" />
              <span>لوحة العمليات وحالة المحاكاة</span>
            </button>
            <button
              onClick={() => setMainPortalTab("schema")}
              className={`px-4.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                mainPortalTab === "schema" ? "bg-white text-slate-950" : "bg-slate-900 text-slate-400 font-medium hover:text-white"
              }`}
            >
              <Database className="w-4 h-4" />
              <span>مخطط قواعد البيانات العلائقية (ERD)</span>
            </button>
          </div>
        </div>

        {/* INTERACTIVE CONTROLLER BANNER: Switch simulated clinic or user role */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          
          <div className="space-y-2">
            <label className="block text-slate-300 font-bold text-xs flex items-center gap-1 justify-start">
              <Building2 className="w-4 h-4 text-brand-400" />
              <span>المستأجر الحالي للتكامل (Tenant Isolation Clinic ID):</span>
            </label>
            <div className="flex bg-slate-950 p-1.5 rounded-xl gap-2 font-black border border-slate-800">
              {clinics.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedSimClinicId(c.id);
                    // Reset role switcher if role belongs to patients on this tenant
                    addAuditLog("لوحة المحاكاة", "تغيير المستأجر", `التبديل التفاعلي لعقد المصحة للمستأجر [${c.name}]. تصفية تلقائية لعزل البيانات الطبية لضمان الخصوصية HIPAA.`, c.id);
                  }}
                  className={`flex-1 py-2 text-[10px] sm:text-xs rounded-lg transition-all cursor-pointer font-bold ${
                    selectedSimClinicId === c.id 
                      ? "bg-slate-800 text-white shadow-md border border-brand-500/30" 
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {c.name.split(" ")[1]} (العقد {c.id})
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 leading-snug">
              عند تغيير المصحة الشريكة، سيتم عزل Patients والوصفات والتذاكر والجدولة فورياً في الذاكرة لتطابق بيئة SaaS الطبية.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-slate-300 font-bold text-xs flex items-center gap-1 justify-start">
              <Key className="w-4 h-4 text-brand-400" />
              <span>حساب الشخصية النشطة للمحاكاة (Role-Based Access Control):</span>
            </label>
            <div className="flex bg-slate-950 p-1.5 rounded-xl gap-1.5 font-black border border-slate-800">
              {(["Super Admin", "Clinic Admin", "PT Specialist", "Patient"] as const).map(role => (
                <button
                  key={role}
                  onClick={() => {
                    setSelectedSimRole(role);
                    addAuditLog("لوحة المحاكاة", "تعديل الصلاحية RBAC", `جلسة المستخدم الحالية تتقمص دور [${role}] بخصائص التخويل المحددة في بروتوكول المنصة.`, selectedSimClinicId);
                  }}
                  className={`flex-1 py-2 text-[10px] sm:text-[11px] rounded-lg transition font-bold cursor-pointer ${
                    selectedSimRole === role
                      ? "bg-brand-500 text-slate-950 font-black shadow-lg"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {role === "Super Admin" ? "مالك المنصة" : 
                   role === "Clinic Admin" ? "أدمن المشهد" : 
                   role === "PT Specialist" ? "المعالج الطبي" : "المستفيد"}
                </button>
              ))}
            </div>
            
            <div className="flex justify-between items-center text-[10px] text-slate-400">
              <span className="font-mono bg-slate-950 px-2 py-0.5 rounded text-emerald-400">Role: {selectedSimRole}</span>
              <span className="font-semibold text-slate-500">مستوى الوصول: {
                selectedSimRole === "Super Admin" ? "شامل كل الفروع والتذاكر وتفعيل الفواتير" :
                selectedSimRole === "Clinic Admin" ? "إشراف المصحة الحالية وتعاقد الأطباء" :
                selectedSimRole === "PT Specialist" ? "العلاج المبرهن وإعداد الجداول للحالات" :
                "بوابة المريض المخصصة للتأهيل المنزلي"
              }</span>
            </div>
          </div>

        </div>

      </div>

      {mainPortalTab === "workspace" ? (
        <div className="space-y-8 mt-8">

          {/* Core Simulation Row displaying isolated views for each selected role */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
            
            {/* Visualizer Bar representing the Current simulated environment context */}
            <div className="flex justify-between items-center bg-slate-50 p-4.5 rounded-2xl border border-slate-150 flex-wrap gap-2 text-right">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-bold block">أنت تشاهد وتتفاعل الآن كـ:</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-slate-900 bg-white border border-slate-200 px-3 py-1 rounded-xl shadow-xs inline-flex items-center gap-1">
                    <Key className="w-3.5 h-3.5 text-brand-650" />
                    {selectedSimRole} ({selectedSimRole === "Super Admin" ? "عمومي" : activeClinic.name})
                  </span>
                  <span className="text-xs text-slate-550">| معزول بـ: ClinicID = "{selectedSimClinicId}"</span>
                </div>
              </div>

              <div className="text-left font-mono text-[11px] text-slate-400 font-medium">
                <div>HIPAA CERTIFIED • DATA ENCRYPTED AES_256</div>
                <div className="text-emerald-600 text-right">● ONLINE DEV PREVIEW</div>
              </div>
            </div>

            {/* Simulated Workspace Views mapping corresponding selected Roles */}
            
            {/* ROLE 1: SUPER ADMIN PORTAL VIEW */}
            {selectedSimRole === "Super Admin" && (
              <div className="space-y-6">
                
                <div className="flex justify-between items-center border-b border-slate-100 pb-3 flex-wrap gap-2">
                  <div className="flex gap-1 bg-slate-50 p-1 rounded-xl">
                    <button 
                      onClick={() => setSuperAdminTab("billing")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${superAdminTab === "billing" ? "bg-slate-900 text-white" : "text-slate-400 hover:text-slate-800"}`}
                    >
                      <CreditCard className="w-3.5 h-3.5 inline ml-1" />
                      الاشتراكات والفوترة B2B
                    </button>
                    <button 
                      onClick={() => setSuperAdminTab("clinics")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${superAdminTab === "clinics" ? "bg-slate-900 text-white" : "text-slate-400 hover:text-slate-800"}`}
                    >
                      <Building2 className="w-3.5 h-3.5 inline ml-1" />
                      المصحات المتعاقدة ({clinics.length})
                    </button>
                    <button 
                      onClick={() => setSuperAdminTab("tickets")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${superAdminTab === "tickets" ? "bg-slate-900 text-white" : "text-slate-400 hover:text-slate-800"}`}
                    >
                      <LifeBuoy className="w-3.5 h-3.5 inline ml-1" />
                      تذاكر الدعم الفني العام ({supportTickets.length})
                    </button>
                    <button 
                      onClick={() => setSuperAdminTab("verifications")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${superAdminTab === "verifications" ? "bg-slate-900 text-white" : "text-slate-400 hover:text-slate-800"}`}
                    >
                      <ShieldAlert className="w-3.5 h-3.5 inline ml-1" />
                      اعتمادات الأطباء الجدد
                    </button>
                  </div>
                  <div>
                    <h3 className="font-display font-medium text-slate-900 text-base">منطقة المشرف العام للمنصة (Platform SaaS Owner)</h3>
                  </div>
                </div>

                {superAdminTab === "billing" && (
                  <div className="space-y-6">
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl">
                        <span className="block text-[10px] text-slate-400 font-bold mb-1">صلاحية تتبع المنصة (Platform Statistics)</span>
                        <h4 className="font-display font-black text-2xl text-slate-900 font-mono">142,300 ر.س</h4>
                        <p className="text-[10px] text-slate-500 font-semibold mt-1">صافي الإيرادات المتداولة لـ 3 عيادات (MRR)</p>
                      </div>

                      <div className="bg-white border-2 border-brand-500 shadow-sm p-5 rounded-2xl relative">
                        <span className="absolute -top-3 left-4 bg-brand-500 text-slate-950 font-black text-[9px] px-2 py-0.5 rounded">الأكثر اشتراكاً</span>
                        <span className="block text-[10px] text-slate-400 font-bold mb-1">خطة البلاتينيوم للمستشفيات (Enterprise)</span>
                        <h4 className="font-display font-black text-2xl text-brand-700 font-mono">12,500 <span className="text-xs font-sans">ر.س / شهر</span></h4>
                        <p className="text-[10px] text-slate-500 font-semibold mt-1">تتضمن: مرضى غير محدودين، وراسم الرؤية الذاتية لكاميرا الجوال، وحوسبة RAG</p>
                      </div>

                      <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl">
                        <span className="block text-[10px] text-slate-400 font-bold mb-1">الربط البنكي والاستضافة المحلية</span>
                        <div className="flex gap-1.5 items-center mt-2">
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-1 rounded">MADA GATEWAY</span>
                          <span className="bg-indigo-105 text-indigo-700 text-[10px] font-bold px-2 py-1 rounded">Stripe Multi-Tenant Split</span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-semibold mt-2">تتحول المبالغ 92% تلقائياً للعيادة، و 8% عمولة تشغيل المنصة.</p>
                      </div>
                    </div>

                    <div className="bg-slate-900 text-slate-100 rounded-2xl p-5 border border-slate-800 space-y-4">
                      <h4 className="font-display font-black text-xs sm:text-sm text-slate-150 flex items-center justify-start gap-1">
                        <CreditCard className="w-4 h-4 text-brand-400" />
                        <span>تقسيم عقود الفواتير والاستفسار السحابي للتسعير (B2B Billing Matrix)</span>
                      </h4>
                      <p className="text-xs text-slate-400 leading-snug">
                        تتوزع اشتراكات العيادات إلى 3 شرائح رئيسية لدخول المصحة. تفضل بمراجعة الهيكل الاستثماري أدناه:
                      </p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-right">
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                          <span className="block text-[10px] text-rose-400 font-bold">Starter Bronze (للمراكز الصغيرة)</span>
                          <strong className="block text-slate-50 font-black text-sm">2,500 ر.س / شهرياً</strong>
                          <p className="text-[10px] text-slate-500 leading-normal">تغطي حتى 3 أطباء، 50 مستفيد نشط. لا تشمل تخصيص شعار أو قوالب Einstein RAG المطلقة.</p>
                        </div>
                        
                        <div className="bg-slate-950 p-4 rounded-xl border border-brand-500/40 space-y-2">
                          <span className="block text-[10px] text-brand-400 font-bold">Pro Gold (العيادات المتوسطة)</span>
                          <strong className="block text-white font-black text-sm">6,050 ر.س / شهرياً</strong>
                          <p className="text-[10px] text-slate-500 leading-normal">تغطي حتى 10 أطباء، 250 مستفيد نشط. تخصيص زوايا التقاط مهارة الكاميرا، وذاكرة الديسك والفقرات.</p>
                        </div>

                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                          <span className="block text-[10px] text-purple-400 font-bold">Platform Enterprise (خصيصاً للمستشفيات)</span>
                          <strong className="block text-slate-50 font-black text-sm">12,500 ر.س / شهرياً</strong>
                          <p className="text-[10px] text-slate-500 leading-normal">تغطي مستفيدين غير محدودين، Whitelabel ساب دومين، تكامل فوري مع بوابة عيادات الرضية والـ EHR المحلي.</p>
                        </div>
                      </div>
                    </div>

                  </div>
                )}

                {superAdminTab === "clinics" && (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] bg-slate-200 px-2.5 py-1 rounded font-bold text-slate-700">بيئة SaaS للتشغيل الطبي</span>
                      <h4 className="font-bold text-slate-900 text-xs sm:text-sm">المؤسسات والمصحات الحاصلة على رخصة تشغيل فقراتي</h4>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-200/50 text-slate-600 font-bold">
                          <tr>
                            <th className="p-3">شفرة المصحة (TenantID)</th>
                            <th className="p-3">الاسم الطبّي للمستفيد</th>
                            <th className="p-3">بريد التواصل والفوترة</th>
                            <th className="p-3">الباقة النشطة</th>
                            <th className="p-3">الحالة التشغيلية</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {clinics.map(c => (
                            <tr key={c.id} className="hover:bg-slate-55/40">
                              <td className="p-3 font-mono font-bold text-slate-500">{c.id}</td>
                              <td className="p-3 font-bold text-slate-800">{c.name}</td>
                              <td className="p-3 font-mono text-slate-600 text-right">{c.contactEmail}</td>
                              <td className="p-3">
                                <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded">
                                  {c.tier}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded">
                                  {c.status.toUpperCase()}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {superAdminTab === "tickets" && (
                  <div className="space-y-4 bg-slate-50 border border-slate-200 rounded-2xl p-5">
                    <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                      <span className="text-xs text-slate-500">إجمالي غير محلول: {supportTickets.filter(t => t.status !== "Resolved").length} تذاكر IT</span>
                      <h4 className="font-bold text-slate-900 text-xs sm:text-sm">تذاكر الدعم الفني للمنصة المعولمة (IT Support Hub)</h4>
                    </div>

                    <div className="space-y-3">
                      {supportTickets.map(tkt => {
                        const reporterUser = users.find(u => u.id === tkt.reporterId);
                        const parentClinic = clinics.find(c => c.id === reporterUser?.clinicId);

                        return (
                          <div key={tkt.id} className="bg-white p-4.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div className="space-y-1">
                              <div className="flex gap-2 items-center flex-wrap">
                                <span className="bg-slate-100 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded text-slate-550">ID: {tkt.id}</span>
                                {tkt.priority === "High" ? (
                                  <span className="bg-rose-100 text-rose-800 font-bold text-[9px] px-1.5 py-0.5 rounded">أولوية عاجلة</span>
                                ) : (
                                  <span className="bg-amber-100 text-amber-800 font-bold text-[9px] px-1.5 py-0.5 rounded">متوسط</span>
                                )}
                                <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded">
                                  تابعة لمصحة {parentClinic?.name.split(" ")[1]}
                                </span>
                              </div>
                              <h5 className="font-bold text-slate-900 text-sm">{tkt.subject}</h5>
                              <p className="text-xs text-slate-500 leading-snug">{tkt.description}</p>
                              <span className="block text-[10px] text-slate-400">المرسل: {reporterUser?.fullName} • {tkt.createdAt}</span>
                            </div>

                            <div>
                              {tkt.status === "Resolved" ? (
                                <span className="bg-emerald-100 text-emerald-800 font-bold text-xs px-3 py-1.5 rounded-lg inline-block">تم الحل وإخطار المريض</span>
                              ) : (
                                <button
                                  onClick={() => handleResolveTicket(tkt.id)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-4.5 py-2 rounded-xl cursor-pointer transition-all"
                                >
                                  إغلاق وحل المشكلة ✓
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {superAdminTab === "verifications" && (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                    <h4 className="font-bold text-slate-900 text-xs sm:text-sm">طلب اعتماد للأطباء الجدد المضافين من عيادات الفروع</h4>
                    <p className="text-xs text-slate-450 leading-relaxed font-semibold">
                      تتطابق المنصة آلياً مع بوابة الهيئة الرقمية لترخيص المهنة ممارس علاج طبيعي، ويقوم المشرف العام للمنصة بالموافقة الوجدانية النهائية لتشغيل وضع Einstein AI:
                    </p>

                    <div className="divide-y divide-slate-200">
                      {users.filter(u => u.role === "PT Specialist" && !u.isVerified).map(pt => (
                        <div key={pt.id} className="py-4 flex justify-between items-center flex-wrap gap-4 bg-white px-4 rounded-xl border border-slate-150 mb-2 last:mb-0">
                          <div>
                            <strong className="block text-slate-900 text-sm">{pt.fullName}</strong>
                            <p className="text-xs text-slate-500">العيادة الطالبة: {clinics.find(c => c.id === pt.clinicId)?.name}</p>
                            <p className="text-[10px] text-slate-405 font-mono">البريد: {pt.email} • التخصص: {pt.specialty}</p>
                          </div>

                          <button
                            onClick={() => handleVerifyPTLicense(pt.id)}
                            className="bg-emerald-550 hover:bg-emerald-650 text-slate-950 font-black text-xs px-4 py-2 rounded-xl cursor-pointer transition flex items-center gap-1"
                          >
                            <CheckCircle className="w-3.5 h-3.5 text-slate-950" />
                            <span>قبول واعتماد من الهيئة ✓</span>
                          </button>
                        </div>
                      ))}

                      {users.filter(u => u.role === "PT Specialist" && !u.isVerified).length === 0 && (
                        <p className="text-center text-xs text-slate-400 py-6 font-semibold">كل الأطباء المسجلين عبر الفروع حاصلون على ترخيص كامل للهيئة ونشطون.</p>
                      )}
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* ROLE 2: CLINIC ADMIN PORTAL VIEW */}
            {selectedSimRole === "Clinic Admin" && (
              <div className="space-y-8">
                
                <div className="border-b border-slate-100 pb-3 flex justify-between items-center text-right">
                  <span className="text-[11px] font-mono text-slate-400">التشخيص لـ ClinicID = "{selectedSimClinicId}"</span>
                  <div className="space-y-0.5">
                    <h3 className="font-display font-medium text-slate-900 text-base">بوابة مشرف المصحة المحلي (Clinic Admin Dashboard)</h3>
                    <p className="text-xs text-slate-400">تتحكم وتراقب فقط الأخصائيين المحددين والمركبات المنتمية لـ: {activeClinic.name}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  
                  {/* ONBOARD NEW PT STAFF FOR THIS CLINIC */}
                  <div className="lg:col-span-4 bg-slate-50 p-6 rounded-2xl border border-slate-205 space-y-4">
                    <h4 className="font-display font-bold text-slate-800 text-xs sm:text-sm">تسجيل واستقطاب معالج طبي جديد للمركز:</h4>
                    
                    <form onSubmit={handleOnboardPT} className="space-y-3 text-right">
                      <div className="space-y-1">
                        <label className="block text-[10px] text-slate-500 font-bold">اسم المعالج بالدقة:</label>
                        <input
                          type="text"
                          placeholder="مثال: أخصائي مروان عواد"
                          value={newPtName}
                          onChange={(e) => setNewPtName(e.target.value)}
                          className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl"
                          required
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[10px] text-slate-500 font-bold">البريد الإلكتروني المخصص:</label>
                        <input
                          type="email"
                          placeholder="marwan@faqarati.com"
                          value={newPtEmail}
                          onChange={(e) => setNewPtEmail(e.target.value)}
                          className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl text-left"
                          required
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[10px] text-slate-500 font-bold">مجال التخصص الدقيق:</label>
                        <input
                          type="text"
                          placeholder="ألياف فقرات، تأهيل ركبة، مفاصل"
                          value={newPtSpecialty}
                          onChange={(e) => setNewPtSpecialty(e.target.value)}
                          className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2 bg-slate-900 hover:bg-slate-850 text-white font-bold text-xs rounded-xl cursor-pointer transition flex items-center justify-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5 text-brand-400" />
                        <span>طلب إدراج وترخيص معالج</span>
                      </button>
                    </form>
                  </div>

                  {/* ACTIVE CLIENT AND STAFF POOL LISTS FOR CURRENT TENANT */}
                  <div className="lg:col-span-8 space-y-6">
                    
                    <div className="bg-white border rounded-2xl p-5 space-y-4">
                      
                      <div className="flex justify-between items-center border-b pb-2">
                        <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">معزول كلياً للمصحة {selectedSimClinicId}</span>
                        <h4 className="font-display font-black text-slate-800 text-xs sm:text-sm">1. الكادر الطبي المعتمد لدينا ({clinicIsolator.pts.length} أطباء)</h4>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {clinicIsolator.pts.map(pt => (
                          <div key={pt.id} className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1 relative">
                            <span className={`absolute top-3 left-3 text-[9px] px-1.5 py-0.5 rounded font-bold ${
                              pt.isVerified ? "bg-emerald-100 text-emerald-850" : "bg-amber-100 text-amber-850"
                            }`}>
                              {pt.isVerified ? "مرخص ونشط ✓" : "بانتظار ترخيص الهيئة"}
                            </span>
                            <strong className="block text-slate-900 text-xs">{pt.fullName}</strong>
                            <span className="text-[10px] text-slate-450 font-mono text-slate-500 block">{pt.email}</span>
                            <span className="text-[10px] text-indigo-700 font-bold block">التأهيل: {pt.specialty}</span>
                          </div>
                        ))}
                      </div>

                    </div>

                    {/* ASSIGNMENT CONTROL WORKFLOW GRID */}
                    <div className="bg-white border rounded-2xl p-5 space-y-4">
                      
                      <div className="border-b pb-2 flex justify-between items-center flex-wrap gap-2">
                        <span className="text-[10px] text-slate-400">ربط وتوجيه المستفيدين الجدد</span>
                        <h4 className="font-display font-black text-slate-800 text-xs sm:text-sm">2. خلية تعيين المرضى للأطباء (Care-Loop Linker)</h4>
                      </div>

                      <form onSubmit={handleCreateAssignment} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                        <div className="space-y-1">
                          <label className="block text-[10px] text-slate-550 font-bold">١. اختر المستفيد (Patient Roster):</label>
                          <select
                            value={assignPatientId}
                            onChange={(e) => setAssignPatientId(e.target.value)}
                            className="w-full text-xs px-2.5 py-2 border rounded-lg bg-slate-50 text-right font-medium"
                            required
                          >
                            <option value="">-- اختر مريض العيادة --</option>
                            {clinicIsolator.patients.map(p => (
                              <option key={p.id} value={p.id}>{p.fullName} (تشخيص: {p.diagnosisNotes})</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="block text-[10px] text-slate-550 font-bold">٢. اختر الأخصائي المعالج المعتمد:</label>
                          <select
                            value={assignPtId}
                            onChange={(e) => setAssignPtId(e.target.value)}
                            className="w-full text-xs px-2.5 py-2 border rounded-lg bg-slate-50 text-right font-medium"
                            required
                          >
                            <option value="">-- اختر معالج مرخص --</option>
                            {clinicIsolator.pts.filter(pt => pt.isVerified).map(pt => (
                              <option key={pt.id} value={pt.id}>{pt.fullName} ({pt.specialty})</option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="submit"
                          className="bg-brand-550 hover:bg-brand-650 text-slate-950 font-black text-xs py-2 rounded-lg cursor-pointer transition duration-150"
                        >
                          تأكيد الربط والتعيين في الأرشيف ✓
                        </button>
                      </form>

                      {/* Display active Assignments */}
                      <div className="mt-4 space-y-2.5">
                        <h5 className="text-[10px] font-bold text-slate-400">التفويضات والصلات النشطة حالياً بالمصحة:</h5>
                        {clinicIsolator.assignments.map(asg => {
                          const patient = users.find(u => u.id === asg.patientId);
                          const pt = users.find(u => u.id === asg.ptId);
                          return (
                            <div key={asg.id} className="bg-slate-50 p-2 text-xs rounded-lg border flex justify-between items-center">
                              <span className="text-[9.5px] font-mono text-slate-400 font-bold">Arrived: {asg.assignedDate}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-850">{patient?.fullName}</span>
                                <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400" />
                                <span className="font-bold text-indigo-700">{pt?.fullName}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                    </div>

                  </div>

                </div>

              </div>
            )}

            {/* ROLE 3: PT SPECIALIST VIEW */}
            {selectedSimRole === "PT Specialist" && (
              <div className="space-y-6">
                
                <div className="border-b border-slate-100 pb-3 flex justify-between items-center flex-wrap gap-2">
                  <div className="text-[10px] bg-indigo-50 text-indigo-800 font-black px-2.5 py-1 rounded">
                    مسجل ومطابق كأخصائي معتمد لـ {activeClinic.name}
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-905 text-base">منطقة عمل الأخصائي الطبي الرشيد (PT Triage Hub)</h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  
                  {/* PT Specialist Sidebar - Assigned Patient care roster list */}
                  <div className="lg:col-span-4 bg-slate-50 p-5 rounded-2xl border space-y-4">
                    <h3 className="text-xs font-bold text-slate-800">1. المستفيدون تحت إشرافك المباشر في المصحة:</h3>
                    
                    <div className="space-y-2.5">
                      {clinicIsolator.patients.map(p => {
                        // Check if active assignment exists for current therapist
                        const isAssigned = assignments.some(a => a.patientId === p.id && a.ptId === currentSimulatedPTId);
                        
                        return (
                          <div 
                            key={p.id} 
                            className={`p-3 rounded-xl border text-right space-y-1 relative ${
                              isAssigned ? "bg-white border-indigo-400 shadow-xs" : "bg-slate-100 border-slate-205 py-2.5"
                            }`}
                          >
                            <span className="absolute top-2.5 left-2.5 text-[9px] font-mono bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded">
                              {isAssigned ? "مريض مفوض لك" : "مريض عيادة آخر"}
                            </span>
                            <strong className="block text-slate-900 text-xs sm:text-sm">{p.fullName}</strong>
                            <p className="text-[10.5px] text-slate-500 font-semibold">{p.diagnosisNotes}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* CLINICAL NOTE LOGS & CARE ROADMAP GENERATOR FORM */}
                  <div className="lg:col-span-8 space-y-6">
                    
                    {/* Clinical prescription journal creator */}
                    <div className="bg-white border rounded-2xl p-5 space-y-4">
                      <div className="flex justify-between items-center border-b pb-2">
                        <span className="text-[10.5px] font-bold text-emerald-600 flex items-center gap-1">
                          <Lock className="w-3.5 h-3.5 inline text-emerald-600" />
                          <span>تشفير سريري مزدوج</span>
                        </span>
                        <h4 className="font-display font-black text-slate-800 text-xs sm:text-sm">2. تدوين سجل طبي ووصفة تأهيلية جديدة للعميل النشط:</h4>
                      </div>

                      <form onSubmit={handleCreateClinicalLog} className="space-y-3.5 text-right">
                        <div>
                          <label className="block text-[10px] text-slate-500 font-semibold mb-1">المستفيد الحالي لتلقي السند المعرفي:</label>
                          <div className="bg-slate-100 p-2 rounded-lg text-xs font-bold text-slate-800">
                            {users.find(u => u.id === currentSimulatedPatientId)?.fullName || "فاطمة محمد الأحمد"} (المفوض إليك)
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="block text-[10px] text-slate-500 font-bold">التشخيص الطبي السريري المزمر:</label>
                            <textarea
                              rows={3}
                              placeholder="مثال: شد عضلي جانبي حاد ممتد للمفاصل.."
                              value={newClinicalNote}
                              onChange={(e) => setNewClinicalNote(e.target.value)}
                              className="w-full text-xs p-2.5 border rounded-lg bg-slate-50"
                              required
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[10px] text-slate-500 font-bold">وصفة التدريبات وعتبات الزوايا المخصصة لـ Einstein AI:</label>
                            <textarea
                              rows={3}
                              placeholder="تمرين تمدد الظهر بزاوية 145-175 مع الكاميرا ثبات 5 ثوانٍ، 3 مجموعات"
                              value={newClinicalTreatment}
                              onChange={(e) => setNewClinicalTreatment(e.target.value)}
                              className="w-full text-xs p-2.5 border rounded-lg bg-slate-50"
                              required
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          className="w-full py-2.5 bg-slate-900 hover:bg-slate-850 text-white font-bold text-xs rounded-xl cursor-pointer transition flex items-center justify-center gap-1"
                        >
                          <ShieldCheck className="w-4 h-4 text-brand-400" />
                          <span>تخزين السجل الطبي بأمان متطابق (HIPAA Standard)</span>
                        </button>
                      </form>
                    </div>

                    {/* Encrypted Clinical Message logs for patient Ahmad-Fatima */}
                    <div className="bg-white border rounded-2xl p-5 space-y-3">
                      <h4 className="font-display font-black text-slate-800 text-xs sm:text-sm flex items-center justify-start gap-1">
                        <MessageSquare className="w-4 h-4 text-brand-650" />
                        <span>3. المحادثات السريرية الطبية المشفرة مع فاطمة محمد الأحمد</span>
                      </h4>
                      <p className="text-[10px] text-slate-400">
                        تتطابق هذه المحادثات مع معايير E2E الطبية. لا يملك أي إداري أو مشرف فني للمنصة القدرة على فك تشفير هذا المحتوى.
                      </p>

                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3 max-h-52 overflow-y-auto">
                        {clinicIsolator.clinicalMessages.map(msg => {
                          const isMePt = msg.senderId === currentSimulatedPTId;
                          return (
                            <div key={msg.id} className={`flex flex-col max-w-[85%] ${isMePt ? "mr-auto text-left" : "ml-auto text-right"}`}>
                              <span className="text-[9px] text-slate-405 font-bold mb-0.5">
                                {isMePt ? "أنت (الأخصائي)" : "المريضة فاطمة الأحمد"} • {msg.sentAt}
                              </span>
                              <div className={`p-2.5 rounded-2xl text-xs ${
                                isMePt ? "bg-indigo-600 text-white rounded-tl-none text-right" : "bg-white border text-slate-800 rounded-tr-none text-right"
                              }`}>
                                {msg.content}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>

                </div>

              </div>
            )}

            {/* ROLE 4: PATIENT PORTAL ADVOCACY VIEW */}
            {selectedSimRole === "Patient" && (
              <div className="space-y-6">
                
                <div className="border-b border-slate-100 pb-3 flex justify-between items-center text-right">
                  <span className="text-xs text-slate-500 font-bold bg-brand-50 text-brand-850 px-2.5 py-1 rounded-lg">
                    ملفك العلاجي نشط لمصحة {activeClinic.name}
                  </span>
                  <div>
                    <h3 className="font-display font-medium text-slate-900 text-base">بوابة المستفيد للتأهيل المنزلي الذكي (The Next Action)</h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* NEXT ACTION WORKOUT FOR TODAY */}
                  <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white p-5 rounded-2xl border border-slate-800 space-y-4">
                    <span className="text-[10px] bg-brand-500 text-slate-950 px-2 py-0.5 rounded font-black">جاهز للبدء اليوم ⚡</span>
                    <h4 className="font-display font-black text-slate-50 text-sm">برنامجك الحركي المعين:</h4>
                    
                    <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-850 text-xs space-y-2">
                      <strong className="block text-slate-100">تمديد العمود الفقري للقطنية</strong>
                      <span className="text-[11px] text-brand-400 font-mono block">3 مجموعات × 12 تكرار (ثبات 5 ثوان)</span>
                      <p className="text-[10px] text-slate-400">توجيه دكتور أحمد: "حافظ على ثبات الأكتاف أثناء تمديد جذع الظهر للخلف كاملاً".</p>
                    </div>

                    <button className="w-full py-2 bg-brand-500 hover:bg-brand-600 text-slate-950 text-xs font-black rounded-lg cursor-pointer transition flex items-center justify-center gap-1">
                      <Eye className="w-4 h-4 text-slate-950" />
                      <span>تشغيل وضع مستشعر الكاميرا فورا</span>
                    </button>
                  </div>

                  {/* SUBMIT IT SERVICE SUPPORT TICKET */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200/80 space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[9.5px] bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-500">منفذ IT غير طبي</span>
                      <h4 className="font-display font-black text-slate-800 text-xs sm:text-sm">تقديم تذكرة دعم فني للمنصة:</h4>
                    </div>

                    <form onSubmit={handleCreateTicket} className="space-y-2.5 text-right">
                      <div className="space-y-1">
                        <label className="block text-[9.5px] text-slate-500 font-semibold">عنوان العطل (IT Issue):</label>
                        <input
                          type="text"
                          placeholder="مثال: الشاشة فجأة تصبح مظلمة عند تشغيل الكاميرا"
                          value={newTicketSubject}
                          onChange={(e) => setNewTicketSubject(e.target.value)}
                          className="w-full text-xs px-2.5 py-1.5 border rounded-lg bg-slate-50"
                          required
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[9.5px] text-slate-500 font-semibold">وصف وتفاصيل العطل الفني:</label>
                        <textarea
                          rows={2}
                          placeholder="باقة الشاشات تغلق تلقائياً بعد مرور 3 دقائق من جلسة الركبة."
                          value={newTicketDesc}
                          onChange={(e) => setNewTicketDesc(e.target.value)}
                          className="w-full text-xs p-2 border rounded-lg bg-slate-50"
                          required
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-1.5 bg-slate-900 hover:bg-slate-850 text-white font-bold text-xs rounded-lg cursor-pointer transition"
                      >
                        تقديم تذكرة IT للمشرفين
                      </button>
                    </form>
                  </div>

                  {/* CLINICAL MESSAGE PRIVACY SUMMARY */}
                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-150 space-y-3">
                    <h4 className="font-display font-black text-slate-800 text-xs sm:text-sm flex items-center justify-start gap-1">
                      <Clock className="w-4 h-4 text-brand-650" />
                      <span>سجل مواعيدك السريرية بالفيديو:</span>
                    </h4>
                    
                    <div className="bg-white p-3 rounded-xl border space-y-1.5 text-xs text-right">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 rounded">مؤكد</span>
                        <strong>الجلسة الطبية بالفيديو</strong>
                      </div>
                      <p className="text-[10.5px] text-slate-500 font-mono">الخميس، 25 يونيو 10:30 صباحاً</p>
                      <p className="text-[10.5px] text-indigo-700">مع الأخصائي المفوض: د. أحمد الرويلي</p>
                    </div>

                    <div className="p-3 bg-indigo-50 text-indigo-850 rounded-xl text-[10px] leading-relaxed">
                      💡 <strong>ملحوظة لحفظ الخصوصية:</strong>
                      جلسات الفيديو لدينا مشفرة وفق معايير WebRTC السريرية، ويتم التدقيق بتموضع المفاصل محلياً داخل جهازك دون المساس بحجاب مظهرك في الخوادم.
                    </div>
                  </div>

                </div>

              </div>
            )}

          </div>

          {/* Real-time compliance and security Audit logging records (Horizontal timeline block) */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 text-right">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3 flex-wrap gap-2">
                <span className="bg-brand-500/10 text-brand-400 border border-brand-500/20 font-mono text-[9px] px-2 py-0.5 rounded">
                  MUTABLE DIMA ACCOUNTING LEDGER
                </span>
                <h4 className="font-display font-black text-slate-100 text-xs sm:text-sm flex items-center justify-start gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
                  <span>سجل المعاملات والعمليات الرقابية الطبية (Immutable Compliance Audit Logs)</span>
                </h4>
              </div>

              <p className="text-[10px] text-slate-450 mt-1.5 mb-3 leading-relaxed">
                تقوم النواة السحابية بتسجيل كافة إجراءات تعديل الملفات الطبية ريادياً وتعيين المجموعات بختم زمني وتوقيع تشفيري لأغراض المراجعة القضائية والأمان:
              </p>

              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {auditLogs.map(log => (
                  <div key={log.id} className="bg-slate-950 p-2.5 rounded-lg border border-slate-900 text-xs flex justify-between items-center flex-wrap gap-2 text-right">
                    
                    <span className="text-[9px] font-mono text-emerald-500 font-bold px-1.5 bg-slate-900 rounded">
                      {log.complianceHash}
                    </span>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10.5px] font-mono text-slate-400 font-semibold">{log.timestamp}</span>
                      <span className="text-[10px] bg-slate-900 text-brand-400 px-2 py-0.5 rounded font-black border border-slate-850">
                        {log.roles} ({log.actor})
                      </span>
                      <span className="text-slate-300 font-bold text-[11px] leading-relaxed">
                        {log.action}
                      </span>
                    </div>

                  </div>
                ))}
              </div>
          </div>

        </div>
      ) : mainPortalTab === "schema" ? (
        <div className="space-y-6 mt-8">
          
          <div className="bg-white border rounded-3xl p-6 sm:p-8 space-y-6">
            
            <div className="border-b border-slate-150 pb-3 flex justify-between items-center flex-wrap gap-2 text-right">
              <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded border border-indigo-100">
                Primary Keys (PK) & Foreign Keys (FK) Relationships
              </span>
              <div className="space-y-0.5">
                <h3 className="font-display font-black text-slate-900 text-base">بنية وهيكل قاعدة البيانات العلائقية السحابية للـ SaaS</h3>
                <p className="text-xs text-slate-400">تصفح ترابط الجداول لضمان عزل البيانات المعتمد بالمنصة وهندسة الفروع المتعددة.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* LEFT SIDE: Clickable Schema Tables Cards list */}
              <div className="lg:col-span-5 space-y-3">
                <h4 className="text-xs font-bold text-slate-550 mb-1">انقر على أي جدول لمعاينة الرابطة والـ Columns والهيكل:</h4>
                
                {[
                  { name: "Clinics", icon: Building2, desc: "جدول الفروع وعقد SaaS واختيار الباقة", fields: ["ClinicID (UUID - PK)", "Name", "ContactEmail", "Tier", "CreatedAt"] },
                  { name: "Users", icon: Users, desc: "بيانات المنخرطين والأطباء مع قيد الـ Role", fields: ["UserID (UUID - PK)", "ClinicID (UUID - FK to Clinics)", "Role", "FullName", "Email", "PasswordHash"] },
                  { name: "Patient_PT_Assignment", icon: UserCheck, desc: "الصلة الطبية المخصصة للمرضى بالمعالجين", fields: ["AssignmentID (UUID - PK)", "PatientID (UUID - FK to Users)", "PT_ID (UUID - FK to Users)", "AssignedDate"] },
                  { name: "Appointments", icon: Calendar, desc: "حجز مواعيد التحقق بالفيديو والمتابعة المباشرة", fields: ["ApptID (UUID - PK)", "PatientID (UUID - FK to Users)", "PT_ID (UUID - FK to Users)", "StartTime", "EndTime"] },
                  { name: "Medical_Records", icon: FileText, desc: "أرشيف التشخيص والمخطط الحركي المشفر", fields: ["RecordID (UUID - PK)", "PatientID (UUID - FK to Users)", "PT_ID (UUID - FK to Users)", "DiagnosisNotes", "TreatmentPlan"] },
                  { name: "Messages", icon: MessageSquare, desc: "شات سريري مشفر ذو سرية مهنية قاطعة", fields: ["MessageID (UUID - PK)", "SenderID (UUID - FK to Users)", "ReceiverID (UUID - FK to Users)", "Content", "SentAt"] },
                  { name: "Support_Tickets", icon: LifeBuoy, desc: "تذاكر الدعم الفني العام المنفصلة عن الشات السريري", fields: ["TicketID (UUID - PK)", "ReporterID (UUID - FK to Users)", "Subject", "Description", "Status"] }
                ].map(table => (
                  <button 
                    key={table.name}
                    onClick={() => setSelectedTable(table.name)}
                    className={`w-full p-4 rounded-2xl text-right border transition flex items-center justify-between gap-4 cursor-pointer ${
                      selectedTable === table.name
                        ? "border-indigo-600 bg-indigo-50/20 shadow-xs" 
                        : "border-slate-150 hover:bg-slate-50"
                    }`}
                  >
                    <ArrowRightLeft className={`w-4 h-4 text-indigo-400 ${selectedTable === table.name ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`} />
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <strong className="block text-slate-900 text-xs sm:text-sm font-mono">{table.name}</strong>
                        <span className="text-[10px] text-slate-450 block font-semibold">{table.desc}</span>
                      </div>
                      <div className="p-2 bg-slate-100 rounded-xl">
                        <table.icon className="w-5 h-5 text-slate-500" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* RIGHT SIDE: Schema details visualizer panel */}
              <div className="lg:col-span-7 bg-slate-900 text-white rounded-3xl p-6 sm:p-8 space-y-6 border border-slate-800">
                
                <div className="flex justify-between items-center border-b border-slate-800 pb-3 flex-wrap gap-2 text-right">
                  <span className="font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-bold px-2.5 py-0.5 rounded-lg">
                    Selected Table Detail
                  </span>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display font-black text-slate-100 text-lg">معاينة الجدول: {selectedTable}</h3>
                  </div>
                </div>

                <div className="space-y-4">
                  
                  {/* Visual ERD Connections Mapper illustration depending on simulated tables */}
                  <div className="bg-slate-950 p-4.5 rounded-2xl border border-slate-850 space-y-3 font-mono text-xs text-right">
                    <span className="text-[10px] text-slate-500 font-bold block mb-1 font-sans">علاقة الجدول بقاعدة البيانات (Foreign Key Mapping):</span>
                    
                    {selectedTable === "Clinics" && (
                      <div className="text-slate-350 leading-relaxed font-semibold font-sans">
                        🟢 <strong>Clinics</strong> هو الجدول الأعلى مستوى في مشهد SaaS المتعدد المستأجرين.
                        <div className="mt-2 text-[11px] text-slate-450 leading-normal pl-4 border-r border-slate-800 pr-3">
                          • لا يحتوي على أي Foreign Keys.<br />
                          • يرتبط به جدول <strong>Users</strong> عبر علاقة (One-to-Many) حيث يملك كاشف <code>ClinicID</code> لتدقيق الانتماء الفئوي.
                        </div>
                      </div>
                    )}

                    {selectedTable === "Users" && (
                      <div className="text-slate-350 leading-relaxed font-semibold font-sans">
                        🔵 جدول <strong>Users</strong> هو جدول مركزي يقع تحت المالك المؤسسي.
                        <div className="mt-2 text-[11px] text-slate-450 leading-normal pl-4 border-r border-brand-800 pr-3">
                          • <code>ClinicID (UUID - FK to Clinics)</code> ➔ يحدّد بحسم الهوية للمؤسسة، ويتم العزل تبعا له.<br />
                          • يرتبط به جدول <strong>Patient_PT_Assignment</strong> عبر عمودي <code>PatientID</code> و <code>PT_ID</code>.
                        </div>
                      </div>
                    )}

                    {selectedTable === "Patient_PT_Assignment" && (
                      <div className="text-slate-350 leading-relaxed font-semibold font-sans">
                        🟡 جدول <strong>Patient_PT_Assignment</strong> يضمن بقاء المرضى والأخصائيين بقنوات تواصل آمنة.
                        <div className="mt-2 text-[11px] text-slate-450 leading-normal pl-4 border-r border-brand-800 pr-3 font-sans">
                          • <code>PatientID (UUID - FK to Users)</code> ➔ يشير للمريض.<br />
                          • <code>PT_ID (UUID - FK to Users)</code> ➔ يشير للأخصائي.<br />
                          • هذا الجدول يمنع تداخل الكوادر الطبية بالمرضى من عيادات أخرى نهائياً.
                        </div>
                      </div>
                    )}

                    {selectedTable === "Appointments" && (
                      <div className="text-slate-350 leading-relaxed font-semibold font-sans">
                        🗓️ جدول <strong>Appointments</strong> يجدول جلسات كاميرا التوجيه بالفيديو منزلياً.
                        <div className="mt-2 text-[11px] text-slate-450 leading-normal pl-4 border-r border-brand-800 pr-3">
                          • <code>PatientID</code> ➔ يشير للعميل المستهدف.<br />
                          • <code>PT_ID</code> ➔ يشير للمعالج المشرف.<br />
                          • يتم تخزينه وعزله لضمان عدم حدوث تضارب في المواعيد بالفروع.
                        </div>
                      </div>
                    )}

                    {selectedTable === "Medical_Records" && (
                      <div className="text-slate-350 leading-relaxed font-semibold font-sans">
                        🔒 جدول <strong>Medical_Records</strong> للأخصائيين لتدوين عتبات الزوايا الحركية المبرهنة بالتأهيل.
                        <div className="mt-2 text-[11px] text-slate-450 leading-normal pl-4 border-r border-indigo-805 pr-3">
                          • <code>PatientID</code> و <code>PT_ID</code> ➔ علاقات للمستخدمين بالمصحة.<br />
                          • تخزين التشخصيات بترميزات متفق عليها لحماية السجلات من الثغرات الطبية.
                        </div>
                      </div>
                    )}

                    {selectedTable === "Messages" && (
                      <div className="text-slate-350 leading-relaxed font-semibold font-sans">
                        💬 جدول <strong>Messages</strong> يجمع المراسلات العلاجية والصور.
                        <div className="mt-2 text-[11px] text-slate-450 leading-normal pl-4 border-r border-slate-800 pr-3">
                          • <code>SenderID</code> و <code>ReceiverID</code> ➔ يربطان المستخدمين ببعض E2E.<br />
                          • معزول ومقتصر بالتمام للأطراف الطبية المعنية، وخالٍ من تدخل المشرف العام.
                        </div>
                      </div>
                    )}

                    {selectedTable === "Support_Tickets" && (
                      <div className="text-slate-350 leading-relaxed font-semibold font-sans">
                        🎟️ جدول <strong>Support_Tickets</strong> يُمثّل بوابة تواصل غير الطبية للأعطال الفنية للتنقل بالبرنامج.
                        <div className="mt-2 text-[11px] text-slate-455 leading-normal pl-4 border-r border-slate-800 pr-3">
                          • <code>ReporterID</code> ➔ يشير لصاحب الشكوى (مريض أو أخصائي أو مشرف فرعي).<br />
                          • تتدفق وتُوجّه للمشرف العام بالمنصة (Super Admin) لمعالجة مشكلات الكاميرا أو الدفع ماليًا.
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Schema Columns Table specifications */}
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
                    <span className="text-[10px] text-slate-450 block mb-2 font-sans font-bold">هياكل الحقول الداتا-تايبس (Table Spec Schema Columns):</span>
                    
                    <div className="overflow-x-auto text-xs font-mono">
                      <table className="w-full text-right divide-y divide-slate-800">
                        <thead>
                          <tr className="text-slate-500 font-bold">
                            <th className="pb-2">اسم العمود (Column)</th>
                            <th className="pb-2">نوع البيانات (Data Type)</th>
                            <th className="pb-2">البروتوكول / القيود</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-900 text-slate-200">
                          {selectedTable === "Clinics" && (
                            <>
                              <tr><td className="py-2">ClinicID</td><td>UUID</td><td className="text-brand-400 font-bold">PRIMARY KEY</td></tr>
                              <tr><td className="py-2">Name</td><td>VARCHAR(255)</td><td>NOT NULL</td></tr>
                              <tr><td className="py-2">ContactEmail</td><td>VARCHAR(150)</td><td>UNIQUE</td></tr>
                              <tr><td className="py-2">Tier</td><td>ENUM</td><td>'Starter', 'Pro', 'Enterprise'</td></tr>
                              <tr><td className="py-2">CreatedAt</td><td>TIMESTAMP</td><td>DEFAULT NOW()</td></tr>
                            </>
                          )}

                          {selectedTable === "Users" && (
                            <>
                              <tr><td className="py-2">UserID</td><td>UUID</td><td className="text-brand-400 font-bold">PRIMARY KEY</td></tr>
                              <tr><td className="py-2">ClinicID</td><td>UUID</td><td className="text-indigo-400">FOREIGN KEY ➔ Clinics</td></tr>
                              <tr><td className="py-2">Role</td><td>ENUM</td><td>'Clinic Admin', 'PT', 'Patient'</td></tr>
                              <tr><td className="py-2">FullName</td><td>VARCHAR(100)</td><td>NOT NULL</td></tr>
                              <tr><td className="py-2">Email</td><td>VARCHAR(100)</td><td>UNIQUE</td></tr>
                              <tr><td className="py-2">PasswordHash</td><td>VARCHAR(255)</td><td>NOT NULL</td></tr>
                            </>
                          )}

                          {selectedTable === "Patient_PT_Assignment" && (
                            <>
                              <tr><td className="py-2">AssignmentID</td><td>UUID</td><td className="text-brand-400 font-bold">PRIMARY KEY</td></tr>
                              <tr><td className="py-2">PatientID</td><td>UUID</td><td className="text-indigo-400">FOREIGN KEY ➔ Users (Patient)</td></tr>
                              <tr><td className="py-2">PT_ID</td><td>UUID</td><td className="text-indigo-400">FOREIGN KEY ➔ Users (PT)</td></tr>
                              <tr><td className="py-2">AssignedDate</td><td>TIMESTAMP</td><td>NOT NULL</td></tr>
                              <tr><td className="py-2">Status</td><td>VARCHAR(50)</td><td>'Active', 'Discharged'</td></tr>
                            </>
                          )}

                          {selectedTable === "Appointments" && (
                            <>
                              <tr><td className="py-2">ApptID</td><td>UUID</td><td className="text-brand-400 font-bold">PRIMARY KEY</td></tr>
                              <tr><td className="py-2">PatientID</td><td>UUID</td><td className="text-indigo-400">FOREIGN KEY ➔ Users (Patient)</td></tr>
                              <tr><td className="py-2">PT_ID</td><td>UUID</td><td className="text-indigo-400">FOREIGN KEY ➔ Users (PT)</td></tr>
                              <tr><td className="py-2">StartTime</td><td>TIMESTAMP</td><td>NOT NULL</td></tr>
                              <tr><td className="py-2">EndTime</td><td>TIMESTAMP</td><td>NOT NULL</td></tr>
                              <tr><td className="py-2">Status</td><td>ENUM</td><td>'Scheduled', 'Completed', 'Canceled'</td></tr>
                            </>
                          )}

                          {selectedTable === "Medical_Records" && (
                            <>
                              <tr><td className="py-2">RecordID</td><td>UUID</td><td className="text-brand-400 font-bold">PRIMARY KEY</td></tr>
                              <tr><td className="py-2">PatientID</td><td>UUID</td><td className="text-indigo-400">FOREIGN KEY ➔ Users (Patient)</td></tr>
                              <tr><td className="py-2">PT_ID</td><td>UUID</td><td className="text-indigo-400">FOREIGN KEY ➔ Users (PT)</td></tr>
                              <tr><td className="py-2">DiagnosisNotes</td><td>TEXT</td><td>ENCRYPTED</td></tr>
                              <tr><td className="py-2">TreatmentPlan</td><td>TEXT</td><td>ENCRYPTED</td></tr>
                              <tr><td className="py-2">CreatedAt</td><td>TIMESTAMP</td><td>DEFAULT NOW()</td></tr>
                            </>
                          )}

                          {selectedTable === "Messages" && (
                            <>
                              <tr><td className="py-2">MessageID</td><td>UUID</td><td className="text-brand-400 font-bold">PRIMARY KEY</td></tr>
                              <tr><td className="py-2">SenderID</td><td>UUID</td><td className="text-indigo-400">FOREIGN KEY ➔ Users</td></tr>
                              <tr><td className="py-2">ReceiverID</td><td>UUID</td><td className="text-indigo-400">FOREIGN KEY ➔ Users</td></tr>
                              <tr><td className="py-2">Content</td><td>TEXT</td><td>ENCRYPTED E2E</td></tr>
                              <tr><td className="py-2">SentAt</td><td>TIMESTAMP</td><td>NOT NULL</td></tr>
                            </>
                          )}

                          {selectedTable === "Support_Tickets" && (
                            <>
                              <tr><td className="py-2">TicketID</td><td>UUID</td><td className="text-brand-400 font-bold">PRIMARY KEY</td></tr>
                              <tr><td className="py-2">ReporterID</td><td>UUID</td><td className="text-indigo-400">FOREIGN KEY ➔ Users</td></tr>
                              <tr><td className="py-2">Subject</td><td>VARCHAR(255)</td><td>NOT NULL</td></tr>
                              <tr><td className="py-2">Description</td><td>TEXT</td><td>NOT NULL</td></tr>
                              <tr><td className="py-2">Status</td><td>VARCHAR(50)</td><td>'Open', 'In Progress', 'Resolved'</td></tr>
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>
      ) : null}

    </div>
  );
}

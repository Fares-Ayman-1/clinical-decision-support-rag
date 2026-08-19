import { useState } from "react";
import { mockTherapists } from "../mockData";
import { Star, ShieldAlert, BadgeCheck, Search, Filter, Calendar, Clock, DollarSign, ArrowLeft } from "lucide-react";
import { useLanguage } from "../LanguageContext";
import { Therapist } from "../types";

interface IndexDoctorProps {
  onBookSession: (therapist: Therapist, date: string, time: string) => void;
  openAuth: (role: "patient") => void;
  selectedDoctorId?: string | null;
}

export default function DoctorListing({ onBookSession, openAuth, selectedDoctorId }: IndexDoctorProps) {
  const { lang, t, isRtl } = useLanguage();
  const [selectedExFilter, setSelectedExFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [bookingTherapist, setBookingTherapist] = useState<Therapist | null>(
    selectedDoctorId ? mockTherapists.find(pt => pt.id === selectedDoctorId) || null : null
  );
  
  // Interactive calendar selection states
  const [selectedDate, setSelectedDate] = useState<string>("2026-06-25");
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [bookingSuccess, setBookingSuccess] = useState<boolean>(false);

  // Specialties categories to filter on
  const categories = [
    { id: "all", name: t("كل التخصصات", "All Specialties") },
    { id: "spine", name: t("آلام العمود الفقري", "Spinal Alignment") },
    { id: "joints", name: t("آلام الركبة والمفاصل", "Knee & Joint Pain") },
    { id: "sports", name: t("الإصابات الرياضية", "Sports Injuries") },
    { id: "surgery", name: t("تأهيل ما بعد الجراحة", "Post-Surgery Rehab") }
  ];

  // Helper translations
  const translateSpecialtyLocal = (spec: string) => {
    if (spec === "آلام العمود الفقري") return t("آلام العمود الفقري", "Spinal Column Pain");
    if (spec === "تأهيل ما بعد الجراحة") return t("تأهيل ما بعد الجراحة", "Post-Surgery Rehab");
    if (spec === "الإصابات الرياضية") return t("الإصابات الرياضية", "Sports Injuries");
    if (spec === "علاج طبيعي للأطفال") return t("علاج طبيعي للأطفال", "Pediatric Physical Therapy");
    if (spec === "تأهيل كبار السن") return t("تأهيل كبار السن", "Geriatric Rehab");
    if (spec === "آلام المفاصل والركبة") return t("آلام المفاصل والركبة", "Joint & Knee Pain");
    if (spec === "إصابات الكتف والرقبة") return t("إصابات الكتف والرقبة", "Shoulder & Neck Injuries");
    if (spec === "تأهيل حركي متكامل") return t("تأهيل حركي متكامل", "Integrated Motor Rehab");
    if (spec === "علاج يدوي تقويمي") return t("علاج يدوي تقويمي", "Manual Orthopedic Therapy");
    return spec;
  };

  const translatePtNameLocal = (name: string) => {
    if (name === "د. أحمد الرويلي") return t("د. أحمد الرويلي", "Dr. Ahmad Al-Ruwaili");
    if (name === "أ. سارة الشهراني") return t("أ. سارة الشهراني", "Sara Al-Shahrani, PT");
    if (name === "د. طارق الحازمي") return t("د. طارق الحازمي", "Dr. Tarek Al-Hazmi");
    return name;
  };

  const translateBioLocal = (ptId: string, arBio: string) => {
    if (ptId === "t1") return t(arBio, "Specializing in diagnosis and kinetic rehab of spine and disc conditions with over 12 years of experience in major clinical facilities.");
    if (ptId === "t2") return t(arBio, "Certified healthcare specialist focused on creating custom integrated motion programs for knees, joints, and geriatric longevity.");
    if (ptId === "t3") return t("حاصل على الماجستير في العلاج الطبيعي الرياضي، خبير في علاج تشنجات الرقبة المزمنة وإصابات أوتار الكتف بأحدث الأساليب العلاجية الرقمية.", "Holds a Master's degree in Sports Physical Therapy; expert in treating chronic neck spasms and shoulder tendon injuries using the latest digital therapeutic methods.");
    return arBio;
  };

  // Filter therapists
  const filteredTherapists = mockTherapists.filter((pt) => {
    const matchesSearch = pt.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          pt.specialty.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()));
    
    if (selectedExFilter === "all") return matchesSearch;
    if (selectedExFilter === "spine") return matchesSearch && pt.specialty.some(s => s.includes("العمود الفقري"));
    if (selectedExFilter === "joints") return matchesSearch && pt.specialty.some(s => s.includes("الركبة") || s.includes("المفاصل"));
    if (selectedExFilter === "sports") return matchesSearch && pt.specialty.some(s => s.includes("الرياضية"));
    if (selectedExFilter === "surgery") return matchesSearch && pt.specialty.some(s => s.includes("الجراحة"));
    
    return matchesSearch;
  });

  const handleBookingConfirm = () => {
    if (!selectedSlot) {
      alert(t("الرجاء اختيار الوقت المفضل للموعد الحركي أولاً!", "Please select your preferred timeslot first!"));
      return;
    }
    if (bookingTherapist) {
      onBookSession(bookingTherapist, selectedDate, selectedSlot);
      setBookingSuccess(true);
      setTimeout(() => {
        setBookingSuccess(false);
        setBookingTherapist(null);
        setSelectedSlot("");
      }, 3500);
    }
  };

  const datesChoice = [
    { day: t("الخميس", "Thu"), date: "2026-06-25", label: t("٢٥ يونيو", "June 25") },
    { day: t("الجمعة", "Fri"), date: "2026-06-26", label: t("٢٦ يونيو", "June 26") },
    { day: t("السبت", "Sat"), date: "2026-06-27", label: t("٢٧ يونيو", "June 27") },
    { day: t("الأحد", "Sun"), date: "2026-06-28", label: t("٢٨ يونيو", "June 28") },
    { day: t("الإثنين", "Mon"), date: "2026-06-29", label: t("٢٩ يونيو", "June 29") }
  ];

  return (
    <section id="clinics" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Title */}
        <div className="text-center max-w-2xl mx-auto mb-14 space-y-4">
          <span className="font-mono text-xs font-bold text-brand-600 bg-brand-50 px-3.5 py-1 rounded-full uppercase">
            {t("نخبة الكفاءات الطبية", "Elite Healthcare PT Specialists")}
          </span>
          <h2 className="text-3xl sm:text-4xl font-display font-black text-slate-900">
            {t("أخصائيو العلاج الطبيعي المرخصون 🩺", "Board-Certified Physiotherapists 🩺")}
          </h2>
          <p className="text-slate-650 font-medium">
            {t(
              "تواصل واحجز مخرجات التأهيل الخاص بك مع نخبة من الاستشاريين الرياضيين والسريريين الحاصلين على تراخيص الهيئة الطبية.",
              "Consult and plan your kinetic care with highly qualified clinicians certified by the Medical Commission for supreme safety."
            )}
          </p>
        </div>

        {/* Filters and search block */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch justify-between mb-8">
          
          {/* Categories Tab */}
          <div className="flex gap-2 items-center flex-wrap order-last md:order-first">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedExFilter(cat.id)}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold border transition duration-200 cursor-pointer ${
                  selectedExFilter === cat.id
                    ? "bg-brand-600 text-white border-transparent shadow-xs"
                    : "bg-slate-50 text-slate-650 border-slate-100 hover:bg-slate-100"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Search bar input */}
          <div className="relative max-w-md w-full">
            <span className={`absolute inset-y-0 flex items-center text-slate-400 ${isRtl ? "right-3.5" : "left-3.5"}`}>
              <Search className="w-4.5 h-4.5" />
            </span>
            <input
              type="text"
              placeholder={t("البحث بالاسم أو التخصص الطبي...", "Search by therapist name or clinical specialty...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full py-2.5 rounded-xl border border-slate-200/80 focus:border-brand-500/80 focus:ring-1 focus:ring-brand-500/50 bg-slate-50 font-medium text-sm ${isRtl ? "pl-4 pr-11 text-right" : "pr-4 pl-11 text-left"}`}
            />
          </div>

        </div>

        {/* Booking popup overlay */}
        {bookingTherapist && (
          <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-center justify-center p-4">
            <div className={`bg-white rounded-3xl p-6 sm:p-8 max-w-2xl w-full border border-slate-100 relative ${isRtl ? "text-right" : "text-left"} space-y-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto`}>
              
              <div className="flex justify-between items-start border-b border-slate-100 pb-4">
                <button
                  onClick={() => setBookingTherapist(null)}
                  className="p-1 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
                >
                  {t("إغلاق النافذة", "Close Window")}
                </button>
                <h3 className="font-display font-black text-slate-900 text-xl sm:text-2xl">
                  {t("تنسيق موعد جلسة التأهيل عن بعد", "Schedule Tele-Physiotherapy Consultation")}
                </h3>
              </div>

              {bookingSuccess ? (
                <div className="py-12 text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl font-bold">✓</div>
                  <h4 className="text-xl font-bold text-slate-800">{t("تم حجز موعدك بنجاح! 🎉", "Appointment Booked Successfully! 🎉")}</h4>
                  <p className="text-slate-500 text-sm max-w-md mx-auto">
                    {t("تم تسجيل الموعد مع", "Your appointment with")} <strong>{translatePtNameLocal(bookingTherapist.name)}</strong> {t("بتاريخ", "on")} {selectedDate} {t("في الساعة", "at")} {selectedSlot}. {t("يمكنك مراجعة جلستك داخل لوحة تحكم المريض الخاصة بك الآن.", "Review your session log in your patient portal account.")}
                  </p>
                </div>
              ) : (
                <>
                  {/* Doctor Mini card */}
                  <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <img
                      src={bookingTherapist.avatarUrl}
                      alt={bookingTherapist.name}
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-full object-cover border-2 border-brand-200"
                    />
                    <div className="flex-1 space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-brand-700 font-bold font-mono text-sm">{bookingTherapist.pricePerSession} {t("ر.س / جلسة", "SAR / session")}</span>
                        <h4 className="font-bold text-slate-800 text-base">{translatePtNameLocal(bookingTherapist.name)}</h4>
                      </div>
                      <p className="text-xs text-slate-500">{bookingTherapist.specialty.map(s => translateSpecialtyLocal(s)).join(" • ")}</p>
                    </div>
                  </div>

                  {/* Calendar Dates Choice */}
                  <div className="space-y-3">
                    <h5 className={`font-bold text-slate-800 text-sm flex items-center gap-1.5 ${isRtl ? "justify-end" : "justify-start"}`}>
                      <span>{t("١. اختر تاريخ الجلسة الطبية المناسب:", "1. Select preferred consultation date:")}</span>
                      <Calendar className="w-4.5 h-4.5 text-brand-550" />
                    </h5>
                    <div className="grid grid-cols-5 gap-2.5">
                      {datesChoice.map((d) => (
                        <button
                          key={d.date}
                          onClick={() => setSelectedDate(d.date)}
                          className={`p-2.5 rounded-xl text-center border font-semibold flex flex-col justify-center items-center transition cursor-pointer ${
                            selectedDate === d.date
                              ? "bg-brand-600 text-white border-transparent scale-102"
                              : "bg-slate-50 text-slate-650 border-slate-150 hover:bg-slate-100"
                          }`}
                        >
                          <span className="text-[10px] opacity-75">{d.day}</span>
                          <span className="text-xs sm:text-sm font-bold">{d.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Hours input slots choice */}
                  <div className="space-y-3">
                    <h5 className={`font-bold text-slate-800 text-sm flex items-center gap-1.5 ${isRtl ? "justify-end" : "justify-start"}`}>
                      <span>{t("٢. اختر الساعة المناسبة للتحقق بالفيديو:", "2. Select preferred timeslot:")}</span>
                      <Clock className="w-4.5 h-4.5 text-brand-550" />
                    </h5>
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
                      {bookingTherapist.availabilitySlots.map((slot) => (
                        <button
                          key={slot}
                          onClick={() => setSelectedSlot(slot)}
                          className={`py-2 px-1.5 rounded-xl border text-center font-mono font-medium text-xs sm:text-sm cursor-pointer transition ${
                            selectedSlot === slot
                              ? "bg-slate-900 text-white border-transparent"
                              : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Action Confirm buttons */}
                  <div className="pt-4 border-t border-slate-100 flex gap-3 justify-end">
                    <button
                      onClick={() => setBookingTherapist(null)}
                      className="px-6 py-3 rounded-xl hover:bg-slate-50 font-bold text-sm text-slate-600 border border-slate-200"
                    >
                      {t("إلغاء", "Cancel")}
                    </button>
                    <button
                      onClick={handleBookingConfirm}
                      className="bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm px-8 py-3 rounded-xl shadow-md transition cursor-pointer"
                    >
                      {t("أكد وحجز الموعد الآن (دفع في العيادة)", "Confirm & Book Slot (Pay at Clinic)")}
                    </button>
                  </div>
                </>
              )}

            </div>
          </div>
        )}

        {/* Directory grid lists therapists */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredTherapists.map((pt) => (
            <div 
              key={pt.id} 
              className={`bg-slate-50/50 border border-slate-100 rounded-3xl p-6 hover:shadow-lg hover:bg-white transition-all duration-300 relative ${isRtl ? "text-right" : "text-left"} flex flex-col justify-between`}
            >
              
              {/* Profile Card and verification badge */}
              <div className="space-y-4">
                
                <div className={`flex justify-between items-center ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
                  {/* MOH accredited badge */}
                  <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 text-[10px] font-bold px-2.5 py-1 rounded-xl flex items-center gap-1">
                    <BadgeCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{t("مرخص MOH", "MOH Accredited")}</span>
                  </div>

                  {/* Rating */}
                  <div className="flex items-center gap-1 bg-white border border-slate-100 px-2 py-0.5 rounded-lg">
                    <span className="text-xs font-bold text-slate-550">({pt.reviewCount})</span>
                    <span className="text-xs font-black text-slate-900">{pt.rating}</span>
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  </div>
                </div>

                <div className={`flex gap-4 items-center ${isRtl ? "justify-end flex-row" : "justify-start flex-row-reverse"} pt-2`}>
                  <div className="space-y-1">
                    <h3 className="font-display font-black text-slate-900 text-lg sm:text-xl">
                      {translatePtNameLocal(pt.name)}
                    </h3>
                    <p className="text-slate-400 text-xs font-bold">{translateSpecialtyLocal(pt.specialty[0])}</p>
                  </div>
                  
                  <img
                    src={pt.avatarUrl}
                    alt={pt.name}
                    referrerPolicy="no-referrer"
                    className="w-14 h-14 rounded-full object-cover border-2 border-brand-100 shadow-xs"
                  />
                </div>

                <p className="text-sm text-slate-650 leading-relaxed font-semibold">
                  {translateBioLocal(pt.id, pt.bioArabic)}
                </p>

                {/* Tags specialties */}
                <div className={`flex flex-wrap gap-1.5 ${isRtl ? "justify-end" : "justify-start"} pt-1`}>
                  {pt.specialty.map((item, idx) => (
                    <span key={idx} className="bg-white border border-slate-100 text-slate-800 text-[11px] font-bold px-2 py-0.5 rounded-lg shadow-2xs">
                      {translateSpecialtyLocal(item)}
                    </span>
                  ))}
                </div>

              </div>

              {/* Lower Section Pricing and direct booking */}
              <div className={`mt-6 pt-4 border-t border-slate-150/40 flex justify-between items-center ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
                <button
                  onClick={() => setBookingTherapist(pt)}
                  className="bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs sm:text-sm px-4.5 py-2.5 rounded-xl cursor-pointer transition shadow-xs"
                >
                  {t("حجز موعد جلسة", "Book Video Call")}
                </button>
                <div className={isRtl ? "text-right" : "text-left"}>
                  <span className="block text-[10px] text-slate-440 font-bold">{t("سعر الجلسة الطبية الكلي", "Total price per session")}</span>
                  <span className="text-brand-800 text-base font-black font-mono">
                    {pt.pricePerSession} <strong className="font-sans text-xs">{t("ر.س", "SAR")}</strong>
                  </span>
                </div>
              </div>

            </div>
          ))}
          
          {filteredTherapists.length === 0 && (
            <div className="col-span-full text-center py-12 text-slate-450 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              {t("لا توجد استشارات طبيب متطابقة مع شروط البحث المحددة.", "No certified doctors found matching your query criteria.")}
            </div>
          )}
        </div>

      </div>
    </section>
  );
}

import { Therapist, PainArea, Exercise } from "./types";

export const mockTherapists: Therapist[] = [
  {
    id: "t1",
    name: "د. أحمد الرويلي",
    nameEn: "Dr. Ahmed Al-Ruwaili",
    email: "ahmed.ruwaili@faqarati.com",
    role: "therapist",
    avatarUrl: "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=256&h=256&q=80",
    phoneNumber: "+966501234567",
    isVerified: true,
    specialty: ["آلام العمود الفقري", "تأهيل ما بعد الجراحة", "الإصابات الرياضية"],
    specialtyEn: ["Spine Pain", "Post-Surgical Rehabilitation", "Sports Injuries"],
    rating: 4.9,
    reviewCount: 142,
    pricePerSession: 180,
    experienceYears: 12,
    licenseNumber: "MOH-10294-PT",
    bioArabic: "متخصص في علاج وتأهيل مشاكل العمود الفقري والانزلاق الغضروفي بخبرة تفوق الـ 12 عاماً في المراكز الطبية الكبرى ومدرب معتمد لبرامج التأهيل الحركي عن بعد.",
    bioEnglish: "Specialist in treating spine disorders and herniated discs with over 12 years of experience at major medical centers. Certified instructor for remote biomechanical rehab programs.",
    availabilitySlots: ["09:00", "11:30", "14:00", "16:30", "18:00"]
  },
  {
    id: "t2",
    name: "أ. سارة الشهراني",
    nameEn: "Sara Al-Shahrani, PT",
    email: "sara.shahrani@faqarati.com",
    role: "therapist",
    avatarUrl: "https://images.unsplash.com/photo-1594824813573-246434de83fb?auto=format&fit=crop&w=256&h=256&q=80",
    phoneNumber: "+966549876543",
    isVerified: true,
    specialty: ["علاج طبيعي للأطفال", "تأهيل كبار السن", "آلام المفاصل والركبة"],
    specialtyEn: ["Pediatric Physical Therapy", "Geriatric Rehab", "Knee & Joint Pain"],
    rating: 4.8,
    reviewCount: 96,
    pricePerSession: 150,
    experienceYears: 8,
    licenseNumber: "MOH-87431-PT",
    bioArabic: "أخصائية علاج طبيعي معتمدة من وزارة الصحة، متميزة بوضع الخطط العلاجية المتكاملة لآلام المفاصل وتأهيل كبار السن لزيادة المدى الحركي بأمان وجدارة.",
    bioEnglish: "Physical therapist licensed by the Ministry of Health, specializing in designing integrated care programs for joint pain and senior mobility enhancement.",
    availabilitySlots: ["08:30", "10:00", "13:00", "15:30", "17:00"]
  },
  {
    id: "t3",
    name: "د. طارق الحازمي",
    nameEn: "Dr. Tarek Al-Hazmi",
    email: "tarek.hazmi@faqarati.com",
    role: "therapist",
    avatarUrl: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=256&h=256&q=80",
    phoneNumber: "+966551248731",
    isVerified: true,
    specialty: ["إصابات الكتف والرقبة", "تأهيل حركي متكامل", "علاج يدوي تقويمي"],
    specialtyEn: ["Shoulder & Neck Injuries", "Comprehensive Motor Rehab", "Chiropractic Adjustments"],
    rating: 4.7,
    reviewCount: 118,
    pricePerSession: 160,
    experienceYears: 10,
    licenseNumber: "MOH-49381-PT",
    bioArabic: "حاصل على الماجستير في العلاج الطبيعي الرياضي، خبير في علاج تشنجات الرقبة المزمنة وإصابات أوتار الكتف بأحدث الأساليب العلاجية الرقمية.",
    bioEnglish: "Holds a Master's degree in Sports Physical Therapy; expert in treating chronic neck spasms and shoulder tendon injuries using modern digital therapeutic techniques.",
    availabilitySlots: ["10:30", "12:00", "14:30", "16:00", "19:00"]
  }
];

export const mockExercises: Exercise[] = [
  {
    id: "ex-spine",
    nameAr: "تمرين تمدد الظهر (بزاوية العمود الفقري)",
    nameEn: "Lumbar Extension Stretch",
    descriptionAr: "يساعد في تخفيف الضغط الحركي على أسفل الظهر. حافظ على استقامة الجذع والرقبة وادفع ببطء للخلف.",
    descriptionEn: "Helps relieve mechanical pressure on the lower back. Keep your trunk and neck straight, and gently push backward.",
    targetArea: "أسفل الظهر",
    idealAngleRange: { min: 145, max: 175 },
    targetJoints: ["الكتف", "الفخذ", "الركبة"],
    recommendedDuration: "3 مجموعات × 10 تكرارات (ثبات 5 ثوانٍ)",
    recommendedDurationEn: "3 sets × 10 reps (hold for 5s)"
  },
  {
    id: "ex-neck",
    nameAr: "تمرين ثني وتمديد الرقبة الآمن",
    nameEn: "Cervical Flexion-Extension",
    descriptionAr: "تمرين لطيف لزيادة مرونة عضلات الرقبة وعلاج التشنجات الناتجة عن الجلوس الطويل أمام الشاشات.",
    descriptionEn: "Gentle sequence to increase neck and cervical muscular elasticity and ease desk-sitting posture tightness.",
    targetArea: "الرقبة",
    idealAngleRange: { min: 65, max: 85 },
    targetJoints: ["الأذن", "الكتف", "الصدر"],
    recommendedDuration: "3 مجموعات × 12 تكراراً",
    recommendedDurationEn: "3 sets × 12 reps"
  },
  {
    id: "ex-squat",
    nameAr: "تمرين القرفصاء التأهيلي للركبة",
    nameEn: "Rehab Squats for Knees",
    descriptionAr: "تمرين ممتاز لتقوية عضلات الكواد والفخذ لتثبيت مفصل الركبة. النزول حتى زاوية 90 درجة للركبتين دون تجاوز مشط القدم.",
    descriptionEn: "Excellent clinical workout to reinforce quad muscles stabilizing knee joints. Descend to 90 degrees smoothly.",
    targetArea: "الركبة",
    idealAngleRange: { min: 85, max: 105 },
    targetJoints: ["الفخذ", "الركبة", "الكاحل"],
    recommendedDuration: "3 مجموعات × 8 تكرارات",
    recommendedDurationEn: "3 sets × 8 reps"
  },
  {
    id: "ex-shoulder",
    nameAr: "تمرين تمدد الكتف والأذرع الجانبي",
    nameEn: "Shoulder Lateral Abduction",
    descriptionAr: "تحسين المدى الحركي للكتف وتحفيز الكفة المدورة. ارفع ذراعيك بشكل مستقيم موازٍ للأرض.",
    descriptionEn: "Promotes wider functional limits for shoulders and rotators. Raise your arms parallel to the ground.",
    targetArea: "الكتف",
    idealAngleRange: { min: 80, max: 100 },
    targetJoints: ["الورك", "الكتف", "المرفق"],
    recommendedDuration: "3 مجموعات × 10 تكرارات",
    recommendedDurationEn: "3 sets × 10 reps"
  }
];

export const mockPainAreas: PainArea[] = [
  {
    id: "neck",
    nameAr: "الرقبة والأكتاف العلوي",
    nameEn: "Neck & Upper Shoulders",
    descriptionAr: "آلام الفقرات العنقية والشد العضلي الناتج عن انحناء الرأس المتكرر والتوتر وعادات الجلوس المكتبية.",
    descriptionEn: "Cervical vertebra soreness and muscle fatigue originating from poor screen neck posture and desk stress.",
    matchedExercises: ["ex-neck", "ex-shoulder"],
    prevalencePercentage: 64
  },
  {
    id: "back",
    nameAr: "العمود الفقري وأسفل الظهر",
    nameEn: "Spine & Lower Back",
    descriptionAr: "تصلب فقرات القطنية وآلام الغضاريف أو عضلات الظهر السفلية والضعف الحركي العام.",
    descriptionEn: "Stiffness of lumbar vertebrae, cartilage pain, or lower back muscle spasms along with general physical weakness.",
    matchedExercises: ["ex-spine"],
    prevalencePercentage: 78
  },
  {
    id: "knee",
    nameAr: "مفصل الركبة والفخذ السفلي",
    nameEn: "Knee & Leg Joints",
    descriptionAr: "خشونة الركبة، ضعف الأربطة الجانبية، أو التأهيل الحركي اللازم بعد إصابات الملاعب أو العمليات الجراحية.",
    descriptionEn: "Knee friction, lateral ligament vulnerability, or required mobility rehabilitation post-injury or post-op.",
    matchedExercises: ["ex-squat"],
    prevalencePercentage: 55
  }
];

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = "patient" | "therapist" | "admin";

export type Weekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type ExerciseStatus = "pending" | "in_progress" | "completed" | "skipped";

export interface UserProfile {
  id: string;
  name: string;
  nameEn?: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  phoneNumber?: string;
  isVerified?: boolean; // MOH certified indicator
}

export interface Therapist extends UserProfile {
  specialty: string[];
  specialtyEn?: string[];
  rating: number;
  reviewCount: number;
  pricePerSession: number;
  bioArabic: string;
  bioEnglish?: string;
  experienceYears: number;
  availabilitySlots: string[]; // ISO string of slots
  licenseNumber: string;
}

export interface PainArea {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn?: string;
  matchedExercises: string[]; // list of Exercise IDs
  prevalencePercentage: number;
}

export interface Exercise {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn?: string;
  videoUrl?: string;
  targetArea: string;
  idealAngleRange: { min: number; max: number };
  targetJoints: string[];
  recommendedDuration: string; // e.g., "3 مجموعات × 12 تكرار"
  recommendedDurationEn?: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  therapistId: string;
  therapistName: string;
  date: string; // YYYY-MM-DD
  time: string;  // HH:MM
  status: "upcoming" | "completed" | "cancelled";
  price: number;
}

export interface JointAngleMetrics {
  timestamp: number;
  jointName: string;
  angleValue: number;
  isCorrect: boolean;
}

export interface ExerciseSessionLog {
  id: string;
  patientId: string;
  exerciseId: string;
  exerciseNameAr: string;
  exerciseNameEn?: string;
  planExerciseId?: string;
  scheduledDay?: Weekday;
  targetSets?: number;
  targetReps?: number;
  completedReps?: number;
  date: string;
  durationSeconds: number;
  completionRate: number;
  accuracyScore: number;
  primaryErrorFlag?: string;
  metrics: JointAngleMetrics[];
  patientPainRating?: number;
  difficultyRating?: number;
  feedbackNotes?: string;
  completedAt?: string;
}

export interface ScheduledExercise {
  id: string;
  exerciseId: string;
  nameAr: string;
  nameEn: string;
  sets: number;
  reps: number;
  holdTime: number;
  clinicalPrecaution: string;
  notes: string;
  targetMuscle: string;
  kimoreMin: number;
  kimoreMax: number;
  status?: ExerciseStatus;
  completedReps?: number;
}

export type WeeklySchedule = Record<Weekday, ScheduledExercise[]>;

export interface ExerciseSessionContext {
  planExerciseId?: string;
  exerciseId: string;
  nameAr: string;
  nameEn?: string;
  targetSets: number;
  targetReps: number;
  holdTime: number;
  kimoreMin: number;
  kimoreMax: number;
  clinicalPrecaution?: string;
  scheduledDay?: Weekday;
}

export interface PainJournalEntry {
  id: string;
  patientId: string;
  date: string;
  region: string;
  painLevel: number;
  stiffness?: number;
  sleepImpact?: number;
  notes?: string;
  linkedSessionLogId?: string;
}

export interface TriageReport {
  id: string;
  patientId?: string;
  painRegion: "neck" | "spinal" | "knee";
  painLevel: number;
  duration: string;
  triggers: string[];
  priorInjuries?: string;
  redFlags: string[];
  riskLevel: "green" | "amber" | "red";
  diagnosisHint: string;
  recommendedExerciseIds: string[];
  matchedTherapistIds: string[];
  createdAt: string;
}

export interface ExerciseRating {
  id: string;
  sessionLogId: string;
  patientId: string;
  difficulty: number;
  painDuring: number;
  note?: string;
  createdAt: string;
}

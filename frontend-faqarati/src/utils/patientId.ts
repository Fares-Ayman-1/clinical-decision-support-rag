/**
 * Maps logged-in demo user to backend patient ID.
 * P2: replace with real auth user id from Supabase.
 */
export function resolvePatientId(
  user: { email?: string; role?: string } | null
): string {
  if (!user) return "p1";
  if (user.email === "fatemah.it@gmail.com") return "p1";
  return "p1";
}

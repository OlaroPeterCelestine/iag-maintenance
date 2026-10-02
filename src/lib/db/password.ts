import bcrypt from "bcryptjs";

const ROUNDS = 10;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  if (!hash) return false;
  if (hash.startsWith("$2")) {
    try {
      return bcrypt.compareSync(password, hash);
    } catch {
      return false;
    }
  }
  // Legacy plain / demo hashes
  return password === hash;
}

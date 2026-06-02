/** Password hashing via Bun's native argon2id. */
export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 });
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // Bun.password.verify auto-detects the algorithm from the stored hash.
  return Bun.password.verify(plain, hash).catch(() => false);
}

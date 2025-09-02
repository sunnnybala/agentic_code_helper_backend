import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

const argon2Options = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
  type: 2 // argon2id
};

export async function hashPassword(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  // Use the argon2 library to produce a standard encoded hash string.
  // Let the library generate the salt to avoid incorrect parameter usage.
  try {
    const encoded = await argon2Hash(plainPassword, argon2Options);
    // encoded is safe to store directly in DB and will contain algorithm + salt + hash
    return encoded;
  } catch (err) {
    throw new Error('Failed to hash password');
  }
}

export async function verifyPassword(plainPassword, storedHash) {
  if (!storedHash) return false;
  try {
    // argon2Verify accepts the encoded hash and the plain password
    return await argon2Verify(storedHash, plainPassword);
  } catch (e) {
    return false;
  }
}



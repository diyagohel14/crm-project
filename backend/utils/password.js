// utils/password.js
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plainText) {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}
// console.log(await hashPassword("rahul@123"));

export async function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

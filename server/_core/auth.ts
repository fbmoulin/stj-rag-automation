import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";

const now = new Date(0);

const ADMIN_USER: User = {
  id: 0,
  openId: "admin",
  name: "Administrator",
  email: null,
  loginMethod: "password",
  role: "admin",
  createdAt: now,
  updatedAt: now,
  lastSignedIn: now,
};

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("365d")
    .sign(getSecret());
}

export async function verifySessionToken(req: Request): Promise<User | null> {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    await jwtVerify(token, getSecret());
    return ADMIN_USER;
  } catch {
    return null;
  }
}

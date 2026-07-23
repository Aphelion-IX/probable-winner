import { cookies } from "next/headers";

const CART_SESSION_COOKIE = "cart_session_id";
const CART_SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function getCartSessionId(): Promise<string> {
  const cookieStore = await cookies();
  let sessionId = cookieStore.get(CART_SESSION_COOKIE)?.value;

  if (!sessionId) {
    // Generate a new session ID for guest checkout
    sessionId = generateSessionId();
    cookieStore.set(CART_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: CART_SESSION_DURATION / 1000, // Convert to seconds
      path: "/",
    });
  }

  return sessionId;
}

export async function setCartSessionId(sessionId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CART_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: CART_SESSION_DURATION / 1000,
    path: "/",
  });
}

export async function clearCartSessionId(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CART_SESSION_COOKIE);
}

function generateSessionId(): string {
  // Generate a random session ID (UUID v4 style)
  return `${Math.random().toString(36).substring(2)}${Date.now().toString(36)}`;
}

export async function getOrCreateCart(userId?: string) {
  const sessionId = await getCartSessionId();

  // In production, would fetch from Supabase
  // For now, return a minimal cart structure
  return {
    id: userId ? `customer_${userId}` : `guest_${sessionId}`,
    sessionId,
    customerId: userId || null,
    lines: [],
    createdAt: new Date(),
  };
}

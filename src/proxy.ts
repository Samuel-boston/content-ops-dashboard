import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// API routes authenticate themselves (or are dev-only / webhook endpoints);
// the page-auth redirect below only applies to rendered routes.
//
// `/g` is the guest surface — review and phone-upload links. It has no session
// by design: the token in the URL is the credential, checked server-side on
// every request. Bouncing it to /login defeats the whole feature.
const PUBLIC_PATHS = ["/login", "/auth", "/api", "/g"];

/**
 * Runs before every request: refreshes the Supabase auth session (keeping
 * cookies fresh) and bounces logged-out users to /login. The real
 * authorization boundary is still server-side — RLS on every query, plus
 * requireUser()/requireRole() in pages and server actions.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Local JWT verification against the project's JWKS — see the note in
  // lib/auth.ts. This runs on literally every request, so a network call to
  // the auth server here was pure latency on top of the one the page already
  // paid. `getClaims` still refreshes an expired session via the cookie
  // handlers above, which is the other reason this proxy exists.
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims?.sub ? { id: claims.claims.sub } : null;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

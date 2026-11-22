import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCorsHeaders, getPublicCorsHeaders, isOriginAllowed, isPublicCorsPath } from "@/lib/cors";
import { logger, stripSensitiveFields } from "@/lib/logger";
import { plaidAccessTokens } from "@/lib/plaid";
import { reportError } from "@/lib/error-reporting";
import { captureServerException } from "@/lib/monitoring/sentry";
import { locales, defaultLocale, type Locale } from "@/i18n.config";
import {
  buildCsp,
  generateNonce,
  resolveCspMode,
  resolveBadgeFrameAncestors,
  CSP_REPORT_PATH,
  CSP_REPORT_GROUP,
} from "@/lib/csp.mjs";

const LOCALE_COOKIE = "NEXT_LOCALE";

function isSupportedLocale(value: string | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

function localeFromAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) return undefined;
  const candidates = header
    .split(",")
    .map((part) => {
      const [tagPart, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: tagPart.toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag, q } of candidates) {
    if (q <= 0) continue;
    const base = tag.split("-")[0];
    if (isSupportedLocale(base)) return base;
  }
  return undefined;
}

function resolveRequestId(inbound: string | null | undefined): string {
  const REQUEST_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
  if (inbound && REQUEST_ID_RE.test(inbound)) return inbound;

  // Use Web Crypto API (available in edge runtime) instead of Node.js crypto
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}



export function middleware(request: NextRequest) {
  // Handle i18n routing first
  if (!request.nextUrl.pathname.startsWith("/api")) {
    const { pathname } = request.nextUrl;

    // Locale precedence: explicit URL locale > saved explicit choice (cookie)
    // > browser language (Accept-Language) > default locale.
    // Manual selection updates the cookie and URL; saved choice is only applied
    // when the URL has no explicit locale prefix.
    let locale: Locale = defaultLocale;
    let targetPath = pathname;
    let hasUrlLocale = false;

    for (const loc of locales) {
      if (loc === defaultLocale) continue;
      if (pathname === `/${loc}` || pathname.startsWith(`/${loc}/`)) {
        locale = loc;
        targetPath = pathname.slice(loc.length + 1) || "/";
        hasUrlLocale = true;
        break;
      }
    }

    if (!hasUrlLocale) {
      const saved = request.cookies.get(LOCALE_COOKIE)?.value;
      if (isSupportedLocale(saved)) {
        locale = saved;
      } else {
        locale = localeFromAcceptLanguage(request.headers.get("accept-language")) ?? defaultLocale;
      }
    }

    if (!hasUrlLocale && locale !== defaultLocale) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
      const redirect = NextResponse.redirect(redirectUrl);
      redirect.cookies.set(LOCALE_COOKIE, locale, {
        path: "/",
        maxAge: 31536000,
        sameSite: "lax",
      });
      return redirect;
    }

    const mode = resolveCspMode(process.env.CSP_MODE);
    const cspHeaderName =
      mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

    const isBadgeRoute = targetPath === "/badge" || targetPath.startsWith("/badge/");
    const frameAncestors = isBadgeRoute
      ? resolveBadgeFrameAncestors(process.env.BADGE_ALLOWED_ORIGINS)
      : undefined;

    // NEXT_PUBLIC_* values are inlined at build time in middleware, unlike headers() in
    // next.config.mjs, so they must be set at build time for the gating to match.
    const nonce = generateNonce();
    const policy = buildCsp({
      strict: true,
      nonce,
      walletConnectEnabled: Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
      rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
      indexerUrl: process.env.NEXT_PUBLIC_INDEXER_URL,
      reportEndpoint: CSP_REPORT_PATH,
      frameAncestors,
    });

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-next-intl-locale", locale);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set(cspHeaderName, policy);

    let response: NextResponse;
    if (targetPath !== pathname) {
      const url = request.nextUrl.clone();
      url.pathname = targetPath;
      response = NextResponse.rewrite(url, {
        request: {
          headers: requestHeaders,
        },
      });
    } else {
      response = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    }

    response.headers.set(cspHeaderName, policy);
    response.headers.set(
      "Reporting-Endpoints",
      `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`,
    );
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 31536000,
      sameSite: "lax",
    });
    return response;
  }

  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const startTime = Date.now();

  // Detect demo/mock mode signals
  const isDemoIssuer = !process.env.ISSUER_PRIVATE_KEY;
  const isPlaidMock = plaidAccessTokens().length === 0;
  const isPersonaDemo = !process.env.PERSONA_API_KEY;

  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    if (isPublicCorsPath(request.nextUrl.pathname)) {
      const response = new NextResponse(null, {
        status: 204,
        headers: getPublicCorsHeaders(),
      });
      logRequest(request, 204, startTime, requestId, isDemoIssuer, isPlaidMock, isPersonaDemo);
      return response;
    }
    if (!isOriginAllowed(origin)) {
      logRequest(request, 204, startTime, requestId, isDemoIssuer, isPlaidMock, isPersonaDemo);
      return new NextResponse(null, { status: 204 });
    }
    const response = new NextResponse(null, {
      status: 204,
      headers: getCorsHeaders(),
    });
    logRequest(request, 204, startTime, requestId, isDemoIssuer, isPlaidMock, isPersonaDemo);
    return response;
  }

  const response = NextResponse.next();
  const origin = request.headers.get("origin");
  if (isPublicCorsPath(request.nextUrl.pathname)) {
    for (const [key, value] of Object.entries(getPublicCorsHeaders())) {
      response.headers.set(key, value);
    }
  } else if (isOriginAllowed(origin)) {
    const corsHeaders = getCorsHeaders();
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }
  }

  // Log the request after response is generated
  response.headers.set("x-request-id", requestId);
  logRequest(request, response.status, startTime, requestId, isDemoIssuer, isPlaidMock, isPersonaDemo);

  // Report unexpected 500 errors to error sink and Sentry if configured
  if (response.status === 500) {
    captureServerException(new Error(`Server error 500 on ${request.method} ${request.nextUrl.pathname}`), {
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      status: response.status,
    }).catch(() => {});

    reportError({
      method: request.method,
      path: request.nextUrl.pathname,
      requestId,
      status: response.status,
    }).catch((err) => {
      logger.error(
        stripSensitiveFields({
          event: "error_reporting_failed",
          requestId,
          error: (err as Error).message,
        }),
      );
    });
  }

  return response;
}

function logRequest(
  request: NextRequest,
  status: number,
  startTime: number,
  requestId: string,
  isDemoIssuer: boolean,
  isPlaidMock: boolean,
  isPersonaDemo: boolean,
) {
  const durationMs = Date.now() - startTime;
  logger.info(
    stripSensitiveFields({
      event: "api_request",
      method: request.method,
      path: request.nextUrl.pathname,
      status,
      durationMs,
      requestId,
      demoIssuer: isDemoIssuer || undefined,
      plaidMock: isPlaidMock || undefined,
      personaDemo: isPersonaDemo || undefined,
    }),
  );
}

export const config = {
  matcher: [
    // API routes - handle CORS and logging
    "/api/:path*",
    // All pages - handle i18n routing (except static assets)
    "/((?!_next|.*\\..*|public).*)",
  ],
};

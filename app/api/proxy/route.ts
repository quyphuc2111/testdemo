import { NextRequest, NextResponse } from 'next/server';

// Store cookies in memory (for demo - in production use Redis/database)
let storedCookies: string[] = [];

async function proxyRequest(request: NextRequest, method: 'GET' | 'POST', body?: string) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Cookie': storedCookies.join('; '),
        'User-Agent': request.headers.get('user-agent') || '',
        'Content-Type': method === 'POST' ? 'application/x-www-form-urlencoded' : '',
      },
      redirect: 'manual', // Handle redirects manually to capture cookies
    };

    if (method === 'POST' && body) {
      fetchOptions.body = body;
    }

    const res = await fetch(url, fetchOptions);

    // Capture Set-Cookie headers
    const setCookies = res.headers.getSetCookie();
    if (setCookies.length > 0) {
      setCookies.forEach(cookie => {
        const cookieName = cookie.split('=')[0];
        // Remove old cookie with same name
        storedCookies = storedCookies.filter(c => !c.startsWith(cookieName + '='));
        // Add new cookie (just the name=value part)
        const cookieValue = cookie.split(';')[0];
        storedCookies.push(cookieValue);
      });
    }

    // Handle redirects
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) {
        const redirectUrl = new URL(location, url).href;
        // Tạo absolute URL cho redirect
        const requestUrl = new URL(request.url);
        const proxyRedirectUrl = `${requestUrl.origin}/api/proxy?url=${encodeURIComponent(redirectUrl)}`;
        return NextResponse.redirect(proxyRedirectUrl);
      }
    }

    let html = await res.text();

    // Inject CSS để ẩn navigation elements
    const hideNavCSS = `
      <style>
        .primary-navigation { display: none !important; }
        #page-navbar { display: none !important; }
        .breadcrumb { display: none !important; }
      </style>
    `;
    html = html.replace('</head>', `${hideNavCSS}</head>`);

    // Rewrite form actions to go through proxy
    const baseUrl = new URL(url);
    html = html.replace(/action="([^"]+)"/g, (match, actionUrl) => {
      const absoluteUrl = new URL(actionUrl, url).href;
      return `action="/api/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
    });

    // Rewrite relative URLs thành absolute
    html = html.replace(/(href|src)="\/(?!\/)/g, `$1="${baseUrl.origin}/`);

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch URL' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return proxyRequest(request, 'GET');
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  return proxyRequest(request, 'POST', body);
}

import { NextRequest, NextResponse } from 'next/server';

// Store cookies in memory (for demo - in production use Redis/database)
let storedCookies: string[] = [];

/**
 * Parse and store Set-Cookie headers from a response
 * Replaces cookies with the same name
 * Requirements: 3.1, 3.3
 */
function updateCookies(response: Response): void {
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length > 0) {
    setCookies.forEach(cookie => {
      const cookieName = cookie.split('=')[0];
      // Remove old cookie with same name (cookie replacement logic)
      storedCookies = storedCookies.filter(c => !c.startsWith(cookieName + '='));
      // Add new cookie (just the name=value part, strip attributes)
      const cookieValue = cookie.split(';')[0];
      storedCookies.push(cookieValue);
    });
  }
}

/**
 * Format stored cookies as a Cookie header string
 * Requirements: 3.2, 3.4
 */
function getCookieHeader(): string {
  return storedCookies.join('; ');
}

/**
 * Extract content type from response headers
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
function getContentType(response: Response): string {
  const contentType = response.headers.get('content-type');
  return contentType || 'text/plain';
}

/**
 * Determine if content should be rewritten (HTML only)
 * Requirements: 4.5
 */
function shouldRewriteContent(contentType: string): boolean {
  return contentType.toLowerCase().includes('text/html');
}

/**
 * Get appropriate response headers based on content type
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
function getResponseHeaders(contentType: string): HeadersInit {
  return {
    'Content-Type': contentType,
  };
}

/**
 * Conver3 absolute URLs
 * Handles: /path, path, ../path, protocol-relative URLs (//domain/path)
 * Requirements: 1.2
 */
function rewriteRelativeUrls(html: string, targetUrl: string): string {
  const baseUrl = new URL(targetUrl);
  let result = html;

  // Handle protocol-relative URLs (//domain/path) - convert to https
  result = result.replace(/(['"])(\/\/[^'"]+)(['"])/g, (match, quote1, url, quote2) => {
    return `${quote1}https:${url}${quote2}`;
  });

  // Handle absolute paths (/path) - convert to full URL
  result = result.replace(/(href|src|action)="\/(?!\/)/g, `$1="${baseUrl.origin}/`);
  result = result.replace(/(href|src|action)='\/(?!\/)/g, `$1='${baseUrl.origin}/`);

  // Handle relative paths (path, ../path) in href, src, and action attributes
  // This regex matches attributes with values that don't start with http://, https://, //, or /
  result = result.replace(
    /(href|src|action)=["'](?!https?:\/\/|\/\/|\/|#|data:|javascript:)([^"']+)["']/gi,
    (match, attr, relPath) => {
      try {
        const absoluteUrl = new URL(relPath, targetUrl).href;
        return `${attr}="${absoluteUrl}"`;
      } catch {
        // If URL construction fails, return original
        return match;
      }
    }
  );

  return result;
}

/**
 * Rewrite form actions to route through the proxy
 * Requirements: 1.3
 */
function rewriteFormActions(html: string, proxyBaseUrl: string): string {
  return html.replace(/(<form[^>]*action=["'])([^"']+)(["'])/gi, (match, prefix, actionUrl, suffix) => {
    try {
      // actionUrl is already absolute from rewriteRelativeUrls
      const encodedUrl = encodeURIComponent(actionUrl);
      return `${prefix}${proxyBaseUrl}/api/proxy?url=${encodedUrl}${suffix}`;
    } catch {
      return match;
    }
  });
}

/**
 * Rewrite resource links (CSS, JS, images) to route through the proxy
 * Requirements: 1.5
 */
function rewriteResourceLinks(html: string, proxyBaseUrl: string): string {
  // Rewrite src attributes (images, scripts)
  let result = html.replace(/(<(?:img|script)[^>]*src=["'])([^"']+)(["'])/gi, (match, prefix, srcUrl, suffix) => {
    try {
      // Skip data URLs and already proxied URLs
      if (srcUrl.startsWith('data:') || srcUrl.includes('/api/proxy?url=')) {
        return match;
      }
      const encodedUrl = encodeURIComponent(srcUrl);
      return `${prefix}${proxyBaseUrl}/api/proxy?url=${encodedUrl}${suffix}`;
    } catch {
      return match;
    }
  });

  // Rewrite link href attributes (CSS, icons)
  result = result.replace(/(<link[^>]*href=["'])([^"']+)(["'])/gi, (match, prefix, hrefUrl, suffix) => {
    try {
      // Skip already proxied URLs
      if (hrefUrl.includes('/api/proxy?url=')) {
        return match;
      }
      const encodedUrl = encodeURIComponent(hrefUrl);
      return `${prefix}${proxyBaseUrl}/api/proxy?url=${encodedUrl}${suffix}`;
    } catch {
      return match;
    }
  });

  return result;
}

/**
 * Comprehensive HTML content rewriting
 * Combines all URL rewriting operations
 * Requirements: 1.2, 1.3, 1.5
 */
function rewriteHtmlContent(html: string, targetUrl: string, proxyBaseUrl: string): string {
  // Step 1: Convert all relative URLs to absolute
  let result = rewriteRelativeUrls(html, targetUrl);
  
  // Step 2: Rewrite form actions to go through proxy
  result = rewriteFormActions(result, proxyBaseUrl);
  
  // Step 3: Rewrite resource links to go through proxy
  result = rewriteResourceLinks(result, proxyBaseUrl);
  
  return result;
}

/**
 * Generate AJAX interceptor script that overrides XMLHttpRequest and fetch
 * to route all requests through the proxy
 * Requirements: 1.4, 7.1
 */
function getAjaxInterceptorScript(targetOrigin: string, proxyBaseUrl: string): string {
  return `
<script>
(function() {
  const targetOrigin = '${targetOrigin}';
  const proxyBaseUrl = '${proxyBaseUrl}';
  
  /**
   * Rewrite URL to route through proxy
   * Handles absolute URLs to target domain and relative URLs
   */
  function rewriteUrlForProxy(url) {
    try {
      // Handle relative URLs
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('//')) {
        // Relative URL - make it absolute to target origin
        const absoluteUrl = new URL(url, targetOrigin).href;
        return proxyBaseUrl + '/api/proxy?url=' + encodeURIComponent(absoluteUrl);
      }
      
      // Handle protocol-relative URLs
      if (url.startsWith('//')) {
        const absoluteUrl = 'https:' + url;
        return proxyBaseUrl + '/api/proxy?url=' + encodeURIComponent(absoluteUrl);
      }
      
      // Handle absolute URLs
      const urlObj = new URL(url);
      const targetOriginObj = new URL(targetOrigin);
      
      // If URL is to the target domain, proxy it
      if (urlObj.origin === targetOriginObj.origin) {
        return proxyBaseUrl + '/api/proxy?url=' + encodeURIComponent(url);
      }
      
      // If URL is to a different domain, leave it unchanged (or optionally proxy it)
      return url;
    } catch (e) {
      // If URL parsing fails, return original
      return url;
    }
  }
  
  // Override XMLHttpRequest
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open;
    
    xhr.open = function(method, url, ...args) {
      const rewrittenUrl = rewriteUrlForProxy(url);
      return originalOpen.call(this, method, rewrittenUrl, ...args);
    };
    
    return xhr;
  };
  
  // Copy static properties from original XMLHttpRequest
  Object.setPrototypeOf(window.XMLHttpRequest.prototype, OriginalXHR.prototype);
  Object.setPrototypeOf(window.XMLHttpRequest, OriginalXHR);
  
  // Override fetch
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    let url;
    
    // Handle Request object or string URL
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      url = String(input);
    }
    
    const rewrittenUrl = rewriteUrlForProxy(url);
    
    // If input was a Request object, create a new one with rewritten URL
    if (input instanceof Request) {
      const newRequest = new Request(rewrittenUrl, input);
      return originalFetch.call(this, newRequest, init);
    }
    
    return originalFetch.call(this, rewrittenUrl, init);
  };
})();
</script>
`;
}

/**
 * Inject AJAX interceptor script into HTML before closing head tag
 * Handles HTML without head tag gracefully by injecting at the start of body
 * Requirements: 1.4, 7.1
 */
function injectAjaxInterceptor(html: string, script: string): string {
  // Try to inject before closing head tag
  if (html.includes('</head>')) {
    return html.replace('</head>', `${script}</head>`);
  }
  
  // If no head tag, try to inject at the start of body
  if (html.includes('<body')) {
    return html.replace(/(<body[^>]*>)/i, `$1${script}`);
  }
  
  // If no head or body tag, inject at the very beginning
  return script + html;
}

/**
 * Follow redirect chain until final response
 * Extracts cookies from intermediate responses
 * Resolves relative redirect locations to absolute URLs
 * Requirements: 5.1, 5.2, 5.3
 */
async function followRedirects(
  response: Response,
  fetchOptions: RequestInit,
  currentUrl: string,
  maxRedirects: number = 10
): Promise<Response> {
  let redirectCount = 0;
  let currentResponse = response;
  let nextUrl = currentUrl;

  while (currentResponse.status >= 300 && currentResponse.status < 400 && redirectCount < maxRedirects) {
    // Extract cookies from intermediate redirect response (Requirement 5.2)
    updateCookies(currentResponse);

    // Get redirect location
    const location = currentResponse.headers.get('location');
    if (!location) {
      // No location header, return current response
      break;
    }

    // Resolve relative redirect location to absolute URL (Requirement 5.3)
    try {
      nextUrl = new URL(location, nextUrl).href;
    } catch (error) {
      console.error('Failed to resolve redirect URL:', error);
      break;
    }

    // Update fetch options with new cookies
    const updatedOptions: RequestInit = {
      ...fetchOptions,
      headers: {
        ...fetchOptions.headers,
        'Cookie': getCookieHeader(),
      },
    };

    // Follow the redirect
    try {
      currentResponse = await fetch(nextUrl, updatedOptions);
      redirectCount++;
    } catch (error) {
      console.error('Failed to follow redirect:', error);
      break;
    }
  }

  // Extract cookies from final response
  updateCookies(currentResponse);

  return currentResponse;
}

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
        'Cookie': getCookieHeader(),
        'User-Agent': request.headers.get('user-agent') || '',
        'Content-Type': method === 'POST' ? 'application/x-www-form-urlencoded' : '',
      },
      redirect: 'manual', // Handle redirects manually to capture cookies
    };

    if (method === 'POST' && body) {
      fetchOptions.body = body;
    }

    let res = await fetch(url, fetchOptions);

    // Follow redirects and extract cookies from intermediate responses (Requirements 5.1, 5.2, 5.3)
    res = await followRedirects(res, fetchOptions, url);

    // Get content type from response
    const contentType = getContentType(res);
    
    // Check if content should be rewritten (HTML only)
    if (shouldRewriteContent(contentType)) {
      // HTML content - apply rewriting and script injection
      let html = await res.text();

      // Get the proxy base URL from the request
      const requestUrl = new URL(request.url);
      const proxyBaseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

      // Rewrite HTML content using the comprehensive rewriting function
      html = rewriteHtmlContent(html, url, proxyBaseUrl);

      // Inject CSS to hide navigation elements
      const hideNavCSS = `
      <style>
        .primary-navigation { display: none !important; }
        #page-navbar { display: none !important; }
        .breadcrumb { display: none !important; }
      </style>
    `;
      html = html.replace('</head>', `${hideNavCSS}</head>`);

      // Inject AJAX interceptor script
      const targetOrigin = new URL(url).origin;
      const ajaxInterceptorScript = getAjaxInterceptorScript(targetOrigin, proxyBaseUrl);
      html = injectAjaxInterceptor(html, ajaxInterceptorScript);

      return new NextResponse(html, {
        headers: getResponseHeaders(contentType),
      });
    } else {
      // Non-HTML content - pass through unchanged
      const content = await res.arrayBuffer();
      
      return new NextResponse(content, {
        status: res.status,
        headers: getResponseHeaders(contentType),
      });
    }
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

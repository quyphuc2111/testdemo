'use client';

import { useEffect, useRef } from 'react';

export default function Page() {
  const targetUrl = 'https://lms.bkt.net.vn/course/view.php?id=22';
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const hideNavCSS = `
     .primary-navigation { display: none !important; }
        #page-navbar { display: none !important; }
        .breadcrumb { display: none !important; }
    `;

    const injectCSS = () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) return;

        // Xóa style cũ nếu có
        const oldStyle = iframeDoc.getElementById('hide-nav-style');
        if (oldStyle) oldStyle.remove();

        // Inject style mới
        const style = iframeDoc.createElement('style');
        style.id = 'hide-nav-style';
        style.textContent = hideNavCSS;
        iframeDoc.head.appendChild(style);

        console.log('CSS injected successfully');
      } catch (error) {
        console.error('Không thể inject CSS:', error);
      }
    };

    // Inject CSS mỗi khi iframe load (bao gồm cả navigation)
    const handleLoad = () => {
      injectCSS();
      
      // Theo dõi thay đổi DOM để inject lại nếu cần
      try {
        const iframeDoc = iframe.contentDocument;
        if (iframeDoc) {
          const observer = new MutationObserver(() => {
            if (!iframeDoc.getElementById('hide-nav-style')) {
              injectCSS();
            }
          });
          
          observer.observe(iframeDoc.head, {
            childList: true,
            subtree: true
          });
          
          return () => observer.disconnect();
        }
      } catch (error) {
        console.error('Không thể theo dõi DOM:', error);
      }
    };

    iframe.addEventListener('load', handleLoad);

    return () => {
      iframe.removeEventListener('load', handleLoad);
    };
  }, []);

  return (
    <div className='w-screen h-screen'>
      <iframe ref={iframeRef} src={proxyUrl} className="w-full h-full" />
    </div>
  );
}

'use client';

import { useSearchParams } from 'next/navigation';

export default function Page() {
  const searchParams = useSearchParams();
  const targetUrl = searchParams.get('url') || '';
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;

  return (
    <div className='w-screen h-screen'>
      <iframe src={proxyUrl} className="w-full h-full" />
    </div>
  );
}

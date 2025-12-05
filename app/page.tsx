'use client';

export default function Page() {
  const targetUrl = 'https://lms.bkt.net.vn/course/view.php?id=22';
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;

  console.log()

  return (
    <div className='w-screen h-screen'>
      <iframe src={proxyUrl} className="w-full h-full" />
    </div>
  );
}

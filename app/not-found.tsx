import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="rm-page min-h-[50vh] py-24">
      <p className="rm-label">404</p>
      <h1 className="rm-h1 mt-4">Page not found</h1>
      <p className="rm-lede mt-4">This page does not exist.</p>
      <p className="mt-8 flex gap-6 text-[0.9375rem]">
        <Link href="/docs" className="rm-link">Docs</Link>
        <Link href="/api-reference" className="rm-link">API reference</Link>
        <Link href="/" className="rm-link">Home</Link>
      </p>
    </div>
  );
}

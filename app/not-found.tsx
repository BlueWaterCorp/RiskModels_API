import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-[50vh] bg-zinc-950 px-4 py-24 text-center">
      <h1 className="text-3xl font-bold text-white">Page not found</h1>
      <p className="mt-3 text-zinc-400">This page does not exist.</p>
      <p className="mt-6 text-sm">
        <Link href="/docs" className="text-primary hover:underline">Docs</Link>
        <span className="px-2 text-zinc-600">·</span>
        <Link href="/" className="text-primary hover:underline">Home</Link>
      </p>
    </div>
  );
}

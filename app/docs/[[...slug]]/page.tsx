import { getDocBySlug, getAllDocSlugs } from '@/lib/mdx';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { notFound } from 'next/navigation';

export async function generateStaticParams() {
  const slugs = getAllDocSlugs();
  return slugs.map((slug) => ({
    slug: [slug],
  }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug: slugParam } = await params;
  const slug = slugParam?.[0] || 'api';
  const doc = await getDocBySlug(slug);
  
  if (!doc) {
    return {
      title: 'Not Found',
    };
  }

  return {
    title: doc.meta.title,
    description: doc.meta.description,
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug: slugParam } = await params;
  const slug = slugParam?.[0] || 'api';
  const doc = await getDocBySlug(slug);

  if (!doc) {
    notFound();
  }

  return (
    <div className="min-h-screen py-16 px-4 sm:px-6 lg:px-8 bg-zinc-950">
      <div className="max-w-4xl mx-auto">
        <article className="prose prose-invert max-w-none prose-headings:font-bold prose-h1:text-4xl prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-6 prose-p:text-zinc-400 prose-a:text-primary hover:prose-a:text-primary/80 prose-code:text-zinc-200 prose-code:bg-zinc-900 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-table:border-zinc-800 prose-th:border-zinc-700 prose-td:border-zinc-800 prose-hr:border-zinc-800 prose-hr:my-10">
          <MDXRemote
            source={doc.content}
            options={{
              mdxOptions: {
                remarkPlugins: [remarkMath],
                rehypePlugins: [
                  [rehypeKatex, { output: 'html', throwOnError: false, strict: false }],
                ],
              },
            }}
          />
        </article>
      </div>
    </div>
  );
}

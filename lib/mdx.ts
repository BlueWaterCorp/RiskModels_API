import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const contentDirectory = path.join(process.cwd(), 'content/docs');

export interface DocMeta {
  title: string;
  description?: string;
  slug: string;
}

export interface DocContent {
  meta: DocMeta;
  content: string;
}

export async function getDocBySlug(slug: string): Promise<DocContent | null> {
  try {
    const fullPath = path.join(contentDirectory, `${slug}.mdx`);
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(fileContents);

    return {
      meta: {
        title: data.title || slug,
        description: data.description,
        slug,
      },
      content,
    };
  } catch (error) {
    console.error(`Error reading doc ${slug}:`, error);
    return null;
  }
}

export function getAllDocSlugs(): string[] {
  try {
    const files = fs.readdirSync(contentDirectory);
    return files
      .filter((file) => file.endsWith('.mdx'))
      .map((file) => file.replace(/\.mdx$/, ''));
  } catch (error) {
    console.error('Error reading docs directory:', error);
    return [];
  }
}

export function getDocsList(): DocMeta[] {
  const slugs = getAllDocSlugs();
  return slugs.map((slug) => {
    const fullPath = path.join(contentDirectory, `${slug}.mdx`);
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const { data } = matter(fileContents);
    return {
      title: data.title || slug,
      description: data.description,
      slug,
    };
  });
}

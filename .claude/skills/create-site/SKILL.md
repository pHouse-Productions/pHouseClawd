---
name: create-site
description: Create a web app or static site. Uses Astro for static sites, Next.js when a backend is needed. Deploys to hosted-sites directory with Caddy serving subdomains.
---

# Create Site Skill

Build and deploy web applications. Choose the right stack based on requirements:

| Need | Stack | Why |
|------|-------|-----|
| Static content, marketing site, portfolio | **Astro + Tailwind** | Zero JS by default, blazing fast |
| API routes, database, auth, dynamic content | **Next.js + Tailwind** | Full-stack React framework |

## Decision Guide

**Use Astro when:**
- Brochure/marketing sites
- Portfolios and galleries
- Documentation sites
- Blogs (with markdown)
- Landing pages
- Any site where content doesn't change based on user

**Use Next.js when:**
- User authentication needed
- Database interactions
- API endpoints
- Dynamic dashboards
- E-commerce with cart/checkout
- Real-time features
- Server-side data fetching

## Directory Structure

Sites live in the hosted-sites directory (configured in your environment):
```
~/hosted-sites/
  myapp/           # Subdomain: myapp.yourdomain.com
    src/
    public/
    dist/ or .next/
    package.json
```

## Workflow

### 1. Clarify Requirements

Before building, understand:
- What's the site for? (portfolio, app, marketing, etc.)
- Does it need user accounts or login?
- Does it need to store/fetch data?
- What pages are needed?
- Any specific design requirements?

### 2. Choose Stack

Based on requirements, pick Astro or Next.js.

### 3. Create the Project

#### For Astro (Static Sites)

```bash
cd ~/hosted-sites
npm create astro@latest <site-name> -- --template minimal --no-install --no-git
cd <site-name>
npm install
npm install @astrojs/tailwind tailwindcss
```

Configure `astro.config.mjs`:
```javascript
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://<subdomain>.<your-domain>',
  integrations: [tailwind()],
  output: 'static'
});
```

Configure `tailwind.config.mjs`:
```javascript
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
}
```

#### For Next.js (Full-Stack Apps)

```bash
cd ~/hosted-sites
npx create-next-app@latest <site-name> --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"
cd <site-name>
```

Configure `next.config.js` for standalone output:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
}
module.exports = nextConfig
```

### 4. Build the Site

#### Astro Layout (`src/layouts/Layout.astro`)
```astro
---
interface Props { title: string; }
const { title } = Astro.props;
---
<!doctype html>
<html lang="en" class="scroll-smooth">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="generator" content={Astro.generator} />
    <title>{title}</title>
  </head>
  <body class="bg-white dark:bg-neutral-950 text-gray-900 dark:text-gray-100">
    <slot />
    <script is:inline>
      const theme = localStorage.getItem('theme') ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', theme === 'dark');
      window.toggleTheme = () => {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
      };
    </script>
  </body>
</html>
```

#### Astro Page (`src/pages/index.astro`)
```astro
---
import Layout from '../layouts/Layout.astro';

const features = [
  { title: "Feature 1", description: "Description here" },
  // ...
];
---
<Layout title="Site Title">
  <main class="min-h-screen">
    <!-- Hero -->
    <section class="py-20 px-4">
      <h1 class="text-4xl font-bold">Welcome</h1>
    </section>

    <!-- Features -->
    <section class="py-16 bg-gray-50 dark:bg-neutral-900">
      <div class="max-w-6xl mx-auto px-4 grid md:grid-cols-3 gap-8">
        {features.map((f) => (
          <div class="p-6 bg-white dark:bg-neutral-800 rounded-xl">
            <h3 class="font-bold">{f.title}</h3>
            <p class="text-gray-600 dark:text-gray-300">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  </main>
</Layout>
```

#### Next.js Layout (`app/layout.tsx`)
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Site Title",
  description: "Site description",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

#### Next.js API Route (`app/api/example/route.ts`)
```typescript
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ message: "Hello" });
}

export async function POST(request: Request) {
  const data = await request.json();
  // Process data...
  return NextResponse.json({ success: true });
}
```

### 5. Set Up GitHub Repo

```bash
cd ~/hosted-sites/<site-name>
git init
gh repo create <site-name> --public --source=. --remote=origin
```

#### GitHub Actions for Astro (`.github/workflows/deploy.yml`)
```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      # Add deployment step based on your hosting
```

### 6. Configure Caddy Subdomain

**Domain:** `mike-vito.rl-quests.com` (wildcard DNS configured)
**Caddyfile location:** `/home/ubuntu/Caddyfile`

Add subdomain to the Caddyfile:

#### For Astro (static sites)
```caddy
<site-name>.mike-vito.rl-quests.com {
    root * /home/ubuntu/hosted-sites/<site-name>/dist
    try_files {path} /index.html
    file_server
}
```

#### For Next.js (app servers)
```caddy
<site-name>.mike-vito.rl-quests.com {
    reverse_proxy localhost:<port>
}
```

**Port Assignment:** Next.js apps use ports starting at 3201 (3200 is vito-leads, 3100 is dashboard-api)

**Apply changes:**
```bash
sudo systemctl reload caddy
```

Caddy auto-provisions HTTPS certificates via Let's Encrypt.

### 7. Build & Deploy

#### Astro
```bash
npm run build  # Outputs to dist/
```

#### Next.js
```bash
npm run build
# For standalone: node .next/standalone/server.js
# Or use PM2: pm2 start .next/standalone/server.js --name <site-name>
```

## Design Patterns

### Tailwind Dark Mode
```html
<!-- Backgrounds -->
bg-white dark:bg-neutral-950
bg-gray-50 dark:bg-neutral-900

<!-- Text -->
text-gray-900 dark:text-white
text-gray-600 dark:text-gray-300

<!-- Borders -->
border-gray-200 dark:border-neutral-700

<!-- Cards -->
bg-white dark:bg-neutral-800 rounded-xl shadow-sm
```

### Responsive Layout
```html
<div class="max-w-7xl mx-auto px-4">
  <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
    <!-- Items -->
  </div>
</div>
```

### Fixed Header
```html
<header class="fixed top-0 inset-x-0 z-50 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-sm border-b border-gray-100 dark:border-neutral-800">
  <!-- Nav content -->
</header>
<main class="pt-16"> <!-- Offset for fixed header -->
```

## PM2 for Next.js Apps

```bash
# Start
pm2 start .next/standalone/server.js --name myapp

# With environment variables
pm2 start .next/standalone/server.js --name myapp -- -p 3001

# Save for auto-restart
pm2 save
```

## Important Notes

- **Astro outputs to `dist/`** - Caddy serves this directly
- **Next.js standalone outputs to `.next/standalone/`** - Run with Node or PM2
- Always use `import.meta.env.BASE_URL` in Astro for asset paths
- Dark mode uses `class` strategy with localStorage persistence
- Mobile-first responsive design with Tailwind breakpoints

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/layout/Sidebar';
import { PageContextProvider } from '@/components/chat/PageContextProvider';
import { ChatWidget } from '@/components/chat/ChatWidget';
import { Suspense } from 'react';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Northstar Mart · Sales desk',
  description: 'Retail analytics and a grounded sales diagnostics agent',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col overflow-x-hidden md:flex-row">
        <Sidebar />
        <Suspense>
          <PageContextProvider>
            <main className="min-h-screen min-w-0 flex-1 px-4 py-5 md:px-8 md:py-6">
              {children}
            </main>
            <ChatWidget />
          </PageContextProvider>
        </Suspense>
      </body>
    </html>
  );
}

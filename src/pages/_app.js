import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { AuthProvider } from '../context/AuthContext';
import Layout from '../components/Layout';
import '../styles/globals.css';

function MyApp({ Component, pageProps }) {
  const router = useRouter();

  // Track page views (if analytics is available)
  useEffect(() => {
    const handleRouteChange = (url) => {
      // Can add analytics tracking here if needed
    };
    router.events.on('routeChangeComplete', handleRouteChange);
    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [router.events]);

  // Determine if page is auth page
  const isAuthPage = ['/login', '/register', '/forgot-password'].includes(router.pathname);
  const isHomePage = router.pathname === '/';

  // For auth pages, render without Layout
  if (isAuthPage || isHomePage) {
    return (
      <AuthProvider>
        <Component {...pageProps} />
      </AuthProvider>
    );
  }

  // For protected pages, render with Layout
  return (
    <AuthProvider>
      <Layout title={pageProps.title || 'Virtual Football Manager Career'}>
        <Component {...pageProps} />
      </Layout>
    </AuthProvider>
  );
}

export default MyApp;

import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { auth } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { Toaster } from 'react-hot-toast';
import styles from './Layout.module.css';

export default function Layout({ children, title = 'Virtual Football Manager Career' }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: '📊' },
    { name: 'Career', href: '/career', icon: '🏆' },
    { name: 'Club', href: '/club', icon: '⚽' },
    { name: 'Players', href: '/players', icon: '👥' },
    { name: 'League', href: '/league', icon: '📋' },
    { name: 'Transfers', href: '/transfers', icon: '💼' },
    { name: 'Fixtures', href: '/fixtures', icon: '📅' },
    { name: 'Statistics', href: '/statistics', icon: '📊' },
    { name: 'News', href: '/news', icon: '📰' },
    { name: 'Profile', href: '/profile', icon: '👤' },
  ];

  const isAuthPage = ['/login', '/register', '/forgot-password'].includes(router.pathname);

  if (isAuthPage) {
    return (
      <>
        <Head>
          <title>{title}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <Toaster
          position="top-right"
          toastOptions={{
            className: 'glass-dark',
            duration: 4000,
            style: {
              background: 'rgba(0,0,0,0.8)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.1)',
              backdropFilter: 'blur(8px)',
            },
          }}
        />
        <main>{children}</main>
      </>
    );
  }

  return (
    <div className={styles.container}>
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0a0a0a" />
        <link rel="icon" href="/favicon.ico" />
        <meta name="description" content="Complete browser-based football management simulation game" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content="Complete browser-based football management simulation game" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
      </Head>

      <Toaster
        position="top-right"
        toastOptions={{
          className: 'glass-dark',
          duration: 4000,
          style: {
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(8px)',
          },
        }}
      />

      {/* Mobile Header */}
      <header className={styles.mobileHeader}>
        <button onClick={toggleSidebar} className={styles.menuButton}>
          <span className={styles.menuIcon}>☰</span>
        </button>
        <Link href="/dashboard" className={styles.logo}>
          ⚽ VFMC
        </Link>
        <div className={styles.headerRight}>
          {user && (
            <div className={styles.userAvatar}>
              {user.photoURL ? (
                <img src={user.photoURL} alt="User" className={styles.avatarImage} />
              ) : (
                <span>{user.email?.[0]?.toUpperCase() || 'U'}</span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarHeader}>
          <Link href="/dashboard" className={styles.sidebarLogo}>
            ⚽ VFMC
          </Link>
          <button onClick={toggleSidebar} className={styles.closeButton}>
            ✕
          </button>
        </div>

        <nav className={styles.nav}>
          {navigation.map((item) => {
            const isActive = router.pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`${styles.navItem} ${isActive ? styles.navActive : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          {user && (
            <div className={styles.userInfo}>
              <div className={styles.userName}>
                {user.displayName || user.email?.split('@')[0] || 'User'}
              </div>
              <button onClick={handleLogout} className={styles.logoutButton}>
                🚪 Logout
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className={styles.overlay} onClick={toggleSidebar}></div>
      )}

      {/* Main Content */}
      <main className={styles.main}>
        <div className={styles.content}>
          {children}
        </div>
      </main>
    </div>
  );
}

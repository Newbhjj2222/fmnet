import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import NotificationBell from './NotificationBell';
import styles from './Navigation.module.css';

export default function Navigation() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: '📊' },
    { name: 'Career', href: '/career', icon: '🏆' },
    { name: 'Club', href: '/club', icon: '⚽' },
    { name: 'Players', href: '/players', icon: '👥' },
    { name: 'League', href: '/league', icon: '📋' },
    { name: 'Transfers', href: '/transfers', icon: '💼' },
  ];

  return (
    <nav className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`}>
      <div className={styles.navContainer}>
        <Link href="/dashboard" className={styles.logo}>
          ⚽ VFMC
        </Link>

        <div className={styles.navLinks}>
          {navItems.map((item) => {
            const isActive = router.pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`${styles.navLink} ${isActive ? styles.active : ''}`}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.name}</span>
              </Link>
            );
          })}
        </div>

        <div className={styles.navActions}>
          <NotificationBell />
        </div>
      </div>
    </nav>
  );
}

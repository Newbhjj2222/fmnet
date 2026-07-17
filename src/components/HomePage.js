import Link from 'next/link';
import Head from 'next/head';
import styles from '../styles/Home.module.css';

export default function HomePage() {
  return (
    <>
      <Head>
        <title>Virtual Football Manager Career</title>
        <meta name="description" content="Complete browser-based football management simulation game" />
        <meta property="og:title" content="Virtual Football Manager Career" />
        <meta property="og:description" content="Complete browser-based football management simulation game" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>

      <div className={styles.hero}>
        <div className={styles.heroContent}>
          <h1 className={`${styles.title} gradient-text`}>
            Virtual Football Manager Career
          </h1>
          <p className={styles.subtitle}>
            Build your legacy. Manage your club. Become a legend.
            The most immersive browser-based football management experience.
          </p>

          <div className={styles.ctaContainer}>
            <Link href="/register" className="btn-primary">
              Get Started Free
            </Link>
            <Link href="/login" className="btn-glass">
              Sign In
            </Link>
          </div>

          <div className={styles.features}>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>🏆</div>
              <h3 className={styles.featureTitle}>Career Mode</h3>
              <p className={styles.featureDesc}>
                Create your manager, choose your club, and lead them to glory
                through multiple seasons.
              </p>
            </div>

            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>⚽</div>
              <h3 className={styles.featureTitle}>3D Match Engine</h3>
              <p className={styles.featureDesc}>
                Watch your team play in stunning 3D with realistic player
                animations and AI behavior.
              </p>
            </div>

            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>💼</div>
              <h3 className={styles.featureTitle}>Transfer Market</h3>
              <p className={styles.featureDesc}>
                Buy, sell, and loan players. Negotiate contracts and build
                your dream squad.
              </p>
            </div>

            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>📊</div>
              <h3 className={styles.featureTitle}>Deep Statistics</h3>
              <p className={styles.featureDesc}>
                Track every detail from player performance to club finances
                with detailed analytics.
              </p>
            </div>
          </div>

          <div className={styles.stats}>
            <div className={styles.statItem}>
              <div className={styles.statNumber}>500+</div>
              <div className={styles.statLabel}>Players</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statNumber}>20+</div>
              <div className={styles.statLabel}>Clubs</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statNumber}>100+</div>
              <div className={styles.statLabel}>Achievements</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statNumber}>50+</div>
              <div className={styles.statLabel}>Hours of Gameplay</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

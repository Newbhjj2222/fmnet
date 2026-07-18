import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useAuth } from '../context/AuthContext';
import { db } from '../components/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement } from 'chart.js';
import toast from 'react-hot-toast';
import styles from './dashboard.module.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement);

export default function Dashboard() {
  const router = useRouter();
  const { user, userData, loading } = useAuth();
  const [stats, setStats] = useState({
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals: 0,
    conceded: 0,
    position: '-',
    points: 0
  });
  const [recentMatches, setRecentMatches] = useState([]);
  const [clubInfo, setClubInfo] = useState(null);
  const [upcomingFixtures, setUpcomingFixtures] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }

    if (user) {
      fetchDashboardData();
    }
  }, [user, loading, router]);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      
      // Get user's career data
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);
      let careerData = null;
      
      if (userDoc.exists()) {
        const data = userDoc.data();
        careerData = data.careerData || {};
        
        // Update stats from career data
        setStats({
          matches: careerData.totalMatches || 0,
          wins: careerData.totalWins || 0,
          draws: careerData.totalDraws || 0,
          losses: careerData.totalLosses || 0,
          goals: careerData.goalsFor || 0,
          conceded: careerData.goalsAgainst || 0,
          position: careerData.currentPosition || '-',
          points: careerData.points || 0
        });
      }

      // Get recent matches
      const matchesQuery = query(
        collection(db, 'matches'),
        where('userId', '==', user.uid)
      );
      const matchesSnapshot = await getDocs(matchesQuery);
      const matches = [];
      matchesSnapshot.forEach(doc => {
        matches.push({ id: doc.id, ...doc.data() });
      });
      
      // Sort by date and get last 5
      matches.sort((a, b) => new Date(b.date) - new Date(a.date));
      setRecentMatches(matches.slice(0, 5));

      // Get club info if careerData has clubId
      if (careerData.currentClub) {
        const clubDoc = await getDoc(doc(db, 'clubs', careerData.currentClub));
        if (clubDoc.exists()) {
          setClubInfo({ id: clubDoc.id, ...clubDoc.data() });
        }
      }

      // Get upcoming fixtures
      const fixturesQuery = query(
        collection(db, 'fixtures'),
        where('userId', '==', user.uid),
        where('status', '==', 'upcoming')
      );
      const fixturesSnapshot = await getDocs(fixturesQuery);
      const fixtures = [];
      fixturesSnapshot.forEach(doc => {
        fixtures.push({ id: doc.id, ...doc.data() });
      });
      fixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
      setUpcomingFixtures(fixtures.slice(0, 5));

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  if (loading || isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Chart data
  const matchChartData = {
    labels: ['Wins', 'Draws', 'Losses'],
    datasets: [
      {
        label: 'Matches',
        data: [stats.wins, stats.draws, stats.losses],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderColor: ['#059669', '#d97706', '#dc2626'],
        borderWidth: 2,
      },
    ],
  };

  const performanceData = {
    labels: ['Goals', 'Conceded', 'Clean Sheets'],
    datasets: [
      {
        label: 'Performance',
        data: [stats.goals, stats.conceded, Math.floor(stats.matches * 0.3)],
        backgroundColor: ['#3b82f6', '#ef4444', '#10b981'],
        borderColor: ['#2563eb', '#dc2626', '#059669'],
        borderWidth: 2,
      },
    ],
  };

  return (
    <>
      <Head>
        <title>Dashboard - Virtual Football Manager Career</title>
      </Head>

      <div className={styles.dashboard}>
        <div className={styles.header}>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>
            Welcome back, {userData?.displayName || user?.email?.split('@')[0] || 'Manager'}!
          </p>
        </div>

        <div className={styles.statsGrid}>
          <div className={`${styles.statCard} ${styles.primary}`}>
            <div className={styles.statIcon}>🏆</div>
            <div className={styles.statInfo}>
              <span className={styles.statLabel}>Matches Played</span>
              <span className={styles.statValue}>{stats.matches}</span>
            </div>
          </div>

          <div className={`${styles.statCard} ${styles.success}`}>
            <div className={styles.statIcon}>⭐</div>
            <div className={styles.statInfo}>
              <span className={styles.statLabel}>Win Rate</span>
              <span className={styles.statValue}>
                {stats.matches > 0 ? Math.round((stats.wins / stats.matches) * 100) : 0}%
              </span>
            </div>
          </div>

          <div className={`${styles.statCard} ${styles.warning}`}>
            <div className={styles.statIcon}>📊</div>
            <div className={styles.statInfo}>
              <span className={styles.statLabel}>Position</span>
              <span className={styles.statValue}>{stats.position}</span>
            </div>
          </div>

          <div className={`${styles.statCard} ${styles.info}`}>
            <div className={styles.statIcon}>⚽</div>
            <div className={styles.statInfo}>
              <span className={styles.statLabel}>Goal Difference</span>
              <span className={styles.statValue}>+{stats.goals - stats.conceded}</span>
            </div>
          </div>
        </div>

        {clubInfo && (
          <div className={styles.clubInfo}>
            <div className={styles.clubHeader}>
              <span className={styles.clubLogo}>⚽</span>
              <div>
                <h2 className={styles.clubName}>{clubInfo.name}</h2>
                <p className={styles.clubDetails}>
                  {clubInfo.league} • {clubInfo.stadium}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className={styles.chartsGrid}>
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Match Results</h3>
            <div className={styles.chartContainer}>
              <Doughnut data={matchChartData} options={{ responsive: true, maintainAspectRatio: false }} />
            </div>
          </div>

          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Team Performance</h3>
            <div className={styles.chartContainer}>
              <Bar data={performanceData} options={{ responsive: true, maintainAspectRatio: false }} />
            </div>
          </div>
        </div>

        <div className={styles.feedGrid}>
          <div className={styles.feedCard}>
            <h3 className={styles.feedTitle}>Recent Matches</h3>
            <div className={styles.feedList}>
              {recentMatches.length > 0 ? (
                recentMatches.map((match) => (
                  <div key={match.id} className={styles.feedItem}>
                    <span className={styles.matchResult}>
                      {match.homeScore !== undefined ? 
                        `${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}` :
                        `${match.homeTeam} vs ${match.awayTeam}`
                      }
                    </span>
                    <span className={styles.matchStatus}>
                      {match.status === 'played' ? 
                        <span className={styles.played}>✓ Played</span> :
                        <span className={styles.upcoming}>⏳ Upcoming</span>
                      }
                    </span>
                  </div>
                ))
              ) : (
                <p className={styles.empty}>No recent matches</p>
              )}
            </div>
          </div>

          <div className={styles.feedCard}>
            <h3 className={styles.feedTitle}>Upcoming Fixtures</h3>
            <div className={styles.feedList}>
              {upcomingFixtures.length > 0 ? (
                upcomingFixtures.map((fixture) => (
                  <div key={fixture.id} className={styles.feedItem}>
                    <span className={styles.fixtureInfo}>
                      {fixture.homeTeam} vs {fixture.awayTeam}
                    </span>
                    <span className={styles.fixtureDate}>
                      {new Date(fixture.date).toLocaleDateString()}
                    </span>
                  </div>
                ))
              ) : (
                <p className={styles.empty}>No upcoming fixtures</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

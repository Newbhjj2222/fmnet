import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { auth } from '../components/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import HomePage from '../components/HomePage';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        router.replace('/dashboard');
      }
    });
    return () => unsubscribe();
  }, [router]);

  return <HomePage />;
}

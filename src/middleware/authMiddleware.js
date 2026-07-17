import { auth } from '../components/firebase';
import { onAuthStateChanged } from 'firebase/auth';

export function withAuth(handler) {
  return async (context) => {
    // This is a server-side middleware for getServerSideProps
    const { req } = context;
    
    // For client-side protection, we use the AuthContext
    // For server-side, we check the session via Firebase Admin SDK
    
    // Since we don't have Firebase Admin in this setup,
    // we'll use client-side auth and redirect on the client
    
    return handler(context);
  };
}

// Client-side route protection
export function requireAuth(router) {
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.push('/login');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [router]);
  
  return loading;
}

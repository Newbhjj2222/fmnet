import { useState } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { auth } from '../components/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import toast from 'react-hot-toast';
import styles from './forgot-password.module.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) {
      toast.error('Please enter your email address');
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setSent(true);
      toast.success('Password reset email sent! Check your inbox.');
    } catch (error) {
      console.error('Reset password error:', error);
      let message = 'Failed to send reset email. Please try again.';
      if (error.code === 'auth/user-not-found') {
        message = 'No account found with this email address.';
      } else if (error.code === 'auth/invalid-email') {
        message = 'Invalid email address.';
      }
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Forgot Password - Virtual Football Manager Career</title>
      </Head>

      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.header}>
            <Link href="/" className={styles.logo}>⚽ VFMC</Link>
            <h1 className={styles.title}>Reset Password</h1>
            <p className={styles.subtitle}>
              {sent 
                ? 'Check your email for reset instructions' 
                : 'Enter your email to receive reset instructions'}
            </p>
          </div>

          {!sent ? (
            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.inputGroup}>
                <label htmlFor="email" className={styles.label}>
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={styles.input}
                  placeholder="you@example.com"
                  required
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                className={styles.submitButton}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className={styles.spinner}></span>
                    Sending...
                  </>
                ) : (
                  'Send Reset Email'
                )}
              </button>
            </form>
          ) : (
            <div className={styles.successMessage}>
              <div className={styles.successIcon}>📨</div>
              <p className={styles.successText}>
                Password reset link has been sent to your email address.
                Please check your inbox and follow the instructions.
              </p>
            </div>
          )}

          <div className={styles.footer}>
            <Link href="/login" className={styles.link}>
              ← Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

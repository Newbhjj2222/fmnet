import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { db, auth } from './firebase';
import { collection, query, where, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import styles from './NotificationBell.module.css';

export default function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', auth.currentUser.uid),
      where('read', '==', false)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() });
      });
      setNotifications(items);
      setUnreadCount(items.length);
    });

    return () => unsubscribe();
  }, []);

  const handleNotificationClick = async (notification) => {
    if (!notification.read) {
      try {
        await updateDoc(doc(db, 'notifications', notification.id), {
          read: true
        });
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    }
    
    if (notification.link) {
      router.push(notification.link);
    }
    setIsOpen(false);
  };

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  const markAllAsRead = async () => {
    try {
      const batch = [];
      notifications.forEach((notification) => {
        if (!notification.read) {
          batch.push(updateDoc(doc(db, 'notifications', notification.id), {
            read: true
          }));
        }
      });
      await Promise.all(batch);
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  const getNotificationIcon = (type) => {
    const icons = {
      transfer: '💼',
      match: '⚽',
      news: '📰',
      achievement: '🏆',
      injury: '⚠️',
      contract: '📝',
      training: '🏋️',
      board: '🏢'
    };
    return icons[type] || '📌';
  };

  return (
    <div className={styles.container}>
      <button 
        onClick={toggleDropdown} 
        className={styles.bellButton}
        aria-label="Notifications"
      >
        <span className={styles.bellIcon}>🔔</span>
        {unreadCount > 0 && (
          <span className={styles.badge}>{unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <>
          <div className={styles.dropdown}>
            <div className={styles.header}>
              <span className={styles.title}>Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllAsRead} className={styles.markAll}>
                  Mark all read
                </button>
              )}
            </div>

            <div className={styles.list}>
              {notifications.length === 0 ? (
                <div className={styles.empty}>
                  <span className={styles.emptyIcon}>✅</span>
                  <p>No notifications</p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`${styles.item} ${!notification.read ? styles.unread : ''}`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <span className={styles.itemIcon}>
                      {getNotificationIcon(notification.type)}
                    </span>
                    <div className={styles.itemContent}>
                      <p className={styles.itemMessage}>{notification.message}</p>
                      <span className={styles.itemTime}>
                        {notification.createdAt?.toDate?.()?.toLocaleDateString() || 'Just now'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className={styles.overlay} onClick={() => setIsOpen(false)} />
        </>
      )}
    </div>
  );
}

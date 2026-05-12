'use client';

import { useSyncExternalStore } from 'react';

function subscribeOnline(callback: () => void) {
  window.addEventListener('offline', callback);
  window.addEventListener('online', callback);
  return () => {
    window.removeEventListener('offline', callback);
    window.removeEventListener('online', callback);
  };
}

const getSnapshot = () => navigator.onLine;
const getServerSnapshot = () => true;

export function OfflineIndicator() {
  const isOnline = useSyncExternalStore(subscribeOnline, getSnapshot, getServerSnapshot);

  if (isOnline) return null;

  return (
    <div className="bg-amber-500 text-white text-center py-1 text-sm font-medium">
      Sin conexion. Los cambios se sincronizaran cuando vuelva la conexion
    </div>
  );
}

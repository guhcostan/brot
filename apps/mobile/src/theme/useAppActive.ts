import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** False while the app is in the background, so avatar loops and blinks pause with it. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}

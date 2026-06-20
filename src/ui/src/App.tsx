import { useEffect } from 'react';
import Home from './Home';
import { connectToRunner, disconnectRunner } from './socket';

export default function App() {
  useEffect(() => {
    connectToRunner();
    return () => {
      disconnectRunner();
    };
  }, []);

  return <Home />;
}
